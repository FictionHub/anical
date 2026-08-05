// The seasonless-but-airing set — one definition, shared by every consumer.
//
// AniList leaves `season`/`seasonYear` null on a slice of what is genuinely
// airing: Korean and Chinese productions, and long-running ONAs that don't map
// onto a Japanese broadcast season. Every schedule query in this repo used to
// filter `media(season:, seasonYear:)`, so those titles matched nothing and were
// invisible everywhere — the calendar, the API, the SEO pages, the Discord and
// social posts, the embed widget and the offset scraper alike.
//
// Found through "Tomb Raider King" (AniList 184356): RELEASING, an episode due
// that evening, `season: null`, and therefore in no query the project made.
//
// This module has NO dependencies on purpose. It is imported by the Netlify
// functions *and* by the plain-node scripts in scripts/ and bot/ that run on
// GitHub Actions without the functions' node_modules.
//
// Client-side copies exist in site/index.html and site/embed/index.html, which
// have no build step and cannot import this file. Change one, change those —
// same rule as _lib/schedule-overrides.mjs.

// 8 pages = 400 titles. Deliberately deeper than the 3 pages a *season* fetch
// uses: the seasonless titles sit far down a popularity-sorted list of
// everything currently airing (the JP one that prompted raising this, MILGRAM
// The Third Trial, is around rank 167), and the filter below discards almost
// every row, so the extra pages cost bandwidth rather than payload.
export const SEASONLESS_MAX_PAGES = 8;

// Every caller's field list must include these, or the filter silently keeps
// nothing — or, worse, keeps everything, because a missing `season` field is
// indistinguishable from a null one.
export const SEASONLESS_REQUIRED_FIELDS = "season seasonYear airingSchedule { nodes { airingAt episode } }";

export function seasonlessQuery(mediaFields) {
  return `query ($page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC) { ${mediaFields} }
  }
}`;
}

// Keep only what AniList gave no season *and* that actually has episodes.
//
// The second half is load-bearing. The seasonless set is otherwise full of promo
// collections — "Fate/Grand Order CMs", "Arknights Animation PVs" — which carry
// no schedule, would render nothing anywhere, and would only bloat payloads and
// the app's genre/search indexes.
export function isSeasonlessAiring(md) {
  return !!md
    && (!md.season || !md.seasonYear)
    && ((md.airingSchedule && md.airingSchedule.nodes) || []).length > 0;
}

// Page through the seasonless set with a caller-supplied transport, so each
// consumer keeps its own retry policy, rate limiter and error handling rather
// than inheriting one that doesn't suit it.
//
// `post(query, variables)` must resolve to the parsed GraphQL body.
export async function collectSeasonless(post, mediaFields, { maxPages = SEASONLESS_MAX_PAGES, onPage } = {}) {
  const query = seasonlessQuery(mediaFields);
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await post(query, { page });
    const pageData = body && body.data && body.data.Page;
    if (!pageData) break;
    out.push(...(pageData.media || []));
    if (onPage) await onPage(body, page);
    if (!(pageData.pageInfo && pageData.pageInfo.hasNextPage)) break;
  }
  return out.filter(isSeasonlessAiring);
}
