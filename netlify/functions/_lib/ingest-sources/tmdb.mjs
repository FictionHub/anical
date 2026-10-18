// TMDB adapter — pulls alternate air dates, network info and posters to
// cross-reference against AniList once we have a reliable AniList<->TMDB id
// mapping.
//
// TMDB's public API (https://developer.themoviedb.org) requires TMDB_API_KEY
// in Netlify env vars. This adapter is seeded with a small hand-curated list of
// TMDB TV show ids worth tracking. Results are archived raw and normalized into
// the canonical schema in _lib/ingest-schema.mjs.
//
// Setup once implemented: set TMDB_API_KEY in Netlify env vars.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";

const TMDB_API = "https://api.themoviedb.org/3";

const limiter = makeLimiter(35); // TMDB's default budget is ~40 req/10s; stay under it

// Curated TMDB TV show ids worth tracking. Kept small so a run stays inside the
// function budget until entity resolution maps AniList ids to TMDB ids.
const TMDB_IDS = [93405, 130631, 94608, 129914, 203749];

// Map TMDB's first_air_date into AniList-style season/year.
function seasonOf(iso) {
  if (!iso) return { season: null, seasonYear: null, startDate: null };
  const d = new Date(iso + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return { season: ["WINTER","SPRING","SUMMER","FALL"][Math.ceil(month/3)-1], seasonYear: year, startDate: { year, month, day: 1 } };
}

function normalizeShow(show) {
  const { season, seasonYear, startDate } = seasonOf(show.first_air_date);
  return {
    sourceId: `tmdb:${show.id}`,
    title: { romaji: show.name || null, english: null, native: null },
    format: show.episode_run_time && show.episode_run_time[0] <= 24 ? "TV_SHORT" : "TV",
    episodes: show.number_of_episodes || null,
    duration: show.episode_run_time && show.episode_run_time[0] || null,
    status: show.status === "Returning Series" ? "RELEASING" : show.status === "Ended" ? "FINISHED" : "NOT_YET_RELEASED",
    source: null,
    isAdult: false,
    season,
    seasonYear,
    startDate,
    endDate: show.last_air_date ? { ...seasonOf(show.last_air_date).startDate } : null,
    studios: ((show.networks || []).map(n => n.name)).filter(Boolean),
    genres: ((show.genres || []).map(g => g.name)).filter(Boolean),
    averageScore: show.vote_average != null ? Math.round(show.vote_average * 10) / 10 : null,
    popularity: show.popularity ?? null,
    airingSchedule: [], // TMDB does not expose per-episode air dates in /tv/{id}
    coverImage: show.poster_path ? { medium: `https://image.tmdb.org/t/p/w300${show.poster_path}`, large: `https://image.tmdb.org/t/p/w500${show.poster_path}` } : null,
    bannerImage: null,
    siteUrl: `https://www.themoviedb.org/tv/${show.id}`,
    synopsis: show.overview || null,
    tags: [],
    externalIds: { tmdb: show.id },
    raw: { show },
    provenance: { tmdb: { fetchedAt: Date.now(), fields: ["*"] } },
  };
}

export async function ingestTMDB() {
  if (!process.env.TMDB_API_KEY) {
    return { source: "tmdb", raw: [], media: [], skipped: true, reason: "TMDB_API_KEY not configured" };
  }

  const media = [];
  const raw = [];

  for (const id of TMDB_IDS) {
    try {
      await limiter();
      const res = await fetchWithRetry(`${TMDB_API}/tv/${id}?language=en-US`, {
        headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}`, Accept: "application/json" },
      }, { retries: 2 });
      if (!res.ok) {
        raw.push({ id, fetchedAt: Date.now(), status: res.status, body: null });
        continue;
      }
      const show = await res.json();
      raw.push({ id, fetchedAt: Date.now(), status: res.status, body: { id: show.id, name: show.name } });
      media.push(normalizeShow(show));
    } catch (err) {
      console.error(`ingest: tmdb id ${id} failed`, err);
      raw.push({ id, fetchedAt: Date.now(), error: String((err && err.message) || err) });
    }
  }

  return { source: "tmdb", raw, media, skipped: false, reason: null };
}
