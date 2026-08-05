// Tsuzuki public API — /api/v1/*
//
// The reason this exists rather than telling people to call AniList directly:
// AniList publishes the Japanese broadcast time and nothing else. Every
// response here carries the *release variants* instead — the JP broadcast, the
// subtitled simulcast and the English dub — with the human correction layer
// (delays, breaks, exact simulcast times) already applied. That is the one
// thing a consumer cannot get upstream.
//
// Data comes from _lib/catalog.mjs, not from AniList directly: memory, then a
// shared Blobs snapshot, and only then upstream (writing the result back). A
// warm season costs zero upstream calls no matter how many callers ask for it,
// and an AniList outage degrades to slightly stale data instead of a 502.
//
//   GET /api/v1                        service description + catalog health
//   GET /api/v1/schedule               corrected schedule for a date window
//   GET /api/v1/anime/<anilistId>      one title, with its full variant schedule
//   GET /api/v1/seasons/<season>/<yr>  a season's lineup (?full=1 for raw media)
//   GET /api/v1/search?q=              title search
//   GET /api/v1/overrides              the raw correction document
//
// Docs live at /api/ (site/api/index.html) and are the canonical reference.
import { getStore } from "@netlify/blobs";
import { variantsFor, mergeOverrides, showOverride, loadSeed } from "./_lib/schedule-overrides.mjs";
import {
  MEDIA_FIELDS, anilist, getSeason, getSeasonWindow, getMediaById, getFranchise,
  getExtras, getStudio, getOnThisDay,
  catalogHealth, seasonOf, shiftSeason, SEASONS,
} from "./_lib/catalog.mjs";

const SITE = "https://tsuzuki.netlify.app";
const VERSION = "1.1";

const MAX_DAYS = 31;
const RATE_LIMIT = 60;            // requests per window, per client
const RATE_WINDOW_MS = 60_000;

const SEARCH_QUERY = `query($search:String){
  Page(page:1,perPage:20){ media(type:ANIME,search:$search,sort:[SEARCH_MATCH,POPULARITY_DESC]){ ${MEDIA_FIELDS} } } }`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Pretty by default — these responses get read by people in a browser tab.
// The `full` payloads are the exception: they exist to be parsed by the app,
// and two-space indentation on 111 media records is a third of the transfer.
function json(body, { status = 200, maxAge = 300, headers = {}, pretty = true } = {}) {
  return new Response(JSON.stringify(body, null, pretty ? 2 : 0), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      "X-Tsuzuki-Api": VERSION,
      ...CORS, ...headers,
    },
  });
}
const fail = (status, error, hint) => json({ ok: false, error, hint }, { status, maxAge: 0 });

// Per-instance, in-memory, best-effort. A serverless platform gives every cold
// start a fresh counter, so this is a spike damper rather than a quota — the
// real protection is the CDN cache in front of these responses.
const hits = new Map();
function rateLimited(req) {
  const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "anon").split(",")[0].trim();
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) { hits.set(ip, { n: 1, reset: now + RATE_WINDOW_MS }); return null; }
  rec.n++;
  if (rec.n > RATE_LIMIT) return Math.ceil((rec.reset - now) / 1000);
  if (hits.size > 5000) hits.clear();   // unbounded growth is the only real leak here
  return null;
}

let overridesCache = null, overridesAt = 0;
async function loadOverrides() {
  if (overridesCache && Date.now() - overridesAt < 60_000) return overridesCache;
  let seed = null, live = null;
  seed = await loadSeed(SITE);
  try { live = await getStore("schedule-overrides").get("live", { type: "json" }); } catch {}
  overridesCache = mergeOverrides(seed, live);
  overridesAt = Date.now();
  return overridesCache;
}

/* ---------- shaping ---------- */
const titleOf = md => md.title.english || md.title.romaji || "Untitled";

