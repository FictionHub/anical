// Scheduled function — runs every 15 minutes, checks AniList airing
// schedules for every show any subscriber follows, and sends a Web Push
// notification ~`lead` minutes before episodes air.
//
// Manual test (requires CRON_SECRET env var to be set):
//   curl "https://<site>/.netlify/functions/push-send?secret=$CRON_SECRET"
import { getStore } from "@netlify/blobs";
import webpush from "web-push";

export const config = { schedule: "*/15 * * * *" };

const ANILIST = "https://graphql.anilist.co";
const SITE = "https://anicalendar.netlify.app";
const RUN_WINDOW_MS = 16 * 60 * 1000; // slightly more than the 15-min cadence
const QUERY = `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:ANIME){
  id title{romaji english} coverImage{medium}
  airingSchedule(notYetAired:true, perPage:25){ nodes{ episode airingAt } }
} } }`;

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
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@anicalendar.netlify.app", pub, priv);

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
  const now = Date.now();
  let sent = 0, removed = 0;

  for (const { key, data } of subs) {
    const sentSet = new Set(data.sent || []);
    const lead = data.lead || 10;
    let gone = false;

    for (const id of data.mediaIds || []) {
      const md = schedules.get(+id);
      if (!md) continue;
      for (const n of (md.airingSchedule && md.airingSchedule.nodes) || []) {
        const tag = id + "-" + n.episode;
        if (sentSet.has(tag)) continue;
        const fireAt = n.airingAt * 1000 - lead * 60000;
        if (fireAt > now || fireAt <= now - RUN_WINDOW_MS) continue; // not due this run

        const t = md.title.english || md.title.romaji || "Anime";
        const payload = JSON.stringify({
          title: t + " — Episode " + n.episode,
          body: "Airs in ~" + lead + " min (" + new Date(n.airingAt * 1000).toUTCString().slice(0, -4) + " UTC)",
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
