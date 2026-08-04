// Chat tool layer — the functions the assistant is allowed to call.
//
// This is the whole reason the chatbot is worth having. A raw model answers
// "when does episode 7 air?" from training data and gets it wrong with total
// confidence. These tools make it read the same corrected schedule the calendar
// renders: AniList's Japanese broadcast time with Tsuzuki's human correction
// layer (simulcast times, dub dates, delays, broadcast breaks) applied on top.
//
// Everything here is READ-ONLY and takes no user identity. A tool call is an
// anonymous public lookup — the same data /api/v1 already serves — so a prompt
// injection in a chat message can, at worst, make the model look something up.
//
// The AniList plumbing deliberately mirrors netlify/functions/api.mjs rather
// than importing it: api.mjs is a request handler with its own response shapes
// and rate limiter, and reaching into it would couple the public API's contract
// to the chatbot's. The duplicated part is ~40 lines of fetch + cache.
import { variantsFor, mergeOverrides, showOverride, loadSeed } from "./schedule-overrides.mjs";
import { getStore } from "@netlify/blobs";

const ANILIST = "https://graphql.anilist.co";
const SITE = "https://tsuzuki.netlify.app";

// Tool results are model input, so every field costs tokens on every subsequent
// turn of the loop. These caps keep a "what's airing this week" answer from
// spending the context window on 300 episode rows nobody asked about.
const MAX_SEARCH = 6;
const MAX_SEASON = 20;
const MAX_SCHEDULE_ROWS = 24;
const MAX_DAYS = 31;

// get_anime returns a window around *now* rather than a show's whole run: a
// 100-episode series would otherwise spend 20k characters of context on air
// dates from three years ago that nobody is asking about.
const PAST_EPISODES = 2;
const NEXT_EPISODES = 8;

// The synopsis is the single largest field in a get_anime result. Four hundred
// characters is enough to say what a show is; the rest is plot summary the user
// didn't ask for and the model pays for.
const SYNOPSIS_CHARS = 400;

const MEDIA_FIELDS = `
  id title { romaji english native } format episodes duration status season seasonYear
  genres averageScore popularity siteUrl description(asHtml:false)
  startDate { year month day } endDate { year month day }
  studios(isMain: true) { nodes { name } }
  externalLinks { site url type }
  airingSchedule { nodes { airingAt episode } }`;

const SEARCH_QUERY = `query($q:String,$page:Int,$perPage:Int){
  Page(page:$page,perPage:$perPage){ media(search:$q,type:ANIME,sort:SEARCH_MATCH){ ${MEDIA_FIELDS} } } }`;
const ID_QUERY = `query($id:Int){ Media(id:$id,type:ANIME){ ${MEDIA_FIELDS} } }`;
const SEASON_QUERY = `query($season:MediaSeason,$seasonYear:Int,$page:Int){
  Page(page:$page,perPage:50){ pageInfo{ hasNextPage } media(season:$season,seasonYear:$seasonYear,type:ANIME,sort:POPULARITY_DESC){ ${MEDIA_FIELDS} } } }`;

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
const seasonOf = m => (m <= 2 ? "WINTER" : m <= 5 ? "SPRING" : m <= 8 ? "SUMMER" : "FALL");

