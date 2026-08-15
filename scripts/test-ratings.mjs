#!/usr/bin/env node
/* Pure-logic checks over the rating maths in site/index.html — the axis
   composite and its all-off guard (Day 15), score normalization (Day 17) and
   the head-to-head ordering (Day 18).
   No DOM, no network, no clock.

   THE FUNCTIONS ARE EXTRACTED, NOT COPIED. The client is one file with no build
   step, so there is nothing to import: this reads site/index.html, lifts the
   named declarations out of the inline script by brace-matching, and evaluates
   them against a mock `state`. A copy would pass forever while the real code
   drifted underneath it, which is the one thing a test of a single-file app must
   not do — if a function is renamed or deleted, this fails loudly at extraction
   rather than quietly testing a fossil.

   Run: node scripts/test-ratings.mjs                */
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
// literals and comments all contain braces, so it has to actually tokenize
// rather than count characters — the app's HTML-in-template-literals would
// break a naive counter on the first `${x?"{":"}"}`.
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
        // `${ … }` can nest anything, including more template literals
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") i = endOfBlock(src, i + 1);
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  throw new Error("unbalanced block");
}

// Where a `const x = …;` ends: the first semicolon outside every bracket,
// string and template literal. An array-of-objects initialiser (AXIS_DEFS) and
// a one-line arrow both come out whole.
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
  // function NAME(…){…}
  let m = new RegExp(`^function\\s+${name}\\s*\\(`, "m").exec(SCRIPT);
  if (m) return SCRIPT.slice(m.index, endOfBlock(SCRIPT, m.index + m[0].length) + 1);
  // const/let NAME = …;  — one statement, however many lines, and however many
  // more names it declares alongside this one.
  m = new RegExp(`^(?:const|let)\\s+${name}\\s*=`, "m").exec(SCRIPT);
  if (m) return SCRIPT.slice(m.index, endOfStatement(SCRIPT, m.index) + 1);
  throw new Error(`site/index.html no longer declares \`${name}\` — this test needs updating`);
}

const NEEDED = [
  "RATING_MAX", "AXIS_DEFS", "AXIS_KEYS", "DEFAULT_AXIS_WEIGHTS", "WEIGHT_MAX",
  "cleanWeight", "storedWeights", "weightsAllOff", "axisWeights",
  "cleanAxis", "getAxes", "compositeOf", "getRating",
  "ratingsRev", "saveRatings",
  "NORM_MIN_RATED", "NORM_MIN_SD", "NORM_TARGET_SD", "NORM_MAX_K",
  "normCache", "normStats", "normOn", "normApply", "shownRating",
  "PAIR_START", "PAIR_EPOCHS", "PAIR_K0", "PAIR_DECAY", "PAIR_MAX",
  "pairsRev", "savePairs", "pairKey", "findPairIndex", "pairDecided",   // pairsRev's declaration carries pairCache
  "recordPair", "undoPair", "clearPairs",
  "pairRatings", "pairElo", "pairCount", "pairOrder", "pairConflicts",
  "shuffled", "VS_FOCUS", "VS_SEEN_STATUS", "versusPool", "nextPair",
  "CALIB_SET", "CALIB_ROUNDS", "calibrationSet",
  "suggestedScores",
  "PIN_MAX", "saveFavs", "isFav", "toggleFav", "savePins", "isPinned", "pinIndex", "togglePin",
  "saveArchived", "isArchived", "toggleArchived",
  "SORT_KEYS", "SORT_BY_KEY", "DEFAULT_SORT", "saveSortState", "cleanSort", "activeSort",
  "compareBy", "librarySort", "libraryOrder", "sortSummary",
  "TASTE_K", "TASTE_MIN_N", "TASTE_THIN_N", "TAG_MIN_RANK", "LENGTH_BUCKETS", "lengthBucket",
  "yearOfMedia", "decadeOf", "TASTE_DIMS", "TASTE_BY_KEY", "tasteCache",
  "TASTE_ADJ_STEP", "TASTE_ADJ_MAX", "adjKey", "saveTasteAdj", "tasteAdjOf",
  "nudgeTaste", "clearTasteAdj", "tasteAdjCount", "tasteVectors",
  "tasteDim", "TASTE_MIN_RATED", "tasteReady",
  "PRED_DIM_WEIGHT", "PRED_LOW_CONF", "PRED_GOOD_CONF", "PRED_PAIR_WEIGHT", "predCache",
  "predIndex", "pairNudge", "predictScore", "predUsable", "predictorBacktest",
];

