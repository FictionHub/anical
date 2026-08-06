// The skin catalog.
//
//   GET  /api/themes          -> every theme, ready to apply (public)
//   POST /api/themes          -> maintainer write path (merge by default)
//   POST /api/themes?mode=replace
//
// Public on the read side because the client has to be able to apply a skin,
// and a theme is a palette and four image URLs — there is nothing in it worth
// hiding. What's private is *who has one*, and that lives behind the session in
// auth.mjs, never here.
//
// Write examples:
//   curl "https://<site>/api/themes"
//   curl -X POST "https://<site>/api/themes?secret=$ADMIN_SECRET" \
//        -H 'Content-Type: application/json' -d @theme.json
import { getStore } from "@netlify/blobs";
import {
  loadThemeSeed, mergeThemes, validateThemes, publicTheme,
  THEMES_VERSION, THEME_STORE,
} from "./_lib/themes.mjs";

const KEY = "live";
const SITE = "https://tsuzuki.top";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function authorized(req) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const given = new URL(req.url).searchParams.get("secret") || req.headers.get("x-tsuzuki-secret");
  return given === secret;
}

let cache = null, cachedAt = 0;
async function catalog() {
  if (cache && Date.now() - cachedAt < 60_000) return cache;
  const seed = await loadThemeSeed(SITE);
  let live = null;
  try { live = await getStore(THEME_STORE).get(KEY, { type: "json" }); }
  catch (err) { console.warn("themes: live store read failed —", err.message); }
  cache = mergeThemes(seed, live);
  cachedAt = Date.now();
  return cache;
}

export default async (req) => {
  if (req.method === "GET") {
    const doc = await catalog();
    // Sanitised on the way out: publicTheme() drops anything that isn't a hex
    // colour or an https URL, so the browser can write these straight into CSS
    // variables without having to trust the store.
    const themes = {};
    for (const [id, t] of Object.entries(doc.themes || {})) {
      try { themes[id] = publicTheme(id, t); } catch { /* skip a malformed row rather than fail the catalog */ }
    }
    // Short cache, long stale window: a skin fix should land quickly, and a
    // cold origin must never be what stops the site painting.
    return json({ ok: true, version: THEMES_VERSION, updatedAt: doc.updatedAt || null, count: Object.keys(themes).length, themes }, 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!authorized(req)) return new Response("Forbidden", { status: 403 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const problem = validateThemes(body);
  if (problem) return json({ ok: false, error: problem }, 400);

  const store = getStore(THEME_STORE);
  const existing = await store.get(KEY, { type: "json" }).catch(() => null);
  const mode = new URL(req.url).searchParams.get("mode") || "merge";
  const next = mode === "replace"
    ? { themes: { ...body.themes } }
    : { themes: { ...((existing && existing.themes) || {}), ...body.themes } };

  next.version = THEMES_VERSION;
  next.updatedAt = new Date().toISOString();
  await store.setJSON(KEY, next);
  cache = null;   // a maintainer who just saved should see it on the next load

  return json({ ok: true, mode, themes: Object.keys(next.themes).length, updatedAt: next.updatedAt });
};
