// Automated simulcast/dub offset ingestion.
//
// WHAT THIS SOLVES
// AniList publishes the Japanese broadcast time and nothing else. Crunchyroll
// publishes when it actually posts each episode — including English dubs —
// with machine-readable <time datetime> values carrying an explicit UTC offset.
// Subtract one from the other and you get the real per-show offset. Measured by
// hand on 2026-08-04 those ranged from 0 to 63 minutes, so the "sub lands with
// the broadcast" estimate is wrong for most shows. This job measures them
// continuously instead.
//
// WHY PLAYWRIGHT AND NOT A SCHEDULED FUNCTION
// crunchyroll.com answers non-browser clients with 403. A Netlify Function
// can't get past that and can't run a browser. GitHub Actions can, on the same
// free minutes that already build the SEO pages.
//
// WHERE THE OUTPUT GOES — and why it costs no Netlify credits
// Derived data is written to data/derived-offsets.json at the REPO ROOT, not
// under site/. netlify.toml skips the deploy when nothing in site/ changed, so
// committing this is free (see refresh-pages.yml for the credit arithmetic).
// It reaches users through POST /api/overrides — the blob store, no deploy.
// So: git is the audit trail, the blob store is what serves.
//
// SAFETY
//   • Nothing is written unless a title matches AniList confidently AND
//     unambiguously (clear margin over the runner-up).
//   • Offsets outside a plausible band are reported, never written.
//   • Two observations of the same show that disagree cancel each other out.
//   • A rule carrying "pinned": true is never touched — that's the escape hatch
//     for a human decision the scraper would otherwise keep reverting.
//
// USAGE
//   node scripts/ingest-crunchyroll.mjs --dry-run          # derive, write nothing
//   node scripts/ingest-crunchyroll.mjs --rows rows.json   # skip the browser (tests)
//   node scripts/ingest-crunchyroll.mjs                    # derive, write, publish
//
// ENV: ADMIN_SECRET (to publish), SITE_URL (defaults to the production site)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(APP_DIR, "..");
const SITE = process.env.SITE_URL || "https://tsuzuki.netlify.app";
const CALENDAR = "https://www.crunchyroll.com/simulcastcalendar";
const OUT_DEFAULT = join(REPO, "data", "derived-offsets.json");

const ANILIST = "https://graphql.anilist.co";
const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
const seasonOf = m => (m <= 2 ? "WINTER" : m <= 5 ? "SPRING" : m <= 8 ? "SUMMER" : "FALL");
function shiftSeason(season, year, d) {
  let i = SEASONS.indexOf(season) + d;
  year += Math.floor(i / 4);
  i = ((i % 4) + 4) % 4;
  return { season: SEASONS[i], year };
}

/* ---------------- plausibility bands ----------------
   A simulcast lands within hours of broadcast; a dub within months. Anything
   outside these is far more likely to be a title mismatch than a real value,
   and a wrong time published confidently is worse than no time at all. */
const BAND = {
  sub: { min: -10, max: 12 * 60 },            // −10 min tolerates clock skew
  dub: { min: 0, max: 120 * 24 * 60 },        // up to ~4 months behind
};
const MIN_CONFIDENCE = 0.72;   // share of the Crunchyroll title's words that matched
const MIN_MARGIN = 0.15;       // …and how far clear of the runner-up it has to be

/* ---------------- language labels ----------------
   Crunchyroll suffixes a localized release with its language in parentheses.
   Everything not in DUB_MARKERS (Thai, Indonesian, German…) is ignored: we only
   model the original subtitled release and the English dub. */
const DUB_MARKERS = new Set(["english", "english dub", "englisch"]);
export function parseLang(rawTitle) {
  const m = String(rawTitle || "").match(/\(([^)]+)\)\s*$/);
  const clean = String(rawTitle || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!m) return { clean, kind: "sub" };
  const tag = m[1].trim().toLowerCase();
  if (DUB_MARKERS.has(tag)) return { clean, kind: "dub", label: m[1].trim() };
  return { clean, kind: "other", label: m[1].trim() };
}

