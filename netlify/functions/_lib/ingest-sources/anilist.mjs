// AniList adapter — the one live source today. Pulls the given seasons
// (paginated, 50/page) through the shared retry + rate-limit helpers, and
// returns both the raw page payloads (for archival) and the flat media list
// (for normalization).
//
// The field list comes from _lib/catalog.mjs rather than being spelled out
// again here: what this ingests IS what the API and the app read back out of
// the catalog, so a field present in one and missing from the other is a bug
// that only surfaces weeks later as an empty pill in the UI.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";
import { ANILIST, MEDIA_FIELDS } from "../catalog.mjs";

const QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
  }
}`;

// AniList's public API is degraded to ~30 req/min. This worker now refreshes
// one season (≤3 pages) per run rather than crawling three, so the gap only has
// to keep a short burst polite, not sustain a long crawl.
const limiter = makeLimiter(40);

// maxPagesPerSeason bounds worst-case work per run (50/page, so 3 pages = 150
// shows — the same depth the catalog and the app use).
//
// `deadline` is a wall-clock stop. Netlify terminates a function that overruns
// its execution limit, and a terminated run writes no log at all — which is
// exactly how this worker managed to report "no ingestion run yet" for weeks
// while firing on schedule. Returning a partial pull is strictly better.
export async function ingestAniList({ seasons, maxPagesPerSeason = 3, deadline = Infinity }) {
  const raw = [];
  const media = [];
  for (const { season, year } of seasons) {
    let page = 1, more = true;
    while (more && page <= maxPagesPerSeason) {
      if (Date.now() > deadline) return { source: "anilist", raw, media, truncated: true };
      const res = await fetchWithRetry(ANILIST, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { season, seasonYear: year, page } }),
      }, { limiter, retries: 2 });
      if (!res.ok) throw new Error(`AniList HTTP ${res.status} (season ${season} ${year} page ${page})`);
      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0].message);
      raw.push({ season, year, page, fetchedAt: Date.now(), body: json });
      media.push(...json.data.Page.media);
      more = json.data.Page.pageInfo.hasNextPage;
      page++;
    }
  }
  return { source: "anilist", raw, media, truncated: false };
}
