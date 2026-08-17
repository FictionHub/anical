/* ============================================================
   Tsuzuki — the shared look of every server-rendered page.

   Extracted from scripts/build-seo.mjs in Aug 2026 so /today/ could be served
   live by a function instead of baked at build time. It has to live under
   netlify/functions/_lib/ rather than scripts/ because only this tree ships in
   the function bundle; the generator imports it upward, the same way it already
   imports seasonless.mjs.

   Zero dependencies, no I/O, no clock beyond what the caller passes in — so it
   is identical whether it runs on a GitHub runner or in a Lambda.
   ============================================================ */

const SITE = "https://tsuzuki.top";
const DEFAULT_OG = `${SITE}/og-image-v2.png`;
// Cloudflare Web Analytics token (privacy-friendly, no cookies, nothing to host).
// Paste your token from dash.cloudflare.com → Web Analytics to enable it on all generated pages.
const CF_TOKEN = "";
const CF_BEACON = CF_TOKEN ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${CF_TOKEN}"}'></script>` : "";

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

/* ---------------- shared HTML shell ---------------- */
const BRAND_CSS = `
*{box-sizing:border-box}body{margin:0;background:#0d1117;color:#e6edf3;
font:15px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;
background-image:radial-gradient(1200px 600px at 80% -10%,#26100a 0,transparent 60%),radial-gradient(900px 500px at -10% 110%,#08262e 0,transparent 55%)}
a{color:#22d3ee;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1100px;margin:0 auto;padding:26px 20px 60px}
header.top{display:flex;align-items:center;gap:9px;font-weight:800;font-size:22px;margin-bottom:6px}
header.top a{color:inherit}
header.top .mark{width:30px;height:30px;flex:none;border-radius:7px}
.crumbs{font-size:13px;color:#8b97a7;margin:6px 0 2px}.crumbs a{color:#8b97a7}
h1{font-size:27px;margin:14px 0 8px;line-height:1.2}
.lede{color:#aeb9c7;max-width:760px;font-size:15.5px}
.cta{display:inline-block;margin:16px 8px 6px 0;background:linear-gradient(135deg,#ff4a2e,#c2331b);color:#fff;font-weight:700;padding:11px 18px;border-radius:10px}
.cta:hover{text-decoration:none;filter:brightness(1.08)}
.cta.alt{background:#1c2230;border:1px solid #2a3140}
nav.seasons{display:flex;flex-wrap:wrap;gap:9px;margin:18px 0 4px}
nav.seasons a{background:#1c2230;border:1px solid #2a3140;border-radius:9px;padding:7px 12px;font-size:13.5px;font-weight:600;color:#e6edf3}
nav.seasons a.cur{background:linear-gradient(135deg,#ff4a2e,#c2331b);border-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-top:20px}
.card{display:flex;gap:11px;background:#161b22;border:1px solid #2a3140;border-radius:12px;padding:10px;overflow:hidden}
.card img{width:56px;height:78px;object-fit:cover;border-radius:7px;flex:none;background:#000}
.card .info{min-width:0}
.card .ct{font-weight:700;font-size:14px;line-height:1.25;margin-bottom:5px}
.card .meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pill{font-size:10.5px;padding:1px 7px;border-radius:20px;background:#1c2230;border:1px solid #2a3140;color:#8b97a7}
a.pill:hover{border-color:#ff4a2e;color:#e6edf3;text-decoration:none}
.pill.prem{background:rgba(245,158,11,.15);border-color:#f59e0b;color:#f59e0b}
.pill.fin{background:rgba(167,139,250,.15);border-color:#a78bfa;color:#c4b5fd}
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
.hub-link:hover{border-color:#ff4a2e;text-decoration:none}
.hub-n{color:#8b97a7;font-weight:400;font-size:12px;margin-left:5px}
h2{font-size:20px;margin:32px 0 2px}
h2:first-of-type{margin-top:24px}
.sub{color:#8b97a7;font-size:13.5px;margin:4px 0 0}
.rank{counter-reset:r;margin-top:18px}
.rank .card{position:relative;padding-left:44px}
.rank .card::before{counter-increment:r;content:counter(r);position:absolute;left:12px;top:12px;
  font-weight:800;font-size:15px;color:#ff4a2e;font-variant-numeric:tabular-nums}
.plat-nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 4px}
.plat-nav a{background:#161b22;border:1px solid #2a3140;border-radius:20px;padding:6px 13px;font-size:13px;font-weight:600;color:#e6edf3}
.plat-nav a:hover{border-color:#ff4a2e;text-decoration:none}
.plat{scroll-margin-top:14px}
/* The release-date answer box. Deliberately the loudest thing under the fold:
   it is the fact most visitors arrived for. */
.airbox{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;margin:20px 0 4px;padding:14px 16px;
  background:linear-gradient(135deg,rgba(255,74,46,.12),rgba(255,74,46,.03));border:1px solid rgba(255,74,46,.35);border-radius:12px}
.airbox-k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;color:#ff8a6e;flex:none}
.airbox-v{font-size:17px;color:#e6edf3;min-width:200px;flex:1}
.airbox-v strong{color:#fff;font-weight:800}
.airbox-aside{font-size:12.5px;color:#8b97a7;margin-left:8px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 2px}
.stat{background:#161b22;border:1px solid #2a3140;border-radius:11px;padding:10px 14px;min-width:104px}
.stat b{display:block;font-size:19px;font-weight:800;color:#fff;line-height:1.15}
.stat span{font-size:11px;color:#8b97a7;letter-spacing:.03em}
.prose{color:#c4cdd9;max-width:760px;margin:14px 0;font-size:15px}
.prose li{margin:4px 0}
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
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=3" />
<link rel="alternate" type="application/rss+xml" title="Tsuzuki — Premieres &amp; Finales" href="/feed.xml" />
<link rel="preconnect" href="https://s4.anilist.co" crossorigin />
<link rel="dns-prefetch" href="https://s4.anilist.co" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Tsuzuki" />
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
  <header class="top"><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#ff4a2e"/><g transform="translate(32.4 30) scale(.84) translate(-32 -32)"><path d="M11 23 C26 18.5 42 19.5 48 24 C54.5 29 53 38 45 44 C37 49.5 25 50.5 15 45.5" fill="none" stroke="#12060a" stroke-width="8" stroke-linecap="round"/></g></svg> <a href="/">Tsuzuki</a></header>
  ${crumbs || ""}
  <h1>${esc(h1)}</h1>
  <p class="lede">${lede}</p>
  <a class="cta" href="/">Open the live calendar →</a>
  ${body}
  <footer>
    Browse: <a href="/best/">top anime</a> · <a href="/genres/">all genres</a> · <a href="/studios/">all studios</a> · <a href="/where-to-watch/">where to watch</a> · <a href="/today/">airing today</a><br>
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

const fmtDateTime = ts => new Date(ts * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
// AniList routinely knows the month of a premiere before it knows the day. Both
// formatters below have to default the missing day to the 1st to build a Date at
// all — but they must not then PRINT it, or "October 2026, day unannounced"
// silently becomes the claim "October 1". `day` is omitted when it is unknown,
// so every date a reader sees is only as precise as the data behind it.
const fmtDateSafe = (y, m, d) => (y && m ? new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString("en-US", { month: "short", day: d ? "numeric" : undefined, year: "numeric", timeZone: "UTC" }) : y ? String(y) : "");
const fmtDateLong = (y, m, d) => (y && m ? new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString("en-US", { weekday: d ? "long" : undefined, month: "long", day: d ? "numeric" : undefined, year: "numeric", timeZone: "UTC" }) : y ? String(y) : "");
const isoDate = sd => (sd && sd.year ? `${sd.year}-${String(sd.month || 1).padStart(2, "0")}-${String(sd.day || 1).padStart(2, "0")}` : undefined);

export {
  SITE, DEFAULT_OG, CF_BEACON,
  ORDER, FMT_LABEL, SOURCE_LABEL,
  seasonOf, shiftSeason, slugOf, labelOf, title, isFinale, isAdultMedia,
  esc, plain, slugify, animeSlug, ogFor,
  BRAND_CSS, shell, cardHTML, seasonNav,
  fmtDateTime, fmtDateSafe, fmtDateLong, isoDate,
};