function shapeMedia(md) {
  return {
    id: md.id,
    title: { english: md.title.english, romaji: md.title.romaji, native: md.title.native },
    format: md.format, episodes: md.episodes, duration: md.duration, status: md.status,
    source: md.source, isAdult: !!md.isAdult, countryOfOrigin: md.countryOfOrigin,
    genres: md.genres || [],
    averageScore: md.averageScore, popularity: md.popularity,
    studios: ((md.studios && md.studios.nodes) || []).map(s => s.name),
    startDate: md.startDate, endDate: md.endDate,
    coverImage: md.coverImage, bannerImage: md.bannerImage,
    streamingOn: ((md.externalLinks || []).filter(l => l && l.type === "STREAMING" && l.site)).map(l => ({ site: l.site, url: l.url })),
    siteUrl: md.siteUrl,
    tsuzukiUrl: `${SITE}/?show=${md.id}`,
  };
}

// One episode -> one entry per release variant, with any delay/break attached.
// `exact:false` means we derived the time from the broadcast rather than
// confirming it; consumers that care should surface that the same way we do.
function episodeEntries(md, node, override) {
  const { status, variants } = variantsFor(md, node, override);
  const note = status ? { kind: status.kind, reason: status.reason || null, source: status.source || null } : null;
  if (!variants.length) {
    return [{ mediaId: md.id, episode: node.episode, airType: null, airingAt: null, isBreak: true, note }];
  }
  return variants.map(v => ({
    mediaId: md.id,
    episode: node.episode,
    airType: v.type,
    airingAt: v.ts,
    airingAtIso: new Date(v.ts * 1000).toISOString(),
    exact: v.exact,
    estimated: !!v.estimated,
    platform: v.platform || null,
    isBreak: false,
    note,
  }));
}

const isAdultMedia = md => !!(md && (md.isAdult || (md.genres || []).includes("Hentai")));
const matchesTitle = (md, q) => Object.values(md.title || {}).some(t => t && String(t).toLowerCase().includes(q));

/* ---------- endpoints ---------- */
async function describe() {
  const now = new Date();
  const s = seasonOf(now.getUTCMonth()), y = now.getUTCFullYear();
  const health = await catalogHealth([shiftSeason(s, y, -1), { season: s, year: y }, shiftSeason(s, y, 1)]);
  return json({
    ok: true,
    name: "Tsuzuki API",
    version: VERSION,
    docs: `${SITE}/api/`,
    describes: "Anime airing schedules with sub / dub / broadcast release variants and human corrections applied.",
    attribution: "Schedule data derives from AniList. If you use this API publicly, credit both AniList and Tsuzuki with a visible link.",
    rateLimit: { requests: RATE_LIMIT, windowSeconds: RATE_WINDOW_MS / 1000, note: "Best-effort per instance. Responses are CDN-cached for 5 minutes — cache on your side too." },
    // Which seasons we can answer from our own storage. Anything not listed
    // here is a cold read that still costs an upstream call.
    catalog: health,
    endpoints: [
      { path: "/api/v1/schedule", params: { start: "YYYY-MM-DD (default today)", days: `1-${MAX_DAYS} (default 7)`, airType: "raw|sub|dub — omit for all", platform: "e.g. Crunchyroll", format: "TV|TV_SHORT|MOVIE|ONA|OVA|SPECIAL", includeAdult: "1 to include (default off)" } },
      { path: "/api/v1/anime/{anilistId}", params: { full: "1 to return the full media record instead of the summary shape" } },
      { path: "/api/v1/seasons/{season}/{year}", params: { season: "winter|spring|summer|fall", full: "1 to return the full media records instead of the summary shape" } },
      { path: "/api/v1/franchise/{anilistId}", describes: "Every anime in the same franchise, walked across the relation graph and returned in release order." },
      { path: "/api/v1/anime/{anilistId}/extras", describes: "Characters + voice cast, recommendations and the main studio." },
      { path: "/api/v1/studio/{anilistStudioId}", describes: "A studio's most popular titles." },
      { path: "/api/v1/on-this-day", params: { d: "MMDD, e.g. 0805" }, describes: "Anime that premiered on this month/day in past years." },
      { path: "/api/v1/search", params: { q: "title fragment", limit: "1-25 (default 12)" } },
      { path: "/api/v1/overrides", describes: "The raw correction document layered over AniList." },
    ],
  }, { maxAge: 300 });
}