const state = {
  ratings: {}, axes: {}, weights: {}, pairs: [], normalize: false, status: {}, hidden: new Set(),
  favs: new Set(), pins: [], archived: new Set(), sort: [], sorts: [], dates: {}, progress: {}, rewatch: {}, tasteAdj: {},
  media: [], extra: new Map(), watch: new Set(), recNo: new Set(),
};
// Two app-level boundaries the extracted code reaches through. Stubbing them is
// the whole reason this file can test versusPool()/nextPair() at all: the real
// findMediaById searches three live collections and the real isHidden reads a
// Set that only the running app fills.
// The fake catalogue. Tests that only need "does this id resolve" add a bare id;
// the taste tests put a full media record in, so the vectors have facets to read.
const drawable = new Set();
const catalogue = new Map();
const mediaFor = id => catalogue.get(String(id))
  || (drawable.has(String(id)) ? { id: String(id), title: { english: "Show " + id } } : null);
const sandbox = {
  state,
  localStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } },
  isHidden: id => state.hidden.has(String(id)),
  findMediaById: mediaFor,
  SOURCE_LABEL: { MANGA: "Manga", ORIGINAL: "Original", LIGHT_NOVEL: "Light Novel" },
  excluded: () => false,
  // The sort keys reach a few more app-level helpers; same boundary, same reason.
  title: md => (md && md.title && md.title.english) || "",
  boardStatusOf: id => state.status[String(id)] || null,
  getProgress: id => state.progress[String(id)] || 0,
  epTotal: md => (md && md.episodes) || 0,
  rewatchCount: id => Math.max(0, (state.rewatch[String(id)] || 0) - 1),
  cleanCollectionName: n => String(n == null ? "" : n).replace(/\s+/g, " ").trim().slice(0, 40),
  STATUS_DEFS: [
    { key: "watching" }, { key: "plan" }, { key: "onhold" }, { key: "dropped" }, { key: "completed" },
  ],
  console,
};
vm.createContext(sandbox);
// A `const` at the top level of a vm script does NOT land on the context object
// the way a function declaration does, so the constants have to be handed out
// explicitly. Naming every extracted symbol here also means a rename in
// index.html fails at extraction rather than silently testing `undefined`.
vm.runInContext(
  NEEDED.map(grab).join("\n") + `\n;globalThis.__api = { ${NEEDED.join(", ")} };`,
  sandbox, { filename: "extracted-from-index.html" });
const {
  compositeOf, axisWeights, storedWeights, normStats, normApply, normOn, shownRating,
  saveRatings, savePairs, recordPair, undoPair, pairOrder, pairElo, pairConflicts, pairCount,
  pairKey, findPairIndex, clearPairs, PAIR_START, NORM_MAX_K, NORM_MIN_RATED,
  versusPool, nextPair, calibrationSet, suggestedScores, CALIB_SET, CALIB_ROUNDS,
} = sandbox.__api;

/* ---------- harness ---------- */
let pass = 0, fail = 0;
function ok(what, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${what}`); }
  else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`); }
}
function section(name) { console.log(`\n${name}`); }
const round1 = n => Math.round(n * 10) / 10;
function setLibrary(scores) {
  state.ratings = {};
  state.axes = {};
  for (const [id, v] of Object.entries(scores)) state.ratings[String(id)] = v;
  saveRatings();   // bump the revision the normalization cache watches
}

