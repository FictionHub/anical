// Discovery reads — the show page, similar shows, hidden gems, browse by tag /
// studio / staff, and operator search — served through the catalog cache.
//
// These shipped in v5.0 calling AniList straight from the browser. That was the
// pattern catalog.mjs exists to undo: every visitor spent their own requests on
// data that is identical for everyone, a busy page (a show page opening its
// similar list, a studio page loading more) could burn through AniList's ~30/min
// on its own, and a rate-limited visitor got an error page instead of the copy
// someone else fetched a minute ago. Routed through here, one cold miss pays for
// every visitor after it, and an upstream 429 serves the last good copy.
//
// The browser still falls back to AniList directly when this API can't answer —
// that path is the visitor's own budget rather than ours, which is exactly when
// it is worth spending.
//
// Every input is validated against a closed set before it becomes a cache key.
// A key built from arbitrary query parameters would let anyone fill the Blobs
// store by varying them; the only free-text reads (name searches) stay in
// memory and are never persisted.

import { anilist, cached, getMediaById } from "./catalog.mjs";

const DAY = 24 * 3600_000;

// Card weight, matching CARD_FIELDS in site/app.js — tags and studios stay in
// because the client ranks and predicts from them.
export const CARD_FIELDS = `id type title { romaji english native } synonyms format episodes duration genres status popularity averageScore source isAdult countryOfOrigin
  tags { name rank isMediaSpoiler isAdult } coverImage { medium large color } startDate { year month day } seasonYear
  studios(isMain: true) { nodes { id name } }`;
const FULL_FIELDS = `id title { romaji english native } synonyms format episodes genres status popularity trending averageScore source isAdult countryOfOrigin tags { name rank isMediaSpoiler isAdult }
  description(asHtml: false) siteUrl trailer { id site }
  externalLinks { site url type color icon }
  coverImage { medium large color }
  startDate { year month day }
  season seasonYear
  studios(isMain: true) { nodes { name } }
  relations { edges { relationType(version: 2) node { id type format title { romaji english native } coverImage { medium } startDate { year month day } } } }
  airingSchedule { nodes { airingAt episode } }`;

export const GENRES = ["Action","Adventure","Comedy","Drama","Ecchi","Fantasy","Hentai","Horror","Mahou Shoujo","Mecha","Music",
  "Mystery","Psychological","Romance","Sci-Fi","Slice of Life","Sports","Supernatural","Thriller"];
// AniList answers an empty page for genre_in containing Ecchi once isAdult:false
// is set, so gems never send it (see GEM_SKIP_GENRES in site/app.js).
const GEM_GENRES = new Set(GENRES.filter(g => g !== "Ecchi" && g !== "Hentai"));
export const GEM_CEILINGS = [1500, 4000, 10000, 25000, 60000];
const FORMATS = new Set(["TV","TV_SHORT","MOVIE","SPECIAL","OVA","ONA","MUSIC"]);
const STATUSES = new Set(["RELEASING","FINISHED","NOT_YET_RELEASED","CANCELLED","HIATUS"]);
const BROWSE_SORTS = { popular:["POPULARITY_DESC"], score:["SCORE_DESC","POPULARITY_DESC"], newest:["START_DATE_DESC"], trending:["TRENDING_DESC"] };
const MAX_PAGE = 25;

const bad = msg => { const e = new Error(msg); e.status = 400; return e; };
const notFound = msg => { const e = new Error(msg); e.status = 404; e.notFound = true; return e; };
const idOf = id => { if (!/^\d{1,9}$/.test(String(id))) throw bad("id must be an AniList id"); return +id; };
const pageOf = p => { const n = parseInt(p, 10) || 1; if (n < 1 || n > MAX_PAGE) throw bad(`page must be 1-${MAX_PAGE}`); return n; };
const nameQuery = q => {
  q = String(q || "").trim().replace(/\s+/g, " ");
  if (q.length < 2 || q.length > 60) throw bad("q must be 2-60 characters");
  return q;
};

