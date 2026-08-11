/* ============================================================
   Tsuzuki — Tung Tung economy self-test

   netlify/functions/_lib/economy.mjs is deliberately pure so the parts that
   decide what a number becomes can be checked without a Blobs store, a session
   or a clock. This is what "the prize table is fair and the day boundary holds"
   looks like as something you can run:

     node scripts/test-economy.mjs
     npm run economy:test

   It lives in scripts/, which netlify.toml's ignore rule excludes from the
   deploy diff — so running or editing it costs nothing.
   ============================================================ */
import {
  WHEEL, RARITY, TASKS, DAILY_TASK_MAX, STREAK_CAP,
  emptyWallet, normalizeWallet, publicWallet, mergeGrant,
  applySpin, applyClaim, applyBuy, applyWear,
  pickSegment, resolvePrize, streakMultiplier, utcDay, msUntilNextUtcDay,
  canSpin, rarityOf, priceOf, MAX_BALANCE,
} from "../netlify/functions/_lib/economy.mjs";

let failed = 0, ran = 0;
const ok = (label, cond, detail) => {
  ran++;
  if (!cond) { failed++; console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`); }
  else console.log(`ok    ${label}`);
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const DAY = 86400000;
const T = (iso) => Date.parse(iso);
const NOON = T("2026-08-11T12:00:00Z");

/* ---------------- day boundaries ---------------- */
eq("utcDay reads the UTC calendar day", utcDay(NOON), "2026-08-11");
eq("utcDay ignores local time near midnight", utcDay(T("2026-08-11T23:59:59Z")), "2026-08-11");
eq("…and rolls at 00:00 UTC", utcDay(T("2026-08-12T00:00:00Z")), "2026-08-12");
eq("msUntilNextUtcDay at noon is twelve hours", msUntilNextUtcDay(NOON), 12 * 3600000);

/* ---------------- the wheel's distribution ----------------
   The point of pickSegment taking a roll is that the table can be measured
   rather than trusted. A sweep of the whole [0,1) range must reproduce each
   segment's declared weight. */
{
  const N = 200000;
  const counts = new Array(WHEEL.length).fill(0);
  for (let i = 0; i < N; i++) counts[pickSegment(i / N)]++;
  const total = WHEEL.reduce((n, s) => n + s.weight, 0);
  let worst = 0, worstAt = "";
  WHEEL.forEach((s, i) => {
    const want = s.weight / total, got = counts[i] / N;
    const drift = Math.abs(want - got);
    if (drift > worst) { worst = drift; worstAt = s.id; }
  });
  ok("every wheel segment is reachable", counts.every(c => c > 0), `zero-count segments: ${counts.map((c, i) => c === 0 ? WHEEL[i].id : null).filter(Boolean)}`);
  ok("segment frequencies match their weights", worst < 0.002, `worst drift ${(worst * 100).toFixed(3)}% on ${worstAt}`);
  eq("a roll of 0 lands on the first segment", pickSegment(0), 0);
  eq("a roll of 1 is clamped inside the wheel", pickSegment(1), WHEEL.length - 1);
  eq("a junk roll does not throw", pickSegment(NaN), 0);
}

/* ---------------- streak multiplier ---------------- */
eq("day one has no bonus", streakMultiplier(1), 1);
ok("day five is +40%", Math.abs(streakMultiplier(5) - 1.4) < 1e-9);
ok("the bonus stops at double", Math.abs(streakMultiplier(STREAK_CAP + 1) - 2) < 1e-9 && Math.abs(streakMultiplier(500) - 2) < 1e-9);
eq("a missing streak is treated as day one", streakMultiplier(undefined), 1);

/* ---------------- duplicate protection ---------------- */
{
  const skinSeg = WHEEL.find(s => s.kind === "skin" && s.rarity === "rare");
  eq("a skin segment with a pool hands over a skin",
     resolvePrize(skinSeg, ["a", "b", "c"], 0.5), { kind: "skin", themeId: "b", rarity: "rare" });
  eq("a cleared tier pays dust instead",
     resolvePrize(skinSeg, [], 0.5), { kind: "coins", amount: RARITY.rare.dust, dust: true, rarity: "rare" });
  const coinSeg = WHEEL.find(s => s.kind === "coins");
  eq("a coin segment ignores the pool", resolvePrize(coinSeg, [], 0.9), { kind: "coins", amount: coinSeg.amount });
}

/* ---------------- spinning ---------------- */
{
  const w = emptyWallet(NOON);
  const pool = { common: ["sk-a"], rare: [], epic: [], legendary: [] };
  // Roll 0 lands on segment 0, which is 25 coins.
  const first = applySpin(w, { unownedByRarity: pool, roll: 0, roll2: 0, now: NOON });
  ok("the first spin succeeds", first.ok);
  eq("…on day one of the streak", first.streak, 1);
  eq("…crediting the segment's face value", w.balance, 25);
  eq("…and counting the spin", w.totals.spins, 1);

  const again = applySpin(w, { unownedByRarity: pool, roll: 0, roll2: 0, now: NOON + 3600000 });
  eq("a second spin the same UTC day is refused", again.ok, false);
  eq("…with a reason the UI can render", again.error, "already-spun");
  eq("…and no coins move", w.balance, 25);

  const tomorrow = applySpin(w, { unownedByRarity: pool, roll: 0, roll2: 0, now: NOON + DAY });
  eq("the next day spins again", tomorrow.ok, true);
  eq("…continuing the streak", tomorrow.streak, 2);
  eq("…with the streak bonus applied to coins", w.balance, 25 + Math.round(25 * 1.1));

  // Skip a day: the streak resets rather than continuing.
  const afterGap = applySpin(w, { unownedByRarity: pool, roll: 0, roll2: 0, now: NOON + DAY * 4 });
  eq("a missed day resets the streak", afterGap.streak, 1);
}

/* ---------------- winning a skin ---------------- */
{
  const w = emptyWallet(NOON);
  const segIndex = WHEEL.findIndex(s => s.kind === "skin" && s.rarity === "common");
  // A roll landing exactly inside the common-skin segment.
  const before = WHEEL.slice(0, segIndex).reduce((n, s) => n + s.weight, 0);
  const total = WHEEL.reduce((n, s) => n + s.weight, 0);
  const roll = (before + WHEEL[segIndex].weight / 2) / total;
  const res = applySpin(w, { unownedByRarity: { common: ["sk-a", "sk-b"] }, roll, roll2: 0, now: NOON });
  eq("the roll lands on the intended segment", res.index, segIndex);
  eq("…and the prize is a skin", res.prize.kind, "skin");
  ok("…which is now owned", !!w.owned[res.prize.themeId]);
  eq("…recorded as won, not bought", w.owned[res.prize.themeId].via, "wheel");
  eq("…and costs nothing", w.balance, 0);
}

/* ---------------- daily tasks ---------------- */
{
  const w = emptyWallet(NOON);
  const first = applyClaim(w, "rate", NOON);
  eq("a task pays its reward", first.awarded, TASKS.find(t => t.id === "rate").reward);
  eq("claiming it twice the same day pays nothing", applyClaim(w, "rate", NOON).error, "already-claimed");
  eq("…and the balance is untouched", w.balance, TASKS.find(t => t.id === "rate").reward);
  eq("an unknown task is refused", applyClaim(w, "mine-bitcoin", NOON).error, "unknown-task");

  // The cap that is the whole anti-cheat story: a client that lies about every
  // task still cannot exceed one day's honest total.
  const liar = emptyWallet(NOON);
  for (let i = 0; i < 500; i++) for (const t of TASKS) applyClaim(liar, t.id, NOON);
  eq("spamming every task all day caps at the daily maximum", liar.balance, DAILY_TASK_MAX);

  const nextDay = applyClaim(w, "rate", NOON + DAY);
  eq("the same task pays again tomorrow", nextDay.ok, true);
  eq("…and yesterday's claims are not kept", Object.keys(w.tasks.done), ["rate"]);
}

/* ---------------- the shop ---------------- */
{
  const w = emptyWallet(NOON);
  const common = { id: "sk-common", name: "Common", rarity: "common" };
  const legendary = { id: "sk-legend", name: "Legend", rarity: "legendary" };
  const event = { id: "sk-event", name: "Event", rarity: "exclusive" };

  eq("you cannot buy what you cannot afford", applyBuy(w, common, NOON).error, "insufficient");
  w.balance = RARITY.common.price;
  const bought = applyBuy(w, common, NOON);
  eq("buying spends exactly the price", bought.ok && w.balance, 0);
  eq("…and puts the skin on", w.wearing, "sk-common");
  eq("…recorded as bought", w.owned["sk-common"].via, "shop");
  eq("buying it twice is refused", applyBuy(w, common, NOON).error, "already-owned");

  w.balance = 99999;
  eq("an event skin is not for sale at any price", applyBuy(w, event, NOON).error, "not-for-sale");
  eq("a legendary costs a legendary's price", RARITY.legendary.price > RARITY.epic.price, true);
  applyBuy(w, legendary, NOON);
  eq("…deducted in full", w.balance, 99999 - RARITY.legendary.price);
  eq("spending is tallied", w.totals.spent, RARITY.common.price + RARITY.legendary.price);
}

/* ---------------- wearing ---------------- */
{
  const w = emptyWallet(NOON);
  w.owned["mine"] = { at: NOON, via: "wheel" };
  eq("you cannot wear what you do not own", applyWear(w, "not-mine", NOON).error, "not-owned");
  eq("…and the previous choice stands", w.wearing, null);
  eq("wearing something you own works", applyWear(w, "mine", NOON).wearing, "mine");
  eq("taking it off is allowed", applyWear(w, null, NOON).wearing, null);
}

/* ---------------- admin grants still work ---------------- */
{
  const w = emptyWallet(NOON);
  eq("a grant becomes an ownership row", mergeGrant(w, { themeId: "event-skin", grantedAt: 1 }, NOON), true);
  eq("…marked as granted", w.owned["event-skin"].via, "grant");
  eq("…and put on, since it was handed to you", w.wearing, "event-skin");
  eq("merging the same grant again changes nothing", mergeGrant(w, { themeId: "event-skin" }, NOON), false);

  // A grant must not yank someone out of a skin they chose themselves.
  const chosen = emptyWallet(NOON);
  chosen.owned["bought"] = { at: NOON, via: "shop" };
  chosen.wearing = "bought";
  mergeGrant(chosen, { themeId: "event-skin" }, NOON);
  eq("a grant does not replace what you are already wearing", chosen.wearing, "bought");
  ok("…but is still owned", !!chosen.owned["event-skin"]);
}

/* ---------------- hostile records ----------------
   Everything read out of the store is treated as untrusted: an older shape, a
   partial write, or a value someone put there by hand. */
{
  eq("a null record normalises to an empty wallet", normalizeWallet(null, NOON).balance, 0);
  eq("a negative balance floors at zero", normalizeWallet({ balance: -500 }, NOON).balance, 0);
  eq("an absurd balance is capped", normalizeWallet({ balance: 1e18 }, NOON).balance, MAX_BALANCE);
  eq("a non-numeric balance floors at zero", normalizeWallet({ balance: "lots" }, NOON).balance, 0);
  eq("an illegal theme id is dropped from owned",
     Object.keys(normalizeWallet({ owned: { "Bad Id!": {}, "good-id": {} } }, NOON).owned), ["good-id"]);
  eq("wearing something you do not own is cleared",
     normalizeWallet({ wearing: "ghost" }, NOON).wearing, null);
  eq("yesterday's task claims do not carry over",
     normalizeWallet({ tasks: { day: "2000-01-01", done: { rate: true } } }, NOON).tasks.done, {});
  eq("today's task claims survive a reload",
     normalizeWallet({ tasks: { day: utcDay(NOON), done: { rate: true } } }, NOON).tasks.done, { rate: true });
  eq("an unknown task id is not resurrected by a reload",
     normalizeWallet({ tasks: { day: utcDay(NOON), done: { nonsense: true } } }, NOON).tasks.done, {});
}

/* ---------------- rarity table sanity ---------------- */
{
  const buyable = ["common", "rare", "epic", "legendary"];
  const prices = buyable.map(r => RARITY[r].price);
  ok("price rises with rarity", prices.every((p, i) => i === 0 || p > prices[i - 1]), prices.join(" < "));
  ok("dust rises with rarity", buyable.every((r, i) => i === 0 || RARITY[r].dust > RARITY[buyable[i - 1]].dust));
  ok("dust is always well under the price it substitutes for",
     buyable.every(r => RARITY[r].dust < RARITY[r].price / 3));
  eq("an unclassified theme is a Common", rarityOf({}), "common");
  eq("a nonsense rarity is a Common", rarityOf({ rarity: "mythic" }), "common");
  eq("a null theme is a Common", rarityOf(null), "common");
  eq("an event skin has no price", priceOf({ rarity: "exclusive" }), null);
  // The wheel must never be able to hand out something with no price.
  ok("no wheel segment offers an exclusive skin",
     WHEEL.every(s => s.kind !== "skin" || RARITY[s.rarity].price != null));
}

/* ---------------- what the client is told ---------------- */
{
  const w = emptyWallet(NOON);
  const view = publicWallet(w, NOON);
  eq("a fresh wallet can spin", view.spin.available, true);
  eq("…shows every task unclaimed", view.tasks.filter(t => t.done).length, 0);
  eq("…and lists them all", view.tasks.length, TASKS.length);
  applySpin(w, { unownedByRarity: {}, roll: 0, roll2: 0, now: NOON });
  const after = publicWallet(w, NOON);
  eq("after spinning it cannot spin again today", after.spin.available, false);
  ok("…and says when it can", after.spin.nextInMs > 0);
  ok("the public view leaks no internals", !("v" in after) && !("createdAt" in after));
}

console.log(`\n${ran} checks, ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);
