// The catalog — where schedule data comes from *before* AniList.
//
// Everything used to call AniList directly: the browser on every launch, the
// public API on every request, the push worker every 15 minutes. AniList is one
// upstream on a degraded ~30 req/min budget, so that design made the whole site
// as available as AniList is, and spent that budget on work we had already done
// minutes earlier.
//
// This module inverts it. A read resolves through three tiers:
//
//   1. per-instance memory   (MEM_TTL_MS)  — free, survives a warm container
//   2. Netlify Blobs snapshot (SNAPSHOT_TTL_MS) — shared by every instance and
//      every visitor; written by the ingest worker (functions/ingest.mjs) and,
//      on a miss, by whoever paid for the upstream call
//   3. AniList — last resort, and the result is written back to tier 2
//
// So AniList is touched on a cold miss and by one scheduled worker, instead of
// once per visitor. Every tier is allowed to fail: a Blobs outage degrades to
// "same as before", not to an error.
//
// Tier 2 is deliberately stored in AniList's own response shape rather than the
// canonical ingest schema. The consumers (api.mjs, push-send.mjs, the browser)
// all speak that shape already, and variantsFor() reads `externalLinks` off it
// — normalizing here would mean translating back at every call site.

import { getStore } from "@netlify/blobs";
import { collectSeasonless } from "./seasonless.mjs";

export const ANILIST = "https://graphql.anilist.co";

// One field list, used by every tier so a snapshot is interchangeable with a
// live AniList response. It is the union of what api.mjs shapes, what the push
// worker needs (title/cover/externalLinks/airingSchedule) and what the browser
// renders — `relations` carries month/day because the franchise timeline sorts
// on the real date, not just the year.
export const MEDIA_FIELDS = `
  id title { romaji english native } format episodes duration genres status
  popularity trending averageScore source isAdult countryOfOrigin season seasonYear siteUrl
  tags { name rank isMediaSpoiler isAdult }
  description(asHtml: false) trailer { id site }
  externalLinks { site url type color icon }
  coverImage { medium large color } bannerImage
  startDate { year month day } endDate { year month day }
  studios(isMain: true) { nodes { name } }
  relations { edges { relationType(version: 2) node { id type format title { romaji english native } coverImage { medium } startDate { year month day } } } }
  airingSchedule { nodes { airingAt episode } }`;

const SEASON_QUERY = `query($season:MediaSeason,$seasonYear:Int,$page:Int){
  Page(page:$page,perPage:50){ pageInfo{ hasNextPage } media(season:$season,seasonYear:$seasonYear,type:ANIME,sort:POPULARITY_DESC){ ${MEDIA_FIELDS} } } }`;
const ID_QUERY = `query($id:Int){ Media(id:$id,type:ANIME){ ${MEDIA_FIELDS} } }`;
const IDS_QUERY = `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids,type:ANIME){ ${MEDIA_FIELDS} } } }`;

export const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
export const seasonOf = month0 => (month0 <= 2 ? "WINTER" : month0 <= 5 ? "SPRING" : month0 <= 8 ? "SUMMER" : "FALL");
export function shiftSeason(season, year, delta) {
  let i = SEASONS.indexOf(season) + delta;
  year += Math.floor(i / 4);
  i = ((i % 4) + 4) % 4;
  return { season: SEASONS[i], year };
}
export const seasonKey = (season, year) => `${String(season).toUpperCase()}-${year}`;

export const SEASON_STORE = "catalog-seasons";
export const MEDIA_STORE = "catalog-media";
// Reserved key in SEASON_STORE for the seasonless set. Not a real season, but it
// is cached, aged and served exactly like one, so it shares the store.
export const SEASONLESS_KEY = "SEASONLESS";

const MEM_TTL_MS = 10 * 60_000;
const SNAPSHOT_TTL_MS = 6 * 3600_000;    // matches the ingest worker's cadence
const MAX_PAGES = 3;                     // 150 titles — a full season with room to spare

const mem = new Map();        // key -> { at, value }
const inflight = new Map();   // key -> Promise, so a cold start doesn't stampede