/* ---------- the show page ---------- */
const SHOW_QUERY = `query($id:Int){ Media(id:$id, type:ANIME){
  id idMal type title { romaji english native } synonyms format episodes duration genres status popularity trending favourites averageScore meanScore
  source isAdult countryOfOrigin hashtag season seasonYear bannerImage siteUrl
  description(asHtml:false)
  tags { name rank isMediaSpoiler isAdult category description }
  trailer { id site }
  externalLinks { site url type color icon language }
  coverImage { medium large extraLarge color }
  startDate { year month day } endDate { year month day }
  nextAiringEpisode { airingAt episode }
  studios(isMain: true) { nodes { id name } }
  allStudios: studios { edges { isMain node { id name isAnimationStudio } } }
  staff(sort:[RELEVANCE], perPage:18) { edges { role node { id name { full native } image { medium } } } }
  relations { edges { relationType(version: 2) node { id type format status title { romaji english native } coverImage { medium large } startDate { year month day } episodes chapters volumes averageScore isAdult siteUrl } } }
  airingSchedule(perPage:50) { nodes { airingAt episode } }
  stats { scoreDistribution { score amount } statusDistribution { status amount } }
  rankings { rank type allTime season year context }
} }`;
// Six hours: the page carries the airing schedule and the score, both of which
// move, and the ingest worker refreshes the season snapshots on the same cadence.
export async function getShow(id) {
  const n = idOf(id);
  const data = await cached("disco-show", String(n), () => anilist(SHOW_QUERY, { id: n }), { ttlMs: 6 * 3600_000 });
  if (!data || !data.Media) throw notFound("No anime with that id");
  return data;
}

/* ---------- similar-show candidates ---------- */
const SIM_POOL_QUERY = `query($g:[String],$t:[String],$ex:[Int]){
  byTag: Page(perPage:30){ media(type:ANIME, tag_in:$t, id_not_in:$ex, isAdult:false, sort:[POPULARITY_DESC]){ ${CARD_FIELDS} } }
  byGenre: Page(perPage:25){ media(type:ANIME, genre_in:$g, id_not_in:$ex, isAdult:false, sort:[SCORE_DESC]){ ${CARD_FIELDS} } }
  airing: Page(perPage:25){ media(type:ANIME, status:RELEASING, genre_in:$g, id_not_in:$ex, isAdult:false, sort:[POPULARITY_DESC]){ ${CARD_FIELDS} } }
}`;
// The query's inputs are derived from the show's own record here, not accepted
// from the caller — so the cache key is just the id.
export async function getSimilarPool(id) {
  const n = idOf(id);
  return cached("disco-similar", String(n), async () => {
    const md = await getMediaById(n);
    if (!md) throw notFound("No anime with that id");
    const genres = (md.genres || []).filter(g => g !== "Hentai").slice(0, 2);
    const tags = (md.tags || []).filter(t => t && !t.isMediaSpoiler && (t.rank || 0) >= 60).sort((a, b) => b.rank - a.rank).slice(0, 3).map(t => t.name);
    const ex = [n, ...((md.relations && md.relations.edges) || []).map(e => e && e.node && e.node.id).filter(Boolean)];
    return anilist(SIM_POOL_QUERY, { g: genres.length ? genres : null, t: tags.length ? tags : null, ex });
  }, { ttlMs: 3 * DAY });
}

/* ---------- hidden gems ---------- */
const GEMS_QUERY = `query($g:[String],$ceil:Int,$floor:Int){ Page(page:1, perPage:50){ media(type:ANIME, genre_in:$g, averageScore_greater:$floor,
  popularity_lesser:$ceil, isAdult:false, format_in:[TV,TV_SHORT,MOVIE,ONA,OVA], sort:[SCORE_DESC]){ ${CARD_FIELDS} } } }`;
const GEM_SCORE_FLOOR = 75;
const ceilingOf = c => { const n = parseInt(c, 10); if (!GEM_CEILINGS.includes(n)) throw bad(`ceil must be one of ${GEM_CEILINGS.join(", ")}`); return n; };
export async function getGems(genresParam, ceilParam) {
  const ceil = ceilingOf(ceilParam);
  const genres = [...new Set(String(genresParam || "").split(",").map(s => s.trim()).filter(Boolean))];
  if (genres.length > 4) throw bad("at most 4 genres");
  for (const g of genres) if (!GEM_GENRES.has(g)) throw bad(`unknown genre: ${g}`);
  genres.sort();
  return cached("disco-gems", `${genres.join(",")}|${ceil}`,
    () => anilist(GEMS_QUERY, { g: genres.length ? genres : null, ceil, floor: GEM_SCORE_FLOOR - 1 }), { ttlMs: DAY });
}

