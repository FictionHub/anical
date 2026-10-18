// Studio-feed adapter — pulls studio feeds directly (announcements, official
// schedules), one curated RSS/JSON endpoint per studio. Returns the same
// { source, raw, media, skipped, reason } shape as every other adapter so the
// orchestrator in ingest.mjs never has to special-case an unimplemented source.
//
// The feed list is deliberately short and hand-curated: each entry pairs a
// studio name with an RSS or JSON endpoint that publishes announcements about
// new shows, release dates, or delays. Every entry is one HTTP request per run,
// so the list stays small to respect each studio's courtesy budget.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";

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

// Parse an RSS feed into a lightweight record.
function parseRss(xml) {
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const items = [];
  for (const item of dom.querySelectorAll("item")) {
    items.push({
      title: item.querySelector("title")?.textContent || "",
      link: item.querySelector("link")?.textContent || "",
      pubDate: item.querySelector("pubDate")?.textContent || "",
      description: item.querySelector("description")?.textContent || "",
    });
  }
  return items;
}

// Parse a JSON feed into a lightweight record.
function parseJson(json) {
  const items = Array.isArray(json.items || json.entries || json) ? (json.items || json.entries || json) : [];
  return items.map(it => ({
    title: it.title || it.name || "",
    link: it.url || it.link || it.url || "",
    pubDate: it.pubDate || it.published || it.date || "",
    description: it.description || it.summary || it.body || "",
  }));
}

export async function ingestStudios() {
  const media = [];
  const raw = [];

  for (const feed of STUDIO_FEEDS) {
    if (!feed.url || feed.kind === "none") {
      raw.push({ studio: feed.name, fetchedAt: Date.now(), reason: "no endpoint configured yet" });
      continue;
    }

    try {
      await limiter();
      const res = await fetchWithRetry(feed.url, {}, { retries: 2 });
      if (!res.ok) {
        raw.push({ studio: feed.name, fetchedAt: Date.now(), status: res.status });
        continue;
      }
      const text = await res.text();
      let parsed;
      if (feed.kind === "rss") parsed = parseRss(text);
      else if (feed.kind === "json") { try { parsed = parseJson(JSON.parse(text)); } catch (_) { parsed = []; } }
      else parsed = [];

      raw.push({ studio: feed.name, fetchedAt: Date.now(), items: parsed.length });
      // Convert feed items into placeholder media records — a feed item without
      // an AniList id cannot be merged into the canonical store yet; it lands
      // here as a candidate for entity resolution to pick up.
      for (const item of parsed) {
        media.push({
          sourceId: `studio:${feed.name}:${Date.now()}`,
          title: { romaji: item.title, english: null, native: null },
          format: null,
          episodes: null,
          duration: null,
          status: "NOT_YET_RELEASED",
          source: null,
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
          raw: { feedItem: item },
          provenance: { studios: { fetchedAt: Date.now(), fields: ["*"] } },
        });
      }
    } catch (err) {
      console.error(`ingest: studio ${feed.name} failed`, err);
      raw.push({ studio: feed.name, fetchedAt: Date.now(), error: String((err && err.message) || err) });
    }
  }

  return { source: "studios", raw, media, skipped: false, reason: null };
}