function memGet(key, ttl = MEM_TTL_MS) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  return null;
}
function memSet(key, value) {
  if (mem.size > 200) mem.clear();
  mem.set(key, { at: Date.now(), value });
  return value;
}
// Collapse concurrent callers for the same key onto one upstream fetch.
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => { try { return await fn(); } finally { inflight.delete(key); } })();
  inflight.set(key, p);
  return p;
}

// Blobs is a cache here, never a dependency: every read and write is allowed to
// fail silently so a store outage costs speed, not correctness.
function store(name) {
  try { return getStore(name); } catch (err) { console.warn(`catalog: store ${name} unavailable —`, err.message); return null; }
}
async function blobGet(name, key) {
  const s = store(name);
  if (!s) return null;
  try { return await s.get(key, { type: "json" }); } catch (err) { console.warn(`catalog: read ${name}/${key} failed —`, err.message); return null; }
}
async function blobPut(name, key, value) {
  const s = store(name);
  if (!s) return false;
  try { await s.setJSON(key, value); return true; } catch (err) { console.warn(`catalog: write ${name}/${key} failed —`, err.message); return false; }
}

/* ---------- AniList (tier 3) ---------- */

export async function anilist(query, variables) {
  const res = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) { const e = new Error("Upstream rate limit"); e.status = 503; throw e; }
  if (res.status === 404) { const e = new Error("Not found"); e.status = 404; e.notFound = true; throw e; }
  if (!res.ok) { const e = new Error("AniList HTTP " + res.status); e.status = 502; throw e; }
  const j = await res.json();
  // A GraphQL error can arrive alongside a 200 and a null data block — treating
  // `data` as present would turn that into a TypeError further down.
  if (j.errors && j.errors.length) { const e = new Error(j.errors[0].message); e.status = 502; e.notFound = j.errors[0].status === 404; throw e; }
  if (!j.data) { const e = new Error("AniList returned no data"); e.status = 502; throw e; }
  return j.data;
}

export async function fetchSeasonFromAniList(season, year, maxPages = MAX_PAGES) {
  let out = [], page = 1, more = true;
  while (more && page <= maxPages) {
    const d = await anilist(SEASON_QUERY, { season, seasonYear: year, page });
    out = out.concat((d.Page && d.Page.media) || []);
    more = !!(d.Page && d.Page.pageInfo && d.Page.pageInfo.hasNextPage);
    page++;
  }
  return out;
}

/* ---------- seasonless-but-airing ---------- */

// Titles AniList assigned no season, which no season query can reach. The query,
// the filter and the page budget live in _lib/seasonless.mjs so the API, the
// ingest worker, the SEO build, the bots and the offset scraper all share one
// definition — see that file for why this exists.
export async function fetchSeasonlessFromAniList(maxPages) {
  return collectSeasonless(
    async (query, variables) => ({ data: await anilist(query, variables) }),
    MEDIA_FIELDS,
    maxPages ? { maxPages } : {},
  );
}

// Store the seasonless snapshot. Called by the ingest worker and by whichever
// request paid for a cold fetch — the mirror of putSeason.
export async function putSeasonless(media, source = "anilist") {
  const snapshot = { season: null, year: null, seasonless: true, fetchedAt: Date.now(), source, count: media.length, media };
  memSet(`season:${SEASONLESS_KEY}`, snapshot);
  await blobPut(SEASON_STORE, SEASONLESS_KEY, snapshot);
  return snapshot;
}

