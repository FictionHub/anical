// Tung Tungs — the skin economy.
//
// Skins used to arrive one way: an admin granted one against a Discord account
// and that was the whole model. This is the other two ways in — a daily wheel
// spin and a currency you earn by using the site — and the rule that a person
// now owns a *collection* and wears one of it, rather than owning exactly one
// thing forever.
//
// WHY THIS IS SERVER-SIDE, when everything else in Tsuzuki is local-first.
// A balance is the first thing in this product that someone would want to lie
// about, and the plan is to sell Tung Tungs for real money later. A localStorage
// number cannot be sold: the moment it can be edited in devtools, every purchase
// is a refund request. So the ledger lives here, keyed by Discord id, and
// signing in is required to earn or spend. What has NOT moved is everything
// else — your list, ratings, notes, collections and progress are still local and
// still never uploaded. The settings copy says exactly that, and it stays true.
//
// This module is deliberately pure: no Blobs, no Request, no clock reading
// except through explicit `now` arguments. wallet.mjs does the I/O and this
// decides what the numbers become — which is what makes the prize table and the
// day boundaries testable (scripts/test-economy.mjs).

export const WALLET_VERSION = 1;
export const WALLET_STORE = "user-wallet";

/* ---------------- rarity ----------------
   Rarity drives three numbers and nothing else: what a skin costs in the shop,
   what it converts to when the wheel lands on a tier you have already cleared,
   and how often the wheel offers that tier at all. Keeping all three in one
   table is what stops a "legendary" that costs less than an "epic".

   `exclusive` is the old model, preserved: event skins granted in /admin. They
   have no price and are never a wheel outcome, because a skin handed out at an
   event stops meaning anything the moment it can be bought. */
export const RARITY = {
  common:    { label: "Common",    price: 300,  dust: 60,  tint: "#8aa0b4" },
  rare:      { label: "Rare",      price: 800,  dust: 170, tint: "#4ea8de" },
  epic:      { label: "Epic",      price: 1800, dust: 380, tint: "#b06ef2" },
  legendary: { label: "Legendary", price: 4000, dust: 850, tint: "#f0a02c" },
  exclusive: { label: "Exclusive", price: null, dust: 0,   tint: "#ff4a2e" },
};
export const RARITIES = Object.keys(RARITY);
export const DEFAULT_RARITY = "common";
export const isRarity = r => Object.prototype.hasOwnProperty.call(RARITY, String(r || ""));
// A theme with no rarity is a Common. Live-store themes written before this
// existed must stay valid and stay purchasable rather than becoming unreachable.
export const rarityOf = t => (t && isRarity(t.rarity) ? t.rarity : DEFAULT_RARITY);
export const priceOf = t => RARITY[rarityOf(t)].price;
export const isBuyable = t => priceOf(t) != null;

/* ---------------- the wheel ----------------
   Eight fixed segments in a fixed order. Fixed because the client draws a real
   wheel from this list and animates it to the index the server picked: if the
   order could change between the draw and the landing, the pointer would stop on
   a segment that no longer says what it said when it started spinning.

   The server picks the outcome, always. The client is told which index it landed
   on and animates to it — the reverse (client spins, tells the server what it
   won) is not a wheel, it is a form. */
export const WHEEL = [
  { id: "c25",  kind: "coins", amount: 25,             weight: 22, label: "25" },
  { id: "sc",   kind: "skin",  rarity: "common",       weight: 13, label: "Common skin" },
  { id: "c60",  kind: "coins", amount: 60,             weight: 18, label: "60" },
  { id: "sr",   kind: "skin",  rarity: "rare",         weight: 7,  label: "Rare skin" },
  { id: "c40",  kind: "coins", amount: 40,             weight: 20, label: "40" },
  { id: "c150", kind: "coins", amount: 150,            weight: 9,  label: "150" },
  { id: "se",   kind: "skin",  rarity: "epic",         weight: 4,  label: "Epic skin" },
  { id: "sl",   kind: "skin",  rarity: "legendary",    weight: 1,  label: "Legendary skin" },
];
const TOTAL_WEIGHT = WHEEL.reduce((n, s) => n + s.weight, 0);