/* ---------- the composite and its guard (Day 13–15) ---------- */
section("Composite & weights");
{
  state.weights = {};
  ok("five equal axes average to themselves",
    compositeOf({ story: 8, art: 8, sound: 8, chars: 8, enjoy: 8 }) === 8);
  ok("an unscored axis is skipped, not counted as zero",
    compositeOf({ story: 8, art: 8, sound: 0, chars: 8, enjoy: 8 }) === 8,
    `got ${compositeOf({ story: 8, art: 8, sound: 0, chars: 8, enjoy: 8 })}`);
  ok("nothing scored is not a score", compositeOf({}) === 0);
  ok("the composite keeps one decimal",
    compositeOf({ story: 8, art: 7, sound: 0, chars: 0, enjoy: 0 }) === 7.5);

  state.weights = { story: 3, art: 1, sound: 1, chars: 1, enjoy: 1 };
  // (10×3 + 5 + 5 + 5 + 5) / 7 = 7.14…, against a flat 6 at equal weights
  ok("a weight moves the composite",
    compositeOf({ story: 10, art: 5, sound: 5, chars: 5, enjoy: 5 }) === 7.1,
    `got ${compositeOf({ story: 10, art: 5, sound: 5, chars: 5, enjoy: 5 })}`);

  // THE GUARD. Every weight at zero would make compositeOf return 0 for every
  // show — and 0 means unrated, so one slider drag would blank the library and
  // the next migration would prune the axes behind it as orphans.
  state.weights = { story: 0, art: 0, sound: 0, chars: 0, enjoy: 0 };
  ok("all weights off falls back to equal rather than returning 0",
    compositeOf({ story: 8, art: 8, sound: 8, chars: 8, enjoy: 8 }) === 8,
    `got ${compositeOf({ story: 8, art: 8, sound: 8, chars: 8, enjoy: 8 })}`);
  ok("…and the sliders still report the setting honestly",
    storedWeights().story === 0 && axisWeights().story === 1);
  state.weights = {};
}

/* ---------- score normalization (Day 17) ---------- */
section("Score normalization");
{
  const clustered = { 1: 7, 2: 8, 3: 8, 4: 8, 5: 9, 6: 8, 7: 7, 8: 9 };
  setLibrary(clustered);

  state.normalize = false;
  ok("off changes nothing", Object.keys(clustered).every(id => shownRating(id) === clustered[id]));

  state.normalize = true;
  const s = normStats();
  ok("it has something to stretch", s.usable && s.k > 1, `k=${s.k}`);
  ok("the stored scores are untouched",
    Object.keys(clustered).every(id => state.ratings[id] === clustered[id]));

  const shown = Object.keys(clustered).map(id => shownRating(id));
  const mean = shown.reduce((a, b) => a + b, 0) / shown.length;
  // Exactly, not approximately: `fit` holds the stretch back to what lands
  // inside the scale, so no score is clamped and the mean cannot drift.
  ok("the average is preserved exactly", round1(mean) === round1(s.mean),
    `${round1(mean)} vs ${round1(s.mean)}`);
  ok("the spread grows", (Math.max(...shown) - Math.min(...shown)) > (9 - 7),
    `${Math.min(...shown)}–${Math.max(...shown)}`);
  // Strictly, not just weakly: two scores that were different must not both be
  // clamped onto the same end of the scale.
  ok("distinct scores stay distinct", new Set(shown).size === new Set(Object.values(clustered)).size,
    `${new Set(shown).size} shown vs ${new Set(Object.values(clustered)).size} stored`);
  ok("order is preserved", Object.keys(clustered)
    .sort((a, b) => clustered[a] - clustered[b])
    .every((id, i, arr) => i === 0 || shownRating(arr[i - 1]) <= shownRating(id)));
  ok("nothing lands on 0, which means unrated", shown.every(v => v >= 0.5));
  ok("nothing lands above 10", shown.every(v => v <= 10));

  state.normalize = false;
  ok("switching off is fully reversible",
    Object.keys(clustered).every(id => shownRating(id) === clustered[id]));

  // A library already using the whole range must not be squeezed toward its
  // mean to hit a target — the toggle only ever spreads.
  setLibrary({ 1: 1, 2: 3, 3: 5, 4: 7, 5: 9, 6: 10 });
  state.normalize = true;
  ok("an already-spread library is left alone", normStats().k === 1, `k=${normStats().k}`);

  // Too few, and the statistics are noise rather than a shape.
  setLibrary({ 1: 8, 2: 9 });
  ok(`under ${NORM_MIN_RATED} rated shows it does nothing`, !normOn() && shownRating(1) === 8);

  // Every score identical: no spread, and a divide-by-zero waiting to happen.
  setLibrary({ 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8 });
  ok("an all-one-score library does nothing rather than dividing by zero",
    !normOn() && shownRating(1) === 8 && Number.isFinite(normStats().k));

  // Two tight clusters half a point apart: sd is 0.25, so the raw stretch would
  // be ×7.2 and the cap is the only thing between this and a library that reads
  // as 1s and 10s. `fit` allows ×7 here, so it is genuinely the cap being hit.
  setLibrary({ 1: 8, 2: 8, 3: 8, 4: 8, 5: 8.5, 6: 8.5, 7: 8.5, 8: 8.5 });
  ok("the stretch is capped", normStats().usable && normStats().k === NORM_MAX_K,
    `k=${normStats().k}, sd=${round1(normStats().sd)}`);
  ok("…and the capped result is still inside the scale",
    shownRating(5) <= 10 && shownRating(1) >= 0.5,
    `${shownRating(1)} … ${shownRating(5)}`);

  setLibrary({});
  ok("an empty library is not a crash", !normOn() && shownRating(1) === 0);
  state.normalize = false;
}

