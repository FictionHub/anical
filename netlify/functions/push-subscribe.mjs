// Stores (or updates) a Web Push subscription + the caller's followed-show
// ids and notify lead time, so push-send.mjs can later notify them about
// upcoming episodes — even when Tsuzuki isn't open.
//
// POST /api/push/subscribe   { subscription, mediaIds: ["123", ...], lead: 10 }
import { getStore } from "@netlify/blobs";
import { keyFor } from "./_lib/subs.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const { subscription, mediaIds, lead } = body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return new Response("Missing subscription", { status: 400 });
  }

  const ids = Array.isArray(mediaIds) ? [...new Set(mediaIds.map(String))].slice(0, 200) : [];
  const store = getStore("push-subscriptions");
  const key = keyFor(subscription.endpoint);
  const existing = await store.get(key, { type: "json" }).catch(() => null);

  await store.setJSON(key, {
    subscription,
    mediaIds: ids,
    lead: Math.min(Math.max(+lead || 10, 1), 120),
    sent: (existing && existing.sent) || [],
    updatedAt: Date.now(),
  });

  return new Response(JSON.stringify({ ok: true, following: ids.length }), {
    headers: { "Content-Type": "application/json" },
  });
};
