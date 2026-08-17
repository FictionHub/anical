/* ============================================================
   Tsuzuki — programmatic SEO page generator
   Builds static, server-rendered landing pages from live AniList
   data so Google can index real anime titles + dates (the app
   itself is JS-only and mostly invisible to crawlers):

     /today/             "what anime is airing today"
     /spring-2026/ etc.  "<season> <year> anime schedule"  (prev→next+1)
     /anime/<slug>-<id>/ one rich page per show (schedule, score, studio…)

   Each page sets per-page Open Graph / Twitter images using the show's
   own AniList banner/cover art, so links shared to Discord/X/Facebook
   show real artwork instead of one generic image. Also (re)writes
   site/sitemap.xml listing every generated page.

   Zero npm deps (Node 18+ global fetch). Resilient by design:
   any single season failing is skipped, and the whole script
   ALWAYS exits 0 so a transient AniList hiccup never fails the
   deploy. Run locally with:  node scripts/build-seo.mjs
   ============================================================ */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Dependency-free by design, so importing these here keeps this generator's
// "zero npm deps" promise intact even though they live under netlify/.
import { collectSeasonless } from "../netlify/functions/_lib/seasonless.mjs";
// The page shell, the brand CSS, the card markup and the date formatters. They
// live under netlify/ rather than here because netlify/functions/today.mjs
// renders /today/ live from the same kit — see that file for why /today/ can no
// longer be a build-time artefact.
import {
  SITE, DEFAULT_OG, CF_BEACON,
  ORDER, FMT_LABEL, SOURCE_LABEL,
  seasonOf, shiftSeason, slugOf, labelOf, title, isFinale, isAdultMedia,
  esc, plain, slugify, animeSlug, ogFor,
  BRAND_CSS, shell, cardHTML, seasonNav,
  fmtDateTime, fmtDateSafe, fmtDateLong, isoDate,
} from "../netlify/functions/_lib/seo-shell.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(APP_DIR, "..", "site");
const MAX_ANIME_PAGES = 600;   // safety bound on per-show pages

/* ---------------- AniList ---------------- */
const ANILIST = "https://graphql.anilist.co";
// One field list, shared by the season query and the seasonless one below, so a
// field added for one page type can't go missing on the other.
const SEO_MEDIA_FIELDS = `
      id title { romaji english native } format episodes duration genres averageScore popularity
      status source isAdult season seasonYear siteUrl
      description(asHtml: false)
      coverImage { large medium color } bannerImage
      startDate { year month day } endDate { year month day }
      studios(isMain: true) { nodes { name } }
      trailer { id site }
      externalLinks { site url type color }
      airingSchedule { nodes { airingAt episode } }`;
const QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) { ${SEO_MEDIA_FIELDS} }
  }
}`;


async function fetchSeason(season, year, maxPages = 2) {
  let all = [], page = 1, more = true;
  while (more && page <= maxPages) {
    const res = await fetch(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { season, seasonYear: year, page } }),
    });
    if (!res.ok) throw new Error("AniList HTTP " + res.status);
    const j = await res.json();
    if (j.errors) throw new Error(j.errors[0].message);
    all = all.concat(j.data.Page.media);
    more = j.data.Page.pageInfo.hasNextPage;
    page++;
  }
  return all.filter(md => !isAdultMedia(md));   // SFW public pages
}

// Titles AniList assigned no season — see netlify/functions/_lib/seasonless.mjs.
// They belong on /today/, the union pages and the feeds (they are airing), but
// NOT on a /<season>-<year>/ page, which is a season listing by definition.
// Never fatal: this generator must always exit 0, so a failure here costs the
// extra titles and nothing else.
async function fetchSeasonlessMedia() {
  try {
    const media = await collectSeasonless(async (query, variables) => {
      const res = await fetch(ANILIST, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error("AniList HTTP " + res.status);
      const j = await res.json();
      if (j.errors) throw new Error(j.errors[0].message);
      return j;
    }, SEO_MEDIA_FIELDS);
    return media.filter(md => !isAdultMedia(md));
  } catch (e) {
    console.warn("⚠ seasonless fetch failed: " + e.message);
    return [];
  }
}


/* The single most-searched fact about an unaired show is its release date, and
   until Aug 2026 these pages never printed one: the date sat in the JSON-LD and
   in `startDate` while the visible HTML said only "not yet released". Search
   Console showed the result — "<title> season 2 release date" queries ranking
   around position 12 with a 0% CTR, because the snippet Google could build
   answered nothing. This returns the date as text, in the title tag, and in the
   meta description.

   Returns null when AniList genuinely has no date, which is the only case where
   "not yet released" is the honest answer. */
function releaseInfo(md, nextEp) {
  const sd = md.startDate || {}, ed = md.endDate || {};
  const status = (md.status || "").toUpperCase();
  const exact = !!(sd.year && sd.month && sd.day);
  const known = !!(sd.year && sd.month);
  const startLong = fmtDateLong(sd.year, sd.month, sd.day);
  const startShort = fmtDateSafe(sd.year, sd.month, sd.day);
  const verb = md.format === "MOVIE" ? "Releases" : "Premieres";

  // `line` is the sentence in the lede; `label`/`value`/`aside` are the answer
  // box under the hero. They must not be the same words — the box exists to be
  // scannable, and repeating the lede verbatim two paragraphs later is padding.
  if (status === "NOT_YET_RELEASED" || (!nextEp && known && new Date(Date.UTC(sd.year, sd.month - 1, sd.day || 1)).getTime() > Date.now())) {
    if (!known) {
      // A year with no month is still more than "not yet released" — say so, but
      // don't dress an estimate up as a date.
      if (!sd.year) return null;
      return {
        pill: String(sd.year),
        line: `Scheduled for <strong>${sd.year}</strong>. AniList has not confirmed a month yet — this page updates when it does.`,
        label: "Release window", value: String(sd.year), aside: "month not yet announced",
        short: `Expected ${sd.year}`, titleBit: `${sd.year} Release Date`,
        descBit: `Scheduled for ${sd.year}; exact date not yet announced.`, iso: undefined,
      };
    }
    const days = Math.ceil((Date.UTC(sd.year, sd.month - 1, sd.day || 1) - Date.now()) / 86400000);
    return {
      pill: startShort,
      line: `${verb} <strong>${esc(startLong)}</strong>${exact ? "" : " (day not yet confirmed)"}${days > 0 ? `, ${days} day${days === 1 ? "" : "s"} from now` : ""}.`,
      label: "Release date", value: startShort,
      aside: [exact ? "" : "day TBC", days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
      short: `${verb} ${startShort}`, titleBit: `Release Date: ${startShort}`,
      descBit: `${verb} ${startLong}${exact ? "" : " (day TBC)"}.`, iso: isoDate(sd),
    };
  }

  if (status === "RELEASING" || nextEp) {
    return {
      pill: known ? `Since ${startShort}` : "",
      line: `${known ? `Airing since <strong>${esc(startLong)}</strong>. ` : ""}${nextEp ? `Episode <strong>${nextEp.episode}</strong> airs ${esc(fmtDateTime(nextEp.airingAt))}.` : "Currently airing."}`,
      label: nextEp ? "Next episode" : "Status",
      value: nextEp ? `Episode ${nextEp.episode} · ${fmtDateTime(nextEp.airingAt)}` : "Currently airing",
      aside: known ? `airing since ${startShort}` : "",
      short: nextEp ? `Ep ${nextEp.episode} · ${fmtDateTime(nextEp.airingAt)}` : "Currently airing",
      titleBit: "Episode Schedule & Air Dates",
      descBit: nextEp ? `Episode ${nextEp.episode} airs ${fmtDateTime(nextEp.airingAt)}.` : "Currently airing.",
      iso: isoDate(sd),
    };
  }

  if (known) {
    const endShort = ed.year && ed.month ? fmtDateSafe(ed.year, ed.month, ed.day) : "";
    const ranged = endShort && endShort !== startShort;
    return {
      pill: ranged ? `${startShort} – ${endShort}` : startShort,
      line: ranged
        ? `Aired <strong>${esc(startLong)}</strong> to <strong>${esc(fmtDateLong(ed.year, ed.month, ed.day))}</strong>.`
        : `Released <strong>${esc(startLong)}</strong>.`,
      label: ranged ? "Aired" : "Released",
      value: ranged ? `${startShort} – ${endShort}` : startShort,
      aside: md.episodes ? `${md.episodes} episode${md.episodes === 1 ? "" : "s"}` : "",
      short: ranged ? `${startShort} – ${endShort}` : startShort,
      titleBit: "Air Dates & Episode List",
      descBit: ranged ? `Aired ${startLong} to ${fmtDateLong(ed.year, ed.month, ed.day)}.` : `Released ${startLong}.`,
      iso: isoDate(sd),
    };
  }
  return null;
}

async function writePage(relDir, html) {
  const dir = join(SITE_DIR, ...relDir.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), html, "utf8");
}

/* ---------------- subscribable .ics calendar feeds ---------------- */
const pad2 = n => String(n).padStart(2, "0");
const icsStamp = d => d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
const icsEsc = s => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => "\\" + m);
function vevent(uid, start, summary, desc, url) {
  const end = new Date(start.getTime() + 30 * 60000);
  // DTSTAMP = DTSTART (deterministic) so unchanged data produces an identical file (no daily git churn).
  return ["BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + icsStamp(start), "DTSTART:" + icsStamp(start), "DTEND:" + icsStamp(end),
    "SUMMARY:" + icsEsc(summary), desc ? "DESCRIPTION:" + icsEsc(desc) : null, url ? "URL:" + icsEsc(url) : null, "END:VEVENT"].filter(Boolean).join("\r\n");
}
function calWrap(name, events) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tsuzuki//tsuzuki.top//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsEsc(name), "X-WR-TIMEZONE:UTC", "NAME:" + icsEsc(name), "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
    ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
}
async function buildFeeds(union) {
  const now = Date.now() / 1000, past = now - 2 * 86400;
  const farHorizon = now + 150 * 86400;   // premieres/finales (small lists)
  const allHorizon = now + 45 * 86400;    // all-episodes feed (bounded for size)
  const prem = [], fin = [], all = [];
  for (const md of union) {
    const link = `${SITE}/anime/${animeSlug(md)}/`;
    for (const n of (md.airingSchedule && md.airingSchedule.nodes) || []) {
      if (n.airingAt < past) continue;
      const d = new Date(n.airingAt * 1000);
      if (n.airingAt <= farHorizon && n.episode === 1)
        prem.push(vevent(`tsuzuki-${md.id}-1@tsuzuki.netlify.app`, d, `${title(md)} — Premiere (Ep 1)`, `New anime premiere. ${link}`, link));
      if (n.airingAt <= farHorizon && isFinale(md, n.episode))
        fin.push(vevent(`tsuzuki-${md.id}-f${n.episode}@tsuzuki.netlify.app`, d, `${title(md)} — Finale (Ep ${n.episode})`, `Season finale. ${link}`, link));
      if (n.airingAt <= allHorizon)
        all.push(vevent(`tsuzuki-${md.id}-${n.episode}@tsuzuki.netlify.app`, d, `${title(md)} — Ep ${n.episode}`, link, link));
    }
  }
  await mkdir(join(SITE_DIR, "feeds"), { recursive: true });
  await writeFile(join(SITE_DIR, "feeds", "premieres.ics"), calWrap("Tsuzuki — Anime Premieres", prem), "utf8");
  await writeFile(join(SITE_DIR, "feeds", "finales.ics"), calWrap("Tsuzuki — Season Finales", fin), "utf8");
  await writeFile(join(SITE_DIR, "feeds", "all.ics"), calWrap("Tsuzuki — All Episodes (next ~6 weeks)", all), "utf8");
  return { prem: prem.length, fin: fin.length, all: all.length };
}

/* ---------------- RSS 2.0 feed (premieres & finales) ----------------
   A subscribable news feed of imminent and recent premieres/finales so people
   can follow new-anime announcements in any RSS reader. Forward-looking: the
   soonest/upcoming items sort to the top (pubDate = air date, newest first). */
async function buildRss(union) {
  const now = Date.now() / 1000;
  const past = now - 30 * 86400, horizon = now + 150 * 86400;   // last month → next ~5 months
  const items = [];
  for (const md of union) {
    const link = `${SITE}/anime/${animeSlug(md)}/`;
    const t = title(md);
    for (const n of (md.airingSchedule && md.airingSchedule.nodes) || []) {
      if (n.airingAt < past || n.airingAt > horizon) continue;
      const isPrem = n.episode === 1, isFin = isFinale(md, n.episode);
      if (!isPrem && !isFin) continue;
      const kind = isPrem ? "Premiere" : "Finale";
      items.push({
        at: n.airingAt,
        title: `${t} — ${kind} (Ep ${n.episode})`,
        link,
        guid: `tsuzuki-rss-${md.id}-${isPrem ? "p" : "f"}${n.episode}`,
        desc: `${kind}: ${plain(md.description, 280) || `${t} airs episode ${n.episode}.`}`,
      });
    }
  }
  items.sort((a, b) => b.at - a.at);                              // newest pubDate first
  const top = items.slice(0, 50);
  const built = new Date().toUTCString();
  const xmlItems = top.map(it => `    <item>
      <title>${esc(it.title)}</title>
      <link>${esc(it.link)}</link>
      <guid isPermaLink="false">${esc(it.guid)}</guid>
      <pubDate>${new Date(it.at * 1000).toUTCString()}</pubDate>
      <description>${esc(it.desc)}</description>
    </item>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Tsuzuki — Anime Premieres &amp; Finales</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Upcoming and recent anime premieres and season finales, updated daily.</description>
    <language>en</language>
    <lastBuildDate>${built}</lastBuildDate>
    <ttl>720</ttl>
${xmlItems}
  </channel>