async function schedule(url) {
  const p = url.searchParams;
  const days = Math.max(1, Math.min(MAX_DAYS, parseInt(p.get("days"), 10) || 7));
  const startParam = p.get("start");
  if (startParam && !/^\d{4}-\d{2}-\d{2}$/.test(startParam)) return fail(400, "start must be YYYY-MM-DD");
  const start = startParam ? new Date(startParam + "T00:00:00Z") : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (isNaN(start)) return fail(400, "start is not a real date");
  const from = Math.floor(start.getTime() / 1000);
  const to = from + days * 86400;

  const airType = p.get("airType");
  if (airType && !["raw", "sub", "dub"].includes(airType)) return fail(400, "airType must be raw, sub or dub");
  const platform = p.get("platform");
  const format = p.get("format");
  const includeAdult = p.get("includeAdult") === "1";

  // The window can straddle a season boundary, so pull the season it starts in
  // plus its neighbours and de-duplicate.
  const media = await getSeasonWindow(seasonOf(start.getUTCMonth()), start.getUTCFullYear());

  const overrides = await loadOverrides();
  const episodes = [];
  for (const md of media) {
    if (!includeAdult && isAdultMedia(md)) continue;
    if (format && md.format !== format) continue;
    if (platform && !(md.externalLinks || []).some(l => l && l.type === "STREAMING" && l.site === platform)) continue;
    const ov = showOverride(overrides, md.id);
    for (const node of (md.airingSchedule && md.airingSchedule.nodes) || []) {
      for (const e of episodeEntries(md, node, ov)) {
        if (e.isBreak) continue;                       // breaks belong to a title, not a date window
        if (e.airingAt < from || e.airingAt >= to) continue;
        if (airType && e.airType !== airType) continue;
        episodes.push({ ...e, title: titleOf(md), coverImage: (md.coverImage && md.coverImage.medium) || null });
      }
    }
  }
  episodes.sort((a, b) => a.airingAt - b.airingAt);

  return json({
    ok: true,
    query: { start: start.toISOString().slice(0, 10), days, airType: airType || "all", platform: platform || null, format: format || null },
    count: episodes.length,
    episodes,
    attribution: "Data from AniList, corrected by Tsuzuki.",
  });
}

async function anime(id, url) {
  if (!/^\d+$/.test(id)) return fail(400, "id must be an AniList media id");
  let md;
  try { md = await getMediaById(id); }
  catch (err) {
    if (err && err.notFound) return fail(404, "No anime with that id", "Ids are AniList media ids — check the title on anilist.co.");
    throw err;
  }
  if (!md) return fail(404, "No anime with that id");

  // ?full=1 — the untouched media record, same shape as an AniList response.
  // The app's deep links (?show=<id>) read this so opening a title that isn't
  // in the loaded seasons doesn't have to go upstream.
  if (url && url.searchParams.get("full") === "1") {
    return json({ ok: true, media: md, attribution: "Data from AniList, corrected by Tsuzuki." }, { maxAge: 900, pretty: false });
  }

  const overrides = await loadOverrides();
  const ov = showOverride(overrides, md.id);
  const nodes = ((md.airingSchedule && md.airingSchedule.nodes) || []).slice().sort((a, b) => a.airingAt - b.airingAt);
  const episodes = nodes.flatMap(n => episodeEntries(md, n, ov));
  return json({
    ok: true,
    anime: shapeMedia(md),
    // Present even when empty: its absence would otherwise read as "no
    // corrections known" versus "this endpoint doesn't report corrections".
    corrections: ov || null,
    episodes,
    attribution: "Data from AniList, corrected by Tsuzuki.",
  });
}

