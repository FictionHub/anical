/* ============================================================
   AniCal — programmatic SEO page generator
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

const SITE = "https://anicalendar.netlify.app";
const APP_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(APP_DIR, "..", "site");
const DEFAULT_OG = `${SITE}/og-image.png`;
const MAX_ANIME_PAGES = 600;   // safety bound on per-show pages
// Cloudflare Web Analytics token (privacy-friendly, no cookies, nothing to host).
// Paste your token from dash.cloudflare.com → Web Analytics to enable it on all generated pages.
const CF_TOKEN = "";
const CF_BEACON = CF_TOKEN ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${CF_TOKEN}"}'></script>` : "";

/* ---------------- AniList ---------------- */
const ANILIST = "https://graphql.anilist.co";
const QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id title { romaji english native } format episodes duration genres averageScore popularity
      status source isAdult season seasonYear siteUrl
      description(asHtml: false)
      coverImage { large medium color } bannerImage
      startDate { year month day } endDate { year month day }
      studios(isMain: true) { nodes { name } }
      trailer { id site }
      externalLinks { site url type color }
      airingSchedule { nodes { airingAt episode } }
    }
  }
}`;

const ORDER = ["WINTER", "SPRING", "SUMMER", "FALL"];
const FMT_LABEL = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", ONA: "ONA", OVA: "OVA", SPECIAL: "Special", MUSIC: "Music" };
const SOURCE_LABEL = { ORIGINAL: "Original", MANGA: "Manga", LIGHT_NOVEL: "Light Novel", VISUAL_NOVEL: "Visual Novel", VIDEO_GAME: "Video Game", NOVEL: "Novel", WEB_NOVEL: "Web Novel", OTHER: "Other", DOUJINSHI: "Doujinshi", ANIME: "Anime", LIVE_ACTION: "Live Action", GAME: "Game", COMIC: "Comic", MULTIMEDIA_PROJECT: "Multimedia Project", PICTURE_BOOK: "Picture Book" };

const seasonOf = m => (m <= 2 ? "WINTER" : m <= 5 ? "SPRING" : m <= 8 ? "SUMMER" : "FALL");
function shiftSeason(season, year, delta) {
  let i = ORDER.indexOf(season) + delta;
  year += Math.floor(i / 4);
  i = ((i % 4) + 4) % 4;
  return { season: ORDER[i], year };
}
const slugOf = (season, year) => `${season.toLowerCase()}-${year}`;
const labelOf = (season, year) => `${season[0]}${season.slice(1).toLowerCase()} ${year}`;
const title = md => md.title.english || md.title.romaji || "Untitled";
const isFinale = (md, ep) => !!md.episodes && md.episodes > 1 && ep === md.episodes;
// Keep these public, Google-indexed pages SFW: drop adult/hentai entirely.
const isAdultMedia = md => !!(md && (md.isAdult || (md.genres || []).includes("Hentai")));

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function plain(s, max) {
  let t = String(s == null ? "" : s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&\w+;/g, " ").replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return t;
}
const slugify = s => String(s || "anime").toLowerCase().normalize("NFKD")
  .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60) || "anime";
const animeSlug = md => `${slugify(md.title.english || md.title.romaji)}-${md.id}`;
const ogFor = md => (md && md.bannerImage) || (md && md.coverImage && md.coverImage.large) || DEFAULT_OG;

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

/* ---------------- shared HTML shell ---------------- */
const BRAND_CSS = `
*{box-sizing:border-box}body{margin:0;background:#0d1117;color:#e6edf3;
font:15px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;
background-image:radial-gradient(1200px 600px at 80% -10%,#1b1235 0,transparent 60%),radial-gradient(900px 500px at -10% 110%,#08323a 0,transparent 55%)}
a{color:#22d3ee;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1100px;margin:0 auto;padding:26px 20px 60px}
header.top{display:flex;align-items:center;gap:10px;font-weight:800;font-size:22px;margin-bottom:6px}
header.top a{color:inherit}
header.top .dot{width:13px;height:13px;border-radius:50%;background:conic-gradient(from 0deg,#8b5cf6,#22d3ee,#f59e0b,#8b5cf6);box-shadow:0 0 14px #8b5cf6}
.crumbs{font-size:13px;color:#8b97a7;margin:6px 0 2px}.crumbs a{color:#8b97a7}
h1{font-size:27px;margin:14px 0 8px;line-height:1.2}
.lede{color:#aeb9c7;max-width:760px;font-size:15.5px}
.cta{display:inline-block;margin:16px 8px 6px 0;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;font-weight:700;padding:11px 18px;border-radius:10px}
.cta:hover{text-decoration:none;filter:brightness(1.08)}
.cta.alt{background:#1c2230;border:1px solid #2a3140}
nav.seasons{display:flex;flex-wrap:wrap;gap:9px;margin:18px 0 4px}
nav.seasons a{background:#1c2230;border:1px solid #2a3140;border-radius:9px;padding:7px 12px;font-size:13.5px;font-weight:600;color:#e6edf3}
nav.seasons a.cur{background:linear-gradient(135deg,#8b5cf6,#6d28d9);border-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-top:20px}
.card{display:flex;gap:11px;background:#161b22;border:1px solid #2a3140;border-radius:12px;padding:10px;overflow:hidden}
.card img{width:56px;height:78px;object-fit:cover;border-radius:7px;flex:none;background:#000}
.card .info{min-width:0}
.card .ct{font-weight:700;font-size:14px;line-height:1.25;margin-bottom:5px}
.card .meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pill{font-size:10.5px;padding:1px 7px;border-radius:20px;background:#1c2230;border:1px solid #2a3140;color:#8b97a7}
a.pill:hover{border-color:#8b5cf6;color:#e6edf3;text-decoration:none}
.pill.prem{background:rgba(245,158,11,.15);border-color:#f59e0b;color:#f59e0b}
.pill.fin{background:rgba(239,68,68,.15);border-color:#ef4444;color:#fca5a5}
.pill.score{color:#22c55e}
.when{font-size:11.5px;color:#8b97a7;margin-top:6px}
.hero{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px}
.hero img.cover{width:170px;border-radius:12px;flex:none;background:#000}
.hero .hinfo{flex:1;min-width:260px}
.hero .meta{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:4px 0 10px}
.desc{color:#c4cdd9;max-width:760px;margin:14px 0}
.sched{margin-top:10px;max-width:560px}
.sched .row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #2a3140}
.sched .row.past{opacity:.55}
.sched .when2{color:#8b97a7}
.watch{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.watch a{display:inline-flex;align-items:center;font-size:13px;font-weight:600;padding:6px 12px;border:1px solid #2a3140;border-radius:20px;color:#e6edf3;background:#161b22}
.watch a:hover{text-decoration:none;filter:brightness(1.15)}
.banner{width:100%;max-height:230px;object-fit:cover;border-radius:14px;margin-top:14px;border:1px solid #2a3140}
footer{margin-top:34px;color:#8b97a7;font-size:12.5px;border-top:1px solid #2a3140;padding-top:16px}
.hub{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.hub-link{background:#161b22;border:1px solid #2a3140;border-radius:10px;padding:9px 14px;font-weight:600;color:#e6edf3}
.hub-link:hover{border-color:#8b5cf6;text-decoration:none}
.hub-n{color:#8b97a7;font-weight:400;font-size:12px;margin-left:5px}
`;

function shell({ titleTag, desc, canonical, h1, lede, body, jsonld, ogImage, ogLarge, crumbs }) {
  const og = ogImage || DEFAULT_OG;
  const card = ogLarge ? "summary_large_image" : "summary";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(titleTag)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<meta name="theme-color" content="#0d1117" />
<link rel="canonical" href="${esc(canonical)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="alternate" type="application/rss+xml" title="AniCal — Premieres &amp; Finales" href="/feed.xml" />
<link rel="preconnect" href="https://s4.anilist.co" crossorigin />
<link rel="dns-prefetch" href="https://s4.anilist.co" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="AniCal" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:title" content="${esc(titleTag)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${esc(og)}" />
<meta name="twitter:card" content="${card}" />
<meta name="twitter:title" content="${esc(titleTag)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(og)}" />
${jsonld ? `<script type="application/ld+json">${jsonld}</script>` : ""}
<style>${BRAND_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="top"><span class="dot"></span> <a href="/">AniCal</a></header>
  ${crumbs || ""}
  <h1>${esc(h1)}</h1>
  <p class="lede">${lede}</p>
  <a class="cta" href="/">Open the live calendar →</a>
  ${body}
  <footer>
    Browse: <a href="/genres/">all genres</a> · <a href="/studios/">all studios</a> · <a href="/today/">airing today</a><br>
    Data from <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a>.
    Air times listed in UTC; the <a href="/">live calendar</a> converts to your local timezone,
    shows live countdowns, and lets you add episodes to your calendar.
  </footer>
</div>
${CF_BEACON}
</body>
</html>`;
}

function cardHTML(md, whenText, opts = {}) {
  const fmt = FMT_LABEL[md.format] || md.format || "?";
  const score = md.averageScore ? `<span class="pill score">★ ${md.averageScore}</span>` : "";
  const img = md.coverImage && md.coverImage.medium
    ? `<img src="${esc(md.coverImage.medium)}" alt="${esc(title(md))} cover" loading="lazy" width="56" height="78">` : "";
  const tag = opts.premiere ? '<span class="pill prem">PREMIERE</span>' : opts.finale ? '<span class="pill fin">🏁 FINALE</span>' : "";
  const link = `/anime/${animeSlug(md)}/`;   // internal page → strengthens crawl + indexing
  return `<div class="card">${img}<div class="info">
    <div class="ct"><a href="${esc(link)}">${esc(title(md))}</a></div>
    <div class="meta">${tag}<span class="pill">${esc(fmt)}</span>${md.episodes ? `<span class="pill">${md.episodes} eps</span>` : ""}${score}</div>
    ${whenText ? `<div class="when">${esc(whenText)}</div>` : ""}
  </div></div>`;
}

function seasonNav(allSlugs, curSlug) {
  return `<nav class="seasons">` +
    allSlugs.map(s => `<a class="${s.slug === curSlug ? "cur" : ""}" href="/${s.slug}/">${esc(s.label)}</a>`).join("") +
    `<a href="/today/">Airing today</a></nav>`;
}

const fmtDate = (y, m, d) => (y && m ? new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const fmtDateTime = ts => new Date(ts * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

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
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AniCal//anicalendar.netlify.app//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
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
        prem.push(vevent(`anical-${md.id}-1@anicalendar.netlify.app`, d, `${title(md)} — Premiere (Ep 1)`, `New anime premiere. ${link}`, link));
      if (n.airingAt <= farHorizon && isFinale(md, n.episode))
        fin.push(vevent(`anical-${md.id}-f${n.episode}@anicalendar.netlify.app`, d, `${title(md)} — Finale (Ep ${n.episode})`, `Season finale. ${link}`, link));
      if (n.airingAt <= allHorizon)
        all.push(vevent(`anical-${md.id}-${n.episode}@anicalendar.netlify.app`, d, `${title(md)} — Ep ${n.episode}`, link, link));
    }
  }
  await mkdir(join(SITE_DIR, "feeds"), { recursive: true });
  await writeFile(join(SITE_DIR, "feeds", "premieres.ics"), calWrap("AniCal — Anime Premieres", prem), "utf8");
  await writeFile(join(SITE_DIR, "feeds", "finales.ics"), calWrap("AniCal — Season Finales", fin), "utf8");
  await writeFile(join(SITE_DIR, "feeds", "all.ics"), calWrap("AniCal — All Episodes (next ~6 weeks)", all), "utf8");
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
        guid: `anical-rss-${md.id}-${isPrem ? "p" : "f"}${n.episode}`,
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
    <title>AniCal — Anime Premieres &amp; Finales</title>
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
async function buildAnimePage(md, seasonSlugs, studioSlugSet) {
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

  const metaPills = [
    `<span class="pill">${esc(fmt)}</span>`,
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

  const nextLine = next
    ? `<strong>Episode ${next.episode}</strong> airs ${esc(fmtDateTime(next.airingAt))}. `
    : (statusTxt === "finished" ? "This title has finished airing. " : "");

  const lede = `${nextLine}${seasonLabel ? `Part of the <a href="/${seasonSlug}/">${esc(seasonLabel)} anime season</a>. ` : ""}` +
    `See full air dates, episode count and score below, or open the live calendar for local times, countdowns and reminders.`;

  const desc = plain(body0 || `${t} (${fmt}) — air dates, episode schedule, score and studio. ${seasonLabel ? seasonLabel + " anime." : ""}`, 300);

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
    ${body0 ? `<p class="desc">${esc(plain(body0, 700))}</p>` : ""}
    ${watchHTML}
    ${schedRows ? `<h2 style="font-size:18px;margin-top:24px">Episode air dates</h2><div class="sched">${schedRows}</div>` : ""}
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
      uploadDate: (md.startDate && md.startDate.year) ? `${md.startDate.year}-${String(md.startDate.month || 1).padStart(2, "0")}-${String(md.startDate.day || 1).padStart(2, "0")}` : undefined,
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
          { "@type": "ListItem", position: 1, name: "AniCal", item: SITE + "/" },
          ...(seasonLabel ? [{ "@type": "ListItem", position: 2, name: seasonLabel, item: `${SITE}/${seasonSlug}/` }] : []),
          { "@type": "ListItem", position: seasonLabel ? 3 : 2, name: t, item: `${SITE}/anime/${slug}/` },
        ],
      },
    ],
  });

  const html = shell({
    titleTag: `${t} — Air Dates, Episodes & Schedule | AniCal`,
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
      { "@type": "ListItem", position: 1, name: "AniCal", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: t, item: `${SITE}/anime/${slug}/` },
      { "@type": "ListItem", position: 3, name: "Where to watch", item: `${SITE}/where-to-watch/${slug}/` },
    ],
  });
  const html = shell({
    titleTag: `Where to Watch ${t} — Stream Online | AniCal`,
    desc, canonical: `${SITE}/where-to-watch/${slug}/`, h1: `Where to watch ${t}`, lede, body, jsonld, crumbs,
    ogImage: ogFor(md), ogLarge: !!md.bannerImage,
  });
  await writePage(`where-to-watch/${slug}`, html);
  return slug;
}

/* ---------------- genre / studio collection pages ---------------- */
async function buildCollectionPage(kind, name, items, allSlugs) {
  const slug = slugify(name);
  const sorted = items.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const top = sorted[0];
  const names = sorted.slice(0, 6).map(title);
  const human = `${name} Anime`;
  const desc = (kind === "genre"
    ? `${sorted.length} ${name} anime — including ${names.slice(0, 3).join(", ")}. Air dates, scores, episode counts and where to watch, updated automatically.`
    : `Anime from ${name}: ${sorted.length} titles including ${names.slice(0, 3).join(", ")}. Air dates, scores and episodes — updated automatically.`).slice(0, 300);
  const lede = kind === "genre"
    ? `Every <strong>${esc(name)}</strong> anime AniCal is tracking, sorted by popularity. Open any title for air dates, streaming links and reminders.`
    : `All anime by <strong>${esc(name)}</strong> currently tracked, sorted by popularity. Open any title for air dates, streaming links and reminders.`;
  const crumbs = `<div class="crumbs"><a href="/">Home</a> › ${kind === "genre" ? "Genre" : "Studio"} › ${esc(name)}</div>`;
  const cards = sorted.map(md => {
    const sd = md.startDate || {};
    return cardHTML(md, sd.year ? `Premieres ${fmtDate(sd.year, sd.month, sd.day)}` : "", { premiere: !!(sd.year && sd.month) });
  }).join("");
  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: human, numberOfItems: sorted.length,
    itemListElement: sorted.slice(0, 50).map((md, i) => ({ "@type": "ListItem", position: i + 1, name: title(md), url: `${SITE}/anime/${animeSlug(md)}/` })),
  });
  const body = seasonNav(allSlugs, null) + `<div class="grid">${cards}</div>`;
  const html = shell({
    titleTag: `${human} — Schedule, Scores & Where to Watch | AniCal`,
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
  const lede = `Browse every anime ${kind} AniCal tracks. Pick a ${kind} to see its shows, air dates and streaming links.`;
  const crumbs = `<div class="crumbs"><a href="/">Home</a> › ${human}</div>`;
  const links = sorted.map(s => `<a class="hub-link" href="/${kind}/${s.slug}/">${esc(s.name)}<span class="hub-n">${s.count}</span></a>`).join("");
  const body = seasonNav(allSlugs, null) + `<div class="hub">${links}</div>`;
  const jsonld = JSON.stringify({ "@context": "https://schema.org", "@type": "CollectionPage", name: `Anime ${human}`, url: `${SITE}/${path}/` });
  const html = shell({ titleTag: `Anime by ${human} | AniCal`, desc, canonical: `${SITE}/${path}/`, h1: `Anime ${human}`, lede, body, jsonld, crumbs });
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
    titleTag: `Best ${label} Anime — Top Rated | AniCal`,
    desc, canonical: `${SITE}/best/${slug}/`, h1: `Best Anime of ${label}`, lede, body, jsonld, crumbs,
    ogImage: ogFor(top), ogLarge: !!(top && top.bannerImage),
  });
  await writePage(`best/${slug}`, html);
  return slug;
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
    const premiere = sd.year ? `Premieres ${fmtDate(sd.year, sd.month, sd.day)}` : "";
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
    titleTag: `${label} Anime Schedule — Release Dates & Premieres | AniCal`,
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
    : `See which anime episodes are airing today and this week on AniCal's live release calendar.`;
  const lede = `Every anime episode scheduled for <strong>today</strong> (${esc(today)}, times in UTC). ` +
    `Want your local times, countdowns and reminders? Open the <a href="/">live calendar</a>.`;
  const jsonld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: "Anime Airing Today", numberOfItems: events.length,
    itemListElement: events.slice(0, 50).map((e, i) => ({ "@type": "ListItem", position: i + 1, name: title(e.md), url: `${SITE}/anime/${animeSlug(e.md)}/` })),
  });
  const top = events[0] && events[0].md;
  const body = seasonNav(allSlugs, null) + `<div class="grid">${cards}</div>`;
  const html = shell({
    titleTag: `Anime Airing Today — ${today} | AniCal`,
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

  // /today/ from current + previous season (carry-over shows still airing)
  try {
    const seen = new Set(), media = [];
    for (const sm of seasonMedia) if (sm.year === curYear || true) for (const md of sm.media) if (!seen.has(md.id)) { seen.add(md.id); media.push(md); }
    await buildTodayPage(media, allSlugs);
    console.log("✅ /today/");
  } catch (e) { console.warn("⚠ skipped /today/: " + e.message); }

  // De-duplicated union of all fetched seasons (drives anime + genre + studio pages, feeds)
  const seen = new Set(), union = [];
  for (const sm of seasonMedia) for (const md of sm.media) if (!seen.has(md.id)) { seen.add(md.id); union.push(md); }
  union.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

  // Group by genre and by main studio. Only build studio pages with >=2 titles
  // (avoids thin one-off pages); every genre gets a page.
  const byGenre = new Map(), byStudio = new Map();
  for (const md of union) {
    for (const g of md.genres || []) { if (!byGenre.has(g)) byGenre.set(g, []); byGenre.get(g).push(md); }
    const st = md.studios && md.studios.nodes && md.studios.nodes[0] && md.studios.nodes[0].name;
    if (st) { if (!byStudio.has(st)) byStudio.set(st, []); byStudio.get(st).push(md); }
  }
  const studiosToBuild = [...byStudio.entries()].filter(([, list]) => list.length >= 2);
  const studioSlugSet = new Set(studiosToBuild.map(([name]) => slugify(name)));

  // Per-anime pages (genre pills + studio link into the collection pages)
  const pick = union.slice(0, MAX_ANIME_PAGES);
  const animeSlugs = [];
  for (const md of pick) {
    try { animeSlugs.push(await buildAnimePage(md, allSlugs, studioSlugSet)); }
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
