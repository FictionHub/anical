// Ingestion backbone — 2026·08 decade-roadmap milestone.
//
// A scheduled worker that pulls AniList (and, as they come online, ANN/TMDB/
// studio feeds — see _lib/ingest-sources/) into a versioned canonical schema
// (_lib/ingest-schema.mjs), through shared retry + rate-limit budgeting
// (_lib/ingest-http.mjs), archiving the raw payload so nothing is ever lost to
// a bad normalization pass. Everything downstream on the roadmap — entity
// resolution (2026·09), confidence/conflict resolution (2026·10), historical
// backfill (2026·11) — builds on what lands here.
//
// It also warms the read path: every pull is written into the catalog
// (_lib/catalog.mjs) that the public API and the push worker read from, which
// is what keeps ordinary traffic off AniList entirely.
//
// ONE SEASON PER RUN, stalest first. The original version crawled three seasons
// (up to 18 paginated requests behind a 25/min limiter — 40+ seconds) inside a
// function whose execution limit is a small number of seconds. It was killed
// mid-run every time, which is why it never wrote a single run log despite
// firing on schedule. Refreshing the one season that needs it most finishes
// well inside the budget, and running more often covers the same ground.
//
// Storage (Netlify Blobs, no external DB to provision):
//   catalog-seasons  "<SEASON>-<YEAR>"   — the read path's snapshot
//   ingest-raw       "<source>/<runId>"  — the raw payload fetched this run
//   ingest-canonical "<source>:<id>"     — one merged record per show
//   ingest-runs      "run-<runId>" + "latest" — run log for the status endpoint
//
// Manual test (requires CRON_SECRET — same env var push-send.mjs uses):
//   curl "https://<site>/.netlify/functions/ingest?secret=$CRON_SECRET"
//   curl "https://<site>/.netlify/functions/ingest?secret=$CRON_SECRET&season=SUMMER&year=2026"
import { getStore } from "@netlify/blobs";
import { ingestAniList } from "./_lib/ingest-sources/anilist.mjs";
import { ingestANN } from "./_lib/ingest-sources/ann.mjs";
import { ingestTMDB } from "./_lib/ingest-sources/tmdb.mjs";
import { ingestStudios } from "./_lib/ingest-sources/studio.mjs";
import { normalizeAniList, mergeRecord, SCHEMA_VERSION } from "./_lib/ingest-schema.mjs";
import {
  putSeason, putSeasonless, getSeasonless, fetchSeasonlessFromAniList,
  catalogHealth, seasonOf, shiftSeason, SEASONS,
} from "./_lib/catalog.mjs";

export const config = { schedule: "0 */2 * * *" };   // every 2 hours, one season each

// Leave room after the fetch loop for the snapshot write and the run log —
// those are the parts whose absence makes a run invisible.
const FETCH_BUDGET_MS = 6_000;
const CANONICAL_BUDGET_MS = 12_000;
// The seasonless set is refreshed opportunistically, after the season work this
// run actually owes. Its own TTL in the read path is 6h; refreshing at 4h means
// a normal run keeps it warm without ever letting a reader pay for the fetch.
const SEASONLESS_MAX_AGE_S = 4 * 3600;
const SEASONLESS_BUDGET_MS = 14_000;

// Previous + current + next season: covers shows still airing late, this
// season's full lineup, and next season's early announcements.
function targetSeasons() {
  const now = new Date();
  const season = seasonOf(now.getMonth());
  const year = now.getFullYear();
  return [shiftSeason(season, year, -1), { season, year }, shiftSeason(season, year, 1)];
}

// The season whose snapshot is oldest (or missing) is the one this run owes
// work to. Self-correcting: no cursor to persist, and a season that failed last
// time is automatically first in line next time.
async function stalestSeason(targets) {
  const health = await catalogHealth(targets);
  let worst = null;
  for (let i = 0; i < targets.length; i++) {
    const h = health[i];
    const age = h.cached ? (h.ageSeconds ?? 0) : Infinity;
    if (!worst || age > worst.age) worst = { ...targets[i], age, cached: h.cached, count: h.count };
  }
  return worst;
}

const STUB_SOURCES = [["ann", ingestANN], ["tmdb", ingestTMDB], ["studios", ingestStudios]];

