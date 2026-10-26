// Historical backfill — 2026·11 decade-roadmap milestone.
//
// Iterates through historical seasons (2000–present) and calls the ingest
// function for each, one at a time, respecting rate limits. Run locally:
//
//   CRON_SECRET=xxx node scripts/backfill-historical.mjs [startYear] [endYear]
//
// Defaults to 2000–present. Each season is one HTTP call to the ingest
// function's ?season=&year= override, so it works with the existing worker.
//
// The ingest worker handles one season per run and writes to the catalog, so
// this is just a driver that loops through seasons sequentially.
//
// Auth is the plain `x-tsuzuki-secret` header, the same one the scheduled
// worker's manual trigger uses. There is no HMAC signature scheme here: an
// earlier draft carried a sign() helper that nothing ever called, which is
// worse than no helper because it implied a scheme the server does not verify.

const BASE = "https://tsuzuki.top/.netlify/functions/ingest";
const SEASONS = ["WINTER","SPRING","SUMMER","FALL"];
const startYear = process.argv[2] ? parseInt(process.argv[2], 10) : 2000;
const endYear = process.argv[3] ? parseInt(process.argv[3], 10) : new Date().getUTCFullYear();
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("Set CRON_SECRET environment variable.");
  process.exit(1);
}

async function ingestSeason(season, year) {
  const url = `${BASE}?season=${season}&year=${year}`;
  console.log(`Backfilling ${season} ${year}...`);
  const res = await fetch(url, {
    headers: { "x-tsuzuki-secret": secret, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`  ${season} ${year}: HTTP ${res.status}`);
    return false;
  }
  const log = await res.json();
  const sources = Object.entries(log.sources || {}).map(([k,v]) =>
    `${k}:${v.ok?"ok":"fail"}${v.skipped?" (skipped)":""}${v.reason?" ["+v.reason+"]":""}`).join(", ");
  console.log(`  ${season} ${year}: ${sources}`);
  return true;
}

async function main() {
  let failures = 0;
  for (let y = startYear; y <= endYear; y++) {
    for (const season of SEASONS) {
      const ok = await ingestSeason(season, y);
      if (!ok) failures++;
      // Rate limit: 1 second between seasons to stay under AniList's budget.
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log(`\nBackfill complete. ${failures} failure(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