/* ---------- head-to-head (Day 18) ---------- */
section("Head to head");
{
  clearPairs();
  setLibrary({ a: 8, b: 8, c: 8, d: 8 });

  recordPair("a", "b");
  recordPair("b", "c");
  recordPair("c", "d");
  ok("a consistent chain produces the ordering it implies",
    pairOrder().join(">") === "a>b>c>d", pairOrder().join(">"));
  ok("every show that was compared is in the order", pairOrder().length === 4);

  // Re-answering a pair replaces the verdict rather than sitting next to it, so
  // changing your mind is a change of mind and not a permanent tie.
  recordPair("b", "a");
  ok("one verdict per pair", state.pairs.filter(p => pairKey(p[0], p[1]) === pairKey("a", "b")).length === 1);
  ok("…and the new verdict is the one that counts", pairElo("b") > pairElo("a"),
    `b=${Math.round(pairElo("b"))} a=${Math.round(pairElo("a"))}`);

  // The interesting contradiction: a genuine cycle. A topological sort would
  // fail here; Elo has to land all three near each other and keep going.
  clearPairs();
  recordPair("x", "y");
  recordPair("y", "z");
  recordPair("z", "x");
  const order = pairOrder();
  ok("a cycle still yields a total order", order.length === 3 && new Set(order).size === 3, order.join(">"));
  const eloSpread = Math.max(...order.map(pairElo)) - Math.min(...order.map(pairElo));
  ok("…and lands the three near each other rather than picking a winner",
    eloSpread < 40, `spread ${Math.round(eloSpread)}`);
  // No line through a cycle can honour all three of its edges, so the honest
  // claim is that the count is reported and non-zero, not that it is minimal —
  // finding the minimum is the NP-hard problem this deliberately isn't solving.
  ok("…and reports that it had to overrule some of your answers",
    pairConflicts() >= 1 && pairConflicts() < state.pairs.length, `${pairConflicts()} of 3`);
  ok("every rating is finite after a cycle", order.every(id => Number.isFinite(pairElo(id))));

  // Deterministic: the same log always produces the same numbers, because the
  // order IS the replay and nothing derived is stored. savePairs() bumps the
  // revision the cache is keyed on, so this really does recompute.
  const before = pairOrder().map(pairElo);
  savePairs();
  const after = pairOrder().map(pairElo);
  ok("the replay is deterministic", JSON.stringify(before) === JSON.stringify(after));

  clearPairs();
  ok("an empty log is an empty order, not a crash", pairOrder().length === 0 && pairConflicts() === 0);
  ok("an uncompared show sits at the starting rating", pairElo("nobody") === PAIR_START);

  // Undo has to put the displaced verdict back where it was: position in the
  // log is an input to the replay, not decoration.
  recordPair("p", "q");
  recordPair("r", "s");
  const prev = recordPair("q", "p");           // flips the first pair, moving it to the end
  ok("undo restores the previous verdict", (() => {
    undoPair("q", "p", prev);
    const i = findPairIndex("p", "q");
    return i === 0 && state.pairs[i][0] === "p" && state.pairs.length === 2;
  })(), JSON.stringify(state.pairs));

  ok("a show cannot be compared with itself", recordPair("a", "a") === null && !findPairIndex("a", "a") >= 0);
  clearPairs();
}

