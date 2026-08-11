// The Tung Tung wallet — balance, owned skins, the daily wheel and daily tasks.
//
//   GET  /api/wallet          -> your wallet, today's tasks, the wheel layout
//   POST /api/wallet/spin     -> spin the daily wheel (the SERVER picks the prize)
//   POST /api/wallet/claim    { task }     -> credit a daily task, once per day
//   POST /api/wallet/buy      { themeId }  -> spend Tung Tungs on a skin
//   POST /api/wallet/wear     { themeId }  -> wear one you own (null takes it off)
//
// Every route requires the Discord session. That is the deliberate decision the
// rest of the app avoids making: a balance that will one day be bought with real
// money cannot live in localStorage, because a number in localStorage can be
// edited by the person who owns it. Nothing else moved — list, ratings, notes,
// collections and progress are still local and still never uploaded.
//
// The prize is decided here and the client is told which segment it landed on.
// The reverse — the browser spins and reports what it won — is not a wheel, it
// is a form with an animation.
import { getStore } from "@netlify/blobs";
import { currentUser, sessionsEnabled } from "./_lib/session.mjs";
import { loadThemeSeed, mergeThemes, THEME_STORE } from "./_lib/themes.mjs";
import {
  WALLET_STORE, WHEEL, RARITY, TASKS, DAILY_TASK_MAX,
  emptyWallet, normalizeWallet, publicWallet, mergeGrant,
  applySpin, applyClaim, applyBuy, applyWear,
  rarityOf, priceOf, canSpin,
} from "./_lib/economy.mjs";
import { randomInt } from "node:crypto";

const GRANT_STORE = "user-themes";
const SITE = "https://tsuzuki.top";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// A float in [0,1) from the platform CSPRNG. Math.random() would almost
// certainly be fine for a cosmetic wheel, but "almost certainly fine" is not a
// sentence worth writing next to something people will later pay for.
const roll = () => randomInt(0, 1 << 30) / (1 << 30);

/* The catalog, reduced to what the economy needs: an id, a name and a rarity.
   Cached per container like themes.mjs does — a wallet read must not become a
   Blobs read of the whole theme store. */
let cat = null, catAt = 0;
async function themeIndex() {
  if (cat && Date.now() - catAt < 60_000) return cat;
  const seed = await loadThemeSeed(SITE);
  let live = null;
  try { live = await getStore(THEME_STORE).get("live", { type: "json" }); }
  catch (err) { console.warn("wallet: live theme store read failed —", err.message); }
  const merged = mergeThemes(seed, live).themes || {};
  cat = new Map(Object.entries(merged).map(([id, t]) => [id, { id, name: t.name || id, rarity: rarityOf(t) }]));
  catAt = Date.now();
  return cat;
}

// Which skins in each rarity this person does NOT own — the wheel's duplicate
// protection, computed from the catalog rather than stored, so adding a theme
// makes it winnable immediately without touching a single wallet.
function unownedByRarity(index, wallet) {
  const out = {};
  for (const t of index.values()) {
    // `exclusive` has no price and no wheel segment: an event skin that could be
    // won at random is not an event skin.
    if (priceOf(t) == null) continue;
    if (wallet.owned[t.id]) continue;
    (out[t.rarity] || (out[t.rarity] = [])).push(t.id);
  }
  for (const list of Object.values(out)) list.sort();   // stable, so a roll is reproducible
  return out;
}

async function readWallet(store, id, grantStore) {
  const raw = await store.get(id, { type: "json" }).catch(() => null);
  const wallet = raw ? normalizeWallet(raw) : emptyWallet();
  // An admin grant is an ownership row. Merged on every read, not copied once:
  // a grant made after the wallet existed still has to reach it.
  const grant = await grantStore.get(id, { type: "json" }).catch(() => null);
  const changed = grant ? mergeGrant(wallet, grant) : false;
  return { wallet, dirty: !raw || changed };
}