</rss>
`;
  await writeFile(join(SITE_DIR, "feed.xml"), xml, "utf8");
  return top.length;
}

/* ---------------- per-anime page ---------------- */
/* Sibling links, so a show is not a dead end.
   Every /anime/ page used to link only "upward" — to its season, its genres, its
   studio — and never sideways to another show. Google reported 0 internal links
   for the whole property and left 629 of 654 URLs in "Discovered - currently not
   indexed": found in the sitemap, never crawled, because nothing on a crawled
   page pointed at them. These blocks are the crawl path. `index` is the maps
   already built in the runner, so this costs no extra fetching. */
function relatedBlocks(md, index) {
  if (!index) return "";
  const out = [];
  const self = md.id;
  // Only ever link to a page this run actually writes. The maps are built from
  // the whole union, but only the first MAX_ANIME_PAGES of it get pages — without
  // this filter a busy season would publish internal links straight into 404s,
  // which is worse for crawling than no link at all.
  const cardsFrom = (list, n) => list.filter(x => x.id !== self && index.builtIds.has(x.id)).slice(0, n);
  const section = (heading, sub, list) => list.length
    ? `<h2 style="font-size:18px;margin-top:28px">${heading}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}<div class="grid">${list.map(x => {
        const sd = x.startDate || {};
        return cardHTML(x, sd.year && sd.month ? `Premieres ${fmtDateSafe(sd.year, sd.month, sd.day)}` : "");
      }).join("")}</div>`
    : "";

  const studio = md.studios && md.studios.nodes && md.studios.nodes[0] && md.studios.nodes[0].name;
  if (studio && index.byStudio.has(studio)) {
    const sibs = cardsFrom(index.byStudio.get(studio).slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0)), 6);
    if (sibs.length) out.push(section(`More from ${esc(studio)}`,
      `Other anime animated by ${esc(studio)}.${index.studioSlugSet.has(slugify(studio)) ? ` <a href="/studio/${slugify(studio)}/">See all →</a>` : ""}`, sibs));
  }

  // The strongest "people who searched this also want that" signal we hold: the
  // same season. Someone reading a Fall 2026 page is shopping the Fall lineup.
  const seasonKey = md.season && md.seasonYear ? `${md.season}-${md.seasonYear}` : null;
  if (seasonKey && index.bySeason.has(seasonKey)) {
    const label = labelOf(md.season, md.seasonYear), sslug = slugOf(md.season, md.seasonYear);
    const sibs = cardsFrom(index.bySeason.get(seasonKey).slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0)), 8);
    if (sibs.length) out.push(section(`Also premiering in ${esc(label)}`,
      `The rest of the season, most popular first. <a href="/${sslug}/">Full ${esc(label)} schedule →</a>`, sibs));
  }

  // Genre neighbours are the widest net, so they go last and are capped hardest:
  // the point is a handful of crawlable, relevant links, not a link farm.
  const g = (md.genres || [])[0];
  if (g && index.byGenre.has(g)) {
    const sibs = cardsFrom(index.byGenre.get(g).slice().sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0)), 6);
    if (sibs.length) out.push(section(`Top ${esc(g)} anime`,
      `Highest-rated ${esc(g)} titles Tsuzuki tracks. <a href="/genre/${slugify(g)}/">All ${esc(g)} anime →</a>`, sibs));
  }
  return out.join("");
}

async function buildAnimePage(md, seasonSlugs, studioSlugSet, index) {
  const slug = animeSlug(md);
  const t = title(md);
  const fmt = FMT_LABEL[md.format] || md.format || "Anime";
  const studio = md.studios && md.studios.nodes && md.studios.nodes[0] ? md.studios.nodes[0].name : "";
  const seasonLabel = md.season && md.seasonYear ? labelOf(md.season, md.seasonYear) : "";
  const seasonSlug = md.season && md.seasonYear ? slugOf(md.season, md.seasonYear) : "";
  const src = md.source ? (SOURCE_LABEL[md.source] || md.source) : "";
  const statusTxt = (md.status || "").replace(/_/g, " ").toLowerCase();
  const body0 = plain(md.description, 0);

  const now = Date.now() / 1000;
  const nodes = ((md.airingSchedule && md.airingSchedule.nodes) || []).slice().sort((a, b) => a.airingAt - b.airingAt);
  const next = nodes.find(n => n.airingAt > now);

  const rel = releaseInfo(md, next);

  const metaPills = [
    `<span class="pill">${esc(fmt)}</span>`,
    rel && rel.pill ? `<span class="pill prem">${esc(rel.pill)}</span>` : "",
    md.episodes ? `<span class="pill">${md.episodes} episodes</span>` : "",
    md.duration ? `<span class="pill">${md.duration} min/ep</span>` : "",
    md.averageScore ? `<span class="pill score">★ ${md.averageScore}</span>` : "",
    statusTxt ? `<span class="pill">${esc(statusTxt)}</span>` : "",
    src ? `<span class="pill">${esc(src)}</span>` : "",
  ].filter(Boolean).join("");
  const genres = (md.genres || []).slice(0, 6).map(g => `<a class="pill" href="/genre/${slugify(g)}/">${esc(g)}</a>`).join(" ");
  const studioHTML = studio
    ? (studioSlugSet && studioSlugSet.has(slugify(studio)) ? `Studio: <a href="/studio/${slugify(studio)}/">${esc(studio)}</a>` : `Studio: ${esc(studio)}`)
    : "";

  const schedRows = nodes.slice(0, 14).map(n => {
    const up = n.airingAt > now;
    const fin = isFinale(md, n.episode) ? ' <span class="pill fin">🏁 FINALE</span>' : (n.episode === 1 ? ' <span class="pill prem">PREMIERE</span>' : "");
    return `<div class="row${up ? "" : " past"}"><span>Episode ${n.episode}${fin}</span><span class="when2">${esc(fmtDateTime(n.airingAt))}</span></div>`;
  }).join("");

  const cover = md.coverImage ? (md.coverImage.large || md.coverImage.medium) : "";
  const banner = md.bannerImage ? `<img class="banner" src="${esc(md.bannerImage)}" alt="${esc(t)} banner art" loading="lazy">` : "";

  const seenS = new Set();
  const streams = (md.externalLinks || []).filter(l => l && l.type === "STREAMING" && l.url && !seenS.has((l.site || "").toLowerCase()) && seenS.add((l.site || "").toLowerCase()));
  const watchHTML = streams.length
    ? `<h2 style="font-size:18px;margin-top:24px">Where to watch ${esc(t)}</h2><div class="watch">` +
      streams.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="border-color:${esc(l.color || "#2a3140")}">${esc(l.site || "Stream")}</a>`).join("") + `</div>` +
      `<p class="when" style="margin-top:8px"><a href="/where-to-watch/${slug}/">More on where to watch ${esc(t)} →</a></p>`
    : "";

  const lede = `${rel ? rel.line + " " : (statusTxt === "not yet released" ? "No release date has been announced yet. " : "")}` +
    `${seasonLabel ? `Part of the <a href="/${seasonSlug}/">${esc(seasonLabel)} anime season</a>. ` : ""}` +
    `See full air dates, episode count and score below, or open the live calendar for local times, countdowns and reminders.`;

  // The date leads the description because that is the question the query asked.
  // Google truncates around 155-160 chars, so anything after it is a bonus.
  const desc = plain([rel ? rel.descBit : "", body0 || `${t} (${fmt}) — air dates, episode schedule, score and studio.`, seasonLabel ? `${seasonLabel} anime.` : ""].filter(Boolean).join(" "), 300);

  const crumbs = `<div class="crumbs"><a href="/">Home</a> › ${seasonLabel ? `<a href="/${seasonSlug}/">${esc(seasonLabel)}</a> › ` : ""}${esc(t)}</div>`;

  const body = `
    ${banner}
    <div class="hero">
      ${cover ? `<img class="cover" src="${esc(cover)}" alt="${esc(t)} cover" loading="lazy" width="170">` : ""}
      <div class="hinfo">
        <div class="meta">${metaPills}</div>
        ${studioHTML ? `<div class="when">${studioHTML}</div>` : ""}
        <div class="meta" style="margin-top:8px">${genres}</div>
        <div style="margin-top:12px">
          <a class="cta" href="/">View on the live calendar →</a>
          ${md.siteUrl ? `<a class="cta alt" href="${esc(md.siteUrl)}" target="_blank" rel="noopener">AniList</a>` : ""}
          ${md.trailer && md.trailer.site === "youtube" && md.trailer.id ? `<a class="cta alt" href="https://youtu.be/${esc(md.trailer.id)}" target="_blank" rel="noopener">Trailer</a>` : ""}
        </div>
      </div>
    </div>
    ${rel ? `<div class="airbox"><div class="airbox-k">${esc(rel.label)}</div><div class="airbox-v"><strong>${esc(rel.value)}</strong>${rel.aside ? ` <span class="airbox-aside">${esc(rel.aside)}</span>` : ""}</div></div>` : ""}
    ${body0 ? `<p class="desc">${esc(plain(body0, 700))}</p>` : ""}
    ${watchHTML}
    ${schedRows
      ? `<h2 style="font-size:18px;margin-top:24px">Episode air dates</h2><div class="sched">${schedRows}</div>`
      : rel && rel.iso
        // No per-episode schedule from AniList yet — but a dated heading still
        // answers the query, where an omitted section answered nothing.
        ? `<h2 style="font-size:18px;margin-top:24px">${esc(t)} air date</h2><div class="sched"><div class="row"><span>Episode 1${md.episodes ? ` of ${md.episodes}` : ""}</span><span class="when2">${esc(rel.short)}</span></div></div><p class="when">Per-episode times appear here as soon as AniList publishes the broadcast schedule.</p>`
        : ""}
    ${relatedBlocks(md, index)}
    ${seasonSlugs ? seasonNav(seasonSlugs, seasonSlug) : ""}`;

  const ratingLd = md.averageScore ? {
    aggregateRating: { "@type": "AggregateRating", ratingValue: (md.averageScore / 10).toFixed(1), bestRating: "10", ratingCount: Math.max(1, md.popularity || 1) }
  } : {};
  let videoLd = null;
  if (md.trailer && md.trailer.id && (md.trailer.site === "youtube" || md.trailer.site === "dailymotion")) {
    const yt = md.trailer.site === "youtube";
    videoLd = {
      "@type": "VideoObject", name: `${t} — Trailer`, description: desc,
      thumbnailUrl: yt ? `https://i.ytimg.com/vi/${md.trailer.id}/hqdefault.jpg` : (cover || ogFor(md)),
      embedUrl: yt ? `https://www.youtube.com/embed/${md.trailer.id}` : `https://www.dailymotion.com/embed/video/${md.trailer.id}`,
      // NOT the show's startDate. That was the old value, and for an unaired
      // title it declared a trailer uploaded in the future — which is both false
      // and enough for Google to drop the video rich result. AniList exposes no
      // upload date for the trailer, so the honest move is to omit the property:
      // VideoObject treats it as recommended, not required.
      uploadDate: undefined,
    };
  }
  const jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      ...(videoLd ? [videoLd] : []),
      {
        "@type": "TVSeries",
        name: t,
        alternateName: md.title.romaji && md.title.romaji !== t ? md.title.romaji : undefined,
        url: `${SITE}/anime/${slug}/`,
        image: cover || ogFor(md),
        description: desc,
        genre: md.genres || undefined,
        numberOfEpisodes: md.episodes || undefined,
        startDate: md.startDate && md.startDate.year ? `${md.startDate.year}-${String(md.startDate.month || 1).padStart(2, "0")}-${String(md.startDate.day || 1).padStart(2, "0")}` : undefined,
        productionCompany: studio ? { "@type": "Organization", name: studio } : undefined,
        sameAs: md.siteUrl || undefined,
        ...ratingLd,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Tsuzuki", item: SITE + "/" },
          ...(seasonLabel ? [{ "@type": "ListItem", position: 2, name: seasonLabel, item: `${SITE}/${seasonSlug}/` }] : []),
          { "@type": "ListItem", position: seasonLabel ? 3 : 2, name: t, item: `${SITE}/anime/${slug}/` },
        ],
      },
    ],
  });

  // Put the date in the title tag itself when there is one. "Release Date: Oct 1,
  // 2026" is a literal match for the query these pages already rank for, and the
  // title is the half of the snippet Google rewrites least.
  const html = shell({
    titleTag: `${t} — ${rel ? rel.titleBit : "Air Dates, Episodes & Schedule"} | Tsuzuki`,
    desc, canonical: `${SITE}/anime/${slug}/`, h1: t, lede, body, jsonld, crumbs,
    ogImage: ogFor(md), ogLarge: !!md.bannerImage,
  });
  await writePage(`anime/${slug}`, html);
  return slug;
}