/* ---------------- title matching ---------------- */
// Season markers carry real meaning ("Season 2" is a different show) so the
// number is kept, but the word itself is dropped so "Staffel"/"Season" don't
// have to agree across locales.
const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "no", "wa", "ga", "season", "staffel", "part", "cour"]);
export function normWords(s) {
  return String(s || "")
    .toLowerCase().normalize("NFKD")
    .replace(/[’']/g, "")
    // "Season 1" is implicit — AniList titles a first season without it, so
    // keeping the "1" would sink an otherwise perfect match ("LIAR GAME
    // Staffel 1" vs "LIAR GAME"). Higher season numbers are load-bearing and
    // stay: season 2 really is a different show.
    .replace(/\b(season|staffel|part|cour)\s*0*1\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(w => w && !STOP.has(w));
}

export function indexAniList(media) {
  return media.map(md => {
    const titles = [md.title?.english, md.title?.romaji, ...(md.synonyms || [])].filter(Boolean);
    return {
      mediaId: md.id,
      title: md.title?.english || md.title?.romaji || String(md.id),
      wordSets: titles.map(t => new Set(normWords(t))),
      eps: new Map(((md.airingSchedule?.nodes) || []).map(n => [n.episode, n.airingAt])),
      streams: new Set(((md.externalLinks) || []).filter(l => l?.type === "STREAMING").map(l => l.site)),
    };
  });
}

export function matchTitle(crTitle, index) {
  const w = normWords(crTitle);
  if (!w.length) return null;
  const want = new Set(w);

  const scored = index.map(entry => {
    let score = 0, exact = false;
    for (const ws of entry.wordSets) {
      let hit = 0;
      for (const x of want) if (ws.has(x)) hit++;
      // Penalise a candidate carrying words the query lacks, so a sequel can't
      // win on a base-series title.
      const extra = [...ws].filter(x => !want.has(x)).length;
      const s = hit / want.size - extra * 0.08;
      if (s > score) score = s;
      if (hit === want.size && extra === 0) exact = true;
    }
    return { entry, score, exact };
  });

  // A set-identical title is unambiguous by definition, so it skips the margin
  // rule. Without this, every show that has a sequel in the same window would
  // be refused: "Skeleton Knight in Another World" scores 1.0 while
  // "…Season 2" scores 0.92, a margin too thin to clear on its own.
  const exacts = scored.filter(s => s.exact);
  if (exacts.length === 1) {
    const { entry, score } = exacts[0];
    return { ...entry, confidence: +score.toFixed(3), margin: 1, exact: true };
  }
  if (exacts.length > 1) return null;   // genuinely indistinguishable — refuse

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0], second = scored[1];
  if (!best || best.score < MIN_CONFIDENCE) return null;
  const margin = best.score - (second ? second.score : 0);
  if (margin < MIN_MARGIN) return null;   // ambiguous: refuse rather than coin-flip
  return { ...best.entry, confidence: +best.score.toFixed(3), margin: +margin.toFixed(3), exact: false };
}

/* ---------------- cadence ----------------
   To place an episode outside the fetched window (dubs run behind) we need the
   broadcast cadence. Only extrapolate when the observed gaps are actually
   uniform — an irregular schedule gets skipped, not guessed at. */
export function episodeTime(entry, ep) {
  if (entry.eps.has(ep)) return { ts: entry.eps.get(ep), derived: false };
  const known = [...entry.eps.entries()].sort((a, b) => a[0] - b[0]);
  if (known.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < known.length; i++) {
    const dEp = known[i][0] - known[i - 1][0];
    if (dEp <= 0) return null;
    gaps.push((known[i][1] - known[i - 1][1]) / dEp);
  }
  const step = gaps[0];
  if (!step || gaps.some(g => Math.abs(g - step) > 3600)) return null;   // not a regular schedule
  return { ts: known[0][1] + (ep - known[0][0]) * step, derived: true, stepDays: +(step / 86400).toFixed(3) };
}

/* ---------------- derivation ---------------- */
export function deriveOffsets(rows, index) {
  const findings = [], skipped = [];
  for (const row of rows) {
    const { clean, kind, label } = parseLang(row.title);
    if (kind === "other") { skipped.push({ ...row, why: `ignored language: ${label}` }); continue; }
    if (!row.iso || !row.ep) { skipped.push({ ...row, why: "missing time or episode" }); continue; }

    const m = matchTitle(clean, index);
    if (!m) { skipped.push({ ...row, why: "no confident AniList match" }); continue; }

    const at = episodeTime(m, row.ep);
    if (!at) { skipped.push({ ...row, why: `can't place ep ${row.ep} (irregular or unknown schedule)` }); continue; }

    const crTs = Math.floor(new Date(row.iso).getTime() / 1000);
    if (!Number.isFinite(crTs)) { skipped.push({ ...row, why: "unparseable timestamp" }); continue; }

    const offsetMin = Math.round((crTs - at.ts) / 60);
    const band = BAND[kind];
    if (offsetMin < band.min || offsetMin > band.max) {
      skipped.push({ ...row, why: `offset ${offsetMin}min outside the plausible ${kind} band — likely a mismatch` });
      continue;
    }
    findings.push({
      mediaId: m.mediaId, title: m.title, crTitle: clean, kind, episode: row.ep,
      offsetMin, cadenceDerived: !!at.derived, confidence: m.confidence, observedAt: row.iso,
    });
  }

  // Two observations of the same show and release type that disagree mean one
  // of them is wrong and we can't tell which. Drop both.
  const byKey = new Map();
  for (const f of findings) {
    const k = f.mediaId + "|" + f.kind;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  }
  const agreed = [];
  for (const [k, list] of byKey) {
    const offsets = new Set(list.map(f => f.offsetMin));
    if (offsets.size === 1) agreed.push({ ...list[0], observations: list.length });
    else skipped.push({ title: list[0].title, why: `conflicting offsets ${[...offsets].join("/")} — needs a human`, key: k });
  }
  return { findings: agreed, skipped };
}

/* ---------------- patch ---------------- */
export function buildPatch(findings, existingShows = {}) {
  const shows = {}, pinned = [];
  for (const f of findings) {
    const id = String(f.mediaId);
    const cur = existingShows[id]?.[f.kind];
    if (cur?.pinned) { pinned.push(`${f.title} (${f.kind})`); continue; }
    if (cur && cur.offsetMin === f.offsetMin) continue;   // nothing changed; don't churn the store
    shows[id] = shows[id] || {};
    shows[id][f.kind] = {
      offsetMin: f.offsetMin,
      platform: "Crunchyroll",
      source: "crunchyroll.com/simulcastcalendar (automated)" + (f.cadenceDerived ? " — episode placed from a confirmed uniform cadence" : ""),
      verifiedAt: new Date().toISOString().slice(0, 10),
    };
  }
  return { patch: { shows }, pinned };
}

/* ---------------- scraping (the only impure part) ---------------- */
async function scrapeCalendar() {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { throw new Error("playwright is not installed — run `npm i -D playwright && npx playwright install chromium`, or pass --rows"); }

  const browser = await chromium.launch();
  try {
    // en-US so the language suffixes are the English ones DUB_MARKERS knows.
    const ctx = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
    const page = await ctx.newPage();
    await page.goto(CALENDAR, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // "attached", not the default "visible": the extraction below is a
    // querySelectorAll, which does not care whether an element has a box. The
    // stricter default turned "the page rendered but something is overlaying
    // it" into the same timeout as "the page never rendered at all".
    try {
      await page.waitForSelector("time.available-time", { state: "attached", timeout: 45_000 });
    } catch (e) {
      // A headless scrape that fails in CI and works on a laptop is unfixable
      // without seeing what the runner saw. Dump it next to the log; the
      // workflow uploads these as artifacts when the step fails.
      const where = "/tmp";
      const url = page.url();
      const title = await page.title().catch(() => "(no title)");
      const counts = await page.evaluate(() => ({
        anyTime: document.querySelectorAll("time").length,
        availableTime: document.querySelectorAll("time.available-time").length,
        articles: document.querySelectorAll("article").length,
        calendarDays: document.querySelectorAll(".calendar-day").length,
        bodyChars: (document.body && document.body.innerText || "").length,
      })).catch(() => ({}));
      await page.screenshot({ path: `${where}/crunchyroll-fail.png`, fullPage: true }).catch(() => {});
      await writeFile(`${where}/crunchyroll-fail.html`, await page.content().catch(() => ""), "utf8").catch(() => {});
      throw new Error(
        `Calendar never rendered. final URL: ${url} | title: ${title} | ` +
        `DOM counts: ${JSON.stringify(counts)} | original: ${e.message.split("\n")[0]}`
      );
    }
    return await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll("time.available-time").forEach(t => {
        const scope = t.closest("article") || t.parentElement?.parentElement;
        if (!scope) return;
        const lines = (scope.innerText || "").split("\n").map(s => s.trim()).filter(Boolean);
        const titleLine = lines.find(l => l !== t.textContent.trim() && !/episode/i.test(l)) || "";
        const epLine = lines.find(l => /episode/i.test(l)) || "";
        const ep = (epLine.match(/(\d+)/) || [])[1];
        const iso = t.getAttribute("datetime");
        if (!iso || !titleLine) return;
        out.add(JSON.stringify({ iso, ep: ep ? +ep : null, title: titleLine }));
      });
      return [...out].map(s => JSON.parse(s));
    });
  } finally { await browser.close(); }
}

async function fetchAniList() {
  const now = new Date();
  const cur = seasonOf(now.getMonth()), yr = now.getFullYear();
  const targets = [shiftSeason(cur, yr, -1), { season: cur, year: yr }, shiftSeason(cur, yr, 1)];
  const q = `query($season:MediaSeason,$seasonYear:Int,$page:Int){
    Page(page:$page,perPage:50){ pageInfo{hasNextPage} media(season:$season,seasonYear:$seasonYear,type:ANIME,sort:POPULARITY_DESC){
      id title{romaji english} synonyms externalLinks{site type} airingSchedule{nodes{episode airingAt}} } } }`;
  const seen = new Set(), all = [];
  for (const t of targets) {
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(ANILIST, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: q, variables: { season: t.season, seasonYear: t.year, page } }),
      });
      if (!res.ok) throw new Error("AniList HTTP " + res.status);
      const j = await res.json();
      if (j.errors) throw new Error(j.errors[0].message);
      for (const md of j.data.Page.media) if (!seen.has(md.id)) { seen.add(md.id); all.push(md); }
      if (!j.data.Page.pageInfo.hasNextPage) break;
      await new Promise(r => setTimeout(r, 800));   // stay well inside AniList's ~30/min
    }
  }
  return all;
}