// One pick per year needs one list per year; aliases keep that to two requests
// for sixteen years. The year is in the key so the window rolls over with it.
export const UNDERSEEN_YEARS = 16;
function underseenQuery(years) {
  return `query($floor:Int,$ceil:Int){ ${years.map(y => `y${y}: Page(perPage:6){ media(type:ANIME, startDate_greater:${(y - 1) * 10000 + 1231}, startDate_lesser:${(y + 1) * 10000 + 101},
    averageScore_greater:$floor, popularity_lesser:$ceil, isAdult:false, format_in:[TV,MOVIE,ONA,OVA], sort:[SCORE_DESC]){
    id type title { romaji english native } format episodes averageScore popularity genres coverImage { medium large } seasonYear startDate { year month day } isAdult countryOfOrigin studios(isMain:true){ nodes{ id name } } } }`).join("\n")} }`;
}
export async function getUnderseen(ceilParam) {
  const ceil = ceilingOf(ceilParam);
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: UNDERSEEN_YEARS }, (_, i) => thisYear - i);
  return cached("disco-underseen", `${thisYear}|${ceil}`, async () => {
    const half = UNDERSEEN_YEARS / 2, out = {};
    for (const part of [years.slice(0, half), years.slice(half)]) Object.assign(out, await anilist(underseenQuery(part), { floor: 77, ceil }));
    return out;
  }, { ttlMs: DAY });
}

/* ---------- browse: tags ---------- */
const TAG_COLLECTION_QUERY = `query{ MediaTagCollection{ name description category rank isAdult } }`;
const TAG_MEDIA_QUERY = `query($tag:String,$page:Int,$sort:[MediaSort],$adult:Boolean){ Page(page:$page, perPage:40){ pageInfo{ hasNextPage total }
  media(type:ANIME, tag:$tag, minimumTagRank:50, isAdult:$adult, sort:$sort){ ${CARD_FIELDS} } } }`;
export const getTags = () => cached("disco-tags", "all", () => anilist(TAG_COLLECTION_QUERY), { ttlMs: 7 * DAY });
export async function getTagPage(name, sortParam, pageParam, adultParam) {
  const page = pageOf(pageParam);
  const sort = BROWSE_SORTS[sortParam] ? sortParam : "popular";
  const adult = adultParam === "1";
  // Validated against the real tag list, so the key space is AniList's ~400
  // tags × 4 sorts × 25 pages, not whatever a caller types.
  const tags = ((await getTags()).MediaTagCollection) || [];
  const tag = tags.find(t => t && t.name === name);
  if (!tag) throw notFound("No such tag");
  return cached("disco-tag", `${tag.name}|${sort}|${page}|${adult ? 1 : 0}`,
    () => anilist(TAG_MEDIA_QUERY, { tag: tag.name, page, sort: BROWSE_SORTS[sort], adult: adult ? null : false }), { ttlMs: DAY });
}

/* ---------- browse: studios ---------- */
const STUDIO_PAGE_QUERY = `query($id:Int,$page:Int){ Studio(id:$id){ id name isAnimationStudio favourites siteUrl
  media(isMain:true, sort:[SCORE_DESC,POPULARITY_DESC], page:$page, perPage:50){ pageInfo{ hasNextPage } nodes{ ${CARD_FIELDS} } } } }`;
const STUDIO_LIST_QUERY = `query($search:String){ Page(perPage:36){ studios(search:$search, sort:[SEARCH_MATCH]){ id name isAnimationStudio favourites } } }`;
const STUDIO_TOP_QUERY = `query{ Page(perPage:50){ studios(sort:[FAVOURITES_DESC]){ id name isAnimationStudio favourites } } }`;
export async function getStudioCatalog(id, pageParam) {
  const n = idOf(id), page = pageOf(pageParam);
  const data = await cached("disco-studio", `${n}|${page}`, () => anilist(STUDIO_PAGE_QUERY, { id: n, page }), { ttlMs: 3 * DAY });
  if (!data || !data.Studio) throw notFound("No studio with that id");
  return data;
}
export function getStudios(q) {
  if (q == null || q === "") return cached("disco-studios", "top", () => anilist(STUDIO_TOP_QUERY), { ttlMs: 7 * DAY });
  const s = nameQuery(q);
  return cached("disco-studios", s.toLowerCase(), () => anilist(STUDIO_LIST_QUERY, { search: s }), { persist: false });
}