/* ---------------- standalone "where to watch <title>" pages ---------------- */
async function buildWatchPage(md, seasonSlugs) {
  const slug = animeSlug(md), t = title(md);
  const seenS = new Set();
  const streams = (md.externalLinks || []).filter(l => l && l.type === "STREAMING" && l.url && !seenS.has((l.site || "").toLowerCase()) && seenS.add((l.site || "").toLowerCase()));
  if (!streams.length) return null;
  const services = streams.map(l => l.site).filter(Boolean);
  const now = Date.now() / 1000;
  const next = ((md.airingSchedule && md.airingSchedule.nodes) || []).slice().sort((a, b) => a.airingAt - b.airingAt).find(n => n.airingAt > now);
  const cover = md.coverImage ? (md.coverImage.large || md.coverImage.medium) : "";
  const desc = `Where to watch ${t}: stream it on ${services.join(", ")}.${next ? ` Episode ${next.episode} airs ${fmtDateTime(next.airingAt)}.` : ""} Air dates, episodes and official links.`.slice(0, 300);
  const lede = `Stream <strong>${esc(t)}</strong> on ${esc(services.join(", "))}. ${next ? `Next: episode ${next.episode}, ${esc(fmtDateTime(next.airingAt))}. ` : ""}` +
    `For the full episode schedule in your local time, see the <a href="/anime/${slug}/">${esc(t)} schedule</a> or the <a href="/">live calendar</a>.`;
  const crumbs = `<div class="crumbs"><a href="/">Home</a> › <a href="/anime/${slug}/">${esc(t)}</a> › Where to watch</div>`;
  const watchBtns = `<div class="watch">` + streams.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="border-color:${esc(l.color || "#2a3140")}">${esc(l.site || "Stream")}</a>`).join("") + `</div>`;
  const body = `
    ${md.bannerImage ? `<img class="banner" src="${esc(md.bannerImage)}" alt="${esc(t)} banner art" loading="lazy">` : ""}
    <div class="hero">
      ${cover ? `<img class="cover" src="${esc(cover)}" alt="${esc(t)} cover" loading="lazy" width="170">` : ""}
      <div class="hinfo">
        <h2 style="margin:0 0 8px;font-size:18px">Streaming services</h2>
        ${watchBtns}
        <div style="margin-top:14px"><a class="cta" href="/anime/${slug}/">Full schedule & episodes →</a> <a class="cta alt" href="/">Live calendar</a></div>
      </div>
    </div>`;
  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Tsuzuki", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: t, item: `${SITE}/anime/${slug}/` },
      { "@type": "ListItem", position: 3, name: "Where to watch", item: `${SITE}/where-to-watch/${slug}/` },
    ],
  });
  const html = shell({
    titleTag: `Where to Watch ${t} — Stream Online | Tsuzuki`,
    desc, canonical: `${SITE}/where-to-watch/${slug}/`, h1: `Where to watch ${t}`, lede, body, jsonld, crumbs,
    ogImage: ogFor(md), ogLarge: !!md.bannerImage,
  });
  await writePage(`where-to-watch/${slug}`, html);
  return slug;
}

/* ---------------- genre / studio collection pages ---------------- */
/* Derived facts about a set of shows.
   The studio pages shipped at ~127 words of which ~110 were the same boilerplate
   on all 100 of them, and Google indexed almost none: near-duplicate templates
   with a title list are exactly what "Discovered - currently not indexed" is for.
   Everything below is computed from data already in hand — no extra requests —
   and it is what makes one studio page differ from the next in substance rather
   than in the list of names. */
function collectionStats(list) {
  const scored = list.filter(m => m.averageScore);
  const avg = scored.length ? Math.round(scored.reduce((a, m) => a + m.averageScore, 0) / scored.length) : null;
  const eps = list.reduce((a, m) => a + (m.episodes || 0), 0);
  const seasons = new Map();
  for (const m of list) if (m.season && m.seasonYear) {
    const k = slugOf(m.season, m.seasonYear);
    seasons.set(k, (seasons.get(k) || 0) + 1);
  }
  const genres = new Map();
  for (const m of list) for (const g of m.genres || []) genres.set(g, (genres.get(g) || 0) + 1);
  const fmts = new Map();
  for (const m of list) { const f = FMT_LABEL[m.format] || m.format; if (f) fmts.set(f, (fmts.get(f) || 0) + 1); }
  const sources = new Map();
  for (const m of list) if (m.source) { const s = SOURCE_LABEL[m.source] || m.source; sources.set(s, (sources.get(s) || 0) + 1); }
  const upcoming = list.filter(m => (m.status || "").toUpperCase() === "NOT_YET_RELEASED" && m.startDate && m.startDate.year)
    .sort((a, b) => (isoDate(a.startDate) || "").localeCompare(isoDate(b.startDate) || ""));
  const airing = list.filter(m => (m.status || "").toUpperCase() === "RELEASING");
  const rank = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { avg, eps, seasons: rank(seasons), genres: rank(genres), fmts: rank(fmts), sources: rank(sources), upcoming, airing, scoredCount: scored.length };
}

function statTiles(tiles) {
  const cells = tiles.filter(t => t && t[1] != null && t[1] !== "").map(([label, v]) => `<div class="stat"><b>${esc(String(v))}</b><span>${esc(label)}</span></div>`).join("");
  return cells ? `<div class="stats">${cells}</div>` : "";
}