async function anilist(query, variables) {
  const res = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const j = await res.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

// Per-instance caches. A chat turn can fire three tool calls that all want the
// same season, and a warm instance serves many turns, so this is the difference
// between one upstream call and thirty.
let overridesCache = null, overridesAt = 0;
async function loadOverrides() {
  if (overridesCache && Date.now() - overridesAt < 60_000) return overridesCache;
  const seed = await loadSeed(SITE);
  let live = null;
  try { live = await getStore("schedule-overrides").get("live", { type: "json" }); } catch { /* seed-only is fine */ }
  overridesCache = mergeOverrides(seed, live);
  overridesAt = Date.now();
  return overridesCache;
}

const SEASON_TTL_MS = 10 * 60_000;
const seasonCache = new Map();
const inflight = new Map();
async function fetchSeason(season, year) {
  const key = `${season}-${year}`;
  const hit = seasonCache.get(key);
  if (hit && Date.now() - hit.at < SEASON_TTL_MS) return hit.media;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      let out = [], page = 1, more = true;
      while (more && page <= 3) {
        const d = await anilist(SEASON_QUERY, { season, seasonYear: year, page });
        out = out.concat(d.Page.media);
        more = d.Page.pageInfo.hasNextPage;
        page++;
      }
      seasonCache.set(key, { at: Date.now(), media: out });
      return out;
    } catch (err) {
      if (hit) return hit.media;      // stale beats failing the tool call
      throw err;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/* ---------- shaping ----------
   Prose, not JSON-for-machines: the consumer is a language model, and a compact
   labelled line costs fewer tokens than the equivalent nested object while being
   easier for it to quote accurately. */

const titleOf = md => md.title.english || md.title.romaji || "Untitled";
const iso = ts => new Date(ts * 1000).toISOString().replace(".000", "");

// Drop keys carrying no information. A schedule row is repeated up to sixty
// times in one tool result, so `"note":null,"estimated":false` on every row is
// pure token cost — and their absence reads to the model exactly as their
// falsy presence would.
const compact = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === false) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
};

function briefMedia(md) {
  const studios = ((md.studios && md.studios.nodes) || []).map(s => s.name);
  const streams = (md.externalLinks || []).filter(l => l && l.type === "STREAMING" && l.site).map(l => l.site);
  return compact({
    anilistId: md.id,
    title: titleOf(md),
    // Romaji only. The native title is CJK, which tokenises at roughly one token
    // per character — the most expensive field per unit of usefulness here, and
    // the model never needs it to answer a question.
    altTitle: md.title.romaji && md.title.romaji !== titleOf(md) ? md.title.romaji : null,
    format: md.format,
    status: md.status,
    season: md.season && md.seasonYear ? `${md.season} ${md.seasonYear}` : null,
    episodes: md.episodes,
    genres: (md.genres || []).slice(0, 3),
    score: md.averageScore,
    studios: studios.slice(0, 2),
    streamingOn: [...new Set(streams)].slice(0, 4),
    // No per-row URL. The link is derivable from anilistId, and the system
    // prompt states the one valid pattern — repeating a 48-character URL on
    // every result costs more than the rule does, and schedule rows (which
    // never carried it) were making the model invent a path that 404s.
  });
}

// Schedule rows go out compacted and without the sort key.
const shipRow = ({ unix, ...rest }) => compact(rest);

// One AniList airing node -> the release variants that actually exist for it,
// with corrections applied. `estimated` is carried through verbatim because the
// model is instructed to repeat that qualifier rather than launder it away.
function episodeLines(md, node, override) {
  const { status, variants } = variantsFor(md, node, override);
  if (!variants.length) {
    return [{
      episode: node.episode,
      onBreak: true,
      note: status ? (status.reason || status.kind) : "no episode this slot",
    }];
  }
  return variants.map(v => ({
    episode: node.episode,
    airType: v.type,                       // raw = JP broadcast, sub = subtitled, dub = English dub
    airsAtUtc: iso(v.ts),
    unix: v.ts,
    platform: v.platform || null,
    estimated: !!v.estimated,
    note: status ? `${status.kind}: ${status.reason || ""}`.trim() : null,
  }));
}

function scheduleFor(md, override, fromTs, toTs, airType) {
  const nodes = ((md.airingSchedule && md.airingSchedule.nodes) || [])
    .filter(n => n.airingAt >= fromTs - 86400 && n.airingAt <= toTs + 86400);
  const rows = [];
  for (const n of nodes) {
    for (const e of episodeLines(md, n, override)) {
      if (e.onBreak) { rows.push(e); continue; }
      if (airType && airType !== "any" && e.airType !== airType) continue;
      if (e.unix < fromTs || e.unix > toTs) continue;
      rows.push(e);
    }
  }
  return rows;
}

/* ---------- tool declarations ----------
   Provider-neutral: { name, description, parameters }. chat.mjs wraps these in
   whatever envelope its provider wants, so swapping model vendors doesn't touch
   this file.

   Descriptions are written for the model, and they carry the domain rules it
   cannot infer — chiefly that "when does it air" is three different questions
   (JP broadcast / simulcast / dub) with three different answers. */