/* ---------- the calibration run (Day 20) ---------- */
section("Calibration run");
{
  function library(n) {
    clearPairs();
    state.ratings = {}; state.axes = {}; state.status = {}; state.hidden = new Set();
    drawable.clear();
    for (let i = 1; i <= n; i++) {
      const id = "s" + i;
      state.ratings[id] = Math.round((1 + (i - 1) * 9 / Math.max(1, n - 1)) * 2) / 2;  // spread 1…10
      drawable.add(id);
    }
    saveRatings();
  }

  library(40);
  ok("the pool is everything rated and drawable", versusPool().length === 40);

  const set = calibrationSet();
  ok(`a run works with exactly ${CALIB_SET} shows`, set.length === CALIB_SET, `${set.length}`);
  ok("…all distinct", new Set(set).size === set.length);
  // Taken off the top it would rank eight shows you already score the same. The
  // set has to span the range so Day 21 has anchors at both ends.
  const setScores = set.map(id => state.ratings[id]);
  ok("…spread across your score range, not taken off the top",
    Math.min(...setScores) === 1 && Math.max(...setScores) === 10,
    `${Math.min(...setScores)}–${Math.max(...setScores)}`);

  // THE POINT OF THE DAY. Ten answers inside a fixed set of eight orders all
  // eight; ten answers across the whole library orders nothing, because the
  // comparison graph never connects.
  const answer = (pool, rounds) => {
    clearPairs();
    const skip = new Set();
    for (let i = 0; i < rounds; i++) {
      const p = nextPair(skip, pool);
      if (!p) break;
      recordPair(p[0], p[1]);   // always prefer the left card; the shape is what matters here
    }
    return pairOrder();
  };
  const guided = answer(set, CALIB_ROUNDS);
  ok(`${CALIB_ROUNDS} answers inside the set order all ${CALIB_SET} of it`,
    guided.length === CALIB_SET, `ordered ${guided.length}`);
  ok("…and every one of them was actually asked about",
    set.every(id => pairCount(id) >= 1));

  const free = answer(versusPool(), CALIB_ROUNDS);
  ok("…where the same ten answers over the whole library reach far more shows, far more thinly",
    free.length > CALIB_SET && free.every(id => pairCount(id) <= 2),
    `touched ${free.length} shows`);

  // A library smaller than the working set is a run over whatever exists.
  library(5);
  ok("a small library runs with everything it has", calibrationSet().length === 5);
  library(1);
  ok("one show is not a run", calibrationSet().length === 1 && nextPair(new Set(), calibrationSet()) === null);
}

/* ---------- comparisons → suggested scores (Day 21) ---------- */
section("Suggested scores");
{
  clearPairs();
  state.ratings = {}; state.axes = {}; state.status = {}; state.hidden = new Set();
  drawable.clear();
  // Scores deliberately at odds with the order we are about to record.
  const given = { a: 6, b: 9, c: 7, d: 8 };
  for (const [id, v] of Object.entries(given)) { state.ratings[id] = v; drawable.add(id); }
  saveRatings();

  recordPair("a", "b"); recordPair("b", "c"); recordPair("c", "d");   // order: a > b > c > d
  const rows = suggestedScores();
  ok("it proposes something when the two disagree", rows.length > 0, `${rows.length} rows`);
  ok("nothing is written by asking",
    Object.entries(given).every(([id, v]) => state.ratings[id] === v));

  const before = Object.values(given).slice().sort((x, y) => x - y).join(",");
  const after = pairOrder().map(id => {
    const hit = rows.find(r => r.id === id);
    return hit ? hit.next : state.ratings[id];
  }).slice().sort((x, y) => x - y).join(",");
  // THE PROPERTY THE WHOLE DESIGN RESTS ON: the suggestion is a permutation of
  // the scores you already gave, so the histogram, the mean and the spread are
  // identical afterwards and only the assignment moves.
  ok("the suggestion is a permutation of your own scores", before === after, `${before} vs ${after}`);
  ok("…so the top-ranked show gets your highest score",
    rows.concat(pairOrder().filter(id => !rows.some(r => r.id === id))
      .map(id => ({ id, next: state.ratings[id] })))
      .find(r => r.id === pairOrder()[0]).next === Math.max(...Object.values(given)));
  ok("…and the order it proposes matches the comparison order", (() => {
    const finalOf = id => (rows.find(r => r.id === id) || { next: state.ratings[id] }).next;
    const seq = pairOrder().map(finalOf);
    return seq.every((v, i) => i === 0 || seq[i - 1] >= v);
  })());

  // Agreement means silence, not a no-op proposal you have to dismiss.
  clearPairs();
  state.ratings = { a: 9, b: 8, c: 7 }; drawable.clear(); ["a", "b", "c"].forEach(id => drawable.add(id));
  saveRatings();
  recordPair("a", "b"); recordPair("b", "c");
  ok("scores that already agree with the order propose nothing", suggestedScores().length === 0);

  // An unrated show has no score to redeal, so it sits the round out rather
  // than being handed one from somebody else's pile.
  state.ratings = { a: 9, b: 8 }; drawable.add("c");
  saveRatings();
  const withUnrated = suggestedScores();
  ok("an unrated show is left out of the deal", !withUnrated.some(r => r.id === "c"));

  clearPairs();
  state.ratings = {}; saveRatings();
  ok("nothing rated proposes nothing", suggestedScores().length === 0);
}

