// Who has which skin. Maintainer-only, both ways.
//
//   GET  /api/grants   -> every grant, plus the directory of people who have
//                         signed in (so the admin panel can offer names)
//   POST /api/grants    { discordId, themeId, note }   -> grant
//   POST /api/grants    { discordId, action: "remove" } -> undo a mistake
//
// Grants are permanent: no expiry, no scheduled revoke, nothing the client has
// to re-check for a lapse. `remove` exists because an admin tool with no way to
// correct a mistyped snowflake is a tool that hands a stranger a skin forever —
// and because removing someone's stored row is the only way to honour a request
// to be forgotten. It also clears their directory entry.
//
// The read side is behind the secret on purpose. The catalog is public; the list
// of which Discord accounts have been given something is not.
import { getStore } from "@netlify/blobs";
import { loadThemeSeed, mergeThemes, THEME_STORE } from "./_lib/themes.mjs";

const GRANT_STORE = "user-themes";
const DIRECTORY_STORE = "user-directory";
const SITE = "https://tsuzuki.top";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function authorized(req) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const given = new URL(req.url).searchParams.get("secret") || req.headers.get("x-tsuzuki-secret");
  return given === secret;
}

// Discord snowflakes are 17-20 digits. Checking the shape stops a typo becoming
// a row nobody will ever match, and stops the key space being used as scratch.
const isSnowflake = s => /^\d{17,20}$/.test(String(s || ""));

async function knownThemeIds() {
  const seed = await loadThemeSeed(SITE);
  let live = null;
  try { live = await getStore(THEME_STORE).get("live", { type: "json" }); } catch { /* seed-only is fine */ }
  return new Set(Object.keys(mergeThemes(seed, live).themes || {}));
}

async function listAll() {
  const grantStore = getStore(GRANT_STORE);
  const dirStore = getStore(DIRECTORY_STORE);

  const { blobs } = await grantStore.list();
  const grants = [];
  for (const b of blobs) {
    const rec = await grantStore.get(b.key, { type: "json" }).catch(() => null);
    if (!rec) continue;
    const user = await dirStore.get(b.key, { type: "json" }).catch(() => null);
    grants.push({ discordId: b.key, ...rec, user: user || null });
  }
  grants.sort((a, b) => (b.grantedAt || 0) - (a.grantedAt || 0));

  // The directory is everyone who has ever signed in — the pool the admin
  // picks from, most recently seen first, since that is who just showed up at
  // the event asking where their skin is.
  const users = [];
  const dir = await dirStore.list();
  for (const b of dir.blobs) {
    const u = await dirStore.get(b.key, { type: "json" }).catch(() => null);
    if (u) users.push(u);
  }
  users.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

  return { grants, users };
}

export default async (req) => {
  if (!authorized(req)) return new Response("Forbidden", { status: 403 });

  if (req.method === "GET") {
    try { return json({ ok: true, ...(await listAll()) }); }
    catch (err) {
      console.error("grants: list failed", err);
      return json({ ok: false, error: String(err.message || err) }, 500);
    }
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const discordId = String((body && body.discordId) || "").trim();
  if (!isSnowflake(discordId)) {
    return json({ ok: false, error: "discordId must be a Discord user id (17–20 digits). Turn on Developer Mode in Discord, right-click a user, Copy User ID." }, 400);
  }

  if (body.action === "remove") {
    await getStore(GRANT_STORE).delete(discordId).catch(() => {});
    await getStore(DIRECTORY_STORE).delete(discordId).catch(() => {});
    return json({ ok: true, removed: discordId });
  }

  // Validate before touching the store. Granting a theme that doesn't exist
  // would leave someone signed in, entitled, and looking at the default site
  // with no clue why — and a store hiccup shouldn't be what you see instead of
  // "you typed the wrong theme id".
  const themeId = String(body.themeId || "").trim();
  const known = await knownThemeIds();
  if (!known.has(themeId)) {
    return json({ ok: false, error: `No theme "${themeId}". Known: ${[...known].sort().join(", ") || "(none)"}` }, 400);
  }

  const store = getStore(GRANT_STORE);
  const existing = await store.get(discordId, { type: "json" }).catch(() => null);
  const rec = {
    themeId,
    note: String(body.note || "").slice(0, 200) || null,
    grantedAt: (existing && existing.grantedAt) || Date.now(),
    updatedAt: Date.now(),
    grantedBy: "admin",
  };
  await store.setJSON(discordId, rec);
  return json({ ok: true, discordId, ...rec, replaced: existing ? existing.themeId : null });
};
