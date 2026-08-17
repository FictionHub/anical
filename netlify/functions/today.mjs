/* GET /today/ — "what anime is airing today", rendered at request time.

   WHY THIS IS A FUNCTION AND NOT A STATIC PAGE
   /today/ used to be baked by scripts/build-seo.mjs like every other SEO page.
   That works for a season schedule, which changes a few times a quarter, and
   fails for a page whose entire premise is the current date: the generator runs
   weekly (see .github/workflows/refresh-pages.yml), so on 17 Aug 2026 the live
   page was still titled "Anime Airing Today — Thursday, August 13, 2026" and
   listing that Thursday's episodes. A page that names the wrong day is worse
   than no page.

   The obvious fix — run the generator daily — is the one thing the budget will
   not buy. Every push that touches site/ costs ~15 Netlify credits against 300
   a month, a hard ceiling of ~20 deploys; a daily commit would spend 30 and
   leave nothing for shipping. See the comment at the top of netlify.toml.

   A function has no such cost. It bills invocations, not deploys, it reads
   through the same Blobs-backed catalog cache the rest of the API uses (so the
   AniList fetch is shared, not repeated), and the CDN holds the result for an
   hour. The page is correct every day and the deploy budget is untouched.

   Netlify serves a matching static file in preference to a redirect, so the
   rule in netlify.toml carries force = true. site/today/index.html is still
   generated and committed — as the fallback below, and as the thing that gets
   served if this function is ever removed. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  SITE, esc, title, animeSlug, isFinale, ogFor, isAdultMedia,
  shell, cardHTML, seasonNav, slugOf, labelOf, seasonOf, shiftSeason,
} from "./_lib/seo-shell.mjs";
import { getSeasonWindow } from "./_lib/catalog.mjs";

// included_files lands the committed page somewhere under the task root, and
// which root depends on the runtime. Same probe as _lib/themes.mjs.
async function readStaticFallback() {
  const roots = [process.cwd(), process.env.LAMBDA_TASK_ROOT, "/var/task"].filter(Boolean);
  for (const root of roots) {
    try { return await readFile(join(root, "site", "today", "index.html"), "utf8"); }
    catch { /* try the next root */ }
  }
  return null;
}

// An hour at the edge, and a day of stale-while-revalidate so a cold AniList
// never shows a visitor an error page. Google re-crawls /today/ far more often
// than once an hour; anything shorter buys nothing and costs invocations.
const CACHE = "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400";

function renderToday(media, now = Date.now()) {
  const nowS = now / 1000;
  const dayStart = Math.floor(nowS / 86400) * 86400, dayEnd = dayStart + 86400;

  const events = [];
  for (const md of media) {
    if (isAdultMedia(md)) continue;                    // these pages stay SFW
    for (const n of (md.airingSchedule && md.airingSchedule.nodes) || [])
      if (n.airingAt >= dayStart && n.airingAt < dayEnd) events.push({ md, ep: n.episode, ts: n.airingAt });
  }
  events.sort((a, b) => a.ts - b.ts);

  const today = new Date(dayStart * 1000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const cur = new Date(dayStart * 1000);
  const curSeason = seasonOf(cur.getUTCMonth()), curYear = cur.getUTCFullYear();
  const allSlugs = [-1, 0, 1, 2].map(d => shiftSeason(curSeason, curYear, d))
    .map(t => ({ slug: slugOf(t.season, t.year), label: labelOf(t.season, t.year) }));

  const cards = events.length
    ? events.map(e => cardHTML(e.md, `Episode ${e.ep} · ${new Date(e.ts * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`,
        { premiere: e.ep === 1, finale: isFinale(e.md, e.ep) })).join("")
    : `<p class="lede" style="margin-top:20px">No episodes are scheduled for today in the current season data. Check the <a href="/">full calendar</a> for the days around now.</p>`;

  const names = events.slice(0, 6).map(e => title(e.md));
  const premieres = events.filter(e => e.ep === 1), finales = events.filter(e => isFinale(e.md, e.ep));

  const desc = events.length
    ? `${events.length} anime episodes air today (${today}, UTC): ${names.slice(0, 4).join(", ")} and more. Times, premieres and finales.`
    : `See which anime episodes are airing today and this week on Tsuzuki's live release calendar.`;

  const lede = `Every anime episode scheduled for <strong>today</strong> (${esc(today)}, times in UTC)` +
    `${premieres.length || finales.length ? ` — including ${[premieres.length ? `${premieres.length} premiere${premieres.length === 1 ? "" : "s"}` : "", finales.length ? `${finales.length} finale${finales.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}` : ""}. ` +
    `Want your local times, countdowns and reminders? Open the <a href="/">live calendar</a>.`;

  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: `Anime Airing Today — ${today}`,
    numberOfItems: events.length,
    itemListElement: events.slice(0, 50).map((e, i) => ({ "@type": "ListItem", position: i + 1, name: title(e.md), url: `${SITE}/anime/${animeSlug(e.md)}/` })),
  });

  const top = events[0] && events[0].md;
  return shell({
    titleTag: `Anime Airing Today — ${today} | Tsuzuki`,
    desc, canonical: `${SITE}/today/`, h1: "Anime Airing Today", lede,
    body: seasonNav(allSlugs, null) + `<div class="grid">${cards}</div>`,
    jsonld, ogImage: ogFor(top), ogLarge: !!(top && top.bannerImage),
  });
}

export default async () => {
  try {
    const now = new Date();
    const media = await getSeasonWindow(seasonOf(now.getUTCMonth()), now.getUTCFullYear());
    return new Response(renderToday(media, now.getTime()), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE },
    });
  } catch (err) {
    // Degrade to exactly what the site did before this function existed: the
    // last generated copy. Stale, but a real page — and cached for a minute
    // only, so the next request tries live again.
    console.warn("today: live render failed, serving the committed page —", err.message);
    const stale = await readStaticFallback();
    if (stale) {
      return new Response(stale, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
      });
    }
    console.error("today: no fallback on disk either");
    return new Response("Temporarily unavailable.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
};

export { renderToday };   // exercised by scripts/test-today.mjs without a network or a clock
