#!/usr/bin/env node
/* Pure-logic checks over the swipe feed in site/index.html — which titles the
   pool offers, how the weighted sampler picks from it, and the guards that stop
   the "widen the pool" path from re-rendering itself forever.
   No DOM, no network, no clock.

   THE FUNCTIONS ARE EXTRACTED, NOT COPIED — same reason and same brace-matching
   lift as scripts/test-ratings.mjs: the client is one file with no build step,
   so a rename or a deletion has to fail here loudly rather than leave this
   passing against a fossil.

   The loop this guards against was real: feedServe() widened the pool whenever
   it held fewer than 25 titles, and re-rendered when the widening landed. With
   a pool that stays empty — everything loaded already watched, rated, dismissed
   or skipped — the re-render called straight back into feedServe, the memoised
   fetch resolved instantly and added nothing, and the two spun against each
   other rebuilding the whole feed panel until the tab ran out of memory. Every
   ingredient is cheap to model, so it is modelled.

   Run: node scripts/test-feed.mjs                */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "site", "index.html"), "utf8");

// The app's inline script is the one <script> with no src and no type.
const SCRIPT = (() => {
  const re = /<script(?![^>]*src=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m, best = "";
  while ((m = re.exec(HTML))) {
    if (/ld\+json/.test(m[1])) continue;
    if (m[2].length > best.length) best = m[2];
  }
  if (!best) throw new Error("could not find the app script in site/index.html");
  return best;
})();

/* ---------- extraction ---------- */
// Balanced-brace scan from the opening { of a declaration. Strings, template
// literals and comments all contain braces, so it has to tokenize rather than
// count characters.
function endOfBlock(src, from) {
  let depth = 0, i = src.indexOf("{", from);
  if (i < 0) throw new Error("no block");
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") { i++; continue; }
        if (src[i] === q) break;
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") i = endOfBlock(src, i + 1);
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  throw new Error("unbalanced block");
}

function endOfStatement(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") { i++; continue; }
        if (src[i] === q) break;
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") i = endOfBlock(src, i + 1);
      }
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth === 0) return i;
  }
  throw new Error("unterminated statement");
}

function grab(name) {
  let m = new RegExp(`^function\\s+${name}\\s*\\(`, "m").exec(SCRIPT);
  if (m) return SCRIPT.slice(m.index, endOfBlock(SCRIPT, m.index + m[0].length) + 1);
  m = new RegExp(`^(?:const|let)\\s+${name}\\s*=`, "m").exec(SCRIPT);
  if (m) return SCRIPT.slice(m.index, endOfStatement(SCRIPT, m.index) + 1);
  throw new Error(`site/index.html no longer declares \`${name}\` — this test needs updating`);
}

// `feedWidening`'s declaration carries `feedWidened` alongside it, and both are
// module-level `let`s the extracted feedServe closes over. They are why every
// test builds its own context instead of sharing one: a latch that is supposed
// to fire once per session cannot be tested twice in the same session.
const NEEDED = ["FEED_SKIP_MAX", "FEED_TILT", "saveFeedSkips", "feedPool", "feedWeight", "feedPick", "feedWidening", "feedServe"];
const SOURCE = NEEDED.map(grab).join("\n") + `\n;globalThis.__api = { ${NEEDED.join(", ")} };`;

/* ---------- a fresh app, per test ---------- */
/* opts.seasonless: what the widening fetch resolves with (default: nothing new)
   opts.rand:       the sampler's random source (default: dead centre)         */
function build(opts = {}) {
  const state = {
    media: [], extra: new Map(), watch: new Set(), recNo: new Set(), hidden: new Set(),
    ratings: {}, feedSkip: new Set(), feedCard: null, feedAsk: null, feedCount: 0,
    viewMode: "recs", recMode: "feed",
  };
  const calls = { fetchSeasonless: 0, renderRecs: 0 };

  // The real one memoises into state.seasonCache: the first call may add
  // titles, every call after it resolves instantly and adds nothing. That
  // "instantly, and nothing" is the whole shape of the bug.
  let served = false;
  const fetchSeasonless = async () => {
    calls.fetchSeasonless++;
    if (served) return [];
    served = true;
    return opts.seasonless || [];
  };

  const sandbox = {
    state,
    console,
    Math: Object.assign(Object.create(Math), { random: opts.rand || (() => 0.5) }),
    localStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } },
    isHidden: id => state.hidden.has(String(id)),
    excluded: md => !!(md && md.__excluded),
    getRating: id => state.ratings[String(id)] || 0,
    // No profile: the sampler falls back to popularity alone, which is the part
    // this file is about. The taste maths has its own suite.
    tasteReady: () => false,
    tasteVectors: () => ({ myMean: 7 }),
    predictScore: () => null,
    predUsable: () => false,
    fetchSeasonless,
    // Mirrors renderRecs' feed branch exactly: it serves a card when it hasn't
    // got one. Anything less and the test cannot see the loop.
    renderRecs: () => { calls.renderRecs++; if (!state.feedCard) sandbox.__api.feedServe(); },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "extracted-from-index.html" });
  return { state, calls, api: sandbox.__api, localStorage: sandbox.localStorage };
}

const show = (id, extra = {}) => ({ id: String(id), popularity: 1000, title: { english: "Show " + id }, ...extra });
// Long enough for a runaway to be unmistakable: the real loop turned over every
// ~25ms, so anything that has not settled by now never will.
const settle = async () => { for (let i = 0; i < 500; i++) await Promise.resolve(); };

/* ---------- harness ---------- */
let pass = 0, fail = 0;
function ok(what, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${what}`); }
  else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`); }
}
function section(name) { console.log(`\n${name}`); }

