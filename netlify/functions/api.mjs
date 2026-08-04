// Tsuzuki public API — /api/v1/*
//
// The reason this exists rather than telling people to call AniList directly:
// AniList publishes the Japanese broadcast time and nothing else. Every
// response here carries the *release variants* instead — the JP broadcast, the
// subtitled simulcast and the English dub — with the human correction layer
// (delays, breaks, exact simulcast times) already applied. That is the one
// thing a consumer cannot get upstream.
//
//   GET /api/v1                        service description + endpoint list
//   GET /api/v1/schedule               corrected schedule for a date window
//   GET /api/v1/anime/<anilistId>      one title, with its full variant schedule
//   GET /api/v1/seasons/<season>/<yr>  a season's lineup
//   GET /api/v1/overrides              the raw correction document
//
// Docs live at /api/ (site/api/index.html) and are the canonical reference.
import { getStore } from "@netlify/blobs";
import { variantsFor, mergeOverrides, showOverride, loadSeed } from "./_lib/schedule-overrides.mjs";

const ANILIST = "https://graphql.anilist.co";
const SITE = "https://tsuzuki.netlify.app";
const VERSION = "1.0";

// Bounds. These are not politeness limits — every request here costs an
// upstream AniList call, and AniList rate-limits *us*, not the caller.
const MAX_DAYS = 31;
const MAX_PAGES = 3;              // 50 titles per page
const RATE_LIMIT = 60;            // requests per window, per client
const RATE_WINDOW_MS = 60_000;

const MEDIA_FIELDS = `
  id title { romaji english native } format episodes duration status source isAdult countryOfOrigin
  genres averageScore popularity siteUrl
  coverImage { medium large color } bannerImage
  startDate { year month day } endDate { year month day }
  studios(isMain: true) { nodes { name } }
  externalLinks { site url type }
  airingSchedule { nodes { airingAt episode } }`;

const SEASON_QUERY = `query($season:MediaSeason,$seasonYear:Int,$page:Int){
  Page(page:$page,perPage:50){ pageInfo{ hasNextPage } media(season:$season,seasonYear:$seasonYear,type:ANIME,sort:POPULARITY_DESC){ ${MEDIA_FIELDS} } } }`;