// Cached exactly like a season, so it inherits the same snapshot TTL, the same
// collapse-concurrent-misses behaviour and the same stale-beats-broken fallback.
// `allowNetwork:false` returns whatever is stored regardless of age (or null) —
// that is how the ingest worker checks whether this set owes a refresh.
export async function getSeasonless({ allowNetwork = true, maxAgeMs = SNAPSHOT_TTL_MS } = {}) {
  const memKey = `season:${SEASONLESS_KEY}`;
  const hit = memGet(memKey);
  if (hit) return hit;

  return once(memKey, async () => {
    const snap = await blobGet(SEASON_STORE, SEASONLESS_KEY);
    if (snap && snap.media && Date.now() - (snap.fetchedAt || 0) < maxAgeMs) return memSet(memKey, snap);
    if (!allowNetwork) return snap && snap.media ? memSet(memKey, snap) : null;

    try {
      return await putSeasonless(await fetchSeasonlessFromAniList(), "anilist");
    } catch (err) {
      if (snap && snap.media) { console.warn(`catalog: serving stale ${SEASONLESS_KEY} — ${err.message}`); return memSet(memKey, snap); }
      throw err;
    }
  });
}

/* ---------- season reads ---------- */

// Store a season snapshot. Called by the ingest worker and by whichever request
// paid for a cold AniList fetch.
//
// `writeMedia` fans the same pull out into per-title blobs so single-title
// lookups (`/api/v1/anime/<id>`, the push worker) hit storage instead of
// AniList. It is off by default because 150 blob writes is the slowest thing
// this module does, and a request that was only asked for a season shouldn't
// pay for it — the per-title path caches itself on first use anyway.
export async function putSeason(season, year, media, source = "anilist", { writeMedia = false } = {}) {
  const key = seasonKey(season, year);
  const snapshot = { season: String(season).toUpperCase(), year: +year, fetchedAt: Date.now(), source, count: media.length, media };
  memSet(`season:${key}`, snapshot);
  await blobPut(SEASON_STORE, key, snapshot);
  if (writeMedia) {
    const at = Date.now();
    for (let i = 0; i < media.length; i += 20) {
      await Promise.all(media.slice(i, i + 20).map(md => blobPut(MEDIA_STORE, String(md.id), { fetchedAt: at, source, media: md })));
    }
  }
  return snapshot;
}

// A season's media list. `allowNetwork:false` returns whatever is cached and
// null otherwise — for callers that would rather serve less than call upstream.
export async function getSeason(season, year, { allowNetwork = true, maxAgeMs = SNAPSHOT_TTL_MS } = {}) {
  const key = seasonKey(season, year);
  const hit = memGet(`season:${key}`);
  if (hit) return hit;

  return once(`season:${key}`, async () => {
    const snap = await blobGet(SEASON_STORE, key);
    if (snap && snap.media && Date.now() - (snap.fetchedAt || 0) < maxAgeMs) return memSet(`season:${key}`, snap);
    if (!allowNetwork) return snap && snap.media ? memSet(`season:${key}`, snap) : null;

    try {
      const media = await fetchSeasonFromAniList(season, year);
      return await putSeason(season, year, media, "anilist");
    } catch (err) {
      // Stale beats broken: an expired snapshot is a far better answer than a
      // 503 while AniList is rate-limiting us.
      if (snap && snap.media) { console.warn(`catalog: serving stale ${key} — ${err.message}`); return memSet(`season:${key}`, snap); }
      throw err;
    }
  });
}

// The three seasons a date window can touch, de-duplicated by media id.
export async function getSeasonWindow(season, year, opts = {}) {
  const targets = [shiftSeason(season, year, -1), { season, year }, shiftSeason(season, year, 1)];
  const seen = new Set(), media = [];
  for (const t of targets) {
    let snap = null;
    try { snap = await getSeason(t.season, t.year, opts); }
    catch (err) {
      // One missing neighbour season must not fail the window — the middle
      // season is the one the caller actually asked about.
      if (t.season === season && t.year === year) throw err;
      console.warn(`catalog: season ${seasonKey(t.season, t.year)} unavailable — ${err.message}`);
    }
    for (const md of (snap && snap.media) || []) {
      if (seen.has(md.id)) continue;
      seen.add(md.id);
      media.push(md);
    }
  }

  // A seasonless title with episodes in this window belongs in it by definition
  // — the window is a date range, and the show is airing inside it. Never fatal:
  // if this set can't be reached the window is still correct for everything
  // AniList did assign a season to, which is how it behaved before.
  try {
    const extra = await getSeasonless(opts);
    for (const md of (extra && extra.media) || []) {
      if (seen.has(md.id)) continue;
      seen.add(md.id);
      media.push(md);
    }
  } catch (err) {
    console.warn(`catalog: seasonless set unavailable — ${err.message}`);
  }

  return media;
}