export default async (req) => {
  const isScheduled = req.headers.get("x-netlify-event") === "schedule";
  const url = new URL(req.url);
  if (!isScheduled) {
    const secret = url.searchParams.get("secret");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const startedAt = Date.now();
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runsStore = getStore("ingest-runs");
  const log = { runId, schemaVersion: SCHEMA_VERSION, startedAt, sources: {}, ok: true };

  try {
    const targets = targetSeasons();
    // An explicit ?season=&year= overrides the picker — the fastest way to
    // force a specific season warm after a deploy or an outage.
    const forcedSeason = String(url.searchParams.get("season") || "").toUpperCase();
    const forcedYear = parseInt(url.searchParams.get("year"), 10);
    const target = SEASONS.includes(forcedSeason) && forcedYear >= 1940 && forcedYear <= 2100
      ? { season: forcedSeason, year: forcedYear }
      : await stalestSeason(targets);
    log.target = { season: target.season, year: target.year, previousAgeSeconds: target.age === Infinity ? null : target.age };

    const { raw, media, truncated } = await ingestAniList({
      seasons: [{ season: target.season, year: target.year }],
      deadline: startedAt + FETCH_BUDGET_MS,
    });

    // The read path first — it is the part users feel. Everything below this
    // line is archival and can be cut short without anyone noticing.
    if (media.length) await putSeason(target.season, target.year, media, "ingest", { writeMedia: false });

    await getStore("ingest-raw").setJSON(`anilist/${runId}`, { fetchedAt: Date.now(), target, pages: raw.length, payloads: raw })
      .catch(err => console.warn("ingest: raw archive skipped —", err.message));

    let upserts = 0, canonicalTruncated = false;
    const canonicalStore = getStore("ingest-canonical");
    for (const md of media) {
      if (Date.now() - startedAt > CANONICAL_BUDGET_MS) { canonicalTruncated = true; break; }
      const key = `anilist:${md.id}`;
      const existing = await canonicalStore.get(key, { type: "json" }).catch(() => null);
      await canonicalStore.setJSON(key, mergeRecord(existing, normalizeAniList(md)));
      upserts++;
    }
    log.sources.anilist = {
      ok: true, season: target.season, year: target.year,
      pages: raw.length, shows: media.length, upserts,
      truncated: !!truncated, canonicalTruncated,
    };
  } catch (err) {
    log.ok = false;
    log.sources.anilist = { ok: false, error: String((err && err.message) || err) };
    console.error("ingest: anilist failed", err);
  }

  // The seasonless set — currently-airing titles AniList assigned no season, so
  // no season query can reach them (see _lib/catalog.mjs). Deliberately *not* a
  // fourth rotation target: four targets on a 2-hour cadence would refresh each
  // one every 8 hours, pushing all three real seasons past their 6-hour TTL. It
  // is refreshed here only when its own snapshot has aged out and the run has
  // time left, so the season cadence is untouched and a slow AniList can only
  // cost this step, never the season above it.
  try {
    const snap = await getSeasonless({ allowNetwork: false });
    const ageSeconds = snap ? (Date.now() - (snap.fetchedAt || 0)) / 1000 : Infinity;
    const stale = ageSeconds > SEASONLESS_MAX_AGE_S;
    const timeLeft = Date.now() - startedAt < SEASONLESS_BUDGET_MS;
    if (stale && timeLeft) {
      const media = await fetchSeasonlessFromAniList();
      await putSeasonless(media, "ingest");

      // Canonical records too. Without these, a title that is invisible to every
      // season query is also absent from the canonical store — so entity
      // resolution (2026·09) would be built on a dataset with the same hole.
      let upserts = 0;
      const canonicalStore = getStore("ingest-canonical");
      for (const md of media) {
        if (Date.now() - startedAt > SEASONLESS_BUDGET_MS) break;
        const key = `anilist:${md.id}`;
        const existing = await canonicalStore.get(key, { type: "json" }).catch(() => null);
        await canonicalStore.setJSON(key, mergeRecord(existing, normalizeAniList(md)));
        upserts++;
      }

      log.sources.seasonless = { ok: true, refreshed: true, shows: media.length, upserts, previousAgeSeconds: ageSeconds === Infinity ? null : Math.round(ageSeconds) };
    } else {
      log.sources.seasonless = { ok: true, refreshed: false, reason: stale ? "out of time this run" : "still fresh", ageSeconds: ageSeconds === Infinity ? null : Math.round(ageSeconds) };
    }
  } catch (err) {
    log.sources.seasonless = { ok: false, error: String((err && err.message) || err) };
    console.error("ingest: seasonless failed", err);
  }

  // Stub sources: run each, record whatever they return, never fail the whole
  // run over a source that isn't live yet. They return immediately today, so
  // they cost nothing against the budget.
  for (const [name, fn] of STUB_SOURCES) {
    try {
      const result = await fn();
      log.sources[name] = { ok: true, skipped: !!result.skipped, reason: result.reason, shows: result.media.length };
    } catch (err) {
      log.sources[name] = { ok: false, error: String((err && err.message) || err) };
      console.error(`ingest: ${name} failed`, err);
    }
  }

  log.finishedAt = Date.now();
  log.durationMs = log.finishedAt - startedAt;
  log.catalog = await catalogHealth(targetSeasons()).catch(() => null);
  await runsStore.setJSON(`run-${runId}`, log).catch(err => console.warn("ingest: run log write failed —", err.message));
  await runsStore.setJSON("latest", log).catch(() => {});

  return new Response(JSON.stringify(log, null, 2), { headers: { "Content-Type": "application/json" } });
};
