// TMDB adapter — stub. TMDB gives us alternate air dates, network info and
// posters to cross-reference against AniList once we have a reliable
// AniList<->TMDB id mapping, which is 2026·09 (entity-resolution engine) work.
// Wired here so the orchestrator's source list doesn't change shape when this
// goes live — just fill in the fetch below and drop the early return.
//
// Setup once implemented: set TMDB_API_KEY in Netlify env vars.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";

const limiter = makeLimiter(35);   // TMDB's default budget is ~40 req/10s; stay under it

export async function ingestTMDB() {
  if (!process.env.TMDB_API_KEY) {
    return { source: "tmdb", raw: [], media: [], skipped: true, reason: "TMDB_API_KEY not configured" };
  }
  // TODO(2026·09+): fetch /tv/{id} for each AniList show's resolved TMDB id and
  // normalize into ingest-schema.mjs once that mapping exists. `fetchWithRetry`
  // and `limiter` are imported and ready for that call.
  return { source: "tmdb", raw: [], media: [], skipped: true, reason: "not yet implemented — depends on 2026·09 entity resolution" };
}