async function buildCollectionPage(kind, name, items, allSlugs) {
  const slug = slugify(name);
  const sorted = items.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const top = sorted[0];
  const names = sorted.slice(0, 6).map(title);
  const human = `${name} Anime`;
  const st = collectionStats(sorted);
  const isStudio = kind === "studio";
  const topRated = sorted.filter(m => m.averageScore).sort((a, b) => b.averageScore - a.averageScore)[0];

  // Lead the description with what this page holds that no other page does.
  const desc = (isStudio
    ? `${name} has ${sorted.length} anime in Tsuzuki's schedule${st.airing.length ? `, ${st.airing.length} airing now` : ""}${st.upcoming.length ? ` and ${st.upcoming.length} upcoming` : ""} — ${names.slice(0, 3).join(", ")}. Air dates, scores and where to watch.`
    : `${sorted.length} ${name} anime${st.avg ? `, averaging ★${st.avg}` : ""} — including ${names.slice(0, 3).join(", ")}. Air dates, scores, episode counts and where to watch.`).slice(0, 300);

  const lede = isStudio
    ? `Every anime animated by <strong>${esc(name)}</strong> that Tsuzuki tracks — ${sorted.length} title${sorted.length === 1 ? "" : "s"}${st.avg ? `, averaging <strong>★${st.avg}</strong> on AniList` : ""}. Open any title for air dates, streaming links and reminders.`
    : `Every <strong>${esc(name)}</strong> anime Tsuzuki is tracking — ${sorted.length} title${sorted.length === 1 ? "" : "s"}${st.avg ? `, averaging <strong>★${st.avg}</strong>` : ""}. Open any title for air dates, streaming links and reminders.`;

  const crumbs = `<div class="crumbs"><a href="/">Home</a> › <a href="/${isStudio ? "studios" : "genres"}/">${isStudio ? "Studios" : "Genres"}</a> › ${esc(name)}</div>`;

  const tiles = statTiles([
    ["titles tracked", sorted.length],
    st.airing.length ? ["airing now", st.airing.length] : null,
    st.upcoming.length ? ["upcoming", st.upcoming.length] : null,
    st.avg ? ["average score", "★" + st.avg] : null,
    st.eps ? ["episodes", st.eps.toLocaleString("en-US")] : null,
    st.seasons.length ? ["seasons covered", st.seasons.length] : null,
  ]);

  // A short written summary. Every clause is a fact this set actually has, so a
  // studio with one format and one genre gets a shorter paragraph rather than a
  // padded one.
  const fmtBit = st.fmts.length ? `mostly ${st.fmts[0][0]}${st.fmts.length > 1 ? ` (${st.fmts[0][1]} of ${sorted.length}), alongside ${st.fmts.slice(1, 3).map(f => `${f[1]} ${f[0]}`).join(" and ")}` : ""}` : "";
  const genreBit = !isStudio ? "" : (st.genres.length ? `Their work leans ${st.genres.slice(0, 3).map(g => `<a href="/genre/${slugify(g[0])}/">${esc(g[0])}</a>`).join(", ")}.` : "");
  const srcBit = st.sources.length ? `${st.sources[0][1]} of them adapt ${st.sources[0][0].toLowerCase()} source material.` : "";
  const nextBit = st.upcoming.length
    ? `Next up: <a href="/anime/${animeSlug(st.upcoming[0])}/">${esc(title(st.upcoming[0]))}</a>, ${fmtDateLong(st.upcoming[0].startDate.year, st.upcoming[0].startDate.month, st.upcoming[0].startDate.day) ? `premiering ${esc(fmtDateLong(st.upcoming[0].startDate.year, st.upcoming[0].startDate.month, st.upcoming[0].startDate.day))}` : `expected ${st.upcoming[0].startDate.year}`}.`
    : "";
  const bestBit = topRated && topRated.averageScore
    ? `The highest-rated is <a href="/anime/${animeSlug(topRated)}/">${esc(title(topRated))}</a> at ★${topRated.averageScore}.`
    : "";
  const prose = [
    isStudio
      ? `<strong>${esc(name)}</strong> accounts for ${sorted.length} title${sorted.length === 1 ? "" : "s"} across the seasons Tsuzuki covers${fmtBit ? `, ${fmtBit}` : ""}. ${genreBit} ${srcBit}`
      : `Tsuzuki tracks ${sorted.length} <strong>${esc(name)}</strong> title${sorted.length === 1 ? "" : "s"}${fmtBit ? `, ${fmtBit}` : ""}. ${srcBit}`,
    [bestBit, nextBit].filter(Boolean).join(" "),
  ].filter(s => s.replace(/<[^>]+>/g, "").trim().length > 10).map(p => `<p class="prose">${p.replace(/\s+/g, " ").trim()}</p>`).join("");

  const seasonBreakdown = st.seasons.length > 1
    ? `<h2>By season</h2><p class="sub">Where ${esc(name)}'s titles fall across the seasons Tsuzuki covers.</p><div class="hub">${
        st.seasons.map(([s, n]) => {
          const label = (allSlugs.find(a => a.slug === s) || {}).label || s;
          return `<a class="hub-link" href="/${s}/">${esc(label)}<span class="hub-n">${n}</span></a>`;
        }).join("")}</div>`
    : "";

  // Sideways links out of this page and into the neighbouring ones, so the hub
  // is not the only route between collections.
  const alsoBrowse = (isStudio ? st.genres.slice(0, 8).map(([g, n]) => `<a class="hub-link" href="/genre/${slugify(g)}/">${esc(g)}<span class="hub-n">${n}</span></a>`) : [])
    .join("");
  const alsoBlock = alsoBrowse ? `<h2>Genres ${esc(name)} works in</h2><div class="hub">${alsoBrowse}</div>` : "";

  const cards = sorted.map(md => {
    const sd = md.startDate || {};
    return cardHTML(md, sd.year ? `Premieres ${fmtDateSafe(sd.year, sd.month, sd.day)}` : "", { premiere: !!(sd.year && sd.month) });
  }).join("");

  const jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage", name: human, url: `${SITE}/${kind}/${slug}/`, description: desc,
        ...(isStudio ? { about: { "@type": "Organization", name, description: `Japanese animation studio with ${sorted.length} titles in Tsuzuki's schedule.` } } : {}),
      },
      {
        "@type": "ItemList", name: human, numberOfItems: sorted.length,
        itemListElement: sorted.slice(0, 50).map((md, i) => ({ "@type": "ListItem", position: i + 1, name: title(md), url: `${SITE}/anime/${animeSlug(md)}/` })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Tsuzuki", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: isStudio ? "Studios" : "Genres", item: `${SITE}/${isStudio ? "studios" : "genres"}/` },
          { "@type": "ListItem", position: 3, name, item: `${SITE}/${kind}/${slug}/` },
        ],
      },
    ],
  });

  const body = tiles + prose + seasonNav(allSlugs, null) +
    `<h2>All ${esc(name)} anime</h2><p class="sub">${sorted.length} title${sorted.length === 1 ? "" : "s"}, most popular first.</p><div class="grid">${cards}</div>` +
    seasonBreakdown + alsoBlock;

  const html = shell({
    titleTag: isStudio
      ? `${name} Anime — All ${sorted.length} Titles, Schedule & Scores | Tsuzuki`
      : `${human} — ${sorted.length} Titles, Schedule & Where to Watch | Tsuzuki`,
    desc, canonical: `${SITE}/${kind}/${slug}/`, h1: human, lede, body, jsonld, crumbs,
    ogImage: ogFor(top), ogLarge: !!(top && top.bannerImage),
  });
  await writePage(`${kind}/${slug}`, html);
  return slug;
}

/* ---------------- hub / index pages (/genres/, /studios/) ---------------- */
async function buildHubPage(kind, items, allSlugs) {
  const path = kind === "genre" ? "genres" : "studios";
  const human = kind === "genre" ? "Genres" : "Studios";
  const sorted = items.slice().sort((a, b) => kind === "genre" ? a.name.localeCompare(b.name) : ((b.count - a.count) || a.name.localeCompare(b.name)));
  const desc = `Browse anime by ${kind} — ${sorted.length} ${path} with air dates, scores and where to watch, updated automatically.`;
  const lede = `Browse every anime ${kind} Tsuzuki tracks. Pick a ${kind} to see its shows, air dates and streaming links.`;
  const crumbs = `<div class="crumbs"><a href="/">Home</a> › ${human}</div>`;
  const links = sorted.map(s => `<a class="hub-link" href="/${kind}/${s.slug}/">${esc(s.name)}<span class="hub-n">${s.count}</span></a>`).join("");
  const body = seasonNav(allSlugs, null) + `<div class="hub">${links}</div>`;
  const jsonld = JSON.stringify({ "@context": "https://schema.org", "@type": "CollectionPage", name: `Anime ${human}`, url: `${SITE}/${path}/` });
  const html = shell({ titleTag: `Anime by ${human} | Tsuzuki`, desc, canonical: `${SITE}/${path}/`, h1: `Anime ${human}`, lede, body, jsonld, crumbs });
  await writePage(path, html);
  return path;
}