async function season(name, year, url) {
  const s = String(name || "").toUpperCase();
  if (!SEASONS.includes(s)) return fail(400, "season must be winter, spring, summer or fall");
  const y = parseInt(year, 10);
  if (!(y >= 1940 && y <= 2100)) return fail(400, "year is out of range");
  const snap = await getSeason(s, y);
  const media = (snap && snap.media) || [];

  // ?full=1 returns the media records untouched. That is what the app itself
  // reads on launch: it needs tags, relations, trailers and descriptions, which
  // the summary shape drops, and going through here rather than straight to
  // AniList is what keeps a page load off the upstream budget.
  if (url.searchParams.get("full") === "1") {
    return json({
      ok: true, season: s.toLowerCase(), year: y, count: media.length,
      fetchedAt: snap ? snap.fetchedAt : null,
      media,
      attribution: "Data from AniList, corrected by Tsuzuki.",
    }, { maxAge: 900, pretty: false });
  }

  const overrides = await loadOverrides();
  return json({
    ok: true,
    season: s.toLowerCase(), year: y, count: media.length,
    anime: media.map(md => {
      const ov = showOverride(overrides, md.id);
      const next = ((md.airingSchedule && md.airingSchedule.nodes) || [])
        .flatMap(n => episodeEntries(md, n, ov))
        .filter(e => !e.isBreak && e.airingAt > Date.now() / 1000)
        .sort((a, b) => a.airingAt - b.airingAt)[0] || null;
      return { ...shapeMedia(md), nextEpisode: next };
    }),
    attribution: "Data from AniList, corrected by Tsuzuki.",
  });
}

const REL_LABEL = {
  PREQUEL: "Prequel", SEQUEL: "Sequel", PARENT: "Parent story", SIDE_STORY: "Side story",
  SPIN_OFF: "Spin-off", ALTERNATIVE: "Alternative", SUMMARY: "Summary",
  COMPILATION: "Compilation", CONTAINS: "Contains", OTHER: "Related",
};

// Chronological order for a franchise. An entry we only know the year of sorts
// after everything precisely dated in that year (an announced-for-2027 title
// belongs at the end of 2027, not the start), and an entry with no date at all
// sorts last — those are the "TBA" ones.
function franchiseSortKey(node) {
  const d = node.startDate || {};
  if (!d.year) return [Infinity, 0, 0, node.id];
  return [d.year, d.month || 99, d.day || 99, node.id];
}
const byFranchiseOrder = (a, b) => {
  const ka = franchiseSortKey(a), kb = franchiseSortKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
};

// The whole franchise a title belongs to, in release order — not just the two
// entries AniList happens to link directly to this one.
async function franchise(id) {
  if (!/^\d+$/.test(id)) return fail(400, "id must be an AniList media id");
  let graph;
  try { graph = await getFranchise(id); }
  catch (err) {
    if (err && err.notFound) return fail(404, "No anime with that id");
    throw err;
  }
  if (!graph) return fail(404, "No anime with that id");
  const entries = graph.nodes.slice().sort(byFranchiseOrder).map(n => ({
    id: n.id,
    title: n.title,
    format: n.format,
    status: n.status,
    episodes: n.episodes,
    isAdult: n.isAdult,
    coverImage: n.coverImage,
    startDate: n.startDate,
    relation: n.relation,
    relationLabel: n.relation ? (REL_LABEL[n.relation] || "Related") : null,
    isRoot: n.id === graph.rootId,
    tsuzukiUrl: `${SITE}/?show=${n.id}`,
  }));
  return json({
    ok: true, rootId: graph.rootId, count: entries.length,
    // True when the walk hit its node/time bound — the list is still in order,
    // just not exhaustive.
    truncated: !!graph.truncated,
    entries,
    attribution: "Data from AniList, corrected by Tsuzuki.",
  }, { maxAge: 3600 });
}

/* The detail pane's lazily-loaded blocks. These exist so the app doesn't have
   to query AniList from the browser for data that is identical for every
   visitor — see the caching note in _lib/catalog.mjs. They are documented as
   part of the public API because there is no reason to keep them private. */
