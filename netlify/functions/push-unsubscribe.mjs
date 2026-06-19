// Deletes a stored Web Push subscription.
// POST /api/push/unsubscribe   { endpoint }
import { getStore } from "@netlify/blobs";
import { keyFor } from "./_lib/subs.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  if (!body || !body.endpoint) return new Response("Missing endpoint", { status: 400 });

  const store = getStore("push-subscriptions");
  await store.delete(keyFor(body.endpoint));

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