/* ---------------- "best anime of <season>" pages ---------------- */
async function buildBestPage(media, season, year, allSlugs) {
  const label = labelOf(season, year), slug = slugOf(season, year);
  // rank by score, but require some popularity so a single-vote outlier can't top the list
  const ranked = media.filter(md => md.averageScore && (md.popularity || 0) >= 2000)
    .sort((a, b) => (b.averageScore - a.averageScore) || ((b.popularity || 0) - (a.popularity || 0))).slice(0, 25);
  if (ranked.length < 5) return null;
  const names = ranked.slice(0, 5).map(title), top = ranked[0];
  const desc = `The best ${label} anime ranked by score: ${names.slice(0, 3).join(", ")} and more — top-rated shows of the season with air dates and where to watch.`.slice(0, 300);
  const lede = `The highest-rated anime of <strong>${esc(label)}</strong>, ranked by AniList community score. See the full <a href="/${slug}/">${esc(label)} schedule</a> or the <a href="/">live calendar</a>.`;
  const crumbs = `<div class="crumbs"><a href="/">Home</a> › <a href="/${slug}/">${esc(label)}</a> › Best</div>`;
  const cards = ranked.map((md, i) => cardHTML(md, `#${i + 1} · ★ ${md.averageScore}`, {})).join("");
  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: `Best ${label} Anime`, numberOfItems: ranked.length,
    itemListElement: ranked.map((md, i) => ({ "@type": "ListItem", position: i + 1, name: title(md), url: `${SITE}/anime/${animeSlug(md)}/` })),
  });
  const body = seasonNav(allSlugs, slug) + `<div class="grid">${cards}</div>`;
  const html = shell({
    titleTag: `Best ${label} Anime — Top Rated | Tsuzuki`,
    desc, canonical: `${SITE}/best/${slug}/`, h1: `Best Anime of ${label}`, lede, body, jsonld, crumbs,
    ogImage: ogFor(top), ogLarge: !!(top && top.bannerImage),
  });
  await writePage(`best/${slug}`, html);
  return slug;
}

/* ---------------- /best/ — the rankings hub ----------------
   The per-season "best of" pages existed but nothing linked to /best/ itself,
   so every one of them was an orphan two clicks from nowhere. This is both the
   index for them and a real cross-season ranking in its own right — the page
   that answers "top anime" rather than "top anime of one specific season". */
const POP_FLOOR = 2000;   // votes needed before a score counts — one 10/10 rating isn't a ranking
async function buildBestHubPage(union, bestSlugs, allSlugs) {
  const rated = union.filter(md => md.averageScore && (md.popularity || 0) >= POP_FLOOR);
  const topRated = rated.slice().sort((a, b) => (b.averageScore - a.averageScore) || ((b.popularity || 0) - (a.popularity || 0))).slice(0, 50);
  const mostPopular = union.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 25);
  if (topRated.length < 5) return null;

  const top = topRated[0];
  const names = topRated.slice(0, 4).map(title);
  const desc = `The top-rated anime Tsuzuki is tracking — ${names.slice(0, 3).join(", ")} and more. Ranked by community score, with air dates, episode counts and where to watch.`.slice(0, 300);
  const lede = `The highest-rated anime across every season Tsuzuki tracks, ranked by AniList community score. Only titles with at least ${POP_FLOOR.toLocaleString("en-US")} members are ranked, so a single glowing review can't top the list.`;
  const crumbs = `<div class="crumbs"><a href="/">Home</a> › Top anime</div>`;

  const seasonLinks = bestSlugs.length
    ? `<h2>Best of each season</h2>
       <p class="sub">The same ranking, narrowed to one season at a time.</p>
       <div class="hub">${bestSlugs.map(s => {
         const label = (allSlugs.find(a => a.slug === s) || {}).label || s;
         return `<a class="hub-link" href="/best/${s}/">Best of ${esc(label)}</a>`;
       }).join("")}</div>`
    : "";

  const body = seasonNav(allSlugs, null) +
    `<h2>Top rated</h2><p class="sub">${topRated.length} titles, highest community score first.</p>
     <div class="grid rank">${topRated.map(md => cardHTML(md, `★ ${md.averageScore} · ${(md.popularity || 0).toLocaleString("en-US")} members`, {})).join("")}</div>` +
    `<h2>Most popular</h2><p class="sub">Ranked by how many people are tracking them, regardless of score.</p>
     <div class="grid rank">${mostPopular.map(md => cardHTML(md, `${(md.popularity || 0).toLocaleString("en-US")} members${md.averageScore ? ` · ★ ${md.averageScore}` : ""}`, {})).join("")}</div>` +
    seasonLinks;

  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: "Top Anime", numberOfItems: topRated.length,
    itemListElement: topRated.map((md, i) => ({ "@type": "ListItem", position: i + 1, name: title(md), url: `${SITE}/anime/${animeSlug(md)}/` })),
  });
  const html = shell({
    titleTag: "Top Anime — Best Rated & Most Popular | Tsuzuki",
    desc, canonical: `${SITE}/best/`, h1: "Top Anime", lede, body, jsonld, crumbs,
    ogImage: ogFor(top), ogLarge: !!(top && top.bannerImage),
  });
  await writePage("best", html);
  return "best";
}

/* ---------------- /where-to-watch/ — the streaming hub ----------------
   Same orphan problem as /best/: hundreds of /where-to-watch/<title>/ pages
   with no index above them. Grouping by platform is what the query behind them
   actually looks like ("what's on HIDIVE") and it can't collide with a title
   slug, since it's one page rather than a /where-to-watch/<platform>/ tier. */
const PLATFORM_MAX = 24;    // shows listed per platform before "see all"
async function buildWatchHubPage(union, allSlugs) {
  const byPlatform = new Map();
  for (const md of union) {
    if (!(md.externalLinks || []).some(l => l && l.type === "STREAMING" && l.url)) continue;
    const seen = new Set();
    for (const l of md.externalLinks) {
      if (!l || l.type !== "STREAMING" || !l.site || seen.has(l.site)) continue;
      seen.add(l.site);
      if (!byPlatform.has(l.site)) byPlatform.set(l.site, []);
      byPlatform.get(l.site).push(md);
    }
  }
  // A platform carrying one show is noise, not a section.
  const platforms = [...byPlatform.entries()].filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  if (!platforms.length) return null;

  const total = new Set(platforms.flatMap(([, list]) => list.map(md => md.id))).size;
  const topNames = platforms.slice(0, 4).map(([name]) => name);
  const desc = `Where to watch anime legally — ${total} shows across ${platforms.length} services including ${topNames.slice(0, 3).join(", ")}. Streaming links, air dates and episode counts.`.slice(0, 300);
  const lede = `Which service carries what, for every anime Tsuzuki tracks. Open a title for its streaming links, air dates and a reminder you can add to your calendar.`;
  const crumbs = `<div class="crumbs"><a href="/">Home</a> › Where to watch</div>`;

  const nav = `<nav class="plat-nav">${platforms.map(([name, list]) =>
    `<a href="#${esc(slugify(name))}">${esc(name)}<span class="hub-n">${list.length}</span></a>`).join("")}</nav>`;

  const sections = platforms.map(([name, list]) => {
    const sorted = list.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const shown = sorted.slice(0, PLATFORM_MAX);
    const cards = shown.map(md => {
      const sd = md.startDate || {};
      // Link at the "where to watch <title>" page, which is the whole point of
      // this hub — the generic /anime/ page is one click further down.
      const link = `/where-to-watch/${animeSlug(md)}/`;
      const score = md.averageScore ? `<span class="pill score">★ ${md.averageScore}</span>` : "";
      const img = md.coverImage && md.coverImage.medium
        ? `<img src="${esc(md.coverImage.medium)}" alt="${esc(title(md))} cover" loading="lazy" width="56" height="78">` : "";
      return `<div class="card">${img}<div class="info">
        <div class="ct"><a href="${esc(link)}">${esc(title(md))}</a></div>
        <div class="meta"><span class="pill">${esc(FMT_LABEL[md.format] || md.format || "?")}</span>${md.episodes ? `<span class="pill">${md.episodes} eps</span>` : ""}${score}</div>
        ${sd.year ? `<div class="when">${esc(fmtDateSafe(sd.year, sd.month, sd.day))}</div>` : ""}
      </div></div>`;
    }).join("");
    const more = sorted.length > shown.length
      ? `<p class="sub">+ ${sorted.length - shown.length} more on ${esc(name)} — <a href="/">search the live calendar</a> and filter by platform.</p>` : "";
    return `<h2 id="${esc(slugify(name))}" class="plat">${esc(name)}</h2>
      <p class="sub">${sorted.length} anime on ${esc(name)}.</p>
      <div class="grid">${cards}</div>${more}`;
  }).join("");

  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "CollectionPage", name: "Where to Watch Anime", url: `${SITE}/where-to-watch/`,
    mainEntity: { "@type": "ItemList", numberOfItems: platforms.length,
      itemListElement: platforms.map(([name], i) => ({ "@type": "ListItem", position: i + 1, name })) },
  });
  const html = shell({
    titleTag: "Where to Watch Anime — Every Streaming Service | Tsuzuki",
    desc, canonical: `${SITE}/where-to-watch/`, h1: "Where to Watch Anime", lede,
    body: seasonNav(allSlugs, null) + nav + sections, jsonld, crumbs,
  });
  await writePage("where-to-watch", html);
  return "where-to-watch";
}

