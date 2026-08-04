// Live release-schedule corrections.
//
// GET  /api/overrides         -> the correction document the app layers on top
//                                of AniList (see _lib/schedule-overrides.mjs).
// POST /api/overrides?secret= -> maintainer write path.
//
// Why a function and not just the committed seed: a wrong air time has to be
// fixable in minutes, and a deploy costs ~15 of the 300 monthly Netlify credits
// (netlify.toml explains the budget). Corrections written here land for every
// visitor on their next load with no deploy at all. site/data/overrides.json
// stays the durable, reviewable seed; this store is the fast lane on top.
//
// Write examples (merge is the default — it only touches the shows you send):
//   curl -X POST "https://<site>/api/overrides?secret=$ADMIN_SECRET" \
//        -H 'Content-Type: application/json' \
//        -d '{"shows":{"170942":{"episodes":{"5":{"status":{"kind":"delay","shiftMin":10080,"reason":"Pre-empted"}}}}}}'
//   curl -X POST "https://<site>/api/overrides?secret=$ADMIN_SECRET&mode=replace" -d @overrides.json
import { getStore } from "@netlify/blobs";
import { mergeOverrides, validateOverrides, OVERRIDES_VERSION } from "./_lib/schedule-overrides.mjs";

const KEY = "live";
const EMPTY = { version: OVERRIDES_VERSION, shows: {}, updatedAt: null };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function authorized(req) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const given = new URL(req.url).searchParams.get("secret") || req.headers.get("x-tsuzuki-secret");
  return given === secret;
}

export default async (req) => {
  const store = getStore("schedule-overrides");

  if (req.method === "GET") {
    const doc = await store.get(KEY, { type: "json" }).catch(() => null);
    // Short cache with a long stale window: corrections should land fast, but a
    // cold origin must never block the calendar from rendering.
    return json(doc || EMPTY, 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!authorized(req)) return new Response("Forbidden", { status: 403 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (body && body.shows == null && body.patch) body = body.patch;

  const problem = validateOverrides(body);
  if (problem) return json({ ok: false, error: problem }, 400);

  const mode = new URL(req.url).searchParams.get("mode") || "merge";
  const existing = await store.get(KEY, { type: "json" }).catch(() => null);
  const next = mode === "replace" ? { ...body } : mergeOverrides(existing || EMPTY, body);

  next.version = OVERRIDES_VERSION;
  next.updatedAt = new Date().toISOString();
  await store.setJSON(KEY, next);

  return json({ ok: true, mode, shows: Object.keys(next.shows).length, updatedAt: next.updatedAt });
};
