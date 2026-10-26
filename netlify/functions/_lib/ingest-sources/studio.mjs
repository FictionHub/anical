// Studio-feed adapter — pulls studio feeds directly (announcements, official
// schedules), one curated RSS/JSON endpoint per studio. Returns the same
// { source, raw, media, skipped, reason } shape as every other adapter so the
// orchestrator in ingest.mjs never has to special-case an unimplemented source.
//
// Feed items carry no season, no AniList id and no airing schedule: they're
// candidates, not records. They land here only as evidence for entity
// resolution to match against canonical identities, which is why each record's
// id is a stable slug of the studio + title — never a timestamp — so two runs
// seeing the same announcement merge onto one canonical record instead of
// minting a duplicate every two hours.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";
import { extractElements, textOf } from "../xml-lite.mjs";

const limiter = makeLimiter(10);

// Curated studio feeds. Each entry: studio name + endpoint URL + kind ("rss" or
// "json"). Entries without a working endpoint still produce a raw log line so
// the orchestrator can see which studios are configured but not yet live.
const STUDIO_FEEDS = [
  { name: "Kyoto Animation", kind: "none", url: null },
  { name: "MAPPA", kind: "none", url: null },
  { name: "ufotable", kind: "none", url: null },
  { name: "Bones", kind: "none", url: null },
  { name: "Madhouse", kind: "none", url: null },
];

// Stable id (and canonical-store key) for a feed item: studio + slugified
// title. Deterministic across runs, unlike Date.now(), so entity resolution
// sees the same identity twice and merges instead of duplicating.
export function studioItemKey(feedName, titles) {
  const slug = String(titles || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "untitled";
  return { id: `studio:${feedName}:${slug}`, slug };
}

// Parse an RSS feed into lightweight items. RSS titles and descriptions are
// routinely CDATA-wrapped; textOf handles both escapes and markup.
export function parseRss(xml) {
  return extractElements(xml, "item").map(item => ({
    title: textOf(extractElements(item.inner, "title")[0]?.inner || ""),
    link: textOf(extractElements(item.inner, "link")[0]?.inner || ""),
    pubDate: textOf(extractElements(item.inner, "pubDate")[0]?.inner || ""),
    description: textOf(extractElements(item.inner, "description")[0]?.inner || ""),
  }));
}

// Parse a JSON feed into lightweight items. Accepts the three shapes feeds
// actually use: { items: [...] }, { entries: [...] } or a bare array.
export function parseJson(json) {
  const list = Array.isArray(json) ? json : json?.items || json?.entries;
  if (!Array.isArray(list)) return [];
  return list.map(it => ({
    title: it.title || it.name || "",
    link: it.url || it.link || "",   // (was: url || link || url — duplicated url, link never tried)
    pubDate: it.pubDate || it.published || it.date || "",
    description: it.description || it.summary || it.body || "",
  }));
}

export async function ingestStudios() {
  const media = [];
  const raw = [];
  let live = 0;

  for (const feed of STUDIO_FEEDS) {
    if (!feed.url || feed.kind === "none") {
      raw.push({ studio: feed.name, fetchedAt: Date.now(), reason: "no endpoint configured yet" });
      continue;
    }
    live++;

    try {
      await limiter();
      const res = await fetchWithRetry(feed.url, {}, { retries: 2 });
      if (!res.ok) {
        raw.push({ studio: feed.name, fetchedAt: Date.now(), status: res.status });
        continue;
      }
      const text = await res.text();
      let parsed = [];
      if (feed.kind === "rss") parsed = parseRss(text);
      else if (feed.kind === "json") {
        try { parsed = parseJson(JSON.parse(text)); } catch (_) { parsed = []; }
      }

      raw.push({ studio: feed.name, fetchedAt: Date.now(), items: parsed.length });
      // Convert feed items into candidate media records — a feed item without
      // an AniList id cannot be merged into the canonical store yet; it lands
      // here as a candidate for entity resolution to pick up. The record id is
      // stable (see studioItemKey), so re-runs merge rather than duplicate.
      for (const item of parsed) {
        const { id } = studioItemKey(feed.name, item.title);
        media.push({
          id,
          title: { romaji: item.title, english: null, native: null },
          format: null,
          episodes: null,
          duration: null,
          status: "NOT_YET_RELEASED",
          source: "studios",
          isAdult: false,
          season: null,
          seasonYear: null,
          startDate: null,
          endDate: null,
          studios: [feed.name],
          genres: [],
          averageScore: null,
          popularity: null,
          airingSchedule: [],
          coverImage: null,
          bannerImage: null,
          siteUrl: item.link || null,
          synopsis: item.description || null,
          tags: [],
          externalIds: { studios: id },
          raw: { feedItem: item },
          provenance: { studios: { fetchedAt: Date.now(), fields: ["*"], confidence: "low" } },
        });
      }
    } catch (err) {
      console.error(`ingest: studio ${feed.name} failed`, err);
      raw.push({ studio: feed.name, fetchedAt: Date.now(), error: String((err && err.message) || err) });
    }
  }

  // With no endpoint configured there is nothing to fetch, and "ok, 0 shows"
  // reads like a healthy empty result. Mark it skipped so the run log says why.
  if (!live) {
    return { source: "studios", raw, media, skipped: true, reason: "no studio feed endpoint configured yet" };
  }

  return { source: "studios", raw, media, skipped: false, reason: null };
}
