// Scheduled function — runs every 15 minutes, checks the airing schedule for
// every show any subscriber follows, and sends a Web Push notification ~`lead`
// minutes before episodes air.
//
// Schedules come from _lib/catalog.mjs (memory -> Blobs snapshot -> AniList),
// so a run normally costs zero upstream calls. Air times then go through the
// same correction layer the app uses (_lib/schedule-overrides.mjs), so a
// subscriber is alerted for the release they actually watch — the simulcast by
// default, the dub if they asked for it — and an episode marked as a broadcast
// break never fires an alert at all.
//
// This handler answers 200 for every outcome it understands, including "not
// configured" and "upstream is down". A scheduled function's status code is
// nothing but a log signal, and a 500 every 15 minutes is an alarm that trains
// you to ignore alarms. Real failures are console.error + `ok:false` in the
// body, which is what the run log actually shows you.
//
// Manual test (requires CRON_SECRET env var to be set):
//   curl "https://<site>/.netlify/functions/push-send?secret=$CRON_SECRET"
//   curl "https://<site>/.netlify/functions/push-send?secret=$CRON_SECRET&dry=1"
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { variantsFor, preferredVariant, showOverride, mergeOverrides, loadSeed } from "./_lib/schedule-overrides.mjs";
import { getManyById } from "./_lib/catalog.mjs";

export const config = { schedule: "*/15 * * * *" };

const SITE = "https://tsuzuki.top";
const RUN_WINDOW_MS = 16 * 60 * 1000; // slightly more than the 15-min cadence
// Netlify kills a function that overruns its execution limit, and a killed run
// is indistinguishable from a crash in the logs. Stop cleanly before that and
// report what got sent — the next run picks up the rest.
const TIME_BUDGET_MS = 20_000;

// The VAPID *public* key is not a secret: it ships in site/index.html so
// browsers can subscribe at all. Requiring it as an environment variable meant
// a deploy where only the private key was set — the only one the setup notes
// ever told you to set — returned 500 on every scheduled run. Keep the env var
// as an override for anyone rotating keys, and fall back to the committed one.
// Rotated Aug 2026: the original pair's private half was never set anywhere, so
// nothing could ever be signed. The subscription store was empty at the time of
// rotation, so no existing subscriber was invalidated by the change.
const VAPID_PUBLIC_DEFAULT = "BB594h_5VV0438lXEg0dGtENsi1yC7uKOXSovJR6D_tLDVQ2fok4ZwdAKGKCc0wjURvkA9nWAyHMSubn0N5jMCU";

const AIR_LABEL = { raw: "JP broadcast", sub: "Sub", dub: "Dub" };

const ok = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

// Same two layers the client reads: the committed seed, then the live store
// on top. Either can be missing without stopping the run.
async function loadOverrides() {
  const seed = await loadSeed(SITE);
  let live = null;
  try {
    live = await getStore("schedule-overrides").get("live", { type: "json" });
  } catch (e) { console.error("overrides store read failed", e); }
  return mergeOverrides(seed, live);
}