/* ---------- single-title reads ---------- */

export async function getMediaById(id, { allowNetwork = true, maxAgeMs = SNAPSHOT_TTL_MS } = {}) {
  const key = String(id);
  const hit = memGet(`media:${key}`);
  if (hit) return hit;

  return once(`media:${key}`, async () => {
    const rec = await blobGet(MEDIA_STORE, key);
    if (rec && rec.media && Date.now() - (rec.fetchedAt || 0) < maxAgeMs) return memSet(`media:${key}`, rec.media);
    if (!allowNetwork) return rec && rec.media ? memSet(`media:${key}`, rec.media) : null;

    try {
      const d = await anilist(ID_QUERY, { id: +id });
      if (!d.Media) return null;
      await blobPut(MEDIA_STORE, key, { fetchedAt: Date.now(), source: "anilist", media: d.Media });
      return memSet(`media:${key}`, d.Media);
    } catch (err) {
      if (rec && rec.media) { console.warn(`catalog: serving stale media ${key} — ${err.message}`); return memSet(`media:${key}`, rec.media); }
      throw err;
    }
  });
}

// Bulk lookup for the push worker: serve everything the catalog already knows,
// then fetch only the ids it doesn't (50 per AniList request). Returns a Map so
// a partial upstream failure still delivers the titles we did resolve.
export async function getManyById(ids, { allowNetwork = true, maxAgeMs = SNAPSHOT_TTL_MS } = {}) {
  const out = new Map();
  const missing = [];
  for (const raw of ids) {
    const id = +raw;
    if (!Number.isFinite(id) || out.has(id)) continue;
    const cached = memGet(`media:${id}`) || (await blobGet(MEDIA_STORE, String(id)).then(r => (r && r.media && Date.now() - (r.fetchedAt || 0) < maxAgeMs ? r.media : null)));
    if (cached) { out.set(id, memSet(`media:${id}`, cached)); continue; }
    missing.push(id);
  }
  if (!missing.length || !allowNetwork) return out;

  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      const d = await anilist(IDS_QUERY, { ids: chunk });
      for (const md of (d.Page && d.Page.media) || []) {
        out.set(md.id, memSet(`media:${md.id}`, md));
        await blobPut(MEDIA_STORE, String(md.id), { fetchedAt: Date.now(), source: "anilist", media: md });
      }
    } catch (err) {
      console.warn("catalog: bulk id fetch failed —", err.message);
      // Fall back to any stale copy rather than dropping the show entirely.
      for (const id of chunk) {
        const rec = await blobGet(MEDIA_STORE, String(id));
        if (rec && rec.media) out.set(id, rec.media);
      }
    }
  }
  return out;
}

/* ---------- lazily-loaded detail (cast, studio, "on this day") ---------- */

// These three were the last things the browser still asked AniList for
// directly: one request per modal open, per visitor, for data that is the same
// for everyone and barely changes. Cached here they cost one upstream call
// each, ever, and the app's detail pane keeps working through an AniList
// outage like the rest of it.
const EXTRAS_STORE = "catalog-extras", STUDIO_STORE = "catalog-studio", OTD_STORE = "catalog-otd";
const DETAIL_TTL_MS = 7 * 24 * 3600_000;

const EXTRAS_QUERY = `query($id:Int){ Media(id:$id,type:ANIME){
  characters(sort:[ROLE,RELEVANCE],perPage:12){ edges{ role node{ id name{ full } image{ medium } } voiceActors(language:JAPANESE,sort:RELEVANCE){ id name{ full } } } }
  recommendations(sort:RATING_DESC,perPage:10){ nodes{ mediaRecommendation{ id title{ romaji english native } coverImage{ medium } format averageScore isAdult } } }
  studios(isMain:true){ nodes{ id name } }
} }`;
const STUDIO_QUERY = `query($id:Int){ Studio(id:$id){
  name media(sort:POPULARITY_DESC,perPage:13,isMain:true){ nodes{ id title{ romaji english native } coverImage{ medium } format averageScore isAdult } }
} }`;
const OTD_QUERY = `query($d:String){ Page(perPage:25){ media(type:ANIME,startDate_like:$d,sort:POPULARITY_DESC){
  id title{ romaji english native } coverImage{ medium } startDate{ year month day } isAdult format
} } }`;