const ID_QUERY = `query($id:Int){ Media(id:$id,type:ANIME){ ${MEDIA_FIELDS} } }`;

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
const seasonOf = m => (m <= 2 ? "WINTER" : m <= 5 ? "SPRING" : m <= 8 ? "SUMMER" : "FALL");
function shiftSeason(season, year, delta) {
  let i = SEASONS.indexOf(season) + delta;
  year += Math.floor(i / 4);
  i = ((i % 4) + 4) % 4;
  return { season: SEASONS[i], year };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, { status = 200, maxAge = 300, headers = {} } = {}) {
  return new Response(JSON.stringify(body, null, 2), {
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

async function anilist(query, variables) {
  const res = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) { const e = new Error("Upstream rate limit"); e.status = 503; throw e; }
  // AniList answers a query for a record that doesn't exist with its own 404.
  // That is the caller's mistake, not an upstream failure — don't launder it
  // into a 502, which would tell them to retry something that can never work.
  if (res.status === 404) { const e = new Error("Not found"); e.status = 404; e.notFound = true; throw e; }
  if (!res.ok) { const e = new Error("AniList HTTP " + res.status); e.status = 502; throw e; }
  const j = await res.json();
  if (j.errors) { const e = new Error(j.errors[0].message); e.status = 502; throw e; }
  return j.data;
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

// Season fetches are the expensive part: one /schedule request spans three
// seasons at up to three pages each, so nine upstream calls. AniList rate-limits
// *us*, not the caller, and the CDN can't help because the parameter space
// (start/days/airType/platform/format) fans out into many distinct URLs that all
// need the same underlying seasons.
//
// So seasons are cached per instance and shared across every request and every
// parameter combination. `inflight` collapses concurrent requests for the same
// season into one upstream fetch instead of a thundering herd on a cold start.
const SEASON_TTL_MS = 10 * 60_000;
const seasonCache = new Map();   // "SUMMER-2026" -> { at, media }
const inflight = new Map();

async function fetchSeasonUncached(season, year) {
  let out = [], page = 1, more = true;
  while (more && page <= MAX_PAGES) {
    const d = await anilist(SEASON_QUERY, { season, seasonYear: year, page });
    out = out.concat(d.Page.media);
    more = d.Page.pageInfo.hasNextPage;
    page++;
  }
  return out;
}
async function fetchSeason(season, year) {
  const key = `${season}-${year}`;
  const hit = seasonCache.get(key);
  if (hit && Date.now() - hit.at < SEASON_TTL_MS) return hit.media;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const media = await fetchSeasonUncached(season, year);
      seasonCache.set(key, { at: Date.now(), media });
      return media;
    } catch (err) {
      // Stale data beats a 503. If AniList is rate-limiting or down and we have
      // an older copy, serve it rather than failing the caller's request.
      if (hit) { console.warn(`api: serving stale ${key} — ${err.message}`); return hit.media; }
      throw err;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
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

/* ---------- endpoints ---------- */
function describe() {
  return json({
    ok: true,
    name: "Tsuzuki API",
    version: VERSION,
    docs: `${SITE}/api/`,
    describes: "Anime airing schedules with sub / dub / broadcast release variants and human corrections applied.",
    attribution: "Schedule data derives from AniList. If you use this API publicly, credit both AniList and Tsuzuki with a visible link.",
    rateLimit: { requests: RATE_LIMIT, windowSeconds: RATE_WINDOW_MS / 1000, note: "Best-effort per instance. Responses are CDN-cached for 5 minutes — cache on your side too." },
    endpoints: [
      { path: "/api/v1/schedule", params: { start: "YYYY-MM-DD (default today)", days: `1-${MAX_DAYS} (default 7)`, airType: "raw|sub|dub — omit for all", platform: "e.g. Crunchyroll", format: "TV|TV_SHORT|MOVIE|ONA|OVA|SPECIAL", includeAdult: "1 to include (default off)" } },
      { path: "/api/v1/anime/{anilistId}" },
      { path: "/api/v1/seasons/{season}/{year}", params: { season: "winter|spring|summer|fall" } },
      { path: "/api/v1/overrides", describes: "The raw correction document layered over AniList." },
    ],
  }, { maxAge: 3600 });
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
  const s = seasonOf(start.getUTCMonth()), y = start.getUTCFullYear();
  const targets = [shiftSeason(s, y, -1), { season: s, year: y }, shiftSeason(s, y, 1)];
  const seen = new Set(), media = [];
  for (const t of targets) {
    for (const md of await fetchSeason(t.season, t.year)) {
      if (seen.has(md.id)) continue;
      seen.add(md.id);
      media.push(md);
    }
  }

  const overrides = await loadOverrides();
  const episodes = [];
  for (const md of media) {
    if (!includeAdult && (md.isAdult || (md.genres || []).includes("Hentai"))) continue;
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

async function anime(id) {
  if (!/^\d+$/.test(id)) return fail(400, "id must be an AniList media id");
  let d;
  try { d = await anilist(ID_QUERY, { id: +id }); }
  catch (err) {
    if (err && err.notFound) return fail(404, "No anime with that id", "Ids are AniList media ids — check the title on anilist.co.");
    throw err;
  }
  if (!d.Media) return fail(404, "No anime with that id");
  const md = d.Media;
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

async function season(name, year) {
  const s = String(name || "").toUpperCase();
  if (!SEASONS.includes(s)) return fail(400, "season must be winter, spring, summer or fall");
  const y = parseInt(year, 10);
  if (!(y >= 1940 && y <= 2100)) return fail(400, "year is out of range");
  const media = await fetchSeason(s, y);
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
    if (!route.length) return describe();
    if (route[0] === "schedule" && route.length === 1) return await schedule(url);
    if (route[0] === "anime" && route.length === 2) return await anime(route[1]);
    if (route[0] === "seasons" && route.length === 3) return await season(route[1], route[2]);
    if (route[0] === "overrides" && route.length === 1) return json({ ok: true, ...(await loadOverrides()) });
    return fail(404, `Unknown endpoint /${route.join("/")}`, `See ${SITE}/api/ for the endpoint list.`);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    console.error("api error", url.pathname, err);
    return fail(status, String((err && err.message) || err),
      status === 503 ? "Upstream AniList rate limit — retry shortly." : undefined);
  }
};