// Spinning on consecutive days multiplies the coin prizes: +10% a day, stopping
// at double. A bonus that kept growing would make the eightieth consecutive day
// worth more than everything before it, which is an inflation problem wearing a
// retention hook's clothes.
export const STREAK_CAP = 10;
export const streakMultiplier = streak =>
  1 + Math.min(Math.max(Math.floor(+streak || 1) - 1, 0), STREAK_CAP) * 0.1;

/* ---------------- daily tasks ----------------
   Earning is capped by construction: every task pays once per UTC day, so the
   most anyone can make from tasks is DAILY_TASK_MAX no matter what their browser
   claims to have done.

   That cap is the entire anti-cheat story, and it is worth being honest about
   why it is enough. The server cannot verify "I marked an episode watched" —
   progress is local, by design, and shipping it here to police a 40-coin reward
   would trade the product's privacy promise for nothing. So claims are attested
   by the client and bounded by the server. A liar earns at exactly the rate an
   honest active user earns; what they skip is the using of the site, which was
   the point of the reward. There is no leaderboard to poison and nothing taken
   from anyone else, so a bound is the right tool and a surveillance layer is
   not. `visit` is the one the server genuinely knows, because loading the wallet
   IS the visit. */
export const TASKS = [
  { id: "visit",    reward: 20, verified: true,  label: "Show up",                 hint: "Credited the first time you open Tsuzuki each day." },
  { id: "progress", reward: 40, verified: false, label: "Mark an episode watched", hint: "Any show, any episode — the counter or the schedule ticks both count." },
  { id: "rate",     reward: 40, verified: false, label: "Rate a show",             hint: "Give anything a score out of ten." },
  { id: "status",   reward: 30, verified: false, label: "Set a watch status",      hint: "Move a show to Watching, Plan, On-hold, Dropped or Completed." },
  { id: "list",     reward: 30, verified: false, label: "File a show into a list", hint: "Add anything to one of your own collections." },
  { id: "note",     reward: 30, verified: false, label: "Write a private note",    hint: "Where you left off, who recommended it — it never leaves your browser." },
];
export const TASK_BY_ID = TASKS.reduce((m, t) => { m[t.id] = t; return m; }, {});
export const DAILY_TASK_MAX = TASKS.reduce((n, t) => n + t.reward, 0);

// A balance nobody can reach, so a bug in the arithmetic can never mint an
// unbounded number. At the honest earning rate this is roughly two years.
export const MAX_BALANCE = 200000;

/* ---------------- days ----------------
   One boundary for the spin and the tasks, in UTC, so they reset together and
   the copy is a single sentence. Local midnight would have been friendlier by a
   few hours and would also have made "what day is it" a claim the client gets to
   make — which is a free extra spin for anyone willing to change their clock. */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export function msUntilNextUtcDay(now = Date.now()) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return next - now;
}
// Yesterday, for deciding whether a streak survived.
const prevDay = day => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t - 86400000).toISOString().slice(0, 10) : null;
};

/* ---------------- the wallet record ---------------- */