const AIR_TYPE = { type: "string", enum: ["any", "raw", "sub", "dub"], description: "raw=JP broadcast, sub=simulcast, dub=English dub." };

export const TOOL_DECLARATIONS = [
  {
    name: "search_anime",
    description: "Find an anime by title; returns anilistId, format, status, season, episode count, studios, score, streaming platforms. Use first whenever a show is named.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Title or partial title." },
        limit: { type: "integer", description: `1-${MAX_SEARCH}, default 3.` },
      },
      required: ["query"],
    },
  },
  {
    name: "get_anime",
    description: "One show in detail plus its corrected episode schedule around today, with synopsis. Use after search_anime for air dates, delays, breaks or streaming.",
    parameters: {
      type: "object",
      properties: {
        anilistId: { type: "integer", description: "From search_anime." },
        airType: AIR_TYPE,
      },
      required: ["anilistId"],
    },
  },
  {
    name: "get_schedule",
    description: "Episodes airing across a date window, in time order. For 'what airs today / this week / on Friday'.",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD, default today." },
        days: { type: "integer", description: `1-${MAX_DAYS}, default 7.` },
        airType: AIR_TYPE,
      },
      required: [],
    },
  },
  {
    name: "get_season",
    description: "One season's lineup, most popular first. For browsing or 'what's on next season'.",
    parameters: {
      type: "object",
      properties: {
        season: { type: "string", enum: ["WINTER", "SPRING", "SUMMER", "FALL"], description: "Default current." },
        year: { type: "integer", description: "Default current." },
        limit: { type: "integer", description: `1-${MAX_SEASON}, default 10.` },
      },
      required: [],
    },
  },
];

/* ---------- executors ---------- */

const clamp = (n, lo, hi, dflt) => {
  const v = Number.isFinite(n) ? Math.floor(n) : dflt;
  return Math.min(hi, Math.max(lo, v));
};

async function searchAnime({ query, limit }) {
  if (!query || !String(query).trim()) return { error: "query is required" };
  const perPage = clamp(limit, 1, MAX_SEARCH, 3);
  const d = await anilist(SEARCH_QUERY, { q: String(query).slice(0, 120), page: 1, perPage });
  const media = (d.Page && d.Page.media) || [];
  if (!media.length) return { results: [], note: "No match on Tsuzuki. The title may be a manga, a live-action work, or too new to be listed — say so rather than guessing, or use web search." };
  return { results: media.map(briefMedia) };
}