/* ---------- the pool ---------- */
section("What the feed will offer");
{
  const { state, api } = build();
  state.media = [show(1), show(2), show(3), show(4), show(5), show(6), show(7)];
  state.extra.set("8", show(8));

  ok("everything loaded is fair game to begin with", api.feedPool().length === 8);

  state.watch.add("1");
  state.ratings["2"] = 8;
  state.recNo.add("3");
  state.feedSkip.add("4");
  state.hidden.add("5");
  state.media[5].__excluded = true;              // id 6
  const ids = api.feedPool().map(md => md.id);
  ok("a show already on your board is not asked about", !ids.includes("1"));
  ok("…nor is one you have already scored", !ids.includes("2"));
  ok("…nor one you dismissed", !ids.includes("3"));
  ok("…nor one you skipped", !ids.includes("4"));
  ok("…nor one you hid", !ids.includes("5"));
  ok("…nor one your content settings exclude", !ids.includes("6"));
  ok("what is left is what is left", ids.join(",") === "7,8", ids.join(","));

  state.extra.set("7", show(7));
  ok("a show in both collections is offered once",
    api.feedPool().filter(md => md.id === "7").length === 1);
}

/* ---------- the sampler ---------- */
section("Picking a card");
{
  const { state, api } = build();
  ok("an empty pool yields no card, rather than a broken one", api.feedPick() === null);

  state.media = [show(1)];
  ok("one candidate is the pick", api.feedPick().id === "1");
}
{
  // Weight is √popularity, so a title 100× more popular is drawn 10× as often.
  // Sampling rather than asserting on internals: the promise the feed makes is
  // about what you see, not about the arithmetic behind it.
  let seed = 1;
  const { state, api } = build({ rand: () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 });
  state.media = [show("big", { popularity: 1000000 }), show("small", { popularity: 10000 })];
  let big = 0;
  for (let i = 0; i < 2000; i++) if (api.feedPick().id === "big") big++;
  ok("popularity steers the draw without owning it", big > 1600 && big < 1900, `${big}/2000`);
}
{
  const { state, api } = build();
  state.media = [show(1), show(2)];
  state.feedAsk = "1";
  api.feedServe();
  ok("a fresh card is never mid-question", state.feedAsk === null);
}

/* ---------- the widening, and the loop it used to cause ---------- */
section("Widening a thin pool");
{
  // The regression. Empty pool, memoised fetch with nothing to add: the render
  // and the serve must not keep handing the turn back to each other.
  const { state, calls, api } = build();
  api.feedServe();
  await settle();
  ok("an empty pool that cannot be widened settles instead of looping",
    calls.renderRecs <= 1, `renderRecs ran ${calls.renderRecs}×`);
  ok("…and stops asking for a set that has nothing left to give",
    calls.fetchSeasonless <= 1, `fetchSeasonless ran ${calls.fetchSeasonless}×`);
  ok("…leaving the empty state to say so", state.feedCard === null);
}
{
  // Same shape from the other end: the app's own entry point, not feedServe's.
  const { calls, api } = build();
  api.feedServe();          // arm the widening
  await settle();
  const after = calls.renderRecs;
  await settle();
  ok("nothing keeps turning over once it has settled", calls.renderRecs === after,
    `${after} -> ${calls.renderRecs}`);
}
{
  // The widening still has to work: when it lands titles, the card that could
  // not be served before gets served.
  const { state, calls, api } = build({ seasonless: [show(101), show(102)] });
  api.feedServe();
  ok("nothing to serve at the moment the pool is dry", state.feedCard === null);
  await settle();
  ok("the widening puts what it fetched into play", state.extra.size === 2);
  ok("…and re-renders exactly once to show it", calls.renderRecs === 1, `${calls.renderRecs}`);
  ok("…which serves the card", state.feedCard !== null && ["101", "102"].includes(state.feedCard.id));
}
{
  // A pool over the threshold is not a pool worth widening.
  const { state, calls, api } = build();
  state.media = Array.from({ length: 40 }, (_, i) => show(i + 1));
  api.feedServe();
  await settle();
  ok("a healthy pool is left alone", calls.fetchSeasonless === 0);
  ok("…and still serves", state.feedCard !== null);
}
{
  // Draining a full pool by swiping is the path a real session takes into the
  // empty state, and it must arrive there quietly.
  const { state, calls, api } = build();
  state.media = Array.from({ length: 60 }, (_, i) => show(i + 1));
  let serves = 0;
  api.feedServe();
  while (state.feedCard && serves < 500) { state.feedSkip.add(String(state.feedCard.id)); api.feedServe(); serves++; }
  await settle();
  ok("swiping through the whole pool ends, and ends empty", serves === 60 && state.feedCard === null,
    `${serves} serves, card ${state.feedCard && state.feedCard.id}`);
  ok("…without a runaway on the far side", calls.renderRecs <= 1, `renderRecs ran ${calls.renderRecs}×`);
}

/* ---------- the skip key ---------- */
/* Skips are the one thing a feed session accumulates without limit, and they go
   to localStorage, so the cap is what keeps a heavy user off the quota. */
section("Remembered skips");
{
  const { state, api, localStorage } = build();
  const over = api.FEED_SKIP_MAX + 250;
  for (let i = 0; i < over; i++) state.feedSkip.add("id" + i);
  api.saveFeedSkips();
  const stored = JSON.parse(localStorage.getItem("anical.feedskip"));
  ok("the key is capped, however long the session ran",
    stored.length === api.FEED_SKIP_MAX, `${stored.length} of ${over}`);
  ok("…keeping the most recent skips, not the first ones",
    stored[stored.length - 1] === "id" + (over - 1), stored[stored.length - 1]);
}

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