export default async (req) => {
  if (!sessionsEnabled()) {
    return json({ ok: false, error: "sign-in-off", message: "Sign-in isn't configured on this deployment." }, 503);
  }
  const user = currentUser(req);
  if (!user) return json({ ok: false, error: "signed-out" }, 401);

  const store = getStore(WALLET_STORE);
  const grantStore = getStore(GRANT_STORE);
  const id = user.id;
  const url = new URL(req.url);
  // The redirect sends /api/wallet/* here whole, so the action is the last path
  // segment — "" for the bare GET.
  const action = url.pathname.replace(/^.*\/wallet\/?/, "").replace(/\/+$/, "");

  let { wallet, dirty } = await readWallet(store, id, grantStore);
  const index = await themeIndex();

  const reply = (extra = {}, status = 200) =>
    json({ ok: true, ...extra, wallet: publicWallet(wallet), wheel: WHEEL, rarity: RARITY, dailyMax: DAILY_TASK_MAX }, status);

  if (req.method === "GET") {
    // Showing up IS the visit task, and this is the request that proves it —
    // the one task on the board the server can honestly verify by itself.
    let visit = null;
    const res = applyClaim(wallet, "visit");
    if (res.ok) { visit = res.awarded; dirty = true; }
    if (dirty) await store.setJSON(id, wallet).catch(err => console.warn("wallet: save failed —", err.message));
    return reply(visit != null ? { credited: { task: "visit", awarded: visit } } : {});
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body = {};
  if (action === "claim" || action === "buy" || action === "wear") {
    try { body = await req.json(); } catch { return json({ ok: false, error: "bad-json" }, 400); }
  }

  let out;
  switch (action) {
    case "spin": {
      // Keyed "spin", the same as the success path below — the client reads one
      // key and must not have to know which branch answered it.
      if (!canSpin(wallet)) return reply({ spin: { ok: false, error: "already-spun" } }, 429);
      out = applySpin(wallet, { unownedByRarity: unownedByRarity(index, wallet), roll: roll(), roll2: roll() });
      // Name the skin here rather than making the client join against the
      // catalog to render its own prize.
      if (out.ok && out.prize.kind === "skin") {
        const t = index.get(out.prize.themeId);
        out.prize.name = (t && t.name) || out.prize.themeId;
      }
      dirty = true;
      break;
    }
    case "claim": {
      const task = String(body.task || "");
      if (!TASKS.some(t => t.id === task)) return json({ ok: false, error: "unknown-task" }, 400);
      // `visit` is the server's own; letting the client claim it would make the
      // one verified task the one lie that always works.
      if (task === "visit") return json({ ok: false, error: "server-task" }, 400);
      out = applyClaim(wallet, task);
      dirty = out.ok;
      break;
    }
    case "buy": {
      const theme = index.get(String(body.themeId || ""));
      if (!theme) return json({ ok: false, error: "unknown-theme" }, 400);
      out = applyBuy(wallet, theme);
      if (out.ok) out.name = theme.name;
      dirty = out.ok;
      break;
    }
    case "wear": {
      out = applyWear(wallet, body.themeId == null ? null : String(body.themeId));
      dirty = out.ok;
      break;
    }
    default:
      return json({ ok: false, error: "unknown-action" }, 404);
  }

  // Read-modify-write with no compare-and-set: @netlify/blobs 8.2 has no
  // conditional write, so two spins fired in parallel could both pass the
  // once-a-day check. The prize is cosmetic, the window is one round trip wide,
  // and the alternative is a lock service for a wheel — so this is accepted
  // rather than unnoticed. Revisit if Tung Tungs ever cost money.
  if (dirty) {
    try { await store.setJSON(id, wallet); }
    catch (err) {
      console.error("wallet: save failed", err);
      return json({ ok: false, error: "save-failed" }, 500);
    }
  }
  return reply({ [action]: out }, out && out.ok === false ? 400 : 200);
};