async function run({ dry }) {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

  const pub = process.env.VAPID_PUBLIC_KEY || VAPID_PUBLIC_DEFAULT;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) {
    console.error("push-send: VAPID_PRIVATE_KEY is not set — no notification can be signed. Set it in Site configuration -> Environment variables (scripts/generate-vapid-keys.mjs prints it).");
    return ok({ ok: false, reason: "vapid-private-key-missing", sent: 0 });
  }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@tsuzuki.top", pub, priv);
  } catch (err) {
    // Malformed keys throw here rather than at send time — a bad paste in the
    // dashboard would otherwise look like every push failing for no reason.
    console.error("push-send: VAPID details rejected —", err.message);
    return ok({ ok: false, reason: "vapid-invalid", detail: err.message, sent: 0 });
  }

  let blobs;
  try {
    blobs = (await getStore("push-subscriptions").list()).blobs;
  } catch (err) {
    console.error("push-send: subscription store unavailable —", err.message);
    return ok({ ok: false, reason: "store-unavailable", detail: err.message, sent: 0 });
  }
  const store = getStore("push-subscriptions");
  if (!blobs.length) return ok({ ok: true, subscriptions: 0, sent: 0 });

  const subs = [];
  const allIds = new Set();
  for (const b of blobs) {
    const data = await store.get(b.key, { type: "json" }).catch(() => null);
    if (!data || !data.subscription) continue;
    subs.push({ key: b.key, data });
    for (const id of data.mediaIds || []) allIds.add(+id);
  }
  if (!allIds.size) return ok({ ok: true, subscriptions: subs.length, sent: 0 });

  let schedules;
  try {
    schedules = await getManyById([...allIds]);
  } catch (err) {
    // Nothing to send is not a failure worth a 500 — the next run retries.
    console.error("push-send: schedule lookup failed —", err.message);
    return ok({ ok: false, reason: "schedule-unavailable", detail: err.message, subscriptions: subs.length, sent: 0 });
  }

  const overrides = await loadOverrides();
  const now = Date.now();
  let sent = 0, removed = 0, failed = 0, truncated = false;

  for (const { key, data } of subs) {
    if (outOfTime()) { truncated = true; break; }
    const sentSet = new Set(data.sent || []);
    const lead = data.lead || 10;
    const airType = data.airType || "sub";
    let gone = false, touched = false;

    for (const id of data.mediaIds || []) {
      const md = schedules.get(+id);
      if (!md || !md.title) continue;
      const ov = showOverride(overrides, md.id);
      for (const n of (md.airingSchedule && md.airingSchedule.nodes) || []) {
        // Resolve the release this subscriber is waiting for. A break yields no
        // variants at all, so it silently produces no alert.
        const { status, variants } = variantsFor(md, n, ov);
        const v = preferredVariant(variants, airType);
        if (!v) continue;

        // The tag carries the air type: switching from sub to dub should be
        // able to alert for the same episode again.
        const tag = id + "-" + n.episode + "-" + v.type;
        if (sentSet.has(tag)) continue;
        const fireAt = v.ts * 1000 - lead * 60000;
        if (fireAt > now || fireAt <= now - RUN_WINDOW_MS) continue; // not due this run

        const t = md.title.english || md.title.romaji || "Anime";
        const where = v.platform ? " on " + v.platform : "";
        const label = v.type === "sub" && v.estimated ? "Simulcast (approx.)" : AIR_LABEL[v.type];
        const bodyText = "Airs in ~" + lead + " min · " + label + where +
          " (" + new Date(v.ts * 1000).toUTCString().slice(0, -4) + " UTC)" +
          (status && status.reason ? " · " + status.reason : "");
        const payload = JSON.stringify({
          title: t + " — Episode " + n.episode,
          body: bodyText,
          icon: (md.coverImage && md.coverImage.medium) || SITE + "/og-image.png",
          tag: "anical-" + md.id + "-" + n.episode,
          url: SITE + "/?show=" + md.id,
        });

        if (dry) { sent++; continue; }
        try {
          await webpush.sendNotification(data.subscription, payload);
          sentSet.add(tag);
          touched = true;
          sent++;
        } catch (err) {
          // 404/410 means the browser threw the subscription away — stop
          // pushing to a dead endpoint and forget it.
          if (err.statusCode === 404 || err.statusCode === 410) { gone = true; break; }
          failed++;
          console.error("push failed", err.statusCode, err.body || err.message);
        }
      }
      if (gone) break;
    }

    if (dry) continue;
    if (gone) { await store.delete(key).catch(() => {}); removed++; continue; }
    if (!touched) continue;   // nothing changed — don't rewrite the blob

    const sentArr = [...sentSet];
    data.sent = sentArr.length > 500 ? sentArr.slice(-500) : sentArr;
    await store.setJSON(key, data).catch(err => console.error("push-send: could not persist sent tags", err.message));
  }

  return ok({ ok: true, dry: !!dry, subscriptions: subs.length, sent, removed, failed, truncated, ms: Date.now() - startedAt });
}

export default async (req) => {
  const isScheduled = req.headers.get("x-netlify-event") === "schedule";
  const url = new URL(req.url);
  if (!isScheduled) {
    const secret = url.searchParams.get("secret");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  try {
    return await run({ dry: url.searchParams.get("dry") === "1" });
  } catch (err) {
    // Anything unforeseen: log it in full, but still answer 200 on the schedule
    // so the run log reads as one bad run rather than a broken endpoint. A
    // manual call gets the honest 500, because a human is reading that one.
    console.error("push-send: unhandled failure —", err && err.stack ? err.stack : err);
    const body = JSON.stringify({ ok: false, reason: "unhandled", detail: String((err && err.message) || err) });
    return new Response(body, { status: isScheduled ? 200 : 500, headers: { "Content-Type": "application/json" } });
  }
};