async function getAnime({ anilistId, airType }) {
  const id = Number(anilistId);
  if (!Number.isFinite(id)) return { error: "anilistId must be a number" };
  const d = await anilist(ID_QUERY, { id });
  const md = d.Media;
  if (!md) return { error: "No anime with that id" };

  const overrides = await loadOverrides();
  const ov = showOverride(overrides, md.id);
  const nodes = ((md.airingSchedule && md.airingSchedule.nodes) || []).sort((a, b) => a.airingAt - b.airingAt);

  const rows = [];
  for (const n of nodes) {
    for (const e of episodeLines(md, n, ov)) {
      if (!e.onBreak && airType && airType !== "any" && e.airType !== airType) continue;
      rows.push(e);
    }
  }

  // Centre the window on now, keeping a little history for "did episode 5
  // already air?" and enough of the future for "when do the rest land?".
  const nowTs = Math.floor(Date.now() / 1000);
  const pivot = rows.findIndex(r => !r.onBreak && r.unix > nowTs);
  const cut = pivot === -1 ? Math.max(0, rows.length - PAST_EPISODES) : Math.max(0, pivot - PAST_EPISODES);
  const windowed = rows.slice(cut, cut + PAST_EPISODES + NEXT_EPISODES).slice(0, MAX_SCHEDULE_ROWS);

  const desc = (md.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return compact({
    ...briefMedia(md),
    startDate: md.startDate, endDate: md.endDate,
    episodeDurationMin: md.duration,
    synopsis: desc.slice(0, SYNOPSIS_CHARS),
    hasCorrections: !!ov,
    totalScheduledEpisodes: rows.length,
    schedule: windowed.map(shipRow),
    scheduleNote: "Window around today, not the full run. estimated:true = derived from the broadcast slot, not confirmed.",
  });
}

async function getSchedule({ startDate, days, airType }) {
  const now = new Date();
  const start = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? new Date(`${startDate}T00:00:00Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (Number.isNaN(start.getTime())) return { error: "startDate must be YYYY-MM-DD" };

  const span = clamp(days, 1, MAX_DAYS, 7);
  const fromTs = Math.floor(start.getTime() / 1000);
  const toTs = fromTs + span * 86400;
  const want = airType || "sub";

  // A window can straddle a season boundary, and shows carry over, so pull the
  // season the window starts in plus its neighbours.
  const sm = start.getUTCMonth(), sy = start.getUTCFullYear();
  const base = SEASONS.indexOf(seasonOf(sm));
  const wanted = new Set();
  for (const delta of [-1, 0, 1]) {
    let i = base + delta, year = sy;
    if (i < 0) { i = 3; year--; }
    if (i > 3) { i = 0; year++; }
    wanted.add(`${SEASONS[i]}|${year}`);
  }

  const overrides = await loadOverrides();
  const seasons = await Promise.all([...wanted].map(k => {
    const [s, y] = k.split("|");
    return fetchSeason(s, Number(y)).catch(() => []);
  }));

  const out = [];
  const seen = new Set();
  for (const media of seasons) {
    for (const md of media) {
      if (seen.has(md.id)) continue;
      seen.add(md.id);
      const rows = scheduleFor(md, showOverride(overrides, md.id), fromTs, toTs, want);
      for (const r of rows) {
        if (r.onBreak) continue;
        out.push({ title: titleOf(md), anilistId: md.id, ...r });
      }
    }
  }
  out.sort((a, b) => a.unix - b.unix);

  return compact({
    window: { from: iso(fromTs), to: iso(toTs), days: span, airType: want },
    count: out.length,
    episodes: out.slice(0, MAX_SCHEDULE_ROWS).map(shipRow),
    truncated: out.length > MAX_SCHEDULE_ROWS,
  });
}

async function getSeason({ season, year, limit }) {
  const now = new Date();
  const s = SEASONS.includes(String(season || "").toUpperCase())
    ? String(season).toUpperCase()
    : seasonOf(now.getUTCMonth());
  const y = Number.isFinite(Number(year)) ? Number(year) : now.getUTCFullYear();
  if (y < 1960 || y > 2100) return { error: "year out of range" };

  const media = await fetchSeason(s, y);
  const n = clamp(limit, 1, MAX_SEASON, 10);
  return {
    season: `${s} ${y}`,
    total: media.length,
    titles: media.slice(0, n).map(briefMedia),
    seasonUrl: `${SITE}/${s.toLowerCase()}-${y}/`,
  };
}

const EXECUTORS = {
  search_anime: searchAnime,
  get_anime: getAnime,
  get_schedule: getSchedule,
  get_season: getSeason,
};

// A tool that throws must not kill the turn — the model handles "this lookup
// failed" gracefully and can fall back to web search, but an exception here
// would drop the whole SSE stream on the user's head.
export async function runTool(name, args) {
  const fn = EXECUTORS[name];
  if (!fn) return { error: `Unknown tool "${name}"` };
  try {
    return await fn(args || {});
  } catch (err) {
    console.warn(`chat tool ${name} failed:`, err.message);
    return { error: `Lookup failed: ${err.message}. Do not guess the answer — say the data is unavailable, or try web search.` };
  }
}

// Short label the widget shows while a tool runs, so a five-second lookup reads
// as progress rather than a hang.
export function toolLabel(name, args) {
  const a = args || {};
  switch (name) {
    case "search_anime": return `Searching Tsuzuki for “${String(a.query || "").slice(0, 40)}”`;
    case "get_anime": return "Reading the corrected schedule";
    case "get_schedule": return "Checking the calendar";
    case "get_season": return `Loading the ${String(a.season || "current").toLowerCase()} lineup`;
    case "web_search": return "Searching the web";       // executed in chat.mjs, not by runTool
    default: return "Looking that up";
  }
}