/* ---------------- run ---------------- */
async function main() {
  const argv = process.argv.slice(2);
  const flag = n => argv.includes(n);
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const dryRun = flag("--dry-run");
  const rowsFile = opt("--rows");
  const outFile = opt("--out") || OUT_DEFAULT;

  // Preflight the write path BEFORE spending five minutes in a browser. A
  // wrong secret or a down site used to surface as a throw at the very end,
  // after the summary had already been written — which reads like "the ingest
  // worked but the job failed" and is the hardest kind of failure to diagnose.
  // An empty patch is a valid no-op write, so this costs nothing but proves
  // both reachability and authorisation.
  if (!dryRun && process.env.ADMIN_SECRET) {
    const r = await fetch(`${SITE}/api/overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tsuzuki-secret": process.env.ADMIN_SECRET },
      body: JSON.stringify({ shows: {} }),
    }).catch(e => { throw new Error(`Preflight: cannot reach ${SITE} — ${e.message}`); });
    if (r.status === 403) {
      throw new Error(`Preflight: ${SITE} rejected the secret (403). The ADMIN_SECRET in this repo's Actions secrets must match the ADMIN_SECRET environment variable on Netlify.`);
    }
    if (!r.ok) {
      throw new Error(`Preflight: ${SITE}/api/overrides returned ${r.status}. ${(await r.text().catch(() => "")).slice(0, 200)}`);
    }
    console.log("Preflight OK — the live store is reachable and the secret is accepted.");
  }

  const rows = rowsFile
    ? JSON.parse(await readFile(rowsFile, "utf8"))
    : await scrapeCalendar();
  console.log(`Crunchyroll calendar: ${rows.length} release rows`);
  if (!rows.length) { console.log("Nothing published right now — exiting cleanly."); return; }

  const media = await fetchAniList();
  console.log(`AniList: ${media.length} titles across three seasons`);
  const index = indexAniList(media);

  const { findings, skipped } = deriveOffsets(rows, index);
  console.log(`\nDerived ${findings.length} offsets (${skipped.length} rows skipped):`);
  for (const f of findings) {
    console.log(`  ${String(f.offsetMin).padStart(7)}min  ${f.kind.padEnd(3)}  ${f.title}` +
      (f.cadenceDerived ? "  [cadence-derived]" : ""));
  }
  for (const s of skipped) console.log(`  · skipped: ${s.title || s.key} — ${s.why}`);

  // What's already live, so we neither clobber a pin nor rewrite an unchanged value.
  let existing = {};
  try {
    const r = await fetch(`${SITE}/api/overrides`);
    if (r.ok) existing = (await r.json()).shows || {};
  } catch (e) { console.warn("Couldn't read live overrides — treating everything as new:", e.message); }

  const { patch, pinned } = buildPatch(findings, existing);
  for (const p of pinned) console.log(`  · left alone (pinned): ${p}`);
  const changed = Object.keys(patch.shows).length;
  console.log(`\n${changed} show${changed === 1 ? "" : "s"} to update.`);

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: CALENDAR,
    note: "Machine-derived. Audit trail only — the live store at /api/overrides is what serves. Lives outside site/ so committing it costs no Netlify deploy.",
    findings, skipped,
  }, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outFile}`);

  if (dryRun) { console.log("--dry-run: not publishing."); return; }
  if (!changed) { console.log("Nothing changed — not publishing."); return; }
  const secret = process.env.ADMIN_SECRET;
  if (!secret) { console.log("ADMIN_SECRET not set — derived data written, but not published."); return; }

  const res = await fetch(`${SITE}/api/overrides`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tsuzuki-secret": secret },
    body: JSON.stringify(patch),
  });
  // Read the body as text first: a 5xx from the platform is an HTML error page,
  // and parsing it as JSON silently swallowed the only evidence of what went
  // wrong, leaving a bare "Publish failed: 502".
  const raw = await res.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { /* not JSON — the raw text is the message */ }
  if (!res.ok || body.ok === false) {
    throw new Error(`Publish failed: ${res.status} ${body.error || raw.slice(0, 300) || "(empty response)"}`);
  }
  console.log(`Published: ${body.shows} shows now in the live store.`);
}

// Only run when invoked directly, so the pure helpers above stay importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error("ingest-crunchyroll failed:", e.message); process.exit(1); });
}