// Cache-through for a fixed query: memory, blob, upstream — and a stale copy
// rather than an error if upstream is unreachable.
async function cachedQuery(name, key, query, variables, pick, ttlMs = DETAIL_TTL_MS) {
  const memoKey = `${name}:${key}`;
  const memo = memGet(memoKey, ttlMs);
  if (memo !== null) return memo;

  return once(memoKey, async () => {
    const rec = await blobGet(name, key);
    if (rec && rec.data !== undefined && Date.now() - (rec.fetchedAt || 0) < ttlMs) return memSet(memoKey, rec.data);
    try {
      const data = pick(await anilist(query, variables));
      await blobPut(name, key, { fetchedAt: Date.now(), data });
      return memSet(memoKey, data);
    } catch (err) {
      if (rec && rec.data !== undefined) { console.warn(`catalog: serving stale ${name}/${key} — ${err.message}`); return memSet(memoKey, rec.data); }
      throw err;
    }
  });
}

// Characters + voice cast, recommendations and the main studio, for one title.
export const getExtras = id => cachedQuery(EXTRAS_STORE, String(id), EXTRAS_QUERY, { id: +id }, d => d.Media || null);
// A studio's most popular titles.
export const getStudio = id => cachedQuery(STUDIO_STORE, String(id), STUDIO_QUERY, { id: +id }, d => d.Studio || null);
// Anime that premiered on a given MMDD in past years. Identical for every
// visitor on a given day, which makes it the best cache candidate of the three.
export const getOnThisDay = mmdd => cachedQuery(OTD_STORE, mmdd, OTD_QUERY, { d: "%" + mmdd }, d => (d.Page && d.Page.media) || []);

/* ---------- franchise graph ---------- */

