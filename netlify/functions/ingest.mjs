// Ingestion backbone — 2026·08 decade-roadmap milestone.
//
// A scheduled worker that pulls AniList (and, as they come online, ANN/TMDB/
// studio feeds — see _lib/ingest-sources/) into a versioned canonical schema
// (_lib/ingest-schema.mjs), through shared retry + rate-limit budgeting
// (_lib/ingest-http.mjs), archiving every raw payload it fetches so nothing is
// ever lost to a bad normalization pass. Everything downstream on the roadmap —
// entity resolution (2026·09), confidence/conflict resolution (2026·10),
// historical backfill (2026·11) — builds on what lands here.
//
// Storage (Netlify Blobs, no external DB to provision):
//   ingest-raw       "<source>/<runId>"  — every raw payload fetched this run
//   ingest-canonical "<source>:<id>"     — one merged record per show
//   ingest-runs      "run-<runId>" + "latest" — run log for the status endpoint
//
// Manual test (requires CRON_SECRET — same env var push-send.mjs uses):
//   curl "https://<site>/.netlify/functions/ingest?secret=$CRON_SECRET"
import { getStore } from "@netlify/blobs";
import { ingestAniList } from "./_lib/ingest-sources/anilist.mjs";
import { ingestANN } from "./_lib/ingest-sources/ann.mjs";
import { ingestTMDB } from "./_lib/ingest-sources/tmdb.mjs";
import { ingestStudios } from "./_lib/ingest-sources/studio.mjs";
import { normalizeAniList, mergeRecord, SCHEMA_VERSION } from "./_lib/ingest-schema.mjs";

export const config = { schedule: "0 */6 * * *" };   // every 6 hours

const SEASON_ORDER = ["WINTER", "SPRING", "SUMMER", "FALL"];
const seasonOf = m => (m <= 2 ? "WINTER" : m <= 5 ? "SPRING" : m <= 8 ? "SUMMER" : "FALL");

// Previous + current + next season: covers shows still airing late, this
// season's full lineup, and next season's early announcements.
function targetSeasons() {
  const now = new Date();
  const season = seasonOf(now.getMonth());
  const year = now.getFullYear();
  const idx = SEASON_ORDER.indexOf(season);
  const shift = (i, y, d) => { i += d; if (i < 0) { i = 3; y--; } else if (i > 3) { i = 0; y++; } return { season: SEASON_ORDER[i], year: y }; };
  return [shift(idx, year, -1), { season, year }, shift(idx, year, 1)];
}

const STUB_SOURCES = [["ann", ingestANN], ["tmdb", ingestTMDB], ["studios", ingestStudios]];

export default async (req) => {
  const isScheduled = req.headers.get("x-netlify-event") === "schedule";
  if (!isScheduled) {
    const secret = new URL(req.url).searchParams.get("secret");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const rawStore = getStore("ingest-raw");
  const canonicalStore = getStore("ingest-canonical");
  const runsStore = getStore("ingest-runs");
  const log = { runId, schemaVersion: SCHEMA_VERSION, startedAt: Date.now(), sources: {}, ok: true };

  try {
    const seasons = targetSeasons();
    const { raw, media } = await ingestAniList({ seasons });
    await rawStore.setJSON(`anilist/${runId}`, { fetchedAt: Date.now(), seasons, pages: raw.length, payloads: raw });

    let upserts = 0;
    for (const md of media) {
      const key = `anilist:${md.id}`;
      const existing = await canonicalStore.get(key, { type: "json" }).catch(() => null);
      await canonicalStore.setJSON(key, mergeRecord(existing, normalizeAniList(md)));
      upserts++;
    }
    log.sources.anilist = { ok: true, seasons, pages: raw.length, shows: media.length, upserts };
  } catch (err) {
    log.ok = false;
    log.sources.anilist = { ok: false, error: String((err && err.message) || err) };
    console.error("ingest: anilist failed", err);
  }

  // Stub sources: run each, archive whatever they return, never fail the whole
  // run over a source that isn't live yet.
  for (const [name, fn] of STUB_SOURCES) {
    try {
      const result = await fn();
      log.sources[name] = { ok: true, skipped: !!result.skipped, reason: result.reason, shows: result.media.length };
      if (result.raw.length) await rawStore.setJSON(`${name}/${runId}`, { fetchedAt: Date.now(), payloads: result.raw });
    } catch (err) {
      log.sources[name] = { ok: false, error: String((err && err.message) || err) };
      console.error(`ingest: ${name} failed`, err);
    }
  }

  log.finishedAt = Date.now();
  await runsStore.setJSON(`run-${runId}`, log);
  await runsStore.setJSON("latest", log);

  return new Response(JSON.stringify(log, null, 2), { headers: { "Content-Type": "application/json" } });
};