/* ---------- browse: staff ---------- */
const STAFF_LIST_QUERY = `query($search:String){ Page(perPage:30){ staff(search:$search, sort:[SEARCH_MATCH]){ id name{ full native } image{ medium } primaryOccupations favourites } } }`;
const STAFF_TOP_QUERY = `query{ Page(perPage:30){ staff(sort:[FAVOURITES_DESC]){ id name{ full native } image{ medium } primaryOccupations favourites } } }`;
const STAFF_PAGE_QUERY = `query($id:Int,$page:Int){ Staff(id:$id){ id name{ full native } image{ large } description(asHtml:false) primaryOccupations yearsActive homeTown favourites siteUrl
  staffMedia(type:ANIME, sort:[START_DATE_DESC], page:$page, perPage:50){ pageInfo{ hasNextPage } edges{ staffRole node{ ${CARD_FIELDS} } } }
  characterMedia(sort:[START_DATE_DESC], page:1, perPage:40){ edges{ characterRole characters{ name{ full } } node{ id type title{ romaji english native } format episodes averageScore popularity genres isAdult countryOfOrigin coverImage{ medium large } startDate{ year } seasonYear } } } } }`;
export async function getStaffPage(id, pageParam) {
  const n = idOf(id), page = pageOf(pageParam);
  const data = await cached("disco-staff", `${n}|${page}`, () => anilist(STAFF_PAGE_QUERY, { id: n, page }), { ttlMs: 3 * DAY });
  if (!data || !data.Staff) throw notFound("No person with that id");
  return data;
}
export function getStaffList(q) {
  if (q == null || q === "") return cached("disco-staff-list", "top", () => anilist(STAFF_TOP_QUERY), { ttlMs: 7 * DAY });
  const s = nameQuery(q);
  return cached("disco-staff-list", s.toLowerCase(), () => anilist(STAFF_LIST_QUERY, { search: s }), { persist: false });
}

/* ---------- operator search ---------- */
const FILTER_QUERY = `query($g:[String],$f:[MediaFormat],$s:MediaStatus,$y1:FuzzyDateInt,$y2:FuzzyDateInt,$sc:Int,$adult:Boolean){
  Page(page:1, perPage:24){ media(type:ANIME, genre_in:$g, format_in:$f, status:$s, startDate_greater:$y1, startDate_lesser:$y2,
    averageScore_greater:$sc, isAdult:$adult, sort:[POPULARITY_DESC]){ ${FULL_FIELDS} } } }`;
const fuzzyDate = v => {
  if (v == null || v === "") return null;
  if (!/^\d{8}$/.test(v) || +v < 18000101 || +v > 21001231) throw bad("dates are YYYYMMDD");
  return +v;
};
// Closed sets and bounded numbers only, but the combinations are still many and
// the answer is a live popularity ranking — memory, not Blobs.
export async function getFilter(p) {
  const list = (v, allowed, what) => {
    const out = [...new Set(String(v || "").split(",").map(s => s.trim()).filter(Boolean))];
    for (const x of out) if (!allowed.has(x)) throw bad(`unknown ${what}: ${x}`);
    return out.length ? out.sort() : null;
  };
  const vars = {
    g: list(p.get("genres"), new Set(GENRES), "genre"),
    f: list(p.get("formats"), FORMATS, "format"),
    s: p.get("status") ? (STATUSES.has(p.get("status")) ? p.get("status") : (() => { throw bad("unknown status"); })()) : null,
    y1: fuzzyDate(p.get("from")),
    y2: fuzzyDate(p.get("to")),
    sc: p.get("minScore") ? Math.max(0, Math.min(100, parseInt(p.get("minScore"), 10) || 0)) : null,
    adult: p.get("adult") === "1" ? null : false,
  };
  if (!vars.g && !vars.f && !vars.s && !vars.y1 && !vars.y2 && vars.sc == null) throw bad("give at least one filter");
  // Unset filters are left out rather than sent as null: AniList rejects this
  // query with "Illegal operator and value combination" when they are explicit.
  for (const k of Object.keys(vars)) if (vars[k] == null) delete vars[k];
  return cached("disco-filter", JSON.stringify(vars), () => anilist(FILTER_QUERY, vars), { persist: false });
}