/* ---------------- season + today pages ---------------- */
async function buildSeasonPage(media, season, year, allSlugs, bestSet) {
  const label = labelOf(season, year);
  const slug = slugOf(season, year);
  const sorted = media.slice();
  const names = sorted.slice(0, 8).map(title);
  const top = sorted[0];
  const desc = `The complete ${label} anime schedule: ${sorted.length}+ shows including ${names.slice(0, 3).join(", ")} and more. Premiere dates, episode counts, scores and finales — updated automatically.`;
  const lede = `Browse every anime airing in <strong>${esc(label)}</strong> — premiere dates, episode counts and scores, pulled live from AniList. ` +
    `Looking for a specific day? The <a href="/today/">airing-today page</a> and the <a href="/">interactive calendar</a> have you covered.`;

  const cards = sorted.map(md => {
    const sd = md.startDate || {};
    const premiere = sd.year ? `Premieres ${fmtDateSafe(sd.year, sd.month, sd.day)}` : "";
    return cardHTML(md, premiere, { premiere: !!(sd.year && sd.month) });
  }).join("");

  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList",
    name: `${label} Anime Schedule`, description: `Anime airing in ${label}.`, numberOfItems: sorted.length,
    itemListElement: sorted.slice(0, 50).map((md, i) => ({ "@type": "ListItem", position: i + 1, name: title(md), url: `${SITE}/anime/${animeSlug(md)}/` })),
  });

  const bestLink = (bestSet && bestSet.has(slug)) ? `<a class="cta alt" href="/best/${slug}/">🏆 Best of ${esc(label)}</a>` : "";
  const body = bestLink + seasonNav(allSlugs, slug) + `<div class="grid">${cards}</div>`;
  const html = shell({
    titleTag: `${label} Anime Schedule — Release Dates & Premieres | Tsuzuki`,
    desc, canonical: `${SITE}/${slug}/`, h1: `${label} Anime Schedule`, lede, body, jsonld,
    ogImage: ogFor(top), ogLarge: !!(top && top.bannerImage),
  });
  await writePage(slug, html);
  return { slug, label, count: sorted.length };
}

async function buildTodayPage(media, allSlugs) {
  const now = Date.now() / 1000;
  const dayStart = Math.floor(now / 86400) * 86400, dayEnd = dayStart + 86400;
  const events = [];
  for (const md of media) for (const n of (md.airingSchedule && md.airingSchedule.nodes) || [])
    if (n.airingAt >= dayStart && n.airingAt < dayEnd) events.push({ md, ep: n.episode, ts: n.airingAt });
  events.sort((a, b) => a.ts - b.ts);

  const today = new Date(dayStart * 1000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const cards = events.length
    ? events.map(e => cardHTML(e.md, `Episode ${e.ep} · ${new Date(e.ts * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`,
        { premiere: e.ep === 1, finale: isFinale(e.md, e.ep) })).join("")
    : `<p class="lede" style="margin-top:20px">No episodes are scheduled for today in the current season data. Check the <a href="/">full calendar</a> for the days around now.</p>`;

  const names = events.slice(0, 6).map(e => title(e.md));
  const desc = events.length
    ? `${events.length} anime episodes air today (${today}, UTC): ${names.slice(0, 4).join(", ")} and more. Times, premieres and finales — updated daily.`
    : `See which anime episodes are airing today and this week on Tsuzuki's live release calendar.`;
  const lede = `Every anime episode scheduled for <strong>today</strong> (${esc(today)}, times in UTC). ` +
    `Want your local times, countdowns and reminders? Open the <a href="/">live calendar</a>.`;
  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: "Anime Airing Today", numberOfItems: events.length,
    itemListElement: events.slice(0, 50).map((e, i) => ({ "@type": "ListItem", position: i + 1, name: title(e.md), url: `${SITE}/anime/${animeSlug(e.md)}/` })),
  });
  const top = events[0] && events[0].md;
  const body = seasonNav(allSlugs, null) + `<div class="grid">${cards}</div>`;
  const html = shell({
    titleTag: `Anime Airing Today — ${today} | Tsuzuki`,
    desc, canonical: `${SITE}/today/`, h1: "Anime Airing Today", lede, body, jsonld,
    ogImage: ogFor(top), ogLarge: !!(top && top.bannerImage),
  });
  await writePage("today", html);
}

// A urlset child sitemap.
function urlsetXml(urls, today) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`).join("\n")}
</urlset>
`;
}

/* sitemap.xml is a <sitemapindex> pointing at child sitemaps:
     • sitemap-main.xml  — home, /today/, hubs, seasons, best/, genres, studios
     • sitemap-anime.xml — the large /anime/ and /where-to-watch/ sets
   Splitting keeps each file well under the 50k-url limit and lets crawlers
   pull the big anime set independently of the small, frequently-changing core. */