async function extras(id) {
  if (!/^\d+$/.test(id)) return fail(400, "id must be an AniList media id");
  const data = await getExtras(id);
  if (!data) return fail(404, "No anime with that id");
  return json({ ok: true, media: data, attribution: "Data from AniList, corrected by Tsuzuki." }, { maxAge: 3600, pretty: false });
}
async function studio(id) {
  if (!/^\d+$/.test(id)) return fail(400, "id must be an AniList studio id");
  const data = await getStudio(id);
  if (!data) return fail(404, "No studio with that id");
  return json({ ok: true, studio: data, attribution: "Data from AniList, corrected by Tsuzuki." }, { maxAge: 3600, pretty: false });
}
async function onThisDay(url) {
  const d = String(url.searchParams.get("d") || "").trim();
  if (!/^\d{4}$/.test(d)) return fail(400, "d must be MMDD, e.g. 0805");
  const month = +d.slice(0, 2), day = +d.slice(2);
  if (month < 1 || month > 12 || day < 1 || day > 31) return fail(400, "d is not a real month/day");
  const media = await getOnThisDay(d);
  return json({ ok: true, date: d, count: media.length, media, attribution: "Data from AniList, corrected by Tsuzuki." }, { maxAge: 3600, pretty: false });
}

// Search the seasons we already hold before asking upstream. Most searches on
// a schedule site are for something currently airing, so the cached window
// answers them outright; only a query about an older or unlisted title falls
// through to AniList.
async function search(url) {
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return fail(400, "q must be at least 2 characters");
  const limit = Math.max(1, Math.min(25, parseInt(url.searchParams.get("limit"), 10) || 12));
  const includeAdult = url.searchParams.get("includeAdult") === "1";

  const now = new Date();
  let local = [];
  try {
    local = (await getSeasonWindow(seasonOf(now.getUTCMonth()), now.getUTCFullYear(), { allowNetwork: false }))
      .filter(md => (includeAdult || !isAdultMedia(md)) && matchesTitle(md, q))
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  } catch (err) { console.warn("api: local search failed —", err.message); }

  const fromCatalog = local.length;   // read it now: `media` aliases `local` below
  let source = "catalog";
  let media = local;
  if (media.length < limit) {
    try {
      const d = await anilist(SEARCH_QUERY, { search: q });
      const seen = new Set(media.map(m => m.id));
      for (const md of (d.Page && d.Page.media) || []) {
        if (seen.has(md.id) || (!includeAdult && isAdultMedia(md))) continue;
        seen.add(md.id);
        media.push(md);
      }
      source = fromCatalog ? "catalog+anilist" : "anilist";
    } catch (err) {
      // A partial local answer beats no answer.
      if (!media.length) throw err;
      console.warn("api: upstream search failed —", err.message);
    }
  }

  media = media.slice(0, limit);
  const full = url.searchParams.get("full") === "1";
  return json({
    ok: true, query: q, source, count: media.length,
    [full ? "media" : "anime"]: full ? media : media.map(shapeMedia),
    attribution: "Data from AniList, corrected by Tsuzuki.",
  }, { maxAge: 600, pretty: !full });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return fail(405, "Only GET is supported");

  const retry = rateLimited(req);
  if (retry) return json({ ok: false, error: "Rate limit exceeded", retryAfterSeconds: retry },
    { status: 429, maxAge: 0, headers: { "Retry-After": String(retry) } });

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");   // ["api","v1", ...]
  const route = parts.slice(2);

  try {
    if (!route.length) return await describe();
    if (route[0] === "schedule" && route.length === 1) return await schedule(url);
    if (route[0] === "anime" && route.length === 2) return await anime(route[1], url);
    if (route[0] === "anime" && route.length === 3 && route[2] === "extras") return await extras(route[1]);
    if (route[0] === "studio" && route.length === 2) return await studio(route[1]);
    if (route[0] === "on-this-day" && route.length === 1) return await onThisDay(url);
    if (route[0] === "seasons" && route.length === 3) return await season(route[1], route[2], url);
    if (route[0] === "franchise" && route.length === 2) return await franchise(route[1]);
    if (route[0] === "search" && route.length === 1) return await search(url);
    if (route[0] === "overrides" && route.length === 1) return json({ ok: true, ...(await loadOverrides()) });
    return fail(404, `Unknown endpoint /${route.join("/")}`, `See ${SITE}/api/ for the endpoint list.`);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    console.error("api error", url.pathname, err);
    return fail(status, String((err && err.message) || err),
      status === 503 ? "Upstream AniList rate limit — retry shortly." : undefined);
  }
};
