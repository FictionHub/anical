// Anime News Network adapter — pulls ANN's encyclopedia details for a small
// hand-curated list of anime ids, so titles have a second source of record
// independent of AniList (broadcast times, episode counts, synopsis, ratings).
//
// ANN publishes exactly one data endpoint and documents it at
// https://www.animenewsnetwork.com/encyclopedia/api.php
//   https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=<ids>
// Requests obey 1/sec per IP, but up to 50 ids can be passed at once as a
// slash-separated list — which this adapter does, so a run is ONE request
// against ANN for the whole curated list. Ids that don't exist come back as
// <warning>no result for anime=<id>/> elements and are simply skipped.
//
// ANN's terms of use require attribution: every normalized record carries the
// encyclopedia entry URL, so any page showing ANN-sourced details links back.
//
// Parsing uses _lib/xml-lite.mjs — the function runtime has no DOMParser and
// no XML dependency is installed. The parser below was written against a real
// batch response (two <anime> entries + two <warning> lines); run
// `npm run ingest:test` when touching it.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";
import { extractElements, textOf, firstUrlOf, decodeEntities } from "../xml-lite.mjs";
import { configuredIds } from "../ingest-ids.mjs";

// ANN's encyclopedia data endpoint — XML, batched ids, 1/s per IP.
const ANN_API = "https://cdn.animenewsnetwork.com/encyclopedia/api.xml";

// Curated ids worth tracking. Kept small on purpose: ANN is a polite-crawl
// source, not a bulk one. Every id here was checked against the endpoint in
// October 2026; a dead id on this list is invisible to readers — ANN answers
// with a <warning> — but it is still a wasted byte in the batch, so verify new
// ids with a one-off fetch before adding them.
const DEFAULT_ANN_IDS = [12345, 23755];   // A12345 — You're Being Summoned, Azazel; A23755 — Nagatoro

// ANN_IDS=12345/23755 overrides the list without a deploy, so a bad id can be
// removed (or a new one tried) from the Netlify UI alone. See ingest-ids.mjs for
// why malformed ids are dropped rather than sent.
const ANN_IDS = configuredIds(process.env.ANN_IDS, DEFAULT_ANN_IDS);

const limiter = makeLimiter(60);  // 1 request/sec is ANN's documented ceiling

// AniList-format name for ANN's media type attribute ("TV", "Movie", "OAV"...).
function annTypeToFormat(type) {
  const map = { TV: "TV", MOVIE: "MOVIE", OAV: "OVA", "TV SPECIAL": "TV_SPECIAL", SPECIAL: "SPECIAL", WEB: "ONA" };
  return map[String(type || "").toUpperCase()] || null;
}

// Title-case a lowercase facet ("supernatural") for display parity with
// AniList genres ("Supernatural").
const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());

// Pull the first ISO-ish date out of a Vintage value like
// "2011-04-08 to 2011-07-01", "2021-04-10" or "2011 (OAV)".
function vintageDates(vintage) {
  const stamps = String(vintage || "").match(/\d{4}-\d{2}-\d{2}/g) || [];
  const start = stamps[0] || null;
  const end = stamps[1] || null;
  if (!start) {
    const bareYear = String(vintage || "").match(/\d{4}/);
    return { start: null, end, year: bareYear ? Number(bareYear[0]) : null, month: null, day: null };
  }
  return {
    start, end,
    year: Number(start.slice(0, 4)),
    month: Number(start.slice(5, 7)),
    day: Number(start.slice(8, 10)),
  };
}

// A title with no end date is RELEASING only if it began recently; anything
// else ANN knows about is history. Bias-free guard: 180 days.
function statusFromVintage(v) {
  const now = Date.now() / 1000;
  if (v.end) return (new Date(`${v.end}T00:00:00Z`).getTime() / 1000) > now ? "RELEASING" : "FINISHED";
  if (v.start) return (new Date(`${v.start}T00:00:00Z`).getTime() / 1000) > now - 180 * 86400 ? "RELEASING" : "FINISHED";
  return v.year && v.year >= new Date().getFullYear() ? "NOT_YET_RELEASED" : "FINISHED";
}

