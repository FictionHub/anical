// Stores (or updates) a Web Push subscription + the caller's followed-show
// ids and notify lead time, so push-send.mjs can later notify them about
// upcoming episodes — even when Tsuzuki isn't open.
//
// POST /api/push/subscribe
//   { subscription, mediaIds: ["123", ...], lead: 10, airType: "sub", userId: "..." }
//
// airType is which release the subscriber is actually waiting for — the JP
// broadcast ("raw"), the simulcast ("sub", the default) or the dub. push-send
// resolves it against the schedule-override layer so a dub follower is alerted
// for the dub drop and not for a broadcast they can't watch.
//
// When signed in, userId ties the subscription to a person rather than a device,
// so two devices follow the same list and each receives exactly one copy.
import { getStore } from "@netlify/blobs";
import { keyFor } from "./_lib/subs.mjs";

const SUB_STORE = "push-subscriptions";
const USER_SUB_STORE = "push-user-subs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const { subscription, mediaIds, lead, airType, userId } = body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return new Response("Missing subscription", { status: 400 });
  }

  const ids = Array.isArray(mediaIds) ? [...new Set(mediaIds.map(String))].slice(0, 200) : [];
  const subStore = getStore(SUB_STORE);
  const key = keyFor(subscription.endpoint);
  const existing = await subStore.get(key, { type: "json" }).catch(() => null);

  await subStore.setJSON(key, {
    subscription,
    mediaIds: ids,
    lead: Math.min(Math.max(+lead || 10, 1), 120),
    airType: ["raw", "sub", "dub"].includes(airType) ? airType : "sub",
    userId: userId || null,
    sent: (existing && existing.sent) || [],
    updatedAt: Date.now(),
  });

  // Map user -> subscription endpoints so push-send can dedupe across devices.
  if (userId) {
    const userStore = getStore(USER_SUB_STORE);
    const userKey = "user-" + String(userId).replace(/[^a-zA-Z0-9_-]/g, "");
    const current = await userStore.get(userKey, { type: "json" }).catch(() => null);
    const endpoints = new Set((current && current.endpoints) || []);
    endpoints.push(subscription.endpoint);
    await userStore.setJSON(userKey, {
      userId,
      endpoints: [...endpoints].slice(0, 20),
      updatedAt: Date.now(),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, following: ids.length }), {
    headers: { "Content-Type": "application/json" },
  });
};