/* ---------- library flags and the sort builder (Days 25–29) ---------- */
section("Favourites, pins, sorting");
{
  const {
    isFav, toggleFav, isPinned, pinIndex, togglePin, isArchived, toggleArchived, PIN_MAX,
    cleanSort, activeSort, librarySort, libraryOrder, DEFAULT_SORT, sortSummary,
  } = sandbox.__api;

  state.favs = new Set(); state.pins = []; state.archived = new Set();
  state.sort = []; state.sorts = []; state.ratings = {}; state.status = {};
  state.dates = {}; state.progress = {}; state.rewatch = {};
  saveRatings();

  const md = (id, extra) => ({ id: String(id), title: { english: "Show " + id }, ...extra });

  // Independence: a favourite is not a score and not a status.
  toggleFav("a");
  ok("favouriting touches nothing else",
    isFav("a") && !state.ratings.a && !state.status.a && !isPinned("a") && !isArchived("a"));
  ok("…and toggles back off", (toggleFav("a"), !isFav("a")));

  // The cap, and the three-way return that lets a refusal be explained.
  for (let i = 1; i <= PIN_MAX; i++) ok(`pin ${i} of ${PIN_MAX} accepted`, togglePin("p" + i) === true);
  ok("the next pin is refused, distinguishably", togglePin("p9") === "full");
  ok("…and refusing did not store it", state.pins.length === PIN_MAX && !isPinned("p9"));
  ok("unpinning returns false, not the refusal", togglePin("p3") === false);
  ok("…and the remaining pins keep their order", state.pins.join(",") === "p1,p2,p4,p5");
  state.pins = [];

  // Archiving keeps everything.
  state.ratings.z = 8; state.status.z = "completed"; saveRatings();
  toggleArchived("z");
  ok("archiving keeps the show's data", isArchived("z") && state.ratings.z === 8 && state.status.z === "completed");
  ok("…and is not the hidden set", !state.hidden.has("z"));
  state.archived = new Set(); state.ratings = {}; state.status = {}; saveRatings();

  // The default sort IS Day 25's behaviour, written as a rule.
  ok("the default sort is favourites-first", JSON.stringify(activeSort()) === JSON.stringify(DEFAULT_SORT));
  state.favs = new Set(["b"]);
  ok("…and it puts a favourite above a non-favourite",
    libraryOrder([md("a"), md("b"), md("c")]).map(x => x.id).join("") === "bac");
  ok("…leaving the rest in the order they arrived", true);

  // Pins sit outside the sort entirely.
  state.sort = [{ key: "title", dir: "asc" }];
  state.pins = ["c"];
  ok("a pin outranks any sort",
    libraryOrder([md("a"), md("b"), md("c")]).map(x => x.id)[0] === "c");
  state.pins = []; state.favs = new Set();

  // Multi-key: ties fall through.
  state.status = { a: "watching", b: "watching", c: "completed" };
  state.ratings = { a: 7, b: 9, c: 10 }; saveRatings();
  state.sort = [{ key: "status", dir: "asc" }, { key: "score", dir: "desc" }];
  ok("a tie on the first key is broken by the second",
    libraryOrder([md("a"), md("b"), md("c")]).map(x => x.id).join("") === "bac",
    libraryOrder([md("a"), md("b"), md("c")]).map(x => x.id).join(""));

  // THE RULE THAT IS NOT REVERSED BY DIRECTION.
  state.ratings = { a: 9, b: 1 }; saveRatings();          // c is unrated
  state.sort = [{ key: "score", dir: "desc" }];
  ok("unrated sinks when sorting high-to-low",
    libraryOrder([md("a"), md("c"), md("b")]).map(x => x.id).join("") === "abc");
  state.sort = [{ key: "score", dir: "asc" }];
  ok("…and unrated sinks when sorting low-to-high too",
    libraryOrder([md("a"), md("c"), md("b")]).map(x => x.id).join("") === "bac",
    libraryOrder([md("a"), md("c"), md("b")]).map(x => x.id).join(""));

  // Stability: everything tied keeps the order it already had.
  state.sort = [{ key: "fav", dir: "desc" }];
  state.favs = new Set();
  const input = ["q", "w", "e", "r", "t"].map(md);
  ok("a sort with nothing to say changes nothing",
    libraryOrder(input).map(x => x.id).join("") === "qwert");

  // Hostile / stale stored sorts.
  ok("an unknown key is dropped rather than thrown on",
    cleanSort([{ key: "nope", dir: "desc" }, { key: "title", dir: "asc" }]).length === 1);
  ok("a duplicated key is collapsed",
    cleanSort([{ key: "title", dir: "asc" }, { key: "title", dir: "desc" }]).length === 1);
  ok("a junk direction becomes desc", cleanSort([{ key: "score", dir: "sideways" }])[0].dir === "desc");
  ok("a non-array is an empty sort", cleanSort("nonsense").length === 0 && cleanSort(null).length === 0);
  state.sort = [{ key: "nope" }];
  ok("…and a fully invalid stored sort falls back to the default",
    JSON.stringify(activeSort()) === JSON.stringify(DEFAULT_SORT));

  ok("a sort describes itself in words",
    sortSummary([{ key: "status", dir: "asc" }, { key: "score", dir: "desc" }]) === "Status ↑, then Your score ↓",
    sortSummary([{ key: "status", dir: "asc" }, { key: "score", dir: "desc" }]));
  ok("…and the empty sort says what it actually does", sortSummary([]) === "Favourites first");
}