// One normalized record per <anime> element. Shape mirrors the AniList adapter
// so _lib/ingest-schema.mjs merges it the same way.
export function parseAnnXml(xml) {
  const media = [];
  for (const el of extractElements(xml, "anime")) {
    const id = Number(el.attrs.id || 0);
    if (!id) continue;

    const infos = new Map();          // type → text (first wins; Vintage can be multiple but the first is the premiere)
    const facets = new Map();         // type → [texts] for repeatable facets (Genres, Themes)
    for (const info of extractElements(el.inner, "info")) {
      const type = info.attrs.type;
      if (!type) continue;
      if (type === "Genres" || type === "Themes") {
        if (!facets.has(type)) facets.set(type, []);
        const v = textOf(info.inner);
        if (v) facets.get(type).push(titleCase(v));
      } else if (!infos.has(type)) {
        infos.set(type, textOf(info.inner));
      }
    }

    const v = vintageDates(infos.get("Vintage"));
    const genres = [...(facets.get("Genres") || []), ...(facets.get("Themes") || [])];
    const eps = Number(infos.get("Number of episodes")) || null;
    const ratings = extractElements(el.inner, "ratings")[0];
    const score = ratings ? Number(ratings.attrs.weighted_score) : null;
    const votes = ratings ? Number(ratings.attrs.nb_votes) : null;

    // Studios credit blocks: <credit><task>Animation Production</task><company>…</company></credit>
    const studios = [];
    for (const credit of extractElements(el.inner, "credit")) {
      if (!/Animation Production/.test(textOf(extractElements(credit.inner, "task").map(t => textOf(t.inner)).join(" ")))) continue;
      for (const co of extractElements(credit.inner, "company")) studios.push(textOf(co.inner));
    }

    // Cover: prefer ANN's larger preview; fall back to the entry thumbnail.
    const picture = extractElements(el.inner, "info").find(i => i.attrs.type === "Picture");
    const coverImage = picture
      ? { medium: firstUrlOf(picture.inner) || picture.attrs.src || null, large: firstUrlOf(String(picture.inner).replace(/fit200x200/g, "max500x600")) }
      : null;

    media.push({
      id: `ann:${id}`,
      title: { romaji: infos.get("Main title") || el.attrs.name || "", english: null, native: null },
      format: annTypeToFormat(el.attrs.type),
      episodes: eps,
      status: statusFromVintage(v),
      source: "ann",
      isAdult: false,
      season: v.month ? ["WINTER", "SPRING", "SUMMER", "FALL"][Math.ceil(v.month / 3) - 1] : null,
      seasonYear: v.year,
      startDate: v.year ? { year: v.year, month: v.month, day: v.day } : null,
      coverImage,
      bannerImage: null,
      siteUrl: `https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${id}`,   // attribution per ANN's terms
      synopsis: decodeEntities(infos.get("Plot Summary") || "") || null,
      genres,
      studios,
      tags: [],
      averageScore: score ? Math.round(score * 10) : null,
      popularity: votes || null,
      airingSchedule: [],
    });
  }
  return media;
}

export async function ingestANN() {
  const raw = [];

  // An explicitly empty ANN_IDS means "off", not "fetch an empty batch". Say so
  // in the run log instead of reporting a healthy request that asked for nothing.
  if (!ANN_IDS.length) {
    return { source: "ann", raw, media: [], skipped: true, reason: "ANN_IDS is set but contains no valid ids" };
  }

  try {
    await limiter();
    const res = await fetchWithRetry(`${ANN_API}?anime=${ANN_IDS.join("/")}`, {}, { retries: 2 });
    if (!res.ok) {
      raw.push({ ids: ANN_IDS, fetchedAt: Date.now(), status: res.status, body: null });
      return { source: "ann", raw, media: [], skipped: false, reason: null };
    }
    const xml = await res.text();
    raw.push({ ids: ANN_IDS, fetchedAt: Date.now(), status: res.status, body: xml.slice(0, 4000), bytes: xml.length });
    return { source: "ann", raw, media: parseAnnXml(xml), skipped: false, reason: null };
  } catch (err) {
    console.error("ingest: ann failed", err);
    raw.push({ ids: ANN_IDS, fetchedAt: Date.now(), error: String((err && err.message) || err) });
    return { source: "ann", raw, media: [], skipped: false, reason: null };
  }
}
