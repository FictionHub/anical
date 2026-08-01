// Shared fetch helpers for ingestion workers (netlify/functions/ingest.mjs and
// the per-source adapters in ingest-sources/): retries with exponential backoff,
// and a simple rate-limit budget so a burst of paginated requests never trips a
// source's 429s. Deliberately dependency-free (global fetch, Node 18+).

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function backoffMs(attempt) {
  return Math.min(30000, 500 * 2 ** attempt) + Math.random() * 300;   // jittered
}

// A minimal token-less rate limiter: enforces a minimum gap between calls so a
// tight loop of paginated requests stays under a source's per-minute budget.
// AniList's public API is currently degraded to ~30 req/min — default to a bit
// under that so a slow response doesn't push a burst over the edge.
export function makeLimiter(perMinute = 25) {
  const gapMs = Math.max(1, Math.floor(60000 / perMinute));
  let last = 0;
  return async function throttle() {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

// fetch() with a rate-limit gate + retry/backoff on network errors, 429s and 5xx.
// Respects Retry-After when a source sends one.
export async function fetchWithRetry(url, opts = {}, { retries = 3, limiter = null } = {}) {
  let attempt = 0;
  for (;;) {
    if (limiter) await limiter();
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(backoffMs(attempt++));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) return res;
      const retryAfterHeader = +(res.headers.get("retry-after") || 0) * 1000;
      await sleep(retryAfterHeader || backoffMs(attempt++));
      continue;
    }
    return res;
  }
}
