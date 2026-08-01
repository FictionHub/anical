// AniList adapter — the one live source today. Pulls the given seasons
// (paginated, 50/page) through the shared retry + rate-limit helpers, and
// returns both the raw page payloads (for archival) and the flat media list
// (for normalization). Mirrors scripts/build-seo.mjs's query, kept separate
// since that script serves SEO pages and this serves the canonical dataset.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";

const ANILIST = "https://graphql.anilist.co";
const QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id title { romaji english native } format episodes duration genres averageScore popularity
      status source isAdult season seasonYear siteUrl
      coverImage { large medium color } bannerImage
      startDate { year month day } endDate { year month day }
      studios(isMain: true) { nodes { name } }
      airingSchedule { nodes { airingAt episode } }
    }
  }
}`;

const limiter = makeLimiter(25);   // stay under AniList's ~30 req/min degraded budget

// maxPagesPerSeason bounds worst-case work per run (50/page, so 6 pages = 300
// shows/season) — matches the safety-bound pattern build-seo.mjs already uses.
export async function ingestAniList({ seasons, maxPagesPerSeason = 6 }) {
  const raw = [];
  const media = [];
  for (const { season, year } of seasons) {
    let page = 1, more = true;
    while (more && page <= maxPagesPerSeason) {
      const res = await fetchWithRetry(ANILIST, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { season, seasonYear: year, page } }),
      }, { limiter, retries: 4 });
      if (!res.ok) throw new Error(`AniList HTTP ${res.status} (season ${season} ${year} page ${page})`);
      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0].message);
      raw.push({ season, year, page, fetchedAt: Date.now(), body: json });
      media.push(...json.data.Page.media);
      more = json.data.Page.pageInfo.hasNextPage;
      page++;
    }
  }
  return { source: "anilist", raw, media };
}