// AniList only ever hands you a title's *direct* relations, so "the franchise"
// read one hop deep stops at whatever the current entry happens to link to: open
// season 3 and you get seasons 2 and 4, never season 1, never the movie hanging
// off season 1. Walking the graph is the only way to get the whole thing.
//
// Edges that mean "same franchise". CHARACTER is deliberately absent: it links
// anything two shows share a cast member with, which drags in whole unrelated
// series. ADAPTATION/SOURCE point at manga and novels, which the ANIME filter
// drops anyway.
const FRANCHISE_INCLUDE = new Set(["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "COMPILATION", "CONTAINS", "OTHER"]);
// Followed outward when expanding. Narrower than the include set: an OTHER edge
// is worth showing but not worth traversing, since it is where AniList puts
// links that don't fit anywhere else and it can wander into another franchise.
const FRANCHISE_TRAVERSE = new Set(["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "COMPILATION", "CONTAINS"]);

export const FRANCHISE_STORE = "catalog-franchise";
const FRANCHISE_TTL_MS = 24 * 3600_000;
// A walk that stopped at a bound is a worse answer than one that finished, so
// it gets a short lease — long enough to stop a hot title re-walking the graph
// on every open, short enough that a warm catalog completes it soon after.
const FRANCHISE_PARTIAL_TTL_MS = 60 * 60_000;

const franchiseNode = (md, relation, depth) => ({
  id: md.id,
  title: md.title || {},
  format: md.format || null,
  status: md.status || null,
  episodes: md.episodes ?? null,
  // null, not false, when the node came from a relation edge — the edge shape
  // has no isAdult field, and "unknown" must not read as "safe".
  isAdult: typeof md.isAdult === "boolean" ? md.isAdult : null,
  coverImage: md.coverImage ? { medium: md.coverImage.medium || null } : null,
  startDate: md.startDate || null,
  relation: relation || null,
  depth,
});

// Breadth-first walk of the relation graph from one title. Bounded on every
// axis — node count, depth, and wall clock — because a franchise like Gundam is
// effectively unbounded and this runs inside a request.
export async function getFranchise(rootId, { maxNodes = 80, maxDepth = 8, budgetMs = 6_000 } = {}) {
  const key = String(rootId);
  const ttlOf = r => (r && r.truncated ? FRANCHISE_PARTIAL_TTL_MS : FRANCHISE_TTL_MS);
  const memo = memGet(`franchise:${key}`, FRANCHISE_TTL_MS);
  if (memo && Date.now() - (memo.fetchedAt || 0) < ttlOf(memo)) return memo;

  return once(`franchise:${key}`, async () => {
    const cached = await blobGet(FRANCHISE_STORE, key);
    if (cached && cached.nodes && Date.now() - (cached.fetchedAt || 0) < ttlOf(cached)) return memSet(`franchise:${key}`, cached);

    const startedAt = Date.now();
    const root = await getMediaById(rootId);
    if (!root) return null;

    const nodes = new Map([[root.id, franchiseNode(root, null, 0)]]);
    const expanded = new Set([root.id]);
    let frontier = [root], depth = 0, truncated = false;

    while (frontier.length && depth < maxDepth) {
      if (nodes.size >= maxNodes || Date.now() - startedAt > budgetMs) { truncated = true; break; }
      const toExpand = [];
      for (const md of frontier) {
        for (const edge of (md.relations && md.relations.edges) || []) {
          const n = edge && edge.node;
          if (!n || n.type !== "ANIME" || !FRANCHISE_INCLUDE.has(edge.relationType)) continue;
          if (!nodes.has(n.id)) {
            if (nodes.size >= maxNodes) { truncated = true; break; }
            nodes.set(n.id, franchiseNode(n, edge.relationType, depth + 1));
          }
          if (FRANCHISE_TRAVERSE.has(edge.relationType) && !expanded.has(n.id)) toExpand.push(n.id);
        }
      }
      if (!toExpand.length) break;

      // One batched lookup per level, catalog-cached, so a deep franchise costs
      // a handful of upstream calls the first time and none after that.
      const ids = [...new Set(toExpand)].slice(0, maxNodes);
      ids.forEach(id => expanded.add(id));
      let fetched;
      try { fetched = await getManyById(ids); }
      catch (err) { console.warn("catalog: franchise expansion failed —", err.message); truncated = true; break; }

      frontier = [];
      for (const md of fetched.values()) {
        // A node first seen as a bare relation edge carries only what the edge
        // exposed; the full record fills in the rest without losing the
        // relation label that placed it here.
        const prev = nodes.get(md.id);
        nodes.set(md.id, { ...franchiseNode(md, prev && prev.relation, prev ? prev.depth : depth + 1) });
        frontier.push(md);
      }
      depth++;
    }

    const result = { rootId: root.id, fetchedAt: Date.now(), truncated, nodes: [...nodes.values()] };
    memSet(`franchise:${key}`, result);
    await blobPut(FRANCHISE_STORE, key, result);
    return result;
  });
}

// What the catalog can answer from its own storage right now — surfaced by
// /api/v1 and /api/ingest/status so "are we still leaning on AniList?" is a
// question with an answer.
export async function catalogHealth(seasons) {
  const out = [];
  for (const { season, year } of seasons) {
    const key = seasonKey(season, year);
    const snap = memGet(`season:${key}`, SNAPSHOT_TTL_MS) || await blobGet(SEASON_STORE, key);
    out.push({
      season: key,
      cached: !!(snap && snap.media),
      count: (snap && snap.count) || 0,
      ageSeconds: snap && snap.fetchedAt ? Math.round((Date.now() - snap.fetchedAt) / 1000) : null,
      stale: !!(snap && snap.fetchedAt && Date.now() - snap.fetchedAt > SNAPSHOT_TTL_MS),
    });
  }
  return out;
}