export function emptyWallet(now = Date.now()) {
  return {
    v: WALLET_VERSION,
    balance: 0,
    owned: {},            // themeId -> { at, via }
    wearing: null,        // themeId currently worn, or null for your own theme
    spin: { day: null, streak: 0 },
    tasks: { day: null, done: {} },
    totals: { earned: 0, spent: 0, spins: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

// Anything read out of the store is treated as hostile: it may be from an older
// shape, a partial write, or hand-edited. Normalising on read means every
// function below can assume the record is well-formed, and it bounds growth —
// `tasks` only ever holds today.
export function normalizeWallet(raw, now = Date.now()) {
  const w = emptyWallet(now);
  if (!raw || typeof raw !== "object") return w;
  w.balance = clampInt(raw.balance, 0, MAX_BALANCE);
  if (raw.owned && typeof raw.owned === "object") {
    for (const [id, rec] of Object.entries(raw.owned)) {
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) continue;
      w.owned[id] = {
        at: Number.isFinite(rec && rec.at) ? rec.at : now,
        via: ["wheel", "shop", "grant"].includes(rec && rec.via) ? rec.via : "shop",
      };
    }
  }
  w.wearing = typeof raw.wearing === "string" && w.owned[raw.wearing] ? raw.wearing : null;
  const day = utcDay(now);
  const spin = raw.spin || {};
  w.spin = {
    day: typeof spin.day === "string" ? spin.day : null,
    streak: clampInt(spin.streak, 0, 100000),
  };
  const tasks = raw.tasks || {};
  // Yesterday's claims are not today's. Dropping them on read is also what keeps
  // the record a fixed size instead of a growing per-day log.
  w.tasks = tasks.day === day && tasks.done && typeof tasks.done === "object"
    ? { day, done: Object.fromEntries(Object.keys(tasks.done).filter(k => TASK_BY_ID[k]).map(k => [k, true])) }
    : { day, done: {} };
  const totals = raw.totals || {};
  w.totals = {
    earned: clampInt(totals.earned, 0, Number.MAX_SAFE_INTEGER),
    spent: clampInt(totals.spent, 0, Number.MAX_SAFE_INTEGER),
    spins: clampInt(totals.spins, 0, Number.MAX_SAFE_INTEGER),
  };
  w.createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : now;
  w.updatedAt = now;
  return w;
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

function credit(w, amount) {
  const n = Math.max(0, Math.floor(amount));
  const room = MAX_BALANCE - w.balance;
  const given = Math.min(n, Math.max(0, room));
  w.balance += given;
  w.totals.earned += given;
  return given;
}

/* ---------------- grants ----------------
   An admin grant is now an ownership row like any other, so an event skin shows
   up in the gallery next to the ones you won and can be worn or taken off the
   same way. It is merged in on every read rather than copied once: a grant made
   after the wallet existed has to reach a wallet that already exists. */
export function mergeGrant(wallet, grant, now = Date.now()) {
  const id = grant && typeof grant.themeId === "string" ? grant.themeId : null;
  if (!id || wallet.owned[id]) return false;
  wallet.owned[id] = { at: Number.isFinite(grant.grantedAt) ? grant.grantedAt : now, via: "grant" };
  // An event skin is the thing you were given — put it on rather than making the
  // person find it. Only when they are not already wearing something of their own.
  if (!wallet.wearing) wallet.wearing = id;
  return true;
}

/* ---------------- the spin ---------------- */

export const canSpin = (wallet, now = Date.now()) => wallet.spin.day !== utcDay(now);

// Weighted pick over WHEEL. `roll` is a number in [0,1) — passed in rather than
// generated here so the table can be tested for its actual distribution instead
// of being taken on faith.
export function pickSegment(roll) {
  let acc = 0;
  const target = Math.min(Math.max(+roll || 0, 0), 0.9999999) * TOTAL_WEIGHT;
  for (let i = 0; i < WHEEL.length; i++) {
    acc += WHEEL[i].weight;
    if (target < acc) return i;
  }
  return WHEEL.length - 1;
}

/* Resolve a landed segment into what the person actually gets.

   `pool` is the ids of every theme in that rarity they do NOT already own,
   which is how duplicate protection works: the wheel can only ever hand over
   something new. Clear a tier and its segment pays dust instead — a wheel that
   can land on "nothing, you have them all" is a wheel that punishes the people
   who used it most. */
export function resolvePrize(segment, poolForRarity, roll2 = 0) {
  if (segment.kind === "coins") return { kind: "coins", amount: segment.amount };
  const pool = Array.isArray(poolForRarity) ? poolForRarity : [];
  if (!pool.length) {
    return { kind: "coins", amount: RARITY[segment.rarity].dust, dust: true, rarity: segment.rarity };
  }
  const idx = Math.min(pool.length - 1, Math.floor(Math.min(Math.max(+roll2 || 0, 0), 0.9999999) * pool.length));
  return { kind: "skin", themeId: pool[idx], rarity: segment.rarity };
}

/* One spin, start to finish. Returns the mutated wallet and what was won, or a
   refusal — never a throw, because "you already span today" is an ordinary
   answer to an ordinary request and the caller renders it either way. */
export function applySpin(wallet, { unownedByRarity, roll, roll2, now = Date.now() }) {
  const day = utcDay(now);
  if (wallet.spin.day === day) {
    return { ok: false, error: "already-spun", nextSpinInMs: msUntilNextUtcDay(now) };
  }
  // A streak is consecutive days, so it survives yesterday and nothing else.
  const streak = wallet.spin.day === prevDay(day) ? wallet.spin.streak + 1 : 1;
  const index = pickSegment(roll);
  const segment = WHEEL[index];
  const prize = resolvePrize(segment, (unownedByRarity || {})[segment.rarity] || [], roll2);

  const multiplier = streakMultiplier(streak);
  let awarded = 0;
  if (prize.kind === "coins") {
    // The streak multiplies coins only. Multiplying a skin is meaningless, and
    // multiplying dust would make clearing a tier the most profitable state.
    awarded = credit(wallet, prize.dust ? prize.amount : Math.round(prize.amount * multiplier));
    prize.amount = awarded;
  } else {
    wallet.owned[prize.themeId] = { at: now, via: "wheel" };
  }

  wallet.spin = { day, streak };
  wallet.totals.spins += 1;
  wallet.updatedAt = now;
  return {
    ok: true, index, segment: segment.id, prize,
    streak, multiplier: prize.kind === "coins" && !prize.dust ? multiplier : 1,
    nextSpinInMs: msUntilNextUtcDay(now),
  };
}

/* ---------------- tasks ---------------- */

export function applyClaim(wallet, taskId, now = Date.now()) {
  const task = TASK_BY_ID[String(taskId || "")];
  if (!task) return { ok: false, error: "unknown-task" };
  const day = utcDay(now);
  if (wallet.tasks.day !== day) wallet.tasks = { day, done: {} };
  if (wallet.tasks.done[task.id]) return { ok: false, error: "already-claimed" };
  wallet.tasks.done[task.id] = true;
  const awarded = credit(wallet, task.reward);
  wallet.updatedAt = now;
  return { ok: true, task: task.id, awarded, balance: wallet.balance };
}

/* ---------------- shop ---------------- */

export function applyBuy(wallet, theme, now = Date.now()) {
  if (!theme || !theme.id) return { ok: false, error: "unknown-theme" };
  if (wallet.owned[theme.id]) return { ok: false, error: "already-owned" };
  const price = priceOf(theme);
  if (price == null) return { ok: false, error: "not-for-sale" };
  if (wallet.balance < price) return { ok: false, error: "insufficient", price, balance: wallet.balance };
  wallet.balance -= price;
  wallet.totals.spent += price;
  wallet.owned[theme.id] = { at: now, via: "shop" };
  // Buying a skin and then having to go and put it on is a step nobody wants.
  wallet.wearing = theme.id;
  wallet.updatedAt = now;
  return { ok: true, themeId: theme.id, price, balance: wallet.balance };
}

export function applyWear(wallet, themeId, now = Date.now()) {
  if (themeId == null || themeId === "") {
    wallet.wearing = null;
    wallet.updatedAt = now;
    return { ok: true, wearing: null };
  }
  const id = String(themeId);
  if (!wallet.owned[id]) return { ok: false, error: "not-owned" };
  wallet.wearing = id;
  wallet.updatedAt = now;
  return { ok: true, wearing: id };
}

/* ---------------- what the client is told ----------------
   The wallet as the browser sees it. Same reasoning as publicTheme(): one place
   decides what leaves the server, so no endpoint can accidentally widen it. */
export function publicWallet(wallet, now = Date.now()) {
  const day = utcDay(now);
  return {
    balance: wallet.balance,
    owned: Object.fromEntries(Object.entries(wallet.owned).map(([id, r]) => [id, { at: r.at, via: r.via }])),
    wearing: wallet.wearing,
    spin: {
      available: canSpin(wallet, now),
      streak: wallet.spin.day === day || wallet.spin.day === prevDay(day) ? wallet.spin.streak : 0,
      nextInMs: canSpin(wallet, now) ? 0 : msUntilNextUtcDay(now),
    },
    tasks: TASKS.map(t => ({
      id: t.id, label: t.label, hint: t.hint, reward: t.reward,
      done: !!(wallet.tasks.day === day && wallet.tasks.done[t.id]),
    })),
    totals: wallet.totals,
    dayEndsInMs: msUntilNextUtcDay(now),
  };
}