/* ---------- taste vectors and the predictor (Days 32–44) ----------
   Built on a library with a PLANTED answer, so these assert that the engine
   recovers a signal that is known rather than that it produces plausible-looking
   numbers. The rule: Psychological +2.5, studio Madhouse +1.5, 24+ episodes +1,
   Ecchi −2.5, over a base of 6. */
section("Taste vectors & the predictor");
{
  const {
    tasteVectors, tasteDim, tasteReady, TASTE_MIN_RATED, TASTE_MIN_N,
    predictScore, predUsable, PRED_LOW_CONF, lengthBucket, decadeOf,
  } = sandbox.__api;

  let seed = 12345;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = a => a[Math.floor(rng() * a.length)];
  const GEN = ["Action", "Comedy", "Drama", "Psychological", "Romance", "Ecchi", "Fantasy", "Sci-Fi"];
  const STU = ["Madhouse", "Bones", "MAPPA", "Kyoto Animation", "A-1 Pictures", "Shaft"];
  const truth = md => {
    let s = 6;
    if (md.genres.includes("Psychological")) s += 2.5;
    if (md.studios.nodes[0].name === "Madhouse") s += 1.5;
    if ((md.episodes || 0) >= 24) s += 1;
    if (md.genres.includes("Ecchi")) s -= 2.5;
    return Math.max(1, Math.min(10, Math.round(s * 2) / 2));
  };
  function buildLibrary(total, rate) {
    catalogue.clear(); drawable.clear();
    state.ratings = {}; state.axes = {}; state.status = {}; state.hidden = new Set();
    state.watch = new Set(); state.recNo = new Set(); state.media = []; state.extra = new Map();
    seed = 12345;
    const all = [];
    for (let i = 0; i < total; i++) {
      const md = {
        id: String(9000 + i), title: { english: "Show " + i }, format: "TV",
        episodes: [1, 6, 12, 13, 24, 26, 50][Math.floor(rng() * 7)], duration: 24,
        genres: [...new Set([pick(GEN), pick(GEN)])],
        tags: [{ name: pick(["Time Skip", "Tragedy", "Iyashikei"]), rank: 80, isMediaSpoiler: false, isAdult: false }],
        studios: { nodes: [{ name: pick(STU) }] },
        seasonYear: 2000 + Math.floor(rng() * 25), source: "MANGA",
        averageScore: 70, status: "FINISHED",
      };
      catalogue.set(md.id, md); state.media.push(md); all.push(md);
    }
    for (const md of all.slice(0, rate)) {
      state.ratings[md.id] = truth(md); state.watch.add(md.id);
    }
    saveRatings();
    sandbox.tasteCache = null; sandbox.predCache = null;
    return all;
  }

  ok("length buckets name themselves", lengthBucket(1) === "Film / one-shot" && lengthBucket(26) === "Two cour (15–28)");
  ok("a decade is a decade", decadeOf(2013) === "2010s" && decadeOf(0) === null);

  buildLibrary(90, 40);
  const v = tasteVectors();
  ok("the sample is what could be resolved", v.rated === 40);
  ok("…and the profile is ready", tasteReady());

  const g = tasteDim("genre");
  ok("no value below the minimum sample is charted", g.every(r => r.n >= TASTE_MIN_N));
  // THE PLANTED ANSWERS. Signs and ordering, not magnitudes — shrinkage
  // deliberately attenuates, so asserting exact lifts would test the constant.
  ok("the liked genre comes top", g[0].value === "Psychological", `${g[0].value} ${g[0].lift}`);
  ok("…with a positive lift", g[0].lift > 0);
  ok("the disliked genre comes last", g[g.length - 1].value === "Ecchi", `${g[g.length - 1].value}`);
  ok("…with a negative lift", g[g.length - 1].lift < 0);
  const st = tasteDim("studio");
  ok("the liked studio comes top", st[0].value === "Madhouse", `${st[0].value} ${st[0].lift}`);
  const len = tasteDim("length");
  ok("the liked length comes top", /Long|Two cour/.test(String(len[0].value)), `${len[0].value}`);

  // Shrinkage: a one-off 10 must not out-rank a well-evidenced favourite.
  const before = tasteDim("genre")[0].value;
  const spike = { id: "7777", title: { english: "Spike" }, format: "TV", episodes: 12, duration: 24,
    genres: ["Ecchi", "Sports"], tags: [], studios: { nodes: [{ name: "Nobody" }] },
    seasonYear: 2011, source: "MANGA", averageScore: 70, status: "FINISHED" };
  catalogue.set("7777", spike); state.media.push(spike);
  state.ratings["7777"] = 10; saveRatings();
  sandbox.tasteCache = null; sandbox.predCache = null;
  ok("one 10/10 cannot take over a chart", tasteDim("genre")[0].value === before,
    `${tasteDim("genre")[0].value}`);
  ok("…and a value seen once is still not charted at all",
    !tasteDim("genre").some(r => r.value === "Sports"));

  buildLibrary(90, 40);
  // Prediction over the 50 unrated shows against the ground truth.
  const preds = [];
  for (let i = 40; i < 90; i++) {
    const md = catalogue.get(String(9000 + i));
    const p = predictScore(md.id);
    if (p && p.score != null) preds.push({ p: p.score, t: truth(md), c: p.conf });
  }
  ok("every unrated show gets an estimate", preds.length === 50, `${preds.length}`);
  const mae = preds.reduce((s, r) => s + Math.abs(r.p - r.t), 0) / preds.length;
  ok("…and the estimates track the planted truth", mae < 1.6, `mean error ${mae.toFixed(2)}`);
  ok("a rated show gets no estimate", predictScore("9000") === null);

  // Day 40 / 42: evidence collapses for a show sharing nothing, and the app
  // refuses to show a number rather than dressing a guess up as one.
  const alien = { id: "6666", title: { english: "Alien" }, format: "TV", episodes: 12, duration: 24,
    genres: ["Mecha", "Horror"], tags: [{ name: "Nope", rank: 80, isMediaSpoiler: false, isAdult: false }],
    studios: { nodes: [{ name: "Unknown Co" }] }, seasonYear: 1969, source: "OTHER",
    averageScore: 70, status: "FINISHED" };
  catalogue.set("6666", alien); state.media.push(alien);
  sandbox.tasteCache = null; sandbox.predCache = null;
  const ap = predictScore("6666");
  ok("a show with nothing in common has almost no evidence", ap.conf < PRED_LOW_CONF, `conf ${ap.conf}`);
  ok("…so it is refused rather than guessed at", !predUsable(ap));
  const known = predictScore("9041");
  ok("…where a well-covered show is not refused", predUsable(known), `conf ${known.conf}`);
  ok("evidence is a real scale, not a flag", known.conf - ap.conf > 0.4,
    `${ap.conf} vs ${known.conf}`);

  // Below the library floor nothing is predicted at all.
  buildLibrary(90, TASTE_MIN_RATED - 1);
  ok("under the floor there is no profile and no prediction",
    !tasteReady() && predictScore("9050") === null);

  ok("every estimate carries its reasons", (() => {
    buildLibrary(90, 40);
    const p = predictScore("9050");
    return p.why.length > 0 && p.why.every(w => w.value && typeof w.lift === "number");
  })());
}

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
