// Scheduled function — runs every 15 minutes, checks AniList airing
// schedules for every show any subscriber follows, and sends a Web Push
// notification ~`lead` minutes before episodes air.
//
// Air times go through the same correction layer the app uses
// (_lib/schedule-overrides.mjs), so a subscriber is alerted for the release
// they actually watch — the simulcast by default, the dub if they asked for it
// — and an episode marked as a broadcast break never fires an alert at all.
//
// Manual test (requires CRON_SECRET env var to be set):
//   curl "https://<site>/.netlify/functions/push-send?secret=$CRON_SECRET"
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { variantsFor, preferredVariant, showOverride, mergeOverrides, loadSeed } from "./_lib/schedule-overrides.mjs";

export const config = { schedule: "*/15 * * * *" };

const ANILIST = "https://graphql.anilist.co";
const SITE = "https://tsuzuki.netlify.app";
const RUN_WINDOW_MS = 16 * 60 * 1000; // slightly more than the 15-min cadence
const QUERY = `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:ANIME){
  id title{romaji english} coverImage{medium}
  externalLinks{ site type }
  airingSchedule(notYetAired:true, perPage:25){ nodes{ episode airingAt } }
} } }`;

const AIR_LABEL = { raw: "JP broadcast", sub: "Sub", dub: "Dub" };

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

async function fetchSchedules(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res = await fetch(ANILIST, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { ids: chunk } }),
      });
      const j = await res.json();
      for (const m of (j.data && j.data.Page.media) || []) out.set(m.id, m);
    } catch (e) {
      console.error("AniList fetch failed", e);
    }
  }
  return out;
}

export default async (req) => {
  const isScheduled = req.headers.get("x-netlify-event") === "schedule";
  if (!isScheduled) {
    const secret = new URL(req.url).searchParams.get("secret");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return new Response("VAPID keys not configured", { status: 500 });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@tsuzuki.netlify.app", pub, priv);

  const store = getStore("push-subscriptions");
  const { blobs } = await store.list();
  if (!blobs.length) return new Response(JSON.stringify({ ok: true, subscriptions: 0 }), { headers: { "Content-Type": "application/json" } });

  const subs = [];
  const allIds = new Set();
  for (const b of blobs) {
    const data = await store.get(b.key, { type: "json" }).catch(() => null);
    if (!data || !data.subscription) continue;
    subs.push({ key: b.key, data });
    for (const id of data.mediaIds || []) allIds.add(+id);
  }
  if (!allIds.size) return new Response(JSON.stringify({ ok: true, subscriptions: subs.length, sent: 0 }), { headers: { "Content-Type": "application/json" } });

  const schedules = await fetchSchedules([...allIds]);
  const overrides = await loadOverrides();
  const now = Date.now();
  let sent = 0, removed = 0;

  for (const { key, data } of subs) {
    const sentSet = new Set(data.sent || []);
    const lead = data.lead || 10;
    const airType = data.airType || "sub";
    let gone = false;

    for (const id of data.mediaIds || []) {
      const md = schedules.get(+id);
      if (!md) continue;
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

        try {
          await webpush.sendNotification(data.subscription, payload);
          sentSet.add(tag);
          sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) { gone = true; break; }
          console.error("push failed", err.statusCode, err.body || err.message);
        }
      }
      if (gone) break;
    }

    if (gone) { await store.delete(key); removed++; continue; }

    const sentArr = [...sentSet];
    data.sent = sentArr.length > 500 ? sentArr.slice(-500) : sentArr;
    await store.setJSON(key, data);
  }

  return new Response(JSON.stringify({ ok: true, subscriptions: subs.length, sent, removed }), {
    headers: { "Content-Type": "application/json" },
  });
};
