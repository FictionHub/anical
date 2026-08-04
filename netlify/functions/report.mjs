// "This time is wrong" reports from the app.
//
// POST /api/report          -> file a report (public, unauthenticated)
// GET  /api/report?secret=  -> maintainer queue, newest first
//
// This is the intake side of the correction layer: a reader who notices that an
// episode actually dropped an hour later than listed can say so from the show
// modal, and the fix goes out through /api/overrides. Without an intake the
// correction layer only ever learns what one maintainer happens to notice.
//
// Spam containment without accounts or a captcha: every field is length-capped,
// and the storage key is derived from the show, episode and a hash of the
// reporter's IP — so one person hammering the same episode overwrites their own
// report instead of growing the queue.
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const MAX_BODY = 4000;
const KINDS = ["wrong-time", "delay", "missing", "wrong-episode", "dub-time", "other"];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const clip = (v, n) => (v == null ? "" : String(v).slice(0, n));

function reporterHash(req) {
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
  return createHash("sha256").update(String(ip).split(",")[0].trim()).digest("hex").slice(0, 12);
}

const STATUSES = ["open", "applied", "rejected", "duplicate"];

function isAdmin(req) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const given = new URL(req.url).searchParams.get("secret") || req.headers.get("x-tsuzuki-secret");
  return given === secret;
}

export default async (req) => {
  const store = getStore("schedule-reports");

  if (req.method === "GET") {
    if (!isAdmin(req)) return new Response("Forbidden", { status: 403 });

    const wantStatus = new URL(req.url).searchParams.get("status");
    const { blobs } = await store.list();
    const items = [];
    for (const b of blobs) {
      const r = await store.get(b.key, { type: "json" }).catch(() => null);
      if (!r) continue;
      if (wantStatus && wantStatus !== "all" && (r.status || "open") !== wantStatus) continue;
      items.push({ key: b.key, ...r });
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return json({
      ok: true,
      count: items.length,
      open: items.filter(r => (r.status || "open") === "open").length,
      reports: items.slice(0, 200),
    });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Maintainer actions share the POST verb but are gated on the secret, so a
  // member of the public can only ever *create* a report — never mark one
  // applied, and never delete someone else's.
  if (isAdmin(req)) {
    let cmd;
    try { cmd = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    const keys = Array.isArray(cmd.keys) ? cmd.keys : cmd.key ? [cmd.key] : [];
    if (!keys.length) return json({ ok: false, error: "No report key given" }, 400);

    if (cmd.action === "delete") {
      for (const k of keys) await store.delete(String(k)).catch(() => {});
      return json({ ok: true, deleted: keys.length });
    }
    if (!STATUSES.includes(cmd.status)) return json({ ok: false, error: `status must be one of ${STATUSES.join(", ")}` }, 400);

    let updated = 0;
    for (const k of keys) {
      const rec = await store.get(String(k), { type: "json" }).catch(() => null);
      if (!rec) continue;
      rec.status = cmd.status;
      rec.resolvedAt = Date.now();
      if (cmd.note != null) rec.maintainerNote = clip(cmd.note, 500);
      await store.setJSON(String(k), rec);
      updated++;
    }
    return json({ ok: true, updated, status: cmd.status });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "Report too long" }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  const mediaId = clip(body.mediaId, 12);
  if (!/^\d+$/.test(mediaId)) return json({ ok: false, error: "mediaId must be an AniList id" }, 400);

  const episode = Number.isFinite(+body.episode) ? Math.max(0, Math.min(9999, +body.episode | 0)) : 0;
  const kind = KINDS.includes(body.kind) ? body.kind : "other";
  const detail = clip(body.detail, 1000).trim();
  if (!detail) return json({ ok: false, error: "Tell us what's wrong" }, 400);

  const record = {
    mediaId,
    title: clip(body.title, 200),
    episode,
    kind,
    airType: ["raw", "sub", "dub"].includes(body.airType) ? body.airType : null,
    // What the reporter says the correct time is, as an ISO string or free text.
    expected: clip(body.expected, 120),
    platform: clip(body.platform, 60),
    source: clip(body.source, 300),
    detail,
    // A hash, not an address, and nothing else identifying: the form promises
    // the reporter that nothing personal is stored, and fixing an air time
    // never needed their user agent.
    reporter: reporterHash(req),
    createdAt: Date.now(),
    status: "open",
  };

  await store.setJSON(`${mediaId}-${episode}-${record.reporter}`, record);
  return json({ ok: true });
};