async function writeSitemap(seasonSlugs, animeSlugs, genreSlugs = [], studioSlugs = [], watchSlugs = [], bestSlugs = [], hubPaths = []) {
  const today = new Date().toISOString().slice(0, 10);
  const mainUrls = [
    { loc: `${SITE}/`, freq: "daily", pri: "1.0" },
    { loc: `${SITE}/today/`, freq: "daily", pri: "0.9" },
    // Hand-written, not generated — it would otherwise never reach the sitemap.
    { loc: `${SITE}/api/`, freq: "monthly", pri: "0.6" },
    ...hubPaths.map(p => ({ loc: `${SITE}/${p}/`, freq: "weekly", pri: "0.7" })),
    ...seasonSlugs.map(s => ({ loc: `${SITE}/${s.slug}/`, freq: "weekly", pri: "0.8" })),
    ...bestSlugs.map(s => ({ loc: `${SITE}/best/${s}/`, freq: "weekly", pri: "0.7" })),
    ...genreSlugs.map(s => ({ loc: `${SITE}/genre/${s}/`, freq: "weekly", pri: "0.7" })),
    ...studioSlugs.map(s => ({ loc: `${SITE}/studio/${s}/`, freq: "weekly", pri: "0.6" })),
  ];
  const animeUrls = [
    ...animeSlugs.map(s => ({ loc: `${SITE}/anime/${s}/`, freq: "weekly", pri: "0.6" })),
    ...watchSlugs.map(s => ({ loc: `${SITE}/where-to-watch/${s}/`, freq: "weekly", pri: "0.5" })),
  ];
  await writeFile(join(SITE_DIR, "sitemap-main.xml"), urlsetXml(mainUrls, today), "utf8");
  await writeFile(join(SITE_DIR, "sitemap-anime.xml"), urlsetXml(animeUrls, today), "utf8");

  const children = ["sitemap-main.xml", "sitemap-anime.xml"];
  const index = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${children.map(c => `  <sitemap>\n    <loc>${SITE}/${c}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`).join("\n")}
</sitemapindex>
`;
  await writeFile(join(SITE_DIR, "sitemap.xml"), index, "utf8");
  return { main: mainUrls.length, anime: animeUrls.length };
}

/* ---------------- run ---------------- */
(async () => {
  const now = new Date();
  const curSeason = seasonOf(now.getMonth()), curYear = now.getFullYear();
  const targets = [-1, 0, 1, 2].map(d => shiftSeason(curSeason, curYear, d));   // prev, current, next, next+1
  const allSlugs = targets.map(t => ({ slug: slugOf(t.season, t.year), label: labelOf(t.season, t.year) }));

  // Fetch each target season once; reuse for season pages, the union, and /today/.
  const seasonMedia = [];
  for (const t of targets) {
    try { seasonMedia.push({ ...t, media: await fetchSeason(t.season, t.year) }); }
    catch (e) { console.warn(`⚠ fetch failed ${slugOf(t.season, t.year)}: ${e.message}`); seasonMedia.push({ ...t, media: [] }); }
  }

  // "Best of <season>" pages first, so season pages can link to the ones that exist
  const bestSlugs = [], bestSet = new Set();
  for (const sm of seasonMedia) {
    if (!sm.media.length) continue;
    try { const s = await buildBestPage(sm.media, sm.season, sm.year, allSlugs); if (s) { bestSlugs.push(s); bestSet.add(s); } }
    catch (e) { console.warn(`⚠ best page failed (${slugOf(sm.season, sm.year)}): ${e.message}`); }
  }
  console.log(`✅ ${bestSlugs.length} /best/<slug>/ pages`);

  // Season pages
  const built = [];
  for (const sm of seasonMedia) {
    if (!sm.media.length) continue;
    try { const r = await buildSeasonPage(sm.media, sm.season, sm.year, allSlugs, bestSet); built.push(r); console.log(`✅ /${r.slug}/  (${r.count} shows)`); }
    catch (e) { console.warn(`⚠ skipped ${slugOf(sm.season, sm.year)}: ${e.message}`); }
  }

  // Airing now, but with no season for a season page to have caught them.
  const seasonlessMedia = await fetchSeasonlessMedia();
  if (seasonlessMedia.length) console.log(`✅ ${seasonlessMedia.length} seasonless airing titles`);

  // /today/ from current + previous season (carry-over shows still airing),
  // plus the seasonless set — "what's airing today" is a date question, and
  // these are airing today.
  try {
    const seen = new Set(), media = [];
    for (const sm of seasonMedia) if (sm.year === curYear || true) for (const md of sm.media) if (!seen.has(md.id)) { seen.add(md.id); media.push(md); }
    for (const md of seasonlessMedia) if (!seen.has(md.id)) { seen.add(md.id); media.push(md); }
    await buildTodayPage(media, allSlugs);
    console.log("✅ /today/");
  } catch (e) { console.warn("⚠ skipped /today/: " + e.message); }

  // De-duplicated union of all fetched seasons (drives anime + genre + studio pages, feeds)
  const seen = new Set(), union = [];
  for (const sm of seasonMedia) for (const md of sm.media) if (!seen.has(md.id)) { seen.add(md.id); union.push(md); }
  for (const md of seasonlessMedia) if (!seen.has(md.id)) { seen.add(md.id); union.push(md); }
  union.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

  // Group by genre and by main studio. Only build studio pages with >=2 titles
  // (avoids thin one-off pages); every genre gets a page.
  const byGenre = new Map(), byStudio = new Map(), bySeason = new Map();
  for (const md of union) {
    for (const g of md.genres || []) { if (!byGenre.has(g)) byGenre.set(g, []); byGenre.get(g).push(md); }
    const st = md.studios && md.studios.nodes && md.studios.nodes[0] && md.studios.nodes[0].name;
    if (st) { if (!byStudio.has(st)) byStudio.set(st, []); byStudio.get(st).push(md); }
    if (md.season && md.seasonYear) {
      const k = `${md.season}-${md.seasonYear}`;
      if (!bySeason.has(k)) bySeason.set(k, []);
      bySeason.get(k).push(md);
    }
  }
  const studiosToBuild = [...byStudio.entries()].filter(([, list]) => list.length >= 2);
  const studioSlugSet = new Set(studiosToBuild.map(([name]) => slugify(name)));

  // Per-anime pages. `index` is what turns each one from a leaf into a node with
  // sideways edges — see relatedBlocks() for why that decides whether the other
  // 600 ever get crawled.
  const pick = union.slice(0, MAX_ANIME_PAGES);
  const index = { byGenre, byStudio, bySeason, studioSlugSet, builtIds: new Set(pick.map(md => md.id)) };
  const animeSlugs = [];
  for (const md of pick) {
    try { animeSlugs.push(await buildAnimePage(md, allSlugs, studioSlugSet, index)); }
    catch (e) { console.warn(`⚠ anime page failed (${md.id}): ${e.message}`); }
  }
  console.log(`✅ ${animeSlugs.length} /anime/<slug>/ pages`);

  // Standalone "where to watch <title>" pages (only shows with streaming links)
  const watchSlugs = [];
  for (const md of pick) {
    try { const s = await buildWatchPage(md, allSlugs); if (s) watchSlugs.push(s); }
    catch (e) { console.warn(`⚠ watch page failed (${md.id}): ${e.message}`); }
  }
  console.log(`✅ ${watchSlugs.length} /where-to-watch/<slug>/ pages`);

  // Genre pages
  const genreSlugs = [];
  for (const [name, list] of byGenre) {
    try { genreSlugs.push(await buildCollectionPage("genre", name, list, allSlugs)); }
    catch (e) { console.warn(`⚠ genre page failed (${name}): ${e.message}`); }
  }
  console.log(`✅ ${genreSlugs.length} /genre/<slug>/ pages`);

  // Studio pages (>=2 titles)
  const studioSlugs = [];
  for (const [name, list] of studiosToBuild) {
    try { studioSlugs.push(await buildCollectionPage("studio", name, list, allSlugs)); }
    catch (e) { console.warn(`⚠ studio page failed (${name}): ${e.message}`); }
  }
  console.log(`✅ ${studioSlugs.length} /studio/<slug>/ pages`);

  // Hub/index pages
  const hubPaths = [];
  try {
    await buildHubPage("genre", [...byGenre.entries()].map(([name, list]) => ({ name, count: list.length, slug: slugify(name) })), allSlugs); hubPaths.push("genres");
    await buildHubPage("studio", studiosToBuild.map(([name, list]) => ({ name, count: list.length, slug: slugify(name) })), allSlugs); hubPaths.push("studios");
    console.log(`✅ ${hubPaths.length} hub pages (/genres/, /studios/)`);
  } catch (e) { console.warn("⚠ hub pages: " + e.message); }

  // Indexes for the two page sets that had leaves but no root. Each failure is
  // isolated: a broken hub must never cost us the pages under it.
  try { const p = await buildBestHubPage(union, bestSlugs, allSlugs); if (p) { hubPaths.push(p); console.log("✅ /best/ (rankings hub)"); } }
  catch (e) { console.warn("⚠ /best/ hub: " + e.message); }
  try { const p = await buildWatchHubPage(union, allSlugs); if (p) { hubPaths.push(p); console.log("✅ /where-to-watch/ (streaming hub)"); } }
  catch (e) { console.warn("⚠ /where-to-watch/ hub: " + e.message); }

  try { const f = await buildFeeds(union); console.log(`✅ /feeds/ premieres(${f.prem}) finales(${f.fin}) all(${f.all})`); }
  catch (e) { console.warn("⚠ feeds: " + e.message); }

  try { const n = await buildRss(union); console.log(`✅ /feed.xml (${n} RSS items)`); }
  catch (e) { console.warn("⚠ rss: " + e.message); }

  try {
    const sm = await writeSitemap(built.length ? built : allSlugs, animeSlugs, genreSlugs, studioSlugs, watchSlugs, bestSlugs, hubPaths);
    console.log(`✅ sitemap.xml index → sitemap-main.xml (${sm.main}) + sitemap-anime.xml (${sm.anime})`);
  } catch (e) { console.warn("⚠ sitemap: " + e.message); }

  console.log("Done.");
})().catch(e => { console.warn("Non-fatal:", e.message); process.exit(0); });
