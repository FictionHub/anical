/* Tsuzuki — the application.
 *
 * Split out of site/index.html in Aug 2026. It was 526KB of inline <script> in a
 * 643KB document: every byte of it had to be re-parsed with the markup, none of
 * it could be cached on its own, and a one-character change to the page meant
 * the browser re-fetched the whole application with it.
 *
 * Still a single classic script, loaded at the end of <body> exactly where it
 * used to sit, so execution order and timing are unchanged. It is not a module
 * — everything here shares one top-level scope, which is what the code assumes.
 *
 * APP_VERSION is stamped into index.html, not here. See scripts/stamp-version.mjs.
 */
"use strict";
/* ============================================================
   Tsuzuki — pulls live anime release data on every launch/refresh.
   Primary source : AniList public GraphQL API (airing schedules).
   News           : Anime News Network RSS via rss2json (CORS).
   Features       : Month / Week / Agenda views, filters,
                    countdowns, a live "Now" marker, and opt-in
                    desktop notifications per followed show.
   ============================================================ */

// Build number auto-stamped from the git commit count by scripts/stamp-version.mjs
// (run via the .githooks/pre-commit hook). Do not edit by hand — it changes every commit.
// Stamped into index.html by scripts/stamp-version.mjs, not into this file:
// app.js is cached separately, and a version bump must not invalidate 526KB
// of unchanged application code. Falls back to "dev" when opened directly.
const APP_VERSION = (typeof window !== "undefined" && window.APP_VERSION) || "dev";

// Tsuzuki's own read API. It serves the same AniList payload out of a shared
// server-side catalog (netlify/functions/_lib/catalog.mjs), so the schedule a
// visitor loads has usually already been fetched once for everyone rather than
// once per browser. Every call through it falls back to AniList directly, so
// the app is never *dependent* on our own backend being up.
const TSUZUKI_API = "/api/v1";
const API = "https://graphql.anilist.co";
// Every call to our own API is an optimisation, never a dependency: a null here
// means "ask AniList instead". The timeout matters as much as the try/catch —
// a cold function that takes eight seconds to answer is worse for the reader
// than going straight upstream, and without an abort the launch would wait for
// it before even starting the fallback.
async function apiGet(path, {timeout=6000}={}){
  const ac=typeof AbortController!=="undefined"?new AbortController():null;
  const t=ac?setTimeout(()=>ac.abort(),timeout):null;
  try{
    const r=await fetch(TSUZUKI_API+path,{headers:{Accept:"application/json"}, signal:ac?ac.signal:undefined});
    if(!r.ok) return null;
    const j=await r.json();
    return (j&&j.ok)?j:null;
  }catch(e){ return null; }
  finally{ if(t) clearTimeout(t); }
}
// Public VAPID key for Web Push (server-driven alerts that work even when
// Tsuzuki is closed). Generated with scripts/generate-vapid-keys.mjs — not secret.
const VAPID_PUBLIC_KEY = "BB594h_5VV0438lXEg0dGtENsi1yC7uKOXSovJR6D_tLDVQ2fok4ZwdAKGKCc0wjURvkA9nWAyHMSubn0N5jMCU";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/* ---------- timetable preferences ----------
   Which weekday a week starts on, whether times read as 12h or 24h, and how
   the shows inside one day are ordered. All three are per-viewer habits the
   app has no business guessing, so they're settings rather than defaults. */
// 0–6, or today's weekday under "rotating". Month keeps a fixed start: a grid
// whose first column changed daily would be unreadable, so "rotating" there
// falls back to Sunday.
function weekStartDow(forMonth){
  const w=state.weekStart;
  if(w==="rot") return forMonth ? 0 : new Date().getDay();
  const n=+w;
  return (n>=0&&n<=6)?n:0;
}
// DOW rotated so the configured start day comes first.
function dowLabels(forMonth){
  const s=weekStartDow(forMonth);
  return DOW.slice(s).concat(DOW.slice(0,s));
}
// How many days back from `d` the containing week began.
function daysSinceWeekStart(d, forMonth){
  return (d.getDay() - weekStartDow(forMonth) + 7) % 7;
}
// Force 12h/24h when asked, otherwise leave the viewer's locale alone.
// hour12:false is not the same as h23 — in some locales it yields "24:00".
function timeOpts(base){
  const o={...base};
  if(state.timeFormat==="12") o.hour12=true;
  else if(state.timeFormat==="24") o.hourCycle="h23";
  return o;
}
const FMT_LABEL = {TV:"TV", TV_SHORT:"TV Short", MOVIE:"Movie", ONA:"ONA", OVA:"OVA", SPECIAL:"Special", MUSIC:"Music"};

const state = {
  anchor: new Date(),
  viewMode: localStorage.getItem("anical.view") || ((window.matchMedia && window.matchMedia("(max-width:640px)").matches) ? "agenda" : "month"),
  seasonCache: new Map(),
  media: [],
  filters: {format:"", genre:"", minScore:0, premieresOnly:false},
  search: "",                    // live title search (not persisted)
  searchResults: new Map(),      // id -> media object from the last search (local + global)
  hideNSFW: localStorage.getItem("anical.hideNSFW")!=="0",   // hide adult/hentai by default; persisted
  titleLang: localStorage.getItem("anical.titleLang")||"english",   // english | romaji | native
  theme: localStorage.getItem("anical.theme")||"dark",              // dark | light
  // "<accent>|<accent2>". Everyone who never opened the accent picker has the
  // old violet default sitting in localStorage, and a stored value is
  // indistinguishable from a deliberate one — so the old default specifically
  // is migrated to the new brand colour. Violet is still in the picker for
  // anyone who actually wanted it.
  accent: (a=>a==="#8b5cf6|#22d3ee"?"#ff4a2e|#22d3ee":a)(localStorage.getItem("anical.accent")||"#ff4a2e|#22d3ee"),
  // The app-wide default (Day 28 kept this key exactly as it was — it is what
  // every view falls back to, and every existing user already has one).
  density: localStorage.getItem("anical.density")||"normal",        // normal | dense | grid
  densityBy: {},                 // view -> its own density, when it has been set (Day 28)
  // Timetable preferences (see the "timetable preferences" section below).
  weekStart: localStorage.getItem("anical.weekStart")||"0",         // "0" Sun | "1" Mon | "6" Sat | "rot" (today first)
  timeFormat: localStorage.getItem("anical.timeFormat")||"auto",    // auto (your locale) | 12 | 24
  daySort: localStorage.getItem("anical.daySort")||"popularity",    // popularity | time | alpha | score
  showImages: localStorage.getItem("anical.showImages")!=="0",      // cover art in rows and cells
  showDonghua: localStorage.getItem("anical.showDonghua")!=="0",    // Chinese productions (countryOfOrigin CN)
  eventsData: null,              // cached events.json (real-life events view)
  eventsItems: null,             // parsed+sorted events (with ts)
  eventsFilter: "",              // events view text filter (not persisted)
  eventsMap: false,              // events list/map toggle (not persisted)
  userLoc: (()=>{ try{ return JSON.parse(localStorage.getItem("anical.userLoc")||"null"); }catch(e){ return null; } })(),
  eventsRadius: +(localStorage.getItem("anical.eventsRadius")||0),   // km; 0 = any
  notify: new Set(),
  notifyEvents: new Set(),       // followed real-life events (reminders)
  hidden: new Set(),             // "not interested" shows, hidden everywhere
  watch: new Set(),              // ⭐ "My list" — followed shows
  status: {},                    // mediaId -> watch status key (see STATUS_DEFS); implies watch
  ratings: {},                   // mediaId -> your own 0–10 score (the composite of the axes below)
  axes: {},                      // mediaId -> {story,art,sound,chars,enjoy} — the five numbers behind it
  weights: {},                   // axis -> how much it counts toward the composite (Day 15)
  // Stretch a clustered set of scores across the range — for display only, and
  // off by default. Nothing reads it except the places that *show* a score.
  normalize: localStorage.getItem("anical.normalize")==="1",
  pairs: [],                     // [winnerId, loserId, ts] — head-to-head verdicts, newest last
  notes: {},                     // mediaId -> your private free-text note
  noteSpoiler: new Set(),        // notes to blur until asked for (Day 24) — parallel to `notes`, never merged into it
  favs: new Set(),               // ♥ favourites (Day 25) — independent of status and score
  pins: [],                      // 📌 up to PIN_MAX ids, in the order you pinned them (Day 26)
  archived: new Set(),           // 🗃 done with, off the board, all data kept (Day 27) — NOT `hidden`
  showArchived: false,           // the board/lists filter that makes archived shows findable again
  sort: [],                      // the working multi-key sort (Day 29); empty means the default
  sorts: [],                     // saved named sorts: [{id, name, keys:[{key,dir}]}]
  activity: [],                  // append-only [type, id, YYYY-MM-DD, n?] — the only record of WHEN (Day 31)
  recNo: new Set(),              // recommendations you dismissed, permanently (Day 54)
  recMode: "feed",               // which rec lens is showing (not persisted — it is a per-visit question)
  recGenre: "",                  // rec page genre filter (Day 47)
  recAiring: false,              // …and its currently-airing filter
  tasteAdj: {},                  // "dim|value" -> manual lift delta (Day 53) — an input, never an edited output
  feedSkip: new Set(),           // "never heard of it" — skipped in the feed, no opinion recorded
  feedCard: null,                // the show currently on screen in the feed (session only)
  feedAsk: null,                 // …and its pending "how was it?" question, if any
  feedCount: 0,                  // answered this session, for the counter
  collections: [],               // your own lists: [{id, name, ids:[mediaId…]}], in your order
  recent: [],                    // recently viewed show ids (most-recent first)
  progress: {},                  // mediaId -> highest watched episode number
  autoProg: {},                  // mediaId -> last aired episode auto-marked (key present = opted in)
  rewatch: {},                   // mediaId -> completed runs (2 = watched once, rewatched once)
  dates: {},                     // mediaId -> {start,end} — your own started / finished dates
  // Watching shows the loaded seasons don't contain, fetched one at a time by
  // hydrateWatching(). Deliberately *not* state.media: that array is replaced
  // wholesale on every range load and is what the calendar and the cache are
  // built from, so an old season's episodes would appear in both.
  extra: new Map(),              // id -> media, this session only
  notifyLead: 10,
  scheduled: new Map(),         // "id-ep" -> timeout id
  // Release-type preferences (see the "release variants" section below).
  airTypes: new Set(["raw","sub"]),   // which of raw/sub/dub to show at all
  hideRules: {                        // …and when one release should suppress another
    rawWhenSub:true, rawWhenDub:false,
    subWhenDub:false, subWhenRaw:false,
    dubWhenSub:false, dubWhenRaw:false,
  },
  overrides: {shows:{}},         // human corrections layered over AniList
  // Skins + the Discord identity they hang off. All optional: every one of
  // these staying null is the site exactly as it was before sign-in existed.
  skin: null,                    // the skin currently worn, applied when skinOn()
  skinGrant: null,               // {themeId, grantedAt, note} — the old admin-grant path
  // The Tung Tung economy. Server-authoritative and signed-in only: see
  // netlify/functions/_lib/economy.mjs for why this one thing isn't local.
  wallet: null,                  // publicWallet() from /api/wallet
  catalog: null,                 // id -> theme, from /api/themes
  wheel: null,                   // the segment layout, served with the wallet so the two can't disagree
  rarityMeta: null,              // rarity -> {label, price, dust, tint}
  walletOff: false,              // sign-in isn't configured on this deployment
  skinPreview: null,             // /admin trying a theme on, beats the grant
  discord: null,                 // {id, username, globalName, avatar} — nothing else
  discordConfigured: true,       // until /api/auth/me says the keys aren't set
  loginProblem: null,            // last sign-in failure, kept visible in Settings
  // Discovery (Days 55–85) — see the block of that name.
  baseTitle: document.title,     // restored when a show / browse page stops renaming the tab
  navDepth: 0,                   // in-app history entries pushed this session, so ← Back never leaves the site
  full: new Map(),               // id -> full media fetched by the show page / palette; findMediaById reads it
  light: new Map(),              // id -> card-weight media from browse / gems / similar pools; findMediaById does NOT
  showId: null,                  // the show page's AniList id (?view=show&id=)
  showCache: new Map(),          // id -> {md, partial} for the show page
  showPartial: null,             // a show page built from the catalogue while AniList was busy — retried, not cached
  showJump: null,                // a section to scroll to once the show page paints
  seenStaff: new Map(),          // staff met on show pages this session, for the staff index
  simAiring: false,              // Day 77's "airing now" filter on similar shows
  searchQ: null,                 // the parsed search box: {text, ops…} (Day 69)
  searchHist: [],                // recent queries, newest first (Day 72)
  savedSearches: [],             // [{id, name, search, filters, pinned}] (Days 70–71)
  palUse: { r:[], f:{} },        // command palette recents + counts (Day 68)
  gemsDial: 2,                   // hidden gems obscurity dial position (Day 79)
  gemsOff: new Set(),            // genres switched off on the gems page (session)
  discovery: { day:null, pick:null, hist:[] },   // Day 82: today's pick and every answer, [day, id, accept|skip]
  browse: { kind:"tag", id:null, name:null },   // Days 83–85 route
  browseSort: localStorage.getItem("anical.browsesort")||"popular",
  studioSort: "score",
  browseQuery: { studio:"", staff:"" },
  browseKey: null,
};
// The show and browse routes need an id to mean anything, so they are never
// what a fresh launch opens into.
if(state.viewMode==="show"||state.viewMode==="browse") state.viewMode="month";
try{ state.searchHist=(JSON.parse(localStorage.getItem("anical.searchhist")||"[]")||[]).filter(q=>typeof q==="string").slice(0,15); }catch(e){}
try{
  const raw=JSON.parse(localStorage.getItem("anical.savedsearch")||"[]");
  state.savedSearches=(Array.isArray(raw)?raw:[]).filter(s=>s&&s.id&&typeof s.name==="string")
    .map(s=>({ id:String(s.id), name:String(s.name).slice(0,40), search:typeof s.search==="string"?s.search:"",
               filters:(s.filters&&typeof s.filters==="object")?s.filters:{}, pinned:!!s.pinned }));
}catch(e){}
try{ const p=JSON.parse(localStorage.getItem("anical.palette")||"null"); if(p&&Array.isArray(p.r)&&p.f&&typeof p.f==="object") state.palUse={ r:p.r.filter(x=>x&&typeof x.k==="string").slice(0,20), f:p.f }; }catch(e){}
try{ const d=JSON.parse(localStorage.getItem("anical.discovery")||"null"); if(d&&Array.isArray(d.hist)) state.discovery={ day:typeof d.day==="string"?d.day:null, pick:d.pick&&d.pick.id?d.pick:null, hist:d.hist.filter(h=>Array.isArray(h)&&h.length>=3) }; }catch(e){}
{ const g=+localStorage.getItem("anical.gemsdial"); if(g>=0&&g<=4&&localStorage.getItem("anical.gemsdial")!==null) state.gemsDial=g; }
try{ Object.assign(state.filters, JSON.parse(localStorage.getItem("anical.filters")||"{}")); }catch(e){}
try{ state.notify = new Set(JSON.parse(localStorage.getItem("anical.notify")||"[]")); }catch(e){}
try{ state.notifyEvents = new Set(JSON.parse(localStorage.getItem("anical.notifyEvents")||"[]")); }catch(e){}
try{ state.hidden = new Set(JSON.parse(localStorage.getItem("anical.hidden")||"[]")); }catch(e){}
try{ state.watch = new Set(JSON.parse(localStorage.getItem("anical.watch")||"[]")); }catch(e){}
try{ state.status = JSON.parse(localStorage.getItem("anical.status")||"{}")||{}; }catch(e){}
try{ state.ratings = JSON.parse(localStorage.getItem("anical.ratings")||"{}")||{}; }catch(e){}
try{ state.axes = JSON.parse(localStorage.getItem("anical.axes")||"{}")||{}; }catch(e){}
try{ state.weights = JSON.parse(localStorage.getItem("anical.weights")||"{}")||{}; }catch(e){}
try{ state.notes = JSON.parse(localStorage.getItem("anical.notes")||"{}")||{}; }catch(e){}
try{ state.noteSpoiler = new Set(JSON.parse(localStorage.getItem("anical.notespoiler")||"[]")); }catch(e){}
try{ state.favs = new Set((JSON.parse(localStorage.getItem("anical.favs")||"[]")||[]).map(String)); }catch(e){}
// Trimmed on read as well as on write: a sync code from a future build with a
// larger cap must not quietly raise this one's.
try{ state.pins = (JSON.parse(localStorage.getItem("anical.pins")||"[]")||[]).map(String).slice(0,5); }catch(e){}
try{ state.archived = new Set((JSON.parse(localStorage.getItem("anical.archived")||"[]")||[]).map(String)); }catch(e){}
try{ state.densityBy = JSON.parse(localStorage.getItem("anical.densityBy")||"{}")||{}; }catch(e){}
// Both are re-validated by cleanSort() on every read as well, so a sort saved by
// a build that had keys this one doesn't degrades to the rows it understands
// instead of throwing inside a comparator.
try{ state.sort = JSON.parse(localStorage.getItem("anical.sort")||"[]")||[]; }catch(e){}
try{ state.recNo = new Set((JSON.parse(localStorage.getItem("anical.recno")||"[]")||[]).map(String)); }catch(e){}
try{ state.feedSkip = new Set((JSON.parse(localStorage.getItem("anical.feedskip")||"[]")||[]).map(String)); }catch(e){}
try{
  const raw=JSON.parse(localStorage.getItem("anical.tasteadj")||"{}")||{};
  // Clamped on read as well as on write: a pasted sync code must not be able to
  // hand this build a ±40 lift that would swamp every prediction.
  state.tasteAdj={};
  for(const k of Object.keys(raw)){
    const v=Math.max(-2, Math.min(2, +raw[k]||0));
    if(v && k.indexOf("|")>0) state.tasteAdj[k]=Math.round(v*100)/100;
  }
}catch(e){}
try{
  const raw=JSON.parse(localStorage.getItem("anical.activity")||"[]");
  state.activity=(Array.isArray(raw)?raw:[])
    .filter(r=>Array.isArray(r)&&r.length>=3&&typeof r[2]==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(r[2]));
}catch(e){}
try{
  const raw=JSON.parse(localStorage.getItem("anical.sorts")||"[]");
  state.sorts=(Array.isArray(raw)?raw:[]).filter(s=>s&&s.id&&typeof s.name==="string")
    .map(s=>({id:String(s.id), name:String(s.name).slice(0,40), keys:Array.isArray(s.keys)?s.keys:[]}));
}catch(e){}
// Pairs arrive from localStorage or a pasted sync code, so never trust the shape:
// a malformed row here would throw inside the replay that derives the ordering.
try{
  const raw=JSON.parse(localStorage.getItem("anical.pairs")||"[]");
  state.pairs=(Array.isArray(raw)?raw:[])
    .filter(p=>Array.isArray(p)&&p[0]&&p[1]&&String(p[0])!==String(p[1]))
    .map(p=>[String(p[0]), String(p[1]), +p[2]||0]);
}catch(e){}
// Collections arrive from localStorage or a pasted sync code, so never trust the shape.
try{
  const raw=JSON.parse(localStorage.getItem("anical.collections")||"[]");
  state.collections=(Array.isArray(raw)?raw:[]).filter(c=>c&&c.id&&typeof c.name==="string")
    .map(c=>({id:String(c.id), name:String(c.name).slice(0,40), ids:(Array.isArray(c.ids)?c.ids:[]).map(String)}));
}catch(e){}
try{ state.recent = JSON.parse(localStorage.getItem("anical.recent")||"[]"); }catch(e){}
try{ state.progress = JSON.parse(localStorage.getItem("anical.progress")||"{}")||{}; }catch(e){}
try{ state.autoProg = JSON.parse(localStorage.getItem("anical.autoprog")||"{}")||{}; }catch(e){}
try{ state.rewatch = JSON.parse(localStorage.getItem("anical.rewatch")||"{}")||{}; }catch(e){}
try{ state.dates = JSON.parse(localStorage.getItem("anical.dates")||"{}")||{}; }catch(e){}
try{
  const raw=JSON.parse(localStorage.getItem("anical.airTypes")||"null");
  if(Array.isArray(raw)){ const s=new Set(raw.filter(t=>t==="raw"||t==="sub"||t==="dub")); if(s.size) state.airTypes=s; }
}catch(e){}
try{ Object.assign(state.hideRules, JSON.parse(localStorage.getItem("anical.hideRules")||"{}")); }catch(e){}
// Last-known corrections, so the instant paint from cache is already corrected;
// loadOverrides() refreshes them right after.
try{ const c=JSON.parse(localStorage.getItem("anical.overrides")||"null"); if(c&&c.shows) state.overrides=c; }catch(e){}
state.notifyLead = +(localStorage.getItem("anical.lead")||10);

/* ---------- density, per view (Day 28) ----------
   Comfortable and Compact shipped long ago as one global switch. Two things were
   missing: a grid, and the fact that the right answer genuinely differs by view —
   a month calendar wants to be compact so a week fits on screen, while a board
   of cover art wants room, and one setting cannot be both.

   `anical.density` STAYS THE GLOBAL DEFAULT rather than being migrated away.
   Every existing user already has a value in it, and it is what a view falls
   back to until that view is given one of its own. `anical.densityBy` is the
   additive half: view -> density, written only when somebody actually chooses.
   Nothing is dropped and nothing is repurposed, which is the storage invariant.

   These live up here for the same reason the skin constants below do — see that
   comment. densityFor() is now reached from the first applyAppearance(), which
   runs before the first paint. */
const DENSITIES = [
  ["normal","Comfortable"],
  ["dense","Compact","More rows on screen at once"],
  ["grid","Grid","Cover art in a grid — card views only"],
];
// Grid is meaningless on a calendar: the month view IS a grid, and a "grid of
// grids" is not a setting anyone wants. Offering an option that silently does
// nothing is worse than not offering it, so the picker is built per view.
const GRID_VIEWS = new Set(["board","lists"]);
const densityViewOf = v => (v==="week"||v==="agenda") ? "month" : v;   // the calendar shares one

/* Skin constants live here, above the first applyAppearance(), rather than in
   the skin section further down. That call happens before the first paint, and
   a `const` declared later would still be in its temporal dead zone when it
   runs — which throws, and takes the rest of the script with it. The functions
   that use these are hoisted and can stay where they belong. */
const SKIN_VARS=["bg","bg2","bg3","line","txt","muted","accent","accent2","premiere","today","good","now","finale"];
// Shape and type reach the page as variables the static skin rules consume.
const SKIN_SHAPE_VARS=["--radius","--skin-chip-radius","--skin-border","--skin-card-blur","--skin-font","--skin-font-scale","--skin-glow","--skin-glow-strength"];
const SKIN_CACHE_KEY="anical.skin";            // last known grant, for an instant first paint
const SKIN_ON_KEY="anical.skinOn";             // the wearer's own on/off switch
const SKIN_PREVIEW_KEY="anical.previewSkin";   // set by /admin to try one on
// Paint order of the art layers, back to front. Also the DOM order inside
// #skinLayers, so "later in this list" literally means "painted on top".
const SKIN_LAYER_ORDER=["backdrop","pattern","ornament","cutout","vignette","grain","scan"];
// A theme is admin-written and validated server-side, but its image URL is
// about to be interpolated into a CSS url(). Anything that could close the
// url() and start a new declaration never gets that far. data: is allowed for
// the drawn layers (generated SVG textures) — an SVG referenced as a CSS
// background renders in secure static mode, where script is inert, and the same
// character class applies either way.
const safeUrl=u=>(typeof u==="string" &&
  (/^https:\/\/[^"'\\\s()]+$/i.test(u) || /^data:image\/svg\+xml,[A-Za-z0-9%._~!$&*+,;:@/=-]+$/.test(u))) ? u : null;
const skinOn=()=>localStorage.getItem(SKIN_ON_KEY)!=="0";

// Last known skin, painted before the first frame. Waiting for /api/auth/me
// would mean a visible flash of the stock purple on every single load, which is
// the one thing guaranteed to make a skin feel bolted on.
try{ const c=JSON.parse(localStorage.getItem(SKIN_CACHE_KEY)||"null"); if(c&&c.colors) state.skin=c; }catch(e){}
applyAppearance();   // theme / accent / density / skin before first paint

const $ = id => document.getElementById(id);
const title = md => {
  const t=(md&&md.title)||{};
  if(state.titleLang==="romaji") return t.romaji||t.english||t.native||"Untitled";
  if(state.titleLang==="native") return t.native||t.romaji||t.english||"Untitled";
  return t.english||t.romaji||t.native||"Untitled";
};
const fmtTime = ts => new Date(ts*1000).toLocaleTimeString([], timeOpts({hour:"numeric", minute:"2-digit"}));
const dayKeyTs = ts => { const d=new Date(ts*1000); return d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate(); };
const keyOf = d => d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate();
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function decodeEntities(s){ const t=document.createElement("textarea"); t.innerHTML=String(s==null?"":s); return t.value; }
// A confirmed season finale: the show has a known total episode count (>1) and this is it.
function isFinale(md, ep){ return !!md.episodes && md.episodes>1 && ep===md.episodes; }
// NSFW = AniList's isAdult flag (authoritative) or the Hentai genre.
function isAdultMedia(md){ return !!(md && (md.isAdult || (md.genres||[]).includes("Hentai"))); }
function nsfwHidden(md){ return state.hideNSFW && isAdultMedia(md); }
// Chinese productions. Cached entries from before this field was queried have
// no countryOfOrigin — treat those as Japanese rather than hiding them, so a
// stale cache can never blank the calendar.
function isDonghua(md){ return !!md && md.countryOfOrigin==="CN"; }
// Every "should this show be on screen at all" rule in one place. Used by the
// calendar filter and by the sidebars/option builders, which must agree with it.
function excluded(md){ return nsfwHidden(md) || isHidden(md.id) || (!state.showDonghua && isDonghua(md)); }
function isHidden(id){ return state.hidden.has(String(id)); }
function toggleHidden(id){
  id=String(id);
  if(state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
  localStorage.setItem("anical.hidden", JSON.stringify([...state.hidden]));
}
/* ⭐ watchlist ("My list") */
function isWatched(id){ return state.watch.has(String(id)); }
function starSpan(id){ const on=isWatched(id); return `<span class="star ${on?'on':''}" role="button" tabindex="0" aria-label="${on?'Remove from My List':'Add to My List'}" data-watch="${esc(String(id))}" title="Add to My List">${on?'★':'☆'}</span>`; }
function setStar(el,on){ el.classList.toggle("on",on); if(el.tagName==="BUTTON") el.textContent=on?"★ In My List":"☆ Add to My List"; else el.textContent=on?"★":"☆"; }
function toggleWatch(id){
  id=String(id);
  // ⭐ and the board are the same list: starring drops the show in Watching,
  // un-starring takes it off the board entirely.
  if(state.watch.has(id)){ state.watch.delete(id); delete state.status[id]; }
  else { state.watch.add(id); if(!state.status[id]) state.status[id]=DEFAULT_STATUS; }
  localStorage.setItem("anical.watch", JSON.stringify([...state.watch]));
  localStorage.setItem("anical.status", JSON.stringify(state.status));
  document.querySelectorAll('[data-watch="'+CSS.escape(id)+'"]').forEach(el=>setStar(el, state.watch.has(id)));
  refreshStatusPickers(id);
  // Only a *star on* is pushed. Un-starring is a local decision — deleting
  // someone's AniList entry (and its score and progress with it) because they
  // tidied their Tsuzuki board would be unrecoverable.
  if(state.watch.has(id)) alEnqueue(id);
  if(state.watch.has(id)) logActivity("add", id);   // Day 31
  renderView();   // reflects "My list" filter + highlight
}
/* ---------- favourites, pins and the archive (Days 25–27) ----------
   Three flags that all mean "treat this show differently in my library", kept in
   three keys of their own and deliberately independent of everything else. A
   favourite is not a 10, a pin is not a status, and an archived show is not a
   hidden one — each of those conflations would have saved a key and lost the
   distinction that makes the feature worth having.

   THEY COMPOSE IN ONE PLACE. librarySort() is the only thing that reads pins and
   favourites for ordering, and both card views call it, so the board and 📚 Lists
   cannot drift into ordering the same cards differently. */
function saveFavs(){ try{ localStorage.setItem("anical.favs", JSON.stringify([...state.favs])); }catch(e){} }
function isFav(id){ return state.favs.has(String(id)); }
function toggleFav(id){
  id=String(id);
  const on=!isFav(id);
  if(on) state.favs.add(id); else state.favs.delete(id);
  saveFavs();
  return on;
}
/* Pins are ORDERED and capped, so this is an array rather than a Set: "pin up to
   five to the top" is a statement about sequence, and a Set would put them in
   whatever order iteration happened to produce. */
const PIN_MAX = 5;
function savePins(){ try{ localStorage.setItem("anical.pins", JSON.stringify(state.pins)); }catch(e){} }
function isPinned(id){ return state.pins.indexOf(String(id))>=0; }
function pinIndex(id){ return state.pins.indexOf(String(id)); }
/* Returns true when it pinned, false when it unpinned, and the string "full"
   when it refused — the caller needs to tell those three apart to say why
   nothing happened, and a bare false would make a refusal look like an unpin. */
function togglePin(id){
  id=String(id);
  const i=state.pins.indexOf(id);
  if(i>=0){ state.pins.splice(i,1); savePins(); return false; }
  if(state.pins.length>=PIN_MAX) return "full";
  state.pins.push(id); savePins(); return true;
}
/* The archive is NOT the hidden set, and keeping them apart is the whole day.
   `hidden` means "I am not interested in this show" and takes it out of the
   calendar, the search results and every sidebar. Archiving means "I am finished
   with this and want my board back" — the show keeps its status, score, notes,
   dates and progress, and still turns up in the calendar and in search, because
   a series you finished and loved is not one you want the site to stop
   mentioning. It only leaves the two views that are meant to show current work. */
function saveArchived(){ try{ localStorage.setItem("anical.archived", JSON.stringify([...state.archived])); }catch(e){} }
function isArchived(id){ return state.archived.has(String(id)); }
function toggleArchived(id){
  id=String(id);
  const on=!isArchived(id);
  if(on) state.archived.add(id); else state.archived.delete(id);
  saveArchived();
  return on;
}
/* ---------- the sort builder (Day 29) ----------
   A sort is an ordered list of {key, dir}. Ties fall through to the next key,
   and anything still tied at the end keeps the order it already had, because
   Array#sort is stable — so a sort can refine an order without scrambling the
   part of it you did not ask about.

   MISSING IS NOT SMALL. Every key here nominates what "absent" means and pushes
   it to the bottom in BOTH directions. Sorting by score descending should put
   your 10s first and your unrated last; sorting ascending should put your 1s
   first and STILL put unrated last, because an unrated show is not worse than a
   1, it is not on the scale at all. Letting absence sort as 0 would bury a
   hundred unrated shows above your worst rated one the moment you flip the
   arrow, which reads as the sort being broken. Same for shows with no date, no
   announced episode count and no community score. */
const SORT_KEYS = [
  { key:"fav",       label:"Favourite",        get: md=>isFav(md.id)?1:0 },
  { key:"status",    label:"Status",           get: md=>{ const i=STATUS_DEFS.findIndex(s=>s.key===boardStatusOf(md.id)); return i<0?null:i; }, asc:true },
  { key:"score",     label:"Your score",       get: md=>getRating(md.id)||null },
  { key:"title",     label:"Title",            get: md=>title(md).toLowerCase(), text:true, asc:true },
  { key:"progress",  label:"Episodes watched", get: md=>getProgress(md.id)||null },
  { key:"left",      label:"Episodes left",    get: md=>{ const t=epTotal(md); return t?Math.max(0,t-getProgress(md.id)):null; }, asc:true },
  { key:"length",    label:"Season length",    get: md=>epTotal(md)||null },
  { key:"started",   label:"Date started",     get: md=>(state.dates[String(md.id)]||{}).start||null, text:true },
  { key:"finished",  label:"Date finished",    get: md=>(state.dates[String(md.id)]||{}).end||null, text:true },
  { key:"rewatch",   label:"Rewatches",        get: md=>rewatchCount(md.id)||null },
  { key:"community", label:"Community score",  get: md=>md.averageScore||null },
  { key:"popular",   label:"Popularity",       get: md=>md.popularity||null },
];
const SORT_BY_KEY = Object.fromEntries(SORT_KEYS.map(s=>[s.key,s]));
// Favourites-first is what Day 25 shipped, so it is what the app sorts by until
// somebody builds something else — the default is the old behaviour written down
// as a rule rather than a second rule competing with the builder.
const DEFAULT_SORT = [{key:"fav", dir:"desc"}];
function saveSortState(){
  try{
    localStorage.setItem("anical.sort", JSON.stringify(state.sort));
    localStorage.setItem("anical.sorts", JSON.stringify(state.sorts));
  }catch(e){}
}
function cleanSort(keys){
  return (Array.isArray(keys)?keys:[])
    .filter(k=>k&&SORT_BY_KEY[k.key])
    .map(k=>({key:k.key, dir: k.dir==="asc"?"asc":"desc"}))
    .filter((k,i,a)=>a.findIndex(x=>x.key===k.key)===i)   // one row per key
    .slice(0, SORT_KEYS.length);
}
const activeSort = () => { const s=cleanSort(state.sort); return s.length?s:DEFAULT_SORT; };
function compareBy(rule, a, b){
  const def=SORT_BY_KEY[rule.key]; if(!def) return 0;
  const va=def.get(a), vb=def.get(b);
  // Absent sinks, whichever way the arrow points. This is the one rule that is
  // not reversed by direction, on purpose.
  if(va==null && vb==null) return 0;
  if(va==null) return 1;
  if(vb==null) return -1;
  const cmp = def.text ? String(va).localeCompare(String(vb)) : (va-vb);
  return rule.dir==="asc" ? cmp : -cmp;
}
/* Pins are outside the sort entirely. A pin means "this one, at the top of every
   view" — a sort that could bury it would make the feature a suggestion. Pin
   order is the pin order; everything below it is whatever you built. */
function librarySort(a,b){
  const pa=pinIndex(a.id), pb=pinIndex(b.id);
  if(pa!==pb) return (pa<0?PIN_MAX+1:pa)-(pb<0?PIN_MAX+1:pb);
  for(const rule of activeSort()){
    const c=compareBy(rule, a, b);
    if(c) return c;
  }
  return 0;   // stable: an unresolved tie keeps the order the view already had
}
const libraryOrder = list => list.slice().sort(librarySort);
/* Saved sorts. An id rather than the name as the key, so renaming one later
   doesn't orphan anything pointing at it — the same reasoning collections use. */
function saveNamedSort(name, keys){
  const clean=cleanSort(keys||state.sort);
  const n=cleanCollectionName(name);
  if(!n || !clean.length) return null;
  const rec={ id:"s"+Date.now().toString(36)+Math.random().toString(36).slice(2,5), name:n, keys:clean };
  state.sorts.push(rec); saveSortState();
  return rec;
}
function deleteNamedSort(id){
  const i=state.sorts.findIndex(s=>s.id===String(id));
  if(i<0) return null;
  const [rec]=state.sorts.splice(i,1); saveSortState();
  return {index:i, rec};
}
function applyNamedSort(id){
  const rec=state.sorts.find(s=>s.id===String(id));
  if(!rec) return false;
  state.sort=cleanSort(rec.keys); saveSortState();
  return true;
}
// Does the working sort match a saved one? Used to light the chip you are
// currently using, so the panel says which of your sorts is on rather than
// leaving you to compare the rows by eye.
function currentSortId(){
  const cur=JSON.stringify(activeSort());
  const hit=state.sorts.find(s=>JSON.stringify(cleanSort(s.keys))===cur);
  return hit?hit.id:null;
}
function sortSummary(keys){
  const s=cleanSort(keys);
  if(!s.length) return "Favourites first";
  return s.map(k=>{
    const def=SORT_BY_KEY[k.key];
    const asc=k.dir==="asc";
    return def.label+" "+(def.text ? (asc?"A–Z":"Z–A") : (asc?"↑":"↓"));
  }).join(", then ");
}
/* watch statuses (Watching / Plan / On-hold / Dropped / Completed) — the board view.
   A status is always something the user picked: an untracked show has none, so the
   picker starts with nothing highlighted and one click both tracks the show and
   sets its status. Clicking the highlighted status again removes the show. */
const STATUS_DEFS = [
  {key:"watching", label:"Watching", emoji:"▶️"},
  {key:"plan", label:"Plan to Watch", emoji:"📋"},
  {key:"onhold", label:"On Hold", emoji:"⏸️"},
  {key:"dropped", label:"Dropped", emoji:"🗑️"},
  {key:"completed", label:"Completed", emoji:"✅"},
];
const STATUS_BY_KEY = STATUS_DEFS.reduce((m,s)=>{ m[s.key]=s; return m; },{});
const DEFAULT_STATUS = "watching";
/* "" when the user hasn't picked one — nothing is ever pre-selected for them. */
function getStatusOf(id){ return state.status[String(id)] || ""; }
/* Column a tracked show lands in (older saves may be starred without a status). */
function boardStatusOf(id){ return getStatusOf(id) || DEFAULT_STATUS; }
function statusLabel(key){ const s=STATUS_BY_KEY[key]; return s?`${s.emoji} ${s.label}`:""; }
// Earlier versions (and AniList imports) starred shows without storing a status but
// still displayed them under Watching. Write that down once so what's shown is real.
(function migrateStatuses(){
  let changed=false;
  for(const id of state.watch) if(!state.status[id]){ state.status[id]=DEFAULT_STATUS; changed=true; }
  if(changed) localStorage.setItem("anical.status", JSON.stringify(state.status));
})();
function setStatusOf(id, key, opts){
  id=String(id);
  bumpWeak();   // statuses feed the taste vectors as weak signal
  if(key) state.status[id]=key; else delete state.status[id];
  localStorage.setItem("anical.status", JSON.stringify(state.status));
  // Undo passes {stamp:false}: putting back the status you had is not the start
  // of a new run, and the dates it would stamp were never cleared anyway.
  if(key && (!opts || opts.stamp!==false)) stampDates(id, key);
  const before=state.watch.has(id);
  if(key) state.watch.add(id); else state.watch.delete(id);   // a status implies tracking
  if(before!==state.watch.has(id)){
    localStorage.setItem("anical.watch", JSON.stringify([...state.watch]));
    document.querySelectorAll('[data-watch="'+CSS.escape(id)+'"]').forEach(el=>setStar(el, state.watch.has(id)));
  }
  refreshStatusPickers(id);
  if(key) alEnqueue(id);   // clearing a status is local-only — see toggleWatch
  if(key) tungTask("status");
  // Logged for the month wrap (Day 31). Undo passes {stamp:false} and is
  // excluded for the same reason it skips stampDates: putting back the status
  // you had is not a thing you did this month.
  if(key && (!opts || opts.stamp!==false)){
    if(!before && state.watch.has(id)) logActivity("add", id);
    if(key==="completed") logActivity("finish", id);
    else if(key==="watching") logActivity("start", id);
    else if(key==="dropped") logActivity("drop", id);
  }
}
/* ---------- the activity log (Day 31's missing half) ----------
   Day 31 asks for "what you added, rated and finished this month" and nothing in
   this app could answer it. Every user key is a *current state* — `ratings` is
   what you think now, `progress` is where you are now, `watch` is what you follow
   now — and none of them record WHEN. `anical.dates` was the single exception,
   and only for two events on two status changes.

   So this is the log those questions need: append-only, `[type, id, day]`, where
   day is a local YYYY-MM-DD. Local, for the same reason stampDates is: someone
   finishing a show at 11pm means tonight, not tomorrow in UTC.

   IT IS HONEST ABOUT ITS OWN AGE. The log starts empty for everybody who already
   uses the site, so a wrap that simply counted rows would report "0 shows added"
   to somebody who added twenty last week. `activitySince()` is the first day it
   ever recorded, and the card says so whenever a month began before that.
   Finished counts are the exception and are read from `anical.dates` instead,
   which has real history going back to Day 12. */
const ACT_MAX = 4000;   // ~13 months of heavy use; a guard, not a design limit
const ACT_TYPES = new Set(["add","rate","finish","start","drop","note","ep"]);
function saveActivity(){ try{ localStorage.setItem("anical.activity", JSON.stringify(state.activity)); }catch(e){} }
const localDay = (d) => {
  const x=d||new Date();
  return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0");
};
function logActivity(type, id, n){
  if(!ACT_TYPES.has(type)) return;
  const row=[type, String(id), localDay()];
  if(n>1) row.push(n);           // episodes marked in one go, so a jump isn't one event
  state.activity.push(row);
  if(state.activity.length>ACT_MAX) state.activity.splice(0, state.activity.length-ACT_MAX);
  saveActivity();
}
const activitySince = () => (state.activity.length ? state.activity[0][2] : null);
/* Everything the wrap reports, for one month. Counted over distinct shows rather
   than over rows: rating the same show four times while you make your mind up is
   one show rated, not four, and a wrap that says otherwise is flattering rather
   than informative. Episodes are the exception and are summed, because watching
   twelve of something IS twelve. */
function monthWrap(year, month){
  const pad=String(month+1).padStart(2,"0"), prefix=`${year}-${pad}`;
  const sets={add:new Set(), rate:new Set(), start:new Set(), drop:new Set(), note:new Set()};
  let eps=0;
  for(const row of state.activity){
    const [type,id,day,n]=row;
    if(String(day).slice(0,7)!==prefix) continue;
    if(type==="ep"){ eps+=(+n||1); continue; }
    if(sets[type]) sets[type].add(id);
  }
  // Finished comes from anical.dates, not from the log: those dates predate the
  // log by nineteen days and are editable by hand, which makes them the better
  // record of when a run actually ended.
  const finished=new Set();
  for(const [id,rec] of Object.entries(state.dates||{})){
    if(rec && typeof rec.end==="string" && rec.end.slice(0,7)===prefix) finished.add(id);
  }
  const started=new Set(sets.start);
  for(const [id,rec] of Object.entries(state.dates||{})){
    if(rec && typeof rec.start==="string" && rec.start.slice(0,7)===prefix) started.add(id);
  }
  const since=activitySince();
  return {
    year, month, prefix,
    added:[...sets.add], rated:[...sets.rate], started:[...started], dropped:[...sets.drop],
    noted:[...sets.note], finished:[...finished], episodes:eps,
    // The log cannot speak for a month that ended before it began.
    partial: !since || since.slice(0,7) > prefix || (since.slice(0,7)===prefix && since.slice(8)>"01"),
    since,
    empty: !sets.add.size && !sets.rate.size && !started.size && !finished.size && !sets.note.size && !eps,
  };
}
/* ---------- started & finished dates ----------
   Stamped when a show enters Watching or Completed, in *local* time — someone
   finishing a show at 11pm means tonight, not tomorrow in UTC. Completing
   something that was never marked Watching stamps both, because a run you can
   see the end of had a beginning. A stamp only ever fills a blank, so an edit
   of your own is never overwritten by a later status change. */
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function getDates(id){ const d=state.dates[String(id)]; return {start:(d&&d.start)||"", end:(d&&d.end)||""}; }
function writeDates(id,d){
  id=String(id);
  if(d.start||d.end) state.dates[id]={...(d.start?{start:d.start}:{}), ...(d.end?{end:d.end}:{})};
  else delete state.dates[id];   // both cleared by hand — leave no empty record behind
  try{ localStorage.setItem("anical.dates", JSON.stringify(state.dates)); }catch(e){}
}
function setDate(id,which,val){
  const d=getDates(id);
  d[which==="end"?"end":"start"]=String(val||"").slice(0,10);
  writeDates(id,d);
}
function stampDates(id,key){
  if(key!=="watching" && key!=="completed") return;
  const d=getDates(id); let changed=false;
  if(!d.start){ d.start=todayISO(); changed=true; }
  if(key==="completed" && !d.end){ d.end=todayISO(); changed=true; }
  if(changed) writeDates(id,d);
}
/* Always rendered, hidden until the show is on your board or already carries a
   date — so refreshStatusPickers() has something to replace the moment a status
   is picked, rather than the row only appearing the next time you open the show. */
function datesRowHtml(md){
  const id=String(md.id), d=getDates(id);
  const show=!!(getStatusOf(id)||d.start||d.end);
  return `<div class="st-row dt-row" data-dates="${esc(id)}"${show?"":" hidden"}>
    <span class="st-row-label">📅 Your dates:</span>
    <label class="dt-f">Started <input type="date" class="dt-in" data-date="${esc(id)}|start" value="${esc(d.start)}" aria-label="Date you started this show"></label>
    <label class="dt-f">Finished <input type="date" class="dt-in" data-date="${esc(id)}|end" value="${esc(d.end)}" aria-label="Date you finished this show"></label>
    <span class="st-hint">Stamped for you the first time a show goes to ▶️ Watching or ✅ Completed. Change either one, or clear it, and what you set is what stays. On this device only.</span>
  </div>`;
}
/* One-click status picker. size: "" = labelled (detail pop-up), "sm" = emoji-only
   (board cards, search rows). */
function statusPickerHtml(id, size){
  const cur=getStatusOf(id), sid=esc(String(id));
  return `<div class="st-pick${size?" "+size:""}" data-st-pick="${sid}" role="group" aria-label="Watch status">`
    + STATUS_DEFS.map(s=>`<button type="button" class="st-chip${s.key===cur?" on":""}" data-st="${sid}|${s.key}" aria-pressed="${s.key===cur?"true":"false"}" title="${s.key===cur?"Remove from board":esc(s.label)}"><span>${s.emoji}</span><span class="st-lab">${esc(s.label)}</span></button>`).join("")
    + `</div>`;
}
// Keep every picker for a show in sync (the detail pop-up, its board card and the
// search row can all be on screen at once) without re-rendering the view.
function refreshStatusPickers(id){
  id=String(id);
  const cur=getStatusOf(id);
  document.querySelectorAll('[data-st-pick="'+CSS.escape(id)+'"] .st-chip').forEach(chip=>{
    const key=String(chip.dataset.st||"").split("|")[1], on=key===cur, def=STATUS_BY_KEY[key];
    chip.classList.toggle("on",on);
    chip.setAttribute("aria-pressed", on?"true":"false");
    if(def) chip.title = on ? "Remove from board" : def.label;
  });
  document.querySelectorAll('[data-st-label="'+CSS.escape(id)+'"]').forEach(el=>{
    el.textContent = cur ? (el.dataset.onLabel||"") : (el.dataset.offLabel||"");
  });
  // A status change is what stamps the dates, so the row that shows them is
  // repainted on the same beat.
  const md=findMediaById(id);
  if(md) document.querySelectorAll('[data-dates="'+CSS.escape(id)+'"]').forEach(row=>{
    const tmp=document.createElement("div"); tmp.innerHTML=datesRowHtml(md);
    if(tmp.firstElementChild) row.replaceWith(tmp.firstElementChild);
  });
}
/* ---------- your rating (1–10) and private notes ----------
   Notes live only in this browser and are never sent anywhere. A rating is the
   same idea — your own number, kept visually distinct from AniList's community
   ★ average — but it does go back to AniList when an account is connected,
   because that's what "sync my list" is understood to mean. Notes don't. */
const RATING_MAX = 10;
const NOTE_MAX = 2000;
/* ---------- the five axes behind one score ----------
   A score is five numbers, not one: story, art, sound, characters, enjoyment,
   kept in `anical.axes`. `anical.ratings` still holds the single number — the
   composite — because that is what every other part of the app already reads:
   the card pill, the ⭐ filter, the detail pop-up and the AniList push are all
   untouched by this. One key is the input, the other is the derived answer, and
   nothing outside this block needs to know there are two.

   MIGRATION IS THE PRESENCE OF THE RECORD, not a "have I run yet" flag. Every
   score without an axes record gets all five axes set to that score, and the
   mean of five equal numbers is the number itself — so an existing 8 reads back
   as exactly 8, and re-running finds the record and skips it. A flag would be
   worse in two specific ways: a settings import that restored the flag but not
   the axes would skip a migration that was needed, and one that restored the
   axes but not the flag would flatten edits the user had made. It also lets the
   AniList import, which writes straight into `state.ratings`, be fixed up by
   calling the same function afterwards rather than waiting for a reload. */
const AXIS_DEFS = [
  { key:"story", label:"Story"      },
  { key:"art",   label:"Art"        },
  { key:"sound", label:"Sound"      },
  { key:"chars", label:"Characters" },
  { key:"enjoy", label:"Enjoyment"  },
];
const AXIS_KEYS = AXIS_DEFS.map(a=>a.key);
/* How much each axis counts, stored per user in `anical.weights` (Day 15).
   Everything asks axisWeights() rather than reading a constant, which is what
   let this arrive without touching compositeOf or any of its callers. */
const DEFAULT_AXIS_WEIGHTS = AXIS_KEYS.reduce((m,k)=>{ m[k]=1; return m; },{});
const WEIGHT_MAX = 3;
// Absent means "never set", which is 1 — not 0. Only an explicit drag to the
// bottom turns an axis off.
function cleanWeight(v, dflt){
  if(v==null || v==="") return dflt==null?1:dflt;
  const n=Math.round((+v||0)*2)/2;
  return Number.isFinite(n) ? Math.max(0, Math.min(WEIGHT_MAX, n)) : (dflt==null?1:dflt);
}
/* What you set, cleaned but NOT guarded — this is what the sliders show. The
   split matters: display has to report the setting back honestly, and only the
   arithmetic is allowed to quietly substitute something safe for it. Showing
   the guarded value instead would tell somebody who turned everything off that
   everything was on. */
function storedWeights(){
  const w={};
  for(const k of AXIS_KEYS) w[k]=cleanWeight(state.weights[k]);
  return w;
}
const weightsAllOff = () => AXIS_KEYS.every(k=>cleanWeight(state.weights[k])===0);
function axisWeights(){
  const w=storedWeights(); let sum=0;
  for(const k of AXIS_KEYS) sum+=w[k];
  // THE GUARD THAT MATTERS. Every weight at zero makes compositeOf return 0 for
  // every show, and a 0 composite means "unrated" — so one more drag would
  // delete every score in the library, and the next migrateRatingAxes() would
  // then prune the axes behind them as orphans. Equal weights is the only safe
  // reading of "nothing counts for anything".
  return sum>0 ? w : DEFAULT_AXIS_WEIGHTS;
}
function writeWeights(){
  try{ localStorage.setItem("anical.weights", JSON.stringify(state.weights)); }catch(e){}
}
/* Every write of anical.ratings goes through here, and the only reason it has
   to is Day 17: the normalization below is derived from the whole library, so
   it needs to know when the library moved. A revision counter is cheaper than
   any signature over the scores themselves — computing one would cost what
   recomputing the statistics costs. */
let ratingsRev = 0;
function saveRatings(){
  ratingsRev++;
  try{ localStorage.setItem("anical.ratings", JSON.stringify(state.ratings)); }catch(e){}
}
/* Changing one weight changes every score at once — the point of the day, and
   also why this does not loop through setRating(): that would be one
   localStorage write per show and, far worse, one AniList push per show. A
   weight is a slider people drag several times while tuning; enqueueing on each
   release would put thousands of saves through a queue that moves at one every
   2.2 seconds. One pass, one write, and AniList is caught up by the
   "⬆ Push everything" button that already exists for exactly this. */
function recomputeAllComposites(){
  let changed=0;
  for(const id of Object.keys(state.axes)){
    const n=compositeOf(getAxes(id));
    if(!n) continue;                       // nothing scored — leave it alone
    if(state.ratings[id]!==n){ state.ratings[id]=n; changed++; }
  }
  if(changed) saveRatings();
  return changed;
}
function setAxisWeight(key, v){
  if(!AXIS_KEYS.includes(key)) return 0;
  state.weights[key]=cleanWeight(v);
  writeWeights();
  return recomputeAllComposites();
}
function resetAxisWeights(){
  state.weights={...DEFAULT_AXIS_WEIGHTS};
  writeWeights();
  return recomputeAllComposites();
}
// Reads what is STORED, not what is used. Asking axisWeights() here would make
// an all-off configuration report itself as default — which disables the reset
// button and leaves the only way out being to drag a slider back up by hand.
function weightsAreDefault(){
  const w=storedWeights();
  return AXIS_KEYS.every(k=>w[k]===1);
}
/* Half-points, clamped. 0 means "not scored on this axis" and is never stored —
   an absent axis and a zero one are the same thing, so there is one way to say it. */
function cleanAxis(v){ return Math.max(0, Math.min(RATING_MAX, Math.round((+v||0)*2)/2)); }
function getAxes(id){
  const rec=state.axes[String(id)]||null, out={};
  for(const k of AXIS_KEYS) out[k]=rec?cleanAxis(rec[k]):0;
  return out;
}
function hasAxes(id){ const a=getAxes(id); return AXIS_KEYS.some(k=>a[k]>0); }
function writeAxes(id, axes){
  id=String(id);
  const rec={};
  for(const k of AXIS_KEYS){ const v=cleanAxis(axes&&axes[k]); if(v) rec[k]=v; }
  if(Object.keys(rec).length) state.axes[id]=rec; else delete state.axes[id];
  try{ localStorage.setItem("anical.axes", JSON.stringify(state.axes)); }catch(e){}
}
/* The composite: a weighted mean over the axes actually scored, so leaving
   Sound blank on a silent film doesn't drag the score to half of what you meant.
   One decimal, because the axes move in halves and rounding to a whole number
   would make two visibly different sets of sliders report the same score. */
function compositeOf(axes){
  const w=axisWeights(); let sum=0, wt=0;
  for(const k of AXIS_KEYS){
    const v=cleanAxis(axes&&axes[k]); if(!v) continue;
    sum += v*(w[k]||0); wt += (w[k]||0);
  }
  return wt ? Math.round((sum/wt)*10)/10 : 0;
}
/* The axes-first write path. Day 14's sliders land here; today nothing calls it
   from the UI, which is what makes this a `data` day. */
function setAxis(id, key, val){
  if(!AXIS_KEYS.includes(key)) return;
  const axes=getAxes(id);
  axes[key]=cleanAxis(val);
  writeAxes(id, axes);
  setRating(id, compositeOf(axes), {axes:false});   // the composite is the result here, not the input
}
function getRating(id){ return +state.ratings[String(id)] || 0; }
function setRating(id, n, opts){
  id=String(id);
  // Still a 0–10 number and still the only score anything else reads — it just
  // carries a decimal now that it can be a mean of five.
  n=Math.max(0, Math.min(RATING_MAX, Math.round((+n||0)*10)/10));
  if(n) state.ratings[id]=n; else delete state.ratings[id];
  saveRatings();
  // A single number IS all five axes agreeing. That is what the migration does
  // to every score written before axes existed, and what clicking a chip in the
  // 1–10 picker means: "the whole thing is a 7". setAxis passes {axes:false}
  // because there the axes are the input and this is only recording the answer.
  if(!opts || opts.axes!==false){
    writeAxes(id, n ? AXIS_KEYS.reduce((m,k)=>{ m[k]=n; return m; },{}) : {});
  }
  refreshRatingPickers(id);
  if(n) alEnqueue(id);   // clearing a score is local-only, same reasoning as toggleWatch
  if(n) tungTask("rate");
  if(n) logActivity("rate", id);   // Day 31
}
/* Undo. Putting the number back is not enough once the number is derived: the
   1–10 picker flattens the axes to write a whole score, so an undo that only
   restored the composite would hand back a flat five where five different
   numbers used to be. Same shape as setStatusOf's {stamp:false}. */
function restoreRating(id, score, axes){
  // Order matters, and it did not until Day 14 put sliders on screen: setRating
  // repaints the pickers, so the axes have to be back in place BEFORE it runs
  // or the repaint reads the flattened record it is being asked to undo.
  writeAxes(id, axes);
  setRating(id, score, {axes:false});
}
function migrateRatingAxes(){
  let changed=false;
  for(const [id, score] of Object.entries(state.ratings)){
    const n=cleanAxis(score);
    if(!n || state.axes[id]) continue;
    const rec={}; for(const k of AXIS_KEYS) rec[k]=n;
    state.axes[id]=rec; changed=true;
  }
  // The other direction: axes for a show whose score was cleared elsewhere (an
  // older client, a pasted sync code) would otherwise sit there unreachable.
  for(const id of Object.keys(state.axes)) if(!(+state.ratings[id]||0)){ delete state.axes[id]; changed=true; }
  if(changed) try{ localStorage.setItem("anical.axes", JSON.stringify(state.axes)); }catch(e){}
}
migrateRatingAxes();
function getNote(id){ return state.notes[String(id)]||""; }
function hasNote(id){ return !!getNote(id); }
function setNote(id, text){
  id=String(id); text=String(text==null?"":text).slice(0,NOTE_MAX).trim();
  if(text) state.notes[id]=text; else delete state.notes[id];
  localStorage.setItem("anical.notes", JSON.stringify(state.notes));
  // The note itself never leaves the browser — only the fact that you wrote one
  // today, and only as "credit this task", with no id and no text attached.
  if(text) tungTask("note");
  if(text) logActivity("note", id);      // Day 31
  if(!text) setSpoilerNote(id, false);   // no note, no spoiler flag to leave behind
}
/* ---------- note templates (Day 22) ----------
   Prompts, not boilerplate. Each is the first half of a sentence you finish, so
   an empty box stops being the thing standing between you and writing anything
   down. Ordered by how often they are the reason somebody opens a note at all. */
const NOTE_TEMPLATES = [
  { label:"Favourite episode", text:"Favourite episode: " },
  { label:"Best moment",       text:"Best moment: " },
  { label:"Recommend to",      text:"Recommend to: " },
  { label:"Where I left off",  text:"Where I left off: " },
  { label:"Why I dropped it",  text:"Why I dropped it: " },
];
/* Inserts at the caret via setRangeText, NOT by rebuilding .value.

   Two reasons, and the second is the one that would have been found later by a
   user rather than here. setRangeText keeps the browser's own undo stack alive,
   so ctrl-Z after an accidental insert works the way it does in every other text
   box; assigning .value wipes that history silently. And it respects a selection
   — a template dropped while text is selected replaces exactly that selection
   rather than landing at position 0 and pushing the note sideways. */
function insertNoteTemplate(box, tpl){
  if(!box) return;
  const at=box.selectionStart|0, end=box.selectionEnd|0;
  const before=box.value.slice(0, at);
  // Spacing that reads as if it were typed: a new line when there is already a
  // line above with something on it, nothing at all in an empty box.
  const lead = (!before || /\n\s*$/.test(before)) ? "" : "\n";
  const text=lead+tpl;
  if(before.length+text.length+(box.value.length-end) > NOTE_MAX) return;
  box.focus();
  box.setRangeText(text, at, end, "end");
  box.dispatchEvent(new Event("input", {bubbles:true}));   // the existing autosave + counter
}
/* ---------- spoiler notes (Day 24) ----------
   A parallel key rather than a shape change to anical.notes. That key is
   `id -> string` and has been since Day 02; turning it into `id -> {text,spoiler}`
   would mean a migration, and every older client and pasted sync code writing
   the old shape back would keep undoing it. Additive is the invariant, so a set
   of ids sits alongside it and an absent id means "not a spoiler". */
function saveSpoilers(){ try{ localStorage.setItem("anical.notespoiler", JSON.stringify([...state.noteSpoiler])); }catch(e){} }
function isSpoilerNote(id){ return state.noteSpoiler.has(String(id)); }
function setSpoilerNote(id, on){
  id=String(id);
  if(on) state.noteSpoiler.add(id); else state.noteSpoiler.delete(id);
  saveSpoilers();
}
// Revealed-this-session only, and never stored: "show me" is about the next ten
// seconds, and a reveal that persisted would silently turn the flag off forever
// the first time you looked at your own note.
function noteRevealed(id){ return !!(state._noteShown && state._noteShown.has(String(id))); }
function revealNote(id){
  if(!state._noteShown) state._noteShown=new Set();
  state._noteShown.add(String(id));
}
/* The three library flags, in one row of the detail pop-up (Days 25–27). They
   sit together because they answer one question — how should this show behave in
   my library — and separating them across the pop-up would make three unrelated
   controls out of what is really one decision with three answers. */
function libraryRowHtml(md){
  const id=String(md.id), sid=esc(id);
  const pinned=isPinned(id), full=!pinned && state.pins.length>=PIN_MAX;
  return `<div class="st-row lib-row">
    <button type="button" class="lib-btn${isFav(id)?" on fav":""}" data-fav="${sid}"
      aria-pressed="${isFav(id)?"true":"false"}"
      title="${isFav(id)?"Remove from favourites":"A favourite — separate from your score"}">${isFav(id)?"♥":"♡"} Favourite</button>
    <button type="button" class="lib-btn${pinned?" on":""}" data-pin="${sid}"
      aria-pressed="${pinned?"true":"false"}"
      title="${pinned?"Unpin":full?`You already have ${PIN_MAX} pins`:"Keep this at the top of your board and lists"}">📌 ${pinned?`Pinned #${pinIndex(id)+1}`:"Pin"}</button>
    <button type="button" class="lib-btn${isArchived(id)?" on":""}" data-arch="${sid}"
      aria-pressed="${isArchived(id)?"true":"false"}"
      title="${isArchived(id)?"Put it back on the board":"Take it off the board and keep everything"}">🗃 ${isArchived(id)?"Archived":"Archive"}</button>
    <span class="st-hint">A favourite is not a score and a pin is not a status — they sort your board without changing
      anything you have recorded. <b>Archiving</b> takes a show off your board and lists and leaves your rating, notes,
      dates and progress exactly where they are; it still appears in the calendar and in search.</span>
  </div>`;
}
function refreshLibraryRow(id){
  const md=findMediaById(id); if(!md) return;
  document.querySelectorAll(".lib-row").forEach(row=>{
    if(row.querySelector('[data-fav="'+CSS.escape(String(id))+'"]')) row.outerHTML=libraryRowHtml(md);
  });
}
/* ---------- the prediction, in the show pop-up (Days 41–42, 52) ----------
   Day 42 is the whole reason this is more than a number: below the confidence
   floor it shows NO estimate and instead names the specific shows to rate that
   would fix it. "Not enough signal yet" on its own is a dead end. */
function predictRowHtml(md){
  const id=String(md.id);
  if(getRating(id)) return "";                     // rated: the real score is right below
  const v=tasteVectors();
  if(v.total<TASTE_MIN_RATED){
    return `<div class="st-row pr-row"><span class="st-row-label">🔮 Prediction</span>
      <span class="st-hint" style="flex-basis:auto">Rate ${TASTE_MIN_RATED-v.total} more show${TASTE_MIN_RATED-v.total===1?"":"s"}
        and this starts estimating what you'd give things you haven't seen. You have ${v.total}.</span></div>`;
  }
  // You rated enough, but the app cannot see most of what you rated right now.
  // That is a loading problem, not a "rate more shows" problem, and telling you
  // to rate more would be asking for something you have already done.
  if(v.rated<TASTE_MIN_RATED){
    return `<div class="st-row pr-row"><span class="st-row-label">🔮 Prediction</span>
      <span class="pr-none">Loading your ratings…</span>
      <span class="st-hint">${v.unresolved} of your ${v.total} rated show${v.total===1?"":"s"}
        ${v.unresolved===1?"is":"are"} from seasons this browser hasn't fetched yet. They join the profile
        as they arrive — nothing is lost.</span></div>`;
  }
  const p=predictScore(id);
  if(!p || p.score==null || p.conf<PRED_LOW_CONF){
    // Name the gap, not the failure: which facets of THIS show you have no
    // opinion about, and therefore what rating would help.
    const idx=predIndex(), unknown=[];
    for(const dim of TASTE_DIMS){
      const m=idx.byDim[dim.key];
      for(const val of dim.values(md)) if(!m.get(val)) unknown.push(`${val}`);
    }
    const near=nearestRatedSuggestions(md, 3);
    return `<div class="st-row pr-row"><span class="st-row-label">🔮 Prediction</span>
      <span class="pr-none">Not enough signal yet</span>
      <span class="st-hint">Nothing you have rated covers ${unknown.length?`<b>${esc(unknown.slice(0,3).join(", "))}</b>`:"much of this show"}.
        ${near.length?`Rating ${near.map(m2=>`<b>${esc(title(m2))}</b>`).join(", ")} would give it something to work from.`:
          `Rate a few more shows in genres like these and it will have something to work from.`}</span></div>`;
  }
  const pct=Math.round(p.conf*100);
  return `<div class="st-row pr-row">
    <span class="st-row-label">🔮 Prediction</span>
    <span class="pr-score${p.conf<PRED_GOOD_CONF?" low":""}">${p.score}<small>/10</small></span>
    <span class="pr-conf"><i style="width:${pct}%"></i></span>
    <span class="pr-pct">${pct}% evidence</span>
    ${p.nudged?`<span class="pr-tag" title="Your head-to-head comparisons moved this">⚔ adjusted</span>`:""}
    <div class="pr-why">${p.why.map(w=>whyChipHtml(w,true)).join("")}</div>
    <span class="st-hint">Estimated from your own ratings — this is not a score and is never sent anywhere.
      The chips are what pushed it up or down, and by how much. Disagree with one? <b>−</b> and <b>+</b> teach it,
      and every prediction on screen moves straight away.</span>
  </div>`;
}
/* Which of your UNRATED shows would most improve this prediction: the ones that
   share the facets this show has and you have no opinion about. Day 42 asks for
   "name specific shows to rate", and a suggestion has to be actionable — so it
   only ever names shows already in your library. */
function nearestRatedSuggestions(md, n){
  const idx=predIndex();
  const want=new Set();
  for(const dim of TASTE_DIMS) for(const val of dim.values(md)) if(!idx.byDim[dim.key].get(val)) want.add(dim.key+"|"+val);
  if(!want.size) return [];
  const out=[];
  for(const id of state.watch){
    if(getRating(id)) continue;
    const m2=findMediaById(id); if(!m2 || String(m2.id)===String(md.id)) continue;
    let overlap=0;
    for(const dim of TASTE_DIMS) for(const val of dim.values(m2)) if(want.has(dim.key+"|"+val)) overlap++;
    if(overlap) out.push({md:m2, overlap});
  }
  return out.sort((a,b)=>b.overlap-a.overlap).slice(0,n||3).map(x=>x.md);
}
function noteTemplatesHtml(){
  return `<div class="nt-tpl">`+NOTE_TEMPLATES.map(t=>
    `<button type="button" class="nt-chip" data-notetpl="${esc(t.text)}" title="Insert at the cursor">${esc(t.label)}</button>`
  ).join("")+`</div>`;
}
// Score band — colours the chip, the read-out and the pill the same way.
function ratingBand(n){ return n>=9?"great" : n>=7?"good" : n>=5?"ok" : "bad"; }
/* ---------- score normalization (Day 17) ----------
   "Everything I like is an 8" is a real and common way to rate, and it makes a
   library unreadable: forty shows in one column, and no way to see which of
   your 8s you actually preferred. This stretches them apart.

   IT MOVES THE SPREAD, NOT THE AVERAGE. The transform is
   `mean + (score − mean) × k` — your own mean is the fixed point, so a generous
   rater stays generous and only the distances grow. Rescaling to a fixed centre
   instead (the obvious "map everything onto 1–10") would tell somebody whose
   library averages 8.2 that it averages 5.5, which is a statement about them
   that they did not make.

   AND IT ONLY EVER SPREADS. k is clamped at 1 from below, so a library that
   already uses the whole range is left exactly as it is rather than squashed
   toward its mean to hit a target — the toggle is called "spread my scores"
   and doing the opposite under the same switch would be a lie.

   IT ALSO STOPS AT THE EDGE OF THE SCALE RATHER THAN PILING SCORES UP ON IT.
   `fit` below is the largest stretch that keeps your highest and lowest scores
   inside 0.5–10, and it is taken before the clamp is ever needed. Without it a
   ×2.5 stretch on a library topping out at 9 would push both a 9 and a 9.5 past
   the ceiling, land them both on a clamped 10, and quietly merge two scores
   that were never equal — a spread function creating ties is the one thing it
   must not do. It is also what keeps the average exactly where it was.

   NOTHING STORED CHANGES. `state.ratings` is untouched, which is what makes the
   toggle reversible by definition rather than by a migration back. It also
   keeps this out of AniList for free: alPayloadFor() reads `state.ratings`
   directly, so a stretched number cannot be uploaded to somebody's account. */
const NORM_MIN_RATED = 5;      // below this the statistics are noise, not a shape
const NORM_MIN_SD    = 0.25;   // …and below this there is no spread to stretch
const NORM_TARGET_SD = 1.8;    // roughly what using the full 1–10 range looks like
const NORM_MAX_K     = 3;      // an all-8s library must not become an all-1s-and-10s one
let normCache=null;
function normStats(){
  if(normCache && normCache.rev===ratingsRev) return normCache;
  const vals=[];
  for(const id of Object.keys(state.ratings)){ const v=+state.ratings[id]; if(v>0) vals.push(v); }
  const n=vals.length;
  let mean=0, sd=0;
  if(n){
    for(const v of vals) mean+=v; mean/=n;
    // Population, not sample: this describes the library you have, not a sample
    // drawn from a larger one you don't.
    for(const v of vals) sd+=(v-mean)*(v-mean); sd=Math.sqrt(sd/n);
  }
  const lo = n?Math.min(...vals):0, hi = n?Math.max(...vals):0;
  const usable = n>=NORM_MIN_RATED && sd>=NORM_MIN_SD;
  // The largest stretch that still lands both ends inside the scale. Both
  // denominators are positive whenever there is any spread at all, and both
  // ratios are ≥1 because every stored score is already inside 0.5–10 — so this
  // can only ever hold the stretch back, never push it past 1 on its own.
  const fit = usable
    ? Math.min(hi>mean ? (RATING_MAX-mean)/(hi-mean) : Infinity,
               mean>lo  ? (mean-0.5)/(mean-lo)       : Infinity)
    : 1;
  const k = usable ? Math.max(1, Math.min(NORM_MAX_K, NORM_TARGET_SD/sd, fit)) : 1;
  normCache={ rev:ratingsRev, n, mean, sd, k, usable, lo, hi, fit };
  return normCache;
}
// On, and with enough of a library to mean anything. Both halves matter: the
// setting can be on while the statistics say there is nothing to do.
function normOn(){ return !!state.normalize && normStats().usable; }
/* One number in, one number out. Clamped to 0.5–10, never 0 — a 0 means
   *unrated* everywhere else in this file, and a display transform that could
   invent one would erase a rated show from the histogram and the card pill. */
function normApply(v){
  v=+v||0;
  if(!v || !normOn()) return v;
  const s=normStats();
  const out=s.mean + (v - s.mean) * s.k;
  return Math.round(Math.max(0.5, Math.min(RATING_MAX, out))*10)/10;
}
// What a score LOOKS like. getRating() stays the stored truth and everything
// that writes, syncs or compares keeps using it.
function shownRating(id){ return normApply(getRating(id)); }
/* Marks shown on cards, so a score or a note is visible without opening the show. */
function myScorePill(id){
  const n=getRating(id); if(!n) return "";
  const shown=normApply(n);
  const tip = shown!==n ? `Your rating: ${n}/10 — shown as ${shown} with your scores spread out`
                        : `Your rating: ${n}/10`;
  return `<span class="pill myscore ${ratingBand(shown)}${shown!==n?" norm":""}" title="${tip}">${shown}/10</span>`;
}
/* The mark on a card. A spoilered note deliberately puts NOTHING of itself in
   the tooltip (Day 24) — a `title=` attribute is text on screen the moment a
   pointer rests on it, so leaving the preview in place would defeat the entire
   feature at the one spot where a note is most likely to be seen by accident. */
function notePill(id){
  const n=getNote(id); if(!n) return "";
  if(isSpoilerNote(id)) return `<span class="pill notepill spoil" title="You have a note here, hidden as a spoiler">📝</span>`;
  return `<span class="pill notepill" title="Your notes: ${esc(n.slice(0,140))}${n.length>140?"…":""}">📝</span>`;
}
function favPill(id){ return isFav(id)?`<span class="pill favpill" title="A favourite">♥</span>`:""; }
function pinPill(id){
  const i=pinIndex(id);
  return i<0?"":`<span class="pill pinpill" title="Pinned to the top (#${i+1})">📌</span>`;
}
function archPill(id){ return isArchived(id)?`<span class="pill archpill" title="Archived — off the board, nothing lost">🗃</span>`:""; }
/* Day 41: the estimate on an UNRATED card, and only there — a rated show shows
   the real score, because a prediction next to a fact is noise. Greyed when the
   predictor is not confident, and absent entirely below the floor, which is Day
   42's rule applied at the smallest surface it has. */
function predPill(id){
  if(getRating(id) || !tasteReady()) return "";
  const p=predictScore(id);
  if(!predUsable(p)) return "";
  const low=p.conf<PRED_GOOD_CONF;
  return `<span class="pill predpill${low?" low":""}" title="Predicted from your taste — rests on ${Math.round(p.conf*100)}% evidence. Not your score.">~${p.score}</span>`;
}
function myMarks(id){ return pinPill(id)+favPill(id)+myScorePill(id)+predPill(id)+notePill(id)+archPill(id); }
// Anything that puts a mark on a card, so the card knows whether to render the
// strip at all. One list, so a new mark can never be invisible on the board.
function hasMarks(id){ return !!(getRating(id)||hasNote(id)||isFav(id)||isPinned(id)||isArchived(id)||predPill(id)); }
/* 1–10 picker; clicking the highlighted number clears the rating.
   The composite can land between two chips once the axes disagree, so the
   nearest chip lights up rather than the picker reading as unrated — but only
   an exact match clears, because clicking 7 on a 7.4 means "make it a flat 7". */
function ratingChipOn(cur, n){ return cur>0 && Math.round(cur)===n; }
function ratingPickerHtml(id){
  const cur=getRating(id), sid=esc(String(id));
  let out=`<div class="rt-pick" data-rt-pick="${sid}" role="group" aria-label="Your rating out of 10">`;
  for(let n=1;n<=RATING_MAX;n++){
    const on=ratingChipOn(cur,n);
    out+=`<button type="button" class="rt-chip${on?" on "+ratingBand(n):""}" data-rt="${sid}|${n}" aria-pressed="${on?"true":"false"}" title="${cur===n?"Clear your rating":"Rate "+n+" out of 10"}">${n}</button>`;
  }
  return out+`</div>`;
}
/* The read-out above the picker shows the STORED number, always — the chips
   under it are what you click, and a read-out that disagreed with the chip that
   is lit would make the picker unusable. When the stretch is on it is appended
   rather than substituted, so the pop-up explains the number the cards are
   showing instead of contradicting it. Takes a score rather than an id because
   paintComposite() calls it mid-drag with a value that isn't stored yet. */
function ratingOutInner(cur){
  if(!cur) return "Not rated";
  const shown=normApply(cur);
  return cur+"/10"+(shown!==cur
    ? `<i class="rt-norm" title="Your scores are being spread out — see Settings › Ratings">→ ${shown} on cards</i>`
    : "");
}
function ratingOutHtml(id){
  const cur=getRating(id);
  return `<span class="rt-out${cur?" "+ratingBand(cur):""}" data-rt-out="${esc(String(id))}">${ratingOutInner(cur)}</span>`;
}
/* ---------- the axes, as five sliders ----------
   Collapsed by default, and that is the whole design decision. Nearly every
   rating anybody gives is a number they picked in one click; five sliders held
   permanently open would slow the common case down to serve the rare one. The
   panel opens by itself when the axes actually disagree, because at that point
   the single number no longer explains itself and hiding the reason for it is
   the worse trade. */
function axesAreFlat(id){
  const a=getAxes(id), vals=AXIS_KEYS.map(k=>a[k]).filter(v=>v>0);
  return vals.length<=1 || vals.every(v=>v===vals[0]);
}
// 0 is "not scored", not a score of zero — compositeOf() skips it rather than
// averaging it in. The picker above has never offered a 0 either, so nothing is
// lost: the distinction between 0/10 and 0.5/10 is one nobody needs.
const axisValueText = v => (v ? String(v) : "—");
const axisValueLabel = v => (v ? `${v} out of ${RATING_MAX}` : "not scored");
function axesRowHtml(md){
  const id=String(md.id), a=getAxes(id), sid=esc(id), open=!axesAreFlat(id);
  const rows=AXIS_DEFS.map(ax=>{
    const v=a[ax.key], fid=`ax-${ax.key}-${sid}`;
    return `<label class="ax-lab" for="${fid}">${ax.label}</label>
      <input type="range" class="ax-sl" id="${fid}" data-ax="${sid}|${ax.key}"
        min="0" max="${RATING_MAX}" step="0.5" value="${v}"
        aria-label="${ax.label}" aria-valuetext="${axisValueLabel(v)}">
      <span class="ax-val${v?"":" none"}" data-axval="${sid}|${ax.key}">${axisValueText(v)}</span>`;
  }).join("");
  return `<div class="ax-wrap${open?" open":""}">
    <button type="button" class="ax-toggle" data-axtoggle="${sid}" aria-expanded="${open?"true":"false"}">
      <i>▶</i> Rate in detail
    </button>
    <div class="ax-body">
      <div class="ax-grid">${rows}</div>
      <span class="st-hint">Scored in halves. The number above is their average, and an axis left at —
        is ignored rather than counted as a zero, so a film with no music doesn't lose points for it.
        Picking a number above sets all five at once.</span>
    </div>
  </div>`;
}
/* Dragging repaints; releasing writes. `input` fires continuously through a
   drag, so persisting there would mean a localStorage write and an AniList
   enqueue per pixel travelled — it only repaints, and `change` (once, on
   release, or on an arrow key) does the writing. Repainting is deliberately
   surgical for the same reason Day 07 stopped rebuilding the modal: replacing
   the row mid-gesture would tear the slider out from under the pointer. */
function paintAxis(id, key, v){
  id=String(id);
  document.querySelectorAll("[data-axval]").forEach(el=>{
    if(el.dataset.axval !== id+"|"+key) return;
    el.textContent=axisValueText(v);
    el.className="ax-val"+(v?"":" none");
  });
}
function paintComposite(id, axes){
  const n=compositeOf(axes);
  document.querySelectorAll('[data-rt-out="'+CSS.escape(String(id))+'"]').forEach(el=>{
    el.className="rt-out"+(n?" "+ratingBand(n):"");
    el.innerHTML=ratingOutInner(n);
  });
}
// The chips and the sliders are two views of one number, so a change to either
// has to move the other or the pop-up sits there contradicting itself. Setting
// .value from script fires no events, so this cannot loop back into the writer.
function syncAxisSliders(id){
  id=String(id);
  const a=getAxes(id);
  document.querySelectorAll("[data-ax]").forEach(sl=>{
    const parts=String(sl.dataset.ax).split("|");
    if(parts[0]!==id) return;
    const v=a[parts[1]];
    if(+sl.value!==v) sl.value=v;
    sl.setAttribute("aria-valuetext", axisValueLabel(v));
    paintAxis(id, parts[1], v);
  });
}
function refreshRatingPickers(id){
  id=String(id);
  const cur=getRating(id);
  syncAxisSliders(id);
  document.querySelectorAll('[data-rt-pick="'+CSS.escape(id)+'"] .rt-chip').forEach(chip=>{
    const n=+String(chip.dataset.rt||"").split("|")[1], on=ratingChipOn(cur,n);
    chip.className="rt-chip"+(on?" on "+ratingBand(n):"");
    chip.setAttribute("aria-pressed", on?"true":"false");
    chip.title = cur===n ? "Clear your rating" : "Rate "+n+" out of 10";
  });
  document.querySelectorAll('[data-rt-out="'+CSS.escape(id)+'"]').forEach(el=>{
    el.className="rt-out"+(cur?" "+ratingBand(cur):"");
    el.innerHTML=ratingOutInner(cur);
  });
}
/* Notes auto-save shortly after you stop typing; anything still pending is
   flushed when the pop-up closes or the tab goes away, so nothing is lost. */
let notePending=null, noteTimer=null;
function saveNoteNow(){
  if(!notePending) return;
  const {id, el}=notePending;
  notePending=null; clearTimeout(noteTimer); noteTimer=null;
  const had=hasNote(id);
  setNote(id, el.value);
  const label=$("noteState"); if(label && label.isConnected) label.textContent="Saved ✓";
  if(had!==hasNote(id)) renderView();   // the 📝 mark on cards appears / disappears
}
/* ---------- head-to-head comparisons (Day 18) ----------
   "Which of these two did you like more?" is a question people answer well and
   consistently; "what is this show out of ten?" is one they answer badly and
   differently on different days. This stores the answers and derives an order
   from them.

   THE LOG IS THE TRUTH; THE ORDER IS DERIVED. `anical.pairs` holds nothing but
   verdicts — [winner, loser, when] — and the ranking is recomputed by replaying
   them. Same split as Day 13's axes and composite: one key is the input, the
   other is the answer, and no stored number can drift out of agreement with
   what you actually said. It also makes undo a splice rather than an inverse
   Elo update, which does not exist.

   ONE VERDICT PER PAIR. Re-answering a pair replaces the earlier record instead
   of appending next to it, so changing your mind is a change of mind and not a
   permanent tie. What is left after that rule is the interesting kind of
   contradiction — A over B, B over C, C over A — and Elo resolves a cycle by
   landing all three near each other, which is the honest answer and, more to
   the point, does not crash. A topological sort would; that is why this is a
   rating system and not a sort. */
const PAIR_START  = 1500;   // everyone starts level
const PAIR_EPOCHS = 6;      // passes over the log
const PAIR_K0     = 32;
const PAIR_DECAY  = 0.7;    // the step shrinks each pass — see pairRatings()
const PAIR_MAX    = 2000;   // a guard on the key's size, not a design limit
let pairsRev=0, pairCache=null;
function savePairs(){
  pairsRev++;
  try{ localStorage.setItem("anical.pairs", JSON.stringify(state.pairs)); }catch(e){}
}
// Unordered: the pair {A,B} is one question however it was asked.
function pairKey(a,b){ a=String(a); b=String(b); return a<b ? a+"|"+b : b+"|"+a; }
function findPairIndex(a,b){ const k=pairKey(a,b); return state.pairs.findIndex(p=>pairKey(p[0],p[1])===k); }
function pairDecided(a,b){ return findPairIndex(a,b)>=0; }
/* Returns whatever it displaced, with the slot it sat in, so the Undo toast can
   put the previous verdict back exactly where it was — position in the log is
   not decoration here, it is an input to the replay. */
function recordPair(winner, loser){
  winner=String(winner); loser=String(loser);
  if(!winner || !loser || winner===loser) return null;
  const i=findPairIndex(winner, loser);
  const prev = i>=0 ? state.pairs[i] : null;
  if(i>=0) state.pairs.splice(i,1);
  state.pairs.push([winner, loser, Math.floor(Date.now()/1000)]);
  if(state.pairs.length>PAIR_MAX) state.pairs.splice(0, state.pairs.length-PAIR_MAX);
  savePairs();
  return prev ? {index:i, rec:prev} : null;
}
function undoPair(winner, loser, prev){
  const i=findPairIndex(winner, loser);
  if(i>=0) state.pairs.splice(i,1);
  if(prev && prev.rec) state.pairs.splice(Math.max(0, Math.min(prev.index, state.pairs.length)), 0, prev.rec);
  savePairs();
}
function clearPairs(){ const was=state.pairs; state.pairs=[]; savePairs(); return was; }
/* Elo, replayed from scratch over the whole log.

   Elo is stochastic gradient descent on the Bradley–Terry likelihood, so a
   single pass weights late answers far more than early ones — the show you
   compared first would sit wherever its first two results left it. Passing over
   the log repeatedly fixes that, and shrinking the step each pass is what makes
   the passes converge instead of oscillating around the answer. Six passes over
   a few hundred verdicts is well under a millisecond, and the result is
   deterministic: the same log always produces the same order.

   Cached on a revision counter because the ranking is read on every paint of
   the panel and every card in it. */
function pairRatings(){
  if(pairCache && pairCache.rev===pairsRev) return pairCache;
  const r={}, n={};
  for(const p of state.pairs){
    if(r[p[0]]===undefined){ r[p[0]]=PAIR_START; n[p[0]]=0; }
    if(r[p[1]]===undefined){ r[p[1]]=PAIR_START; n[p[1]]=0; }
    n[p[0]]++; n[p[1]]++;
  }
  let k=PAIR_K0;
  for(let e=0;e<PAIR_EPOCHS;e++){
    for(const p of state.pairs){
      const a=r[p[0]], b=r[p[1]];
      const expected=1/(1+Math.pow(10,(b-a)/400));
      const move=k*(1-expected);
      r[p[0]]=a+move; r[p[1]]=b-move;
    }
    k*=PAIR_DECAY;
  }
  pairCache={rev:pairsRev, r, n};
  return pairCache;
}
function pairElo(id){ const r=pairRatings().r[String(id)]; return r===undefined?PAIR_START:r; }
function pairCount(id){ return pairRatings().n[String(id)]||0; }
/* A total order over everything that has been compared at least once. Ties are
   broken by your own score and then by id, so the list is stable between paints
   rather than reshuffling equal shows every time it is drawn. */
function pairOrder(){
  const {r}=pairRatings();
  return Object.keys(r).sort((a,b)=>
    (r[b]-r[a]) || (getRating(b)-getRating(a)) || (a<b?-1:1));
}
/* How many of your own verdicts the list you are shown contradicts. Not an
   error — a cycle (A over B, B over C, C over A) cannot be laid out in a line
   without overruling at least one of its edges, whatever puts it there. It is
   measured against pairOrder() rather than against the ratings behind it so
   that it agrees with what is on screen: two shows the replay left exactly
   level are ordered by the tie-break, and a verdict the tie-break went against
   is still a verdict the list contradicts. */
function pairConflicts(){
  const order=pairOrder(), rank={};
  order.forEach((id,i)=>{ rank[id]=i; });
  let n=0;
  for(const p of state.pairs) if(rank[p[0]] > rank[p[1]]) n++;   // winner listed below loser
  return n;
}
/* Which shows can be put in front of you. A comparison needs a show you have
   actually seen and that the app can draw, which is a narrower set than "rated":
   Plan to Watch is explicitly not it, and a show the loaded seasons don't
   contain has no cover art to show. Day 10's hydration widens this pool for
   free as it fills state.extra. */
const VS_SEEN_STATUS = new Set(["watching","completed","onhold","dropped"]);
function versusPool(){
  const seen=new Set();
  for(const id of Object.keys(state.ratings)) if(getRating(id)) seen.add(String(id));
  for(const id of Object.keys(state.status)) if(VS_SEEN_STATUS.has(state.status[id])) seen.add(String(id));
  const pool=[];
  for(const id of seen){
    if(isHidden(id)) continue;
    if(!findMediaById(id)) continue;
    pool.push(id);
  }
  return pool;
}
function shuffled(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t; }
  return a;
}
const VS_FOCUS = 24;   // window size — 276 candidate pairs, not the 80,000 a full sweep costs
/* The next question worth asking. Two rules, in this order: spread coverage
   before deepening it (least-compared shows first), then inside that window ask
   the closest call, because a comparison between two shows already fifty points
   apart tells you almost nothing you don't have. `skip` is the caller's set of
   pair keys to refuse — Day 19 fills it with what you skipped this session. */
function nextPair(skip, pool){
  pool=pool||versusPool();
  if(pool.length<2) return null;
  // Shuffle first, then a stable sort by comparison count: ties come out in
  // random order, so it isn't the same twenty-four shows every single time.
  const focus=shuffled(pool).sort((a,b)=>pairCount(a)-pairCount(b)).slice(0, VS_FOCUS);
  let best=null, bestCost=Infinity;
  for(let i=0;i<focus.length;i++){
    for(let j=i+1;j<focus.length;j++){
      const a=focus[i], b=focus[j];
      if(skip && skip.has(pairKey(a,b))) continue;
      let cost=Math.abs(pairElo(a)-pairElo(b));
      if(pairDecided(a,b)) cost+=4000;                  // only re-ask when nothing new is left
      cost+=(pairCount(a)+pairCount(b))*20;
      if(cost<bestCost){ bestCost=cost; best=[a,b]; }
    }
  }
  if(!best) return null;
  // Which side a show lands on is a coin flip, so the left card is never
  // reliably the higher-ranked one — that would be a hint, and a hint in a
  // preference test is a way of collecting your agreement instead of your view.
  return Math.random()<0.5 ? best : [best[1], best[0]];
}

/* ---------- the calibration run (Day 20) ----------
   Ten questions that leave you with an ordering, starting from nothing.

   THE WHOLE DAY IS THE POOL, NOT THE COUNTER. Free play spreads: nextPair()
   asks about the least-compared shows first, so from an empty history ten
   answers land on up to twenty different shows with one comparison each — twenty
   disconnected pairs and no ordering at all, because nothing can be ranked
   against anything it was never transitively compared to. A run therefore fixes
   a small working set first and asks only inside it. Eight shows have 28
   possible pairs; ten answers over them is a connected graph and a genuine total
   order over all eight. Ten answers over the whole library is ten facts.

   THE SET IS SPREAD ACROSS YOUR SCORE RANGE, not taken off the top. Ranking your
   eight favourites tells you the order of eight shows you already rate the same;
   sampling evenly from your best to your worst produces an ordering that spans
   your taste — and gives Day 21 anchors at both ends to map scores onto. Shows
   with no score at all go in last, filling the set only if the rated ones can't. */
const CALIB_SET    = 8;    // working set — 28 possible pairs
const CALIB_ROUNDS = 10;   // answers that end the run
function calibrationSet(){
  const pool=versusPool();
  if(pool.length<=CALIB_SET) return pool;
  const rated=pool.filter(id=>getRating(id)).sort((a,b)=>getRating(b)-getRating(a));
  const rest=shuffled(pool.filter(id=>!getRating(id)));
  if(rated.length<CALIB_SET) return rated.concat(rest.slice(0, CALIB_SET-rated.length));
  // Evenly spaced picks through the sorted list, ends included — the highest and
  // lowest scores you have gave the range, so they have to be in the set that
  // establishes it.
  const out=[];
  for(let i=0;i<CALIB_SET;i++) out.push(rated[Math.round(i*(rated.length-1)/(CALIB_SET-1))]);
  return [...new Set(out)];
}
function calibStart(){
  state._vsRun={ ids:calibrationSet(), done:0, target:CALIB_ROUNDS, was:state.pairs.length };
  return state._vsRun;
}
function calibStop(){ const r=state._vsRun; state._vsRun=null; return r; }
const calibRunning = () => !!state._vsRun && state._vsRun.done < state._vsRun.target;

/* ---------- comparisons → suggested scores (Day 21) ----------
   IT REDEALS YOUR OWN SCORES; IT DOES NOT INVENT NEW ONES. Take the shows that
   are both rated and compared, take the scores you gave them as a multiset, sort
   both, and hand the k-th highest score to the k-th ranked show. The suggestion
   is therefore always a *permutation* of numbers you already chose.

   That one decision kills every problem the obvious versions have. Mapping Elo
   linearly onto 1–10 forces a 1 and a 10 to exist and lets a single outlier
   anchor the whole scale. Mapping onto your observed range spreads everyone
   evenly and quietly flattens the clustering that is genuinely how you rate.
   Redealing changes nothing about the shape: same mean, same spread, the Day 16
   histogram is pixel-identical before and after. The only thing that moves is
   WHICH show holds which number — which is exactly, and only, what a preference
   ordering is evidence about.

   It also makes the proposal legible. "Frieren 8 → 9, Bocchi 9 → 8" is a swap
   you can check against your own memory in a second; "Frieren 8 → 8.4" is a
   number you have no way to agree or disagree with. */
function suggestedScores(){
  const ranked=pairOrder().filter(id=>getRating(id));
  if(ranked.length<2) return [];
  const pool=ranked.map(id=>getRating(id)).sort((a,b)=>b-a);
  const out=[];
  ranked.forEach((id,i)=>{
    const cur=getRating(id), next=pool[i];
    if(cur!==next) out.push({id, cur, next});
  });
  return out;
}
/* Nothing is written until this is called, and it is only called from a click.
   Returns what it overwrote so the toast can put every score back — including
   the axes, because setRating flattens them and Day 13's undo rule applies here
   exactly as it does to a chip click. */
function applySuggestions(rows){
  const undo=rows.map(r=>({id:r.id, score:getRating(r.id), axes:getAxes(r.id)}));
  for(const r of rows) setRating(r.id, r.next);
  return undo;
}
function revertSuggestions(undo){ for(const u of undo) restoreRating(u.id, u.score, u.axes); }

/* ---------- taste vectors (Day 32) ----------
   What your ratings say about what you like, per genre, tag, studio, era, length
   and source material. Everything from Day 33 to Day 49 is a view of this.

   THE NAIVE VERSION IS DOMINATED BY YOUR GENEROSITY. "Your average score for
   Thriller" is 8.4 for somebody who rates everything 8.4, and so is every other
   genre — the chart would rank noise. Two numbers fix it, and they answer
   different questions, so both are kept:

     lift    = your mean here − your mean overall   ("is this above MY bar?")
     vsCrowd = your mean here − the crowd's mean here   ("do I like it more than
               other people do?")

   `lift` is the shape of your taste and is what the predictor reads. `vsCrowd`
   is the more interesting thing to LOOK at, and is what Day 33's chart draws.
   The crowd baseline is AniList's average *on the shows you rated*, not its
   global average, so the comparison is like-for-like: it cannot be moved by the
   fact that you happen to watch well-reviewed shows.

   SMALL SAMPLES ARE SHRUNK, NOT TRUSTED. One 10/10 in a genre you have seen once
   would otherwise top every chart forever. Each mean is pulled toward your
   overall mean in proportion to how little evidence there is — the standard
   estimator, with K=3 — so a value needs a few shows before it can say much.
   Raw means and counts are kept alongside, because the honest chart shows both. */
/* A swipe is worth about a third of a rating — enough that a feed session
   genuinely teaches the profile, not so much that it can outvote scores you
   actually thought about. Each kind says this much about you relative to your
   own average; the numbers are deliberately modest, because a status is a
   decision about whether to watch and only indirectly about whether you liked it. */
const WEAK_W = 0.3;
const WEAK_DELTA = { watching:+0.7, plan:+0.5, completed:+0.3, dropped:-1.2, no:-0.8 };
// Bumped by every writer of a status or a dismissal, so the taste cache knows
// the weak half of its input moved. Ratings already have ratingsRev.
let weakRev = 0;
function bumpWeak(){ weakRev++; tasteCache=null; predCache=null; }
const TASTE_K = 3;         // shrinkage strength: a value with 3 shows is half-trusted
const TASTE_MIN_N = 2;     // below this a value is not charted at all
const TASTE_THIN_N = 4;    // …and below this it is charted but marked thin
const TAG_MIN_RANK = 60;   // AniList tags below this are noise on most shows
const LENGTH_BUCKETS = [
  [1,1,"Film / one-shot"], [2,7,"Short (2–7)"], [8,14,"One cour (8–14)"],
  [15,28,"Two cour (15–28)"], [29,60,"Long (29–60)"], [61,Infinity,"Very long (60+)"],
];
const lengthBucket = n => (LENGTH_BUCKETS.find(b=>n>=b[0]&&n<=b[1])||[,,null])[2];
const yearOfMedia = md => md.seasonYear || (md.startDate&&md.startDate.year) || 0;
const decadeOf = y => y ? `${Math.floor(y/10)*10}s` : null;
const TASTE_DIMS = [
  { key:"genre",  label:"Genre",   one:"genre",   values: md=>md.genres||[] },
  { key:"tag",    label:"Tag",     one:"tag",     values: md=>(md.tags||[])
      .filter(t=>t&&t.name&&(t.rank||0)>=TAG_MIN_RANK&&!t.isMediaSpoiler&&!t.isAdult).map(t=>t.name) },
  { key:"studio", label:"Studio",  one:"studio",  values: md=>((md.studios&&md.studios.nodes)||[]).map(s=>s&&s.name).filter(Boolean) },
  { key:"era",    label:"Era",     one:"decade",  values: md=>{ const d=decadeOf(yearOfMedia(md)); return d?[d]:[]; } },
  { key:"length", label:"Length",  one:"length",  values: md=>{ const b=lengthBucket(epTotal(md)); return b?[b]:[]; } },
  { key:"source", label:"Source",  one:"source",  values: md=>md.source?[SOURCE_LABEL[md.source]||md.source]:[] },
];
const TASTE_BY_KEY = Object.fromEntries(TASTE_DIMS.map(d=>[d.key,d]));
let tasteCache=null;
/* Cached on the ratings revision AND on how much media is loaded, because a
   rated show the app cannot resolve yet contributes nothing — Day 10's
   hydration and every season load quietly widen the sample, and a cache keyed on
   ratings alone would keep serving a profile built from half the library. */
function tasteVectors(){
  // The adjustment count is in the stamp as well as invalidating the cache
  // directly, so nothing can serve a profile from before you pushed back on it.
  // `weakRev` is in here because statuses and dismissals now feed the vectors:
  // without it, a feed session would swipe fifty shows and the profile would go
  // on serving the version from before any of them.
  const stamp=`${ratingsRev}:${weakRev}:${state.media.length}:${state.extra.size}:${tasteAdjCount()}`;
  if(tasteCache && tasteCache.stamp===stamp) return tasteCache;

  /* `ratedIds` is EVERY score you have given; `rows` is the subset the app can
     currently draw. The two are different numbers and Day 91 learned the hard
     way that conflating them is a bug you can see: state.media is replaced
     wholesale on every range load, so eleven ratings resolved to eleven rows on
     the board and to two on the calendar, and the taste page, the predictor gate
     and every "you have N rated shows" line collapsed the moment you changed
     view. The sample legitimately depends on what is loaded. The COUNT OF THINGS
     YOU RATED does not, and nothing user-facing may be derived from `rows`. */
  const ratedIds=Object.keys(state.ratings).filter(id=>getRating(id));
  const rows=[];
  for(const id of ratedIds){
    const md=findMediaById(id); if(!md) continue;
    rows.push({ id, md, mine:getRating(id), crowd: md.averageScore ? md.averageScore/10 : null, w:1 });
  }
  const n=rows.length;
  const myMean = n ? rows.reduce((s,r)=>s+r.mine,0)/n : 0;
  const withCrowd=rows.filter(r=>r.crowd!=null);
  const crowdMean = withCrowd.length ? withCrowd.reduce((s,r)=>s+r.crowd,0)/withCrowd.length : 0;

  /* ---------- weak signals ----------
     A status is an opinion too, and the feed collects far more of them than it
     collects scores. Filing something under Plan to Watch is a mild yes; dropping
     it is a firmer no; "not interested" is a no about the idea rather than the
     execution. None of them are a number, so each becomes a pseudo-score
     expressed RELATIVE TO YOUR OWN MEAN — an absolute value would mean something
     different for a generous rater than a harsh one — carrying a third of a real
     rating's weight.

     Weighted, not counted, so a hundred swipes cannot drown out ten ratings you
     actually thought about. And only for shows you have NOT scored: a real score
     always supersedes the guess its status would have implied. */
  const weak=[];
  if(n){
    const seenWeak=new Set();
    const addWeak=(id,kind)=>{
      id=String(id);
      if(getRating(id) || seenWeak.has(id)) return;
      const md=findMediaById(id); if(!md) return;
      seenWeak.add(id);
      // Placed relative to the mean of your REAL ratings, because that is the
      // only scale that exists before the weak rows are counted.
      weak.push({ id, md, mine:myMean+WEAK_DELTA[kind], crowd:null, w:WEAK_W, kind });
    };
    for(const id of Object.keys(state.status)) if(WEAK_DELTA[state.status[id]]!=null) addWeak(id, state.status[id]);
    for(const id of state.recNo) addWeak(id, "no");
  }
  const all=rows.concat(weak);

  /* THE BASELINE HAS TO INCLUDE THE WEAK ROWS, and leaving it out was a real bug
     that a feed session made obvious. `lift` is measured against your overall
     mean — so if the only things you ever SCORE are the ones you loved, your
     mean is that, and the genre you love reads as exactly 0.00 above it. A
     simulated session doing precisely what this feed encourages (score the
     favourites, status-only everything else) produced ten 9/10 Psychological
     ratings and a Psychological lift of zero.

     The fix is a second baseline: the pseudo-scores are placed against the
     ratings-only mean (the only scale available at that point), and then the
     mean everything is measured against is the WEIGHTED mean across both. The
     shows you dropped without scoring now pull the baseline down, which is what
     restores the contrast the ratings alone had lost. Two stages, so the
     definition never depends on itself. */
  let baseW=0, baseSum=0;
  for(const r of all){ baseW+=r.w; baseSum+=r.mine*r.w; }
  const overallMean = baseW ? baseSum/baseW : myMean;

  const dims={};
  for(const dim of TASTE_DIMS){
    const acc=new Map();
    for(const r of all){
      for(const v of dim.values(r.md)){
        if(!v) continue;
        let a=acc.get(v);
        if(!a){ a={value:v, n:0, w:0, sum:0, crowdSum:0, crowdN:0, ids:[], weak:0}; acc.set(v,a); }
        a.w+=r.w; a.sum+=r.mine*r.w;
        if(r.w===1){ a.n++; a.ids.push(r.id); } else a.weak++;
        if(r.crowd!=null){ a.crowdN++; a.crowdSum+=r.crowd; }
      }
    }
    const out=[];
    for(const a of acc.values()){
      // Measured in weight, not rows, so two ratings and seven swipes both clear
      // the bar — which is the point of collecting the swipes at all.
      if(a.w<TASTE_MIN_N) continue;
      const mine=a.sum/a.w;
      const crowd=a.crowdN?a.crowdSum/a.crowdN:null;
      // Pulled toward your own overall mean, in proportion to how thin the
      // evidence is. w=3 lands halfway; w=12 is essentially untouched.
      const shrunk=(a.w*mine + TASTE_K*overallMean)/(a.w+TASTE_K);
      // Day 53's adjustment is folded in HERE, once, so every reader downstream
      // — the charts, the predictor, the badges, the recommendations — gets the
      // adjusted number without any of them knowing the feature exists.
      // `baseLift` keeps what your ratings alone said, which is what makes the
      // chart able to show both and the reset able to mean anything.
      const adj=tasteAdjOf(dim.key, a.value);
      const baseLift=Math.round((shrunk-overallMean)*100)/100;
      out.push({
        value:a.value, n:a.n, weak:a.weak, w:Math.round(a.w*10)/10, ids:a.ids, adj, baseLift,
        mine:Math.round(mine*100)/100,
        crowd: crowd==null?null:Math.round(crowd*100)/100,
        lift: Math.round((baseLift+adj)*100)/100,
        // Difference in differences, so neither side's overall generosity counts:
        // how far above your bar this sits, minus how far above theirs it sits.
        vsCrowd: crowd==null?null:Math.round(((shrunk-myMean)-(crowd-crowdMean))*100)/100,
        thin: a.w<TASTE_THIN_N,
      });
      }
    out.sort((x,y)=>y.lift-x.lift || y.n-x.n || String(x.value).localeCompare(String(y.value)));
    dims[dim.key]=out;
  }
  tasteCache={ stamp, n, rated:rows.length, swipes:weak.length,
               // How many shows you have scored, full stop. Stable across view
               // changes, never smaller than it was a moment ago, and the only
               // number any "you have N" copy or unlock gate is allowed to use.
               total: ratedIds.length,
               myMean:Math.round(myMean*100)/100, overallMean:Math.round(overallMean*100)/100,
               crowdMean:Math.round(crowdMean*100)/100, dims,
               // How many rated shows the app could not resolve to media yet —
               // the profile's own honest footnote about its sample.
               unresolved: ratedIds.length-rows.length };
  return tasteCache;
}
/* ---------- retraining in place (Day 53) ----------
   The charts and the predictor read a lift that is DERIVED from your ratings.
   This lets you push back on one directly — "no, I like Psychological more than
   that" — and have every prediction on screen move immediately.

   THE ADJUSTMENT IS A SECOND INPUT, NOT AN EDIT OF THE OUTPUT. `anical.tasteadj`
   holds `dim|value -> delta` and is layered on at read time. Writing the new lift
   back into the vectors would have been one line and would have been erased by
   the next rating you gave, silently, with no way to tell it had happened. Same
   split as Day 13's axes and composite, and Day 17's stored score and displayed
   one: the thing you typed and the thing computed from it never share a key.

   It is also why a reset is possible at all — the derived value was never lost. */
const TASTE_ADJ_STEP = 0.25;
const TASTE_ADJ_MAX  = 2;      // beyond this you are not adjusting, you are inventing
const adjKey = (dim,value) => dim+"|"+value;
function saveTasteAdj(){
  try{ localStorage.setItem("anical.tasteadj", JSON.stringify(state.tasteAdj)); }catch(e){}
  tasteCache=null; predCache=null;   // both are derived from the lift this changes
}
function tasteAdjOf(dim,value){ return +state.tasteAdj[adjKey(dim,value)] || 0; }
function nudgeTaste(dim, value, dir){
  const k=adjKey(dim,value);
  const next=Math.max(-TASTE_ADJ_MAX, Math.min(TASTE_ADJ_MAX,
    Math.round((tasteAdjOf(dim,value)+dir*TASTE_ADJ_STEP)*100)/100));
  if(next) state.tasteAdj[k]=next; else delete state.tasteAdj[k];   // zero is "no opinion", not a stored 0
  saveTasteAdj();
  return next;
}
function clearTasteAdj(dim,value){
  if(dim==null){ const was={...state.tasteAdj}; state.tasteAdj={}; saveTasteAdj(); return was; }
  const was=tasteAdjOf(dim,value);
  delete state.tasteAdj[adjKey(dim,value)]; saveTasteAdj();
  return was;
}
const tasteAdjCount = () => Object.keys(state.tasteAdj).length;
const tasteDim = key => (tasteVectors().dims[key]||[]);
// Enough of a library to say anything at all. Below this every chart says so
// rather than drawing a shape out of four data points.
const TASTE_MIN_RATED = 8;
/* Gated on `total`, not on the resolved sample. Unlocking is a statement about
   what YOU did, so it has to be monotonic: a gate that reads the sample switches
   itself back off when you open the calendar, because the calendar replaces
   state.media with a date range your older ratings aren't in. Whether the sample
   is thick enough to say anything is a separate question, and one the confidence
   score below already answers per prediction. */
const tasteReady = () => tasteVectors().total >= TASTE_MIN_RATED;

/* ---------- the predictor (Days 39–44) ----------
   What you would probably score a show you have not rated.

   IT IS THE TASTE VECTORS, NOT NEIGHBOURS. A nearest-neighbour estimate over a
   library of thirty shows is a lookup of two or three shows that happen to share
   a genre, and it swings wildly on which ones. Adding up the lift of everything a
   show carries — its genres, its ranked tags, its studio, its decade, its length,
   its source — uses the whole library on every prediction and degrades smoothly
   instead of jumping. Each contribution is the SHRUNK lift, so a tag you have
   seen twice moves the estimate barely at all.

   The estimate is your own mean plus the summed evidence, clamped to the scale.
   A show carrying nothing you have an opinion about predicts your mean, which is
   the honest answer to "no information": it is what you would guess.

     estimate = myMean + Σ(lift × weight) / Σ(weight), over what the show carries

   CONFIDENCE IS SEPARATE AND IS ALLOWED TO SAY NO (Day 40). It rises with how
   much of the show you have evidence about and how thick that evidence is, and
   below LOW_CONF the app refuses to show a number at all (Day 42) rather than
   dressing a guess up as a score. */
const PRED_DIM_WEIGHT = { genre:1, tag:0.55, studio:0.9, era:0.4, length:0.5, source:0.5 };
const PRED_LOW_CONF = 0.34;      // under this, no number is shown at all
const PRED_GOOD_CONF = 0.66;     // over this, the badge stops being greyed out
const PRED_PAIR_WEIGHT = 0.55;   // how far a head-to-head ordering may move an estimate (Day 43)
let predCache=null;
function predIndex(){
  const v=tasteVectors();
  if(predCache && predCache.stamp===v.stamp+":"+pairsRev) return predCache;
  const byDim={};
  for(const dim of TASTE_DIMS){
    const m=new Map();
    for(const r of v.dims[dim.key]||[]) m.set(r.value, r);
    byDim[dim.key]=m;
  }
  predCache={ stamp:v.stamp+":"+pairsRev, byDim, myMean:v.myMean, rated:v.rated };
  return predCache;
}
/* Day 43 folds the head-to-head log in as a second signal. It is deliberately a
   NUDGE, not a term of equal weight: comparisons are sparse, they only ever
   order shows against each other, and a show with two verdicts should not
   outrank the entire taste profile. It moves the estimate toward where the
   ordering puts the show among shows you HAVE scored, and does nothing at all
   when there are no comparisons — which is the "still works with zero pairs"
   half of the acceptance line. */
function pairNudge(id){
  const r=pairRatings().r, mine=r[String(id)];
  if(mine===undefined) return null;
  // Anchor on compared shows that also carry one of your scores. Without at
  // least two anchors there is nothing to interpolate between.
  const anchors=Object.keys(r).filter(k=>k!==String(id) && getRating(k)).map(k=>({elo:r[k], score:getRating(k)}));
  if(anchors.length<2) return null;
  let above=null, below=null;
  for(const a of anchors){
    if(a.elo<=mine && (!above || a.elo>above.elo)) above=a;   // the best show you rank BELOW this one
    if(a.elo>=mine && (!below || a.elo<below.elo)) below=a;   // the worst you rank above it
  }
  if(above && below){
    const span=below.elo-above.elo;
    const t=span>1 ? (mine-above.elo)/span : 0.5;
    return above.score + (below.score-above.score)*t;
  }
  // Outside the anchor range at one end: the nearest anchor is the best claim
  // that can be made, rather than extrapolating off the scale.
  return (above||below).score;
}
// `mdIn` lets a card-weight record from browse or gems be predicted without it
// becoming resolvable by id — see the Discovery block for why those stay apart.
function predictScore(id, mdIn){
  const md=mdIn||findMediaById(id);
  const idx=predIndex();
  if(!md || idx.rated<TASTE_MIN_RATED) return null;
  if(getRating(id)) return null;               // it is rated; there is nothing to predict
  let num=0, den=0, hits=0, covered=0, carried=0;
  for(const dim of TASTE_DIMS){
    const w=PRED_DIM_WEIGHT[dim.key]||0.5, m=idx.byDim[dim.key];
    for(const val of dim.values(md)){
      // Counted whether or not you have an opinion about it. This denominator
      // is the whole point of the confidence score below: a facet you have never
      // rated has to COST certainty, and it can only do that if it is measured.
      carried+=w;
      const row=m.get(val); if(!row) continue;
      // A thin value still counts, but at a fraction — its lift is already
      // shrunk, and this stops six thin tags from outvoting one solid genre.
      const trust=row.thin?0.4:1;
      num+=row.lift*w*trust; den+=w*trust; hits++;
      // How solid this particular facet is, saturating at eight of your shows.
      covered+=w*Math.min(1, row.n/8);
    }
  }
  if(!den) return { score:null, conf:0, hits:0, why:[], reason:"nothing in common" };
  let score=idx.myMean + num/den;
  const nudge=pairNudge(id);
  if(nudge!=null) score = score*(1-PRED_PAIR_WEIGHT*0.5) + nudge*(PRED_PAIR_WEIGHT*0.5);
  score=Math.max(1, Math.min(RATING_MAX, score));

  /* Confidence is a SHARE, not a sum, and that distinction was a real bug before
     it was a comment. Summing "how many facets do I know about" saturated on
     essentially every show — a 40-show library produced 0.91–1.00 across fifty
     predictions, three distinct values, so the number was a badge rather than a
     measurement and Day 42's low-confidence path was unreachable.

     Measuring the weighted share of what the show CARRIES that rests on solid
     evidence fixes it in both directions: a facet you have never rated pulls the
     score down because it is in the denominator, and a facet you have rated
     twice pulls it down because n/8 is a quarter. Library size then scales the
     whole thing, since ten ratings cannot support certainty about anything.

     AND IT IS CALLED EVIDENCE, NOT CERTAINTY, BECAUSE THAT IS WHAT IT MEASURES.
     Tested against a library with a known answer: it correctly collapses to ~0.1
     for a show sharing nothing with anything rated, which is what the refusal
     threshold needs. It does NOT predict how close a given estimate will land —
     splitting fifty predictions at the median confidence gave the same mean
     error on both halves, twice, on two differently-shaped libraries. So the UI
     says "evidence", never "sure": claiming a 92% estimate beats a 70% one would
     be a claim this number has not earned. */
  const share=carried?covered/carried:0;
  const library=Math.min(1, idx.rated/25);
  const conf=Math.round(Math.min(1, share*(0.55+0.45*library))*100)/100;

  /* Day 51: the reasoning is captured, not reconstructed later — each axis that
     moved the estimate, by how much, AND the shows of yours it came from. The
     axis alone ("Psychological +1.42") is a claim about you; the shows behind it
     ("from Monster, Kaiba, Lain") are the evidence for that claim, and Day 52's
     panel is only worth opening because it can show both. */
  const why=[];
  for(const dim of TASTE_DIMS){
    const m=idx.byDim[dim.key];
    for(const val of dim.values(md)){
      const row=m.get(val); if(!row) continue;
      // The three of yours that pull this value hardest in the direction it is
      // pulling — the ones a person would name if asked to justify it.
      const from=(row.ids||[]).slice()
        .sort((a,b)=> row.lift>=0 ? getRating(b)-getRating(a) : getRating(a)-getRating(b))
        .slice(0,3);
      why.push({ dim:dim.key, label:TASTE_BY_KEY[dim.key].label, value:val,
                 lift:row.lift, n:row.n, thin:row.thin, from });
    }
  }
  why.sort((a,b)=>Math.abs(b.lift)-Math.abs(a.lift));
  return { score:Math.round(score*10)/10, conf, hits, why:why.slice(0,6), nudged:nudge!=null };
}
// Day 42: below the floor there is no number, and the panel says what to rate to
// fix it rather than leaving "not enough signal" as a dead end.
const predUsable = p => !!(p && p.score!=null && p.conf>=PRED_LOW_CONF);
/* Day 44: hold out your own ratings and report the error, openly. Every rated
   show is predicted from a profile built WITHOUT it, so the number is an honest
   out-of-sample error rather than the predictor grading its own homework. That
   is the expensive way to do it and the only one worth reporting. */
function predictorBacktest(limit){
  const ids=Object.keys(state.ratings).filter(id=>getRating(id)&&findMediaById(id));
  if(ids.length<TASTE_MIN_RATED+2) return null;
  const sample=shuffled(ids).slice(0, limit||40);
  const saveRatingsRef=state.ratings, results=[];
  for(const id of sample){
    const actual=getRating(id);
    // Rebuild the profile with this one show removed. Slow, and correct.
    const held={...saveRatingsRef}; delete held[id];
    state.ratings=held; ratingsRev++; tasteCache=null; predCache=null;
    const p=predictScore(id);
    if(p && p.score!=null && p.conf>=PRED_LOW_CONF) results.push({id, actual, predicted:p.score, conf:p.conf});
  }
  state.ratings=saveRatingsRef; ratingsRev++; tasteCache=null; predCache=null;
  if(!results.length) return null;
  const err=results.map(r=>Math.abs(r.actual-r.predicted));
  const mean=err.reduce((a,b)=>a+b,0)/err.length;
  const within1=err.filter(e=>e<=1).length/err.length;
  // The number that makes the error meaningful: how well "just guess my average
  // every time" does. A predictor that cannot beat that is not a predictor.
  const base=results.map(r=>Math.abs(r.actual-tasteVectors().myMean));
  const baseMean=base.reduce((a,b)=>a+b,0)/base.length;
  return {
    n:results.length,
    mae:Math.round(mean*100)/100,
    within1:Math.round(within1*100),
    baseline:Math.round(baseMean*100)/100,
    beatsBaseline: mean<baseMean,
  };
}

/* ---------- recommendations (Days 45–49) ----------
   Rank everything the app knows about by predicted score, minus everything you
   have already seen or said no to.

   THE CANDIDATE POOL IS WHAT IS LOADED, and that is a real limit worth stating
   rather than hiding: state.media is the seasons you have browsed plus whatever
   hydration has fetched. So this recommends from a few hundred shows, not from
   AniList's forty thousand. Browsing more seasons genuinely widens it, and the
   panel says so instead of implying it has seen everything. */
function saveRecDismiss(){ bumpWeak(); try{ localStorage.setItem("anical.recno", JSON.stringify([...state.recNo])); }catch(e){} }
function dismissRec(id, why){
  state.recNo.add(String(id));
  saveRecDismiss();
  logActivity(why==="seen"?"add":"drop", id);   // "already seen" is a library fact worth keeping
}
function undismissRec(id){ state.recNo.delete(String(id)); saveRecDismiss(); }
const REC_MODES = {
  // The front door, and the only lens that works from a standing start — it is
  // how the library that every other lens needs actually gets built.
  feed:    { label:"🎞 Feed",     hint:"One at a time. Tell it what you've seen and it goes on your board.", open:true },
  all:     { label:"Everything",  hint:"Ranked by what you'd probably score it." },
  safe:    { label:"Safe bets",   hint:"High predicted score AND plenty of evidence — the ones it is least likely to be wrong about." },
  wild:    { label:"Surprise me", hint:"Deliberately outside the axes you usually watch, with the risk stated." },
  short:   { label:"Short",       hint:"Capped by total runtime, for when you have an evening and no more." },
  // Day 88. Deliberately the one lens that does NOT need a taste profile — see
  // renderRecs, which lets this mode through the gate the others sit behind.
  season:  { label:"Next season", hint:"Everything announced for next season, with an estimate attached wherever there is enough of your library to make one.", open:true },
  // Days 62–64. Grouped by the show in your library each pick resembles most.
  because: { label:"Because you…", hint:"Rows named after a show you loved, are watching or favourited — strongest reason first, weak ones left out." },
};
/* ---------- the feed ----------
   One show at a time, and every answer puts it somewhere. It exists because the
   whole taste arc had a cold start it could not solve on its own: the profile
   needs ratings, the ratings need a rating screen, and "go and score eight
   things" is not a screen. This is.

   IT COLLECTS TWO KINDS OF SIGNAL, deliberately. "Seen it" asks one more
   question — loved / liked / not for me — and writes a real score, which is what
   anchors the whole profile. Everything else writes a status, which reaches the
   vectors as weak signal at a third of the weight. Without the first, a thousand
   swipes would build a huge board and an empty profile; without the second, most
   of what the feed learns would be thrown away. */
const FEED_SCORES = [
  { key:"loved",  label:"Loved it",    score:9, emoji:"🤩" },
  { key:"liked",  label:"Liked it",    score:7, emoji:"🙂" },
  { key:"meh",    label:"Not for me",  score:4, emoji:"😐" },
];
const FEED_SKIP_MAX = 400;   // remembered skips; a guard on the key, not a design limit
const FEED_TILT = 0.55;      // how hard the profile is allowed to steer the sampler
function saveFeedSkips(){
  try{ localStorage.setItem("anical.feedskip", JSON.stringify([...state.feedSkip].slice(-FEED_SKIP_MAX))); }catch(e){}
}
/* Everything the feed could show: loaded, not already yours, not dismissed, not
   already skipped, and not filtered out by your own content settings. */
function feedPool(){
  const out=[], seen=new Set();
  for(const md of [...state.media, ...state.extra.values()]){
    const id=String(md.id);
    if(seen.has(id)) continue; seen.add(id);
    if(state.watch.has(id) || getRating(id)) continue;   // already on your board or scored
    if(state.recNo.has(id) || state.feedSkip.has(id)) continue;
    if(isHidden(id) || excluded(md)) continue;
    out.push(md);
  }
  return out;
}
/* Weighted random, not uniform — and this is the part that decides whether the
   feed is usable at all. Uniform over a few hundred titles serves mostly obscure
   ones, and "have you seen this?" is unanswerable about a show you have never
   heard of, so every card would cost a skip. Popularity (square-rooted, to
   compress a very long tail) makes the early feed recognisable; once there is a
   profile, a predicted score above your average tilts it toward things you would
   plausibly want. Recognisable first, personal later. */
/* `mean` is passed in rather than read here because this runs once per pool
   entry — a few thousand times per served card — and tasteVectors() rebuilds
   its cache stamp on every call. */
function feedWeight(md, mean){
  const pop=Math.sqrt(Math.max(1, md.popularity||1));
  if(mean==null) return pop;
  const p=predictScore(String(md.id));
  if(!predUsable(p)) return pop;
  const over=Math.max(0, p.score - mean);
  return pop * (1 + over*FEED_TILT);
}
function feedPick(pool){
  pool=pool||feedPool();
  if(!pool.length) return null;
  const mean=tasteReady()?tasteVectors().myMean:null;
  let total=0; const w=pool.map(md=>{ const x=feedWeight(md, mean); total+=x; return x; });
  let r=Math.random()*total;
  for(let i=0;i<pool.length;i++){ r-=w[i]; if(r<=0) return pool[i]; }
  return pool[pool.length-1];
}
/* Serve the next card, and widen the pool before it runs dry rather than after.
   fetchSeasonless() is the app's existing "everything without a season" set, so
   this costs one cached request and no new plumbing.

   The two guards below are what keep "the pool is empty" from becoming an
   infinite loop. fetchSeasonless() memoises into state.seasonCache, so from the
   second call on it resolves immediately and adds nothing: with a pool that
   stays under 25 (everything loaded is already watched, rated, dismissed or
   skipped) the re-render below called straight back into feedServe, which
   widened again, which re-rendered — a busy loop rebuilding the whole feed
   panel every ~25ms until the tab ran out of memory. `feedWidened` makes the
   widening a once-per-session thing, which is all a memoised fetch can ever be
   worth, and `added` means a re-render only happens when the pool actually
   grew. Either alone closes the loop; they say different things, so both stay. */
let feedWidening=false, feedWidened=false;
function feedServe(){
  const pool=feedPool();
  if(pool.length<25 && !feedWidening && !feedWidened){
    feedWidening=true;
    fetchSeasonless().then(list=>{
      let added=0;
      for(const md of (list||[])) if(!state.extra.has(String(md.id))){ state.extra.set(String(md.id), md); added++; }
      feedWidening=false; feedWidened=true;
      if(added && state.viewMode==="recs" && state.recMode==="feed" && !state.feedCard) renderRecs();
    }).catch(()=>{ feedWidening=false; feedWidened=true; });
  }
  state.feedCard=feedPick(pool);   // the pool we already walked, not a second sweep of the library
  state.feedAsk=null;   // a new card is never mid-question
  return state.feedCard;
}
/* One place records an answer, so the undo, the activity log and the counter
   cannot disagree about what a swipe was. Returns what it takes to reverse it. */
function feedAnswer(id, kind, score){
  id=String(id);
  const before={ status: state.status[id]||null, rating:getRating(id), axes:getAxes(id),
                 watched: state.watch.has(id), dismissed: state.recNo.has(id), skipped: state.feedSkip.has(id) };
  if(kind==="skip"){ state.feedSkip.add(id); saveFeedSkips(); }
  else if(kind==="no"){ dismissRec(id,"no"); }
  else if(kind==="seen"){ setStatusOf(id,"completed"); if(score) setRating(id, score); }
  else setStatusOf(id, kind);          // watching | plan | dropped
  state.feedCount=(state.feedCount||0)+1;
  return before;
}
function feedUndo(id, before){
  id=String(id);
  if(before.skipped===false) state.feedSkip.delete(id);
  if(before.dismissed===false) state.recNo.delete(id);
  saveFeedSkips(); saveRecDismiss();
  restoreRating(id, before.rating, before.axes);
  setStatusOf(id, before.status, {stamp:false});
  if(!before.watched){ state.watch.delete(id); localStorage.setItem("anical.watch", JSON.stringify([...state.watch])); }
  state.feedCount=Math.max(0,(state.feedCount||1)-1);
}

/* ---------- next season's lineup (Day 88) ----------
   The only page in the app that is worth opening with an empty library: it is a
   real answer to "what is coming" on its own, and it gains a predicted score per
   title the moment you have rated enough to support one. Fetched through the
   same cached fetchSeason() the calendar uses, so a visit costs at most one
   request and usually none. */
function nextSeasonOf(d){
  const now=d||new Date();
  const order=["WINTER","SPRING","SUMMER","FALL"];
  let i=order.indexOf(seasonOf(now.getMonth()))+1, year=now.getFullYear();
  if(i>3){ i=0; year++; }
  return { season:order[i], year };
}
let seasonPreview=null, seasonPreviewKey=null, seasonPreviewErr=null;
async function loadSeasonPreview(){
  const {season,year}=nextSeasonOf();
  const key=season+"-"+year;
  if(seasonPreviewKey===key && (seasonPreview||seasonPreviewErr)) return seasonPreview;
  seasonPreviewKey=key; seasonPreviewErr=null;
  try{
    const media=await fetchSeason(season,year);
    seasonPreview=Array.isArray(media)?media:[];
  }catch(err){ seasonPreview=null; seasonPreviewErr=err&&err.message||"could not load"; }
  if(state.viewMode==="recs" && state.recMode==="season") renderRecs();
  return seasonPreview;
}
/* Ranked by predicted score when there is a profile, and by popularity when
   there isn't — so the page is ordered by SOMETHING useful either way rather
   than falling back to whatever order the API returned. */
function seasonPreviewRows(){
  const list=seasonPreview||[];
  const ready=tasteReady();
  const rows=[];
  for(const md of list){
    if(excluded(md)) continue;
    const id=String(md.id);
    const p=ready?predictScore(id):null;
    rows.push({ id, md, score:p&&p.score!=null?p.score:null, conf:p?p.conf:0,
                usable:predUsable(p), why:p?p.why:[], mine:getRating(id)||null,
                ...(ready?recNovelty(md):{novelty:0,departs:[]}) });
  }
  rows.sort((a,b)=>{
    const as=a.usable?a.score:null, bs=b.usable?b.score:null;
    if(as!=null && bs!=null) return bs-as || b.conf-a.conf;
    if(as!=null) return -1;
    if(bs!=null) return 1;
    return (b.md.popularity||0)-(a.md.popularity||0);
  });
  return rows;
}
const REC_SHORT_CAP_MIN = 6*60;   // "six hours and no more" — the Day 50 brief, in minutes
function recRuntime(md){
  const eps=epTotal(md)||md.episodes||0, dur=md.duration||24;
  return eps?eps*dur:dur;
}
/* How far outside your usual axes a show sits: the share of what it carries that
   you have NO opinion about, plus how much of what you do recognise you dislike.
   Day 49's "states which axis it departs from" is the second return value. */
function recNovelty(md){
  const idx=predIndex();
  let known=0, total=0, neg=[];
  for(const dim of TASTE_DIMS){
    const m=idx.byDim[dim.key];
    for(const val of dim.values(md)){
      total++;
      const row=m.get(val);
      if(row){ known++; if(row.lift<-0.15) neg.push({label:TASTE_BY_KEY[dim.key].label, value:val, lift:row.lift}); }
    }
  }
  neg.sort((a,b)=>a.lift-b.lift);
  return { novelty: total?1-(known/total):1, departs:neg.slice(0,2), total };
}
function recommendations(mode, opts){
  opts=opts||{};
  if(!tasteReady()) return { ready:false, rows:[], pool:0 };
  const seen=new Set([...state.watch].map(String));
  const out=[];
  const pool=[...state.media, ...state.extra.values()];
  const dedupe=new Set();
  for(const md of pool){
    const id=String(md.id);
    if(dedupe.has(id)) continue; dedupe.add(id);
    if(seen.has(id)) continue;                 // already in your library
    if(getRating(id)) continue;                // …or rated without being tracked
    if(isHidden(id)) continue;
    if(state.recNo.has(id)) continue;          // Day 54: dismissed, permanently
    if(excluded(md)) continue;                 // honours NSFW / donghua settings
    if(opts.airingOnly && md.status!=="RELEASING") continue;
    if(opts.genre && !(md.genres||[]).includes(opts.genre)) continue;
    if(opts.maxRuntime && recRuntime(md)>opts.maxRuntime) continue;
    const p=predictScore(id);
    if(!predUsable(p)) continue;
    const nov=recNovelty(md);
    out.push({ id, md, ...p, ...nov });
  }
  let rows=out;
  if(mode==="safe")  rows=out.filter(r=>r.conf>=PRED_GOOD_CONF && r.score>=tasteVectors().myMean);
  if(mode==="wild")  rows=out.filter(r=>r.novelty>=0.35 || r.departs.length);
  if(mode==="short") rows=out.filter(r=>recRuntime(r.md)<=(opts.maxRuntime||REC_SHORT_CAP_MIN));
  // Ranked by predicted score, then by confidence — a 8.4 it is sure about beats
  // an 8.4 it is guessing at, and the order is stable between paints because the
  // final tie-break is the id.
  rows=rows.slice().sort((a,b)=> b.score-a.score || b.conf-a.conf || (a.id<b.id?-1:1));
  if(mode==="wild") rows=rows.slice().sort((a,b)=> b.novelty-a.novelty || b.score-a.score);
  return { ready:true, rows, pool:dedupe.size, mode };
}

/* ---------- custom collections ("Lists") ----------
   Your own named lists, independent of the five watch statuses: a show can sit
   in any number of them (or none), and the order of both the lists and the
   shows inside them is yours. Stored locally like everything else. */
const COLLECTION_NAME_MAX = 40;
function saveCollections(){ localStorage.setItem("anical.collections", JSON.stringify(state.collections)); }
function collectionById(id){ return state.collections.find(c=>c.id===String(id))||null; }
function cleanCollectionName(name){ return String(name==null?"":name).replace(/\s+/g," ").trim().slice(0,COLLECTION_NAME_MAX); }
function createCollection(name){
  const clean=cleanCollectionName(name); if(!clean) return null;
  const col={id:"c"+Date.now().toString(36)+Math.random().toString(36).slice(2,6), name:clean, ids:[]};
  state.collections.push(col); saveCollections();
  return col;
}
function renameCollection(id, name){
  const col=collectionById(id), clean=cleanCollectionName(name);
  if(!col||!clean) return false;
  col.name=clean; saveCollections(); return true;
}
// Returns what was removed (plus where it sat) so the Undo toast can put it back.
function deleteCollection(id){
  const i=state.collections.findIndex(c=>c.id===String(id));
  if(i<0) return null;
  const col=state.collections[i];
  state.collections.splice(i,1); saveCollections();
  return {index:i, col};
}
function restoreCollection(index, col){
  state.collections.splice(Math.max(0,Math.min(index,state.collections.length)),0,col);
  saveCollections();
}
function moveCollection(id, dir){
  const i=state.collections.findIndex(c=>c.id===String(id)), j=i+dir;
  if(i<0||j<0||j>=state.collections.length) return false;
  const [col]=state.collections.splice(i,1);
  state.collections.splice(j,0,col); saveCollections(); return true;
}
function inCollection(colId, mediaId){
  const col=collectionById(colId);
  return !!col && col.ids.indexOf(String(mediaId))>=0;
}
function collectionsOf(mediaId){ const m=String(mediaId); return state.collections.filter(c=>c.ids.indexOf(m)>=0); }
function addToCollection(colId, mediaId){
  const col=collectionById(colId), m=String(mediaId);
  if(!col || col.ids.indexOf(m)>=0) return false;
  col.ids.push(m); saveCollections(); tungTask("list"); return true;
}
function removeFromCollection(colId, mediaId){
  const col=collectionById(colId), m=String(mediaId);
  if(!col) return false;
  const i=col.ids.indexOf(m); if(i<0) return false;
  col.ids.splice(i,1); saveCollections(); return true;
}
function toggleInCollection(colId, mediaId){
  return inCollection(colId, mediaId) ? (removeFromCollection(colId, mediaId), false)
                                      : (addToCollection(colId, mediaId), true);
}
/* Move between columns in the Lists view. "" means the un-listed column, so
   dragging out of a list and back to "Not in a list" both go through here. */
function moveBetweenCollections(mediaId, fromId, toId){
  if(String(fromId||"")===String(toId||"")) return false;
  if(fromId) removeFromCollection(fromId, mediaId);
  if(toId) addToCollection(toId, mediaId);
  return true;
}
/* Chips in the detail pop-up: one per list, plus a "new list" that also adds
   the show you're looking at. */
function collectionPickerHtml(id){
  const sid=esc(String(id));
  const chips=state.collections.map(c=>{
    const on=inCollection(c.id, id);
    return `<button type="button" class="st-chip${on?" on":""}" data-col="${esc(c.id)}|${sid}" aria-pressed="${on?"true":"false"}" title="${on?"Remove from "+esc(c.name):"Add to "+esc(c.name)}">${on?"✓ ":""}${esc(c.name)}</button>`;
  }).join("");
  return `<div class="st-pick" data-col-pick="${sid}" role="group" aria-label="Your lists">${chips}
    <button type="button" class="st-chip" data-col-new="${sid}" title="Make a new list with this show in it">＋ New list</button>
  </div>`;
}
function refreshCollectionPickers(id){
  document.querySelectorAll('[data-col-pick="'+CSS.escape(String(id))+'"]').forEach(el=>{
    el.outerHTML=collectionPickerHtml(id);
  });
}
/* transient confirmation, with a one-click action — Undo for status changes,
   and anything else the caller names (the skin preview uses "Stop preview"). */
let toastTimer=null, toastUndo=null;
function toast(msg, undo, label){
  let el=$("toast");
  if(!el){ el=document.createElement("div"); el.id="toast"; el.className="toast"; el.setAttribute("role","status"); document.body.appendChild(el); }
  toastUndo=undo||null;
  el.innerHTML=`<span>${esc(msg)}</span>`+(undo?`<button type="button" id="toastUndo">${esc(label||"↩ Undo")}</button>`:"");
  el.classList.add("on");
  if(undo) $("toastUndo").onclick=()=>{ const u=toastUndo; hideToast(); if(u) u(); };
  clearTimeout(toastTimer);
  toastTimer=setTimeout(hideToast, undo?6000:2600);   // six seconds to change your mind
}
function hideToast(){ const el=$("toast"); if(el) el.classList.remove("on"); toastUndo=null; }
/* Send the user to the one place shows are added from. */
function focusSearch(){
  const el=$("fSearch"); if(!el) return;
  window.scrollTo({top:0,behavior:"smooth"});
  el.focus(); el.select();
}
/* episode progress ("mark watched" + Continue Watching) */
function getProgress(id){ return state.progress[String(id)]||0; }
/* The only writer of anical.progress outside a full-list import. Everything that
   moves progress — the schedule rows, the +1 / caught-up counter, the airing
   sweep — comes through here, so the AniList queue and the ceiling below are
   impossible to route around. */
function setProgress(id,ep){
  id=String(id); ep=Math.max(0,ep|0);
  const total=epTotal(findMediaById(id));
  if(total) ep=Math.min(ep,total);   // never past the last episode
  const before=state.progress[id]||0;
  if(ep) state.progress[id]=ep; else delete state.progress[id];
  localStorage.setItem("anical.progress", JSON.stringify(state.progress));
  if(total && ep>=total && before<total) countRun(id);   // a run just reached the end
  if(ep) alEnqueue(id);
  if(ep>before) tungTask("progress");   // a daily task, credited where the thing happens
  // Day 31: episodes are summed, not counted as events, so typing "12" into the
  // counter records twelve episodes rather than one thing happening.
  if(ep>before) logActivity("ep", id, ep-before);
}
function maxAiredEp(md){ const now=Date.now()/1000; let m=0; for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]) if(n.airingAt<=now && n.episode>m) m=n.episode; return m; }
// When one specific episode aired, read from the same node maxAiredEp reads —
// so the thing that decides an episode is available and the thing that dates it
// in the Next up rail can never disagree.
function epAiredAt(md,ep){
  for(const n of (md&&md.airingSchedule&&md.airingSchedule.nodes)||[]) if(n.episode===ep) return n.airingAt;
  return 0;
}
/* How many episodes you could watch right now. Not the same question as
   maxAiredEp: AniList drops the airingSchedule entirely on shows that finished
   years ago, so a 2013 series you are five episodes into reports zero aired and
   silently vanishes from the Next up rail — the exact show the rail exists for.
   Once a broadcast is FINISHED the announced episode count *is* the aired count,
   so the two agree wherever both are known.

   Deliberately not wired into the counter row or the airing sweep. Both use
   maxAiredEp to mean "aired, right now, on the live schedule", and opting a
   finished show into auto-progress would mark its whole back catalogue watched
   on the first sweep. */
function availableEp(md){
  const aired=maxAiredEp(md);
  return (md&&md.status==="FINISHED") ? Math.max(aired, epTotal(md)) : aired;
}

/* ---------- rewatches ----------
   anical.rewatch counts *completed runs*, not rewatches: 1 is "watched once", 2
   is "watched once and rewatched once". Counting runs in a key of their own is
   what makes Reset harmless — clearing progress throws away where you are and
   keeps what you have finished, which is exactly the difference between the two.
   A run is counted on the transition into the last episode, so clicking +1 again
   at the end, or the airing sweep passing back over a finished show, cannot
   inflate it. */
function runsOf(id){ return +state.rewatch[String(id)]||0; }
function rewatchCount(id){ return Math.max(0, runsOf(id)-1); }
function countRun(id){
  id=String(id);
  state.rewatch[id]=runsOf(id)+1;
  try{ localStorage.setItem("anical.rewatch", JSON.stringify(state.rewatch)); }catch(e){}
}
/* How many episodes a show has, or 0 when nobody knows yet. AniList leaves
   `episodes` null on anything still airing without an announced count, so the
   schedule's own highest episode is the fallback — and a currently-airing show
   that has neither is genuinely uncountable, which the callers handle. */
function epTotal(md){
  if(!md) return 0;
  if(md.episodes>0) return md.episodes;
  let m=0; for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]) if(n.episode>m) m=n.episode;
  return m;
}

/* ---------- auto-progress from airing (opt-in, per show) ----------
   A show is opted in when its id is a key in state.autoProg; the value is the
   highest *aired* episode the sweep has already accounted for. Storing that,
   rather than simply pushing progress up to whatever has aired, is what lets a
   manual correction stick: unmark episode 8 and the sweep leaves it alone until
   episode 9 actually airs.

   Opting in stamps the current aired episode instead of marking the back
   catalogue watched — this feature is "mark them as they air", and retroactively
   completing a show nobody has watched would be the opposite of that. */
function autoProgOn(id){ return Object.prototype.hasOwnProperty.call(state.autoProg, String(id)); }
function saveAutoProg(){ try{ localStorage.setItem("anical.autoprog", JSON.stringify(state.autoProg)); }catch(e){} }
function setAutoProg(id,on){
  id=String(id);
  if(on) state.autoProg[id]=maxAiredEp(findMediaById(id)||{});
  else delete state.autoProg[id];   // freezes where it is; progress is untouched
  saveAutoProg();
}
// Runs before every render. Cheap: it walks the opted-in shows only, and writes
// nothing unless an episode has aired since the last pass.
function sweepAutoProgress(){
  const moved=[];
  for(const id of Object.keys(state.autoProg)){
    const md=findMediaById(id); if(!md) continue;               // not loaded yet — try again next render
    const aired=maxAiredEp(md), seen=+state.autoProg[id]||0;
    if(aired<=seen) continue;
    state.autoProg[id]=aired;
    if(aired>getProgress(id)){ setProgress(id,aired); moved.push({md,ep:getProgress(id)}); }
  }
  if(!moved.length) return false;
  saveAutoProg();
  const first=moved[0];
  toast(moved.length===1
    ? `Marked watched · ${title(first.md)} ep ${first.ep}`
    : `Marked watched · ${moved.length} shows caught up automatically`);
  return true;
}

/* The counter itself, in the detail pop-up's Overview — the fast path that the
   schedule list isn't. Marking a run of episodes used to mean opening the
   Schedule tab and finding the right row; this is the same write, one click
   away from where the show opens. */
function progressRowHtml(md){
  const id=String(md.id), p=getProgress(id), total=epTotal(md), aired=maxAiredEp(md);
  if(!total && !p && !aired) return "";   // nothing aired, no count — nothing to count against
  const auto=autoProgOn(id);
  const atEnd=!!total && p>=total;
  const caught=aired>0 && p>=aired;
  const rw=rewatchCount(id);
  const hint = auto
    ? "On: each new episode marks itself watched once it airs. Turning this off freezes the counter where it is — nothing you've already watched is lost."
    : "Type an episode number and press Enter to jump straight to it, or step with the buttons. It never counts past the last episode that has aired. Syncs to AniList when your account is connected."
      + (runsOf(id) ? " Finishing it again adds to your rewatch count, and Reset never touches that." : "");
  return `<div class="st-row pg-row">
    <span class="st-row-label">▶ Watched up to:</span>
    <div class="pg-ctl">
      <button type="button" class="pg-btn" data-prog="${id}|dec" title="Back one episode" aria-label="One episode back"${p<=0?" disabled":""}>−</button>
      <input type="number" class="pg-num" data-prognum="${id}" value="${p}" min="0"${total?` max="${total}"`:""} step="1"
        inputmode="numeric" aria-label="Episode you have watched up to" title="Type the episode you're on, then press Enter">
      <span class="pg-count" aria-live="polite">${total?`of ${total}`:`<small>episodes watched</small>`}</span>
      <button type="button" class="pg-btn" data-prog="${id}|inc" title="Mark the next episode watched" aria-label="One episode forward"${atEnd?" disabled":""}>+1</button>
      <button type="button" class="pg-btn wide" data-prog="${id}|max" title="Mark everything that has aired as watched"${(!aired||caught)?" disabled":""}>✓ Caught up${aired?` (ep ${aired})`:""}</button>
      ${p?`<button type="button" class="pg-btn" data-prog="${id}|zero" title="Clear progress for this show">Reset</button>`:""}
      ${rw?`<span class="pill pg-rw" title="You've finished this show ${rw+1} times">↻ ${rw} rewatch${rw===1?"":"es"}</span>`:""}
    </div>
    ${progressBarHtml(md,true)}
    <label class="pg-auto"><input type="checkbox" data-autoprog="${id}"${auto?" checked":""}> Mark episodes watched as they air</label>
    <span class="st-hint">${hint}</span>
  </div>`;
}
/* The same progress, as a fill — under every card (Day 09) and inside the
   counter row. A show whose episode count nobody knows yet gets the number
   instead of a bar: a fill needs a denominator, and inventing one would read as
   "nearly finished" on a show that has fifty episodes left. */
function progressBarHtml(md,wide){
  const p=getProgress(md.id); if(!p) return "";
  const total=epTotal(md);
  const cls="pg-bar"+(wide?" wide":"")+(total?"":" na");
  if(!total) return `<span class="${cls}" role="img" aria-label="${p} episodes watched, total unknown" title="${p} watched · total episode count unknown"><b>${p}</b></span>`;
  const pct=Math.max(0,Math.min(100,Math.round(p/total*100)));
  return `<span class="${cls}" role="img" aria-label="${p} of ${total} episodes watched" title="${p} of ${total} watched" style="--pct:${pct}%"><i></i></span>`;
}
/* recently viewed */
function pushRecent(md){
  const id=String(md.id);
  state.recent=(state.recent||[]).filter(r=>r&&String(r.id)!==id);
  state.recent.unshift({id, t:title(md), img:(md.coverImage&&md.coverImage.medium)||""});
  if(state.recent.length>24) state.recent.length=24;
  localStorage.setItem("anical.recent", JSON.stringify(state.recent));
}

/* ---------- seasons ---------- */
function seasonOf(m){ return m<=2?"WINTER":m<=5?"SPRING":m<=8?"SUMMER":"FALL"; }
function prevSeason(season,year){
  const o=["WINTER","SPRING","SUMMER","FALL"], i=o.indexOf(season);
  return i===0?{season:"FALL",year:year-1}:{season:o[i-1],year};
}
function seasonsForRange(start,end){
  const map=new Map();
  let d=new Date(start.getFullYear(),start.getMonth(),1);
  const last=new Date(end.getFullYear(),end.getMonth(),1);
  while(d<=last){ const s=seasonOf(d.getMonth()); map.set(s+"-"+d.getFullYear(),{season:s,year:d.getFullYear()}); d.setMonth(d.getMonth()+1); }
  const first=[...map.values()][0];
  const p=prevSeason(first.season,first.year); map.set(p.season+"-"+p.year,p);
  return [...map.values()];
}

const QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id title { romaji english native } format episodes genres status popularity trending averageScore source isAdult countryOfOrigin tags { name rank isMediaSpoiler isAdult }
      description(asHtml: false) siteUrl trailer { id site }
      externalLinks { site url type color icon }
      coverImage { medium large color }
      startDate { year month day }
      season seasonYear
      studios(isMain: true) { nodes { name } }
      relations { edges { relationType(version: 2) node { id type format title { romaji english native } coverImage { medium } startDate { year month day } } } }
      airingSchedule { nodes { airingAt episode } }
    }
  }
}`;

// AniList leaves season/seasonYear null on a slice of what is actually airing —
// Korean and Chinese productions, and long-running ONAs with no Japanese
// broadcast season. QUERY above filters *by* season, so those shows match none
// of the three seasons a range loads and were missing from every view. This is
// the same supplementary pull the server does (_lib/catalog.mjs), kept here so
// the AniList fallback path has no blind spot the API path doesn't.
const AIRING_QUERY = QUERY
  .replace("query ($season: MediaSeason, $seasonYear: Int, $page: Int)", "query ($page: Int)")
  .replace("media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC)", "media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC)");

// Global title search — covers ALL of AniList, not just the loaded seasons.
const SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 12) {
    media(type: ANIME, search: $search, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
      id title { romaji english native } format episodes genres status popularity trending averageScore source isAdult countryOfOrigin tags { name rank isMediaSpoiler isAdult }
      description(asHtml: false) siteUrl trailer { id site }
      externalLinks { site url type color icon }
      coverImage { medium large color }
      startDate { year month day }
      studios(isMain: true) { nodes { name } }
      relations { edges { relationType(version: 2) node { id type format title { romaji english native } coverImage { medium } startDate { year month day } } } }
      airingSchedule { nodes { airingAt episode } }
    }
  }
}`;

// Fetch one title by AniList id — used by ?show=<id> deep links for shows
// that aren't in the currently loaded seasons.
const ID_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id title { romaji english native } format episodes genres status popularity trending averageScore source isAdult countryOfOrigin tags { name rank isMediaSpoiler isAdult }
    description(asHtml: false) siteUrl trailer { id site }
    externalLinks { site url type color icon }
    coverImage { medium large color }
    startDate { year month day }
    studios(isMain: true) { nodes { name } }
    relations { edges { relationType(version: 2) node { id type format title { romaji english native } coverImage { medium } startDate { year month day } } } }
    airingSchedule { nodes { airingAt episode } }
  }
}`;
async function fetchMediaById(id){
  // Our catalog first (see TSUZUKI_API), AniList only if it can't answer.
  const ours=await apiGet(`/anime/${encodeURIComponent(id)}?full=1`);
  if(ours&&ours.media) return ours.media;
  const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({query:ID_QUERY,variables:{id:+id}})});
  if(!res.ok) throw new Error("AniList HTTP "+res.status);
  const j=await res.json(); if(j.errors) throw new Error(j.errors[0].message);
  return j.data.Media;
}

// Import a user's PUBLIC AniList anime list (no auth/key needed). Watching/Planning/
// Paused/Rewatching go into the ⭐ list — each keeping its AniList status, so the board
// comes across as-is; episode progress is applied from every entry so "Continue watching"
// and the mark-watched ticks reflect where you left off, and personal scores come across
// as your 1–10 rating whatever scoring system the account uses.
const LIST_QUERY=`
query ($name: String) {
  MediaListCollection(userName: $name, type: ANIME) {
    user { mediaListOptions { scoreFormat } }
    lists { entries { status progress score media { id } } }
  }
}`;
const WATCH_STATUSES=new Set(["CURRENT","PLANNING","PAUSED","REPEATING"]);
const AL_STATUS_MAP={CURRENT:"watching", REPEATING:"watching", PLANNING:"plan", PAUSED:"onhold", DROPPED:"dropped", COMPLETED:"completed"};
// AniList accounts score on one of five scales — normalise them all to our 1–10.
// 0 means "not scored", which stays unrated here.
function alScoreTo10(score, format){
  const n=+score; if(!n || n<=0) return 0;
  let out;
  switch(format){
    case "POINT_100": out=n/10; break;
    case "POINT_5":   out=n*2; break;
    case "POINT_3":   out={1:3,2:6,3:10}[Math.round(n)]||0; break;   // 🙁 😐 🙂
    default:          out=n; break;                                  // POINT_10, POINT_10_DECIMAL
  }
  return Math.max(1, Math.min(10, Math.round(out)));
}
async function importAniList(name){
  name=String(name||"").trim();
  if(!name) throw new Error("Enter your AniList username.");
  const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({query:LIST_QUERY,variables:{name}})});
  const j=await res.json();
  if(j.errors) throw new Error(j.errors[0].message==="User not found"||/not found/i.test(j.errors[0].message)
    ? `No public AniList user "${name}" (check the spelling; the list must be public).` : j.errors[0].message);
  const coll=(j.data&&j.data.MediaListCollection)||{};
  const lists=coll.lists||[];
  const fmt=(coll.user&&coll.user.mediaListOptions&&coll.user.mediaListOptions.scoreFormat)||"POINT_10";
  let added=0, progressed=0, rated=0;
  for(const l of lists) for(const e of l.entries||[]){
    const id=e.media&&e.media.id; if(!id) continue;
    if(WATCH_STATUSES.has(e.status)){
      if(!state.watch.has(String(id))){ state.watch.add(String(id)); added++; }
      state.status[String(id)]=AL_STATUS_MAP[e.status]||DEFAULT_STATUS;   // mirror AniList onto the board
    }
    if(e.progress>0){ state.progress[String(id)]=Math.max(state.progress[String(id)]||0, e.progress); progressed++; }
    const score=alScoreTo10(e.score, fmt);
    if(score){ state.ratings[String(id)]=score; rated++; }   // your AniList score becomes your rating
  }
  localStorage.setItem("anical.watch", JSON.stringify([...state.watch]));
  localStorage.setItem("anical.status", JSON.stringify(state.status));
  localStorage.setItem("anical.progress", JSON.stringify(state.progress));
  saveRatings();
  migrateRatingAxes();   // an imported score is a flat five, same as any pre-axes one
  document.querySelectorAll("[data-watch]").forEach(el=>setStar(el, state.watch.has(el.dataset.watch)));
  renderView();
  return { added, progressed, rated, total: lists.reduce((n,l)=>n+(l.entries?l.entries.length:0),0) };
}

/* ---------- AniList account sync (two-way) ----------
   The username import above is read-only and only sees a *public* list. This
   is the connected version: OAuth implicit grant, so private entries come
   across and local changes go back the other way.

   Implicit grant (response_type=token) rather than the code flow on purpose —
   the code flow needs a client secret, a secret needs a server to hold it, and
   the whole point of this app is that there isn't one. The token lives in this
   browser and never leaves it except to talk to AniList.

   The client id is public by design — it travels in the authorize URL every
   time anyone signs in. There is no secret here to leak, which is the whole
   reason the implicit flow was chosen. Registered at
   https://anilist.co/settings/developer; the Redirect URL set on that
   registration decides where sign-in returns to (see alBeginConnect).
   Left empty, the connect UI explains that instead of half-working.           */
const ANILIST_CLIENT_ID = "47767";
const AL_TOKEN_KEY="anical.al.token", AL_EXP_KEY="anical.al.exp", AL_USER_KEY="anical.al.user";
const AL_AUTO_KEY="anical.al.auto", AL_QUEUE_KEY="anical.al.queue";
// Our board statuses -> AniList's. "watching" maps to CURRENT rather than
// REPEATING: we track rewatches separately and guessing would overwrite it.
const AL_STATUS_OUT={watching:"CURRENT", plan:"PLANNING", onhold:"PAUSED", dropped:"DROPPED", completed:"COMPLETED"};

const alState={ token:null, exp:0, user:null, queue:[], busy:false, syncing:false, lastError:null };
try{
  alState.token=localStorage.getItem(AL_TOKEN_KEY)||null;
  alState.exp=+(localStorage.getItem(AL_EXP_KEY)||0);
  alState.user=JSON.parse(localStorage.getItem(AL_USER_KEY)||"null");
  alState.queue=JSON.parse(localStorage.getItem(AL_QUEUE_KEY)||"[]")||[];
}catch(e){}

function alConfigured(){ return !!ANILIST_CLIENT_ID; }
function alTokenValid(){ return !!alState.token && (!alState.exp || Date.now()<alState.exp); }
function alConnected(){ return alTokenValid() && !!alState.user; }
function alAutoSync(){ return localStorage.getItem(AL_AUTO_KEY)!=="0"; }
function alSaveQueue(){ try{ localStorage.setItem(AL_QUEUE_KEY, JSON.stringify(alState.queue)); }catch(e){} }
function alDisconnect(){
  alState.token=null; alState.exp=0; alState.user=null; alState.queue=[]; alState.lastError=null;
  for(const k of [AL_TOKEN_KEY,AL_EXP_KEY,AL_USER_KEY,AL_QUEUE_KEY]) localStorage.removeItem(k);
}
function alBeginConnect(){
  if(!alConfigured()) return;
  // No redirect_uri on purpose. AniList matches it against the app's registered
  // Redirect URL exactly, so sending one means a trailing slash or a stray
  // query string turns sign-in into an error page. Omitted, AniList just uses
  // the registered URL — which is the only one that can ever be right.
  //
  // The token comes back in the URL *fragment*, so it is never sent to a server
  // — not to Netlify, not into its logs. alCaptureToken() takes it from there.
  location.href="https://anilist.co/api/v2/oauth/authorize?client_id="+
    encodeURIComponent(ANILIST_CLIENT_ID)+"&response_type=token";
}
// Called once on boot: pick the token out of the fragment and scrub it from the
// address bar so it can't be shared or land in history.
function alCaptureToken(){
  if(!location.hash || location.hash.indexOf("access_token=")<0) return false;
  const h=new URLSearchParams(location.hash.slice(1));
  const tok=h.get("access_token");
  if(!tok) return false;
  alState.token=tok;
  alState.exp=Date.now()+(+(h.get("expires_in")||0)*1000 || 365*24*3600*1000);
  try{
    localStorage.setItem(AL_TOKEN_KEY,tok);
    localStorage.setItem(AL_EXP_KEY,String(alState.exp));
  }catch(e){}
  try{ history.replaceState(null,"",location.pathname+location.search); }catch(_){ location.hash=""; }
  return true;
}
async function alQuery(query, variables){
  if(!alTokenValid()) throw new Error("Not connected to AniList.");
  const res=await fetch(API,{method:"POST",headers:{
    "Content-Type":"application/json", Accept:"application/json", Authorization:"Bearer "+alState.token}, body:JSON.stringify({query,variables})});
  if(res.status===401){ alDisconnect(); throw new Error("AniList sign-in expired — connect again."); }
  if(res.status===429){ const e=new Error("AniList rate limit"); e.retryAfter=+(res.headers.get("retry-after"))||60; e.rateLimited=true; throw e; }
  const j=await res.json().catch(()=>({}));
  if(j.errors) throw new Error(j.errors[0].message);
  if(!res.ok) throw new Error("AniList HTTP "+res.status);
  return j.data;
}
const AL_VIEWER_QUERY=`query{ Viewer{ id name avatar{ medium } mediaListOptions{ scoreFormat } } }`;
async function alFetchViewer(){
  const d=await alQuery(AL_VIEWER_QUERY,{});
  alState.user=d&&d.Viewer||null;
  try{ localStorage.setItem(AL_USER_KEY, JSON.stringify(alState.user)); }catch(e){}
  return alState.user;
}

// Pull: AniList wins. This is an explicit action, so "the server is right" is
// the only policy that isn't surprising — the local copy is what gets rebuilt.
const AL_PULL_QUERY=`
query ($userId: Int) {
  MediaListCollection(userId: $userId, type: ANIME) {
    lists { entries { id mediaId status progress score(format: POINT_100) } }
  }
}`;
async function alPull(){
  if(!alConnected()) throw new Error("Connect your AniList account first.");
  alState.syncing=true;   // stop the change hooks from echoing every write back
  try{
    const d=await alQuery(AL_PULL_QUERY,{userId:alState.user.id});
    const lists=(d&&d.MediaListCollection&&d.MediaListCollection.lists)||[];
    let added=0, progressed=0, rated=0, total=0;
    for(const l of lists) for(const e of l.entries||[]){
      const id=e&&e.mediaId; if(!id) continue;
      total++;
      const key=String(id);
      if(WATCH_STATUSES.has(e.status)){
        if(!state.watch.has(key)){ state.watch.add(key); added++; }
        state.status[key]=AL_STATUS_MAP[e.status]||DEFAULT_STATUS;
      }else if(e.status==="COMPLETED"||e.status==="DROPPED"){
        state.status[key]=AL_STATUS_MAP[e.status];
        if(!state.watch.has(key)){ state.watch.add(key); added++; }
      }
      if(e.progress>0){ state.progress[key]=e.progress; progressed++; }
      const score=alScoreTo10(e.score,"POINT_100");
      if(score){ state.ratings[key]=score; rated++; }
    }
    localStorage.setItem("anical.watch", JSON.stringify([...state.watch]));
    localStorage.setItem("anical.status", JSON.stringify(state.status));
    localStorage.setItem("anical.progress", JSON.stringify(state.progress));
    saveRatings();
    migrateRatingAxes();   // same reasoning as importAniList
    document.querySelectorAll("[data-watch]").forEach(el=>setStar(el, state.watch.has(el.dataset.watch)));
    renderView();
    return { added, progressed, rated, total };
  } finally { alState.syncing=false; }
}

// Push: local wins, one show at a time, through a queue that survives a reload.
// AniList allows roughly 30 requests a minute and is often degraded below that,
// so the worker is deliberately slow rather than bursty.
const AL_SAVE_MUTATION=`
mutation ($mediaId: Int, $status: MediaListStatus, $scoreRaw: Int, $progress: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw, progress: $progress) {
    id mediaId status progress
  }
}`;
const AL_PUSH_GAP_MS=2200;
function alEnqueue(mediaId){
  if(!alConnected()||!alAutoSync()||alState.syncing) return;
  const id=String(mediaId);
  if(!alState.queue.includes(id)) alState.queue.push(id);   // coalesce: we always send current state, not a diff
  alSaveQueue();
  alRunQueue();
}
function alPayloadFor(id){
  const key=String(id);
  const st=state.status[key];
  const rating=+state.ratings[key]||0;
  const prog=+state.progress[key]||0;
  const v={mediaId:+key};
  // Only send what we actually hold. Sending status:null would clear it.
  if(st&&AL_STATUS_OUT[st]) v.status=AL_STATUS_OUT[st];
  else if(state.watch.has(key)) v.status=AL_STATUS_OUT[DEFAULT_STATUS];
  // Our 0–10 -> AniList's scale-independent 0–100. Rounded because the composite
  // of five axes is a decimal, and scoreRaw is an Int.
  if(rating) v.scoreRaw=Math.round(rating*10);
  if(prog) v.progress=prog;
  return v;
}
async function alRunQueue(){
  if(alState.busy||!alState.queue.length||!alConnected()) return;
  alState.busy=true;
  try{
    while(alState.queue.length&&alConnected()){
      const id=alState.queue[0];
      try{
        await alQuery(AL_SAVE_MUTATION, alPayloadFor(id));
        alState.queue.shift(); alSaveQueue();
        alState.lastError=null;
      }catch(err){
        if(err&&err.rateLimited){
          // Keep the item queued and back off; it'll go out on the next turn.
          await new Promise(r=>setTimeout(r, Math.min(err.retryAfter,120)*1000));
          continue;
        }
        // A permanent failure on one show must not wedge the whole queue.
        alState.queue.shift(); alSaveQueue();
        alState.lastError=(err&&err.message)||"Sync failed";
        console.warn("AniList push failed for",id,err);
      }
      alSyncBadge();
      if(alState.queue.length) await new Promise(r=>setTimeout(r,AL_PUSH_GAP_MS));
    }
  } finally { alState.busy=false; alSyncBadge(); }
}
// Re-send everything we hold — the repair button for "my list drifted".
function alPushAll(){
  if(!alConnected()) return 0;
  const ids=new Set([...state.watch, ...Object.keys(state.status), ...Object.keys(state.ratings), ...Object.keys(state.progress)]);
  for(const id of ids) if(!alState.queue.includes(String(id))) alState.queue.push(String(id));
  alSaveQueue(); alRunQueue();
  return ids.size;
}
function alSyncBadge(){
  const el=$("alQueueState"); if(!el) return;
  el.textContent = alState.queue.length ? `Syncing… ${alState.queue.length} left`
    : alState.lastError ? `Last sync error: ${alState.lastError}` : "All changes synced.";
}

// Extra detail-modal data (recommendations, cast) — fetched lazily per show so the
// bulk season query stays light. Cached per id.
const EXTRAS_QUERY=`
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    characters(sort: [ROLE, RELEVANCE], perPage: 12) { edges { role node { id name { full } image { medium } } voiceActors(language: JAPANESE, sort: RELEVANCE) { id name { full } } } }
    recommendations(sort: RATING_DESC, perPage: 10) { nodes { mediaRecommendation { id title { romaji english native } coverImage { medium } format averageScore isAdult } } }
    studios(isMain: true) { nodes { id name } }
  }
}`;
const STUDIO_QUERY=`
query ($id: Int) {
  Studio(id: $id) {
    name
    media(sort: POPULARITY_DESC, perPage: 13, isMain: true) { nodes { id title { romaji english native } coverImage { medium } format averageScore isAdult } }
  }
}`;
function castHTML(chars){
  const edges=(chars&&chars.edges)||[];
  if(!edges.length) return "";
  const cards=edges.slice(0,12).map(ed=>{
    const c=ed.node, va=ed.voiceActors&&ed.voiceActors[0];
    const cimg=c.image&&c.image.medium?`<img src="${esc(c.image.medium)}" alt="" loading="lazy" width="56" height="56">`:"";
    return `<a class="cast-c" href="https://anilist.co/character/${c.id}" target="_blank" rel="noopener">${cimg}<div class="cn">${esc(c.name.full)}</div>${va?`<div class="va">${esc(va.name.full)}</div>`:""}</a>`;
  }).join("");
  return `<h4 style="margin:16px 0 6px">Characters &amp; voice cast</h4><div class="cast">${cards}</div>`;
}
// "On this day" — anime that premiered on today's month+day in past years.
const OTD_QUERY=`
query ($d: String) {
  Page(perPage: 25) { media(type: ANIME, startDate_like: $d, sort: POPULARITY_DESC) {
    id title { romaji english native } coverImage { medium } startDate { year month day } isAdult format } }
}`;
let otdDone=false;
async function loadOnThisDay(){
  const card=$("otdCard"); if(!card) return;
  const now=new Date(), mm=String(now.getMonth()+1).padStart(2,"0"), dd=String(now.getDate()).padStart(2,"0");
  let media;
  // Same list for every visitor on a given day, so it is served from our cache
  // rather than queried per browser; AniList stays the fallback.
  const ours=await apiGet(`/on-this-day?d=${mm}${dd}`);
  if(ours&&Array.isArray(ours.media)) media=ours.media;
  if(!media){
    try{
      const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query:OTD_QUERY,variables:{d:"%"+mm+dd}})});
      const j=await res.json(); if(j.errors) throw 0; media=j.data.Page.media;
    }catch(e){ card.style.display="none"; return; }
  }
  const curY=now.getFullYear();
  const items=(media||[]).filter(m=>m.startDate&&m.startDate.year&&m.startDate.year<curY&&m.startDate.month===now.getMonth()+1&&m.startDate.day===now.getDate()&&!(state.hideNSFW&&m.isAdult)&&!isHidden(m.id)).slice(0,8);
  if(!items.length){ card.style.display="none"; return; }
  card.style.display="";
  $("onThisDay").innerHTML=items.map(m=>{ const yrs=curY-m.startDate.year; return `<div class="prow" role="button" tabindex="0" aria-label="${esc(title(m))}" data-otd="${m.id}">
    <img src="${esc((m.coverImage&&m.coverImage.medium)||"")}" alt="" loading="lazy" width="44" height="60">
    <div class="info"><div class="pt">${esc(title(m))}</div><div class="meta" style="margin-top:3px">Premiered ${m.startDate.year} · ${yrs} yr${yrs===1?"":"s"} ago</div></div></div>`; }).join("");
  $("onThisDay").querySelectorAll("[data-otd]").forEach(el=>el.onclick=()=>openShowById(el.dataset.otd));
}
const extrasCache=new Map();
async function fetchModalExtras(id){
  id=String(id);
  if(extrasCache.has(id)) return extrasCache.get(id);
  const ours=await apiGet(`/anime/${encodeURIComponent(id)}/extras`);
  if(ours&&ours.media){ extrasCache.set(id,ours.media); return ours.media; }
  const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({query:EXTRAS_QUERY,variables:{id:+id}})});
  if(!res.ok) throw new Error("AniList HTTP "+res.status);
  const j=await res.json(); if(j.errors) throw new Error(j.errors[0].message);
  extrasCache.set(id, j.data.Media); return j.data.Media;
}
function recCoversHTML(nodes){
  const items=(nodes||[]).map(n=>n&&n.mediaRecommendation).filter(m=>m&&m.id&&!(state.hideNSFW&&m.isAdult)&&!isHidden(m.id));
  if(!items.length) return "";
  return `<h4 style="margin:16px 0 6px">You might also like</h4><div class="wn-list">`+
    items.slice(0,10).map(m=>`<img class="wn-cover" role="button" tabindex="0" data-rec="${m.id}" src="${esc((m.coverImage&&m.coverImage.medium)||"")}" alt="${esc(title(m))}" title="${esc(title(m))}" loading="lazy" width="84" height="118">`).join("")+`</div>`;
}
const studioCache=new Map();
async function fetchStudioMedia(studioId){
  if(studioCache.has(studioId)) return studioCache.get(studioId);
  const ours=await apiGet(`/studio/${encodeURIComponent(studioId)}`);
  if(ours&&ours.studio){ studioCache.set(studioId,ours.studio); return ours.studio; }
  const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({query:STUDIO_QUERY,variables:{id:+studioId}})});
  if(!res.ok) throw new Error("AniList HTTP "+res.status);
  const j=await res.json(); if(j.errors) throw new Error(j.errors[0].message);
  studioCache.set(studioId, j.data.Studio); return j.data.Studio;
}
function studioCoversHTML(studio, excludeId){
  const items=(studio&&studio.media&&studio.media.nodes||[]).filter(m=>m&&m.id && String(m.id)!==String(excludeId) && !(state.hideNSFW&&m.isAdult) && !isHidden(m.id));
  if(!items.length) return "";
  return `<h4 style="margin:16px 0 6px">More from ${esc(studio.name)}</h4><div class="wn-list">`+
    items.slice(0,10).map(m=>`<img class="wn-cover" role="button" tabindex="0" data-rec="${m.id}" src="${esc((m.coverImage&&m.coverImage.medium)||"")}" alt="${esc(title(m))}" title="${esc(title(m))}" loading="lazy" width="84" height="118">`).join("")+`</div>`;
}
async function loadModalExtras(id){
  const stillOpen=()=>String(state._modalId)===String(id) && $("overlay").classList.contains("on");
  let data;
  try{ data=await fetchModalExtras(id); }
  // "More like this" is never emptied from here any more: Day 76's closest
  // matches live in the same tab and answer even when these rails can't.
  catch(e){ if(stillOpen()){ setModalTabEmpty("cast",true); const s=$("recsSlot"); if(s){ s.className=""; s.innerHTML=""; } } return; }
  if(!stillOpen()) return;
  const cast=$("castSlot");
  if(cast){
    const html=(data&&data.characters)?castHTML(data.characters):"";
    cast.className=""; cast.innerHTML=html;
    setModalTabEmpty("cast",!html);
  }
  const slot=$("recsSlot");
  if(slot){
    const html=(data&&data.recommendations)?recCoversHTML(data.recommendations.nodes):"";
    slot.className=""; slot.innerHTML=html;
  }
  const studioNode=data&&data.studios&&data.studios.nodes&&data.studios.nodes[0];
  const studioSlot=$("studioSlot");
  if(studioSlot&&studioNode){
    try{
      const studio=await fetchStudioMedia(studioNode.id);
      if(stillOpen()){
        studioSlot.innerHTML=studioCoversHTML(studio,id)+
          `<a class="sim-more" href="${browseHref("studio",studioNode.id)}" data-browse="studio|${esc(String(studioNode.id))}|${esc(studio.name||"")}">Everything by ${esc(studio.name||"this studio")}, ranked →</a>`;
      }
    }catch(e){}
  }
}
async function fetchSeason(season,year,report){
  const key=season+"-"+year;
  if(state.seasonCache.has(key)) return state.seasonCache.get(key);

  // Our own API first (netlify/functions/api.mjs -> _lib/catalog.mjs). It holds
  // the identical AniList payload, shared by every visitor and refreshed by one
  // scheduled worker, so a launch normally costs AniList nothing at all and
  // isn't affected when their public API is rate-limiting or down. AniList
  // stays as the fallback below: if our catalog is cold, or this build is
  // running somewhere the functions aren't (a local file://, a fork), the app
  // must still work exactly as it always did.
  const ours=await apiGet(`/seasons/${season.toLowerCase()}/${year}?full=1`,{timeout:9000});
  if(ours&&Array.isArray(ours.media)&&ours.media.length){ state.seasonCache.set(key,ours.media); return ours.media; }

  // 3 pages (150) fully covers a normal season; bounded so a month view (≤3
  // seasons) stays well under AniList's ~30 requests/min and never gets locked out.
  let all=[],page=1,more=true,aborted=false;
  while(more && page<=3){
    let res, tries=0;
    for(;;){
      res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({query:QUERY,variables:{season,seasonYear:year,page}})});
      if(res.status===429 && tries<2){ const wait=Math.min((+(res.headers.get("retry-after"))||3),8); tries++; await new Promise(r=>setTimeout(r,wait*1000)); continue; }
      break;
    }
    if(res.status===429){ aborted=true; break; }   // still limited — return what we have instead of hanging/throwing
    if(!res.ok) throw new Error("AniList HTTP "+res.status);
    const json=await res.json();
    if(json.errors) throw new Error(json.errors[0].message);
    all=all.concat(json.data.Page.media); more=json.data.Page.pageInfo.hasNextPage; page++;
  }
  if(!aborted) state.seasonCache.set(key,all);   // don't cache a rate-limited partial; let a later view retry
  else if(report) report.rateLimited=true;       // signal the caller that data is incomplete
  return all;
}
// The seasonless-but-airing set. Cached for the session like a season, and
// never allowed to fail the load: it is a supplement, so if it can't be fetched
// the calendar is exactly as complete as it was before this existed.
async function fetchSeasonless(){
  const key="SEASONLESS";
  if(state.seasonCache.has(key)) return state.seasonCache.get(key);

  const ours=await apiGet("/airing?full=1",{timeout:9000});
  if(ours&&Array.isArray(ours.media)){ state.seasonCache.set(key,ours.media); return ours.media; }

  // AniList fallback, same shape as fetchSeason's. Keep only what AniList gave
  // no season *and* that actually has episodes — the seasonless set is full of
  // CM/PV collections which would render nothing and bloat search and genres.
  //
  // 8 pages, not the 3 a season uses: these titles sit far down a popularity
  // sort of everything airing, and the filter throws almost all of it away.
  // Mirrors SEASONLESS_MAX_PAGES in netlify/functions/_lib/seasonless.mjs —
  // no build step here, so change one and change the other.
  let all=[],page=1,more=true;
  while(more && page<=8){
    const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({query:AIRING_QUERY,variables:{page}})});
    if(res.status===429) break;                  // supplementary — never worth a retry budget
    if(!res.ok) throw new Error("AniList HTTP "+res.status);
    const json=await res.json();
    if(json.errors) throw new Error(json.errors[0].message);
    all=all.concat(json.data.Page.media); more=json.data.Page.pageInfo.hasNextPage; page++;
  }
  const out=all.filter(md=>(!md.season||!md.seasonYear)&&((md.airingSchedule&&md.airingSchedule.nodes)||[]).length>0);
  state.seasonCache.set(key,out);
  return out;
}
async function loadDataForRange(start,end){
  const seasons=seasonsForRange(start,end);
  const report={rateLimited:false};
  const results=await Promise.allSettled([
    ...seasons.map(s=>fetchSeason(s.season,s.year,report)),
    fetchSeasonless(),
  ]);
  // The seasonless pull is the last entry and is deliberately not counted in
  // `failed`: it must never mark the range partial or, on its own, throw.
  const seasonResults=results.slice(0,seasons.length), extra=results[results.length-1];
  let media=[],ok=false,failed=0;
  for(const r of seasonResults){ if(r.status==="fulfilled"){ media=media.concat(r.value); ok=true; } else failed++; }
  if(!ok) throw new Error("All season fetches failed");
  if(extra.status==="fulfilled") media=media.concat(extra.value);
  else console.warn("seasonless set unavailable —", extra.reason && extra.reason.message);
  const seen=new Set(),out=[];
  for(const md of media){ if(!seen.has(md.id)){ seen.add(md.id); out.push(md); } }
  // partial = at least one season is missing/incomplete (hard failure or rate-limited)
  return { media:out, partial: report.rateLimited || failed>0 };
}

/* ---------- "what's new since your last visit" ---------- */
// Captured at startup (before we overwrite it) so we can diff against the last session.
const PREV_SEEN=(()=>{ const raw=localStorage.getItem("anical.seenIds"); if(!raw) return null; try{ return new Set(JSON.parse(raw)); }catch(e){ return null; } })();
const LAST_VISIT=+(localStorage.getItem("anical.lastVisit")||0);
let whatsNewDone=false;
function renderWhatsNew(){
  if(whatsNewDone) return; whatsNewDone=true;
  const cur=state.media.map(m=>String(m.id));
  localStorage.setItem("anical.seenIds", JSON.stringify(cur));
  localStorage.setItem("anical.lastVisit", String(Date.now()));
  const box=$("whatsNew"); if(!box) return;
  if(!PREV_SEEN) return;   // first visit — just set the baseline, no banner
  const fresh=state.media.filter(m=>!PREV_SEEN.has(String(m.id)) && !nsfwHidden(m) && !isHidden(m.id))
    .sort((a,b)=>(b.popularity||0)-(a.popularity||0));
  if(!fresh.length){ box.style.display="none"; return; }
  const since=LAST_VISIT?(" since "+new Date(LAST_VISIT).toLocaleDateString([], {month:"short",day:"numeric"})):"";
  box.innerHTML=`<span class="wn-label">✨ ${fresh.length} new${since}</span>`+
    `<div class="wn-list">`+fresh.slice(0,14).map(md=>`<img class="wn-cover" role="button" tabindex="0" data-wn="${md.id}" src="${md.coverImage&&md.coverImage.medium?esc(md.coverImage.medium):""}" alt="${esc(title(md))}" title="${esc(title(md))}" loading="lazy" width="30" height="40">`).join("")+`</div>`+
    `<button class="wn-x" id="wnDismiss" title="Dismiss">✕</button>`;
  box.style.display="";
  box.querySelectorAll("[data-wn]").forEach(el=>{ el.onclick=()=>{ const md=state.media.find(x=>String(x.id)===el.dataset.wn); if(md) openDetail(md,(nextAir(md)||{}).episode||1); }; });
  $("wnDismiss").onclick=()=>{ box.style.display="none"; };
}

/* ---------- release notes ("What's new") ----------
   Add a new entry at the TOP with the next id whenever you ship a notable
   update. Returning visitors see every entry newer than the one they last
   saw, once, in a modal they close manually. Trim old entries freely. */
const CHANGELOG=[
  { id:21, v:"5.0", date:"September 2026", items:[
    "📄 Every anime now has a real page of its own. Staff and studio, what it was adapted from, every episode with its air date and a tick for the ones you've seen, the community's score distribution with your own score — or your predicted one — marked on it, where to watch, the official links and trailer, its tags, everything that comes before and after it, and the five shows most like it. Open one from any pop-up with 📄 Full page, or share the link.",
    "🏷 The tags on that page are coloured by your own taste: green where you rate that theme above your average, red where you rate it below, grey where you haven't rated anything that carries it yet.",
    "🧲 More like this means something now. The closest five shows by tags, genres, studio and staff, each with a line saying what they share — and sequels are left out, because \"season 2 is similar to season 1\" tells you nothing. An 📡 Airing now switch narrows it to what's broadcasting.",
    "⌨️ Press Ctrl K (⌘K on a Mac) from anywhere. Search every show, jump to any page, or pick a show and press → to set its status, rate it, pin it, favourite it or add it to a list — without touching the mouse. The things you use most float to the top.",
    "🔍 The search box got a lot smarter. It forgives typos in English, rōmaji and Japanese titles, ranks an exact match above a near-miss, and understands operators: genre:romance, studio:mappa, year:>=2020, score:>8, status:airing, format:movie, is:plan. They combine. Anything it doesn't recognise is just searched as text, so Re:Zero still works.",
    "🔖 Save any search-and-filter combination under a name and rerun it in one tap. Pin your favourites and they sit above the calendar as chips. Your recent searches are there when you click into an empty box, and you can clear them.",
    "💎 Hidden gems: shows scored 75+ by the people who found them and seen by almost nobody, inside the genres you like. A dial sets how obscure — from deep cuts under 1,500 members to things known in circles — and the list updates as you drag. Underneath, the best thing you've never heard of from each of the last sixteen years.",
    "🏷 Browse by tag, by studio and by person. Every tag AniList tracks, each opening onto every show that carries it; every studio's whole catalogue ranked by score, with how you've rated their work; and director, writer, composer and voice actor pages with every credit grouped by role.",
    "✨ For you has a new Because you… lens — rows named after a show you loved, are watching or favourited, strongest reason first. The best two also appear above the calendar, and hide with one click. Rows too weak to back up their own title aren't shown.",
    "🧭 Your taste page now shows how your taste moved this month: which genres, tags and studios climbed or slipped since the 1st, what's new to your profile, and whether your archetype changed. It's rebuilt from your dated activity, and it says plainly when there isn't a last month to compare against yet.",
    "🌱 One new show a day in the sidebar — the same one all day — to try or skip. Either answer keeps your streak going.",
    "🎲 Random now respects your filters, and never hands you the same show twice in a row.",
    "And a fresh coat of paint: views are grouped into Calendar, Library and Discover, surfaces lift when you hover them, pages ease in instead of snapping, loading states are skeletons rather than text, and the header finally stays put when you scroll. Every skin still looks exactly as it did.",
  ]},
  { id:20, v:"4.1", date:"August 2026", items:[
    "🧭 Tsuzuki now knows your taste. A new Taste tab reads the shows you've scored and works out what you actually like — by genre, by AniList tag, by studio, by decade, by how long a series is, and by what it was adapted from. Each one shows how far above or below your own average it sits, after the crowd's opinion of the same shows is subtracted, so neither your generosity nor a genre's general popularity gets counted as taste.",
    "It gives the shape a name — “puzzle-minded slow burn”, “comedy-led single-cour” — and then tells you exactly which numbers produced it. A label you can't check isn't worth having.",
    "✨ And a For you page: every show it can see, ranked by what it reckons you'd score it, with your library, your dismissals and anything you've hidden taken out. Four lenses — everything, safe bets, surprise me, and short, which caps the total runtime for when you have one evening.",
    "Every pick shows its working. The chips under each one are the things that pushed the estimate up or down and by how much, and hovering one names the shows of yours it learned that from. “Not interested” and “already seen” are remembered for good, and both are undoable.",
    "🔮 Unrated shows now carry an estimated score on their card and in their pop-up. It's marked with a ~ and never dressed up as your own rating.",
    "When it doesn't know enough, it says so and stops — no number at all — and then tells you which shows already on your board to rate to fix it. Under the hood it tracks how much evidence each estimate rests on, and we're careful to call that evidence rather than confidence: it reliably spots an estimate built on nothing, but it can't promise a 90% one is closer than a 70% one, so it doesn't claim to.",
    "📉 You can test it against yourself. Settings → Predictions hides each of your scores in turn, predicts it from the rest, and reports how far off it was — next to how badly “just guess your average every time” would have done. If it isn't beating that, it tells you.",
    "Your comparisons feed it too: the head-to-head answers from the last update nudge the estimates toward the order you actually put shows in.",
    "All of it is computed in your browser from your own ratings. Nothing is uploaded, no profile is built on our servers, and there is no model anywhere but on your device.",
  ]},
  { id:19, v:"4.0", date:"August 2026", items:[
    "⚔ Head to head can settle your list for you. Answer ten quick “which of these two did you like more?” rounds and you come out with an ordering — then, if you want it, your own scores dealt back out to match. It only ever reshuffles numbers you already gave, so your average and the shape of your ratings don't move; all that changes is which show holds which score. Nothing is written until you press the button, and one Undo puts it all back.",
    "📝 Your notes finally have somewhere to live. Settings → Notes searches what you actually wrote, not just titles, so you can find a show by the thing you remember writing about it. Five quick-start prompts sit above every note box — favourite episode, best moment, who to recommend it to — and they insert where your cursor is instead of over what's there.",
    "🙈 Any note can be marked a spoiler. It blurs everywhere it appears until you tap it, including the little 📝 mark on cards, which used to show the first line of your note on hover.",
    "♥ Favourites, 📌 pins and 🗃 an archive. A favourite isn't a score and a pin isn't a status — they just sort your board. Pin up to five shows to the top of everything. Archiving takes a finished show off your board and lists and keeps every last thing about it: your rating, notes, dates and progress are untouched, and it still shows up in the calendar and search. One button brings the archive back into view.",
    "⇅ Build your own sort. Score, then title. Status, then episodes left. Twelve keys, as many levels deep as you like, saved under a name and reapplied in a tap. Shows with nothing to sort on always go to the bottom rather than being treated as a zero.",
    "Filters you can see. Whatever is currently narrowing your view now shows as a row of chips you can pop off one at a time — no more wondering which of six dropdowns is hiding a show.",
    "🖼 A grid layout for your board and lists, and density is now remembered per view: a compact month calendar and a roomy board at the same time, instead of one setting fighting both.",
    "📅 And a month wrap. What you watched, finished, started, rated and wrote, month by month, with the shows named. It's honest about its own age — it only started keeping track today, and it says so rather than claiming you did nothing in July.",
  ]},
  { id:18, v:"3.9", date:"August 2026", items:[
    "📊 Settings → Ratings now shows the shape of your own scoring — ten columns, one per score, with the number you reach for most called out underneath. Change the axis weights above it and you can watch your whole library redistribute.",
    "New switch next to it: spread my scores. If most of what you rate lands on the same two numbers, this pulls them apart so you can finally see which of your 8s you actually preferred. Your average stays exactly where it is — only the gaps between scores grow.",
    "Nothing is rewritten. Your stored scores, the picker inside each show, your AniList account and every export are still the numbers you typed; only the cards and the chart change, and switching it off puts them straight back.",
    "⚔ And a head-to-head mode, because “which of these two did you like more?” is a question people answer well, while “what is this out of ten?” is one they answer differently on different days. Two covers, one question — arrow keys to answer, S to skip. A handful of rounds orders your library better than the scores do.",
    "It copes with you contradicting yourself, which you will: preferring A to B, B to C and C to A is a real opinion rather than a mistake, so those three end up level instead of breaking the list — and it tells you how many of your answers it had to overrule.",
    "Your comparisons are stored the way everything else is: in this browser, never uploaded, and they don't touch your scores at all.",
  ]},
  { id:17, v:"3.8", date:"August 2026", items:[
    "⭐ Ratings go deeper if you want them to. Under the 1–10 row there's now a “Rate in detail” panel with five sliders — story, art, sound, characters and enjoyment — scored in half-points, and your overall score is their average, updating as you drag.",
    "Nothing changed for anyone who doesn't open it. Every score you've already given still reads exactly as it did; picking a number the old way still sets the whole thing in one click, and the panel stays shut until the five actually disagree.",
    "An axis you leave blank is ignored rather than counted as a zero — a film with no music doesn't lose points for having no music.",
    "And in Settings → Ratings, how much each axis counts is yours to set. Weight story higher than art, or switch an axis off entirely, and every score you've given is recalculated at once. It only ever rewrites the single number — the five behind it are untouched, so setting everything back to ×1 returns every score to exactly what it was.",
  ]},
  { id:16, v:"3.7", date:"August 2026", items:[
    "🎨 Twenty-five more skins — seventy-five in total. Naruto Shippuden and Dragon Ball Z join the Legendaries; JoJo, Monster, Fate/Zero, Clannad and Psycho-Pass are Epics; Gintama, Erased, The Promised Neverland, Anohana, Howl's Moving Castle, Fire Force, Tokyo Revengers and Nichijou are Rares, with ten more below them.",
    "Twelve new textures came with them, drawn from each show rather than picked off a shelf — a shuriken, a transmutation-style summoning ring, the dango family, the menacing marks, a reticle, a maze, cogs and a mountain ridge among them.",
    "Nothing you already own changed, and nothing moved tier. The wheel gets deeper rather than stingier: a Common now pays out of thirty possibilities instead of twenty, and it still never draws a skin you already have.",
  ]},
  { id:15, v:"3.6", date:"August 2026", items:[
    "🎡 Skins are yours to earn. Fifty of them — full site themes with their own palette, typeface, corner shapes, texture and art, not recolours — and two ways in: a free spin of the wheel every day, or save up Tung Tungs and buy the one you actually want.",
    "You earn Tung Tungs by using the site: marking an episode watched, rating something, setting a status, filing a show into a list or writing a note each pay once a day, and they credit themselves the moment you do it. Nothing to collect.",
    "Spin every day and the streak multiplies your coin prizes, up to double. A skin you already own is never drawn — and if you have cleared a whole rarity, that slice pays out in Tung Tungs instead.",
    "You now own a collection rather than a single skin: swap between everything you have from the Skins panel, or take it off and go back to your own theme. Skins handed out at events still work exactly as before and sit in the collection alongside the rest.",
    "One thing changed about what we store, and it's worth saying plainly: your Tung Tung balance and the skins you own live on our server against your Discord account, because a balance kept in your own browser is one that can be edited. Your list, ratings, notes, collections and episode progress are still stored only in your browser and are still never uploaded.",
  ]},
  { id:14, v:"3.5", date:"August 2026", items:[
    "The episode counter is typeable. Binged eight episodes on a plane? Type the number you're on and press Enter instead of clicking +1 eight times. − and +1 are still there for one at a time.",
    "Continue Watching is ordered by when the episode you're missing actually aired — newest first, with the date on the row — instead of by how popular the show is. It also reaches shows from seasons that aren't on screen, so the thing you fell behind on last season stops being invisible.",
    "Shows you finish twice now keep a rewatch count, and Reset never touches it — clearing your progress forgets where you are, not what you've finished.",
    "Started and finished dates, stamped for you the first time a show goes to Watching or Completed, and editable afterwards if the stamp is wrong.",
  ]},
  { id:13, v:"3.4", date:"August 2026", items:[
    "Episode progress has a counter of its own: −, +1, ✓ Caught up and a running “Ep 5 of 14”, right under Where to watch in every show. Marking three episodes no longer means opening the schedule and finding the right row.",
    "New per-show switch: “mark episodes watched as they air”. Turn it on for the shows you never miss and the count keeps itself up to date. Turning it off freezes it where it is — nothing you've already watched is lost, and a correction you make by hand sticks until the next episode actually airs.",
    "Every card on your board and in your lists now carries a thin progress bar under the cover, so you can see how far into each show you are without opening any of them.",
  ]},
  { id:12, v:"3.3", date:"August 2026", items:[
    "New home: tsuzuki.top. Every old link still works — tsuzuki.netlify.app redirects here, and so does www.",
    "Calendar subscriptions are unaffected: your existing feeds keep working and won't re-add events you already have.",
  ]},
  { id:11, v:"3.2", date:"August 2026", items:[
    "Your lists have cover art now — a mosaic of the first four shows in each one, so you can tell them apart at a glance instead of reading the names.",
    "Shift-click a run of cards on your board or in your lists to select them all, then set one status or file the whole lot into a list in a single click. Ctrl/⌘-click picks out individual shows; Esc clears the selection.",
    "Every destructive action now has a six-second Undo instead of a confirmation dialog — including taking a show off My List, hiding a show and unhiding all of them at once.",
  ]},
  { id:10, v:"3.1", date:"August 2026", items:[
    "A show's details are now split into sub-menus — Overview, Schedule, Franchise, Cast and More like this — instead of one long scroll. The full airing schedule gets the whole width rather than a squeezed side column.",
    "Franchise timeline rebuilt. It used to show only the entries a show linked to directly, so opening season 3 never showed you season 1. It now walks the whole franchise — every season, movie, OVA, special and spin-off — in true release order, numbered.",
    "Fixed: the modal could announce a Japanese broadcast for an episode the calendar had shown as a simulcast. The episode list, “next episode”, alerts and calendar exports now all pick the same release the grid does.",
    "The schedule now loads from Tsuzuki's own servers instead of every visitor querying AniList directly — faster to open, and it keeps working when AniList is having a bad day.",
    "Fixed: server-sent episode alerts had been failing silently since launch.",
  ]},
  { id:9, v:"3.0", date:"August 2026", items:[
    "✨ New: ask Tsuzuki anything. The button in the bottom-right corner opens a chat that reads this calendar directly — air dates, what's on tonight, which season a show belongs to — and searches the web for everything the calendar doesn't hold, like staff, plot, sequel rumours and what a series is actually about.",
    "It answers with the corrected times, says which release it means (sub, dub or broadcast), and flags an estimate as an estimate instead of pretending to know. Speculation is always labelled as speculation.",
    "Sub, dub and Japanese-broadcast times are now tracked separately — pick which ones you want with the new 🎧 button in the toolbar.",
    "Simulcast times are measured against Crunchyroll's own schedule rather than assumed to match the broadcast. They ran up to an hour late, every week, on most shows.",
    "Episodes show which release they are (SUB / DUB / RAW) and where it streams. A ~ means the time is estimated from the broadcast rather than confirmed.",
    "Delays and broadcast breaks appear inline with the reason: a delayed episode moves and is flagged, a break week shows as a break instead of a phantom episode — and never fires an alert.",
    "Spotted a wrong time? Every show now has ⚠ Report a wrong time. Corrections go live for everyone without waiting for a new release of the site.",
    "Episode alerts, calendar exports and “next episode” all follow the release you track, so dub watchers stop being told about a broadcast they can't watch.",
    "Connect your AniList account: private entries come across, and status, score and episode progress you change here sync straight back.",
    "New timetable settings — start the week on Sunday, Monday, Saturday or today; 12h or 24h times; order each day by popularity, air time, A–Z or score.",
    "Hide cover art for a much denser list, hide donghua, and filter by season length or episode number.",
    "New browse pages: 🏆 Top Anime and 📺 Where to Watch, both reachable from the calendar footer.",
    "A free public API at /api/ — the only one that gives you sub, dub and broadcast times separately, with delays and breaks already corrected.",
  ]},
  { id:6, v:"2.6", date:"August 2026", items:[
    "New 📚 Lists view — make your own collections (Comfort watches, Rewatch pile, Movie night…) and drag shows between them.",
    "Rename, reorder and delete lists from the column headers, with an Undo if you delete one by mistake.",
    "A show can sit in as many lists as you like — add it to any of them straight from its detail pop-up.",
    "Every card has a “Move to…” picker too, so lists work fine on a phone where dragging doesn't.",
  ]},
  { id:5, v:"2.5", date:"August 2026", items:[
    "Rate any show 1–10 — your own score, shown next to the community average on every card so you can tell them apart at a glance.",
    "Private notes per show: where you left off, who recommended it, why you dropped it. They save as you type and never leave this device.",
    "Your rating and a 📝 mark now appear on board cards, agenda rows, sidebars and search results.",
    "AniList imports bring your scores across too, whatever scale your account uses (100-point, 5-star, smileys…).",
    "Fixed the Dashboard failing to draw its charts.",
  ]},
  { id:4, v:"2.4", date:"August 2026", items:[
    "Adding a show to your board is one click: search it, click a status in the result row, done — the search stays open so you can add the next one.",
    "Statuses are buttons now instead of a dropdown, and nothing is picked for you — a show only shows a status once you've chosen it.",
    "Click a show's highlighted status again to take it off your board, with an Undo if that wasn't the plan.",
    "Board cards move columns with a single click, and there's a ＋ Add anime button right in the board.",
    "↑ / ↓ move through search results, Enter opens the highlighted show.",
    "AniList imports now carry each show's status across (Watching, Plan to Watch, Paused → On Hold).",
  ]},
  { id:3, v:"2.3", date:"August 2026", items:[
    "New 🗂️ Board view — track shows as Watching, Plan to Watch, On Hold, Dropped or Completed, with per-status counts at a glance.",
    "Set a show's status right from its detail pop-up — it's added to My List automatically.",
  ]},
  { id:2, v:"2.3", date:"July 2026", items:[
    "AniCal is now Tsuzuki — 続き, “what’s next.” Same app, same live schedule, a name that’s truly ours.",
    "Everything you’ve saved — your list, watch progress and settings — carries over untouched.",
    "New home: tsuzuki.netlify.app (the old link redirects here).",
  ]},
  { id:1, v:"2.2", date:"July 2026", items:[
    "Full keyboard & screen-reader access across the calendar, agenda and lists.",
    "Shareable links — the current view, date and filters now live in the URL, and the browser Back button works.",
    "Steadier layout: cover art no longer shifts the page as it loads.",
    "A one-click Retry appears if AniList is busy and some titles can't load.",
    "Roomier show pop-up: poster, details and airing schedule side by side, with bigger recommendation art.",
    "This “What’s new” window — you’ll see it once after each major update.",
  ]},
];
function openChangelog(entries){
  const latestId=CHANGELOG.length?CHANGELOG[0].id:0;
  localStorage.setItem("anical.changelogSeen", String(latestId));   // mark seen the moment it opens
  $("modalTitle").textContent="✨ What’s new in Tsuzuki";
  $("modalBody").innerHTML=`<div class="changelog">`+entries.map(c=>`
    <div class="cl-entry">
      <div class="cl-head"><span class="cl-v">v${esc(c.v)}</span><span class="cl-date">${esc(c.date)}</span></div>
      <ul class="cl-list">${c.items.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>
    </div>`).join("")+`</div>`;
  $("overlay").classList.add("on");
}
// Show release notes if this visitor is behind the latest entry. Brand-new
// visitors (no prior visit) are silently baselined so they aren't greeted with
// a changelog on their very first load.
function maybeShowChangelog(){
  if(!CHANGELOG.length) return;
  const latestId=CHANGELOG[0].id;
  let seen=localStorage.getItem("anical.changelogSeen");
  seen = seen==null ? (LAST_VISIT ? 0 : latestId) : (+seen||0);
  const fresh=CHANGELOG.filter(c=>c.id>seen);
  if(fresh.length) openChangelog(fresh);
  else localStorage.setItem("anical.changelogSeen", String(latestId));
}

/* ---------- instant-load cache (stale-while-revalidate) ---------- */
const CACHE_KEY="anical.cache.v1";
function persistMedia(){
  try{
    localStorage.setItem(CACHE_KEY, JSON.stringify({ts:Date.now(), view:state.viewMode, anchor:state.anchor.getTime(), media:state.media}));
  }catch(e){
    // quota — store a slim copy (drop the heavy description/relations; only needed in the modal, which refetches)
    try{
      const slim=state.media.map(m=>{ const c={...m}; c.description=""; delete c.relations; delete c.recommendations; return c; });
      localStorage.setItem(CACHE_KEY, JSON.stringify({ts:Date.now(), view:state.viewMode, anchor:state.anchor.getTime(), media:slim}));
    }catch(_){ /* still too big — skip caching */ }
  }
}
function readCache(maxAgeMs){
  try{
    const raw=localStorage.getItem(CACHE_KEY); if(!raw) return null;
    const o=JSON.parse(raw);
    if(!o||!Array.isArray(o.media)||!o.media.length) return null;
    if(maxAgeMs && Date.now()-o.ts>maxAgeMs) return null;
    return o;
  }catch(e){ return null; }
}

/* ---------- release variants: raw / sub / dub + corrections ----------
   AniList only carries the Japanese TV broadcast time. That is the wrong
   number for almost everyone: a simulcast viewer wants the Crunchyroll drop, a
   dub viewer wants a date AniList doesn't have at all, and neither reflects the
   week a broadcast gets pre-empted.

   So one AniList airing node fans out into the *variants* that really exist for
   that episode, with human corrections layered on top. The correction document
   comes from two places, merged in this order:
     1. /data/overrides.json — committed, reviewable, cached, works offline.
     2. /api/overrides       — the live store, so a wrong time is fixable in
                               minutes instead of waiting on a deploy.
   Both are optional; with neither, the app behaves as it always did plus a
   marked-estimated simulcast row.

   netlify/functions/_lib/schedule-overrides.mjs is the mirror of this logic for
   the server (push alerts). The client can't import it — there's no build step
   — so the two are kept deliberately parallel. Change one, change the other. */
const AIR_TYPES=["raw","sub","dub"];
const AIR_LABEL={raw:"RAW", sub:"SUB", dub:"DUB"};
const AIR_LONG={raw:"Japanese broadcast", sub:"Subtitled release", dub:"English dub"};
// Platforms whose simulcast lands close enough to the broadcast that "the sub
// is up around this time" is a fair estimate rather than a number we made up.
// Anything else gets no estimated sub row at all.
const SIMULCAST_SITES=new Set(["Crunchyroll","HIDIVE","Netflix","Amazon Prime Video","Hulu","Disney Plus","Bilibili TV","Muse Asia","Ani-One Asia","YouTube"]);

function showOverride(id){ return (state.overrides&&state.overrides.shows&&state.overrides.shows[String(id)])||null; }
/* ---- per-region offsets (overrides v2) ----
   The mirror of regionRule() in netlify/functions/_lib/schedule-overrides.mjs.
   No build step here, so change one and change the other — the shapes and the
   resolution order are the contract.

   The region is the user's, not the server's: the timezone the browser already
   reports is enough to place someone without asking, and an explicit choice in
   Settings beats it. A region we have no rule for falls through to the global
   behaviour rather than guessing — a wrong regional time is worse than an
   honest global one. */
// Resolved in the browser, deliberately, and NOT from the server's geo. Every
// /api/v1 response is CDN-cached by URL, so a body that varied by caller
// country would serve one visitor's region to the next — a cache-poisoning bug
// dressed as a feature. The timezone the browser already reports is enough.
const TZ_COUNTRY={
  "Europe/Berlin":"DE","Europe/Vienna":"AT","Europe/Zurich":"CH","Europe/London":"GB",
  "Europe/Dublin":"IE","Europe/Paris":"FR","Europe/Madrid":"ES","Europe/Lisbon":"PT",
  "Europe/Rome":"IT","Europe/Amsterdam":"NL","Europe/Brussels":"BE","Europe/Copenhagen":"DK",
  "Europe/Oslo":"NO","Europe/Stockholm":"SE","Europe/Helsinki":"FI","Europe/Warsaw":"PL",
  "Europe/Prague":"CZ","Europe/Budapest":"HU","Europe/Bucharest":"RO","Europe/Athens":"GR",
  "Europe/Istanbul":"TR","Europe/Moscow":"RU","Europe/Kyiv":"UA",
  "America/New_York":"US","America/Chicago":"US","America/Denver":"US","America/Phoenix":"US",
  "America/Los_Angeles":"US","America/Anchorage":"US","Pacific/Honolulu":"US",
  "America/Toronto":"CA","America/Vancouver":"CA","America/Edmonton":"CA","America/Winnipeg":"CA",
  "America/Mexico_City":"MX","America/Sao_Paulo":"BR","America/Argentina/Buenos_Aires":"AR",
  "America/Santiago":"CL","America/Bogota":"CO","America/Lima":"PE",
  "Asia/Tokyo":"JP","Asia/Seoul":"KR","Asia/Shanghai":"CN","Asia/Hong_Kong":"HK",
  "Asia/Taipei":"TW","Asia/Singapore":"SG","Asia/Bangkok":"TH","Asia/Jakarta":"ID",
  "Asia/Manila":"PH","Asia/Kuala_Lumpur":"MY","Asia/Kolkata":"IN","Asia/Calcutta":"IN",
  "Asia/Dubai":"AE","Asia/Riyadh":"SA","Asia/Jerusalem":"IL",
  "Australia/Sydney":"AU","Australia/Melbourne":"AU","Australia/Brisbane":"AU",
  "Australia/Perth":"AU","Pacific/Auckland":"NZ","Africa/Johannesburg":"ZA",
  "Africa/Lagos":"NG","Africa/Cairo":"EG",
};
function userRegion(){
  // An explicit choice always wins over an inferred one.
  try{
    const set=String(localStorage.getItem("anical.region")||"").toUpperCase();
    if(/^[A-Z]{2}$/.test(set)) return set;
  }catch(e){}
  try{
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"";
    // An unmapped timezone returns null, which falls through to the global
    // rule. Partial coverage is fine; a wrong country would not be.
    return TZ_COUNTRY[tz]||null;
  }catch(e){ return null; }
}
function regionRule(ov,type){
  const r=userRegion();
  if(!ov||!r||!ov.regions) return null;
  const block=ov.regions[r];
  return (block&&block[type])||null;
}
function ruleInRange(rule, episode){
  if(!rule) return false;
  if(rule.fromEpisode!=null && episode<rule.fromEpisode) return false;
  if(rule.toEpisode!=null && episode>rule.toEpisode) return false;
  return true;
}
function simulcastSite(md){
  for(const l of md.externalLinks||[]) if(l&&l.type==="STREAMING"&&SIMULCAST_SITES.has(l.site)) return l.site;
  return null;
}
// One airing node -> {status, variants:[{type,ts,exact,estimated,platform}]}.
// A "break" returns no variants: there is no episode to count down to.
function variantsFor(md,node){
  const ov=showOverride(md.id), ep=node.episode;
  const epOv=(ov&&ov.episodes&&ov.episodes[String(ep)])||null;
  const status=(epOv&&epOv.status)||null;
  if(status&&status.kind==="break") return {status, variants:[]};
  const shift=(status&&(status.kind==="delay"||status.kind==="early")&&status.shiftMin)?status.shiftMin*60:0;
  const out=[];
  const rawTs=(epOv&&epOv.raw&&epOv.raw.airingAt)||node.airingAt+shift;
  out.push({type:"raw", ts:rawTs, exact:true, estimated:false, platform:null});
  const subRegion=regionRule(ov,"sub"), dubRegion=regionRule(ov,"dub");
  if(epOv&&epOv.sub&&epOv.sub.airingAt)
    out.push({type:"sub", ts:epOv.sub.airingAt, exact:true, estimated:false, platform:epOv.sub.platform||(ov.sub&&ov.sub.platform)||null});
  else if(subRegion&&ruleInRange(subRegion,ep))
    out.push({type:"sub", ts:rawTs+(subRegion.offsetMin||0)*60, exact:true, estimated:false, platform:subRegion.platform||(ov.sub&&ov.sub.platform)||null, region:userRegion()});
  else if(ov&&ruleInRange(ov.sub,ep))
    out.push({type:"sub", ts:rawTs+(ov.sub.offsetMin||0)*60, exact:true, estimated:false, platform:ov.sub.platform||null});
  else{
    const site=simulcastSite(md);
    if(site) out.push({type:"sub", ts:rawTs, exact:false, estimated:true, platform:site});
  }
  // No dub without data — an invented dub date is worse than no dub row.
  if(epOv&&epOv.dub&&epOv.dub.airingAt)
    out.push({type:"dub", ts:epOv.dub.airingAt, exact:true, estimated:false, platform:epOv.dub.platform||(ov.dub&&ov.dub.platform)||null});
  else if(dubRegion&&ruleInRange(dubRegion,ep))
    out.push({type:"dub", ts:rawTs+(dubRegion.offsetMin||0)*60, exact:true, estimated:false, platform:dubRegion.platform||(ov.dub&&ov.dub.platform)||null, region:userRegion()});
  else if(ov&&ruleInRange(ov.dub,ep))
    out.push({type:"dub", ts:rawTs+(ov.dub.offsetMin||0)*60, exact:true, estimated:false, platform:ov.dub.platform||null});
  return {status, variants:out};
}
// Apply the hide rules: e.g. "hide the broadcast row once a sub row exists".
// A rule only fires against a release type that is itself switched on, so
// turning Dub off can never make a Raw row vanish.
function enabledTypes(){ return state.airTypes.size?state.airTypes:new Set(["raw"]); }
function visibleVariants(variants){
  const on=enabledTypes();
  const avail=new Set(variants.filter(v=>on.has(v.type)).map(v=>v.type));
  const r=state.hideRules;
  const keep=variants.filter(v=>{
    if(!on.has(v.type)) return false;
    if(v.type==="raw") return !((r.rawWhenSub&&avail.has("sub"))||(r.rawWhenDub&&avail.has("dub")));
    if(v.type==="sub") return !((r.subWhenDub&&avail.has("dub"))||(r.subWhenRaw&&avail.has("raw")));
    return !((r.dubWhenSub&&avail.has("sub"))||(r.dubWhenRaw&&avail.has("raw")));
  });
  // A contradictory *hide-rule* combination must never empty a row that has
  // something to show. Asking for dubs only and getting nothing back is a
  // different thing — that's the filter working, and airEmptyHint() explains it.
  if(keep.length) return keep;
  for(const t of ["sub","raw","dub"]){ const v=variants.find(x=>x.type===t&&on.has(t)); if(v) return [v]; }
  return [];
}
// Why the calendar is empty, when the reason is the release filter rather than
// the date range. Dub data only exists where a maintainer has entered it, so
// "Dub only" legitimately hides most of the schedule — say so instead of
// leaving a blank grid that reads as a broken app.
function airEmptyHint(){
  const on=enabledTypes();
  if(!on.has("dub")||on.size>1) return "";
  return ` You're showing <b>dubs only</b>, and dub dates exist only for shows someone has confirmed them for — <span class="airhint-link" role="button" tabindex="0" data-open-air="1">add the sub or broadcast release</span> to see the rest of the schedule.`;
}
// The single release used where only one time makes sense (alerts, "next
// episode", jumping the calendar to a search hit).
function primaryAirType(){
  const on=enabledTypes();
  for(const t of ["sub","raw","dub"]) if(on.has(t)) return t;
  return "raw";
}
function preferredVariant(variants, want){
  if(!variants.length) return null;
  for(const t of [want||primaryAirType(),"sub","raw","dub"]){ const v=variants.find(x=>x.type===t); if(v) return v; }
  return variants[0];
}
// The single release a viewer is tracking for one episode — picked from the
// variants the calendar actually renders, hide rules included. Everything that
// has to agree with the grid goes through here: the show modal, alerts, the
// .ics export, the premiere rail, "jump to this show". Choosing from the raw
// variant list instead is how the calendar ended up showing a condensed "~S"
// chip while the modal it opened announced a RAW broadcast.
function trackedVariant(md,node){ return preferredVariant(visibleVariants(variantsFor(md,node).variants)); }
// Every displayable entry for one show in one time window: an entry per visible
// variant, plus a break marker where an episode was cancelled for that slot.
function entriesFor(md,node){
  const {status,variants}=variantsFor(md,node);
  if(!variants.length) return status?[{media:md, episode:node.episode, ts:node.airingAt, air:null, status, brk:true}]:[];
  return visibleVariants(variants).map(v=>({media:md, episode:node.episode, ts:v.ts, air:v, status, brk:false}));
}
function airPillHTML(e){
  if(e.brk) return `<span class="pill brk">⏸ BREAK</span>`;
  if(!e.air) return "";
  const est=e.air.estimated;
  const where=e.air.platform?` · ${e.air.platform}`:"";
  const t=`${AIR_LONG[e.air.type]}${where}${est?" — estimated from the broadcast time, not confirmed":""}`;
  return `<span class="pill air air-${e.air.type}${est?" est":""}" title="${esc(t)}">${est?"~":""}${AIR_LABEL[e.air.type]}</span>`;
}
function statusPillHTML(e){
  if(!e.status||e.brk) return "";
  if(e.status.kind==="delay") return `<span class="pill warn" title="${esc(e.status.reason||"Delayed")}">⚠ DELAYED</span>`;
  if(e.status.kind==="early") return `<span class="pill warn" title="${esc(e.status.reason||"Released early")}">⚡ EARLY</span>`;
  if(e.status.kind==="note") return `<span class="pill warn" title="${esc(e.status.reason||"")}">ℹ NOTE</span>`;
  return "";
}
// Compact tag for the dense month/week chips, where a full pill doesn't fit.
// Only shown once a row could be ambiguous — i.e. more than one type is on.
function airTagHTML(e){
  if(e.brk) return `<span class="airtag air-raw" title="Break — no episode">⏸</span>`;
  if(!e.air||enabledTypes().size<2) return "";
  // The full word now that the tag sits on its own row rather than competing
  // with the title for horizontal space — "SUB" beats "S" at no extra cost.
  return `<span class="airtag air-${e.air.type}" title="${esc(AIR_LONG[e.air.type])}">${e.air.estimated?"~":""}${AIR_LABEL[e.air.type]}</span>`;
}

const OVERRIDES_SEED="/data/overrides.json";
const OVERRIDES_LIVE="/api/overrides";
function mergeOverrideDocs(seed,live){
  const shows={...((seed&&seed.shows)||{})};
  for(const [id,rec] of Object.entries((live&&live.shows)||{})){
    const base=shows[id];
    shows[id]=base?{...base,...rec, episodes:{...(base.episodes||{}), ...(rec.episodes||{})}}:rec;
  }
  return {shows, updatedAt:(live&&live.updatedAt)||(seed&&seed.updatedAt)||null};
}
// Never let the correction layer block the calendar: both fetches fail soft,
// and a cached copy covers an offline launch.
async function loadOverrides(){
  const get=async url=>{ try{ const r=await fetch(url,{cache:"no-cache"}); return r.ok?await r.json():null; }catch(e){ return null; } };
  const [seed,live]=await Promise.all([get(OVERRIDES_SEED), get(OVERRIDES_LIVE)]);
  if(!seed&&!live){
    try{ const c=JSON.parse(localStorage.getItem("anical.overrides")||"null"); if(c&&c.shows) state.overrides=c; }catch(e){}
    return;
  }
  state.overrides=mergeOverrideDocs(seed,live);
  try{ localStorage.setItem("anical.overrides", JSON.stringify(state.overrides)); }catch(e){}
}

/* ---------- range + events ---------- */
function visibleRange(){
  const a=state.anchor;
  if(state.viewMode==="dashboard"){
    // the full 3-month season the anchor falls in
    const sm={WINTER:0,SPRING:3,SUMMER:6,FALL:9}[seasonOf(a.getMonth())];
    const start=new Date(a.getFullYear(),sm,1);
    const end=new Date(a.getFullYear(),sm+3,0);   // last day of the 3rd month
    return {start,end};
  }
  if(state.viewMode==="month"){
    const first=new Date(a.getFullYear(),a.getMonth(),1);
    const start=new Date(first); start.setDate(1-daysSinceWeekStart(first,true));
    const end=new Date(start); end.setDate(start.getDate()+41);
    return {start,end};
  }
  if(state.viewMode==="week"){
    const start=new Date(a); start.setDate(a.getDate()-daysSinceWeekStart(a)); start.setHours(0,0,0,0);
    const end=new Date(start); end.setDate(start.getDate()+6);
    return {start,end};
  }
  const start=new Date(a); start.setHours(0,0,0,0);
  const end=new Date(start); end.setDate(start.getDate()+13);
  return {start,end};
}
// Day 73 made this typo-tolerant and taught it the native title and synonyms;
// Day 69 put operators in front of it (matchSearch). Kept for its callers.
function matchTitle(md,q){
  if(!q) return true;
  return !!titleMatch(md, normText(q));
}
function passFilter(e){
  const f=state.filters, md=e.media;
  if(excluded(md)) return false;
  if(f.mine && !isWatched(md.id)) return false;
  if(f.stream && !((md.externalLinks||[]).some(l=>l&&l.type==="STREAMING"&&l.site===f.stream))) return false;
  if(state.search && !matchSearch(md)) return false;
  if(f.premieresOnly && e.episode!==1) return false;
  if(f.format && md.format!==f.format) return false;
  if(f.genre && !((md.genres||[]).includes(f.genre))) return false;
  if(f.tag && !((md.tags||[]).some(t=>t&&t.name===f.tag&&!t.isMediaSpoiler&&(t.rank||0)>=MIN_TAG_RANK))) return false;
  if(f.minScore && (md.averageScore||0)<f.minScore) return false;
  // Season length: "how long a commitment is this". A show with no announced
  // episode count is only dropped by a *minimum*, never by a maximum — an
  // unknown length shouldn't read as a short one.
  if(f.epsMin && !(md.episodes>=f.epsMin)) return false;
  if(f.epsMax && md.episodes && md.episodes>f.epsMax) return false;
  // How far into its run this particular episode is: lets you find shows just
  // getting going, or catch the tail of a long-runner.
  if(f.airedMin && e.episode<f.airedMin) return false;
  if(f.airedMax && e.episode>f.airedMax) return false;
  return true;
}
function rangeEvents(){
  const {start,end}=visibleRange();
  const s=start.getTime();
  const e=new Date(end.getFullYear(),end.getMonth(),end.getDate(),23,59,59,999).getTime();
  const out=[];
  for(const md of state.media){
    for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]){
      // One broadcast node can produce several rows (sub and dub land on
      // different days), so the window is tested per resolved variant rather
      // than once on the raw time.
      for(const ev of entriesFor(md,n)){
        const t=ev.ts*1000;
        if(t>=s && t<=e && passFilter(ev)) out.push(ev);
      }
    }
  }
  return out;
}
// Ordering of the shows *inside* one day. Popularity is the default because a
// dense cell should lead with what most people came for; airing order and A–Z
// are the two habits people ask for instead.
function daySorter(){
  switch(state.daySort){
    case "time":  return (a,b)=>a.ts-b.ts;
    case "alpha": return (a,b)=>title(a.media).localeCompare(title(b.media));
    case "score": return (a,b)=>(b.media.averageScore||0)-(a.media.averageScore||0);
    default:      return (a,b)=>(b.media.popularity||0)-(a.media.popularity||0);
  }
}
function mapByDay(evs){
  const m=new Map(), cmp=daySorter();
  for(const e of evs){ const k=dayKeyTs(e.ts); if(!m.has(k)) m.set(k,[]); m.get(k).push(e); }
  for(const arr of m.values()) arr.sort(cmp);
  return m;
}

/* ---------- countdown (live) ---------- */
function countdown(ts){
  let s=Math.floor(ts-Date.now()/1000);
  if(s<=0) return "aired";
  const d=Math.floor(s/86400); s-=d*86400;
  const h=Math.floor(s/3600); s-=h*3600;
  const m=Math.floor(s/60); s-=m*60;
  if(d>0) return `${d}d ${h}h`;
  if(h>0) return `${h}h ${m}m`;
  if(m>0) return `${m}m ${s}s`;
  return `${s}s`;
}
// A countdown that ticks: tickCountdowns() refreshes every element once a second.
function cdLive(ts){ return `<span class="cd-live" data-air="${ts}">${countdown(ts)}</span>`; }
function tickCountdowns(){
  const els=document.querySelectorAll(".cd-live");
  if(!els.length) return;
  for(const el of els){ const ts=+el.dataset.air; if(ts){ const t=countdown(ts); if(el.textContent!==t) el.textContent=t; } }
}

/* ---------- local timezone + add-to-calendar ---------- */
function tzShort(){
  try{ const p=new Intl.DateTimeFormat([], {timeZoneName:"short"}).formatToParts(new Date()).find(x=>x.type==="timeZoneName"); return p?p.value:""; }
  catch(e){ return ""; }
}
const TZ_SHORT=tzShort();
const pad2=n=>String(n).padStart(2,"0");
function icsStamp(d){ return d.getUTCFullYear()+pad2(d.getUTCMonth()+1)+pad2(d.getUTCDate())+"T"+pad2(d.getUTCHours())+pad2(d.getUTCMinutes())+pad2(d.getUTCSeconds())+"Z"; }
function icsDate(d){ return d.getUTCFullYear()+pad2(d.getUTCMonth()+1)+pad2(d.getUTCDate()); }
function icsEsc(s){ return String(s==null?"":s).replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/[,;]/g,m=>"\\"+m); }
function slugFile(s){ return String(s||"event").toLowerCase().replace(/[^\w]+/g,"-").replace(/^-+|-+$/g,"").slice(0,50)||"event"; }
function buildICS(cd){
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Tsuzuki//tsuzuki.top//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT","UID:"+cd.uid,"DTSTAMP:"+icsStamp(new Date())];
  if(cd.allDay){ L.push("DTSTART;VALUE=DATE:"+icsDate(cd.start)); L.push("DTEND;VALUE=DATE:"+icsDate(cd.end)); }
  else { L.push("DTSTART:"+icsStamp(cd.start)); L.push("DTEND:"+icsStamp(cd.end)); }
  L.push("SUMMARY:"+icsEsc(cd.title));
  if(cd.desc) L.push("DESCRIPTION:"+icsEsc(cd.desc));
  if(cd.location) L.push("LOCATION:"+icsEsc(cd.location));
  if(cd.url) L.push("URL:"+icsEsc(cd.url));
  L.push("END:VEVENT","END:VCALENDAR");
  return L.join("\r\n");
}
function gcalUrl(cd){
  const dates=cd.allDay ? icsDate(cd.start)+"/"+icsDate(cd.end) : icsStamp(cd.start)+"/"+icsStamp(cd.end);
  const p=new URLSearchParams({action:"TEMPLATE",text:cd.title,dates,details:cd.desc||"",location:cd.location||""});
  return "https://calendar.google.com/calendar/render?"+p.toString();
}
function downloadFile(name,text,mime){
  const blob=new Blob([text],{type:mime||"text/plain"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
}
function findMediaById(id){ id=String(id); return state.media.find(x=>String(x.id)===id) || (state.extra&&state.extra.get(id)) || (state.searchResults&&state.searchResults.get(id)) || (state.full&&state.full.get(id)) || null; }
// Build calendar payloads
function episodeCalData(md,ep,ts){
  const start=new Date(ts*1000), end=new Date(ts*1000+30*60000);
  return { uid:`anical-${md.id}-${ep}@tsuzuki.netlify.app`, title:`${title(md)} — Episode ${ep}`,
    desc:`Episode ${ep} of ${title(md)} airs.${md.siteUrl?" "+md.siteUrl:""}`, location:"", url:md.siteUrl||"", start, end, allDay:false };
}
function eventCalData(e){
  const start=new Date((e.start||"")+"T00:00:00Z");
  const end=new Date(new Date(((e.end||e.start)||"")+"T00:00:00Z").getTime()+86400000); // all-day DTEND is exclusive
  return { uid:`anical-ev-${e.id}@tsuzuki.netlify.app`, title:e.title||"Anime event",
    desc:(e.desc||"")+(e.url?` ${e.url}`:""), location:e.location||"", url:e.url||"", start, end, allDay:true };
}
// Two-button "add to calendar" control. opts is stashed as JSON on the wrapper.
function calButtonsHTML(opts){
  return `<span class="calbtns" data-cal='${esc(JSON.stringify(opts))}'>
    <button class="calbtn" data-go="gcal" title="Add to Google Calendar">📅 Google</button>
    <button class="calbtn" data-go="ics" title="Download .ics for Apple Calendar / Outlook">⬇ .ics</button>
  </span>`;
}
function calDataFromOpts(o){
  if(!o) return null;
  if(o.k==="evt"){ const e=state.eventsIndex&&state.eventsIndex.get(String(o.eid)); return e?eventCalData(e):null; }
  const md=findMediaById(o.mid); return md?episodeCalData(md,o.ep,o.ts):null;
}
function relTime(d){
  const s=(Date.now()-d.getTime())/1000;
  if(s<3600) return Math.max(1,Math.round(s/60))+"m ago";
  if(s<86400) return Math.round(s/3600)+"h ago";
  if(s<604800) return Math.round(s/86400)+"d ago";
  return d.toLocaleDateString([], {month:"short",day:"numeric"});
}

/* ---------- bells ---------- */
function isFollowed(id){ return state.notify.has(String(id)); }
function bellSpan(id){ const on=isFollowed(id); return `<span class="bell ${on?'on':''}" role="button" tabindex="0" aria-label="${on?'Disable episode alerts':'Enable episode alerts'}" data-bell="${id}" title="Toggle episode alerts">${on?'🔔':'🔕'}</span>`; }
function setBellEl(el,on){
  el.classList.toggle("on",on);
  if(el.classList.contains("bellbtn")) el.textContent = on?"🔔 Alerts on":"🔕 Notify me";
  else el.textContent = on?"🔔":"🔕";
}
function toggleNotify(id){
  id=String(id);
  if(state.notify.has(id)){ state.notify.delete(id); cancelScheduledFor(id); cancelTriggeredFor(id); }
  else{
    state.notify.add(id);
    if("Notification" in window && Notification.permission==="default"){
      Notification.requestPermission().then(()=>{ updateNotifyBtn(); scheduleNotifications(); });
    }
  }
  localStorage.setItem("anical.notify", JSON.stringify([...state.notify]));
  scheduleNotifications();
  syncPushSubscription();
  document.querySelectorAll('[data-bell="'+CSS.escape(id)+'"]').forEach(el=>setBellEl(el, state.notify.has(id)));
}

/* ---------- notifications ---------- */
function updateNotifyBtn(){
  const b=$("notifyBtn");
  if(!("Notification" in window)){ b.textContent="🔕 Unsupported"; b.disabled=true; return; }
  const p=Notification.permission;
  b.textContent = p==="granted" ? "🔔 Alerts on" : p==="denied" ? "🔕 Blocked" : "🔔 Enable alerts";
  b.style.borderColor = p==="granted" ? "var(--premiere)" : "";
}
function clearAllScheduled(){ for(const id of state.scheduled.values()) clearTimeout(id); state.scheduled.clear(); }
function cancelScheduledFor(mid){
  for(const [k,id] of [...state.scheduled]){ if(k.startsWith(mid+"-")){ clearTimeout(id); state.scheduled.delete(k); } }
}
// swReg is set once the service worker is ready (see boot). When the browser
// supports Notification Triggers we schedule alerts that fire even with the app
// CLOSED; otherwise we fall back to in-page timers that only run while it's open.
let swReg=null;
const triggersSupported = ("Notification" in window) && ("showTrigger" in Notification.prototype) && ("TimestampTrigger" in window);
function noteOptionsFor(md,n){
  // n may carry the resolved release variant (see scheduleNotifications), so
  // the alert says which one it is rather than just a bare time.
  const where=n.air ? " · "+(n.air.estimated?"~":"")+AIR_LABEL[n.air.type]+(n.air.platform?" on "+n.air.platform:"") : "";
  return {
    body:"Episode "+n.episode+" airs at "+fmtTime(n.airingAt)+where,
    icon: (md.coverImage&&md.coverImage.medium)||"/icon-192.png",
    badge:"/favicon.svg",
    tag:"anical-"+md.id+"-"+n.episode,
    data:{ url: location.origin+location.pathname+"?show="+md.id }
  };
}
function showNote(titleText,opts){
  try{
    if(swReg&&swReg.showNotification) return swReg.showNotification(titleText,opts);
    const note=new Notification(titleText,opts);
    note.onclick=()=>{ window.focus(); const u=opts&&opts.data&&opts.data.url; if(u) window.open(u,"_blank","noopener"); };
    return note;
  }catch(e){ console.error("notify failed",e); }
}
function fireNotification(md,n){ showNote(title(md)+" — Episode "+n.episode, noteOptionsFor(md,n)); }
async function cancelTriggeredFor(mid){
  if(!swReg||!swReg.getNotifications) return;
  try{ const list=await swReg.getNotifications({includeTriggered:true}); for(const nt of list) if(nt.tag&&nt.tag.indexOf("anical-"+mid+"-")===0) nt.close(); }catch(e){}
}
async function clearAllTriggered(){
  if(!swReg||!swReg.getNotifications) return;
  try{ const list=await swReg.getNotifications({includeTriggered:true}); for(const nt of list) if(nt.tag&&nt.tag.indexOf("anical-")===0) nt.close(); }catch(e){}
}
/* ---------- server-driven push (works even with Tsuzuki closed/uninstalled) ---------- */
function urlBase64ToUint8Array(base64){
  const pad="=".repeat((4-base64.length%4)%4);
  const b64=(base64+pad).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(b64), out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}
// Keeps the server's record of "what to push, and when" in sync with this
// browser's followed shows + lead time. Subscribes on first opt-in, updates
// on every change, and unsubscribes once nothing is followed.
async function syncPushSubscription(){
  if(!swReg || !("pushManager" in swReg) || !("Notification" in window)) return;
  if(Notification.permission!=="granted") return;
  try{
    let sub=await swReg.pushManager.getSubscription();
    if(!state.notify.size){
      if(sub){ await fetch("/api/push/unsubscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})}).catch(()=>{}); await sub.unsubscribe().catch(()=>{}); }
      return;
    }
    if(!sub) sub=await swReg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
    await fetch("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({subscription:sub.toJSON(), mediaIds:[...state.notify], lead:state.notifyLead, airType:primaryAirType()})});
  }catch(e){ console.error("push subscription sync failed",e); }
}
async function scheduleNotifications(){
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  const now=Date.now();
  // Alert on the release the viewer tracks, not the JP broadcast — and never
  // on an episode marked as a break, which resolves to no variant at all.
  const alertNodes=md=>{
    const out=[];
    for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]){
      const v=trackedVariant(md,n);
      if(v) out.push({episode:n.episode, airingAt:v.ts, air:v});
    }
    return out;
  };
  if(triggersSupported && swReg){
    // Schedule with a timestamp trigger → fires even when Tsuzuki is closed.
    // Re-issuing with the same tag just updates an existing scheduled alert.
    for(const md of state.media){
      if(!isFollowed(md.id)) continue;
      for(const n of alertNodes(md)){
        const fireAt=n.airingAt*1000-state.notifyLead*60000;
        if(fireAt<=now) continue;                       // moment already passed
        if(fireAt-now>30*24*3600*1000) continue;        // >30d out; roll in later
        const o=noteOptionsFor(md,n); o.showTrigger=new TimestampTrigger(fireAt);
        try{ await swReg.showNotification(title(md)+" — Episode "+n.episode, o); }catch(e){}
      }
    }
    return;
  }
  // Fallback: in-page timers (only while the tab stays open).
  for(const md of state.media){
    if(!isFollowed(md.id)) continue;
    for(const n of alertNodes(md)){
      const air=n.airingAt*1000;
      if(air<=now) continue;
      const fireAt=air-state.notifyLead*60000, delay=fireAt-now;
      if(delay>24*3600*1000) continue;
      const key=md.id+"-"+n.episode;
      if(state.scheduled.has(key)) continue;
      if(delay<=0){ fireNotification(md,n); state.scheduled.set(key,0); }
      else state.scheduled.set(key, setTimeout(()=>{ fireNotification(md,n); state.scheduled.delete(key); }, delay));
    }
  }
}

/* ---------- render: views ---------- */
function dayCell(date, evs, opts){
  const m=state.anchor.getMonth();
  const out = opts.dimOut && date.getMonth()!==m;
  const isToday = keyOf(date)===keyOf(new Date());
  const cell=document.createElement("div");
  cell.className="cell"+(out?" out":"")+(isToday?" today":"");
  const num=document.createElement("div"); num.className="num";
  const label = opts.weekday ? DOW[date.getDay()]+" "+date.getDate() : date.getDate();
  num.innerHTML="<span>"+label+"</span>"+(isToday?"<span class='badge'>TODAY</span>":"");
  cell.appendChild(num);
  if(isToday && opts.nowline){
    const nl=document.createElement("div"); nl.className="nowline";
    nl.innerHTML="● now "+new Date().toLocaleTimeString([], timeOpts({hour:"numeric",minute:"2-digit"}));
    cell.appendChild(nl);
  }
  const show = opts.max ? evs.slice(0,opts.max) : evs;
  for(const e of show) cell.appendChild(eventEl(e));
  if(opts.max && evs.length>show.length){
    const more=document.createElement("div"); more.className="more";
    more.textContent="+"+(evs.length-show.length)+" more";
    kbdButton(more, "Show all "+evs.length+" releases on "+date.toLocaleDateString([], {month:"long",day:"numeric"}));
    more.onclick=()=>openDay(date,evs);
    cell.appendChild(more);
  }
  if(evs.length){ cell.style.cursor="pointer";
    cell.onclick=(ev)=>{ if(ev.target.closest(".ev")||ev.target.closest(".more"))return; openDay(date,evs); }; }
  return cell;
}
function eventEl(e){
  const md=e.media, prem=e.episode===1&&!e.brk, fin=isFinale(md,e.episode)&&!e.brk;
  const el=document.createElement("div");
  el.className="ev"+(prem?" prem":fin?" fin":"")+(isWatched(md.id)?" mine":"")+(e.brk?" brk":"");
  if(md.coverImage&&md.coverImage.color&&!prem&&!fin) el.style.borderLeftColor=md.coverImage.color;
  el.innerHTML=(md.coverImage&&md.coverImage.medium?`<img src="${md.coverImage.medium}" alt="" loading="lazy" width="22" height="30">`:"")+
    `<span class="ev-top"><span class="ev-time">${e.brk?"—":esc(fmtTime(e.ts))}</span>${airTagHTML(e)}`+
    `<span class="epn">${e.brk?"⏸":prem?"★EP1":fin?"🏁FIN":"Ep "+e.episode}</span></span>`+
    `<span class="t">${esc(title(md))}</span>`;
  const what=e.brk ? "No episode — "+(e.status&&e.status.reason||"broadcast break")
    : (e.air?AIR_LONG[e.air.type]+(e.air.estimated?" (estimated)":"")+" · ":"")+fmtTime(e.ts);
  el.title=title(md)+" · Ep "+e.episode+(fin?" (Season finale)":"")+" · "+what;
  kbdButton(el, title(md)+", episode "+e.episode+(prem?" premiere":fin?" finale":"")+", "+what);
  el.onclick=(ev)=>{ ev.stopPropagation(); openDetail(md,e.episode); };
  return el;
}
// Make a non-<button> element behave like a button for keyboard users: focusable,
// announced as a button, and activatable with Enter/Space (see the global keydown
// handler that turns those keys into a click on role="button" elements).
function kbdButton(el, label){
  el.setAttribute("role","button");
  el.setAttribute("tabindex","0");
  if(label) el.setAttribute("aria-label",label);
}
function dowHeader(forMonth){
  const h=document.createElement("div"); h.className="dow";
  for(const d of dowLabels(forMonth)){ const c=document.createElement("div"); c.textContent=d; h.appendChild(c); }
  return h;
}
// A grid of empty cells doesn't say why it's empty; this does.
function emptyNotice(wrap,map){
  if(map.size) return;
  const n=document.createElement("div"); n.className="empty";
  n.innerHTML="No releases match your filters in this range."+airEmptyHint();
  wrap.appendChild(n);
}
function renderMonth(wrap){
  const {start}=visibleRange();
  const map=mapByDay(rangeEvents());
  emptyNotice(wrap,map);
  wrap.appendChild(dowHeader(true));
  const grid=document.createElement("div"); grid.className="grid";
  for(let i=0;i<42;i++){
    const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);
    // Capped, not unlimited. With max:0 a busy Sunday ran to fifteen chips and
    // every row in the grid took its height from whichever day was fullest —
    // seven stacked lists rather than a month. Three plus a "+N more" that
    // opens the existing day modal keeps the rows even and the month scannable.
    grid.appendChild(dayCell(d, map.get(keyOf(d))||[], {dimOut:true, max:3}));
  }
  wrap.appendChild(grid);
}
function renderWeek(wrap){
  const {start}=visibleRange();
  const map=mapByDay(rangeEvents());
  emptyNotice(wrap,map);
  wrap.appendChild(dowHeader());
  const grid=document.createElement("div"); grid.className="grid week";
  let todayCell=null;
  for(let i=0;i<7;i++){
    const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);
    const c=dayCell(d, map.get(keyOf(d))||[], {dimOut:false, max:0, nowline:true});
    if(keyOf(d)===keyOf(new Date())) todayCell=c;
    grid.appendChild(c);
  }
  wrap.appendChild(grid);
  if(todayCell) requestAnimationFrame(()=>todayCell.scrollIntoView({block:"nearest",inline:"nearest"}));
}
function renderAgenda(wrap){
  // The agenda is a timeline, so days stay in date order — but within a day it
  // honours the same ordering as the grid views.
  const byDay=mapByDay(rangeEvents());
  const evs=[...byDay.values()].flat().sort((a,b)=>{
    const d=new Date(a.ts*1000), e=new Date(b.ts*1000);
    const da=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
    const db=new Date(e.getFullYear(),e.getMonth(),e.getDate()).getTime();
    return da-db;   // stable sort keeps mapByDay's within-day order intact
  });
  const cont=document.createElement("div"); cont.className="agenda";
  if(!evs.length){ cont.innerHTML="<div class='empty'>No releases match your filters in this range."+airEmptyHint()+"</div>"; wrap.appendChild(cont); return; }
  const now=Date.now()/1000;
  // Where the NOW line goes. Under chronological ordering it belongs before the
  // first unaired row. Under any other ordering rows inside a day aren't in
  // time order, so a mid-day NOW would have aired episodes below it — put it at
  // the head of the first day that isn't finished instead.
  const byDayMarker=state.daySort!=="time";
  const todayKey=keyOf(new Date());
  let lastDay=null, nowDiv=null, nowInserted=false;
  const insertNow=()=>{ const dv=document.createElement("div"); dv.className="adiv"; dv.textContent="NOW"; cont.appendChild(dv); nowDiv=dv; nowInserted=true; };
  for(const e of evs){
    const d=new Date(e.ts*1000);
    const dk=dayKeyTs(e.ts);
    const newDay=dk!==lastDay;
    // "Still has something unaired" is the whole test — a day in the past can't
    // satisfy it, so no separate date comparison is needed (and a string
    // compare on keyOf's "YYYY-M-D" would be wrong anyway: "2026-7-4" > "2026-7-15").
    if(!nowInserted && byDayMarker && newDay && (byDay.get(dk)||[e]).some(x=>x.ts>now)) insertNow();
    if(!nowInserted && !byDayMarker && e.ts>now) insertNow();
    if(newDay){
      const isToday=keyOf(d)===todayKey;
      const h=document.createElement("div"); h.className="aday"+(isToday?" istoday":"");
      h.textContent=d.toLocaleDateString([], {weekday:"long",month:"long",day:"numeric"})+(isToday?"  ·  TODAY":"");
      cont.appendChild(h); lastDay=dk;
    }
    cont.appendChild(agendaRow(e,now));
  }
  if(!nowInserted){ const dv=document.createElement("div"); dv.className="adiv"; dv.textContent="NOW (all below already aired)"; cont.appendChild(dv); nowDiv=dv; }
  wrap.appendChild(cont);
  if(nowDiv) requestAnimationFrame(()=>nowDiv.scrollIntoView({block:"center"}));
}
function agendaRow(e,now){
  const md=e.media, prem=e.episode===1&&!e.brk, fin=isFinale(md,e.episode)&&!e.brk, past=e.ts<=now;
  const row=document.createElement("div");
  row.className="arow"+(prem?" prem":fin?" fin":"")+(past?" past":"")+(isWatched(md.id)?" mine":"")+(e.brk?" brk":"");
  const what=e.brk?"no episode this week":fmtTime(e.ts);
  kbdButton(row, title(md)+", episode "+e.episode+(prem?" premiere":fin?" finale":"")+", "+what);
  row.innerHTML=
    `<span class="atime">${e.brk?"—":fmtTime(e.ts)}</span>`+
    (md.coverImage&&md.coverImage.medium?`<img src="${md.coverImage.medium}" alt="" loading="lazy" width="40" height="54">`:"")+
    `<div class="ainfo"><div class="at">${esc(title(md))}</div>
      <div class="ameta">
        ${airPillHTML(e)}${statusPillHTML(e)}
        ${prem?'<span class="pill prem">PREMIERE</span>':`<span class="pill">Ep ${e.episode}</span>`}
        ${fin?'<span class="pill fin">🏁 FINALE</span>':''}
        <span class="pill">${FMT_LABEL[md.format]||md.format||"?"}</span>
        ${md.averageScore?`<span class="pill score">★ ${md.averageScore}</span>`:""}
        ${myMarks(md.id)}
        ${(past||e.brk)?"":`<span class="pill cd">in ${cdLive(e.ts)}</span>`}
        ${starSpan(md.id)}${bellSpan(md.id)}
      </div></div>`;
  row.onclick=(ev)=>{ if(ev.target.closest("[data-bell]")||ev.target.closest("[data-watch]"))return; openDetail(md,e.episode); };
  return row;
}
function renderView(){
  // a selection belongs to the view it was made in — leaving that view drops it
  if(bulkView && bulkView!==state.viewMode) bulkClear();
  sweepAutoProgress();   // before the paint, so the counters below are already current
  // Both before the paint and before any view: state.media is whatever THIS
  // range loaded, so a rated show has to be pinned while it is still in there,
  // and the ones no range contains have to be fetched. Every view reads the
  // taste vectors somewhere, so neither of these belongs to the calendar.
  keepRatedMedia();
  hydrateWatching();
  applyDensity();        // density is per view (Day 28), so it moves when the view does
  paintActiveFilters();  // one hook for every path that can change a filter (Day 30)
  paintScoreSpread();    // no-op unless Settings is open — see the Day 16 block
  if(state.viewMode==="show"||state.viewMode==="browse"||state.viewMode==="gems"){
    hideDashboard(); hideEvents(); hideBoard(); hideLists(); hideTaste(); hideRecs();
    if(state.viewMode==="show") renderShowPage();
    else if(state.viewMode==="gems") renderGems();
    else renderBrowse();
    return;
  }
  hideDiscover();
  if(state.viewMode==="dashboard"){ hideEvents(); hideBoard(); hideLists(); hideTaste(); renderDashboard(); return; }
  if(state.viewMode==="events"){ hideDashboard(); hideBoard(); hideLists(); hideTaste(); renderEvents(); return; }
  if(state.viewMode==="board"){ hideDashboard(); hideEvents(); hideLists(); hideTaste(); renderBoard(); return; }
  if(state.viewMode==="lists"){ hideDashboard(); hideEvents(); hideBoard(); hideTaste(); renderLists(); return; }
  if(state.viewMode==="taste"){ hideDashboard(); hideEvents(); hideBoard(); hideLists(); hideRecs(); renderTaste(); return; }
  if(state.viewMode==="recs"){ hideDashboard(); hideEvents(); hideBoard(); hideLists(); hideTaste(); renderRecs(); return; }
  hideDashboard(); hideEvents(); hideBoard(); hideLists(); hideTaste(); hideRecs();
  const wrap=$("calWrap"); wrap.innerHTML="";
  wrap.classList.toggle("cal", true);
  if(state.viewMode==="week") renderWeek(wrap);
  else if(state.viewMode==="agenda") renderAgenda(wrap);
  else renderMonth(wrap);
  renderSidebars();
  // Additive strips over a calendar that has already painted — a failure in one
  // must not cost the alerts scheduled below it.
  for(const paint of [paintPresets, paintHomeRails]){ try{ paint(); }catch(e){ console.error(paint.name, e); } }
  scheduleNotifications();
}

/* ---------- sidebars ---------- */
function renderSidebars(){
  const {start,end}=visibleRange();
  const s=start.getTime(), e=new Date(end.getFullYear(),end.getMonth(),end.getDate(),23,59,59).getTime();
  // premieres within visible range
  const prem=[];
  for(const md of state.media){
    if(excluded(md)) continue;
    const ep1=((md.airingSchedule&&md.airingSchedule.nodes)||[]).find(n=>n.episode===1);
    if(ep1){
      // Date the premiere by the release being tracked — a dub premiere is
      // weeks off the broadcast, and the rail should agree with the calendar.
      const v=trackedVariant(md,ep1);
      if(v){ const t=v.ts*1000; if(t>=s&&t<=e) prem.push({md,ts:v.ts}); }
    }
  }
  prem.sort((a,b)=>a.ts-b.ts);
  $("premieres").innerHTML = prem.length
    ? prem.map(p=>prow(p.md,"Premieres "+new Date(p.ts*1000).toLocaleDateString([], {month:"short",day:"numeric"}),true)).join("")
    : "<div class='empty'>No new premieres in this range.</div>";

  const now=Date.now()/1000;
  const up=state.media.filter(md=>md.status==="NOT_YET_RELEASED" && !nsfwHidden(md) && !isHidden(md.id)).map(md=>{
    const n=(md.airingSchedule&&md.airingSchedule.nodes)||[];
    const next=n.map(x=>x.airingAt).filter(t=>t>now).sort((a,b)=>a-b)[0] || sdTs(md.startDate);
    return {md,ts:next};
  }).sort((a,b)=>(a.ts||9e15)-(b.ts||9e15)).slice(0,14);
  $("announce").innerHTML = up.length
    ? up.map(u=>prow(u.md, u.ts?("Starts "+new Date(u.ts*1000).toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"})):"TBA")).join("")
    : "<div class='empty'>No upcoming announcements in the fetched seasons.</div>";

  /* ---------- Next up ----------
     Shows with an episode waiting, ordered by when that episode aired, newest
     first. Ranking by AniList popularity — which this did — answered "which of
     these is the bigger show", a question nobody standing in front of their own
     watchlist is asking. The date is on the row, so the order is legible rather
     than merely different.

     The pool is the loaded seasons *plus* state.extra, which hydrateWatching()
     fills with Watching shows those seasons don't contain. Falling behind on
     something from last season used to delete it from this rail entirely, which
     is precisely when a "continue watching" rail is worth having. */
  const cwSeen=new Set(), cw=[];
  for(const md of [...state.media, ...state.extra.values()]){
    const mid=String(md.id);
    if(cwSeen.has(mid)) continue; cwSeen.add(mid);
    if(nsfwHidden(md)||isHidden(mid)) continue;
    const st=getStatusOf(mid);
    if(st==="dropped"||st==="completed") continue;   // neither is "continue watching"
    const p=getProgress(mid), aired=availableEp(md);
    if(aired<=p) continue;                           // nothing waiting — which is how an item leaves once marked watched
    if(!p && st!=="watching") continue;              // never started, and never claimed to be watching it
    cw.push({md, p, ts:epAiredAt(md,p+1)});
  }
  cw.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const cwCard=$("cwCard");
  if(cwCard){
    if(cw.length){
      cwCard.style.display="";
      $("continueWatching").innerHTML=cw.slice(0,12).map(x=>prow(x.md,
        `▶ Next: Episode ${x.p+1}`+(x.ts?` · aired ${new Date(x.ts*1000).toLocaleDateString([], {month:"short",day:"numeric"})}`:""))).join("");
    }
    else cwCard.style.display="none";
  }

  // trending now — by AniList's trending score (SFW + not hidden)
  const trend=state.media.filter(md=>!nsfwHidden(md)&&!isHidden(md.id)&&(md.trending||0)>0)
    .sort((a,b)=>(b.trending||0)-(a.trending||0)).slice(0,8);
  $("trending").innerHTML = trend.length
    ? trend.map(md=>{ const na=nextAir(md); return prow(md, na?("Next: "+new Date(na.airingAt*1000).toLocaleDateString([], {month:"short",day:"numeric"})):"🔥 Trending now"); }).join("")
    : "<div class='empty'>No trending data right now.</div>";

  // recently viewed rail
  const rv=(state.recent||[]).filter(r=>r&&!isHidden(r.id));
  const rvCard=$("rvCard");
  if(rvCard){
    if(rv.length){ rvCard.style.display=""; $("recentRail").innerHTML=`<div class="wn-list">`+rv.slice(0,18).map(r=>`<img class="wn-cover" role="button" tabindex="0" data-rv="${esc(String(r.id))}" src="${esc(r.img||"")}" alt="${esc(r.t||"")}" title="${esc(r.t||"")}" loading="lazy" width="30" height="40">`).join("")+`</div>`; }
    else rvCard.style.display="none";
  }

  document.querySelectorAll(".prow[data-mid]").forEach(el=>{
    // findMediaById, not a scan of state.media: a Next up row can be a show
    // hydrated into state.extra, which state.media has never heard of.
    el.onclick=(ev)=>{ if(ev.target.closest("[data-bell]")||ev.target.closest("[data-watch]"))return; const md=findMediaById(el.dataset.mid); if(md) openDetail(md,1); };
  });
  document.querySelectorAll("#recentRail [data-rv]").forEach(el=>{ el.onclick=()=>openShowById(el.dataset.rv); });
  try{ paintDiscovery(); }catch(e){ console.error("discovery", e); }   // Day 82
  // (hydrateWatching runs from renderView now — every view needs it, not just this one.)
}
/* ---------- keeping what you rated resolvable (Day 91) ----------
   state.media is REPLACED WHOLESALE on every range load, so it is the wrong
   place for a rated show to live. The board loads your library into it and all
   eleven of your ratings resolve; you open the calendar, the array becomes a
   date range, nine of them stop existing, and the taste profile, the predictor
   and every "you have N rated shows" line quietly collapse — the same eleven
   ratings reading as two. state.extra is the pool that survives that, so the
   moment a rated show is visible in the array on its way past, it is copied
   there and stops depending on which view you are standing in.

   Cheap enough to run on every paint: one Set build over the ratings, and it
   does nothing at all once everything you have rated is already pinned. */
function keepRatedMedia(){
  for(const id of Object.keys(state.ratings)){
    if(!getRating(id) || state.extra.has(String(id))) continue;
    const md=findMediaById(id);
    if(md && md.id) state.extra.set(String(md.id), md);
  }
  // No cache to clear: tasteCache is keyed on state.extra.size, so growing the
  // pool invalidates it on its own. This only has to run before anything reads
  // the vectors, which is why it sits at the top of renderView().
}
/* The Watching shows no loaded season contains — you fell behind on something
   from last season, or it is simply older than the range on screen — plus every
   show you have RATED, for the reason above: a rating older than the seasons on
   screen is exactly the case that made the counts disagree with themselves, and
   fetching it is what makes the profile the size you think it is. Fetched a
   few at a time (AniList is rate-limited, and our own catalog answers most of
   these), once each per session: a show that 404s must not be retried on every
   render. Nothing here is persisted; the next load hydrates again from whatever
   the seasons on screen are missing. */
const cwTried=new Set();
let cwHydrating=false;
function hydrateWanted(){
  const want=new Set();
  for(const id of state.watch) if(getStatusOf(String(id))==="watching") want.add(String(id));
  for(const id of Object.keys(state.ratings)) if(getRating(id)) want.add(String(id));
  return [...want].filter(id=>
    !cwTried.has(id) && !state.extra.has(id) &&
    !state.media.some(m=>String(m.id)===id));
}
async function hydrateWatching(){
  if(cwHydrating) return;
  const missing=hydrateWanted().slice(0,8);
  if(!missing.length) return;
  cwHydrating=true;
  let got=0;
  for(const id of missing){
    cwTried.add(id);
    try{ const md=await fetchMediaById(id); if(md&&md.id){ state.extra.set(String(md.id), md); got++; } }
    catch(err){ console.warn("Next up: couldn't fetch "+id, err); }
  }
  cwHydrating=false;
  // Every id in this pass is now in cwTried, so the render below can only start
  // another pass when there are more than eight left — which terminates.
  if(got) renderView();
}
function sdTs(sd){ return sd&&sd.year?Math.floor(new Date(sd.year,(sd.month||1)-1,sd.day||1).getTime()/1000):null; }
function prow(md,sub,prem){
  const score=md.averageScore?`<span class="pill score">★ ${md.averageScore}</span>`:"";
  return `<div class="prow${isWatched(md.id)?" mine":""}" role="button" tabindex="0" aria-label="${esc(title(md))}" data-mid="${md.id}">
    <img src="${md.coverImage&&md.coverImage.medium?md.coverImage.medium:""}" alt="" loading="lazy" width="44" height="60">
    <div class="info">
      <div class="pt">${esc(title(md))}</div>
      <div class="meta">${prem?'<span class="pill prem">EP1</span>':''}<span class="pill">${FMT_LABEL[md.format]||md.format||"?"}</span>${score}${myMarks(md.id)}${starSpan(md.id)}${bellSpan(md.id)}</div>
      <div class="meta" style="margin-top:3px">${esc(sub)}</div>
    </div></div>`;
}

/* ---------- news ---------- */
const ANN_FEED="https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us";
async function fetchNews(){
  const url="https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(ANN_FEED);
  const res=await fetch(url,{headers:{"Accept":"application/json"}});
  if(!res.ok) throw new Error("news HTTP "+res.status);
  const json=await res.json();
  if(json.status!=="ok"||!Array.isArray(json.items)) throw new Error("news feed error");
  return json.items;
}
async function loadNews(){
  const box=$("news"); box.innerHTML="<div class='empty'>Loading latest news…</div>";
  try{
    let items=await fetchNews();
    const anime=items.filter(i=>(i.categories||[]).some(c=>/anime/i.test(c)));
    if(anime.length>=5) items=anime;
    box.innerHTML=items.slice(0,18).map(i=>{
      const d=new Date(i.pubDate.replace(" ","T")+"Z");
      const cat=(i.categories&&i.categories[0])?i.categories[0]:"News";
      return `<a class="prow" href="${esc(i.link)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <div class="info"><div class="pt" style="white-space:normal;line-height:1.3">${esc(decodeEntities(i.title))}</div>
        <div class="meta" style="margin-top:4px"><span class="pill">${esc(cat)}</span><span>${isNaN(d)?"":relTime(d)}</span></div></div></a>`;
    }).join("");
  }catch(err){
    console.error("news:",err);
    box.innerHTML="<div class='empty'>Couldn't load live news right now.<br><a href='https://www.animenewsnetwork.com/news/' target='_blank' rel='noopener'>Open Anime News Network →</a></div>";
  }
}

/* ---------- modals ---------- */
// Inline trailer: a lightweight thumbnail "facade" that swaps to an iframe on click
// (keeps the modal fast and avoids loading YouTube until the user actually plays).
function trailerEmbedHTML(md){
  const tr=md.trailer; if(!tr||!tr.id) return "";
  let src;
  if(tr.site==="youtube") src=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(tr.id)}`;
  else if(tr.site==="dailymotion") src=`https://www.dailymotion.com/embed/video/${encodeURIComponent(tr.id)}`;
  else return "";
  const thumb = tr.site==="youtube" ? `https://i.ytimg.com/vi/${encodeURIComponent(tr.id)}/hqdefault.jpg`
              : (md.bannerImage || (md.coverImage&&md.coverImage.large) || "");
  return `<div class="trailer" role="button" tabindex="0" aria-label="Play trailer" data-embed="${esc(src)}" title="Play trailer">
    ${thumb?`<img src="${esc(thumb)}" alt="${esc(title(md))} trailer" loading="lazy">`:""}
    <span class="tplay">▶</span><span class="tlabel">▶ Play trailer</span>
  </div>`;
}
/* ---------- franchise timeline ----------
   AniList hands a title its *direct* relations and nothing else, so a timeline
   built from md.relations alone is only ever one hop wide: open season 3 and
   you get seasons 2 and 4, never season 1, never the movie that hangs off it.
   And sorting on the year alone leaves two entries from the same year in
   whatever order the edges happened to arrive in — which for a split-cour show
   plus its recap movie is exactly the pair you most want ordered.

   So this renders twice. The first pass, from what the media record already
   carries, paints instantly. Then /api/v1/franchise/<id> walks the whole
   relation graph server-side (cached and shared between visitors) and replaces
   it with the complete list. If that call fails, the first pass stays. */
const REL_LABEL={PREQUEL:"Prequel",SEQUEL:"Sequel",PARENT:"Parent story",SIDE_STORY:"Side story",SPIN_OFF:"Spin-off",ALTERNATIVE:"Alternative",SUMMARY:"Summary",COMPILATION:"Compilation",CONTAINS:"Contains",OTHER:"Related"};
const FTL_FMT={TV:"TV",TV_SHORT:"Short",MOVIE:"Movie",ONA:"ONA",OVA:"OVA",SPECIAL:"Special",MUSIC:"Music"};
// Release order. An entry known only to the year sorts after everything
// precisely dated in that year — "sometime in 2027" is later than 2027-01-12,
// not earlier — and an entry with no date at all sorts last, under TBA.
function ftlKey(n){
  const d=n.startDate||{};
  return d.year ? [d.year, d.month||99, d.day||99, +n.id] : [Infinity,0,0,+n.id];
}
function ftlCompare(a,b){
  const ka=ftlKey(a), kb=ftlKey(b);
  for(let i=0;i<ka.length;i++) if(ka[i]!==kb[i]) return ka[i]-kb[i];
  return 0;
}
function ftlWhen(n){
  const d=n.startDate||{};
  if(!d.year) return "TBA";
  return d.month ? `${MONTHS[d.month-1].slice(0,3)} ${d.year}` : String(d.year);
}
// Direct relations only — what we can draw before the graph walk comes back.
function franchiseSeed(md){
  const seen=new Set([String(md.id)]);
  const out=[{id:String(md.id), title:md.title, startDate:md.startDate, format:md.format, relationLabel:null, isRoot:true}];
  for(const e of (md.relations&&md.relations.edges)||[]){
    const n=e&&e.node;
    if(!n||n.type!=="ANIME"||!REL_LABEL[e.relationType]||seen.has(String(n.id))) continue;
    seen.add(String(n.id));
    out.push({id:String(n.id), title:n.title, startDate:n.startDate, format:n.format,
      coverImage:n.coverImage, relationLabel:REL_LABEL[e.relationType], isRoot:false});
  }
  return out;
}
function franchiseCoverOf(en){
  if(en.coverImage&&en.coverImage.medium) return en.coverImage.medium;
  const known=findMediaById(en.id);
  return (known&&known.coverImage&&known.coverImage.medium)||"";
}
function franchiseListHTML(entries,{partial=false,truncated=false}={}){
  const list=entries.slice().sort(ftlCompare);
  const items=list.map((en,i)=>{
    const t=title(en);
    const badge=[FTL_FMT[en.format]||en.format||"", en.isRoot?"this":en.relationLabel||""].filter(Boolean).join(" · ");
    return `<button class="ftl-item ${en.isRoot?'cur':''}" ${en.isRoot?'':`data-rel="${esc(String(en.id))}"`} title="${esc(t+(badge?" — "+badge:""))}">
      <span class="ftl-n">${i+1}</span>
      <img src="${esc(franchiseCoverOf(en))}" alt="" loading="lazy">
      <span class="ftl-y">${esc(ftlWhen(en))}</span>
      <span class="ftl-t">${esc(t)}</span>
      ${badge?`<span class="ftl-k">${esc(badge)}</span>`:""}
    </button>`;
  }).join("");
  const note = partial ? `<span class="tznote">· direct relations — loading the rest…</span>`
    : truncated ? `<span class="tznote">· ${list.length} entries (largest franchises are capped)</span>`
    : `<span class="tznote">· ${list.length} ${list.length===1?"entry":"entries"}, in release order</span>`;
  return `<h4 style="margin:0 0 6px">Franchise timeline ${note}</h4><div class="ftl">${items}</div>`;
}
function relationsHTML(md){
  const seed=franchiseSeed(md);
  // A show with no known relations still gets the slot: the graph walk may find
  // entries this record never linked to.
  return `<div id="franchiseSlot" data-fid="${esc(String(md.id))}" data-seeded="${seed.length>1?1:0}">${seed.length>1?franchiseListHTML(seed,{partial:true}):`<div class="ftl-empty">Looking for other entries in this franchise…</div>`}</div>`;
}
const franchiseCache=new Map();
async function loadFranchise(id){
  id=String(id);
  // The graph walk didn't answer. Leave a seeded list alone — direct relations
  // are still a real timeline — but don't leave "looking…" on screen forever.
  const giveUp=()=>{
    const s=$("franchiseSlot");
    if(!s||s.dataset.fid!==id||s.dataset.seeded==="1") return;
    s.innerHTML=`<div class="ftl-empty">No other entries in this franchise.</div>`;
    setModalTabEmpty("franchise",true);
  };
  let data=franchiseCache.get(id);
  if(!data){
    const ours=await apiGet(`/franchise/${encodeURIComponent(id)}`,{timeout:9000});
    if(!ours||!Array.isArray(ours.entries)) return giveUp();
    data=ours; franchiseCache.set(id,data);
  }
  const slot=$("franchiseSlot");
  if(!slot||slot.dataset.fid!==id||String(state._modalId)!==id) return;   // modal moved on
  const entries=data.entries.filter(en=>!(state.hideNSFW&&en.isAdult===true));
  if(entries.length>1){ slot.innerHTML=franchiseListHTML(entries,{truncated:data.truncated}); }
  else { slot.innerHTML=`<div class="ftl-empty">No other entries in this franchise.</div>`; setModalTabEmpty("franchise",true); }
}
// Streaming "where to watch" links (AniList externalLinks, type STREAMING).
function streamChipsHTML(md){
  const links=(md.externalLinks||[]).filter(l=>l&&l.type==="STREAMING"&&l.url);
  if(!links.length) return "";
  const seen=new Set();
  const chips=links.filter(l=>{ const k=(l.site||l.url).toLowerCase(); if(seen.has(k))return false; seen.add(k); return true; }).map(l=>{
    const col=l.color||"#22d3ee";
    const icon=l.icon?`<img src="${esc(l.icon)}" alt="" width="14" height="14" style="border-radius:3px;margin-right:6px" loading="lazy">`:"";
    return `<a class="stream-chip" href="${esc(l.url)}" target="_blank" rel="noopener" style="border-color:${esc(col)}">${icon}${esc(l.site||"Watch")}</a>`;
  }).join("");
  return `<div class="watch-row"><span class="watch-label">📺 Where to watch</span>${chips}</div>`;
}
function openDetail(md,episode){
  saveNoteNow();   // the pop-up is about to be rebuilt — don't lose a half-typed note
  pushRecent(md);
  state._modalId=md.id; state._modalKind="show";
  // Title + romaji subtitle (only when it differs from the shown title).
  const primaryTitle=title(md);
  const romaji=(md.title&&md.title.romaji)||"";
  const showRomaji=romaji && romaji!==primaryTitle;
  $("modalTitle").innerHTML=esc(primaryTitle)+(showRomaji?`<small class="mtitle-sub">${esc(romaji)}</small>`:"");
  const genres=(md.genres||[]).slice(0,5).map(g=>`<span class="pill">${esc(g)}</span>`).join(" ");
  const studio=(md.studios&&md.studios.nodes&&md.studios.nodes[0])?md.studios.nodes[0].name:"";
  const desc=(md.description||"").replace(/<[^>]+>/g," ").trim();
  const cover=md.coverImage?(md.coverImage.large||md.coverImage.medium):"";
  const on=isFollowed(md.id);
  const na=nextAir(md);
  const naAir = na&&na.air
    ? `<span class="pill air air-${na.air.type}${na.air.estimated?" est":""}" title="${esc(AIR_LONG[na.air.type]+(na.air.platform?" · "+na.air.platform:"")+(na.air.estimated?" — estimated from the broadcast time, not confirmed":""))}">${na.air.estimated?"~":""}${AIR_LABEL[na.air.type]}${na.air.platform?" · "+esc(na.air.platform):""}</span>`
    : "";
  const nextBlock = na
    ? `<div class="nextair">🕒 <span>Next episode</span>
        <span class="na-when">Ep ${na.episode} · ${new Date(na.airingAt*1000).toLocaleString([], timeOpts({weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</span>
        ${naAir}
        <span class="tznote">${TZ_SHORT?"("+esc(TZ_SHORT)+" · your time)":"(your local time)"}</span>
        <span class="pill cd">in ${cdLive(na.airingAt)}</span>
        ${calButtonsHTML({k:"ep",mid:md.id,ep:na.episode,ts:na.airingAt})}</div>`
    : "";
  const notices=scheduleNoticesHTML(md);
  const sched=renderScheduleList(md);
  const epCount=((md.airingSchedule&&md.airingSchedule.nodes)||[]).length;
  $("modalBody").innerHTML=`
    <div class="mtabs" role="tablist" aria-label="Show details">
      ${mtabHTML("overview","Overview")}
      ${sched?mtabHTML("schedule","Schedule",epCount):""}
      ${mtabHTML("franchise","Franchise")}
      ${mtabHTML("cast","Cast")}
      ${mtabHTML("related","More like this")}
    </div>
    <div class="mpanel" id="mpanel-overview" data-panel="overview" role="tabpanel">
    <div class="detail-grid">
      <div class="detail-poster">
        ${cover?`<img src="${cover}" alt="" width="300" height="450">`:""}
      </div>
      <div class="detail-main">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="pill">${FMT_LABEL[md.format]||md.format||"?"}</span>
          ${md.episodes?`<span class="pill">${md.episodes} eps</span>`:""}
          ${md.averageScore?`<span class="pill score">★ ${md.averageScore}</span>`:""}
          <span class="pill">${(md.status||"").replace(/_/g," ").toLowerCase()}</span>
        </div>
        ${studio?`<div style="color:var(--muted);font-size:13px">Studio: ${esc(studio)}</div>`:""}
        ${genres?`<div>${genres}</div>`:""}
        <div class="st-row">
          <span class="st-row-label" data-st-label="${md.id}" data-on-label="🗂️ On your board:" data-off-label="🗂️ Add to your board:">${getStatusOf(md.id)?"🗂️ On your board:":"🗂️ Add to your board:"}</span>
          ${statusPickerHtml(md.id,"")}
          <span class="st-hint">One click adds it to My List and your board. Click the highlighted status again to remove it.</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a class="btn-link primary-soft" href="${showHref(md.id)}" data-showpage="${esc(String(md.id))}" title="Staff, every episode, the score distribution, tags and similar shows">📄 Full page</a>
          <button data-watch="${md.id}">${isWatched(md.id)?"★ In My List":"☆ Add to My List"}</button>
          <button class="bellbtn ${on?'on':''}" data-bell="${md.id}">${on?"🔔 Alerts on":"🔕 Notify me"}</button>
          <button data-share="${md.id}" title="Copy a shareable link to this show">🔗 Share</button>
          <button data-report="${md.id}" title="Tell us an air time, delay or dub date is wrong">⚠ Report a wrong time</button>
          <button data-hide="${md.id}" title="Hide this show everywhere">${isHidden(md.id)?"✓ Unhide":"🚫 Not interested"}</button>
          <a href="${md.siteUrl||"#"}" target="_blank" rel="noopener">AniList →</a>
        </div>
        ${notices}
        ${nextBlock}
        ${streamChipsHTML(md)}
        ${progressRowHtml(md)}
        ${datesRowHtml(md)}
        ${predictRowHtml(md)}
        ${libraryRowHtml(md)}
        <div class="st-row">
          <span class="st-row-label">⭐ Your rating:</span>
          ${ratingPickerHtml(md.id)}
          ${ratingOutHtml(md.id)}
          <span class="st-hint">Your own score, separate from the community ★ average. Click the highlighted number to clear it.</span>
          ${axesRowHtml(md)}
        </div>
        <div class="nt-row">
          <label class="st-row-label" for="noteBox">📝 Private notes</label>
          ${noteTemplatesHtml()}
          <div class="nt-wrap${isSpoilerNote(md.id)&&!noteRevealed(md.id)?" hid":""}" data-notewrap="${md.id}">
            <textarea id="noteBox" class="note-box" data-note="${md.id}" maxlength="${NOTE_MAX}" rows="3"
              placeholder="Where you left off, who recommended it, why you dropped it…">${esc(getNote(md.id))}</textarea>
            <button type="button" class="nt-reveal" data-notereveal="${md.id}">👁 Spoiler — tap to show</button>
          </div>
          <div class="nt-foot">
            <span class="tznote" id="noteState"></span>
            <span class="nt-spacer"></span>
            <button type="button" class="nt-spoil${isSpoilerNote(md.id)?" on":""}" data-notespoil="${md.id}"
              aria-pressed="${isSpoilerNote(md.id)?"true":"false"}"
              title="Blur this note everywhere until it's tapped">${isSpoilerNote(md.id)?"🙈 Spoiler":"🙈 Mark spoiler"}</button>
            <span class="tznote" id="noteCount">${getNote(md.id).length} / ${NOTE_MAX}</span>
          </div>
          <div class="tznote">Saved on this device only — never uploaded.</div>
        </div>
        <div class="st-row">
          <span class="st-row-label">📚 Your lists:</span>
          ${collectionPickerHtml(md.id)}
          <span class="st-hint">Your own collections, separate from the watch statuses — a show can be in as many as you like. Arrange them in the 📚 Lists view.</span>
        </div>
        ${trailerEmbedHTML(md)}
        ${desc?`<p class="desc">${esc(desc)}</p>`:""}
      </div>
    </div>
    </div>
    ${sched?`<div class="mpanel" id="mpanel-schedule" data-panel="schedule" role="tabpanel" hidden>${sched}</div>`:""}
    <div class="mpanel" id="mpanel-franchise" data-panel="franchise" role="tabpanel" hidden>${relationsHTML(md)}</div>
    <div class="mpanel" id="mpanel-cast" data-panel="cast" role="tabpanel" hidden><div id="castSlot" class="slot-loading">Loading cast…</div></div>
    <div class="mpanel" id="mpanel-related" data-panel="related" role="tabpanel" hidden>
      <h4 style="margin:0 0 6px">Closest matches</h4>
      <div id="simSlot"></div>
      <div id="recsSlot" class="slot-loading">Loading recommendations…</div>
      <div id="studioSlot"></div>
    </div>`;
  wireModalTabs();
  $("overlay").classList.add("on");
  loadModalExtras(md.id);
  loadFranchise(md.id);
}
/* ---------- show-modal sub-menus ----------
   The detail modal had grown into one long scroll: meta, actions, ratings,
   notes, collections, trailer, synopsis, the whole airing schedule, the
   franchise, the cast and two recommendation rails, in that order. Splitting it
   into tabs means the schedule and the franchise get room to be complete
   instead of being squeezed into a side column, and the parts that need a
   network round trip (cast, recommendations) load without pushing anything
   the reader is looking at further down the page. */
const MTAB_DEFAULT="overview";
function mtabHTML(key,label,count){
  const on=key===MTAB_DEFAULT;
  return `<button class="mtab${on?" on":""}" role="tab" data-mtab="${key}" aria-selected="${on}" aria-controls="mpanel-${key}">${esc(label)}${count?`<span class="mtab-n">${count}</span>`:""}</button>`;
}
function showModalTab(key){
  const body=$("modalBody");
  const tabs=[...body.querySelectorAll(".mtab")].filter(t=>!t.hidden);
  if(!tabs.some(t=>t.dataset.mtab===key)) key=MTAB_DEFAULT;
  state._modalTab=key;
  tabs.forEach(t=>{ const on=t.dataset.mtab===key; t.classList.toggle("on",on); t.setAttribute("aria-selected",on?"true":"false"); });
  body.querySelectorAll(".mpanel").forEach(p=>{ p.hidden = p.dataset.panel!==key; });
  // Day 76: the closest matches cost a request, so they load when the tab is
  // actually opened rather than on every pop-up.
  if(key==="related" && state._modalKind==="show"){
    const s=$("simSlot"), md=findMediaById(state._modalId);
    if(s && md && s.dataset.sim!==String(md.id)) loadSimilar(md,"simSlot");
  }
}
function wireModalTabs(){
  const body=$("modalBody");
  const tabs=[...body.querySelectorAll(".mtab")];
  tabs.forEach(t=>{
    t.onclick=()=>showModalTab(t.dataset.mtab);
    // Arrow keys walk the tab strip, the way a tablist is expected to behave.
    t.onkeydown=e=>{
      if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft") return;
      e.preventDefault();
      const live=tabs.filter(x=>!x.hidden);
      const i=live.indexOf(t);
      const next=live[(i+(e.key==="ArrowRight"?1:live.length-1))%live.length];
      next.focus(); showModalTab(next.dataset.mtab);
    };
  });
  // Reopening a show keeps you where you were, unless that tab isn't on this
  // one (a show with no schedule has no Schedule tab).
  showModalTab(state._modalTab||MTAB_DEFAULT);
}
// A lazily-filled tab that came back with nothing shouldn't stay clickable.
function setModalTabEmpty(key,empty){
  const body=$("modalBody"), tab=body.querySelector(`.mtab[data-mtab="${key}"]`);
  if(!tab) return;
  tab.hidden=!!empty;
  if(empty&&state._modalTab===key) showModalTab(MTAB_DEFAULT);
}
// Delays, breaks and notes for this show, surfaced at the top of the modal so
// "why is there no episode this week" is answered before the schedule is read.
function scheduleNoticesHTML(md){
  const ov=showOverride(md.id);
  if(!ov||!ov.episodes) return "";
  const now=Date.now()/1000;
  const out=[];
  for(const [ep,e] of Object.entries(ov.episodes)){
    const st=e&&e.status; if(!st||!st.kind||st.kind==="note"&&!st.reason) continue;
    // Only what's still relevant: this episode's slot hasn't passed by a week.
    const node=((md.airingSchedule&&md.airingSchedule.nodes)||[]).find(n=>String(n.episode)===String(ep));
    if(node && node.airingAt < now-7*86400) continue;
    const icon=st.kind==="break"?"⏸":st.kind==="early"?"⚡":st.kind==="delay"?"⚠":"ℹ";
    const head=st.kind==="break"?`No episode ${ep}`:st.kind==="delay"?`Episode ${ep} delayed`:st.kind==="early"?`Episode ${ep} released early`:`Episode ${ep}`;
    const src=st.source?` <a href="${esc(st.source)}" target="_blank" rel="noopener">source</a>`:"";
    out.push(`<div class="schednote${st.kind==="break"?" brk":""}"><span>${icon}</span><span><b>${esc(head)}</b>${st.reason?" — "+esc(st.reason):""}${src}</span></div>`);
  }
  return out.join("");
}
function renderScheduleList(md){
  const nodes=(md.airingSchedule&&md.airingSchedule.nodes)||[];
  if(!nodes.length) return "";
  const now=Date.now()/1000, prog=getProgress(md.id);
  const on=enabledTypes();
  const rows=nodes.slice().sort((a,b)=>a.airingAt-b.airingAt).map(n=>{
    const {status,variants}=variantsFor(md,n);
    const brk=!variants.length;
    // Exactly the releases the calendar shows for this episode. This list used
    // to be built from the raw variants, which ignored the hide rules — so a
    // simulcast row the grid had condensed to a single "~S" chip re-appeared in
    // here as a SUB *and* a RAW line, and the modal contradicted the calendar
    // that opened it.
    const shown=visibleVariants(variants);
    // The row's own clock is the release the viewer tracks; other known
    // releases for the same episode are listed under it rather than as
    // separate rows, so the episode list stays one-line-per-episode.
    const primary=preferredVariant(shown);
    const ts=primary?primary.ts:n.airingAt;
    const up=!brk&&ts>now, watched=!up&&!brk&&n.episode<=prog;
    const mark = (up||brk) ? `<span style="width:18px;flex:none"></span>`
      : `<span class="mark ${watched?'on':''}" role="button" tabindex="0" aria-label="${watched?'Watched — mark unwatched':'Mark watched up to episode '+n.episode}" data-mark="${md.id}|${n.episode}" title="${watched?'Watched — click to unmark':'Mark watched (this & earlier)'}">${watched?'✓':''}</span>`;
    const others=shown.filter(v=>v!==primary).map(v=>
      `<span class="pill air air-${v.type}${v.estimated?" est":""}" title="${esc(AIR_LONG[v.type]+(v.platform?" · "+v.platform:""))}">${v.estimated?"~":""}${AIR_LABEL[v.type]} ${new Date(v.ts*1000).toLocaleString([], timeOpts({month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</span>`).join(" ");
    const statusTag = brk ? `<span class="pill brk" title="${esc((status&&status.reason)||"Broadcast break")}">⏸ BREAK</span>`
      : status&&status.kind==="delay" ? `<span class="pill warn" title="${esc(status.reason||"Delayed")}">⚠</span>`
      : status&&status.kind==="early" ? `<span class="pill warn" title="${esc(status.reason||"Early")}">⚡</span>` : "";
    const primaryTag = (!brk&&primary&&on.size>1) ? ` <span class="pill air air-${primary.type}${primary.estimated?" est":""}" title="${esc(AIR_LONG[primary.type]+(primary.platform?" · "+primary.platform:""))}">${primary.estimated?"~":""}${AIR_LABEL[primary.type]}</span>` : "";
    // "It's out now" — only where it can actually teach us something. The time
    // has to be an estimate (an exact one needs no confirming), the slot has to
    // have passed, and it has to be recent enough that the answer is still
    // about this episode. 12h matches the server's plausibility band for a sub,
    // so the button never appears where the report would be rejected anyway.
    const obsAgeMin = (now - ts) / 60;
    const canObserve = !brk && primary && primary.estimated && !up && obsAgeMin <= 12 * 60;
    const obsBtn = canObserve
      ? ` <button class="obsbtn" data-released="${md.id}|${n.episode}|${primary.type}" title="Tell us it has actually appeared where you are. Three people agreeing replaces the estimate with a measured time.">📍 It's out now</button>`
      : "";
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--line);${(up&&!brk)?"":(watched?"":"opacity:.6")}">
      ${mark}
      <span style="flex:1">Episode ${n.episode}${statusTag}${primaryTag}${isFinale(md,n.episode)?' <span class="pill fin">🏁 FINALE</span>':""}${up?` <span class="pill cd">in ${cdLive(ts)}</span>`:""}${obsBtn}${others?`<div style="margin-top:3px;display:flex;gap:5px;flex-wrap:wrap">${others}</div>`:""}</span>
      <span style="color:${up?"var(--accent2)":"var(--muted)"}">${brk?"—":new Date(ts*1000).toLocaleString([], timeOpts({month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</span>
    </div>`;
  }).join("");
  const watchedN=prog>0?`<span class="tznote"> · ${Math.min(prog,maxAiredEp(md))} watched</span>`:"";
  return `<h4 style="margin:16px 0 6px">Airing schedule <span class="tznote">${TZ_SHORT?"· times in "+esc(TZ_SHORT)+" (your time)":"· your local time"}</span>${watchedN}</h4><div class="sched-scroll">${rows}</div>`;
}
function openDay(d,evs){
  $("modalTitle").textContent=d.toLocaleDateString([], {weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const now=Date.now()/1000;
  // Sorted once and indexed by position: a show can appear twice in a day (its
  // sub and its dub), so the media id is no longer a unique handle for a row.
  const sorted=evs.slice().sort((a,b)=>a.ts-b.ts);
  $("modalBody").innerHTML=sorted.map((e,i)=>{
    const md=e.media,prem=e.episode===1&&!e.brk,fin=isFinale(md,e.episode)&&!e.brk,up=e.ts>now&&!e.brk;
    return `<div class="prow" role="button" tabindex="0" aria-label="${esc(title(md))}, episode ${e.episode}" data-evi="${i}">
      <img src="${md.coverImage&&md.coverImage.medium?md.coverImage.medium:""}" alt="" width="44" height="60">
      <div class="info"><div class="pt">${esc(title(md))}</div>
        <div class="meta">${airPillHTML(e)}${statusPillHTML(e)}${prem?'<span class="pill prem">PREMIERE</span>':''}${fin?'<span class="pill fin">🏁 FINALE</span>':''}<span class="pill">Ep ${e.episode}</span>${e.brk?"":`<span class="pill">${fmtTime(e.ts)}</span>`}${md.averageScore?`<span class="pill score">★ ${md.averageScore}</span>`:""}${myMarks(md.id)}${up?`<span class="pill cd">in ${cdLive(e.ts)}</span>`:""}${bellSpan(md.id)}</div>
      </div></div>`;
  }).join("");
  $("modalBody").querySelectorAll("[data-evi]").forEach(el=>{
    el.onclick=(ev)=>{ if(ev.target.closest("[data-bell]"))return; const e=sorted[+el.dataset.evi]; if(e) openDetail(e.media,e.episode); };
  });
  $("overlay").classList.add("on");
}
function closeModal(){ saveNoteNow(); state._modalKind=null; $("overlay").classList.remove("on"); }

/* ---------- embed widget snippet ---------- */
function embedSnippet(days){
  const src=location.origin+"/embed/?days="+days;
  return `<iframe src="${src}" title="Tsuzuki — anime airing schedule" width="360" height="520" style="border:1px solid #342825;border-radius:16px;max-width:100%" loading="lazy"></iframe>`;
}
function openEmbed(){
  $("modalTitle").textContent="Embed Tsuzuki on your site";
  $("modalBody").innerHTML=`
    <p style="color:var(--muted);margin-top:0">Drop this live "what's airing" widget into any page or blog. It updates itself — no maintenance.</p>
    <div class="embed-opts">
      <label>Days ahead:
        <select id="embDays">
          <option value="1">1</option><option value="3">3</option>
          <option value="7" selected>7</option><option value="14">14</option>
        </select>
      </label>
      <button id="embCopy">📋 Copy code</button>
    </div>
    <textarea class="embed-code" id="embCode" readonly></textarea>
    <h4 style="margin:16px 0 6px">Live preview</h4>
    <div id="embPreview"></div>`;
  const sync=()=>{
    const days=$("embDays").value;
    $("embCode").value=embedSnippet(days);
    $("embPreview").innerHTML=embedSnippet(days);
  };
  $("embDays").onchange=sync;
  $("embCopy").onclick=()=>{ $("embCode").select(); try{ document.execCommand("copy"); }catch(e){} navigator.clipboard&&navigator.clipboard.writeText($("embCode").value).catch(()=>{}); $("embCopy").textContent="✓ Copied"; setTimeout(()=>$("embCopy").textContent="📋 Copy code",1500); };
  sync();
  $("overlay").classList.add("on");
}

/* ---------- air types: which release you're tracking ---------- */
// Label the toolbar button with the live selection, so the setting is visible
// without opening anything — a calendar silently filtered to dubs would be
// indistinguishable from a broken one.
function airBtnLabel(){
  const b=$("airBtn"); if(!b) return;
  const on=[...enabledTypes()];
  const order={sub:0,raw:1,dub:2};
  on.sort((a,c)=>order[a]-order[c]);
  const names={raw:"Raw",sub:"Sub",dub:"Dub"};
  b.textContent="🎧 "+(on.length===3?"All":on.map(t=>names[t]).join(" · "));
  b.classList.toggle("narrowed", !(on.length===2&&on.includes("raw")&&on.includes("sub")));
  b.title="Which release to show: "+on.map(t=>AIR_LONG[t]).join(", ");
}
function saveAirPrefs(){
  localStorage.setItem("anical.airTypes", JSON.stringify([...state.airTypes]));
  localStorage.setItem("anical.hideRules", JSON.stringify(state.hideRules));
  airBtnLabel();
  syncURL(false);
  renderView();
  syncPushSubscription();   // the server alerts on the release you track
  setStatus(false,`Live · ${state.media.length} titles · ${rangeEvents().length} episodes shown`);
}
function openAirPanel(){
  $("modalTitle").textContent="🎧 Which release are you tracking?";
  const opt=(attr,val,on,label,tip)=>`<span class="opt ${on?"on":""}" role="button" tabindex="0" data-${attr}="${val}" title="${esc(tip||"")}">${esc(label)}</span>`;
  const t=state.airTypes, r=state.hideRules;
  $("modalBody").innerHTML=`
    <div class="airpanel">
      <p class="hint" style="margin:0">AniList publishes the <b>Japanese broadcast</b> time. That's rarely the time you watch — so Tsuzuki also tracks the subtitled simulcast and, where we have the data, the English dub. Times we derived rather than confirmed are shown with a <b>~</b>.</p>
      <div class="grp">
        <span class="lbl">Show these releases</span>
        <div class="row">
          ${opt("air","raw",t.has("raw"),"RAW · Japanese broadcast","The time it airs on Japanese TV")}
          ${opt("air","sub",t.has("sub"),"SUB · Subtitled","Simulcast on Crunchyroll, HIDIVE, Netflix and friends")}
          ${opt("air","dub",t.has("dub"),"DUB · English dub","Only shown for shows we have confirmed dub dates for")}
        </div>
      </div>
      <div class="grp">
        <span class="lbl">Hide the broadcast when…</span>
        <div class="row">
          ${opt("hr","rawWhenSub",r.rawWhenSub,"a sub exists","Don't list the JP broadcast separately once there's a subtitled time")}
          ${opt("hr","rawWhenDub",r.rawWhenDub,"a dub exists")}
        </div>
      </div>
      <div class="grp">
        <span class="lbl">Hide the sub when…</span>
        <div class="row">
          ${opt("hr","subWhenDub",r.subWhenDub,"a dub exists","For dub-only viewers")}
          ${opt("hr","subWhenRaw",r.subWhenRaw,"the broadcast exists")}
        </div>
      </div>
      <div class="grp">
        <span class="lbl">Hide the dub when…</span>
        <div class="row">
          ${opt("hr","dubWhenSub",r.dubWhenSub,"a sub exists")}
          ${opt("hr","dubWhenRaw",r.dubWhenRaw,"the broadcast exists")}
        </div>
      </div>
      <p class="hint" style="margin:0">Missing a dub date or spotted a wrong time? Open the show and use <b>⚠ Report a wrong time</b> — corrections go live without waiting for a new release of the site.</p>
      <div class="row"><button id="airReset">↺ Reset to defaults</button></div>
    </div>`;
  const rerender=()=>{ saveAirPrefs(); openAirPanel(); };
  $("modalBody").querySelectorAll("[data-air]").forEach(el=>{
    el.onclick=()=>{
      const v=el.dataset.air;
      if(state.airTypes.has(v)){ if(state.airTypes.size>1) state.airTypes.delete(v); }   // never leave nothing selected
      else state.airTypes.add(v);
      rerender();
    };
  });
  $("modalBody").querySelectorAll("[data-hr]").forEach(el=>{
    el.onclick=()=>{ const k=el.dataset.hr; state.hideRules[k]=!state.hideRules[k]; rerender(); };
  });
  $("airReset").onclick=()=>{
    state.airTypes=new Set(["raw","sub"]);
    state.hideRules={rawWhenSub:true,rawWhenDub:false,subWhenDub:false,subWhenRaw:false,dubWhenSub:false,dubWhenRaw:false};
    rerender();
  };
  $("overlay").classList.add("on");
}

/* ---------- "this time is wrong" ---------- */
// The intake half of the correction layer. One maintainer can't notice every
// timeslot change; readers can, and this is how what they notice gets in.
function openReport(md, episode){
  const na=nextAir(md);
  const ep=episode||(na&&na.episode)||1;
  $("modalTitle").textContent="⚠ Report a wrong time";
  $("modalBody").innerHTML=`
    <form class="repform" id="repForm">
      <p style="color:var(--muted);margin:0;font-size:13px">
        <b>${esc(title(md))}</b> — tell us what's off and we'll correct it for everyone.
        Air times come from AniList's Japanese broadcast schedule, so simulcast and dub times are the ones most likely to need fixing.
      </p>
      <div class="rf-row">
        <label>Episode<input type="number" id="repEp" min="0" max="9999" value="${ep}"></label>
        <label>Which release?
          <select id="repAir">
            <option value="sub">Sub / simulcast</option>
            <option value="dub">English dub</option>
            <option value="raw">Japanese broadcast</option>
          </select>
        </label>
        <label>What's wrong?
          <select id="repKind">
            <option value="wrong-time">Listed time is wrong</option>
            <option value="delay">Episode is delayed / pre-empted</option>
            <option value="missing">Episode or show is missing</option>
            <option value="wrong-episode">Wrong episode number</option>
            <option value="dub-time">Dub date is missing or wrong</option>
            <option value="other">Something else</option>
          </select>
        </label>
      </div>
      <div class="rf-row">
        <label>Correct time (if you know it)<input type="text" id="repExpected" placeholder="e.g. 2026-08-11 18:00 CEST, or 1h later"></label>
        <label>Platform<input type="text" id="repPlatform" placeholder="Crunchyroll, HIDIVE…"></label>
      </div>
      <label>Details<textarea id="repDetail" maxlength="1000" placeholder="What did you see, and where? The more specific the faster it gets fixed." required></textarea></label>
      <label>Source link (optional)<input type="url" id="repSource" placeholder="https://…"></label>
      <div class="rf-row" style="align-items:center">
        <button class="primary" type="submit" id="repSend">Send report</button>
        <span class="tznote" id="repState"></span>
      </div>
      <p class="tznote" style="margin:0">Nothing personal is sent — just the show, what you typed, and a hashed marker so one person can't flood the queue.</p>
    </form>`;
  $("repForm").onsubmit=async ev=>{
    ev.preventDefault();
    const detail=$("repDetail").value.trim();
    if(!detail){ $("repState").textContent="Please say what's wrong."; return; }
    $("repSend").disabled=true; $("repState").textContent="Sending…";
    try{
      const res=await fetch("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({mediaId:String(md.id), title:title(md), episode:+$("repEp").value||0,
          airType:$("repAir").value, kind:$("repKind").value, expected:$("repExpected").value,
          platform:$("repPlatform").value, source:$("repSource").value, detail})});
      const j=await res.json().catch(()=>({}));
      // Drop back to the show, but only if the dialog is still the one we left.
      if(res.ok&&j.ok){ $("repState").textContent="✓ Thanks — sent."; setTimeout(()=>{ if($("overlay").classList.contains("on")&&$("repForm")) openDetail(md,ep); },900); }
      else { $("repSend").disabled=false; $("repState").textContent=(j&&j.error)||"Couldn't send — try the Discord?"; }
    }catch(e){
      $("repSend").disabled=false;
      $("repState").innerHTML=`Couldn't reach the server — <a href="https://discord.gg/YxphmhYga7" target="_blank" rel="noopener">tell us on Discord</a>.`;
    }
  };
  $("overlay").classList.add("on");
}

/* ---------- appearance (theme / accent / density) ---------- */
const ACCENTS=[["Vermilion","#ff4a2e","#22d3ee"],["Purple","#8b5cf6","#22d3ee"],["Blue","#3b82f6","#22d3ee"],["Emerald","#10b981","#34d399"],["Rose","#f43f5e","#fb7185"],["Amber","#f59e0b","#fbbf24"],["Cyan","#06b6d4","#67e8f9"]];
function effectiveTheme(){
  if(state.theme==="auto") return (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  return state.theme;
}
function densityFor(view){
  const key=densityViewOf(view||state.viewMode);
  const v=state.densityBy[key]||state.density||"normal";
  if(v==="grid" && !GRID_VIEWS.has(key)) return "dense";   // a stale or pasted value, resolved not honoured
  return v;
}
function setDensityFor(view, val){
  const key=densityViewOf(view||state.viewMode);
  state.densityBy[key]=val;
  try{ localStorage.setItem("anical.densityBy", JSON.stringify(state.densityBy)); }catch(e){}
  applyDensity();
}
/* Split out of applyAppearance so renderView() can call it on every view change
   without dragging applySkin() and the whole palette along behind it — the
   density now depends on which view is open, so it has to be re-evaluated far
   more often than the theme does. */
function applyDensity(){
  const d=densityFor();
  document.body.classList.toggle("dense", d==="dense");
  document.body.classList.toggle("grid-cards", d==="grid");
}
function applyAppearance(){
  const eff=effectiveTheme();
  document.body.classList.toggle("theme-light", eff==="light");
  applyDensity();
  document.body.classList.toggle("no-covers", !state.showImages);
  const parts=(state.accent||"#ff4a2e|#22d3ee").split("|");
  document.documentElement.style.setProperty("--accent", parts[0]);
  document.documentElement.style.setProperty("--accent2", parts[1]||"#22d3ee");
  const m=document.querySelector('meta[name=theme-color]'); if(m) m.setAttribute("content", eff==="light"?"#faf6f4":"#0e0908");
  applySkin();   // last: a skin owns the whole palette, including light/dark
}

/* ---------- skins ----------
   A skin is a full site theme tied to a character or a series: the complete
   colour palette plus up to four image layers. You get one by being granted it
   in /admin against your Discord account — see refreshIdentity() below.

   The catalog (/api/themes) is public and the grant (/api/auth/me) is not, which
   is the whole access model: knowing what a skin looks like is harmless, having
   one is the thing that's earned.

   Everything here degrades to "the site as it was". No sign-in, no grant, a
   failed fetch, sign-in not configured on this deployment — all of them end at
   clearSkin(). */
// SKIN_VARS and the rest of this section's constants are declared up by the
// first applyAppearance() call, not here — that call runs before the first
// paint, and a `const` down here would still be in its temporal dead zone when
// it fires. Function declarations hoist; these don't.

// document.getElementById directly, not the $ helper: these run from the
// pre-first-paint applyAppearance(), which is earlier in the script than $ is
// declared. Same temporal-dead-zone trap as the constants above.
function skinStyleEl(){
  let el=document.getElementById("skinCss");
  if(!el){ el=document.createElement("style"); el.id="skinCss"; document.head.appendChild(el); }
  return el;
}
// One fixed container holding every art layer, in explicit paint order. Built
// once and reused — rebuilding it per theme change would restart every image
// download and flash the page.
function skinLayersEl(){
  let el=document.getElementById("skinLayers");
  if(!el){
    el=document.createElement("div");
    el.id="skinLayers";
    el.setAttribute("aria-hidden","true");
    el.innerHTML=SKIN_LAYER_ORDER.map(n=>`<i class="sl-${n}"></i>`).join("");
    document.body.appendChild(el);
  }
  return el;
}
function clearSkin(){
  document.body.classList.remove("skinned");
  SKIN_VARS.forEach(k=>document.body.style.removeProperty("--"+k));
  SKIN_SHAPE_VARS.forEach(k=>document.body.style.removeProperty(k));
  const el=document.getElementById("skinCss"); if(el) el.textContent="";
  const f=document.getElementById("skinFont"); if(f) f.remove();
}
// The theme's display face, loaded only while that theme is worn. Swapped by
// href so re-applying the same skin doesn't re-request it.
function skinFont(theme){
  const href=theme&&theme.font&&theme.font.css;
  let link=document.getElementById("skinFont");
  if(!href){ if(link) link.remove(); return; }
  if(!/^https:\/\/fonts\.googleapis\.com\//.test(href)) return;   // the server checks this too
  if(link&&link.href===href) return;
  if(!link){
    link=document.createElement("link");
    link.id="skinFont"; link.rel="stylesheet";
    document.head.appendChild(link);
  }
  link.href=href;
}
// The per-theme half of the CSS. Written out rather than driven by custom
// properties because the corner layers need real arithmetic (insets, a height
// derived from the width, a mask sized to a fade amount) and calc() chains
// through six variables are harder to read than the rule they produce.
function skinCss(t){
  const out=[];
  const layer=(sel,l,extra)=>{
    const u=l&&safeUrl(l.url);
    if(!u) return out.push(`${sel}{display:none}`);
    out.push(`${sel}{background-image:url("${u}");${extra||""}}`);
  };

  layer("#skinLayers .sl-backdrop", t.backdrop,
    t.backdrop&&`background-position:${t.backdrop.position||"center"};opacity:${t.backdrop.opacity};filter:blur(${t.backdrop.blur||0}px)`);

  layer("#skinLayers .sl-pattern", t.pattern,
    t.pattern&&`background-size:${Math.round(t.pattern.size||160)}px;opacity:${t.pattern.opacity}`);

  // Corner layers: the ornament frames the page, the cutout is the character.
  // Both anchor to a corner, and the cutout dissolves its edges into the page
  // — without that mask a poster in the corner reads as a screenshot pasted on
  // top rather than part of the layout.
  for(const [name,l] of [["ornament",t.ornament],["cutout",t.cutout]]){
    const u=l&&safeUrl(l.url);
    const sel=`#skinLayers .sl-${name}`;
    if(!u){ out.push(`${sel}{display:none}`); continue; }
    const corner=String(l.corner||"bottom-right");
    const w=Math.round(l.width||300);
    const h=Math.round(w*(name==="cutout"?1.45:1));
    const vert=corner.startsWith("top")?`top:${Math.round(l.offsetY||0)}px`:`bottom:${Math.round(l.offsetY||0)}px`;
    const horz=corner.endsWith("left")?`left:${Math.round(l.offsetX||0)}px`:`right:${Math.round(l.offsetX||0)}px`;
    // Rotate the ornament so one drawn quarter-frame serves all four corners.
    const spin={"top-left":0,"top-right":90,"bottom-right":180,"bottom-left":270}[corner]||0;
    const rot=name==="ornament"&&spin?`rotate(${spin}deg)`:"";
    const flip=l.flip?"scaleX(-1)":"";
    const fade=+l.fade||0;
    const mask=fade>0
      ? `--m:linear-gradient(to top,#000 ${Math.round((1-fade)*55)}%,transparent 100%),linear-gradient(to ${corner.endsWith("left")?"right":"left"},#000 ${Math.round((1-fade)*55)}%,transparent 100%);`
        +`-webkit-mask-image:var(--m);mask-image:var(--m);-webkit-mask-composite:source-in;mask-composite:intersect;`
      : "";
    out.push(`${sel}{background-image:url("${u}");background-position:${corner.replace("-"," ")};width:${w}px;height:${h}px;max-height:82vh;`
      +`opacity:${l.opacity};${vert};${horz};${rot||flip?`transform:${[rot,flip].filter(Boolean).join(" ")};`:""}${mask}}`);
  }

  const fx=t.effects||{};
  for(const [name,val] of [["vignette",fx.vignette],["grain",fx.grain],["scan",fx.scanlines]]){
    out.push(+val>0 ? `#skinLayers .sl-${name}{opacity:${+val}}` : `#skinLayers .sl-${name}{display:none}`);
  }

  layer("body.skinned .empty::before", t.watermark, t.watermark&&`opacity:${t.watermark.opacity}`);

  const hd=t.header&&safeUrl(t.header.url);
  out.push(hd
    ? `body.skinned header::before{background-image:url("${hd}");background-position:${t.header.position||"center"};opacity:${t.header.opacity}}`
    : `body.skinned header::before{display:none}`);
  return out.join("\n");
}
// SKIN_SHAPE_VARS is declared up with SKIN_VARS, for the temporal-dead-zone
// reason documented there.
function applySkin(){
  const t=activeSkin();
  if(!t) return clearSkin();
  const b=document.body;
  for(const k of SKIN_VARS){ const v=t.colors&&t.colors[k]; if(v) b.style.setProperty("--"+k,v); }

  const sh=t.shape||{}, fx=t.effects||{}, ft=t.font||{};
  b.style.setProperty("--radius",(sh.radius??12)+"px");
  b.style.setProperty("--skin-chip-radius",(sh.chipRadius??20)+"px");
  b.style.setProperty("--skin-border",(sh.border??1)+"px");
  b.style.setProperty("--skin-card-blur",(sh.cardBlur??10)+"px");
  b.style.setProperty("--skin-glow",t.glow||(t.colors&&t.colors.accent)||"#ff4a2e");
  b.style.setProperty("--skin-glow-strength",String(fx.glowStrength??0.4));
  // The family string is validated server-side (no ; { } < >) before it can
  // reach a style declaration.
  if(ft.family) b.style.setProperty("--skin-font",ft.family);
  b.style.setProperty("--skin-font-scale",String(ft.scale??1));

  b.classList.add("skinned");
  // The skin decides light or dark. Its palette was built as one or the other,
  // and half of it under the wrong body class is unreadable.
  b.classList.toggle("theme-light", t.mode==="light");
  skinLayersEl();
  skinFont(t);
  skinStyleEl().textContent=skinCss(t);
  const mt=document.querySelector('meta[name=theme-color]'); if(mt&&t.colors&&t.colors.bg) mt.setAttribute("content",t.colors.bg);
}
// Preview beats grant beats nothing. Preview is how /admin tries a theme on
// without granting it to anyone.
function activeSkin(){
  if(state.skinPreview) return state.skinPreview;
  return (state.skin && skinOn()) ? state.skin : null;
}
function setGrantedSkin(theme){
  state.skin=theme||null;
  try{
    if(theme) localStorage.setItem(SKIN_CACHE_KEY, JSON.stringify(theme));
    else localStorage.removeItem(SKIN_CACHE_KEY);
  }catch(e){}
  applyAppearance();
}

/* How many skins there are appears in the copy in two places, and hard-coding
   it there is how "fifty" survived a batch that made it seventy-five. The
   catalogue knows its own size, so ask it wherever it has already been fetched;
   SKIN_COUNT is only what to say before that request lands, and the panel
   re-renders when it does. */
const SKIN_COUNT = 75;
const skinTotal = () => (state.catalog ? Object.keys(state.catalog).length : SKIN_COUNT);
let themeCatalog=null;
async function loadThemeCatalog(){
  if(themeCatalog) return themeCatalog;
  try{
    const r=await fetch("/api/themes",{headers:{Accept:"application/json"}});
    if(!r.ok) return null;
    const j=await r.json();
    if(j&&j.ok&&j.themes){ themeCatalog=j.themes; state.catalog=j.themes; return themeCatalog; }
  }catch(e){}
  return null;
}

/* ---------- Tung Tungs ----------
   Two ways to get a skin, neither of them "know an admin": win one on the daily
   wheel, or save up and buy it. The balance, what you own and what you are
   wearing all live on the server keyed to your Discord account — the single
   deliberate exception to this app being local-first, made because a balance
   that can be edited in devtools cannot later be sold for money. Everything
   else is exactly as local as it always was, and the Settings copy says so.

   The server decides every outcome. This file animates them. A spin posts to
   /api/wallet/spin, is told which segment it landed on, and turns the wheel to
   that segment — the reverse, where the browser picks a prize and reports it,
   is a form with a spinning graphic on it. */
/* The currency mark: Tung Tung Tung Sahur's bat, drawn rather than borrowed.
   An emoji was a placeholder — it renders as a different picture on every
   platform and says nothing about what the currency is. This is one inline SVG
   with no host, no request and no licence, and it holds up against seventy-five skins
   repainting the page around it because it carries its own colours. */
const TT_ICON = `<svg class="tt-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g transform="rotate(-14 12 12)">`
  + `<path d="M12 1.5c3 0 5.1 2.5 5.1 6 0 2.9-1 5.2-2.1 6.7-.8 1.2-1.2 2.4-1.3 3.7l-.3 3.3h-2.8l-.3-3.3c-.1-1.3-.5-2.5-1.3-3.7C8 12.7 6.9 10.4 6.9 7.5c0-3.5 2.1-6 5.1-6Z" fill="#d7a066"/>`
  + `<path d="M12 1.5C9 1.5 6.9 4 6.9 7.5c0 2.9 1.1 5.2 2.1 6.7.8 1.2 1.2 2.4 1.3 3.7l.3 3.3h1.6l-.3-3.3c-.1-1.3-.5-2.5-1.3-3.7-1.1-1.5-2.1-3.8-2.1-6.7 0-3 1.4-5.3 3.5-6Z" fill="#b9834a"/>`
  + `<rect x="9" y="20.3" width="6" height="2.5" rx="1.25" fill="#9a6835"/>`
  + `<circle cx="10.2" cy="6.8" r="1.45" fill="#2a1a0e"/><circle cx="14" cy="6.8" r="1.45" fill="#2a1a0e"/>`
  + `<circle cx="10.7" cy="6.3" r=".5" fill="#fff"/><circle cx="14.5" cy="6.3" r=".5" fill="#fff"/>`
  + `</g></svg>`;
const TT = TT_ICON;          // anywhere the string lands in innerHTML
const TT_TXT = "Tung Tungs"; // toast() escapes its message, so those say the words
const ttNum = n => Number(n||0).toLocaleString();

// Every wallet response carries the whole wallet, so there is one place that
// takes it in and one place that repaints. No endpoint returns a delta the
// client has to apply itself, which is how a balance and a badge drift apart.
function takeWallet(j){
  if(!j||!j.ok) return j;
  if(j.wallet) state.wallet=j.wallet;
  if(j.wheel) state.wheel=j.wheel;
  if(j.rarity) state.rarityMeta=j.rarity;
  renderTungChip();
  return j;
}
async function walletGet(){
  try{
    const r=await fetch("/api/wallet",{headers:{Accept:"application/json"}});
    if(r.status===503){ state.walletOff=true; return null; }
    if(r.status===401) return null;             // signed out — nothing to show
    const j=await r.json();
    return takeWallet(j);
  }catch(e){ return null; }
}
async function walletPost(action, body){
  try{
    const r=await fetch("/api/wallet/"+action,{
      method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify(body||{}),
    });
    const j=await r.json().catch(()=>null);
    return takeWallet(j);
  }catch(e){ return null; }
}

/* A daily task, credited when you actually do the thing. Fired from the feature
   itself rather than from a "claim" button, because a reward you have to go and
   collect is a chore attached to the thing you already did.

   The server enforces once-per-UTC-day; this guard only exists so the app
   doesn't POST on every keystroke of a note. It cannot verify that you really
   marked an episode — progress is local by design — but every task pays once a
   day, so a browser that lies earns exactly what an honest one earns. */
const ttSending=new Set();
function tungTask(id){
  const w=state.wallet;
  if(!w||!state.discord) return;                       // signed out: nothing to credit
  const t=(w.tasks||[]).find(x=>x.id===id);
  if(!t||t.done||ttSending.has(id)) return;
  ttSending.add(id);
  walletPost("claim",{task:id}).then(j=>{
    ttSending.delete(id);
    if(j&&j.ok&&j.claim&&j.claim.ok){
      toast(`+${ttNum(j.claim.awarded)} ${TT_TXT} · ${t.label}`);
      if(isSkinsOpen()) renderSkins();
    }
  }).catch(()=>ttSending.delete(id));
}

// The header badge. A dot appears when today's spin is still there — the whole
// reason to come back tomorrow, and easy to forget without it.
function renderTungChip(){
  const el=$("ttChip"); if(!el) return;
  const w=state.wallet;
  if(!w||!state.discord){ el.style.display="none"; el.innerHTML=""; return; }
  const ready=w.spin&&w.spin.available;
  const undone=(w.tasks||[]).filter(t=>!t.done).length;
  el.style.display="";
  el.classList.toggle("tt-ready",!!ready);
  el.innerHTML=`${TT}<b>${ttNum(w.balance)}</b>${ready?`<i class="tt-dot"></i>`:""}`;
  // The mark is decorative SVG, so the number on its own would be read out with
  // no unit. The label carries the whole sentence.
  const label=`${ttNum(w.balance)} ${TT_TXT}`
    +(ready?" · your daily spin is waiting":"")
    +(undone?` · ${undone} task${undone===1?"":"s"} left today`:"")
    +" — click to open your skins";
  el.title=label;
  el.setAttribute("aria-label",label);
}

/* ---------- the skins panel ---------- */
const isSkinsOpen = () => state._modalKind==="skins" && $("overlay").classList.contains("on");

function openSkins(tab){
  state._modalKind="skins";
  if(tab) state._skTab=tab;
  $("modalTitle").textContent="🎡 Skins";
  renderSkins();
  $("overlay").classList.add("on");
  // The catalog is seventy-five themes and only this panel needs it, so it is
  // fetched on open rather than at boot.
  if(!state.catalog) loadThemeCatalog().then(()=>{ if(isSkinsOpen()) renderSkins(); });
  if(!state.wallet && state.discord) walletGet().then(()=>{ if(isSkinsOpen()) renderSkins(); });
}
function renderSkins(){
  $("modalBody").innerHTML=skinsHTML();
  wireSkins();
}
function skinsHTML(){
  if(state.walletOff){
    return `<p class="num-hint">Skins are switched off on this deployment — the wallet needs
      <code>DISCORD_CLIENT_ID</code>, <code>DISCORD_CLIENT_SECRET</code> and <code>SESSION_SECRET</code>
      in the site environment.</p>`;
  }
  if(!state.discord) return signedOutSkinsHTML();
  const w=state.wallet;
  if(!w) return `<div class="slot-loading">Loading your skins…</div>`;
  const tab=state._skTab||"wheel";
  const undone=(w.tasks||[]).filter(t=>!t.done).length;
  const owned=Object.keys(w.owned||{}).length;
  const total=state.catalog?Object.keys(state.catalog).length:0;
  const t=(k,label,n)=>`<button class="sk-tab${tab===k?" on":""}" data-sktab="${k}">${label}${n?`<span class="sk-tab-n">${n}</span>`:""}</button>`;
  return `<div class="sk-tabs">
      ${t("wheel","🎡 Daily spin",w.spin&&w.spin.available?"1":"")}
      ${t("tasks","✅ Today",undone?String(undone):"")}
      ${t("collection","🎨 Collection",total?`${owned}/${total}`:"")}
    </div>
    ${tab==="wheel"?wheelHTML():tab==="tasks"?tasksHTML():collectionHTML()}`;
}
function signedOutSkinsHTML(){
  return `<p style="margin-top:0">${skinTotal()} site skins — full palettes, typefaces, textures and corner art, not recolours.
      Win one a day on the wheel, or save ${TT} Tung Tungs by using the site and buy the one you actually want.
      A couple are event skins: they stay with whoever was given them and are not for sale at any price.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0">
      <button class="primary" id="skIn">🎮 Sign in with Discord</button>
    </div>
    <p class="num-hint">Signing in is required for this one feature, and it is worth saying exactly why. A balance kept in
      your own browser is a balance you can edit, which makes it worthless the day Tung Tungs can be bought — so the wallet,
      what you own and what you are wearing live on our server against your Discord id. <b>Nothing else moved.</b> Your list,
      ratings, notes, collections and episode progress are still stored only in this browser and are still never uploaded.</p>`;
}

/* ---------- the wheel ---------- */
function wheelHTML(){
  const w=state.wallet, segs=state.wheel||[];
  if(!segs.length) return `<div class="slot-loading">Loading the wheel…</div>`;
  const meta=state.rarityMeta||{};
  const step=360/segs.length;
  // The gradient starts half a segment before zero so segment 0 is centred on
  // the pointer at the top — the same offset the landing arithmetic assumes.
  const stops=segs.map((s,i)=>{
    // Skin slices wear their rarity's colour. Coin slices alternate two tints of
    // the accent rather than two shades of the background — against a dark page
    // those read as gaps in the wheel rather than as segments of it.
    const col=s.kind==="skin"
      ? ((meta[s.rarity]&&meta[s.rarity].tint)||"#888")
      : (i%2 ? "color-mix(in srgb,var(--accent) 26%,var(--bg2))" : "color-mix(in srgb,var(--accent) 12%,var(--bg3))");
    return `${col} ${i*step}deg ${(i+1)*step}deg`;
  }).join(",");
  const labels=segs.map((s,i)=>
    `<i class="wl" style="transform:rotate(${i*step}deg)"><b>${s.kind==="coins"?`${TT} ${s.amount}`:esc(s.label)}</b></i>`).join("");
  const ready=w.spin&&w.spin.available;
  const streak=(w.spin&&w.spin.streak)||0;
  return `<div class="wheel-stage">
      <div class="wheel-wrap">
        <div class="wheel-pin"></div>
        <div class="wheel" id="ttWheel" style="transform:rotate(${state._wheelAngle||0}deg);background:conic-gradient(from -${step/2}deg,${stops})">${labels}</div>
        <div class="wheel-hub">${TT}</div>
      </div>
      <div id="ttPrize">${state._lastPrize||""}</div>
      <div class="wheel-foot">
        <button class="primary" id="ttSpin"${ready?"":" disabled"}>${ready?"🎡 Spin — free":"Spun for today"}</button>
        ${streak?`<span class="tt-streak">🔥 ${streak}-day streak · coin prizes ×${(1+Math.min(Math.max(streak-1,0),10)*0.1).toFixed(1)}</span>`:""}
      </div>
      <span class="num-hint" style="text-align:center">${ready
        ? `One spin a day. A skin you already own is never drawn — clear a tier and its slice pays ${TT} instead.`
        : `Next spin and a fresh set of tasks in <b>${esc(hms(w.spin&&w.spin.nextInMs||w.dayEndsInMs))}</b> (00:00 UTC).`}</span>
    </div>`;
}
const hms = ms => {
  const s=Math.max(0,Math.round((+ms||0)/1000)), h=Math.floor(s/3600), m=Math.floor(s%3600/60);
  return h?`${h}h ${m}m`:`${m}m`;
};
const SPIN_MS=4600, SPIN_MS_REDUCED=420;
const wantsLessMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
/* Turn the wheel from one angle to another and say how long it will take.

   Honouring prefers-reduced-motion by *shortening* rather than by removing:
   someone who asked for less motion still needs to see which slice the pointer
   ended on, and a wheel that teleports reads as a broken button. What they are
   spared is five seconds of spinning. The caller uses the returned duration to
   time everything that follows, so a reduced-motion spin doesn't sit staring at
   a finished wheel for the four seconds the animation didn't take. */
function turnWheelTo(el, from, to){
  const ms=wantsLessMotion()?SPIN_MS_REDUCED:SPIN_MS;
  if(!el) return ms;
  el.style.transform=`rotate(${to}deg)`;   // the resting state, whatever happens below
  if(typeof el.animate!=="function") return ms;
  el.animate([{transform:`rotate(${from}deg)`},{transform:`rotate(${to}deg)`}],
    {duration:ms, easing:"cubic-bezier(.13,.72,.13,1)", fill:"none"});
  return ms;
}
async function spinWheel(){
  const btn=$("ttSpin"); if(!btn||btn.disabled) return;
  btn.disabled=true; btn.textContent="Spinning…";
  const j=await walletPost("spin",{});
  const res=j&&j.spin;
  if(!res||!res.ok){
    btn.textContent="Spun for today";
    if(isSkinsOpen()) renderSkins();
    return;
  }
  const segs=state.wheel||[], step=360/segs.length;
  // Land the won segment under the pointer, five turns later, stopping a little
  // off-centre so it doesn't read as snapping to a grid.
  const want=(360-res.index*step+ (Math.random()*step*0.7-step*0.35))%360;
  const from=state._wheelAngle||0, cur=from%360;
  state._wheelAngle=from+360*5+((want-cur)%360+360)%360;
  const spinMs=turnWheelTo($("ttWheel"), from, state._wheelAngle);

  const p=res.prize;
  state._lastPrize=p.kind==="skin"
    ? `<div class="tt-prize win">🎉 <b>${esc(p.name||p.themeId)}</b> — ${esc((state.rarityMeta&&state.rarityMeta[p.rarity]&&state.rarityMeta[p.rarity].label)||p.rarity)} skin, yours.</div>`
    : `<div class="tt-prize${p.dust?"":" win"}">${TT} <b>+${ttNum(p.amount)}</b>${p.dust
        ? ` — you already own every ${esc(p.rarity)} skin, so that slice paid out instead.`
        : (res.multiplier>1?` · including your ×${res.multiplier.toFixed(1)} streak bonus`:"")}</div>`;
  // Let the wheel finish before the panel repaints under it — timed off the
  // animation that actually ran, not off a constant.
  setTimeout(()=>{
    if(!isSkinsOpen()) return;
    renderSkins();
    if(p.kind==="skin") toast(`Won · ${p.name||p.themeId}`);
  },spinMs+120);
}

/* ---------- today's tasks ---------- */
function tasksHTML(){
  const w=state.wallet;
  const rows=(w.tasks||[]).map(t=>`<div class="tt-task${t.done?" done":""}">
      <span style="font-size:17px">${t.done?"✅":"⬜"}</span>
      <span class="tt-t"><b>${esc(t.label)}</b><span>${esc(t.hint)}</span></span>
      <span class="tt-pay">${t.done?"claimed":`${TT} ${t.reward}`}</span>
    </div>`).join("");
  const left=(w.tasks||[]).filter(t=>!t.done).reduce((n,t)=>n+t.reward,0);
  return `${rows}
    <p class="num-hint">Every one pays once a day and credits itself the moment you do the thing — there is nothing to
      collect. ${left?`<b>${TT} ${ttNum(left)}</b> still on the table today.`:`Everything claimed today.`}
      Resets with the wheel in <b>${esc(hms(w.dayEndsInMs))}</b>, at 00:00 UTC.</p>`;
}

/* ---------- the collection ---------- */
function collectionHTML(){
  const w=state.wallet, cat=state.catalog;
  if(!cat) return `<div class="slot-loading">Loading skins…</div>`;
  const meta=state.rarityMeta||{};
  const filter=state._skFilter||"all";
  const order={legendary:0,epic:1,rare:2,common:3,exclusive:4};
  const all=Object.values(cat).sort((a,b)=>
    (order[a.rarity]??9)-(order[b.rarity]??9) || String(a.name).localeCompare(String(b.name)));
  const list=all.filter(t=>filter==="all" ? true : filter==="owned" ? !!w.owned[t.id] : t.rarity===filter);
  const f=(k,label)=>`<button class="sk-f${filter===k?" on":""}" data-skf="${k}">${label}</button>`;
  const cards=list.map(t=>skinCardHTML(t,w,meta)).join("");
  // Wearing something with the local mute on is the one state where this panel
  // and the page disagree. Say so, rather than showing "Wearing" over a site
  // that looks untouched.
  const muted=w.wearing&&!skinOn()
    ? `<div class="skin-note"><span class="num-hint" style="margin:0">Your skin is switched off on this device, so the site looks unskinned.</span>
       <button id="skUnmute" class="primary">Turn it back on</button></div>` : "";
  return `${muted}<div class="sk-filters">
      ${f("all",`All ${all.length}`)}${f("owned",`Owned ${Object.keys(w.owned||{}).length}`)}
      ${f("legendary","Legendary")}${f("epic","Epic")}${f("rare","Rare")}${f("common","Common")}
    </div>
    <div class="sk-grid">${cards||`<p class="num-hint">Nothing here yet.</p>`}</div>
    <p class="num-hint">Wearing a skin repaints the whole site — palette, corner radii, display face, texture and art.
      You can take it off any time from here or from Settings; it stays on your account either way.</p>`;
}
function skinCardHTML(t,w,meta){
  const own=!!(w.owned&&w.owned[t.id]);
  const worn=w.wearing===t.id;
  const m=meta[t.rarity]||{};
  const price=m.price;
  const afford=price!=null && w.balance>=price;
  const art=(t.cutout&&t.cutout.url)||(t.header&&t.header.url)||(t.backdrop&&t.backdrop.url)||"";
  const c=t.colors||{};
  const sw=["bg2","accent","accent2","premiere","txt"].map(k=>`<i style="background:${esc(c[k]||"#000")}"></i>`).join("");
  let act;
  if(worn) act=`<button data-skwear="">✓ Wearing — take off</button>`;
  else if(own) act=`<button class="primary" data-skwear="${esc(t.id)}">Wear</button>`;
  else if(price==null) act=`<span class="sk-cost">Handed out at events</span>`;
  else act=`<button class="${afford?"primary":""}" data-skbuy="${esc(t.id)}"${afford?"":" disabled"}>${TT} ${ttNum(price)}</button>`;
  return `<div class="sk-card${own?" owned":""}${worn?" on":""}"${art?` style="--art:url(&quot;${esc(art)}&quot;)"`:""}>
      <span class="sk-rar" data-r="${esc(t.rarity)}">${esc(m.label||t.rarity)}</span>
      <span class="sk-name">${esc(t.name||t.id)}</span>
      <span class="sk-sw">${sw}</span>
      <span class="sk-act">${act}</span>
    </div>`;
}

function wireSkins(){
  const body=$("modalBody");
  if($("skIn")) $("skIn").onclick=discordSignIn;
  if($("skUnmute")) $("skUnmute").onclick=()=>{
    try{ localStorage.setItem(SKIN_ON_KEY,"1"); }catch(e){}
    applyAppearance(); renderDiscordChip(); renderSkins();
  };
  body.querySelectorAll("[data-sktab]").forEach(b=>{ b.onclick=()=>{ state._skTab=b.dataset.sktab; renderSkins(); }; });
  body.querySelectorAll("[data-skf]").forEach(b=>{ b.onclick=()=>{ state._skFilter=b.dataset.skf; renderSkins(); }; });
  if($("ttSpin")) $("ttSpin").onclick=spinWheel;
  body.querySelectorAll("[data-skwear]").forEach(b=>{
    b.onclick=async()=>{
      b.disabled=true;
      // Putting a skin on is an explicit request to see it, so it also clears
      // the local mute. Without this, anyone who had ever switched their old
      // granted skin off would wear things that never appeared, and the card
      // would claim "Wearing" over a site that hadn't changed.
      if(b.dataset.skwear) try{ localStorage.setItem(SKIN_ON_KEY,"1"); }catch(e){}
      const j=await walletPost("wear",{themeId:b.dataset.skwear||null});
      applyWornSkin();
      if(isSkinsOpen()) renderSkins();
      // toast() escapes what it is given, so no esc() here — passing one would
      // double-escape any name carrying an ampersand or a colon.
      if(j&&j.ok&&j.wear&&j.wear.ok) toast(j.wear.wearing?`Wearing · ${(state.catalog[j.wear.wearing]||{}).name||j.wear.wearing}`:"Skin off — back to your own theme");
    };
  });
  body.querySelectorAll("[data-skbuy]").forEach(b=>{
    b.onclick=async()=>{
      b.disabled=true;
      const j=await walletPost("buy",{themeId:b.dataset.skbuy});
      const r=j&&j.buy;
      if(r&&r.ok){
        try{ localStorage.setItem(SKIN_ON_KEY,"1"); }catch(e){}   // buying it is asking to see it
        applyWornSkin(); toast(`Bought · ${r.name||r.themeId} — ${ttNum(r.price)} ${TT_TXT}`);
      }
      else if(r&&r.error==="insufficient") toast(`Not enough ${TT_TXT} — that one is ${ttNum(r.price)} and you have ${ttNum(r.balance)}`);
      if(isSkinsOpen()) renderSkins();
    };
  });
}

// The worn skin, resolved through the catalog. One writer, so the cached
// instant-paint copy and what is actually on screen can never disagree.
function applyWornSkin(){
  const id=state.wallet&&state.wallet.wearing;
  setGrantedSkin((id&&state.catalog&&state.catalog[id])||null);
  renderDiscordChip();
}

/* ---------- Discord identity ----------
   Sign-in exists for one reason: so a skin granted in /admin can find the
   account it was granted to. Nothing from this browser is uploaded — the list,
   ratings, notes and collections stay exactly as local as they have always
   been, and the settings copy says so out loud. */
async function refreshIdentity(){
  let j=null;
  try{
    const r=await fetch("/api/auth/me",{headers:{Accept:"application/json"}});
    if(r.ok) j=await r.json();
  }catch(e){ return null; }        // offline: keep whatever the cache painted
  if(!j||!j.ok) return null;
  state.discordConfigured=!!j.configured;
  state.discord=j.user||null;
  state.skinGrant=(j.user&&j.grant)||null;
  if(j.user) state.loginProblem=null;   // whatever went wrong last time, it's resolved
  if(!j.user){
    state.wallet=null; setGrantedSkin(null); renderDiscordChip(); renderTungChip();
    return j;
  }
  // Signed in: the wallet decides what is worn, because it is what knows the
  // whole collection rather than the single admin grant. When the wallet is
  // unreachable (offline, cold function, sign-in half-configured) fall back to
  // the pre-economy grant rather than stripping someone's skin off because an
  // endpoint was slow.
  await walletGet();
  const wearId = state.wallet ? state.wallet.wearing : ((j.grant && j.grant.themeId) || null);
  // The catalog is seventy-five themes. Fetching it on every signed-in page load
  // for somebody who is wearing nothing is a payload spent on nothing, so it is
  // pulled only when there is an id to resolve — the Skins panel fetches it
  // itself when opened.
  if(!wearId) setGrantedSkin(null);
  else {
    const cat=await loadThemeCatalog();
    setGrantedSkin((cat&&cat[wearId])||null);
  }
  renderDiscordChip();
  renderTungChip();
  return j;
}
// The header's signed-in indicator. Hidden entirely when signed out, so the
// toolbar looks exactly as it always did for the people who never sign in.
function renderDiscordChip(){
  const el=$("dcChip"); if(!el) return;
  const u=state.discord;
  if(!u){ el.style.display="none"; el.innerHTML=""; return; }
  const name=u.globalName||u.username||"Signed in";
  const av=u.avatar
    ? `<img src="https://cdn.discordapp.com/avatars/${encodeURIComponent(u.id)}/${encodeURIComponent(u.avatar)}.png?size=64" alt="">`
    : `<span class="dc-init">${esc(name.slice(0,1).toUpperCase())}</span>`;
  const wearing=state.skin&&skinOn();
  el.innerHTML=av+`<span class="dc-name">${esc(name)}</span>`+(wearing?`<span class="dc-skin" title="${esc(state.skin.name||"")} active"></span>`:"");
  el.title=`Signed in as ${name}`+(wearing?` — ${state.skin.name||"granted appearance"} active`:"")+". Click for account settings.";
  el.style.display="";
  el.onclick=openSettings;
}
function discordSignIn(){
  location.href="/api/auth/login?returnTo="+encodeURIComponent(location.pathname+location.search);
}
async function discordSignOut(){
  try{ await fetch("/api/auth/logout",{method:"POST"}); }catch(e){}
  state.discord=null; state.skinGrant=null; state.loginProblem=null;
  state.wallet=null; renderTungChip();
  setGrantedSkin(null);
  renderDiscordChip();
  openSettings();
}
// keep "Auto" in sync with the OS theme while it's selected
if(window.matchMedia){ try{ window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{ if(state.theme==="auto") applyAppearance(); }); }catch(e){} }
// The AniList block of the settings panel has three shapes: not set up at all,
// set up but signed out, and connected.
function alSettingsHTML(){
  if(!alConfigured()){
    return `<span class="num-hint" style="flex-basis:100%">Two-way sync isn't switched on for this deployment. It needs an AniList
      application id — register one at <a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">anilist.co/settings/developer</a>
      with this site's URL as the redirect, then set <code>ANILIST_CLIENT_ID</code> in <code>site/index.html</code>.
      Until then the public-list import below still works.</span>`;
  }
  if(!alConnected()){
    return `<button class="primary" id="alConnect">🔗 Connect AniList</button>
      <span class="num-hint" style="flex-basis:100%">Signs in through AniList so your <em>private</em> entries come across too, and so
      status, score and episode progress you change here go back to your list automatically. The sign-in stays in this
      browser — Tsuzuki has no server to send it to.</span>`;
  }
  const u=alState.user||{};
  return `<span style="display:flex;align-items:center;gap:8px;font-weight:600">
      ${u.avatar&&u.avatar.medium?`<img src="${esc(u.avatar.medium)}" alt="" width="24" height="24" style="border-radius:50%">`:""}
      ${esc(u.name||"Connected")}</span>
    <button id="alPull">⬇ Pull from AniList</button>
    <button id="alPush">⬆ Push everything</button>
    <button id="alAuto" class="${alAutoSync()?"primary":""}">${alAutoSync()?"⇅ Auto-sync on":"⇅ Auto-sync off"}</button>
    <button id="alOut">Disconnect</button>
    <span id="alQueueState" class="num-hint" style="flex-basis:100%">${alState.queue.length?`Syncing… ${alState.queue.length} left`:"All changes synced."}</span>
    <span class="num-hint">Pull replaces local statuses, scores and progress with AniList's. Auto-sync pushes each change back as you make it.
    Removing a show here never deletes it on AniList — do that on AniList.</span>`;
}
function wireAlSettings(){
  if($("alConnect")) $("alConnect").onclick=alBeginConnect;
  if($("alOut")) $("alOut").onclick=()=>{ alDisconnect(); openSettings(); };
  if($("alAuto")) $("alAuto").onclick=()=>{
    localStorage.setItem(AL_AUTO_KEY, alAutoSync()?"0":"1");
    openSettings();
  };
  if($("alPull")) $("alPull").onclick=async()=>{
    const b=$("alPull"), s=$("alQueueState");
    b.disabled=true; s.textContent="Pulling…";
    try{ const r=await alPull(); s.textContent=`Pulled ${r.total} entries — +${r.added} to ⭐ My List, ${r.progressed} with progress, ${r.rated} rated.`; }
    catch(e){ s.textContent=(e&&e.message)||"Pull failed."; }
    finally{ b.disabled=false; }
  };
  if($("alPush")) $("alPush").onclick=()=>{
    const n=alPushAll();
    const s=$("alQueueState"); if(s) s.textContent=`Queued ${n} show${n===1?"":"s"} — this takes a moment, AniList is rate-limited.`;
  };
}
/* The Discord block of the settings panel. Four shapes: sign-in not set up on
   this deployment, signed out, signed in with nothing granted, and signed in
   wearing a skin. */
function discordSettingsHTML(){
  if(!state.discordConfigured){
    return `<span class="num-hint" style="flex-basis:100%">Discord sign-in isn't switched on for this deployment. It needs
      <code>DISCORD_CLIENT_ID</code>, <code>DISCORD_CLIENT_SECRET</code> and <code>SESSION_SECRET</code> in the site
      environment, and <code>/api/auth/callback</code> registered as a redirect on the Discord application.</span>`;
  }
  const problem=state.loginProblem
    ? `<span class="num-hint err-hint" style="flex-basis:100%">⚠ ${esc(state.loginProblem)}</span>` : "";
  // Rewritten when the wallet arrived, because the old copy — "nothing is
  // uploaded" — stopped being true the day a balance had to be kept somewhere
  // it couldn't be edited. Being precise about which two things live on the
  // server is the only version of this worth printing.
  const privacy=problem+`<span class="num-hint" style="flex-basis:100%">Signing in tells Tsuzuki which Discord account you are.
    Stored on our side: your Discord id, name and avatar, plus <b>your Tung Tung balance and which skins you own</b> —
    a balance kept in your own browser is one you can edit, so it lives with us instead. Your list, ratings, notes,
    collections and episode progress are <b>never uploaded</b> and signing in doesn't change that.</span>`;
  if(!state.discord){
    // The Skins button is here for the signed-out too. Without it the header
    // chip is the only way in and the header chip only exists once you have
    // signed in — so every skin would be invisible to precisely the people who
    // have not yet been given a reason to sign in.
    return `<button class="primary" id="dcIn">🎮 Sign in with Discord</button>
      <button id="dcSkins">🎡 Skins</button>${privacy}`;
  }
  const u=state.discord;
  const av=u.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(u.id)}/${encodeURIComponent(u.avatar)}.png?size=64`
    : null;
  const who=`<span class="dc-user">${av?`<img src="${esc(av)}" alt="" width="24" height="24">`:""}${esc(u.globalName||u.username||"Signed in")}</span>`;
  const w=state.wallet;
  const purse=w?`<span class="tt-chip" style="cursor:default">${TT}<b>${ttNum(w.balance)}</b></span>`:"";
  const skins=`<button id="dcSkins">🎡 Skins${w&&w.spin&&w.spin.available?" · spin ready":""}</button>`;
  if(!state.skin){
    return `${who}${purse}${skins}<button id="dcOut">Sign out</button>
      <span class="num-hint" style="flex-basis:100%">No skin on yet. Win one on the daily wheel or buy it with
      Tung Tungs — ${skinTotal()} of them, and you earn by using the site.</span>${privacy}`;
  }
  return `${who}${purse}
    <span class="skin-chip"><i></i>${esc(state.skin.name||state.skin.id)}</span>
    <button id="dcSkin" class="${skinOn()?"primary":""}">${skinOn()?"✓ On":"Off"}</button>
    ${skins}<button id="dcOut">Sign out</button>
    <span class="num-hint" style="flex-basis:100%">${esc(state.skin.series||state.skin.name||"")} — yours, kept on the account.
      Off just hides it on this device and goes back to your own theme and accent below; to swap to a different one, open Skins.</span>${privacy}`;
}
function wireDiscordSettings(){
  if($("dcIn")) $("dcIn").onclick=discordSignIn;
  if($("dcOut")) $("dcOut").onclick=discordSignOut;
  if($("dcSkins")) $("dcSkins").onclick=()=>openSkins();
  if($("dcSkin")) $("dcSkin").onclick=()=>{
    localStorage.setItem(SKIN_ON_KEY, skinOn()?"0":"1");
    applyAppearance();
    renderDiscordChip();
    openSettings();
  };
}
// Segmented control for a `state` key that persists under `anical.<key>`.
function prefSeg(key, opts){
  return `<div class="seg2">`+opts.map(([val,label,tip])=>
    `<button data-pref="${key}|${esc(String(val))}" class="${String(state[key])===String(val)?"on":""}"${tip?` title="${esc(tip)}"`:""}>${esc(label)}</button>`).join("")+`</div>`;
}
/* Density, in Settings (Day 28). The control sets the density of the view you
   were looking at when you opened Settings, and says which one that is — a
   per-view setting presented as a global one is a setting nobody can predict. */
const VIEW_LABEL = {month:"the calendar", week:"the calendar", agenda:"the calendar",
  board:"your board", lists:"your lists", dashboard:"the dashboard", events:"events"};
function densitySettingsHTML(){
  const view=densityViewOf(state.viewMode), cur=densityFor(state.viewMode);
  const opts=DENSITIES.filter(([v])=>v!=="grid"||GRID_VIEWS.has(view));
  const set=Object.keys(state.densityBy).length;
  return `<div class="set-row"><div class="set-label">Density
      <div class="set-hint">Applies to <b>${esc(VIEW_LABEL[state.viewMode]||"this view")}</b>, which is what you have open.
        Each view keeps its own — a month grid usually wants to be compact while a board of cover art wants room —
        and anything you have not set follows the app default.${
        set?` <b>${set}</b> view${set===1?" has":"s have"} a setting of their own.`:""}</div></div>
    <div class="seg2">${opts.map(([v,label,tip])=>
      `<button data-density="${v}" class="${cur===v?"on":""}"${tip?` title="${esc(tip)}"`:""}>${esc(label)}</button>`).join("")}</div>
    ${set?`<button id="denReset" style="margin-left:8px">↺ One setting again</button>`:""}</div>`;
}
/* ---------- axis weights, in Settings (Day 15) ----------
   Global, not per show — "I care more about story than art" is a statement
   about you, not about one anime — which is why this lives here and the axes
   themselves live in the show pop-up. */
const weightText = v => (v ? "×"+v : "off");
function weightsSettingsHTML(){
  const w=storedWeights(), rated=Object.keys(state.axes).length, allOff=weightsAllOff();
  const rows=AXIS_DEFS.map(ax=>{
    const v=w[ax.key];
    return `<label class="ax-lab" for="wt-${ax.key}">${ax.label}</label>
      <input type="range" class="ax-sl" id="wt-${ax.key}" data-wt="${ax.key}"
        min="0" max="${WEIGHT_MAX}" step="0.5" value="${v}"
        aria-label="How much ${ax.label} counts" aria-valuetext="${weightText(v)}">
      <span class="ax-val${v?"":" none"}" data-wtval="${ax.key}">${weightText(v)}</span>`;
  }).join("");
  return `<div class="set-row"><div class="set-label">Score weighting
      <div class="set-hint">How much each axis counts toward the single score. Applies to every show at once —
        ${rated?`you have <b>${rated}</b> rated show${rated===1?"":"s"}`:"nothing is rated yet"}.
        An axis set to <b>off</b> stops counting; turning them all off is ignored, since that would leave no score at all.</div></div>
    <div style="flex-basis:100%">
      <div class="ax-grid">${rows}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <button id="wtReset"${weightsAreDefault()?" disabled":""}>↺ Equal again</button>
        <span class="num-hint" id="wtNote" style="margin:0">${allOff
          ? "Every axis is off — so all five are counting equally, because otherwise there would be no score at all."
          : weightsAreDefault() ? "All five count the same."
          : "Your scores have been recalculated."}</span>
      </div>
      <span class="num-hint" style="display:block;margin-top:6px">Changing these rewrites your own scores, not the axes behind them —
        set everything back to ×1 and every score returns to exactly what it was. AniList is not re-pushed automatically
        (it would be one upload per show); use <b>⬆ Push everything</b> under AniList if you want it to match.</span>
    </div></div>`;
}
/* ---------- the shape of your own scoring, in Settings (Day 16) ----------
   Ten columns, one per whole score. The bucket is Math.round(composite), which
   is the rounding ratingChipOn() already uses to decide which chip lights — so
   a 7.4 lands in the column whose number the pop-up is showing it as, rather
   than in a column that agrees with nothing else on screen.

   It reads `state.ratings`, not the axes, and that is the point: the composite
   is the score, so re-weighting above redraws this. The chart is the only place
   the weights sliders show their own effect.

   Day 17 made it the proof of the normalization toggle too, for the same
   reason: it counts what a score is SHOWN as, so switching the stretch on
   visibly pulls the columns apart. */
function scoreSpread(){
  const counts=new Array(RATING_MAX+1).fill(0);   // index 1..10 — 0 means unrated, never a score
  let n=0, sum=0;
  for(const id of Object.keys(state.ratings)){
    const v=shownRating(id); if(!v) continue;
    // Clamped because a score that arrived from somewhere else — an AniList
    // pull off a 100-point scale, a pasted sync code — can be small enough to
    // round to 0, and a 0 column would file a rated show under "unrated".
    // Nothing this app writes itself can: the smallest score it stores is 0.5.
    counts[Math.min(RATING_MAX, Math.max(1, Math.round(v)))]++;
    n++; sum+=v;
  }
  // Strictly greater, so a tie goes to the lower score. Somebody split evenly
  // between 7s and 8s is a 7 person; calling it either way is arbitrary, and
  // arbitrary-but-stable beats arbitrary-and-drifting as scores come and go.
  let peak=0;
  for(let i=1;i<=RATING_MAX;i++) if(counts[i]>(peak?counts[peak]:0)) peak=i;
  return { counts, n, peak:n?peak:0, tallest:n?counts[peak]:0,
           avg: n ? Math.round((sum/n)*10)/10 : 0 };
}
const SPREAD_H = 88;   // px of bar, inside a 104px column — the rest is the count above it
function spreadChartHTML(){
  const s=scoreSpread();
  if(!s.n) return `<span class="num-hint" style="margin:0">Nothing rated yet — score a few shows and the shape of how you rate turns up here.</span>`;
  let cols="", axis="";
  for(let i=1;i<=RATING_MAX;i++){
    const c=s.counts[i];
    // Heights are relative to the tallest column, not to the library size, so
    // six rated shows and six hundred draw the same shape. An empty score gets
    // no bar at all rather than a sliver, because a sliver reads as "one".
    const h=c?Math.max(3,Math.round((c/s.tallest)*SPREAD_H)):0;
    cols+=`<div class="sp-col${c?" has":""}${i===s.peak?" peak":""}" title="${c} show${c===1?"":"s"} at ${i}/10">
        <span class="sp-n">${c||""}</span>
        <div class="sp-bar ${ratingBand(i)}" style="height:${h}px"></div>
      </div>`;
    axis+=`<span>${i===s.peak?`<b>${i}</b>`:i}</span>`;
  }
  const pct=Math.round((s.tallest/s.n)*100);
  const shape = s.tallest>1
    ? `${pct}% of them are ${s.peak}s`
    : "no score has come up twice yet";
  return `<div class="sp-grid" role="img" aria-label="Your score distribution: ${
      Array.from({length:RATING_MAX},(_,i)=>`${s.counts[i+1]} at ${i+1}`).join(", ")}">${cols}</div>
    <div class="sp-x">${axis}</div>
    <span class="num-hint" style="display:block;margin-top:7px"><b>${s.n}</b> rated ·
      average <b>${s.avg}</b> · ${shape}.</span>`;
}
function spreadSettingsHTML(){
  return `<div class="set-row"><div class="set-label">Your scores
      <div class="set-hint">Where your own ratings actually land. One column per whole score —
        a 7.4 counts as a 7, the same rounding the picker uses to decide which number lights up.
        Changing the weights above reshapes this, because it changes the scores it is drawn from.</div></div>
    <div style="flex-basis:100%" id="spread">${spreadChartHTML()}</div></div>`;
}
/* Redrawn from renderView(), which every path that can move a score already
   calls — a chip click, a slider release, a weight drag, an AniList pull, an
   undo. Cheaper than teaching each of them about this panel, and the guard
   makes it nothing at all for the whole time Settings is shut. */
function paintScoreSpread(){
  const host=$("spread"); if(!host) return;
  host.innerHTML=spreadChartHTML();
}
/* ---------- "spread my scores", in Settings (Day 17) ----------
   Sits between the weights and the histogram deliberately: the chart directly
   under it is drawn from displayed scores, so flipping this pulls the columns
   apart while you watch — the same trick Day 16 used to give the weight sliders
   something to show for themselves. */
function normSettingsHTML(){
  const s=normStats();
  let note;
  if(!s.n) note="Nothing rated yet.";
  else if(s.n<NORM_MIN_RATED) note=`Only <b>${s.n}</b> rated show${s.n===1?"":"s"} — this needs at least ${NORM_MIN_RATED} before the shape means anything, so it is doing nothing yet.`;
  else if(s.sd<NORM_MIN_SD) note=`Every score you have given is a <b>${Math.round(s.mean*10)/10}</b> — there is no spread to stretch, so this is doing nothing.`;
  else note=`Your scores run <b>${s.lo}</b>–<b>${s.hi}</b>, averaging <b>${Math.round(s.mean*10)/10}</b>.
    Spread out they are stretched <b>×${Math.round(s.k*100)/100}</b> around that average${
    s.k>=NORM_MAX_K?` — the cap, so a tightly clustered list can't become a list of 1s and 10s`:""}.`;
  return `<div class="set-row"><div class="set-label">Spread my scores
      <div class="set-hint">If most of what you rate lands on the same two numbers, this pulls them apart so you can
        see which of your 8s you actually preferred. <b>Nothing is rewritten</b> — your stored scores, the picker in
        each show, your AniList account and every export are the numbers you typed. Only cards and the chart below
        change, and switching this off puts them straight back.</div></div>
    ${prefSeg("normalize",[[false,"Off"],[true,"Spread out","Stretch the gaps between your scores, on screen only"]])}
    <span class="num-hint" style="flex-basis:100%;margin:0">${note}</span></div>`;
}
/* ---------- head to head, the panel (Day 19) ----------
   Two cards, one question, one keystroke. Day 18 did the model and the pair
   selection, so this day adds no arithmetic: it draws what nextPair() hands it
   and calls recordPair() with the answer.

   The skip set is deliberately session-only and lives nowhere near the log.
   "Not this one, ask me something else" is a statement about right now; storing
   it would quietly shrink the pool for good, and a pair you refused on a
   Tuesday is one you would happily answer a week later. */
function versusSkipSet(){ if(!state._vsSkip) state._vsSkip=new Set(); return state._vsSkip; }
const isVersusOpen = () => state._modalKind==="versus" && $("overlay").classList.contains("on");
function openVersus(){
  state._modalKind="versus";
  // Reopening never resumes a finished run — the payoff screen is something you
  // read once, not a state the panel gets stuck in.
  if(state._vsRun && state._vsRun.done>=state._vsRun.target) calibStop();
  versusServe();
  $("modalTitle").textContent="⚔ Head to head";
  renderVersus();
  $("overlay").classList.add("on");
}
function versusCardHTML(id, other, side){
  const md=findMediaById(id);
  const name=md?title(md):("#"+id);
  const img=(md&&md.coverImage&&(md.coverImage.large||md.coverImage.medium))||"";
  const sc=getRating(id), c=pairCount(id);
  const meta=[ sc?`your ${normApply(sc)}/10`:"unrated",
               c?`${c} compared`:"never compared" ].join(" · ");
  return `<button type="button" class="vs-card" data-vs="${esc(id)}|${esc(other)}"
      aria-label="Pick ${esc(name)} — ${side}">
    ${img?`<img src="${esc(img)}" alt="" loading="lazy" width="132" height="198">`
         :`<span class="vs-ph" aria-hidden="true">🎬</span>`}
    <span class="vs-t">${esc(name)}</span>
    <span class="vs-meta">${esc(meta)}</span>
  </button>`;
}
// The order so far, kept short. It is here rather than on a page of its own
// because the only honest answer to "why did it ask me that" is to show what
// the answers have built — and five rows is enough to recognise it as yours.
function versusRankHTML(limit){
  const order=pairOrder();
  if(!order.length) return "";
  const rows=order.slice(0, limit||5).map((id,i)=>{
    const md=findMediaById(id);
    return `<b>${i+1}</b><span>${esc(md?title(md):"#"+id)}</span><i>${pairCount(id)}×</i>`;
  }).join("");
  const conf=pairConflicts();
  return `<div class="vs-rank">${rows}</div>
    <span class="num-hint" style="display:block;margin-top:7px">Built from <b>${state.pairs.length}</b>
      comparison${state.pairs.length===1?"":"s"} across <b>${order.length}</b> show${order.length===1?"":"s"}${
      conf?` · <b>${conf}</b> of your answers disagree with the rest and were averaged in rather than dropped`:""}.</span>`;
}
/* The proposal (Day 21). Rendered wherever it is asked for, and rendering it is
   the only thing that happens until a button is pressed — suggestedScores() is
   pure and applySuggestions() is reachable from exactly one click handler. */
function versusSuggestHTML(){
  const rows=suggestedScores();
  if(!rows.length) return "";
  const list=rows.slice(0,8).map(r=>{
    const md=findMediaById(r.id);
    return `<b class="${r.next>r.cur?"up":"down"}">${r.next>r.cur?"▲":"▼"}</b>
      <span>${esc(md?title(md):"#"+r.id)}</span>
      <i>${r.cur} → <b>${r.next}</b></i>`;
  }).join("");
  return `<div class="vs-sug">
    <div class="vs-sug-h">Your comparisons disagree with your scores on
      <b>${rows.length}</b> show${rows.length===1?"":"s"}</div>
    <div class="vs-rank vs-sug-l">${list}</div>
    ${rows.length>8?`<span class="num-hint" style="display:block;margin-top:6px">…and ${rows.length-8} more.</span>`:""}
    <div class="vs-bar" style="margin-top:9px">
      <button id="vsApply" class="primary">Use these scores</button>
      <span class="num-hint" style="margin:0">Nothing is changed until you press it, and one Undo puts every
        score back. These are the same numbers you already gave — dealt out in the order your comparisons put
        the shows in, so your average and the shape of your ratings don't move at all.</span>
    </div></div>`;
}
function versusHTML(){
  const pool=versusPool();
  if(pool.length<2){
    return `<p style="margin-top:0">This needs at least two shows it can put side by side — ones you have
        <b>rated</b>, or marked Watching, Completed, On Hold or Dropped. Plan to Watch doesn't count, since
        the question is which you liked more.</p>
      <p class="num-hint">It can see ${pool.length} right now. Shows from seasons that aren't loaded join the
        pool as the app fetches them.</p>${versusRankHTML()}`;
  }
  const run=state._vsRun;
  // A run that has reached its target: the payoff screen. This is the whole
  // point of Day 20 — ten answers and you are looking at an ordering, rather
  // than at an eleventh question.
  if(run && run.done>=run.target){
    return `<p style="margin-top:0"><b>Done — ${run.done} answers.</b> Here is the order they put those
        ${run.ids.length} shows in.</p>
      ${versusRankHTML(run.ids.length)}
      ${versusSuggestHTML()}
      <div class="vs-bar" style="margin-top:10px">
        <button id="vsAgain" class="primary">Another ten</button>
        <button id="vsFree">Keep going freely</button>
      </div>`;
  }
  const p=state._vsPair;
  if(!p){
    return `<p style="margin-top:0">Nothing left to ask this session — you have answered or skipped every pair
        it wanted to put to you. Skips reset when you reload.</p>${versusRankHTML()}${versusSuggestHTML()}`;
  }
  const head = run
    ? `<div class="vs-prog"><div class="vs-prog-bar"><i style="width:${Math.round(run.done/run.target*100)}%"></i></div>
        <span>${run.done} of ${run.target}</span></div>`
    : `<p class="num-hint" style="margin:0 0 10px">Which did you like more? There is no wrong answer and no
        undoing needed — every verdict can be changed by answering the same pair again.</p>`;
  return `${head}
    <div class="vs-grid">
      ${versusCardHTML(p[0], p[1], "on the left")}
      <span class="vs-or">vs</span>
      ${versusCardHTML(p[1], p[0], "on the right")}
    </div>
    <div class="vs-bar">
      <button id="vsSkip">⤳ Skip this pair</button>
      ${run?`<button id="vsQuit">Stop the run</button>`:""}
      <span class="num-hint" style="margin:0"><kbd>←</kbd> / <kbd>→</kbd> to pick, <kbd>S</kbd> to skip.</span>
    </div>
    ${run?"":`${versusStartHTML()}${versusRankHTML()}${versusSuggestHTML()}`}`;
}
// Offered, not forced. Somebody who already has fifty comparisons does not need
// a guided ten, so the pitch changes to what a run is actually for once there
// is a history: a fresh working set rather than a first one.
function versusStartHTML(){
  const n=state.pairs.length;
  return `<div class="vs-bar" style="margin-top:11px">
    <button id="vsRun">▶ Guided run of ${CALIB_ROUNDS}</button>
    <span class="num-hint" style="margin:0">${n
      ? `Picks ${CALIB_SET} shows spread across your scores and asks only about those — a small set answered properly beats a large one answered once.`
      : `Ten questions about ${CALIB_SET} of your shows, and you come out the other side with an ordering. The quickest way to start from nothing.`}</span>
  </div>`;
}
function renderVersus(){
  $("modalBody").innerHTML=versusHTML();
  if($("vsSkip"))  $("vsSkip").onclick=versusSkip;
  if($("vsRun"))   $("vsRun").onclick=()=>{ calibStart(); versusServe(); renderVersus(); };
  if($("vsAgain")) $("vsAgain").onclick=()=>{ calibStart(); versusServe(); renderVersus(); };
  if($("vsQuit"))  $("vsQuit").onclick=()=>{ calibStop(); versusServe(); renderVersus(); };
  if($("vsFree"))  $("vsFree").onclick=()=>{ calibStop(); versusServe(); renderVersus(); };
  if($("vsApply")) $("vsApply").onclick=versusApply;
}
/* One place decides which pool the next question comes from, so a run can never
   leak a question about a show outside its working set — and ending a run can
   never leave the previous set's question on screen. */
function versusServe(){
  state._vsPair = calibRunning()
    ? nextPair(versusSkipSet(), state._vsRun.ids)
    : nextPair(versusSkipSet());
}
function versusAnswer(winner, loser){
  const asked=state._vsPair;   // as it was on screen, so an undo redraws the same two sides
  const prev=recordPair(winner, loser);
  const md=findMediaById(winner);
  const run=state._vsRun;
  if(calibRunning()) run.done++;
  versusServe();
  if(isVersusOpen()) renderVersus();
  // No toast during a run: it would fire ten times in a row over the progress
  // bar, and the undo it offers is the one thing a guided run already has —
  // answer the pair again and the verdict is replaced.
  if(run) return;
  toast(`⚔ ${md?title(md):"That one"} wins`, ()=>{
    undoPair(winner, loser, prev);
    // Put the question back, not just the log: an undo that only rewound the
    // record would leave you looking at the next pair with no way to answer the
    // one you just changed your mind about.
    state._vsPair=asked||[winner, loser];
    if(isVersusOpen()) renderVersus();
  });
}
function versusSkip(){
  const p=state._vsPair; if(!p) return;
  versusSkipSet().add(pairKey(p[0], p[1]));
  versusServe();
  // A run that runs out of unskipped pairs inside its own eight shows is over,
  // not stuck: without this the panel would sit on "nothing left to ask" with a
  // progress bar reading 6 of 10 and no way forward.
  if(calibRunning() && !state._vsPair) state._vsRun.done=state._vsRun.target;
  renderVersus();
}
function versusApply(){
  const rows=suggestedScores();
  if(!rows.length) return;
  const undo=applySuggestions(rows);
  renderVersus(); renderView();
  toast(`Rescored ${rows.length} show${rows.length===1?"":"s"}`,
        ()=>{ revertSuggestions(undo); renderVersus(); renderView(); });
}
/* ---------- month wrap (Day 31) ----------
   A month you can page back through, not just "this month" — the card is worth
   most on the 1st, when the month it describes has just ended. */
const MONTH_NAMES=["January","February","March","April","May","June","July","August","September","October","November","December"];
function wrapStatHtml(n, one, many, ids){
  if(!n) return "";
  const names=(ids||[]).slice(0,3).map(id=>{ const md=findMediaById(id); return md?title(md):null; }).filter(Boolean);
  return `<div class="mw-stat">
    <b>${n}</b><span>${n===1?one:many}</span>
    ${names.length?`<i>${esc(names.join(", "))}${(ids.length>names.length)?` +${ids.length-names.length}`:""}</i>`:""}
  </div>`;
}
function monthWrapHTML(y, m){
  const w=monthWrap(y,m);
  const label=`${MONTH_NAMES[m]} ${y}`;
  const now=new Date(), isNow = y===now.getFullYear() && m===now.getMonth();
  const nav=`<div class="mw-nav">
      <button data-mwstep="-1" title="Previous month">‹</button>
      <b>${label}${isNow?" · so far":""}</b>
      <button data-mwstep="1" title="Next month"${isNow?" disabled":""}>›</button>
    </div>`;
  if(w.empty){
    return `${nav}<p class="num-hint" style="margin:10px 0 0">Nothing recorded in ${label}${
      w.partial?` — this only started keeping track on ${w.since||"the day you updated"}.`:"."}
      ${isNow?" Rate something, mark an episode, or finish a show and it turns up here.":""}</p>`;
  }
  const stats=[
    wrapStatHtml(w.episodes, "episode watched", "episodes watched"),
    wrapStatHtml(w.finished.length, "show finished", "shows finished", w.finished),
    wrapStatHtml(w.started.length, "show started", "shows started", w.started),
    wrapStatHtml(w.added.length, "show added", "shows added", w.added),
    wrapStatHtml(w.rated.length, "show rated", "shows rated", w.rated),
    wrapStatHtml(w.noted.length, "note written", "notes written", w.noted),
    wrapStatHtml(w.dropped.length, "show dropped", "shows dropped", w.dropped),
  ].filter(Boolean).join("");
  // The one number that is a judgement rather than a count, so it is phrased as
  // one: the best thing you rated this month, by your own score.
  const best=w.rated.map(id=>({id, n:getRating(id)})).sort((a,b)=>b.n-a.n)[0];
  const bestMd=best?findMediaById(best.id):null;
  return `${nav}
    <div class="mw-grid">${stats}</div>
    ${bestMd?`<p class="num-hint" style="margin:10px 0 0">Your highest score of the month went to
      <b>${esc(title(bestMd))}</b> — ${best.n}/10.</p>`:""}
    ${w.partial?`<p class="num-hint" style="margin:8px 0 0">Counts of what you <b>added, rated and wrote</b> only go back to
      ${esc(w.since||"the day you updated")}, when this started keeping track. Shows <b>finished</b> and <b>started</b> are read from
      the dates on each show, so those go back as far as your library does.</p>`:""}`;
}
function openMonthWrap(y, m){
  const now=new Date();
  state._mw = { y: y==null?now.getFullYear():y, m: m==null?now.getMonth():m };
  state._modalKind="wrap";
  $("modalTitle").textContent="📅 Your month";
  renderMonthWrap();
  $("overlay").classList.add("on");
}
function renderMonthWrap(){
  $("modalBody").innerHTML=monthWrapHTML(state._mw.y, state._mw.m);
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-mwstep]"); if(!b || !state._mw) return;
  e.preventDefault();
  const d=new Date(state._mw.y, state._mw.m + (+b.dataset.mwstep), 1);
  const now=new Date();
  // Never past the current month: a wrap of a month that hasn't happened is an
  // empty card that looks like a bug.
  if(d > new Date(now.getFullYear(), now.getMonth(), 1)) return;
  state._mw={y:d.getFullYear(), m:d.getMonth()};
  renderMonthWrap();
});
/* Day 44: the predictor's own error rate, run on demand and reported openly —
   including against the baseline of "just guess my average every time", because
   a mean error with nothing to compare it to is a number that sounds like
   evidence and is not. */
function predictorSettingsHTML(){
  const v=tasteVectors();
  return `<div class="set-row"><div class="set-label">Predictions
      <div class="set-hint">Estimated scores for shows you haven't rated, built from your own ratings and nothing else.
        They appear on cards, in every show pop-up and on <b>✨ For you</b>. Nothing is uploaded and no model is trained
        anywhere but in this browser.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button id="btTest"${v.rated<TASTE_MIN_RATED+2?" disabled":""}>📉 Test it on my own ratings</button>
      <span class="num-hint" id="btOut" style="margin:0">${v.rated>=TASTE_MIN_RATED+2
        ? `Hides each of your scores in turn, predicts it from the rest, and reports how far off it was.`
        : v.total>=TASTE_MIN_RATED+2
          // Enough ratings, not enough of them loaded. Saying "you have 2" here
          // would be telling someone with 11 ratings to go and rate more.
          ? `You have ${v.total} rated shows, which is enough — ${v.unresolved} of them aren't loaded in this
             browser yet, so only ${v.rated} can be tested against. Give it a moment.`
          : `Needs ${TASTE_MIN_RATED+2} rated shows to test itself; you have ${v.total}.`}</span>
    </div></div>`;
}
function wrapSettingsHTML(){
  const now=new Date(), w=monthWrap(now.getFullYear(), now.getMonth());
  return `<div class="set-row"><div class="set-label">Your month
      <div class="set-hint">What you added, rated, watched and finished, month by month. Built from a log kept
        in this browser — it records what you did and when, never what a show was.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button id="mwOpen">📅 This month</button>
      <span class="num-hint" style="margin:0">${w.empty
        ? "Nothing recorded yet this month."
        : `${w.episodes?`<b>${w.episodes}</b> episode${w.episodes===1?"":"s"}`:""}${
            w.episodes&&w.finished.length?" · ":""}${
            w.finished.length?`<b>${w.finished.length}</b> finished`:""} so far.`}</span>
    </div></div>`;
}
/* ---------- the sort builder, as a panel (Day 29) ----------
   Rows you add, reorder and remove, because the order of the keys IS the sort —
   a set of checkboxes could express "status and score" but not "status, then
   score", which is the whole feature. */
const isSortOpen = () => state._modalKind==="sort" && $("overlay").classList.contains("on");
function openSortBuilder(){
  state._modalKind="sort";
  $("modalTitle").textContent="⇅ Sort";
  renderSortBuilder();
  $("overlay").classList.add("on");
}
function sortRowHtml(rule, i, used){
  const def=SORT_BY_KEY[rule.key];
  const opts=SORT_KEYS.filter(k=>k.key===rule.key||!used.has(k.key))
    .map(k=>`<option value="${k.key}"${k.key===rule.key?" selected":""}>${esc(k.label)}</option>`).join("");
  const asc=rule.dir==="asc";
  return `<div class="so-row">
    <span class="so-n">${i===0?"Sort by":"then by"}</span>
    <select class="so-key" data-sortkey="${i}">${opts}</select>
    <button type="button" class="so-dir" data-sortdir="${i}" title="Reverse this key">${
      def.text ? (asc?"A–Z":"Z–A") : (asc?"↑ lowest first":"↓ highest first")}</button>
    <button type="button" class="so-x" data-sortup="${i}" title="Move up"${i===0?" disabled":""}>↑</button>
    <button type="button" class="so-x" data-sortdel="${i}" title="Remove this key">✕</button>
  </div>`;
}
function sortBuilderHTML(){
  const cur=activeSort(), used=new Set(cur.map(r=>r.key));
  const canAdd=cur.length<SORT_KEYS.length;
  const curId=currentSortId();
  const saved=state.sorts.length ? state.sorts.map(s=>`
    <div class="so-saved${s.id===curId?" on":""}">
      <button type="button" class="so-apply" data-sortapply="${esc(s.id)}">
        <b>${esc(s.name)}</b><i>${esc(sortSummary(s.keys))}</i></button>
      <button type="button" class="so-x" data-sortforget="${esc(s.id)}" title="Delete ${esc(s.name)}">🗑</button>
    </div>`).join("") : `<p class="num-hint" style="margin:0">Nothing saved yet.</p>`;
  return `<p class="num-hint" style="margin:0 0 10px">Applies to your board and 📚 Lists. Ties fall through to the next
      key, and anything still tied keeps the order it already had. Pinned shows stay on top regardless.</p>
    <div class="so-rows">${cur.map((r,i)=>sortRowHtml(r,i,used)).join("")}</div>
    <div class="vs-bar" style="margin-top:9px">
      ${canAdd?`<button id="soAdd">＋ Add a key</button>`:""}
      <button id="soReset"${JSON.stringify(cur)===JSON.stringify(DEFAULT_SORT)?" disabled":""}>↺ Default</button>
    </div>
    <div class="so-save">
      <input id="soName" type="text" maxlength="40" placeholder="Name this sort…" autocomplete="off"
        aria-label="Name for this sort">
      <button id="soSave" class="primary">Save</button>
    </div>
    <h4 class="set-head" style="margin-top:14px">Saved sorts</h4>
    ${saved}
    <p class="num-hint" style="margin-top:10px">A show with nothing to sort on — no score, no date, no announced
      episode count — always goes to the bottom, whichever way the arrow points. It is not a zero, it is absent.</p>`;
}
function renderSortBuilder(){
  $("modalBody").innerHTML=sortBuilderHTML();
  if($("soAdd")) $("soAdd").onclick=()=>{
    const used=new Set(activeSort().map(r=>r.key));
    const next=SORT_KEYS.find(k=>!used.has(k.key));
    if(!next) return;
    state.sort=activeSort().concat([{key:next.key, dir: next.asc?"asc":"desc"}]);
    saveSortState(); renderSortBuilder(); renderView();
  };
  if($("soReset")) $("soReset").onclick=()=>{
    state.sort=[]; saveSortState(); renderSortBuilder(); renderView();
  };
  if($("soSave")) $("soSave").onclick=()=>{
    const el=$("soName"), rec=saveNamedSort(el.value);
    if(!rec){ el.focus(); return; }
    el.value=""; renderSortBuilder();
    toast(`Saved “${rec.name}”`, ()=>{ deleteNamedSort(rec.id); renderSortBuilder(); });
  };
  const name=$("soName");
  if(name) name.onkeydown=ev=>{ if(ev.key==="Enter"){ ev.preventDefault(); $("soSave").click(); } };
}
/* ---------- your notes, searchable (Day 23) ----------
   Notes have existed since Day 02 and have never had anywhere to live: the only
   way to read one was to remember which show it was on and open that show. This
   is the index — every note in one list, filtered as you type.

   The search is over the BODY, and the acceptance line says so. Titles are what
   the main search box already does; the whole reason to search notes is to find
   the show whose name you have forgotten by way of the thing you wrote about it,
   so a query is matched against note text first and the title is only there to
   tell you which show you found. */
function noteMatches(q){
  q=String(q||"").trim().toLowerCase();
  const out=[];
  for(const id of Object.keys(state.notes)){
    const body=getNote(id); if(!body) continue;
    const md=findMediaById(id);
    const name=md?title(md):"";
    // Case-insensitive, and a blank query lists everything rather than nothing —
    // an index that starts empty reads as broken.
    if(q && body.toLowerCase().indexOf(q)<0 && name.toLowerCase().indexOf(q)<0) continue;
    out.push({id, body, name: name||("#"+id), hit: !q || body.toLowerCase().indexOf(q)>=0});
  }
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}
// One match highlighted per row, not all of them: the row is a preview, and the
// job is to show you WHY it matched, which the first occurrence does.
function noteSnippet(body, q, id){
  const spoil=isSpoilerNote(id)&&!noteRevealed(id);
  if(spoil) return `<i class="nt-hidden">Spoiler — tap to show</i>`;
  q=String(q||"").trim().toLowerCase();
  const flat=body.replace(/\s+/g," ").trim();
  if(!q) return esc(flat.slice(0,150))+(flat.length>150?"…":"");
  const at=flat.toLowerCase().indexOf(q);
  if(at<0) return esc(flat.slice(0,150))+(flat.length>150?"…":"");
  const from=Math.max(0, at-40);
  return (from?"…":"")+esc(flat.slice(from, at))
    +`<mark>${esc(flat.slice(at, at+q.length))}</mark>`
    +esc(flat.slice(at+q.length, at+q.length+90))+(flat.length>at+q.length+90?"…":"");
}
function notesPanelHTML(q){
  const rows=noteMatches(q), total=Object.keys(state.notes).filter(id=>getNote(id)).length;
  if(!total) return `<p class="num-hint" style="margin:0">No notes yet. Open any show and write one — they stay in this browser and are never uploaded.</p>`;
  const list=rows.length ? rows.map(r=>`<div class="nt-res" role="button" tabindex="0" data-noteopen="${esc(r.id)}">
      <div class="nt-res-t">${esc(r.name)}${isSpoilerNote(r.id)?` <span class="nt-res-s">🙈</span>`:""}</div>
      <div class="nt-res-b">${noteSnippet(r.body, q, r.id)}</div>
    </div>`).join("")
    : `<p class="num-hint" style="margin:0">Nothing matches “${esc(q)}”.</p>`;
  return `<div class="nt-count">${rows.length} of ${total} note${total===1?"":"s"}</div>${list}`;
}
function openNotes(q){
  state._modalKind="notes";
  state._noteQ=q||"";
  $("modalTitle").textContent="📝 Your notes";
  $("modalBody").innerHTML=`
    <input id="noteSearch" type="search" placeholder="Search what you wrote…" autocomplete="off" spellcheck="false"
      value="${esc(state._noteQ)}" aria-label="Search your notes"
      style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--txt);font:inherit;font-size:13px">
    <div id="noteResults" style="margin-top:10px">${notesPanelHTML(state._noteQ)}</div>
    <p class="num-hint" style="margin-top:12px">Searches the text of your notes, not just titles — so you can find a show by the thing you wrote about it. Everything here is stored in this browser only.</p>`;
  const inp=$("noteSearch");
  inp.oninput=()=>{ state._noteQ=inp.value; $("noteResults").innerHTML=notesPanelHTML(state._noteQ); };
  $("overlay").classList.add("on");
  // Focus the field rather than the dialog: this panel exists to be typed into.
  setTimeout(()=>{ if(inp.isConnected) inp.focus(); }, 0);
}
function notesSettingsHTML(){
  const n=Object.keys(state.notes).filter(id=>getNote(id)).length;
  const s=[...state.noteSpoiler].filter(id=>getNote(id)).length;
  return `<div class="set-row"><div class="set-label">Your notes
      <div class="set-hint">Everything you have written, in one place and searchable by what it says.
        Notes are stored in this browser and are never uploaded — not even when you are signed in.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button id="ntOpen"${n?"":" disabled"}>📝 Search notes</button>
      <span class="num-hint" style="margin:0">${n
        ? `<b>${n}</b> note${n===1?"":"s"}${s?` · <b>${s}</b> marked spoiler`:""}.`
        : "Nothing written yet."}</span>
    </div></div>`;
}
function versusSettingsHTML(){
  const n=state.pairs.length, order=pairOrder();
  const topMd=order.length?findMediaById(order[0]):null;
  const top=order.length?(topMd?title(topMd):"#"+order[0]):"";
  return `<div class="set-row"><div class="set-label">Head to head
      <div class="set-hint">Two shows at a time: which did you like more? People answer that consistently and
        answer "what is this out of ten" badly, so a handful of comparisons orders your library better than the
        scores do. Your answers are kept, the ordering is worked out from them, and neither touches your scores.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button id="vsOpen" class="primary">⚔ Compare shows</button>
      ${n?`<button id="vsClear">Clear ${n} comparison${n===1?"":"s"}</button>`:""}
      <span class="num-hint" style="margin:0">${n
        ? `<b>${n}</b> recorded, ordering <b>${order.length}</b> show${order.length===1?"":"s"}${
            top?` — top of your list is <b>${esc(top)}</b>`:""}.`
        : "Nothing compared yet."}</span>
    </div></div>`;
}
function openSettings(){
  state._modalKind="settings";
  $("modalTitle").textContent="⚙ Settings";
  const sw=ACCENTS.map(([name,a,b])=>`<button class="swatch${state.accent===a+"|"+b?" sel":""}" data-accent="${a}|${b}" title="${name}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join("");
  const f=state.filters;
  const num=(id,val,ph)=>`<input type="number" min="0" max="9999" id="${id}" value="${val||""}" placeholder="${esc(ph)}" class="num-in">`;
  $("modalBody").innerHTML=`
    ${state.skin&&skinOn()?`<div class="skin-note"><span class="skin-chip"><i></i>${esc(state.skin.name||state.skin.id)}</span>
      <span class="num-hint" style="margin:0">active — overriding the theme and accent below.</span></div>`:""}
    <h4 class="set-head">Account</h4>
    <div class="set-row"><div class="set-label">Discord</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${discordSettingsHTML()}</div></div>

    <h4 class="set-head">Appearance</h4>
    <div class="set-row"><div class="set-label">Theme</div>
      <div class="seg2"><button data-theme="dark" class="${state.theme==="dark"?"on":""}">🌙 Dark</button><button data-theme="light" class="${state.theme==="light"?"on":""}">☀️ Light</button><button data-theme="auto" class="${state.theme==="auto"?"on":""}">🌗 Auto</button></div></div>
    <div class="set-row"><div class="set-label">Accent</div><div class="swatches">${sw}</div></div>
    ${densitySettingsHTML()}
    <div class="set-row"><div class="set-label">Cover art</div>
      ${prefSeg("showImages",[[true,"Show"],[false,"Hide","Text-only rows fit far more on screen"]])}</div>

    <div class="set-row"><div class="set-label">Region
      <div class="set-hint">Where you watch. Release times differ by country, so this picks which measured time you get — it is not your timezone, which is detected separately. Blank means we guess from your timezone and fall back to the shared time when we have not measured yours.</div></div>
      <input id="setRegion" type="text" maxlength="2" spellcheck="false" placeholder="${esc(userRegion()||"auto")}" value="${esc((localStorage.getItem("anical.region")||"").toUpperCase())}"
        style="width:70px;text-transform:uppercase;font-family:inherit" aria-label="Two-letter country code" /></div>

    <h4 class="set-head">Timetable</h4>
    <div class="set-row"><div class="set-label">Week starts</div>
      ${prefSeg("weekStart",[["0","Sunday"],["1","Monday"],["6","Saturday"],["rot","Rotating","Week view starts on today. The month grid keeps a fixed first column."]])}</div>
    <div class="set-row"><div class="set-label">Time format</div>
      ${prefSeg("timeFormat",[["auto","Auto","Follow your device's locale"],["12","12h"],["24","24h"]])}</div>
    <div class="set-row"><div class="set-label">Order within a day</div>
      ${prefSeg("daySort",[["popularity","Popularity"],["time","Air time"],["alpha","A–Z"],["score","Score"]])}</div>
    <div class="set-row"><div class="set-label">Donghua</div>
      ${prefSeg("showDonghua",[[true,"Show"],[false,"Hide","Hide Chinese productions"]])}</div>

    <h4 class="set-head">Episode filters</h4>
    <div class="set-row"><div class="set-label">Season length</div>
      <div class="num-row">${num("fEpsMin",f.epsMin,"min")}<span class="num-sep">–</span>${num("fEpsMax",f.epsMax,"max")}
        <span class="num-hint">total episodes. Leave blank for any; shows with no announced count are only dropped by a minimum.</span></div></div>
    <div class="set-row"><div class="set-label">Episode number</div>
      <div class="num-row">${num("fAirMin",f.airedMin,"from")}<span class="num-sep">–</span>${num("fAirMax",f.airedMax,"to")}
        <span class="num-hint">which episodes to list — e.g. 1–3 to catch shows that just started.</span></div></div>

    <h4 class="set-head">Ratings</h4>
    ${weightsSettingsHTML()}
    ${normSettingsHTML()}
    ${spreadSettingsHTML()}
    ${versusSettingsHTML()}

    <h4 class="set-head">Notes</h4>
    ${notesSettingsHTML()}

    <h4 class="set-head">Taste &amp; predictions</h4>
    ${predictorSettingsHTML()}

    <h4 class="set-head">Looking back</h4>
    ${wrapSettingsHTML()}

    <h4 class="set-head">Your data</h4>
    <div class="set-row"><div class="set-label">Hidden</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="color:var(--muted);font-size:13px">${state.hidden.size} hidden show${state.hidden.size===1?"":"s"}</span>${state.hidden.size?`<button id="setUnhide">Unhide all</button>`:""}</div></div>
    <div class="set-row"><div class="set-label">AniList</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${alSettingsHTML()}</div></div>
    <div class="set-row"><div class="set-label">${alConnected()?"One-off import":"Import"}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="aniUser" placeholder="AniList username" autocomplete="off" spellcheck="false" style="flex:1;min-width:150px;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)">
        <button id="aniImport">⬇ Import public list</button>
        <span id="aniStatus" style="color:var(--muted);font-size:12px;flex-basis:100%"></span>
        <span class="num-hint">Reads any <em>public</em> list without signing in. One direction only — nothing goes back.</span>
      </div></div>
    <div class="set-row"><div class="set-label">Backup</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="setExport">⬇ Export file</button><button id="setImport">⬆ Import file</button>
        <button id="setCopyCode">📋 Copy sync code</button><button id="setPasteCode">📥 Paste code</button>
      </div></div>
    <p style="color:var(--muted);font-size:12px;margin-bottom:0">Your board, lists, ratings, private notes, watch-bells, hidden shows and reminders are saved on this device — nothing is uploaded. Use Export or a sync code to copy them to another device. Import pulls your public AniList list into ⭐ My List with its statuses, watch progress and scores.</p>`;
  wireAlSettings();
  wireDiscordSettings();
  // Timetable prefs: store, re-apply, re-render, and rebuild the panel so the
  // segmented control shows the new selection.
  $("modalBody").querySelectorAll("[data-pref]").forEach(el=>{
    el.onclick=()=>{
      const [key,raw]=el.dataset.pref.split("|");
      const val = raw==="true" ? true : raw==="false" ? false : raw;
      state[key]=val;
      localStorage.setItem("anical."+key, val===true?"1":val===false?"0":String(val));
      applyAppearance();
      renderView();
      openSettings();
    };
  });
  // Episode-count filters live with the other filters (URL + localStorage), not
  // with the appearance prefs, so a shared link carries them.
  const numHandlers=[["fEpsMin","epsMin"],["fEpsMax","epsMax"],["fAirMin","airedMin"],["fAirMax","airedMax"]];
  for(const [id,key] of numHandlers){
    const el=$(id); if(!el) continue;
    el.onchange=()=>{
      const n=Math.max(0,Math.min(9999,parseInt(el.value,10)||0));
      if(n) state.filters[key]=n; else delete state.filters[key];
      el.value=n||"";
      localStorage.setItem("anical.filters",JSON.stringify(state.filters));
      syncURL(false);
      renderView();
      setStatus(false,`Live · ${state.media.length} titles · ${rangeEvents().length} episodes shown`);
    };
  }
  // "Unhide all" throws away a list built one show at a time, so it hands back
  // a copy of it rather than a confirm dialog.
  if($("setUnhide")) $("setUnhide").onclick=()=>{
    const was=[...state.hidden];
    state.hidden.clear(); localStorage.removeItem("anical.hidden"); renderView(); openSettings();
    if(!was.length) return;
    toast(`Unhid ${was.length} show${was.length===1?"":"s"}`,
          ()=>{ was.forEach(id=>state.hidden.add(id));
                localStorage.setItem("anical.hidden", JSON.stringify([...state.hidden]));
                renderView(); openSettings(); });
  };
  if($("aniImport")){
    const run=async()=>{
      const u=$("aniUser").value, st=$("aniStatus"), btn=$("aniImport");
      st.style.color="var(--muted)"; st.textContent="Importing…"; btn.disabled=true;
      try{ const r=await importAniList(u);
        st.style.color="var(--ok,#3fb950)";
        st.textContent=`Imported: +${r.added} to ⭐ My List, ${r.progressed} with progress, ${r.rated} rated (of ${r.total} entries).`;
      }catch(e){ st.style.color="var(--bad,#f85149)"; st.textContent=e.message||"Import failed."; }
      finally{ btn.disabled=false; }
    };
    $("aniImport").onclick=run;
    $("aniUser").onkeydown=ev=>{ if(ev.key==="Enter") run(); };
    const last=localStorage.getItem("anical.aniUser"); if(last) $("aniUser").value=last;
    $("aniUser").onchange=()=>localStorage.setItem("anical.aniUser",$("aniUser").value.trim());
  }
  // Region: two letters or nothing. An invalid entry clears rather than sticks,
  // because a bad code silently selects the global time and looks like a bug.
  const rg=$("setRegion");
  if(rg) rg.onchange=()=>{
    const v=rg.value.trim().toUpperCase();
    if(/^[A-Z]{2}$/.test(v)) localStorage.setItem("anical.region",v);
    else { localStorage.removeItem("anical.region"); rg.value=""; }
    rg.placeholder=userRegion()||"auto";
    renderView();   // times can change immediately: a region rule may now apply
  };
  if($("ntOpen")) $("ntOpen").onclick=()=>openNotes();
  if($("mwOpen")) $("mwOpen").onclick=()=>openMonthWrap();
  if($("btTest")) $("btTest").onclick=()=>{
    const out=$("btOut"), btn=$("btTest");
    btn.disabled=true; out.textContent="Running…";
    // Deferred a frame so the button visibly disables — the hold-out rebuilds
    // the whole profile once per sampled show and does block.
    setTimeout(()=>{
      const r=predictorBacktest(40);
      btn.disabled=false;
      out.innerHTML = r
        ? `Over <b>${r.n}</b> of your ratings it was out by <b>${r.mae}</b> on average, and within a point
           <b>${r.within1}%</b> of the time. Guessing your average every time would be out by ${r.baseline} —
           so it is ${r.beatsBaseline?`<b>doing better than guessing</b>`:`<b>no better than guessing</b>, which means it needs more ratings`}.`
        : `Not enough confident predictions to measure yet — rate more shows and try again.`;
    }, 30);
  };
  if($("vsOpen")) $("vsOpen").onclick=()=>openVersus();
  // Throwing away a comparison history built one answer at a time gets the same
  // treatment "Unhide all" gets: it hands the whole thing back rather than
  // asking a confirm dialog whether you meant it.
  if($("vsClear")) $("vsClear").onclick=()=>{
    const was=clearPairs();
    openSettings();
    toast(`Cleared ${was.length} comparison${was.length===1?"":"s"}`,
          ()=>{ state.pairs=was; savePairs(); openSettings(); });
  };
  if($("setExport")) $("setExport").onclick=exportSettings;
  if($("setImport")) $("setImport").onclick=pickImport;
  if($("setCopyCode")) $("setCopyCode").onclick=copySyncCode;
  if($("setPasteCode")) $("setPasteCode").onclick=pasteSyncCode;
  $("overlay").classList.add("on");
}
/* ---- settings backup / sync (export, import, share-code) ---- */
const NO_BACKUP=new Set(["anical.cache.v1","anical.seenIds","anical.lastVisit","anical.overrides","anical.cache.tags","anical.lastrandom"]);   // derived/per-device caches, not worth syncing
function collectSettings(){ const d={}; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.indexOf("anical.")===0&&!NO_BACKUP.has(k)) d[k]=localStorage.getItem(k); } return d; }
function applySettings(data){ let n=0; for(const k in data){ if(k.indexOf("anical.")===0){ try{ localStorage.setItem(k,data[k]); n++; }catch(_){} } } return n; }
function exportSettings(){ downloadFile("tsuzuki-settings.json", JSON.stringify({type:"anical-settings",version:1,exported:new Date().toISOString(),data:collectSettings()},null,2), "application/json"); }
function importSettingsText(text){
  let o; try{ o=JSON.parse(text); }catch(e){ alert("That doesn't look like valid Tsuzuki settings."); return; }
  const data=(o&&o.data&&typeof o.data==="object")?o.data:((o&&typeof o==="object")?o:null);
  if(!data){ alert("That doesn't look like valid Tsuzuki settings."); return; }
  const n=applySettings(data); alert("Imported "+n+" setting"+(n===1?"":"s")+". Reloading…"); location.reload();
}
function pickImport(){ const inp=document.createElement("input"); inp.type="file"; inp.accept="application/json,.json"; inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>importSettingsText(String(r.result)); r.readAsText(f); }; inp.click(); }
function copySyncCode(){
  let code=""; try{ code=btoa(unescape(encodeURIComponent(JSON.stringify(collectSettings())))); }catch(e){ return; }
  const b=$("setCopyCode"), done=()=>{ if(b){ b.textContent="✓ Copied"; setTimeout(()=>{ if(b.isConnected) b.textContent="📋 Copy sync code"; },1500); } };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(()=>window.prompt("Copy your sync code:",code)); else window.prompt("Copy your sync code:",code);
}
function pasteSyncCode(){ const t=window.prompt("Paste your Tsuzuki sync code:"); if(!t) return; let json; try{ json=decodeURIComponent(escape(atob(t.trim()))); }catch(e){ alert("That sync code is invalid."); return; } importSettingsText(json); }

/* ---------- subscribable calendar feeds ---------- */
function subRow(name,label,desc){
  const https=location.origin+"/feeds/"+name+".ics";
  const webcal=https.replace(/^https?:/,"webcal:");
  const gcal="https://calendar.google.com/calendar/u/0/r?cid="+encodeURIComponent(https);
  return `<div style="border:1px solid var(--line);border-radius:11px;padding:12px;margin-bottom:10px">
    <div style="font-weight:700">${esc(label)}</div>
    <div style="color:var(--muted);font-size:12.5px;margin:3px 0 9px">${esc(desc)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <a class="discord-btn" style="background:var(--accent)" href="${esc(webcal)}">＋ Apple / Outlook</a>
      <a class="discord-btn" style="background:#4285F4" href="${esc(gcal)}" target="_blank" rel="noopener">＋ Google Calendar</a>
      <button data-copyfeed="${esc(https)}">📋 Copy URL</button>
    </div></div>`;
}
function myShowsIcs(){
  const now=Date.now()/1000, ev=[];
  for(const md of state.media){
    if(!isWatched(md.id)) continue;
    for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]){
      // Export the release being tracked, and skip break weeks entirely — a
      // phantom event in someone's real calendar is worse than a missing one.
      const v=trackedVariant(md,n);
      if(!v || v.ts < now-7*86400) continue;   // keep a little history + everything upcoming
      const start=new Date(v.ts*1000), end=new Date(v.ts*1000+30*60000);
      const suffix=v.type==="raw"?"":" ("+AIR_LABEL[v.type]+(v.platform?" · "+v.platform:"")+")";
      ev.push(["BEGIN:VEVENT","UID:tsuzuki-"+md.id+"-"+n.episode+"-"+v.type+"@tsuzuki.netlify.app","DTSTAMP:"+icsStamp(start),"DTSTART:"+icsStamp(start),"DTEND:"+icsStamp(end),"SUMMARY:"+icsEsc(title(md)+" — Episode "+n.episode+suffix), md.siteUrl?"URL:"+icsEsc(md.siteUrl):null,"END:VEVENT"].filter(Boolean).join("\r\n"));
    }
  }
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Tsuzuki//tsuzuki.top//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Tsuzuki — My Shows",...ev,"END:VCALENDAR"].join("\r\n")+"\r\n";
}
function downloadMyShows(){
  if(!state.watch.size){ alert("Star some shows (⭐ Add to My List) first, then download your calendar."); return; }
  downloadFile("tsuzuki-my-shows.ics", myShowsIcs(), "text/calendar");
}
function openSubscribe(){
  $("modalTitle").textContent="🔔 Subscribe to a calendar feed";
  $("modalBody").innerHTML=`<p style="color:var(--muted);margin-top:0">Add a live Tsuzuki feed to your own calendar app. It auto-refreshes (about twice a day), so new air dates appear on their own — no re-downloading.</p>`+
    `<div style="border:1px solid var(--premiere);border-radius:11px;padding:12px;margin-bottom:10px;background:rgba(245,158,11,.06)">
      <div style="font-weight:700">⭐ My shows (${state.watch.size})</div>
      <div style="color:var(--muted);font-size:12.5px;margin:3px 0 9px">Upcoming episodes of the shows in your list. Generated on this device — re-download after adding shows.</div>
      <button id="dlMine">⬇ Download .ics</button>
    </div>`+
    subRow("premieres","🌸 Premieres","Every new-season premiere (episode 1).")+
    subRow("finales","🏁 Season finales","The last episode of finishing shows.")+
    subRow("all","📺 All episodes","Every episode airing over the next ~6 weeks.")+
    `<p style="color:var(--muted);font-size:12px;margin-bottom:0">Times are in UTC; calendar apps convert to your local time automatically. On Google, the “＋ Apple/Outlook” webcal link also works.</p>`;
  if($("dlMine")) $("dlMine").onclick=downloadMyShows;
  $("overlay").classList.add("on");
}

/* ---------- dashboard ---------- */
let chartJsReady=false;
const dashCharts=[];
const SOURCE_LABEL={ORIGINAL:"Original",MANGA:"Manga",LIGHT_NOVEL:"Light Novel",VISUAL_NOVEL:"Visual Novel",VIDEO_GAME:"Video Game",OTHER:"Other",NOVEL:"Novel",DOUJINSHI:"Doujinshi",ANIME:"Anime",WEB_NOVEL:"Web Novel",LIVE_ACTION:"Live Action",GAME:"Game",COMIC:"Comic",MULTIMEDIA_PROJECT:"Multimedia",PICTURE_BOOK:"Picture Book"};
// Categorical, so it stays multi-hue — but it leads on the brand colour, and
// the old #ef4444 slot moved to violet to keep two reds from sitting together.
const CHART_COLORS=["#ff4a2e","#22d3ee","#f59e0b","#22c55e","#a78bfa","#ec4899","#3b82f6","#a855f7","#14b8a6","#f97316","#6366f1","#84cc16"];

function loadChartJs(){
  if(chartJsReady) return Promise.resolve();
  return new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";
    s.onload=()=>{
      chartJsReady=true;
      Chart.defaults.color="#a1908b";
      Chart.defaults.borderColor="#342825";
      Chart.defaults.font.family="'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif";
      res();
    };
    s.onerror=()=>rej(new Error("Failed to load Chart.js"));
    document.head.appendChild(s);
  });
}
function destroyDashCharts(){ for(const c of dashCharts) c.destroy(); dashCharts.length=0; }

function computeDashStats(){
  // ONE consistent scope for every number on the dashboard: the 3-month
  // season the anchor falls in. visibleRange() returns that range in
  // dashboard mode. Each media object carries its FULL airingSchedule, so we
  // can count episodes across the whole season even though the data was
  // fetched per-season. We only count shows that ACTUALLY air in the window,
  // which also drops dedup/carryover noise from neighbouring seasons.
  const {start,end}=visibleRange();
  const s=start.getTime(), e=new Date(end.getFullYear(),end.getMonth(),end.getDate(),23,59,59,999).getTime();

  // episode airings that fall inside the season window
  const events=[];
  for(const md of state.media){
    if(excluded(md)) continue;
    for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]){
      const t=n.airingAt*1000;
      if(t>=s&&t<=e) events.push({media:md,episode:n.episode,ts:n.airingAt});
    }
  }

  // distinct shows that air at least once this season
  const showMap=new Map();
  for(const ev of events) if(!showMap.has(ev.media.id)) showMap.set(ev.media.id, ev.media);
  const shows=[...showMap.values()];

  // premieres / finales counted as DISTINCT shows (one ep1 / one finale each)
  const premiereIds=new Set(), finaleIds=new Set();
  for(const ev of events){
    if(ev.episode===1) premiereIds.add(ev.media.id);
    if(isFinale(ev.media,ev.episode)) finaleIds.add(ev.media.id);
  }
  const premieres=premiereIds.size, finales=finaleIds.size;

  // genre / format / source / studio — over the shows airing this season
  const genreCounts={}, formatCounts={}, sourceCounts={}, studioCounts={};
  for(const md of shows){
    for(const g of md.genres||[]) genreCounts[g]=(genreCounts[g]||0)+1;
    const fk=FMT_LABEL[md.format]||md.format||"Other"; formatCounts[fk]=(formatCounts[fk]||0)+1;
    const src=md.source?(SOURCE_LABEL[md.source]||md.source):"Unknown"; sourceCounts[src]=(sourceCounts[src]||0)+1;
    const st=md.studios&&md.studios.nodes&&md.studios.nodes[0]; if(st) studioCounts[st.name]=(studioCounts[st.name]||0)+1;
  }

  // score distribution — over the shows airing this season
  const scoreBuckets={"<20":0,"20s":0,"30s":0,"40s":0,"50s":0,"60s":0,"70s":0,"80s":0,"90+":0};
  for(const md of shows){
    const v=md.averageScore; if(!v) continue;
    if(v>=90) scoreBuckets["90+"]++;
    else if(v>=80) scoreBuckets["80s"]++;
    else if(v>=70) scoreBuckets["70s"]++;
    else if(v>=60) scoreBuckets["60s"]++;
    else if(v>=50) scoreBuckets["50s"]++;
    else if(v>=40) scoreBuckets["40s"]++;
    else if(v>=30) scoreBuckets["30s"]++;
    else if(v>=20) scoreBuckets["20s"]++;
    else scoreBuckets["<20"]++;
  }

  const dowCounts={Sun:0,Mon:0,Tue:0,Wed:0,Thu:0,Fri:0,Sat:0};
  for(const ev of events) dowCounts[DOW[new Date(ev.ts*1000).getDay()]]++;

  const scored=shows.filter(md=>md.averageScore);
  const avgScore=scored.length?Math.round(scored.reduce((a,md)=>a+md.averageScore,0)/scored.length):0;
  const topShows=shows.slice().sort((a,b)=>(b.popularity||0)-(a.popularity||0)).slice(0,10);
  const topGenre=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1])[0];

  return {events,shows,genreCounts,premieres,finales,formatCounts,sourceCounts,scoreBuckets,studioCounts,dowCounts,avgScore,topShows,totalShows:shows.length,totalEpisodes:events.length,topGenre:topGenre?topGenre[0]:"—"};
}

async function renderDashboard(){
  const dash=$("dashboardWrap");
  dash.style.display="";
  document.querySelector("main").style.display="none";
  document.body.classList.add("dash-mode");
  dash.innerHTML='<div class="dash-loading"><span class="spin" style="display:inline-block;margin-right:8px"></span> Loading dashboard…</div>';

  try{ await loadChartJs(); }catch(e){
    dash.innerHTML='<div class="dash-loading">⚠ Failed to load charting library. Check your connection and try again.</div>';
    return;
  }
  destroyDashCharts();
  const st=computeDashStats();

  dash.innerHTML=`
    <div class="dash-tiles">
      <div class="dash-tile"><div class="dt-val">${st.totalShows}</div><div class="dt-label">Shows Airing</div></div>
      <div class="dash-tile"><div class="dt-val">${st.totalEpisodes}</div><div class="dt-label">Episodes This Season</div></div>
      <div class="dash-tile"><div class="dt-val">${st.premieres}</div><div class="dt-label">Premiering</div></div>
      <div class="dash-tile"><div class="dt-val">${st.finales}</div><div class="dt-label">Ending (Finale)</div></div>
      <div class="dash-tile"><div class="dt-val">${st.avgScore||"—"}</div><div class="dt-label">Avg Score</div></div>
      <div class="dash-tile"><div class="dt-val">${esc(st.topGenre)}</div><div class="dt-label">Top Genre</div></div>
    </div>
    <div class="dash-charts">
      <div class="dash-chart"><h3>🎭 Anime by Genre</h3><canvas id="chGenre"></canvas></div>
      <div class="dash-chart"><h3>📅 Starting vs Ending</h3><canvas id="chStartEnd"></canvas></div>
      <div class="dash-chart"><h3>📺 Format Distribution</h3><canvas id="chFormat"></canvas></div>
      <div class="dash-chart"><h3>📖 Source Material</h3><canvas id="chSource"></canvas></div>
      <div class="dash-chart"><h3>⭐ Score Distribution</h3><canvas id="chScore"></canvas></div>
      <div class="dash-chart"><h3>🏢 Top Studios</h3><canvas id="chStudio"></canvas></div>
      <div class="dash-chart"><h3>📆 Episodes by Day of Week</h3><canvas id="chDow"></canvas></div>
      <div class="dash-chart"><h3>🔥 Top 10 Most Popular</h3><canvas id="chTop"></canvas></div>
    </div>`;

  /* --- create charts --- */
  const C=CHART_COLORS;
  const light=effectiveTheme()==="light";
  Chart.defaults.color = light ? "#6b5b56" : "#a1908b";
  Chart.defaults.borderColor = light ? "#e6d9d4" : "#342825";
  const GRID = light ? "rgba(0,0,0,.09)" : "rgba(255,255,255,.07)";

  // Genre (horizontal bar)
  const ge=Object.entries(st.genreCounts).sort((a,b)=>b[1]-a[1]).slice(0,15);
  dashCharts.push(new Chart($("chGenre"),{type:"bar",
    data:{labels:ge.map(e=>e[0]),datasets:[{label:"Shows",data:ge.map(e=>e[1]),backgroundColor:C.slice(0,ge.length),borderRadius:6}]},
    options:{indexAxis:"y",responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{color:GRID},ticks:{precision:0}},y:{grid:{display:false}}}}
  }));

  // Starting vs Ending (show counts — a show can both start & end in one cour,
  // so these aren't mutually exclusive; a bar chart shows each honestly)
  dashCharts.push(new Chart($("chStartEnd"),{type:"bar",
    data:{labels:["Premiering","Ending (Finale)"],datasets:[{label:"Shows",data:[st.premieres,st.finales],backgroundColor:["#f59e0b","#a78bfa"],borderRadius:6}]},
    options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{grid:{color:GRID},ticks:{precision:0}}}}
  }));

  // Format (doughnut)
  const fe=Object.entries(st.formatCounts).sort((a,b)=>b[1]-a[1]);
  dashCharts.push(new Chart($("chFormat"),{type:"doughnut",
    data:{labels:fe.map(e=>e[0]),datasets:[{data:fe.map(e=>e[1]),backgroundColor:C.slice(0,fe.length),borderWidth:0}]},
    options:{responsive:true,plugins:{legend:{position:"bottom"}}}
  }));

  // Source material (doughnut)
  const se=Object.entries(st.sourceCounts).sort((a,b)=>b[1]-a[1]);
  dashCharts.push(new Chart($("chSource"),{type:"doughnut",
    data:{labels:se.map(e=>e[0]),datasets:[{data:se.map(e=>e[1]),backgroundColor:C.slice(0,se.length),borderWidth:0}]},
    options:{responsive:true,plugins:{legend:{position:"bottom"}}}
  }));

  // Score distribution (bar)
  const sk=Object.keys(st.scoreBuckets), sd=Object.values(st.scoreBuckets);
  dashCharts.push(new Chart($("chScore"),{type:"bar",
    data:{labels:sk,datasets:[{label:"Shows",data:sd,backgroundColor:sk.map((_,i)=>`hsl(${260+i*12},70%,55%)`),borderRadius:6}]},
    options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},ticks:{precision:0}}}}
  }));

  // Top studios (horizontal bar)
  const sue=Object.entries(st.studioCounts).sort((a,b)=>b[1]-a[1]).slice(0,12);
  dashCharts.push(new Chart($("chStudio"),{type:"bar",
    data:{labels:sue.map(e=>e[0]),datasets:[{label:"Shows",data:sue.map(e=>e[1]),backgroundColor:"#22d3ee",borderRadius:6}]},
    options:{indexAxis:"y",responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{color:GRID},ticks:{precision:0}},y:{grid:{display:false}}}}
  }));

  // Episodes by day of week (bar)
  dashCharts.push(new Chart($("chDow"),{type:"bar",
    data:{labels:Object.keys(st.dowCounts),datasets:[{label:"Episodes",data:Object.values(st.dowCounts),backgroundColor:C.slice(0,7),borderRadius:6}]},
    options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},ticks:{precision:0}}}}
  }));

  // Top 10 most popular (horizontal bar)
  dashCharts.push(new Chart($("chTop"),{type:"bar",
    data:{labels:st.topShows.map(md=>title(md).length>28?title(md).slice(0,26)+"…":title(md)),datasets:[{label:"Popularity",data:st.topShows.map(md=>md.popularity),backgroundColor:"#a855f7",borderRadius:6}]},
    options:{indexAxis:"y",responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{color:GRID}},y:{grid:{display:false}}}}
  }));
}
function hideDashboard(){
  document.querySelector("main").style.display="";
  $("dashboardWrap").style.display="none";
  document.body.classList.remove("dash-mode");
  destroyDashCharts();
}

/* ---------- the taste profile (Days 33–38) ----------
   One view, six axes, all drawn by the same diverging bar: right of the centre
   line means you rate it above your own bar, left means below. The bar is the
   SHRUNK lift, so a value seen twice cannot out-shout one seen thirty times, but
   the raw numbers and the count sit next to it — the chart shows its own
   evidence rather than asking to be trusted.

   No Chart.js. The dashboard loads it for the dashboard; six bar charts made of
   divs cost nothing and inherit the theme, which a canvas does not. */
const TASTE_TOP = 8;   // best and worst this many, per axis
function tasteBarHtml(row, max){
  const v=row.vsCrowd==null?row.lift:row.vsCrowd;
  const pct=max?Math.min(100, Math.abs(v)/max*100):0;
  const pos=v>=0;
  return `<div class="tb-row${row.thin?" thin":""}">
    <span class="tb-name" title="${esc(String(row.value))}">${esc(String(row.value))}</span>
    <span class="tb-track">
      <i class="tb-bar ${pos?"pos":"neg"}" style="width:${pct/2}%;${pos?"left:50%":"right:50%"}"></i>
      <b class="tb-axis"></b>
    </span>
    <span class="tb-num ${pos?"pos":"neg"}">${pos?"+":""}${v.toFixed(2)}</span>
    <span class="tb-meta">${row.mine.toFixed(1)}${row.crowd!=null?` vs ${row.crowd.toFixed(1)}`:""} · ${row.n}${row.thin?" ⚠":""}</span>
  </div>`;
}
function tasteAxisHtml(dimKey){
  const dim=TASTE_BY_KEY[dimKey], rows=tasteDim(dimKey);
  if(!rows.length){
    return `<section class="tz-axis"><h3>${esc(dim.label)}</h3>
      <p class="num-hint" style="margin:0">Not enough rated shows carry a ${esc(dim.one)} yet — a ${esc(dim.one)} needs
        ${TASTE_MIN_N} before it is counted at all.</p></section>`;
  }
  // A single value is a fact, not a comparison — Day 36's "handles a library
  // spanning one decade only" is this branch, and it says so instead of drawing
  // a lone bar at full width and implying a ranking.
  if(rows.length===1){
    const r=rows[0];
    return `<section class="tz-axis"><h3>${esc(dim.label)}</h3>
      <p class="num-hint" style="margin:0">Everything you have rated is <b>${esc(String(r.value))}</b>
        (${r.n} show${r.n===1?"":"s"}, averaging ${r.mine.toFixed(1)}). There is nothing to compare it against yet.</p></section>`;
  }
  const max=Math.max(...rows.map(r=>Math.abs(r.vsCrowd==null?r.lift:r.vsCrowd)), 0.01);
  const top=rows.slice(0, TASTE_TOP);
  const bottom=rows.length>TASTE_TOP*2 ? rows.slice(-TASTE_TOP) : rows.slice(top.length);
  const best=rows[0], worst=rows[rows.length-1];
  return `<section class="tz-axis">
    <h3>${esc(dim.label)} <span class="tz-n">${rows.length}</span></h3>
    <p class="num-hint" style="margin:0 0 8px">Your best ${esc(dim.one)} is <b>${esc(String(best.value))}</b>${
      best.crowd!=null?` — you give it ${best.mine.toFixed(1)} where the crowd gives ${best.crowd.toFixed(1)}`:""}${
      rows.length>1?`; your worst is <b>${esc(String(worst.value))}</b>`:""}.</p>
    <div class="tb-list">${top.map(r=>tasteBarHtml(r,max)).join("")}</div>
    ${bottom.length?`<div class="tz-sep">…and the bottom ${bottom.length}</div>
      <div class="tb-list">${bottom.map(r=>tasteBarHtml(r,max)).join("")}</div>`:""}
  </section>`;
}
/* ---------- the archetype (Day 38) ----------
   A name for the shape, derived from the axes rather than chosen from a list of
   personalities — and it names the axes that produced it, because a label you
   cannot check is a horoscope. */
const ARCHETYPE_RULES = [
  { test:t=>t.genre.has("Slice of Life")||t.genre.has("Drama"), word:"character-first" },
  { test:t=>t.genre.has("Action")||t.genre.has("Adventure"),    word:"action-led" },
  { test:t=>t.genre.has("Comedy"),                              word:"comedy-led" },
  { test:t=>t.genre.has("Psychological")||t.genre.has("Mystery")||t.genre.has("Thriller"), word:"puzzle-minded" },
  { test:t=>t.genre.has("Romance"),                             word:"romantic" },
  { test:t=>t.genre.has("Sci-Fi")||t.genre.has("Fantasy"),      word:"world-building" },
];
function tasteArchetype(){
  const v=tasteVectors();
  if(v.rated<TASTE_MIN_RATED) return null;
  const pick=(key,n)=>new Set(tasteDim(key).slice(0,n).map(r=>r.value));
  const t={ genre:pick("genre",3), length:pick("length",2), era:pick("era",2) };
  const parts=[], why=[];
  for(const rule of ARCHETYPE_RULES){
    if(rule.test(t)){ parts.push(rule.word); break; }
  }
  const topGenre=tasteDim("genre")[0], topLen=tasteDim("length")[0], topEra=tasteDim("era")[0];
  if(topGenre) why.push(`you rate <b>${esc(String(topGenre.value))}</b> ${topGenre.lift>=0?"+":""}${topGenre.lift.toFixed(2)} against your own average`);
  // Length is what turns a genre word into a sentence: "slow burn" and "binge"
  // are statements about commitment, not about subject matter.
  let pace="";
  if(topLen){
    const L=String(topLen.value);
    pace = /Very long|Long/.test(L) ? "slow burn"
         : /Two cour/.test(L)       ? "long-form"
         : /Film/.test(L)           ? "one-sitting"
         : /Short/.test(L)          ? "short-form"
         : "single-cour";
    why.push(`your best length is <b>${esc(L)}</b>`);
  }
  if(topEra){ why.push(`your strongest decade is <b>${esc(String(topEra.value))}</b>`); }
  const label=[parts[0]||"broad-taste", pace].filter(Boolean).join(" ");
  return { label, why, sample:v.rated };
}
function tasteHeaderHtml(){
  const v=tasteVectors(), a=tasteArchetype();
  const gap = v.myMean - v.crowdMean;
  return `<div class="board-top">
      <div class="board-head"><h2>🧭 Your taste</h2>
        <div class="ev-sub">${a
          ? `You look like a <b class="tz-arch">${esc(a.label)}</b> viewer — ${a.why.join(", ")}.`
          : `Rate at least ${TASTE_MIN_RATED} shows and this becomes a profile. You have ${v.total}.`}</div></div>
    </div>
    <div class="tz-sample">
      <span><b>${v.rated}</b> of your <b>${v.total}</b> rated show${v.total===1?"":"s"} in the sample</span>
      <span>your average <b>${v.myMean.toFixed(1)}</b>${v.crowdMean?` · the crowd's average on the same shows <b>${v.crowdMean.toFixed(1)}</b>`:""}</span>
      ${v.crowdMean?`<span>you are <b>${gap>=0?"+":""}${gap.toFixed(1)}</b> ${gap>=0?"more":"less"} generous than average</span>`:""}
      ${v.unresolved?`<span class="tz-warn">${v.unresolved} not loaded yet — still yours, just not in the sample above</span>`:""}
    </div>`;
}
function renderTaste(){
  const wrap=$("tasteWrap");
  wrap.style.display=""; document.querySelector("main").style.display="none"; document.body.classList.add("taste-mode");
  const v=tasteVectors();
  if(!tasteReady()){
    wrap.innerHTML=tasteHeaderHtml()+
      `<div class="ev-loading">Your taste profile is built from the shows you have scored — ${v.total} so far,
        and it needs ${TASTE_MIN_RATED}. Rate a few more and every axis below fills in.</div>`;
    return;
  }
  // Rated enough, but most of those shows aren't loaded in this browser yet. The
  // axes would be drawn from two shows and would be wrong rather than empty, so
  // they wait — and the reason given is the real one.
  if(v.rated<TASTE_MIN_RATED){
    wrap.innerHTML=tasteHeaderHtml()+
      `<div class="ev-loading">You have rated <b>${v.total}</b> shows, which is enough — but ${v.unresolved} of them
        are from seasons this browser hasn't fetched yet, so there are only <b>${v.rated}</b> to draw from right now.
        They are being fetched in the background and the axes fill in as they land.</div>`;
    return;
  }
  wrap.innerHTML=tasteHeaderHtml()
    // Day 61. An additive card: if it ever throws, the axes below must still draw.
    +(()=>{ try{ return profileDiffHtml(); }catch(e){ console.error("profile diff", e); return ""; } })()
    +`<p class="num-hint tz-legend">Bars show how far each one sits above or below <b>your own average</b>, after the
       crowd's opinion of the same shows is subtracted — so neither your generosity nor a genre's general popularity
       counts. The numbers beside each bar are your raw average, the crowd's, and how many of your shows it covers.
       <b>⚠</b> marks a value thin enough to be luck.</p>
     <div class="tz-axes">${TASTE_DIMS.map(d=>tasteAxisHtml(d.key)).join("")}</div>`;
}
function hideTaste(){
  document.querySelector("main").style.display="";
  const w=$("tasteWrap"); if(w) w.style.display="none";
  document.body.classList.remove("taste-mode");
}

/* ---------- the recommendations page (Days 46–49, 52, 54) ----------
   The predicted score is the headline, the confidence sits next to it, and the
   reasoning is open by default rather than hidden behind a "why?" — a
   recommendation you cannot interrogate is one you either take on faith or
   ignore, and neither is what this is for. */
/* Day 52: the reasoning, in the one place it is actually read — a chip's
   tooltip. It names the axis, how many of your shows it rests on, and which of
   them; a lift with no shows behind it is an assertion you cannot check. */
function whyTitle(w){
  const from=(w.from||[]).map(id=>{ const md=findMediaById(id); return md?title(md):null; }).filter(Boolean);
  return `${w.label} · from ${w.n} of your rated shows${from.length?`, e.g. ${from.join(", ")}`:""}${
    w.thin?" · thin evidence":""}${w.adj?` · you adjusted this by ${w.adj>0?"+":""}${w.adj}`:""}`;
}
/* Day 53: the chip is the control. Each one carries a thumb either side, and a
   press rewrites the profile and repaints whatever is on screen — so the effect
   of saying "I like this more than you think" is the list re-ranking under your
   hand rather than something you take on trust and check later. */
function whyChipHtml(w, live){
  const adj=w.adj||0;
  return `<span class="rc-chip ${w.lift>=0?"pos":"neg"}${w.thin?" thin":""}${adj?" adj":""}" title="${esc(whyTitle(w))}">
    ${live?`<button type="button" class="rc-thumb" data-tadj="${esc(w.dim)}|${esc(String(w.value))}|-1" title="Less than that" aria-label="I like ${esc(String(w.value))} less than this">−</button>`:""}
    ${esc(String(w.value))} <b>${w.lift>=0?"+":""}${w.lift.toFixed(2)}</b>${adj?`<i class="rc-adj" title="Your adjustment">✎</i>`:""}
    ${live?`<button type="button" class="rc-thumb" data-tadj="${esc(w.dim)}|${esc(String(w.value))}|1" title="More than that" aria-label="I like ${esc(String(w.value))} more than this">+</button>`:""}
  </span>`;
}
function recWhyHtml(r){
  if(!r.why.length) return "";
  return `<div class="rc-why">`+r.why.map(w=>whyChipHtml(w,true)).join("")+`</div>`;
}
function recCardHtml(r){
  const md=r.md, img=(md.coverImage&&(md.coverImage.large||md.coverImage.medium))||"";
  const eps=epTotal(md), mins=recRuntime(md);
  const hrs=mins>=60?`${Math.round(mins/60)}h`:`${mins}m`;
  const confPct=Math.round(r.conf*100);
  const low=r.conf<PRED_GOOD_CONF;
  return `<article class="rc-card">
    <div class="rc-cover" role="button" tabindex="0" data-openshow="${esc(r.id)}">
      ${img?`<img src="${esc(img)}" alt="" loading="lazy">`:`<span class="vs-ph">🎬</span>`}
      <span class="rc-pred ${low?"low":""}" title="Predicted from your taste profile · rests on ${confPct}% evidence">${r.score}</span>
    </div>
    <div class="rc-body">
      <h4 role="button" tabindex="0" data-openshow="${esc(r.id)}">${esc(title(md))}</h4>
      <div class="rc-meta">${FMT_LABEL[md.format]||md.format||"?"}${eps?` · ${eps} ep`:""} · ${hrs}${
        md.averageScore?` · ★ ${md.averageScore}`:""}${md.status==="RELEASING"?` · <b>airing</b>`:""}</div>
      <div class="rc-conf" title="How much of your library this estimate rests on — not how accurate it is">
        <i style="width:${confPct}%"></i><span>${confPct}% evidence</span></div>
      ${r.departs&&r.departs.length?`<div class="rc-depart">Outside your usual: <b>${
        esc(r.departs.map(d=>d.value).join(", "))}</b></div>`:""}
      ${recWhyHtml(r)}
      <div class="rc-act">
        <button data-recadd="${esc(r.id)}" class="primary">＋ Plan to watch</button>
        <button data-recno="${esc(r.id)}|seen">Already seen</button>
        <button data-recno="${esc(r.id)}|no">Not interested</button>
      </div>
    </div>
  </article>`;
}
/* ---------- the feed, on screen ----------
   The buttons are ordered by how much they commit you to, and the cheapest one —
   "never heard of it" — is the largest and the last, because it is the most
   pressed. Without it the card demands one of four commitments about a show you
   may not recognise, and people answer that by picking whichever button makes it
   go away, which poisons exactly the data this exists to collect. */
function feedCardHtml(){
  const md=state.feedCard;
  if(!md){
    const skipped=state.feedSkip.size;
    return `<div class="ev-loading">Nothing left to show you from what this browser has loaded${
      skipped?` — you have skipped ${skipped}`:""}. Browse a few seasons on the calendar and come back,
      or <button class="afx-clear" data-feedreset>forget my skips</button>.</div>`;
  }
  const id=String(md.id);
  const img=(md.coverImage&&(md.coverImage.large||md.coverImage.medium))||"";
  const eps=epTotal(md), studio=((md.studios&&md.studios.nodes)||[])[0];
  const p=tasteReady()?predictScore(id):null;
  const year=yearOfMedia(md);
  const desc=String(md.description||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  const genres=(md.genres||[]).slice(0,4);

  // The second step: you said you have seen it, so the one thing worth asking is
  // how it went. Three buttons, not a 1–10 picker — the picker is a decision and
  // this has to stay a reflex.
  if(state.feedAsk===id){
    return `<div class="fd-card fd-ask">
      <div class="fd-cover">${img?`<img src="${esc(img)}" alt="">`:`<span class="vs-ph">🎬</span>`}</div>
      <div class="fd-body">
        <h3>${esc(title(md))}</h3>
        <p class="fd-q">How was it?</p>
        <div class="fd-scores">${FEED_SCORES.map(s=>
          `<button class="fd-score" data-feedscore="${esc(id)}|${s.key}"><b>${s.emoji}</b>${esc(s.label)}<i>${s.score}/10</i></button>`).join("")}</div>
        <button class="fd-plain" data-feedscore="${esc(id)}|none">Skip the score — just mark it watched</button>
        <p class="num-hint" style="margin:8px 0 0">A score is what teaches the profile. A status on its own
          counts for about a third as much.</p>
      </div></div>`;
  }
  return `<div class="fd-card">
    <div class="fd-cover" role="button" tabindex="0" data-openshow="${esc(id)}">
      ${img?`<img src="${esc(img)}" alt="" loading="lazy">`:`<span class="vs-ph">🎬</span>`}
      ${p&&predUsable(p)?`<span class="rc-pred${p.conf<PRED_GOOD_CONF?" low":""}" title="Predicted from your taste">${p.score}</span>`:""}
    </div>
    <div class="fd-body">
      <h3 role="button" tabindex="0" data-openshow="${esc(id)}">${esc(title(md))}</h3>
      <div class="fd-meta">${FMT_LABEL[md.format]||md.format||"?"}${year?` · ${year}`:""}${eps?` · ${eps} ep`:""}${
        studio&&studio.name?` · ${esc(studio.name)}`:""}${md.averageScore?` · ★ ${md.averageScore}`:""}</div>
      ${genres.length?`<div class="fd-genres">${genres.map(g=>`<span>${esc(g)}</span>`).join("")}</div>`:""}
      ${desc?`<p class="fd-desc">${esc(desc.slice(0,240))}${desc.length>240?"…":""}</p>`:""}
      <div class="fd-acts">
        <button class="fd-act seen"  data-feed="${esc(id)}|seen">✅ Seen it</button>
        <button class="fd-act watch" data-feed="${esc(id)}|watching">▶️ Watching</button>
        <button class="fd-act plan"  data-feed="${esc(id)}|plan">📋 Plan to watch</button>
        <button class="fd-act drop"  data-feed="${esc(id)}|dropped">🗑️ Dropped it</button>
        <button class="fd-act no"    data-feed="${esc(id)}|no">🚫 Not for me</button>
      </div>
      <button class="fd-skip" data-feed="${esc(id)}|skip">❓ Never heard of it — next</button>
    </div>
  </div>`;
}
function feedHtml(){
  const v=tasteVectors();
  const done=state.feedCount||0;
  return `<div class="fd-wrap">
      <div class="fd-top">
        <span>${done?`<b>${done}</b> sorted this session`:"Tap what you have seen. Everything you answer lands on your board."}</span>
        <span class="num-hint" style="margin:0">${v.total
          ? `<b>${v.total}</b> rated${v.swipes?` · <b>${v.swipes}</b> swipes feeding the profile`:""}${
              tasteReady()?"":` · ${TASTE_MIN_RATED-v.total} more rating${TASTE_MIN_RATED-v.total===1?"":"s"} and predictions switch on`}`
          : `Rate ${TASTE_MIN_RATED} and this starts predicting what you'd score things.`}</span>
      </div>
      ${feedCardHtml()}
    </div>`;
}
/* The season lineup, rendered with the same card as a recommendation so a
   predicted score means the same thing in both places. */
function seasonCardHtml(r){
  const md=r.md, img=(md.coverImage&&(md.coverImage.large||md.coverImage.medium))||"";
  const eps=epTotal(md);
  const confPct=Math.round(r.conf*100);
  const badge = r.mine ? `<span class="rc-pred mine" title="Your own score">${r.mine}</span>`
    : r.usable ? `<span class="rc-pred ${r.conf<PRED_GOOD_CONF?"low":""}" title="Predicted from your taste · rests on ${confPct}% evidence">${r.score}</span>`
    : "";
  const studio=((md.studios&&md.studios.nodes)||[])[0];
  return `<article class="rc-card">
    <div class="rc-cover" role="button" tabindex="0" data-openshow="${esc(r.id)}">
      ${img?`<img src="${esc(img)}" alt="" loading="lazy">`:`<span class="vs-ph">🎬</span>`}${badge}
    </div>
    <div class="rc-body">
      <h4 role="button" tabindex="0" data-openshow="${esc(r.id)}">${esc(title(md))}</h4>
      <div class="rc-meta">${FMT_LABEL[md.format]||md.format||"?"}${eps?` · ${eps} ep`:""}${
        studio&&studio.name?` · ${esc(studio.name)}`:""}${md.averageScore?` · ★ ${md.averageScore}`:""}</div>
      ${r.usable?`<div class="rc-conf" title="How much of your library this estimate rests on — not how accurate it is">
        <i style="width:${confPct}%"></i><span>${confPct}% evidence</span></div>`:""}
      ${r.mine?`<div class="rc-depart" style="color:var(--good)">Already rated ${r.mine}/10</div>`:""}
      ${!r.mine&&!r.usable?`<div class="rc-meta" style="opacity:.7">No estimate yet — nothing you have rated covers it</div>`:""}
      ${r.why&&r.why.length?recWhyHtml(r):""}
      <div class="rc-act">
        <button data-recadd="${esc(r.id)}" class="primary">＋ Plan to watch</button>
      </div>
    </div>
  </article>`;
}
function seasonPreviewHtml(){
  const {season,year}=nextSeasonOf();
  const name=season.charAt(0)+season.slice(1).toLowerCase()+" "+year;
  if(seasonPreviewErr) return `<div class="ev-loading">Couldn't load ${esc(name)} — ${esc(seasonPreviewErr)}.</div>`;
  if(!seasonPreview){ loadSeasonPreview(); return `<div class="ev-loading"><span class="spin" style="display:inline-block;margin-right:8px"></span> Loading ${esc(name)}…</div>`; }
  const rows=seasonPreviewRows();
  if(!rows.length) return `<div class="ev-loading">Nothing announced for ${esc(name)} yet.</div>`;
  const withPred=rows.filter(r=>r.usable).length;
  const ready=tasteReady();
  return `<p class="num-hint" style="margin:0 0 12px"><b>${rows.length}</b> title${rows.length===1?"":"s"} announced for
      <b>${esc(name)}</b>${ready
        ? ` · <b>${withPred}</b> with an estimate from your taste, sorted best-first; the rest sit below by popularity.`
        : ` · sorted by popularity. Rate ${TASTE_MIN_RATED} shows and this page starts predicting what you'd score each one.`}</p>
    <div class="rc-grid">${rows.slice(0,80).map(seasonCardHtml).join("")}</div>`;
}
function recControlsHtml(res){
  const genres=[...new Set((res.rows||[]).flatMap(r=>r.md.genres||[]))].sort();
  const tabs=Object.entries(REC_MODES).map(([k,m])=>
    `<button class="sk-tab${state.recMode===k?" on":""}" data-recmode="${k}">${esc(m.label)}</button>`).join("");
  // The genre and airing filters belong to the ranked lenses; a season lineup is
  // already scoped to one season, and "airing now" is a contradiction there.
  const filters = (state.recMode==="season"||state.recMode==="feed"||state.recMode==="because") ? "" :
    `<select data-recgenre><option value="">Any genre</option>${genres.map(g=>
        `<option value="${esc(g)}"${state.recGenre===g?" selected":""}>${esc(g)}</option>`).join("")}</select>
     <label class="rc-check"><input type="checkbox" data-recairing${state.recAiring?" checked":""}> Airing now</label>`;
  return `<div class="sk-tabs">${tabs}</div>
    <div class="rc-bar">${filters}
      <span class="num-hint" style="margin:0">${esc(REC_MODES[state.recMode].hint)}</span>
    </div>`;
}
function renderRecs(){
  const wrap=$("recsWrap");
  wrap.style.display=""; document.querySelector("main").style.display="none"; document.body.classList.add("taste-mode");
  const v=tasteVectors();
  const head=`<div class="board-top">
      <div class="board-head"><h2>✨ For you</h2>
        <div class="ev-sub">Ranked by what this thinks you would score them, built only from the shows you have rated. Nothing here leaves your browser.</div></div>
    </div>`;
  // Day 88 is the one lens that works with an empty library, so it is offered
  // even when the rest of the page cannot say anything yet — a first-time
  // visitor gets a real page instead of a locked one.
  // Both of these work with an empty library, so they sit outside the gate the
  // ranked lenses are behind — the feed because it exists to fill that library,
  // the season lineup because "what is coming" is a question anyone can ask.
  if(state.recMode==="feed"){
    if(!state.feedCard) feedServe();
    wrap.innerHTML=head+recControlsHtml({rows:[]})+feedHtml();
    return;
  }
  if(state.recMode==="season"){ wrap.innerHTML=head+recControlsHtml({rows:[]})+seasonPreviewHtml(); return; }
  if(!tasteReady()){
    wrap.innerHTML=head+recControlsHtml({rows:[]})+`<div class="ev-loading">This needs ${TASTE_MIN_RATED} rated shows to say anything —
      you have ${v.total}. Score a few and it fills in. <br><br>
      The fastest way is <b>🧭 Taste → ⚔ Head to head</b>, or just rate the last handful of things you finished.
      <br><br>In the meantime, <b>Next season</b> above works without any of that.</div>`;
    return;
  }
  if(state.recMode==="because"){ wrap.innerHTML=head+recControlsHtml({rows:[]})+becauseHtml(); return; }
  const res=recommendations(state.recMode, {
    genre: state.recGenre||null,
    airingOnly: state.recAiring,
    maxRuntime: state.recMode==="short" ? REC_SHORT_CAP_MIN : null,
  });
  const rows=res.rows.slice(0,60);
  // An over-filtered result explains itself rather than showing a blank page —
  // and names which control to loosen, since it knows which one emptied it.
  let body;
  if(!rows.length){
    const wide=recommendations("all",{});
    body=`<div class="ev-loading">Nothing matches that combination.
      ${state.recMode!=="all"?`<b>${esc(REC_MODES[state.recMode].label)}</b> is the strictest part — `:""}
      ${wide.rows.length?`there are <b>${wide.rows.length}</b> picks with the filters off.`:
        `there is nothing it can recommend yet: it has ${res.pool} shows loaded and has already seen them all in your library.`}</div>`;
  } else {
    body=`<div class="rc-grid">${rows.map(recCardHtml).join("")}</div>`;
  }
  wrap.innerHTML=head+recControlsHtml(res)+body+
    `<p class="num-hint" style="margin-top:14px">Picked from the <b>${res.pool}</b> shows this browser has loaded —
      browsing more seasons widens the pool. ${state.recNo.size?`<b>${state.recNo.size}</b> dismissed and never shown again
      (<button class="afx-clear" data-recreset>undo all</button>).`:""}</p>`;
}
function hideRecs(){
  document.querySelector("main").style.display="";
  const w=$("recsWrap"); if(w) w.style.display="none";
  if(state.viewMode!=="taste") document.body.classList.remove("taste-mode");
}

/* ---------- board (watch statuses) ---------- */
/* A card's cover art, with the progress fill under it (Day 09). Both card
   builders go through this, so the bar can't end up on the board and not in
   Lists — they are the same card in two views. */
function cardCoverHtml(md,drag){
  const cover=md.coverImage?(md.coverImage.large||md.coverImage.medium):"";
  const bar=progressBarHtml(md);
  if(!cover&&!bar) return "";
  return `<div class="bc-cover">${cover?`<img src="${cover}" alt="" loading="lazy"${drag?' draggable="false"':""}>`:""}${bar}</div>`;
}
function boardCardHtml(md){
  return `<div class="board-card" data-openshow="${esc(String(md.id))}">
    ${cardCoverHtml(md)}
    <div class="board-card-info">
      <div class="board-card-title">${esc(title(md))}</div>
      ${hasMarks(md.id)?`<div class="board-card-marks">${myMarks(md.id)}</div>`:""}
      ${statusPickerHtml(md.id,"sm")}
    </div>
  </div>`;
}
const boardAddBtn = `<button class="primary" data-focus-search title="Search any anime and pick a status">＋ Add anime</button>`;
/* The one thing that makes archiving reversible in practice rather than only in
   principle: nothing is findable if there is no control that shows it. Rendered
   only when there is something archived, so it costs nothing to anyone who has
   never used the feature. */
function archiveToggleHtml(n){
  if(!n) return "";
  return `<button data-archtoggle class="${state.showArchived?"primary":""}"
    title="${state.showArchived?"Hide archived shows again":"Show the shows you have archived"}">🗃 ${state.showArchived?"Hiding":"Archived"} · ${n}</button>`;
}
// The button carries the sort it will open, so the current order is legible from
// the view itself rather than only from inside the panel that sets it.
function sortButtonHtml(){
  const custom=cleanSort(state.sort).length>0;
  return `<button data-sortopen class="${custom?"primary":""}" title="${esc(sortSummary(state.sort))}">⇅ ${
    custom ? esc(SORT_BY_KEY[activeSort()[0].key].label) + (activeSort().length>1?` +${activeSort().length-1}`:"") : "Sort"}</button>`;
}
async function renderBoard(){
  const wrap=$("boardWrap");
  wrap.style.display=""; document.querySelector("main").style.display="none"; document.body.classList.add("board-mode");

  const ids=[...state.watch];
  if(!ids.length){
    wrap.innerHTML=`<div class="board-top">
        <div class="board-head"><h2>🗂️ My Board</h2><div class="ev-sub">Watching, Plan to Watch, On Hold, Dropped, Completed — track every show you follow, at a glance.</div></div>
        ${boardAddBtn}
      </div>
      <div class="ev-loading">Your board is empty. Search any anime up top, then click a status — that's it.</div>`;
    return;
  }
  wrap.innerHTML='<div class="ev-loading"><span class="spin" style="display:inline-block;margin-right:8px"></span> Loading your board…</div>';

  const missing=ids.filter(id=>!findMediaById(id));
  if(missing.length){
    const fetched=await Promise.all(missing.map(id=>fetchMediaById(id).catch(()=>null)));
    fetched.forEach(md=>{ if(md && !state.media.some(x=>String(x.id)===String(md.id))) state.media.push(md); });
  }
  if(state.viewMode!=="board") return;   // user navigated away while fetching

  const all=ids.map(id=>findMediaById(id)).filter(Boolean);
  const archived=all.filter(md=>isArchived(md.id));
  const shows=libraryOrder(state.showArchived ? all : all.filter(md=>!isArchived(md.id)));
  const cols=STATUS_DEFS.map(sd=>({...sd, shows: shows.filter(md=>boardStatusOf(md.id)===sd.key)}));

  wrap.innerHTML=`<div class="board-top">
      <div class="board-head"><h2>🗂️ My Board</h2><div class="ev-sub">${shows.length} tracked show${shows.length===1?"":"s"}. Click a card's status icon to move it between columns — click the highlighted one to take it off the board. Shift-click cards to select a run of them and change the lot at once.</div></div>
      ${sortButtonHtml()}
      ${archiveToggleHtml(archived.length)}
      ${boardAddBtn}
    </div>
    <div class="board-cols">
      ${cols.map(c=>`
        <div class="board-col">
          <h3>${c.emoji} ${esc(c.label)} <span class="board-count">${c.shows.length}</span></h3>
          ${c.shows.length ? c.shows.map(boardCardHtml).join("") : '<div class="board-empty">Nothing here</div>'}
        </div>`).join("")}
    </div>`;
  paintSelection();
}
function hideBoard(){
  document.querySelector("main").style.display="";
  const w=$("boardWrap"); if(w) w.style.display="none";
  document.body.classList.remove("board-mode");
}

/* ---------- custom collections view ("📚 Lists") ----------
   A kanban of your own lists. The first column holds every tracked show that
   isn't in a list yet, so there's always something to drag from. Drag works on
   a mouse; the per-card "Move to…" picker does the same job on touch and by
   keyboard, so nothing is drag-only. */
function listCardHtml(md, fromId){
  const mid=esc(String(md.id));
  const opts=[
    fromId?`<option value="">📥 Not in a list</option>`:"",
    ...state.collections.filter(c=>c.id!==fromId).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`)
  ].join("");
  // img/select are draggable="false" so the card itself is what gets dragged
  // (otherwise the browser drags the cover art, and Firefox eats clicks on the select)
  return `<div class="board-card" draggable="true" data-openshow="${mid}" data-lcard="${mid}" data-lfrom="${esc(fromId||"")}">
    ${cardCoverHtml(md,true)}
    <div class="board-card-info">
      <div class="board-card-title">${esc(title(md))}</div>
      ${hasMarks(md.id)?`<div class="board-card-marks">${myMarks(md.id)}</div>`:""}
      ${opts?`<select class="card-sel" draggable="false" data-lmove="${mid}|${esc(fromId||"")}" title="Move ${esc(title(md))} to another list"><option value="" selected disabled>Move to…</option>${opts}</select>`:""}
    </div>
  </div>`;
}
/* A list's cover art: a mosaic of the first four shows in it, so a list is
   recognisable by the same art its shows are. An empty list — or one whose art
   hasn't been fetched yet — falls back to a placeholder tile of the same size,
   so the column headers stay on one line either way. */
function collectionCoverHtml(shows){
  const covers=shows.map(md=>md&&md.coverImage?(md.coverImage.large||md.coverImage.medium):"")
    .filter(Boolean).slice(0,4);
  if(!covers.length) return `<span class="col-cover empty" aria-hidden="true">📚</span>`;
  return `<span class="col-cover n${covers.length}" aria-hidden="true">`
    + covers.map(u=>`<img src="${esc(u)}" alt="" loading="lazy" draggable="false">`).join("")
    + `</span>`;
}
function listColumnHtml(col, shows, idx, total){
  const cid=esc(col.id);
  return `<div class="board-col" data-ldrop="${cid}">
    <div class="col-head">
      ${collectionCoverHtml(shows)}
      <span class="col-name" title="${esc(col.name)}">${esc(col.name)}</span>
      <span class="board-count">${shows.length}</span>
      <button type="button" class="col-btn" data-col-move="${cid}|-1" title="Move list left" aria-label="Move ${esc(col.name)} left"${idx===0?" disabled":""}>‹</button>
      <button type="button" class="col-btn" data-col-move="${cid}|1" title="Move list right" aria-label="Move ${esc(col.name)} right"${idx===total-1?" disabled":""}>›</button>
      <button type="button" class="col-btn" data-col-rename="${cid}" title="Rename list" aria-label="Rename ${esc(col.name)}">✏️</button>
      <button type="button" class="col-btn" data-col-del="${cid}" title="Delete list" aria-label="Delete ${esc(col.name)}">🗑️</button>
    </div>
    ${shows.length ? shows.map(md=>listCardHtml(md, col.id)).join("") : '<div class="board-empty">Drop a show here</div>'}
  </div>`;
}
async function renderLists(){
  const wrap=$("listsWrap");
  wrap.style.display=""; document.querySelector("main").style.display="none"; document.body.classList.add("lists-mode");

  // Counted from ids alone, before any media is fetched, because the header it
  // feeds is rendered on the empty-state path too.
  const filed=new Set(state.collections.flatMap(c=>c.ids));
  const archCount=[...new Set([...state.watch, ...filed])].filter(id=>isArchived(id)).length;
  const head=`<div class="board-top">
      <div class="board-head"><h2>📚 My Lists</h2><div class="ev-sub">Your own collections — Comfort watches, Rewatch pile, Movie night, anything. A show can live in as many as you like.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${sortButtonHtml()}
        ${archiveToggleHtml(archCount)}
        <button class="primary" data-col-new="" title="Make a new list">＋ New list</button>
        <button data-focus-search title="Search any anime">🔍 Add anime</button>
      </div>
    </div>`;

  // Every id we need art and titles for: tracked shows plus everything filed away.
  const ids=[...new Set([...state.watch, ...state.collections.flatMap(c=>c.ids)])];
  if(!ids.length && !state.collections.length){
    wrap.innerHTML=head+`<div class="ev-loading">No lists yet. Make one, then drag shows in from your board — or add anime from the search box.</div>`;
    return;
  }
  wrap.innerHTML=head+'<div class="ev-loading"><span class="spin" style="display:inline-block;margin-right:8px"></span> Loading your lists…</div>';

  const missing=ids.filter(id=>!findMediaById(id));
  if(missing.length){
    const fetched=await Promise.all(missing.map(id=>fetchMediaById(id).catch(()=>null)));
    fetched.forEach(md=>{ if(md && !state.media.some(x=>String(x.id)===String(md.id))) state.media.push(md); });
  }
  if(state.viewMode!=="lists") return;   // user navigated away while fetching

  // The archive hides a show from its columns, not from its list membership —
  // unarchiving it later has to put it back exactly where it was filed.
  const keep = md => state.showArchived || !isArchived(md.id);
  const unsorted=libraryOrder([...state.watch].filter(id=>!filed.has(String(id)))
    .map(id=>findMediaById(id)).filter(Boolean).filter(keep));
  const total=state.collections.length;

  wrap.innerHTML=head+`<div class="lists-cols">
      <div class="board-col" data-ldrop="">
        <div class="col-head">
          <span class="col-cover empty" aria-hidden="true">📥</span>
          <span class="col-name" title="Tracked shows that aren't in any list">Not in a list</span>
          <span class="board-count">${unsorted.length}</span>
        </div>
        ${unsorted.length ? unsorted.map(md=>listCardHtml(md,"")).join("") : '<div class="board-empty">Everything is filed</div>'}
      </div>
      ${state.collections.map((c,i)=>listColumnHtml(c, libraryOrder(c.ids.map(id=>findMediaById(id)).filter(Boolean).filter(keep)), i, total)).join("")}
    </div>
    <div class="lists-hint">Drag a card between columns, or use its “Move to…” picker. Shift-click cards to select a run of them and file the lot at once. You can also add a show to any list from its detail pop-up.</div>`;
  paintSelection();
}
function hideLists(){
  document.querySelector("main").style.display="";
  const w=$("listsWrap"); if(w) w.style.display="none";
  document.body.classList.remove("lists-mode");
}

/* ---------- bulk select (board & lists) ----------
   Shift-click extends a run from the last card you touched to the one you just
   clicked, in the order the cards are laid out — across columns, the way a file
   manager does it. Ctrl/⌘-click toggles a single card. A plain click still
   opens the show, so nothing about the one-card path changes.

   The selection is ids, not elements: the same show can appear in several list
   columns, and re-rendering throws every card away. It is deliberately not
   persisted — it lasts as long as you're looking at it. */
let bulkSel=new Set(), bulkAnchor=null, bulkView=null;
function bulkCards(){ return [...document.querySelectorAll(".board-col [data-openshow]")]; }
function paintSelection(){
  const cards=bulkCards();
  cards.forEach(el=>el.classList.toggle("sel", bulkSel.has(el.dataset.openshow)));
  // ids can outlive their cards (a bulk status change empties a column), so the
  // count the bar shows is what's still on screen.
  const live=new Set(cards.filter(el=>bulkSel.has(el.dataset.openshow)).map(el=>el.dataset.openshow));
  if(live.size!==bulkSel.size) bulkSel=live;
  document.body.classList.toggle("bulk-on", bulkSel.size>0);
  renderBulkBar();
}
function bulkClear(){
  if(!bulkSel.size && bulkAnchor===null) return;
  bulkSel=new Set(); bulkAnchor=null; bulkView=null;
  paintSelection();
}
function renderBulkBar(){
  let el=$("bulkBar");
  if(!bulkSel.size){ if(el) el.classList.remove("on"); return; }
  if(!el){
    el=document.createElement("div"); el.id="bulkBar"; el.className="bulkbar";
    el.setAttribute("role","group"); el.setAttribute("aria-label","Actions for the selected shows");
    document.body.appendChild(el);
  }
  const n=bulkSel.size, plural=`${n} show${n===1?"":"s"}`;
  const lists=state.collections.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  el.innerHTML=`<span class="bulk-n">${n} selected</span>
    <div class="st-pick sm" role="group" aria-label="Set a status for the selection">
      ${STATUS_DEFS.map(s=>`<button type="button" class="st-chip" data-bulk-st="${s.key}" title="${esc(s.label)} · ${plural}" aria-label="${esc(s.label)} · ${plural}"><span>${s.emoji}</span></button>`).join("")}
      <button type="button" class="st-chip" data-bulk-st="" title="Take ${plural} off the board" aria-label="Take ${plural} off the board"><span>🚫</span></button>
    </div>
    <select class="card-sel" data-bulk-col aria-label="Add the selection to a list">
      <option value="" selected disabled>Add to list…</option>${lists}
      <option value="__new">＋ New list…</option>
    </select>
    <button type="button" class="bulk-x" data-bulk-clear title="Clear the selection (Esc)" aria-label="Clear the selection">✕</button>`;
  el.classList.add("on");
}
// Selecting cards. Registered before the open-a-show handler below so a
// modified click can stop it — a shift-click should never also open a modal.
document.addEventListener("click",e=>{
  if(!(e.shiftKey||e.ctrlKey||e.metaKey)) return;
  const card=e.target.closest(".board-col [data-openshow]"); if(!card) return;
  if(e.target.closest("select,button,[data-st],[data-rt]")) return;   // a control on the card wins
  e.preventDefault(); e.stopImmediatePropagation();
  const ids=bulkCards().map(el=>el.dataset.openshow), id=card.dataset.openshow;
  const a=bulkAnchor===null?-1:ids.indexOf(bulkAnchor), b=ids.indexOf(id);
  if(e.shiftKey && a>=0 && b>=0){
    for(let i=Math.min(a,b);i<=Math.max(a,b);i++) bulkSel.add(ids[i]);
  } else if(bulkSel.has(id)) bulkSel.delete(id);
  else bulkSel.add(id);
  bulkAnchor=id; bulkView=state.viewMode;
  const s=window.getSelection(); if(s) s.removeAllRanges();   // shift-click also drags text
  paintSelection();
});
// One status for the whole selection, undoable as a single step.
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-bulk-st]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const key=b.dataset.bulkSt, ids=[...bulkSel];
  if(!ids.length) return;
  const prev=ids.map(id=>[id, getStatusOf(id)]);
  ids.forEach(id=>setStatusOf(id, key));
  bulkClear();
  renderView();
  toast(key ? `${statusLabel(key)} · ${ids.length} show${ids.length===1?"":"s"}`
            : `Removed from board · ${ids.length} show${ids.length===1?"":"s"}`,
        ()=>{ prev.forEach(([id,st])=>setStatusOf(id, st, {stamp:false})); renderView(); });
});
// One list for the whole selection. Shows already in it are left alone, so the
// Undo only takes back what this actually added.
document.addEventListener("change",e=>{
  const sel=e.target.closest("[data-bulk-col]"); if(!sel) return;
  const ids=[...bulkSel];
  let colId=sel.value;
  sel.value="";
  if(!ids.length || !colId) return;
  if(colId==="__new"){
    const name=window.prompt("Name your new list:", "");
    if(name===null) return;
    const made=createCollection(name);
    if(!made){ if(name.trim()!=="") alert("That name can't be used."); return; }
    colId=made.id;
  }
  const col=collectionById(colId); if(!col) return;
  const added=ids.filter(id=>addToCollection(colId, id));
  bulkClear();
  if(state.viewMode==="lists") renderLists();
  ids.forEach(id=>refreshCollectionPickers(id));
  if(!added.length){ toast(`Already in ${col.name} · ${ids.length} show${ids.length===1?"":"s"}`); return; }
  toast(`Added to ${col.name} · ${added.length} show${added.length===1?"":"s"}`,
        ()=>{ added.forEach(id=>removeFromCollection(colId, id));
              if(state.viewMode==="lists") renderLists();
              added.forEach(id=>refreshCollectionPickers(id)); });
});
document.addEventListener("click",e=>{ if(e.target.closest("[data-bulk-clear]")) bulkClear(); });
function listsStatusText(){
  const n=state.collections.length;
  const filed=new Set(state.collections.flatMap(c=>c.ids)).size;
  return n ? `${n} list${n===1?"":"s"} · ${filed} show${filed===1?"":"s"} filed` : "No lists yet — make your first one";
}

/* ---------- events (real-life conventions / showcases where anime news breaks) ---------- */
const EV_COLOR = { "Convention":"#ff4a2e", "Online Showcase":"#22d3ee", "Awards":"#f59e0b", "Doujin":"#ec4899", "Industry":"#22c55e", "Broadcast":"#14b8a6" };
const evColor = t => EV_COLOR[t] || "#ff4a2e";
function evRangeLabel(e){
  const s=new Date(e.ts*1000);
  if(e.end && e.end!==e.start){ const en=new Date(e.tsEnd*1000);
    return s.toLocaleDateString([], {month:"short",day:"numeric"})+" – "+en.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"}); }
  return s.toLocaleDateString([], {weekday:"short",month:"long",day:"numeric",year:"numeric"});
}
async function loadEventsData(){
  if(state.eventsData) return state.eventsData;
  const res=await fetch("events.json",{headers:{"Accept":"application/json"}});
  if(!res.ok) throw new Error("events HTTP "+res.status);
  const data=await res.json();
  state.eventsData=Array.isArray(data)?data:[];
  return state.eventsData;
}
function haversineKm(lat1,lon1,lat2,lon2){
  const R=6371, toR=x=>x*Math.PI/180;
  const dLa=toR(lat2-lat1), dLo=toR(lon2-lon1);
  const s=Math.sin(dLa/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
const kmLabel = km => km<10 ? `~${km.toFixed(0)} km` : km<1000 ? `~${Math.round(km/5)*5} km` : `~${Math.round(km/100)*100} km`;
function setUserLoc(loc){
  state.userLoc=loc;
  if(loc) localStorage.setItem("anical.userLoc",JSON.stringify(loc)); else localStorage.removeItem("anical.userLoc");
  fillEventsList();
}
async function geocodeUser(q){
  q=(q||"").trim();
  if(!q){ setUserLoc(null); return; }
  const note=$("evLocNote"); if(note) note.textContent="Locating…";
  try{
    const city=q.split(",")[0].trim();
    const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,{headers:{Accept:"application/json"}});
    const m=((await r.json()).results||[])[0];
    if(!m){ if(note) note.textContent=`Couldn't find “${q}”. Try a bigger nearby city.`; return; }
    setUserLoc({ lat:m.latitude, lon:m.longitude, label:[m.name,m.admin1,m.country].filter(Boolean).join(", ") });
  }catch(e){ if(note) note.textContent="Location lookup failed — check your connection."; }
}
function useMyLocation(){
  const note=$("evLocNote");
  if(!navigator.geolocation){ if(note) note.textContent="Geolocation isn't available in this browser."; return; }
  if(note) note.textContent="Locating…";
  navigator.geolocation.getCurrentPosition(
    p=>{ const li=$("evLoc"); if(li) li.value=""; setUserLoc({ lat:p.coords.latitude, lon:p.coords.longitude, label:"📍 Your location" }); },
    ()=>{ if(note) note.textContent="Couldn't get your location (permission denied?). Type a city instead."; },
    { timeout:8000, maximumAge:600000 }
  );
}
async function renderEvents(){
  const wrap=$("eventsWrap");
  wrap.style.display=""; document.querySelector("main").style.display="none"; document.body.classList.add("events-mode");
  wrap.innerHTML='<div class="ev-loading"><span class="spin" style="display:inline-block;margin-right:8px"></span> Loading events…</div>';
  let data;
  try{ data=await loadEventsData(); }
  catch(e){ wrap.innerHTML='<div class="ev-loading">⚠ Couldn’t load events right now.</div>'; return; }

  // parse + sort once, cache for filtering
  state.eventsItems=data.map(e=>({ ...e,
    ts: Math.floor(Date.parse((e.start||"")+"T12:00:00")/1000),
    tsEnd: Math.floor(Date.parse(((e.end||e.start)||"")+"T23:59:59")/1000)
  })).filter(e=>!isNaN(e.ts)).sort((a,b)=>a.ts-b.ts);
  state.eventsIndex=new Map(state.eventsItems.map((e,i)=>[String(e.id||i),e]));

  const rad=state.eventsRadius||0;
  const submitUrl="https://github.com/KraysThePoet/anical/issues/new?labels=event&title="+encodeURIComponent("New event: ")+"&body="+encodeURIComponent("Event name:\nDate(s) (e.g. Sep 17–21, 2026):\nVenue:\nCity, Country:\nOfficial website:\nSource link (where you saw it):\n");
  wrap.innerHTML=`<div class="ev-head"><h2>🎟️ Anime Events</h2>
    <div class="ev-sub">Anime conventions &amp; expos <strong>worldwide</strong> — where studios reveal new shows, trailers, casts and release dates. Auto-updated daily from <a href="https://animecons.com/events/" target="_blank" rel="noopener">AnimeCons.com</a>. Set your location to find cons near you. Tap an event for details &amp; its official page.</div></div>
    <div class="ev-bar">
      <input type="search" id="evFilter" placeholder="🔍 Filter by name or place…" autocomplete="off" spellcheck="false" value="${esc(state.eventsFilter||"")}" />
      <div class="seg" id="evViewSeg" style="margin-left:auto">
        <button data-evview="list" class="${state.eventsMap?"":"active"}">📋 List</button>
        <button data-evview="map" class="${state.eventsMap?"active":""}">🗺️ Map</button>
      </div>
    </div>
    <div class="ev-bar">
      <input type="search" id="evLoc" placeholder="📍 Your city / country…" autocomplete="off" spellcheck="false" value="${esc(state.userLoc&&!/^📍/.test(state.userLoc.label)?state.userLoc.label:"")}" />
      <button id="evGeo" title="Use my device location">📍 Use my location</button>
      <select id="evRadius" title="Only show events within this distance">
        <option value="0">Any distance</option>
        <option value="250">Within 250 km</option>
        <option value="500">Within 500 km</option>
        <option value="1000">Within 1000 km</option>
        <option value="3000">Within 3000 km</option>
      </select>
    </div>
    <div class="ev-bar" style="margin-top:0">
      <span class="ev-approx" id="evCount"></span>
      <span class="ev-approx" id="evLocNote"></span>
      <a class="ev-badge" style="margin-left:auto;text-decoration:none" href="${submitUrl}" target="_blank" rel="noopener" title="Suggest a convention we're missing (opens GitHub)">➕ Submit an event</a>
    </div>
    <div id="evList"></div>
    <div id="evMap" style="display:none;height:460px;border-radius:12px;overflow:hidden;border:1px solid var(--line)"></div>`;
  evMapObj=null;   // container was rebuilt; force re-init
  document.querySelectorAll("#evViewSeg button").forEach(b=>b.onclick=()=>setEventsView(b.dataset.evview));
  const inp=$("evFilter");
  inp.oninput=()=>{ state.eventsFilter=inp.value; fillEventsList(); };
  $("evLoc").onchange=()=>geocodeUser($("evLoc").value);
  $("evGeo").onclick=useMyLocation;
  const rsel=$("evRadius"); rsel.value=String(rad);
  rsel.onchange=()=>{ state.eventsRadius=+rsel.value; localStorage.setItem("anical.eventsRadius",String(state.eventsRadius)); fillEventsList(); };
  fillEventsList();
  setEventsView(state.eventsMap?"map":"list");
}
function fillEventsList(){
  const box=$("evList"); if(!box) return;
  const now=Date.now()/1000;
  const loc=state.userLoc, radius=state.eventsRadius||0;
  const q=(state.eventsFilter||"").trim().toLowerCase();

  let show=(state.eventsItems||[]).filter(e=> !q || ((e.title||"")+" "+(e.location||"")).toLowerCase().includes(q));
  if(loc){
    for(const e of show) e._km = (e.lat!=null&&e.lon!=null) ? haversineKm(loc.lat,loc.lon,e.lat,e.lon) : null;
    if(radius>0) show=show.filter(e=> e._km!=null && e._km<=radius);
  }

  const cnt=$("evCount"); if(cnt) cnt.textContent=`${show.length} event${show.length===1?"":"s"}`;
  const note=$("evLocNote");
  if(note) note.textContent = loc ? `· near ${loc.label}${radius>0?` (within ${radius} km)`:""}` : "";

  if(!show.length){
    box.innerHTML=`<div class="ev-loading">${loc&&radius>0?`No events within ${radius} km of ${esc(loc.label)}. Try a larger distance.`:`No events match “${esc(q)}”.`}</div>`; return;
  }
  let html="", lastMonth=null;
  for(const e of show){
    const d=new Date(e.ts*1000), mk=d.getFullYear()+"-"+d.getMonth();
    if(mk!==lastMonth){ html+=`<div class="ev-now" style="color:var(--accent2)"><span style="flex:none">${d.toLocaleDateString([], {month:"long",year:"numeric"})}</span></div>`; lastMonth=mk; }
    const col=evColor(e.type), isPast=e.tsEnd<now;
    const cd = e.ts>now ? `<span class="ev-badge" style="border-color:var(--accent2);color:var(--accent2)">in ${cdLive(e.ts)}</span>`
             : (isPast ? `<span class="ev-badge">past</span>` : `<span class="ev-badge" style="border-color:var(--now);color:var(--now)">now</span>`);
    const dist = (loc && e._km!=null) ? `<span class="ev-badge" style="border-color:var(--good);color:var(--good)">${kmLabel(e._km)}</span>` : "";
    html+=`<div class="ev-card${isPast?" past":""}" data-eid="${esc(String(e.id||""))}" style="border-left-color:${col}">
      <div class="ev-date"><div class="ev-d">${d.getDate()}</div><div class="ev-mo">${d.toLocaleDateString([], {month:"short"})}</div></div>
      <div class="ev-info">
        <div class="ev-title">${esc(e.title||"Untitled event")}${e.approx?' <span class="ev-approx" title="Approximate date">≈</span>':''}</div>
        <div class="ev-meta">
          <span class="ev-badge" style="border-color:${col};color:${col}">${esc(e.type||"Event")}</span>
          <span class="ev-badge">${esc(evRangeLabel(e))}</span>
          ${cd}${dist}${eventBellSpan(e.id)}
        </div>
        ${e.location?`<div class="ev-loc">📍 ${esc(e.location)}</div>`:""}
      </div></div>`;
  }
  box.innerHTML=html;
  box.querySelectorAll("[data-eid]").forEach(el=>{ el.onclick=(ev)=>{ if(ev.target.closest("[data-evbell]"))return; const e=state.eventsIndex.get(el.dataset.eid); if(e) openEventDetail(e); }; });
  scheduleEventNotifications();
  if(state.eventsMap) renderEventsMap();
}
function hideEvents(){ const w=$("eventsWrap"); if(w) w.style.display="none"; document.body.classList.remove("events-mode"); }

/* ---------- events map (Leaflet, lazy-loaded) ---------- */
let leafletReady=false, evMapObj=null, evMarkers=null;
function loadLeaflet(){
  if(leafletReady) return Promise.resolve();
  return new Promise((res,rej)=>{
    const css=document.createElement("link"); css.rel="stylesheet"; css.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
    const s=document.createElement("script"); s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload=()=>{ leafletReady=true; res(); }; s.onerror=()=>rej(new Error("Leaflet failed")); document.head.appendChild(s);
  });
}
function setEventsView(mode){
  state.eventsMap = mode==="map";
  document.querySelectorAll("#evViewSeg button").forEach(b=>b.classList.toggle("active", b.dataset.evview===mode));
  const list=$("evList"), map=$("evMap");
  if(list) list.style.display = state.eventsMap?"none":"";
  if(map) map.style.display = state.eventsMap?"":"none";
  if(state.eventsMap) renderEventsMap();
}
async function renderEventsMap(){
  const wrap=$("evMap"); if(!wrap) return;
  try{ await loadLeaflet(); }catch(e){ wrap.innerHTML='<div class="ev-loading">⚠ Couldn’t load the map.</div>'; return; }
  const loc=state.userLoc, radius=state.eventsRadius||0, q=(state.eventsFilter||"").trim().toLowerCase();
  let show=(state.eventsItems||[]).filter(e=> !q || ((e.title||"")+" "+(e.location||"")).toLowerCase().includes(q));
  if(loc){ for(const e of show) e._km=(e.lat!=null&&e.lon!=null)?haversineKm(loc.lat,loc.lon,e.lat,e.lon):null; if(radius>0) show=show.filter(e=>e._km!=null&&e._km<=radius); }
  const pts=show.filter(e=>e.lat!=null&&e.lon!=null);
  if(!evMapObj){
    evMapObj=L.map(wrap,{scrollWheelZoom:false});
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",{attribution:"&copy; OpenStreetMap &copy; CARTO",maxZoom:19}).addTo(evMapObj);
  }
  if(evMarkers) evMarkers.remove();
  evMarkers=L.layerGroup().addTo(evMapObj);
  const latlngs=[];
  for(const e of pts){
    const m=L.marker([e.lat,e.lon]).addTo(evMarkers);
    m.bindPopup(`<strong>${esc(e.title||"Event")}</strong><br>${esc(e.location||"")}<br><a href="#" data-eid="${esc(String(e.id||""))}">Details →</a>`);
    latlngs.push([e.lat,e.lon]);
  }
  if(loc){ L.circleMarker([loc.lat,loc.lon],{radius:7,color:"#22d3ee",fillColor:"#22d3ee",fillOpacity:.85,weight:2}).addTo(evMarkers).bindPopup("📍 You"); latlngs.push([loc.lat,loc.lon]); }
  if(latlngs.length) evMapObj.fitBounds(latlngs,{padding:[30,30],maxZoom:6}); else evMapObj.setView([20,0],1);
  setTimeout(()=>evMapObj.invalidateSize(),60);
  evMapObj.off("popupopen"); evMapObj.on("popupopen",ev=>{ const a=ev.popup.getElement().querySelector("[data-eid]"); if(a) a.onclick=(e2)=>{ e2.preventDefault(); const it=state.eventsIndex.get(a.dataset.eid); if(it) openEventDetail(it); }; });
}

/* ---------- event reminders ---------- */
function isEventFollowed(id){ return state.notifyEvents.has(String(id)); }
function eventBellSpan(id){ const on=isEventFollowed(id); return `<span class="bell ${on?'on':''}" data-evbell="${esc(String(id))}" title="Remind me about this event">${on?'🔔':'🔕'}</span>`; }
function setEvBell(el,on){ el.classList.toggle("on",on); if(el.tagName==="BUTTON") el.textContent=on?"🔔 Reminder on":"🔕 Remind me"; else el.textContent=on?"🔔":"🔕"; }
async function cancelTriggeredEvent(id){
  if(!swReg||!swReg.getNotifications) return;
  try{ const list=await swReg.getNotifications({includeTriggered:true}); for(const nt of list) if(nt.tag==="anical-ev-"+id) nt.close(); }catch(e){}
}
function toggleEventNotify(id){
  id=String(id);
  if(state.notifyEvents.has(id)){ state.notifyEvents.delete(id); cancelTriggeredEvent(id); }
  else{
    state.notifyEvents.add(id);
    if("Notification" in window && Notification.permission==="default") Notification.requestPermission().then(()=>{ updateNotifyBtn(); scheduleEventNotifications(); });
  }
  localStorage.setItem("anical.notifyEvents", JSON.stringify([...state.notifyEvents]));
  scheduleEventNotifications();
  document.querySelectorAll('[data-evbell="'+CSS.escape(id)+'"]').forEach(el=>setEvBell(el,state.notifyEvents.has(id)));
}
async function scheduleEventNotifications(){
  if(!("Notification" in window) || Notification.permission!=="granted" || !state.eventsItems) return;
  const now=Date.now();
  for(const e of state.eventsItems){
    if(!isEventFollowed(e.id)) continue;
    const fireAt=(e.ts*1000)-24*3600*1000;     // ~1 day before it starts
    const tag="anical-ev-"+e.id, url=location.origin+location.pathname+"?view=events";
    if(triggersSupported && swReg){
      if(fireAt<=now || fireAt-now>60*24*3600*1000) continue;
      try{ await swReg.showNotification("🎟️ "+(e.title||"Anime event"), { body:"Starts "+evRangeLabel(e), icon:"/icon-192.png", badge:"/favicon.svg", tag, data:{url}, showTrigger:new TimestampTrigger(fireAt) }); }catch(_){}
    }else{
      const delay=fireAt-now, key="ev-"+e.id;
      if(delay<=0 || delay>24*3600*1000 || state.scheduled.has(key)) continue;
      state.scheduled.set(key, setTimeout(()=>{ showNote("🎟️ "+(e.title||"Anime event"), {body:"Starts "+evRangeLabel(e), icon:"/icon-192.png", tag, data:{url}}); state.scheduled.delete(key); }, delay));
    }
  }
}
function openEventDetail(e){
  $("modalTitle").textContent=e.title||"Event";
  const col=evColor(e.type), upcoming=e.ts*1000>Date.now();
  $("modalBody").innerHTML=`
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <span class="ev-badge" style="border-color:${col};color:${col}">${esc(e.type||"Event")}</span>
      <span class="ev-badge">${esc(evRangeLabel(e))}${e.approx?" ≈":""}</span>
      ${upcoming?`<span class="ev-badge" style="border-color:var(--accent2);color:var(--accent2)">in ${cdLive(e.ts)}</span>`:""}
    </div>
    ${e.location?`<div style="color:var(--muted);margin-bottom:10px">📍 ${esc(e.location)}</div>`:""}
    ${e.desc?`<p style="font-size:14px;line-height:1.55;margin:0 0 12px">${esc(e.desc)}</p>`:""}
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
      <button class="evremind ${isEventFollowed(e.id)?'on':''}" data-evbell="${esc(String(e.id||""))}">${isEventFollowed(e.id)?"🔔 Reminder on":"🔕 Remind me"}</button>
      ${e.url?`<a href="${esc(e.url)}" target="_blank" rel="noopener">Official site →</a>`:""}
      ${calButtonsHTML({k:"evt",eid:String(e.id||"")})}
    </div>
    ${e.approx?`<div style="margin-top:14px;color:var(--muted);font-size:12px">≈ This date is approximate — confirm on the official site before making plans.</div>`:""}`;
  $("overlay").classList.add("on");
}

/* ============================================================
   Discovery — Days 55–85
   ------------------------------------------------------------
   Everything from the show page to the staff index lives in this block, in
   backlog order: the per-show route, the monthly profile diff, the reason
   rails, the command palette, search (operators, saved searches, history,
   fuzzy matching and ranking), the similarity engine, hidden gems, the random
   show, the daily discovery card, and the tag / studio / staff routes.

   TWO KINDS OF MEDIA RECORD, KEPT APART ON PURPOSE. A browse page or a gems
   list only needs a cover, a title and enough metadata to rank and predict —
   fetching the full schedule, synopsis and relations for fifty cards at a time
   would burn the AniList rate limit on data nobody looks at. Those card-weight
   records go into `state.light`, which findMediaById() does NOT read, so they
   can never end up behind a pop-up that expects a schedule. Anything opened
   from them goes through peekShow(), which fetches the whole record first.
   Full records fetched here (the show page, the palette) go into `state.full`,
   which findMediaById() does read.
   ============================================================ */

/* ---------- where the data comes from ----------
   Every read in this block goes to our own API first (/api/v1/show, /similar,
   /gems, /tag…), which answers from the shared catalog cache: one visitor's cold
   miss pays for everyone after them, and an AniList 429 serves the last good
   copy instead of an error. v5.0 shipped calling AniList from the browser for
   all of it, and a single busy session could exhaust the ~30/min budget alone.

   AniList directly is the fallback, for when our API cannot answer — and it is
   the visitor's own budget, so it is spent carefully: calls are spaced out, and
   the first 429 opens a cooldown during which nothing is sent at all. Before the
   cooldown every retry, every page and every dial movement fired its own request
   into the limit, and each one pushed the limit's window further out. */
const AL_GAP_MS = 900;            // spacing between direct AniList calls from this tab
const AL_COOLDOWN_MS = 60_000;    // after a 429, or its Retry-After when given
let alNextAt = 0, alCooldownUntil = 0;
const alCoolingDown = () => Date.now() < alCooldownUntil;
const alLimitError = () => new Error(`AniList is rate-limiting requests — try again in ${Math.max(1, Math.ceil((alCooldownUntil-Date.now())/1000))}s`);
async function anilist(query, variables){
  if(alCoolingDown()) throw alLimitError();
  const wait=alNextAt-Date.now();
  alNextAt=Math.max(Date.now(), alNextAt)+AL_GAP_MS;
  if(wait>0) await new Promise(r=>setTimeout(r, wait));
  if(alCoolingDown()) throw alLimitError();   // another call hit the limit while this one waited
  const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({query, variables:variables||{}})});
  if(res.status===429){
    const ra=(+res.headers.get("retry-after")||0)*1000;
    alCooldownUntil=Date.now()+Math.max(15_000, Math.min(AL_COOLDOWN_MS*2, ra||AL_COOLDOWN_MS));
    throw alLimitError();
  }
  if(!res.ok) throw new Error("AniList HTTP "+res.status);
  const j=await res.json(); if(j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
// Our API, then AniList. `data` from the API is AniList's own response shape for
// the same query, so callers never know which one answered.
async function viaApi(path, query, variables){
  const j=await apiGet(path,{timeout:12000});
  if(j && j.data) return j.data;
  return anilist(query, variables);
}
// Card weight. `tags` and `studios` stay in because the predictor and the
// similarity engine both read them — a card without them could be drawn but not
// ranked, and ranking is the point of every list that uses this.
const CARD_FIELDS=`id type title { romaji english native } synonyms format episodes duration genres status popularity averageScore source isAdult countryOfOrigin
  tags { name rank isMediaSpoiler isAdult } coverImage { medium large color } startDate { year month day } seasonYear
  studios(isMain: true) { nodes { id name } }`;
// The same field list SEARCH_QUERY asks for, so a record fetched through an
// operator search opens a complete pop-up.
const FULL_FIELDS=`id title { romaji english native } synonyms format episodes genres status popularity trending averageScore source isAdult countryOfOrigin tags { name rank isMediaSpoiler isAdult }
  description(asHtml: false) siteUrl trailer { id site }
  externalLinks { site url type color icon }
  coverImage { medium large color }
  startDate { year month day }
  season seasonYear
  studios(isMain: true) { nodes { name } }
  relations { edges { relationType(version: 2) node { id type format title { romaji english native } coverImage { medium } startDate { year month day } } } }
  airingSchedule { nodes { airingAt episode } }`;

function keepLight(list){
  for(const md of list||[]) if(md && md.id && !findMediaById(md.id)) state.light.set(String(md.id), md);
  return list||[];
}
const anyMedia = id => findMediaById(id) || state.light.get(String(id)) || null;
const inLibrary = id => state.watch.has(String(id)) || !!getRating(id);
const compactNum = n => { n=+n||0; return n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+"M":n>=1e3?(n/1e3).toFixed(n>=1e4?0:1)+"k":String(n); };
const coverOf = md => (md&&md.coverImage&&(md.coverImage.extraLarge||md.coverImage.large||md.coverImage.medium))||"";
const seasonName = md => md.season && md.seasonYear ? md.season.charAt(0)+md.season.slice(1).toLowerCase()+" "+md.seasonYear : (yearOfMedia(md)?String(yearOfMedia(md)):"");
const STATUS_WORD = { RELEASING:"Airing", FINISHED:"Finished", NOT_YET_RELEASED:"Upcoming", CANCELLED:"Cancelled", HIATUS:"On hiatus" };

/* A card-weight record has no schedule, synopsis or relations, so the pop-up
   would open half empty. Anything that is not already a full record is fetched
   first; the fetch goes through our catalogue before AniList, like every other
   by-id lookup. */
async function peekShow(id){
  id=String(id);
  const md=findMediaById(id);
  if(md && md.airingSchedule) return openDetail(md,(nextAir(md)||{}).episode||1);
  try{
    const full=await fetchMediaById(id);
    if(!full) throw new Error("not found");
    state.full.set(String(full.id), full);
    openDetail(full,(nextAir(full)||{}).episode||1);
  }catch(e){ toast("Couldn't load that show — AniList didn't answer. Try again in a moment."); }
}
function openShowPage(id){
  state.showId=String(id);
  setView("show");
  window.scrollTo({top:0});
}
function openBrowse(kind, id, name){
  state.browse={ kind:["tag","studio","staff"].includes(kind)?kind:"tag", id:id?String(id):null, name:name||null };
  setView("browse");
  window.scrollTo({top:0});
}
function browseHref(kind, id, name){
  const p=new URLSearchParams({view:"browse", kind});
  if(id) p.set("id", id); if(name) p.set("name", name);
  return "?"+p.toString();
}
const showHref = id => "?view=show&id="+encodeURIComponent(id);

/* Links in this block are real hrefs, so a middle-click or ⌘-click opens a new
   tab the way a link should; only a plain click is taken over. A control nested
   inside a clickable card (a button on a cover) wins over the card. */
const plainClick = e => !(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button===1);
document.addEventListener("click",e=>{
  const ctl=e.target.closest("button,a,select,input,label,textarea,[data-st],[data-rt]");
  const page=e.target.closest("[data-showpage]");
  if(page && (!ctl || ctl===page || page.contains(ctl)&&ctl.matches("[data-showpage]"))){
    if(!plainClick(e)) return;
    e.preventDefault();
    if(page.closest("#overlay")) closeModal();   // a page link inside the pop-up leaves the pop-up behind
    openShowPage(page.dataset.showpage); return;
  }
  const br=e.target.closest("[data-browse]");
  if(br && (!ctl || ctl===br)){
    if(!plainClick(e)) return;
    e.preventDefault();
    if(br.closest("#overlay")) closeModal();
    const [kind,id,...rest]=String(br.dataset.browse).split("|");
    openBrowse(kind, id||null, rest.join("|")||null); return;
  }
  const peek=e.target.closest("[data-peek]");
  if(peek && (!ctl || ctl===peek)){ e.preventDefault(); peekShow(peek.dataset.peek); }
});

/* The views in this block share one shell. Their wrappers sit beside the board
   and lists ones and hide <main> the same way. */
const DISCO_WRAPS = { show:"showWrap", browse:"browseWrap", gems:"gemsWrap" };
function hideDiscover(){
  for(const id of Object.values(DISCO_WRAPS)){ const w=$(id); if(w) w.style.display="none"; }
  document.body.classList.remove("disco-mode");
  if(state.baseTitle && document.title!==state.baseTitle) document.title=state.baseTitle;
}
function enterDisco(view){
  for(const [v,id] of Object.entries(DISCO_WRAPS)){ const w=$(id); if(w) w.style.display = v===view ? "" : "none"; }
  document.querySelector("main").style.display="none";
  document.body.classList.add("disco-mode");
  return $(DISCO_WRAPS[view]);
}
// The header wraps to two rows on narrower screens, so anything that sticks
// under it (the show page's section nav) reads its real height from here.
{ const hdr=document.querySelector("header");
  const setH=()=>document.documentElement.style.setProperty("--hdr-h", (hdr?hdr.offsetHeight:60)+"px");
  setH();
  if(hdr && window.ResizeObserver) new ResizeObserver(setH).observe(hdr); }
const skeletonCards = n => `<div class="skel-grid">${'<div class="skel skel-card"></div>'.repeat(n)}</div>`;

/* ---------- fuzzy title matching (Day 73) ----------
   Substring search found "frieren" and missed "freiren", and it only ever looked
   at the English and romaji titles. This normalises every title form a show has
   — English, romaji, native and AniList's synonyms — and tolerates a typo per
   word, scaled to the word's length: nothing under four letters (every
   three-letter word is one edit from dozens of others), one edit from four, two
   from eight. Transpositions count as one edit, because swapped letters are the
   typo people actually make.

   Accents fold away ("Pokémon" = "pokemon") but kana survive: the string is
   decomposed to drop the Latin combining marks and then recomposed, so が stays
   が instead of losing its dakuten to the punctuation strip. */
function normText(s){
  return String(s||"").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu," ").trim();
}
const typoBudget = n => n>=8 ? 2 : n>=4 ? 1 : 0;
const formCache=new WeakMap();
function titleForms(md){
  let f=formCache.get(md); if(f) return f;
  const t=(md&&md.title)||{};
  f=[...new Set([t.english,t.romaji,t.native,...((md&&md.synonyms)||[])].filter(Boolean).map(normText).filter(Boolean))]
    .map(s=>({s, words:s.split(" ")}));
  formCache.set(md,f); return f;
}
// Optimal string alignment distance, abandoned as soon as it cannot stay within max.
function editDistance(a,b,max){
  const la=a.length, lb=b.length;
  if(Math.abs(la-lb)>max) return max+1;
  let prev2=null, prev=new Array(lb+1), cur;
  for(let j=0;j<=lb;j++) prev[j]=j;
  for(let i=1;i<=la;i++){
    cur=new Array(lb+1); cur[0]=i;
    let rowMin=i;
    for(let j=1;j<=lb;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      let v=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost);
      if(prev2 && i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) v=Math.min(v, prev2[j-2]+1);
      cur[j]=v; if(v<rowMin) rowMin=v;
    }
    if(rowMin>max) return max+1;
    prev2=prev; prev=cur;
  }
  return prev[lb];
}
/* Bands, not a blend. Each kind of match owns a range the next one down can't
   reach even with every bonus searchRank() adds, which is what makes Day 74's
   "an exact prefix outranks a fuzzy match" true by construction rather than by
   tuning. */
const MATCH_BAND = { exact:1000, prefix:900, word:780, contains:660, fuzzy:520 };
function titleMatch(md, q){
  if(!q) return null;
  const toks=q.split(" ");
  let best=0, how="";
  for(const f of titleForms(md)){
    if(f.s===q) return {score:MATCH_BAND.exact, how:"exact"};
    if(f.s.startsWith(q)){ if(MATCH_BAND.prefix>best){ best=MATCH_BAND.prefix; how="prefix"; } continue; }
    if((" "+f.s).includes(" "+q)){ if(MATCH_BAND.word>best){ best=MATCH_BAND.word; how="word"; } continue; }
    if(f.s.includes(q)){ if(MATCH_BAND.contains>best){ best=MATCH_BAND.contains; how="contains"; } continue; }
    if(best>=MATCH_BAND.fuzzy) continue;
    // Every query word has to land on some title word, as a prefix or within its
    // typo budget — so "attack titan" finds "Attack on Titan" in any order.
    let edits=0, ok=true;
    for(const qt of toks){
      const b=typoBudget(qt.length);
      let m=Infinity;
      for(const w of f.words){
        if(w.startsWith(qt)){ m=0; break; }
        if(!b) continue;
        for(let L=Math.max(1,qt.length-1); L<=qt.length+1; L++){
          const d=editDistance(qt, w.slice(0,L), b);
          if(d<m) m=d;
        }
      }
      if(m>b){ ok=false; break; }
      edits+=m;
    }
    if(ok){ const s=MATCH_BAND.fuzzy-edits*50; if(s>best){ best=s; how=edits?"fuzzy":"words"; } }
  }
  return best ? {score:best, how} : null;
}

/* ---------- search operators (Day 69) ----------
   `genre:romance year:>=2020 score:>8 studio:mappa` in the one search box. They
   compose (every operator has to hold) and anything that is not a known operator
   is searched as plain text — which matters more than it sounds, because
   "Re:Zero" and "Steins;Gate" are titles, not syntax errors. */
const STATUS_WORDS = { airing:"RELEASING", releasing:"RELEASING", finished:"FINISHED", done:"FINISHED", ended:"FINISHED",
  upcoming:"NOT_YET_RELEASED", announced:"NOT_YET_RELEASED", unreleased:"NOT_YET_RELEASED", cancelled:"CANCELLED", canceled:"CANCELLED", hiatus:"HIATUS" };
const FORMAT_WORDS = { tv:"TV", short:"TV_SHORT", tv_short:"TV_SHORT", tvshort:"TV_SHORT", movie:"MOVIE", film:"MOVIE",
  ona:"ONA", ova:"OVA", special:"SPECIAL", music:"MUSIC" };
const AL_GENRES = ["Action","Adventure","Comedy","Drama","Ecchi","Fantasy","Hentai","Horror","Mahou Shoujo","Mecha","Music",
  "Mystery","Psychological","Romance","Sci-Fi","Slice of Life","Sports","Supernatural","Thriller"];
function numTest(spec, fallbackOp){
  let m=String(spec).match(/^(\d+(?:\.\d+)?)(?:\.\.|-)(\d+(?:\.\d+)?)$/);
  if(m){ const lo=Math.min(+m[1],+m[2]), hi=Math.max(+m[1],+m[2]);
    return {op:"range", lo, hi, label:`${lo}–${hi}`, fn:v=>v>=lo&&v<=hi}; }
  m=String(spec).match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+)?)$/);
  if(!m) return null;
  const op=m[1]||fallbackOp, n=+m[2];
  const fn={">":v=>v>n, ">=":v=>v>=n, "<":v=>v<n, "<=":v=>v<=n, "=":v=>v===n}[op];
  return {op, n, label:(op==="="?"":op)+n, fn};
}
const SEARCH_OPS = {
  genre:  { help:"genre:romance", make:v=>{ const q=normText(v); return md=>(md.genres||[]).some(g=>normText(g).startsWith(q)); },
            al:v=>{ const q=normText(v); const g=AL_GENRES.find(x=>normText(x).startsWith(q)); return g?{g:[g]}:null; } },
  tag:    { help:'tag:"time travel"', make:v=>{ const q=normText(v); return md=>(md.tags||[]).some(t=>t&&!t.isMediaSpoiler&&normText(t.name).includes(q)); } },
  studio: { help:"studio:mappa", make:v=>{ const q=normText(v); return md=>((md.studios&&md.studios.nodes)||[]).some(s=>s&&normText(s.name).includes(q)); } },
  year:   { help:"year:>=2020", num:"=", make:(v,t)=>md=>{ const y=yearOfMedia(md); return !!y&&t.fn(y); },
            al:(v,t)=>{ const lo=t.op==="range"?t.lo:t.op===">"?t.n+1:(t.op===">="||t.op==="=")?t.n:null;
                        const hi=t.op==="range"?t.hi:t.op==="<"?t.n-1:(t.op==="<="||t.op==="=")?t.n:null;
                        return {y1:lo?(lo-1)*10000+1231:null, y2:hi?(hi+1)*10000+101:null}; } },
  score:  { help:"score:>8", num:">=", scale:n=>n<=10?n*10:n, make:(v,t)=>md=>!!md.averageScore&&t.fn(md.averageScore),
            al:(v,t)=>t.op===">="?{sc:t.n-1}:t.op===">"?{sc:t.n}:t.op==="range"?{sc:t.lo-1}:null },
  eps:    { help:"eps:<=13", num:"=", make:(v,t)=>md=>!!md.episodes&&t.fn(md.episodes) },
  format: { help:"format:movie", make:v=>{ const f=FORMAT_WORDS[normText(v).replace(/ /g,"_")]; return f?md=>md.format===f:null; },
            al:v=>{ const f=FORMAT_WORDS[normText(v).replace(/ /g,"_")]; return f?{f:[f]}:null; } },
  status: { help:"status:airing", make:v=>{ const s=STATUS_WORDS[normText(v)]; return s?md=>md.status===s:null; },
            al:v=>{ const s=STATUS_WORDS[normText(v)]; return s?{s}:null; } },
  season: { help:"season:fall", make:v=>{ const s={fall:"FALL",autumn:"FALL",winter:"WINTER",spring:"SPRING",summer:"SUMMER"}[normText(v)]; return s?md=>md.season===s:null; } },
  source: { help:"source:manga", make:v=>{ const q=normText(v); return md=>!!md.source&&normText(SOURCE_LABEL[md.source]||md.source).includes(q); } },
  mine:   { help:"mine:>=8", num:">=", make:(v,t)=>md=>{ const r=getRating(md.id); return !!r&&t.fn(r); } },
  is:     { help:"is:fav", make:v=>{
              const k=normText(v).replace(/ /g,"");
              const st={watching:"watching",plan:"plan",planned:"plan",onhold:"onhold",paused:"onhold",dropped:"dropped",completed:"completed",done:"completed"}[k];
              if(st) return md=>getStatusOf(md.id)===st;
              if(k==="fav"||k==="favourite"||k==="favorite") return md=>isFav(md.id);
              if(k==="pinned") return md=>isPinned(md.id);
              if(k==="rated") return md=>!!getRating(md.id);
              if(k==="unrated") return md=>!getRating(md.id);
              if(k==="list"||k==="mine"||k==="tracked") return md=>isWatched(md.id);
              if(k==="archived") return md=>isArchived(md.id);
              if(k==="followed"||k==="alerts") return md=>isFollowed(md.id);
              return null; } },
};
for(const [k,d] of Object.entries(SEARCH_OPS)) d.name=k;
Object.assign(SEARCH_OPS, { genres:SEARCH_OPS.genre, tags:SEARCH_OPS.tag, by:SEARCH_OPS.studio, rating:SEARCH_OPS.score,
  episodes:SEARCH_OPS.eps, type:SEARCH_OPS.format, rated:SEARCH_OPS.mine, from:SEARCH_OPS.source });
function parseSearch(raw){
  const out={ raw:String(raw||"").trim(), text:"", rawText:"", ops:[], unknown:[], pending:null, al:{} };
  const re=/([A-Za-z]+):(?:"([^"]*)"?|(\S*))|"([^"]*)"?|(\S+)/g;
  const words=[];
  let m;
  while((m=re.exec(out.raw))){
    if(m[1]!==undefined){
      const def=SEARCH_OPS[m[1].toLowerCase()];
      const val=m[2]!==undefined?m[2]:m[3];
      if(!def){ words.push(m[0]); out.unknown.push(m[1]); continue; }
      if(!val){ out.pending=def.name; continue; }   // "genre:" mid-typing — neither text nor a filter yet
      let test=null, label=val, t=null;
      if(def.num){
        const spec=def.scale ? val.replace(/\d+(?:\.\d+)?/g, d=>String(def.scale(+d))) : val;
        t=numTest(spec, def.num);
        if(t){ test=def.make(val,t); label=t.label; }
      } else test=def.make(val);
      if(!test){ words.push(m[0]); out.unknown.push(m[1]); continue; }
      out.ops.push({ key:def.name, label, test });
      const al=def.al && def.al(val,t);
      if(al) for(const [k,v] of Object.entries(al)){ if(v==null) continue; out.al[k]=Array.isArray(v)&&Array.isArray(out.al[k])?[...new Set(out.al[k].concat(v))]:v; }
    } else words.push(m[4]!==undefined?m[4]:m[5]);
  }
  out.rawText=words.join(" ").trim();
  out.text=normText(out.rawText);
  return out;
}
const searchActive = q => !!(q && (q.text || q.ops.length));
// Memoised per query and per library revision: passFilter asks this once per
// EPISODE, and a month holds a few thousand of those across a few hundred shows.
let searchMemo={ key:null, map:new Map() };
function matchSearch(md){
  const q=state.searchQ;
  if(!searchActive(q)) return true;
  const key=q.raw+" "+ratingsRev+":"+weakRev;
  if(searchMemo.key!==key) searchMemo={ key, map:new Map() };
  const id=String(md.id);
  let r=searchMemo.map.get(id);
  if(r===undefined){
    r=(!q.text || !!titleMatch(md,q.text)) && q.ops.every(o=>o.test(md));
    searchMemo.map.set(id,r);
  }
  return r;
}
/* ---------- search-as-you-type ranking (Day 74) ----------
   The match band leads; popularity, your predicted affinity and "it is already
   in your library" only reorder shows inside a band. Their combined ceiling
   (about 115) is below the narrowest gap between bands (120), so no amount of
   popularity lifts a typo over an exact prefix. Ties break on id, which is what
   keeps a list from shuffling between keystrokes that did not change the order. */
function searchUniverse(){
  const seen=new Map();
  for(const src of [state.media, state.extra.values(), state.full.values(), state.light.values(), state.searchResults.values()])
    for(const md of src) if(md && md.id && !seen.has(String(md.id))) seen.set(String(md.id), md);
  return [...seen.values()].filter(md=>!excluded(md));
}
function rankSearch(list, q){
  const first=[], seen=new Set();
  for(const md of list){
    if(!md||!md.id) continue;
    const id=String(md.id); if(seen.has(id)) continue; seen.add(id);
    const m=q.text ? titleMatch(md,q.text) : {score:MATCH_BAND.fuzzy, how:"ops"};
    if(!m) continue;
    if(q.ops.length && !q.ops.every(o=>o.test(md))) continue;
    const pop=Math.log10(Math.max(10, md.popularity||10))*10;   // ≤ ~65
    first.push({ md, id, how:m.how, base:m.score, rank:m.score+pop+(inLibrary(id)?20:0) });
  }
  first.sort((a,b)=>b.rank-a.rank);
  // Affinity is a prediction per row, so only the leaders pay for one.
  if(tasteReady()){
    const mean=tasteVectors().myMean;
    for(const r of first.slice(0,40)){
      const p=predictScore(r.id, r.md);
      if(predUsable(p)) r.rank+=Math.max(-25, Math.min(25, (p.score-mean)*6));
    }
  }
  first.sort((a,b)=>b.rank-a.rank || (a.id<b.id?-1:1));
  return first;
}
/* An operator-only search ("genre:mecha year:>=2020") has no title to send
   upstream, so the operators AniList understands become query arguments and the
   rest are applied to what comes back. */
const OPS_QUERY=`query($g:[String],$f:[MediaFormat],$s:MediaStatus,$y1:FuzzyDateInt,$y2:FuzzyDateInt,$sc:Int,$adult:Boolean){
  Page(page:1, perPage:24){ media(type:ANIME, genre_in:$g, format_in:$f, status:$s, startDate_greater:$y1, startDate_lesser:$y2,
    averageScore_greater:$sc, isAdult:$adult, sort:[POPULARITY_DESC]){ ${FULL_FIELDS} } } }`;
async function searchByOps(q){
  if(!Object.keys(q.al).length) return [];
  const vars={ ...q.al, adult: state.hideNSFW ? false : null };
  // Unset filters are omitted, not sent as null: AniList rejects this query with
  // "Illegal operator and value combination" when they are explicit.
  for(const k of Object.keys(vars)) if(vars[k]==null) delete vars[k];
  const qs=new URLSearchParams();
  if(vars.g) qs.set("genres", vars.g.join(","));
  if(vars.f) qs.set("formats", vars.f.join(","));
  if(vars.s) qs.set("status", vars.s);
  if(vars.y1) qs.set("from", String(vars.y1));
  if(vars.y2) qs.set("to", String(vars.y2));
  if(vars.sc!=null) qs.set("minScore", String(vars.sc));
  if(!state.hideNSFW) qs.set("adult","1");
  const d=await viaApi("/filter?"+qs, OPS_QUERY, vars);
  return (d.Page&&d.Page.media)||[];
}
function searchOpsHtml(q){
  if(!q.ops.length && !q.unknown.length && !q.pending) return "";
  const chips=q.ops.map(o=>`<span class="sr-op"><b>${esc(o.key)}</b> ${esc(o.label)}</span>`).join("");
  const unk=q.unknown.length?`<span class="sr-unk">“${esc(q.unknown[0])}:” isn't an operator — searched as text</span>`:"";
  const pend=q.pending?`<span class="sr-unk">${esc(q.pending)}: needs a value — e.g. ${esc(SEARCH_OPS[q.pending].help)}</span>`:"";
  return `<div class="sr-ops">${chips}${unk}${pend}${q.ops.length?`<button type="button" class="sr-save" data-savesearch>🔖 Save</button>`:""}</div>`;
}

/* ---------- search history (Day 72) ----------
   A query is remembered when it was USED — Enter, a picked result, or a pause
   long enough to read the results — not on every keystroke, or the list would be
   "f", "fr", "fri". Kept in this browser like everything else, and clearable. */
const SEARCH_HIST_MAX = 15;
function saveSearchHist(){ try{ localStorage.setItem("anical.searchhist", JSON.stringify(state.searchHist)); }catch(e){} }
function recordSearch(raw){
  raw=String(raw||"").trim();
  if(raw.length<2) return;
  state.searchHist=[raw, ...state.searchHist.filter(x=>x.toLowerCase()!==raw.toLowerCase())].slice(0,SEARCH_HIST_MAX);
  saveSearchHist();
}
function searchHomeHtml(){
  const hist=state.searchHist, saved=state.savedSearches;
  const tips=`<div class="sr-tips"><b>Try</b> <code>genre:romance</code> <code>year:>=2020</code> <code>score:>8</code> <code>studio:mappa</code> <code>status:airing</code> <code>is:plan</code>
    <span>· <kbd>${IS_MAC?"⌘":"Ctrl"} K</kbd> for everything</span></div>`;
  let html="";
  if(saved.length){
    html+=`<div class="sr-sec">Saved searches <button type="button" class="sr-link" data-savedopen>Manage</button></div>`+
      saved.slice(0,5).map(s=>`<div class="sr-hist" role="button" tabindex="0" data-runsaved="${esc(s.id)}"><span>🔖</span><b>${esc(s.name)}</b><i>${esc(snapshotSummary(s)||"")}</i></div>`).join("");
  }
  if(hist.length){
    html+=`<div class="sr-sec">Recent <button type="button" class="sr-link" data-histclear>Clear</button></div>`+
      hist.slice(0,8).map(q=>`<div class="sr-hist" role="button" tabindex="0" data-rerun="${esc(q)}"><span>↺</span><b>${esc(q)}</b></div>`).join("");
  }
  return html+tips;
}
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent||"");

/* ---------- saved searches (Days 70–71) ----------
   A saved search is a snapshot of the whole combination — the text in the box
   AND every filter — and applying it REPLACES the current filters rather than
   merging into them, because "reapplies exactly" means a filter you had on
   before must not survive into a search that never had it. Pinned ones become
   one-tap chips above the calendar. */
const SAVED_MAX = 30, PRESET_MAX = 8;
function saveSavedSearches(){ try{ localStorage.setItem("anical.savedsearch", JSON.stringify(state.savedSearches)); }catch(e){} }
const FILTER_DEFAULTS = { format:"", genre:"", minScore:0, premieresOnly:false };
function cleanFilters(f){
  const out={...FILTER_DEFAULTS};
  for(const [k,v] of Object.entries(f||{})){
    if(v===""||v===false||v===0||v==null) continue;
    out[k]=v;
  }
  return out;
}
function currentSnapshot(){ return { search:($("fSearch")&&$("fSearch").value||"").trim(), filters:cleanFilters(state.filters) }; }
function snapshotSummary(s){
  const f=s.filters||{}, parts=[];
  if(s.search) parts.push(`“${s.search}”`);
  if(f.format) parts.push(FMT_LABEL[f.format]||f.format);
  if(f.genre) parts.push(f.genre);
  if(f.tag) parts.push(f.tag);
  if(f.stream) parts.push(f.stream);
  if(+f.minScore) parts.push(`★ ${f.minScore}+`);
  if(f.premieresOnly) parts.push("premieres");
  if(f.mine) parts.push("my list");
  if(f.epsMin||f.epsMax) parts.push(`${f.epsMin||1}–${f.epsMax||"∞"} eps`);
  if(f.airedMin||f.airedMax) parts.push(`ep ${f.airedMin||1}–${f.airedMax||"∞"}`);
  return parts.join(" · ");
}
const snapshotKey = s => JSON.stringify([String(s.search||"").toLowerCase(), Object.entries(cleanFilters(s.filters)).sort()]);
function applySnapshot(s){
  state.filters=cleanFilters(JSON.parse(JSON.stringify(s.filters||{})));
  localStorage.setItem("anical.filters", JSON.stringify(state.filters));
  const box=$("fSearch");
  if(box) box.value=s.search||"";
  state.search=String(s.search||"").toLowerCase();
  state.searchQ=parseSearch(s.search||"");
  syncControlsFromState(); syncFilterCount(); setFiltersOpen(activeFilterCount()>0);
  hideSearchResults();
  // A saved search filters the calendar, so it runs where it can be seen.
  if(!["month","week","agenda"].includes(state.viewMode)) setView("month");
  else { syncURL(false); renderView(); renderGenreChips(); }
}
function openSavedSearches(){
  const cur=currentSnapshot(), sum=snapshotSummary(cur);
  const dupe=state.savedSearches.find(s=>snapshotKey(s)===snapshotKey(cur));
  $("modalTitle").textContent="🔖 Saved searches";
  $("modalBody").innerHTML=`
    <div class="ss-now">
      <div class="ss-label">What's on screen now</div>
      ${sum
        ? `<div class="ss-sum">${esc(sum)}</div>
           ${dupe?`<p class="num-hint" style="margin:6px 0 0">Already saved as <b>${esc(dupe.name)}</b>.</p>`
             :`<form class="ss-form" id="ssForm"><input id="ssName" maxlength="40" placeholder="Name it — e.g. Weekend movies" value="${esc((cur.search||cur.filters.genre||"").slice(0,40))}" autocomplete="off">
               <button class="primary" type="submit">Save</button></form>`}`
        : `<p class="num-hint" style="margin:0">Nothing is being searched or filtered right now. Type in the search box (operators like <code>genre:mecha year:>=2020</code> work) or open ⛃ Filters, then come back.</p>`}
    </div>
    <div class="ss-label" style="margin-top:16px">Saved · ${state.savedSearches.length}</div>
    ${state.savedSearches.length ? `<div class="ss-list">${state.savedSearches.map(s=>`
      <div class="ss-row">
        <button class="ss-run" data-runsaved="${esc(s.id)}"><b>${esc(s.name)}</b><span>${esc(snapshotSummary(s)||"no filters")}</span></button>
        <button class="ss-pin ${s.pinned?"on":""}" data-sspin="${esc(s.id)}" aria-pressed="${!!s.pinned}" title="${s.pinned?"Remove the chip from above the calendar":"Show as a one-tap chip above the calendar"}">📌 ${s.pinned?"Pinned":"Pin"}</button>
        <button class="ss-del" data-ssdel="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">✕</button>
      </div>`).join("")}</div>`
      : `<p class="num-hint" style="margin:6px 0 0">None yet. Saved searches reapply the exact combination in one tap, and pinned ones sit above the calendar.</p>`}`;
  const form=$("ssForm");
  if(form) form.onsubmit=e=>{
    e.preventDefault();
    const name=($("ssName").value||"").trim().slice(0,40);
    if(!name){ $("ssName").focus(); return; }
    if(state.savedSearches.length>=SAVED_MAX){ toast(`That's the limit of ${SAVED_MAX} — delete one first.`); return; }
    state.savedSearches.push({ id:"s"+Date.now().toString(36), name, search:cur.search, filters:cur.filters,
      pinned: state.savedSearches.filter(s=>s.pinned).length<PRESET_MAX });
    saveSavedSearches(); paintPresets(); openSavedSearches();
    toast(`Saved · ${name}`);
  };
  $("overlay").classList.add("on");
}
function paintPresets(){
  const host=$("searchPresets"); if(!host) return;
  const pins=state.savedSearches.filter(s=>s.pinned).slice(0,PRESET_MAX);
  host.hidden=!pins.length;
  if(!pins.length){ host.innerHTML=""; return; }
  const curKey=snapshotKey(currentSnapshot());
  host.innerHTML=`<span class="presets-l">🔖</span>`+pins.map(s=>{
    const on=snapshotKey(s)===curKey;
    return `<button type="button" class="preset${on?" on":""}" data-runsaved="${esc(s.id)}" aria-pressed="${on}" title="${esc(snapshotSummary(s))}${on?" — tap again to clear":""}">${esc(s.name)}</button>`;
  }).join("")+`<button type="button" class="preset add" data-savedopen title="Save or manage searches">＋</button>`;
}
document.addEventListener("click",e=>{
  const run=e.target.closest("[data-runsaved]");
  if(run){
    e.preventDefault(); e.stopPropagation();
    const s=state.savedSearches.find(x=>x.id===run.dataset.runsaved); if(!s) return;
    const on=snapshotKey(s)===snapshotKey(currentSnapshot());
    if($("overlay").classList.contains("on")) closeModal();
    // Tapping the chip that is already applied clears it — a chip that can only
    // ever turn things on leaves you hunting for the way back.
    applySnapshot(on && run.classList.contains("preset") ? {search:"", filters:{}} : s);
    if(s.search) recordSearch(s.search);
    return;
  }
  if(e.target.closest("[data-savedopen]")){ e.preventDefault(); hideSearchResults(); openSavedSearches(); return; }
  if(e.target.closest("[data-savesearch]")){ e.preventDefault(); hideSearchResults(); openSavedSearches(); return; }
  const pin=e.target.closest("[data-sspin]");
  if(pin){
    const s=state.savedSearches.find(x=>x.id===pin.dataset.sspin); if(!s) return;
    if(!s.pinned && state.savedSearches.filter(x=>x.pinned).length>=PRESET_MAX){ toast(`Up to ${PRESET_MAX} pinned — unpin one first.`); return; }
    s.pinned=!s.pinned; saveSavedSearches(); paintPresets(); openSavedSearches(); return;
  }
  const del=e.target.closest("[data-ssdel]");
  if(del){
    const i=state.savedSearches.findIndex(x=>x.id===del.dataset.ssdel); if(i<0) return;
    const [gone]=state.savedSearches.splice(i,1);
    saveSavedSearches(); paintPresets(); openSavedSearches();
    toast(`Deleted · ${gone.name}`, ()=>{ state.savedSearches.splice(i,0,gone); saveSavedSearches(); paintPresets(); if($("overlay").classList.contains("on")) openSavedSearches(); });
    return;
  }
  const rerun=e.target.closest("[data-rerun]");
  if(rerun){
    e.preventDefault(); e.stopPropagation();
    const box=$("fSearch"); box.value=rerun.dataset.rerun; box.focus();
    recordSearch(rerun.dataset.rerun);
    onSearch();
    return;
  }
  if(e.target.closest("[data-histclear]")){
    e.preventDefault(); e.stopPropagation();
    const was=state.searchHist.slice();
    state.searchHist=[]; saveSearchHist(); showSearchHome();
    toast("Search history cleared", ()=>{ state.searchHist=was; saveSearchHist(); });
  }
});
function showSearchHome(){
  const box=$("searchResults");
  box.innerHTML=searchHomeHtml();
  box.classList.add("on");
  srIndex=-1;
}

/* ---------- the command palette (Days 65–68) ----------
   Ctrl/⌘-K, from anywhere — including from inside a text box, which is why the
   shortcut is caught in the capture phase before any input's own handler sees
   it. One box over three kinds of thing: shows (ranked by the same search as the
   toolbar), places to go, and commands. Pick a show and press → or Tab and the
   list becomes that show's actions, so "set status, add to a list, rate" never
   needs the mouse.

   FOCUS NEVER LEAVES IT WHILE IT IS OPEN. The input is its only focusable
   element; the list is navigated with aria-activedescendant rather than by
   moving focus, Tab is taken for "open actions" instead of leaving, and closing
   hands focus back to whatever had it before.

   RECENT AND FREQUENT (Day 68). `anical.palette` counts what you pick and keeps
   the last twenty. The empty palette leads with them, and usage also nudges the
   ranking of a typed query, so the thing you open every day rises above the
   thing that merely matches as well. */
const PAL_KEY = "anical.palette";
const pal = { open:false, target:null, q:"", sel:0, items:[], remote:[], remoteQ:"", seq:0, timer:null, lastFocus:null, msg:"" };
function palSaveUse(){ try{ localStorage.setItem(PAL_KEY, JSON.stringify(state.palUse)); }catch(e){} }
function palRemember(it){
  if(!it || !it.key || it.key==="act:ratehint") return;
  const u=state.palUse, k=it.key;
  u.f[k]=(u.f[k]||0)+1;
  if(!k.startsWith("act:")) u.r=[{k, t:it.label, img:it.img||""}, ...u.r.filter(x=>x.k!==k)].slice(0,20);
  // A guard, not a design limit: keep the counts that are actually used.
  const keys=Object.keys(u.f);
  if(keys.length>300){ keys.sort((a,b)=>u.f[b]-u.f[a]).slice(200).forEach(x=>delete u.f[x]); }
  palSaveUse();
}
function palCommands(){
  const go=(v,label,icon,kbd,words)=>({ key:"view:"+v, kind:"cmd", icon, label, sub:"Go to", kbd, words, run:()=>setView(v) });
  const cmds=[
    go("month","Month calendar","📅","M","calendar"), go("week","Week","🗓","W","calendar"), go("agenda","Agenda","📋","A","list upcoming"),
    go("board","My board","🗂️","","library statuses"), go("lists","My lists","📚","L","collections"),
    go("dashboard","Dashboard","📊","D","stats charts"), go("recs","For you","✨","F","recommendations picks feed"),
    go("gems","Hidden gems","💎","G","obscure underrated underseen"), go("taste","Your taste profile","🧬","","profile axes"),
    go("events","Events","🎟️","E","conventions"),
    { key:"cmd:browse-tag", kind:"cmd", icon:"🏷", label:"Browse tags", sub:"Go to", kbd:"B", run:()=>openBrowse("tag") },
    { key:"cmd:browse-studio", kind:"cmd", icon:"🎬", label:"Browse studios", sub:"Go to", run:()=>openBrowse("studio") },
    { key:"cmd:browse-staff", kind:"cmd", icon:"🎙", label:"Browse staff", sub:"Go to", words:"directors writers voice actors", run:()=>openBrowse("staff") },
    { key:"cmd:today", kind:"cmd", icon:"⏱", label:"Jump to today", kbd:"T", run:()=>$("today").click() },
    { key:"cmd:random", kind:"cmd", icon:"🎲", label:"Random show", sub:"Respects your filters", kbd:"R", words:"surprise dice", run:surpriseMe },
    { key:"cmd:saved", kind:"cmd", icon:"🔖", label:"Saved searches", words:"presets", run:openSavedSearches },
    { key:"cmd:clearfilters", kind:"cmd", icon:"🧹", label:"Clear all filters", run:()=>clearFilter("*") },
    { key:"cmd:theme", kind:"cmd", icon:state.theme==="light"?"🌙":"☀️", label:state.theme==="light"?"Switch to dark theme":"Switch to light theme", words:"appearance mode",
      run:()=>{ state.theme=state.theme==="light"?"dark":"light"; localStorage.setItem("anical.theme",state.theme); applyAppearance(); renderView(); } },
    { key:"cmd:settings", kind:"cmd", icon:"⚙", label:"Settings", words:"preferences options", run:()=>openSettings() },
    { key:"cmd:refresh", kind:"cmd", icon:"↻", label:"Refresh schedule data", run:()=>$("refresh").click() },
    { key:"cmd:subscribe", kind:"cmd", icon:"🔔", label:"Subscribe to a calendar feed", words:"ics google apple", run:openSubscribe },
    { key:"cmd:whatsnew", kind:"cmd", icon:"🆕", label:"What's new", words:"changelog release notes", run:openChangelog },
    { key:"cmd:shortcuts", kind:"cmd", icon:"⌨️", label:"Keyboard shortcuts", words:"keys help", kbd:"?", run:openShortcutsHelp },
  ];
  for(const s of state.savedSearches)
    cmds.push({ key:"saved:"+s.id, kind:"cmd", icon:"🔖", label:s.name, sub:"Saved search · "+snapshotSummary(s), run:()=>applySnapshot(s) });
  return cmds;
}
function palShowItem(md){
  const st=getStatusOf(md.id), r=getRating(md.id);
  return { key:"show:"+md.id, kind:"show", id:String(md.id), md, label:title(md), img:(md.coverImage&&md.coverImage.medium)||"",
    sub:[FMT_LABEL[md.format]||md.format, yearOfMedia(md)||"", md.averageScore?`★ ${md.averageScore}`:"", st?statusLabel(st):"", r?`you: ${r}`:""].filter(Boolean).join(" · ") };
}
function palActions(md){
  const id=String(md.id), cur=getStatusOf(id), r=getRating(id);
  const act=(key,icon,label,run,extra)=>({ key, kind:"act", icon, label, run, ...(extra||{}) });
  return [
    act("act:open","🪟","Open quick view",()=>{ palClose(); peekShow(id); },{close:true, words:"details modal"}),
    act("act:page","📄","Open full page",()=>{ palClose(); openShowPage(id); },{close:true, words:"show page staff episodes"}),
    ...STATUS_DEFS.map(s=>act("act:status:"+s.key, s.emoji, cur===s.key?`${s.label} ✓ — remove from board`:`Set status: ${s.label}`,
      ()=>{ setStatusOf(id, cur===s.key?null:s.key); renderView(); return cur===s.key?"Removed from your board":`Status set to ${s.label}`; },
      { words:"status "+s.key })),
    act("act:ratehint","⭐", r?`Rated ${r}/10 — type a number to change it`:"Rate it — type a number from 1 to 10",
      ()=>{ const inp=$("palInput"); inp.value="rate "; pal.q="rate "; palRefresh(); return null; }, { hint:true, words:"rate score" }),
    ...Array.from({length:10},(_,i)=>i+1).map(n=>act("act:rate","⭐", r===n?`Rated ${n}/10 ✓ — clear it`:`Rate ${n}/10`,
      ()=>{ setRating(id, r===n?0:n); renderView(); return r===n?"Rating cleared":`Rated ${n}/10`; },
      { rate:n, words:`rate score ${n}` })),
    act("act:fav","♥", isFav(id)?"Remove from favourites":"Add to favourites",()=>{ const on=toggleFav(id); renderView(); return on?"Added to favourites":"Removed from favourites"; },{words:"favourite favorite heart"}),
    act("act:pin","📌", isPinned(id)?"Unpin":"Pin to the top of your board",()=>{ const res=togglePin(id); renderView(); return res==="full"?`Pins are full (${PIN_MAX}) — unpin one first`:res?"Pinned":"Unpinned"; }),
    act("act:follow","🔔", isFollowed(id)?"Turn off episode alerts":"Notify me when episodes air",()=>{ toggleNotify(id); return isFollowed(id)?"Episode alerts on":"Episode alerts off"; },{words:"bell notify alert"}),
    ...state.collections.map(c=>act("act:col","📚", inCollection(c.id,id)?`Remove from “${c.name}”`:`Add to “${c.name}”`,
      ()=>{ const on=toggleInCollection(c.id,id); refreshCollectionPickers(id); renderView(); return on?`Added to ${c.name}`:`Removed from ${c.name}`; },
      { words:"list collection" })),
    act("act:similar","🧲","Find similar shows",()=>{ palClose(); state.showJump="similar"; openShowPage(id); },{close:true, words:"like related"}),
    act("act:hide","🚫", isHidden(id)?"Unhide this show":"Not interested — hide it everywhere",()=>{ toggleHidden(id); renderView(); return isHidden(id)?"Hidden everywhere":"Unhidden"; },{words:"hide"}),
  ];
}
// Word-prefix match over a command's label and keywords; a typo budget on longer words.
function palMatch(it, q){
  if(!q) return 1;
  const hay=normText(`${it.label} ${it.words||""} ${it.sub||""}`), words=hay.split(" ");
  let s=0;
  for(const qt of q.split(" ")){
    if(!qt) continue;
    if(words.some(w=>w===qt)) s+=120;
    else if(words.some(w=>w.startsWith(qt))) s+=100;
    else if(hay.includes(qt)) s+=55;
    else {
      const b=typoBudget(qt.length);
      if(b && words.some(w=>editDistance(qt, w.slice(0,qt.length), b)<=b)) s+=30; else return 0;
    }
  }
  return s;
}
function palFromRecent(x){
  if(x.k.startsWith("show:")){
    const id=x.k.slice(5), md=anyMedia(id);
    return md ? palShowItem(md) : { key:x.k, kind:"show", id, label:x.t, img:x.img, sub:"Recently opened" };
  }
  return palCommands().find(c=>c.key===x.k)||null;
}
function palBuild(){
  const q=normText(pal.q), u=state.palUse;
  const freq=k=>Math.log2(1+(u.f[k]||0))*14;
  if(pal.target){
    const acts=palActions(pal.target);
    const num=q.match(/^(?:rate |score )?(\d{1,2})$/);
    let list;
    if(!q) list=acts.filter(a=>!a.rate);
    else if(num) list=acts.filter(a=>a.rate===+num[1]);
    else list=acts.filter(a=>!a.hint).map(a=>({a, s:palMatch(a,q)})).filter(x=>x.s).sort((x,y)=>(y.s+freq(y.a.key))-(x.s+freq(x.a.key))).map(x=>x.a);
    if(!q) list.sort((a,b)=>freq(b.key)-freq(a.key));   // the actions you reach for most, first
    return [["Actions", list]];
  }
  if(!q){
    const rec=u.r.map((x,i)=>({x, s:(u.f[x.k]||0)*1.5+(20-i)})).sort((a,b)=>b.s-a.s).map(o=>palFromRecent(o.x)).filter(Boolean).slice(0,6);
    // Shows you opened from anywhere else count as recent too — "most-visited"
    // is about the show, not about which door you came in by.
    const have=new Set(rec.map(r=>r.key));
    const viewed=(state.recent||[]).filter(r=>r&&!have.has("show:"+r.id)&&!isHidden(r.id)).slice(0,Math.max(0,8-rec.length))
      .map(r=>{ const md=anyMedia(r.id); return md?palShowItem(md):{ key:"show:"+r.id, kind:"show", id:String(r.id), label:r.t, img:r.img, sub:"Recently viewed" }; });
    const cmds=palCommands().filter(c=>!have.has(c.key)).sort((a,b)=>freq(b.key)-freq(a.key)).slice(0,7);
    return [["Recent & frequent", rec.concat(viewed)], ["Go to", cmds]];
  }
  const cmds=palCommands().map(c=>({it:c, s:palMatch(c,q)})).filter(x=>x.s)
    .sort((a,b)=>(b.s+freq(b.it.key))-(a.s+freq(a.it.key))).slice(0,5).map(x=>x.it);
  const sq=parseSearch(pal.q);
  const shows=rankSearch(searchUniverse().concat(pal.remote), sq)
    .map(r=>({r, s:r.rank+freq("show:"+r.id)})).sort((a,b)=>b.s-a.s).slice(0,10).map(x=>palShowItem(x.r.md));
  // A query that names a command outright ("board", "random") leads with it;
  // anything else is more likely a title.
  const cmdFirst=cmds.length && palMatch(cmds[0],q)>=100*q.split(" ").length && !(shows[0] && rankSearch([shows[0].md],sq)[0].base>=MATCH_BAND.prefix);
  return cmdFirst ? [["Commands",cmds],["Shows",shows]] : [["Shows",shows],["Commands",cmds]];
}
function palRowHtml(it,i){
  const icon = it.kind==="show"
    ? (it.img?`<img src="${esc(it.img)}" alt="" loading="lazy">`:`<span class="pal-ic">🎬</span>`)
    : `<span class="pal-ic">${it.icon||"›"}</span>`;
  return `<div class="pal-row${it.kind==="show"?" show":""}" id="pal-o${i}" role="option" data-pali="${i}" aria-selected="false">
    ${icon}<span class="pal-tx"><b>${esc(it.label)}</b>${it.sub?`<i>${esc(it.sub)}</i>`:""}</span>
    ${it.kbd?`<kbd>${esc(it.kbd)}</kbd>`:""}${it.kind==="show"&&!pal.target?`<span class="pal-go" title="Actions">→</span>`:""}
  </div>`;
}
function palRefresh(){
  if(!pal.open) return;
  const sections=palBuild();
  pal.items=[];
  let html="";
  for(const [h,items] of sections){
    if(!items.length) continue;
    html+=`<div class="pal-sec" role="presentation">${esc(h)}</div>`;
    for(const it of items){ html+=palRowHtml(it, pal.items.length); pal.items.push(it); }
  }
  const q=pal.q.trim(), sq=parseSearch(q);
  const waiting=!pal.target && sq.rawText.length>=3 && q!==pal.remoteQ;
  if(!pal.items.length) html=`<div class="pal-empty">${pal.target
    ? "No action matches — try “watching”, “rate 8”, “pin” or a list name."
    : waiting ? "Searching AniList…" : "Nothing matches. Try a title, a place (“board”, “gems”) or a command (“random”)."}</div>`;
  if(pal.sel>=pal.items.length) pal.sel=Math.max(0,pal.items.length-1);
  $("palList").innerHTML=html;
  $("palCrumb").innerHTML=pal.target?`<span class="pal-crumb-t">${esc(title(pal.target))}</span><span aria-hidden="true">›</span>`:`<span aria-hidden="true">⌕</span>`;
  $("palInput").placeholder=pal.target?"Pick an action — “plan”, “rate 9”, a list name…":"Search shows, places and commands…";
  $("palFoot").innerHTML = pal.msg ? `<span class="pal-msg">✓ ${esc(pal.msg)}</span><span>Backspace for another show · Esc to close</span>`
    : pal.target ? `<span><kbd>↵</kbd> run</span><span><kbd>⌫</kbd> back</span><span><kbd>Esc</kbd> close</span>`
    : `<span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>→</kbd> actions</span><span><kbd>⇧↵</kbd> full page</span><span><kbd>Esc</kbd> close</span>`;
  palPaintSel();
  if(waiting){
    clearTimeout(pal.timer);
    const seq=++pal.seq, text=sq.rawText;
    pal.timer=setTimeout(async()=>{
      try{
        const list=await searchAniList(text);
        if(seq!==pal.seq || !pal.open) return;
        pal.remote=(list||[]).filter(md=>!excluded(md));
      }catch(e){ if(seq!==pal.seq) return; pal.remote=[]; }
      pal.remoteQ=q; palRefresh();
    },260);
  }
}
function palPaintSel(){
  const list=$("palList");
  list.querySelectorAll("[data-pali]").forEach(el=>{
    const on=+el.dataset.pali===pal.sel;
    el.classList.toggle("on",on); el.setAttribute("aria-selected",on?"true":"false");
    if(on) el.scrollIntoView({block:"nearest"});
  });
  $("palInput").setAttribute("aria-activedescendant", pal.items.length?"pal-o"+pal.sel:"");
}
function palEnsure(){
  if($("palOv")) return;
  const ov=document.createElement("div");
  ov.id="palOv"; ov.className="pal-ov"; ov.hidden=true;
  ov.innerHTML=`<div class="pal" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="pal-in"><span class="pal-crumb" id="palCrumb"></span>
      <input id="palInput" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list">
      <kbd class="pal-esc">Esc</kbd></div>
    <div class="pal-list" id="palList" role="listbox" aria-label="Results"></div>
    <div class="pal-foot" id="palFoot"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener("mousedown",e=>{ if(e.target===ov){ e.preventDefault(); palClose(); } });
  const inp=$("palInput");
  inp.addEventListener("input",()=>{ pal.q=inp.value; pal.sel=0; pal.msg=""; palRefresh(); });
  inp.addEventListener("keydown",palKey);
  const list=$("palList");
  list.addEventListener("mousemove",e=>{ const r=e.target.closest("[data-pali]"); if(r && +r.dataset.pali!==pal.sel){ pal.sel=+r.dataset.pali; palPaintSel(); } });
  // mousedown, not click: a click would blur the input first, and the trap below
  // would be fighting the very row being picked.
  list.addEventListener("mousedown",e=>{
    const go=e.target.closest(".pal-go"), r=e.target.closest("[data-pali]"); if(!r) return;
    e.preventDefault(); pal.sel=+r.dataset.pali;
    if(go){ const it=pal.items[pal.sel]; if(it&&it.kind==="show") palEnterActions(it); return; }
    palRun(e.shiftKey);
  });
  ov.addEventListener("focusout",e=>{
    if(pal.open && !ov.contains(e.relatedTarget)) setTimeout(()=>{ if(pal.open && document.activeElement!==inp) inp.focus(); },0);
  });
}
function palOpen(target){
  palEnsure();
  if(!pal.open) pal.lastFocus=document.activeElement;
  hideSearchResults();
  pal.open=true; pal.target=target||null; pal.q=""; pal.sel=0; pal.msg=""; pal.remote=[]; pal.remoteQ="";
  $("palOv").hidden=false;
  document.body.classList.add("pal-on");
  const inp=$("palInput"); inp.value="";
  palRefresh(); inp.focus();
}
function palClose(){
  if(!pal.open) return;
  pal.open=false; pal.target=null; clearTimeout(pal.timer); pal.seq++;
  $("palOv").hidden=true;
  document.body.classList.remove("pal-on");
  const f=pal.lastFocus; pal.lastFocus=null;
  if(f && f.isConnected && typeof f.focus==="function" && f!==document.body){ try{ f.focus(); }catch(e){} }
  else if(document.activeElement===$("palInput")) $("palInput").blur();   // nothing to return to: don't leave focus in a hidden box
}
async function palEnterActions(it){
  let md=it.md||anyMedia(it.id);
  if(!md || !md.airingSchedule){
    // Actions write to the library, and the board, the AniList sync and the
    // alerts all expect to resolve the show afterwards — so resolve it now.
    $("palFoot").innerHTML=`<span>Loading ${esc(it.label)}…</span>`;
    try{ md=await fetchMediaById(it.id); }catch(e){ md=md||null; }
    if(!pal.open) return;
    if(!md){ pal.msg=""; $("palFoot").innerHTML=`<span>Couldn't load that show right now.</span>`; return; }
  }
  if(!findMediaById(md.id)) state.full.set(String(md.id), md);
  palRemember({ key:"show:"+md.id, label:title(md), img:(md.coverImage&&md.coverImage.medium)||"" });
  pal.target=md; pal.q=""; pal.sel=0; pal.msg="";
  $("palInput").value=""; palRefresh();
}
function palRun(shift){
  const it=pal.items[pal.sel]; if(!it) return;
  if(it.kind==="show"){
    palRemember(it);
    if(it.md && it.md.airingSchedule && !findMediaById(it.id)) state.full.set(it.id, it.md);
    palClose();
    if(shift) openShowPage(it.id); else peekShow(it.id);
    return;
  }
  if(it.kind==="cmd"){ palRemember(it); palClose(); it.run(); return; }
  if(it.kind==="act"){
    palRemember(it);
    const target=pal.target;
    const msg=it.run();
    if(it.close || msg===null || !pal.open) return;
    if(typeof msg==="string"){ pal.msg=msg; toast(`${msg} · ${title(target)}`); }
    pal.q=""; $("palInput").value=""; palRefresh();   // ✓ marks move to the new state
  }
}
function palKey(e){
  const inp=$("palInput"), n=pal.items.length;
  if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); palClose(); return; }
  if(e.key==="ArrowDown"){ e.preventDefault(); if(n){ pal.sel=(pal.sel+1)%n; palPaintSel(); } return; }
  if(e.key==="ArrowUp"){ e.preventDefault(); if(n){ pal.sel=(pal.sel-1+n)%n; palPaintSel(); } return; }
  if(e.key==="Home" && !inp.value){ e.preventDefault(); pal.sel=0; palPaintSel(); return; }
  if(e.key==="Enter"){ e.preventDefault(); palRun(e.shiftKey); return; }
  if(e.key==="Tab" || (e.key==="ArrowRight" && inp.selectionStart===inp.value.length)){
    const it=pal.items[pal.sel];
    if(e.key==="Tab") e.preventDefault();   // Tab never leaves the palette
    if(it && it.kind==="show" && !pal.target){ e.preventDefault(); palEnterActions(it); }
    return;
  }
  if(e.key==="Backspace" && !inp.value && pal.target){ e.preventDefault(); pal.target=null; pal.sel=0; pal.msg=""; palRefresh(); }
}
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey) && !e.altKey && !e.shiftKey && (e.key==="k"||e.key==="K")){
    e.preventDefault(); e.stopPropagation();
    if(pal.open) palClose(); else palOpen();
  }
}, true);

/* ---------- the similarity engine (Day 75) ----------
   Content similarity, not "people who liked this also liked": a weighted feature
   vector per show and the cosine between two of them. Genres, ranked tags
   (weighted by how central AniList says the tag is), the studio, and a little of
   source, era and format — enough of the last three to separate a 2004 OVA from a
   2024 TV series that happen to share tags, not enough to let them match on their
   own.

   Staff is compared separately and only when BOTH records carry it. Only show
   pages fetch staff, so folding it into the vector would quietly penalise every
   comparison against a record that simply didn't ask — the norm would grow on
   one side and never on the other.

   The same franchise is excluded. A sequel is always the most similar show there
   is, and "more like this" that answers with season 2 has told you nothing the
   Related section doesn't. */
const SIM_W = { genre:1, tag:1.25, studio:1.5, source:0.35, era:0.3, format:0.25 };
const KEY_STAFF_ROLE = /^(Director|Chief Director|Series Composition|Original Creator|Original Story|Character Design|Music)\b/i;
const simCache=new WeakMap();
function simVector(md){
  let v=simCache.get(md); if(v) return v;
  const f=new Map();
  for(const g of md.genres||[]) f.set("g:"+g, SIM_W.genre);
  for(const t of md.tags||[]) if(t&&t.name&&!t.isMediaSpoiler&&(t.rank||0)>=40) f.set("t:"+t.name, SIM_W.tag*(t.rank/100));
  for(const s of (md.studios&&md.studios.nodes)||[]) if(s&&s.name) f.set("s:"+s.name, SIM_W.studio);
  if(md.source) f.set("src:"+md.source, SIM_W.source);
  const d=decadeOf(yearOfMedia(md)); if(d) f.set("era:"+d, SIM_W.era);
  if(md.format) f.set("fmt:"+(md.format==="TV_SHORT"?"TV":md.format), SIM_W.format);
  let norm=0; for(const w of f.values()) norm+=w*w;
  v={ f, norm:Math.sqrt(norm) };
  simCache.set(md,v); return v;
}
function simScore(a,b){
  const va=simVector(a), vb=simVector(b);
  if(!va.norm||!vb.norm) return 0;
  const [small,big]=va.f.size<vb.f.size?[va,vb]:[vb,va];
  let dot=0; for(const [k,w] of small.f){ const w2=big.f.get(k); if(w2) dot+=w*w2; }
  return dot/(va.norm*vb.norm);
}
function keyStaff(md){
  const m=new Map();
  for(const e of (md&&md.staff&&md.staff.edges)||[]) if(e&&e.node&&KEY_STAFF_ROLE.test(e.role||"")) m.set(String(e.node.id), e.node.name&&e.node.name.full);
  return m;
}
function sharedStaff(a,b){
  const sa=keyStaff(a); if(!sa.size) return [];
  const out=[]; for(const [id,name] of keyStaff(b)) if(sa.has(id)) out.push(name);
  return out.filter(Boolean);
}
function relatedIds(md){
  const s=new Set();
  for(const e of (md&&md.relations&&md.relations.edges)||[]) if(e&&e.node) s.add(String(e.node.id));
  return s;
}
/* Direct relations only reach one hop, so season 3 of a show whose record links
   to season 2 slipped through as "the most similar show". Titles catch the rest:
   a franchise's entries nearly always share the title up to the colon or the
   season marker, and a core of at least six letters keeps "Black Clover" from
   excluding "Black Lagoon". */
const coreCache=new WeakMap();
function titleCores(md){
  let c=coreCache.get(md); if(c) return c;
  const t=md.title||{};
  c=[t.romaji,t.english].filter(Boolean).map(s=>normText(String(s).split(/[:：]/)[0])
    .replace(/\b(season|part|cour|the movie|movie|film|ova|special|specials|\d+(st|nd|rd|th)?|ii+|iv|final|2nd|3rd)\b/g," ").replace(/\s+/g," ").trim())
    .filter(s=>s.length>=6);
  coreCache.set(md,c); return c;
}
function sameFranchise(a,b){
  const ca=titleCores(a), cb=titleCores(b);
  return ca.some(x=>cb.some(y=>x===y || x.startsWith(y+" ") || y.startsWith(x+" ")));
}
function similarTo(md, pool, opts){
  opts=opts||{};
  const self=String(md.id), rel=relatedIds(md), out=[], seen=new Set([self]);
  for(const c of pool){
    if(!c||!c.id) continue;
    const id=String(c.id);
    if(seen.has(id)) continue; seen.add(id);
    if(c.type && c.type!=="ANIME") continue;
    if(rel.has(id) || relatedIds(c).has(self) || sameFranchise(md,c)) continue;
    if(excluded(c)) continue;
    if(opts.airing && c.status!=="RELEASING") continue;
    const s=simScore(md,c) + Math.min(0.12, sharedStaff(md,c).length*0.05);
    if(s<0.08) continue;
    out.push({ md:c, id, score:Math.min(1,s) });
  }
  out.sort((a,b)=>b.score-a.score || (a.id<b.id?-1:1));
  return opts.limit ? out.slice(0,opts.limit) : out;
}
/* The one line under each neighbour. It names the strongest thing the two share,
   in the order a person would say it: the same people first, then the studio,
   then what it is about, then what kind of show it is. */
function simReason(a,b){
  const bits=[];
  const staff=sharedStaff(a,b);
  if(staff.length) bits.push(`same ${staff.length>1?"staff":"creator"} (${staff.slice(0,2).join(", ")})`);
  const sa=((a.studios&&a.studios.nodes)||[]).map(s=>s&&s.name).filter(Boolean);
  const studio=((b.studios&&b.studios.nodes)||[]).map(s=>s&&s.name).find(n=>sa.includes(n));
  if(studio) bits.push(`same studio (${studio})`);
  const va=simVector(a), vb=simVector(b);
  const tags=[...va.f.keys()].filter(k=>k.startsWith("t:")&&vb.f.has(k))
    .sort((x,y)=>Math.min(va.f.get(y),vb.f.get(y))-Math.min(va.f.get(x),vb.f.get(x))).map(k=>k.slice(2));
  if(tags.length) bits.push(tags.slice(0,3).join(", "));
  const genres=(a.genres||[]).filter(g=>(b.genres||[]).includes(g));
  if(genres.length && bits.length<3) bits.push(`both ${genres.slice(0,2).join(" & ")}`);
  if(!bits.length) bits.push("similar shape — format, era and source line up");
  return bits.slice(0,3).join(" · ");
}
/* Candidates for one show: everything already loaded, plus one aliased request
   for shows that share its tags, its genres, and — for Day 77's filter — its
   genres among what is airing right now. One request, three lists, cached for
   the session. A failed request still answers from what is loaded, and says so. */
const SIM_POOL_QUERY=`query($g:[String],$t:[String],$ex:[Int]){
  byTag: Page(perPage:30){ media(type:ANIME, tag_in:$t, id_not_in:$ex, isAdult:false, sort:[POPULARITY_DESC]){ ${CARD_FIELDS} } }
  byGenre: Page(perPage:25){ media(type:ANIME, genre_in:$g, id_not_in:$ex, isAdult:false, sort:[SCORE_DESC]){ ${CARD_FIELDS} } }
  airing: Page(perPage:25){ media(type:ANIME, status:RELEASING, genre_in:$g, id_not_in:$ex, isAdult:false, sort:[POPULARITY_DESC]){ ${CARD_FIELDS} } }
}`;
const simPoolCache=new Map();
function localPool(){ return [...state.media, ...state.extra.values(), ...state.full.values(), ...state.light.values()]; }
async function similarPool(md){
  const id=String(md.id);
  if(simPoolCache.has(id)) return simPoolCache.get(id);
  const genres=(md.genres||[]).filter(g=>g!=="Hentai").slice(0,2);
  const tags=(md.tags||[]).filter(t=>t&&!t.isMediaSpoiler&&(t.rank||0)>=60).sort((a,b)=>b.rank-a.rank).slice(0,3).map(t=>t.name);
  let remote=null;
  try{
    const d=await viaApi(`/similar/${encodeURIComponent(id)}`, SIM_POOL_QUERY,
      { g:genres.length?genres:null, t:tags.length?tags:null, ex:[+id, ...[...relatedIds(md)].map(Number)] });
    remote=[...((d.byTag&&d.byTag.media)||[]), ...((d.byGenre&&d.byGenre.media)||[]), ...((d.airing&&d.airing.media)||[])];
    keepLight(remote);
  }catch(e){ remote=null; }
  const res={ remote:remote||[], ok:!!remote };
  if(remote) simPoolCache.set(id,res);   // a failure is retried next time, not remembered
  return res;
}
function similarHtml(md, res){
  const airing=!!state.simAiring, id=String(md.id);
  const pool=res.remote.concat(localPool());
  const rows=similarTo(md, pool, { limit:5, airing });
  const head=`<div class="sim-head">
      <span class="num-hint" style="margin:0;flex:1">${airing?"Closest matches that are broadcasting right now":"The five closest shows by tags, genres, studio and staff — sequels and spin-offs left out"}</span>
      <button type="button" class="chip${airing?" on":""}" data-simairing aria-pressed="${airing}">📡 Airing now</button>
    </div>`;
  if(!rows.length){
    return head+`<div class="sim-empty">${airing
      ? `None of the close matches are airing right now. <button type="button" class="afx-clear" data-simairing>Show all matches</button>`
      : `Nothing came close enough${res.ok?"":" — AniList didn't answer, so this only looked through what's already loaded"}.`}</div>`;
  }
  return head+`<div class="sim-list">${rows.map(r=>{
    const m=r.md, rid=esc(r.id);
    return `<div class="sim-row" role="button" tabindex="0" data-peek="${rid}" aria-label="${esc(title(m))}">
      <img src="${esc((m.coverImage&&m.coverImage.medium)||"")}" alt="" loading="lazy" width="42" height="58">
      <span class="sim-tx"><b>${esc(title(m))}</b><i>${esc(simReason(md,m))}</i>
        <span class="sim-meta">${[FMT_LABEL[m.format]||m.format, yearOfMedia(m)||"", m.averageScore?`★ ${m.averageScore}`:"", m.status==="RELEASING"?"airing":"", inLibrary(r.id)?"in your library":""].filter(Boolean).map(esc).join(" · ")}</span></span>
      <span class="sim-pct" title="Content similarity">${Math.round(r.score*100)}%</span>
      <a class="sim-page" href="${showHref(r.id)}" data-showpage="${rid}" title="Open the full page" aria-label="Open the full page for ${esc(title(m))}">↗</a>
    </div>`;
  }).join("")}</div>`;
}
async function loadSimilar(md, slotId){
  const slot=$(slotId); if(!slot) return;
  const id=String(md.id);
  slot.dataset.sim=id;
  const cached=simPoolCache.get(id);
  if(cached){ slot.innerHTML=similarHtml(md,cached); return; }
  slot.innerHTML=`<div class="skel-rows">${'<div class="skel skel-row"></div>'.repeat(5)}</div>`;
  const res=await similarPool(md);
  const s=$(slotId);
  if(s && s.dataset.sim===id) s.innerHTML=similarHtml(md,res);
}
document.addEventListener("click",e=>{
  if(!e.target.closest("[data-simairing]")) return;
  e.preventDefault();
  state.simAiring=!state.simAiring;
  for(const slotId of ["simSlot","showSimSlot"]){
    const s=$(slotId); if(!s||!s.dataset.sim) continue;
    const md=anyMedia(s.dataset.sim)||(state.showCache.get(s.dataset.sim)||{}).md;
    const res=simPoolCache.get(s.dataset.sim)||{remote:[], ok:false};
    if(md) s.innerHTML=similarHtml(md,res);
  }
});

/* ---------- the show page (Days 55–60) ----------
   A real route — ?view=show&id=<AniList id> — rather than a bigger pop-up. The
   pop-up is where you DO things to a show (rate it, write a note, move it on the
   board); this is where you read about one: who made it, what it came from, what
   comes before and after it, every episode, how the crowd scored it, where to
   watch it and what it is about. Both stay: the page links to the pop-up for the
   doing, and the pop-up links here for the reading.

   One request fills the whole page. When AniList is rate-limiting, the page is
   built from our own catalogue record instead and says which sections that
   costs, rather than failing outright. */
const SHOW_QUERY=`query($id:Int){ Media(id:$id, type:ANIME){
  id idMal type title { romaji english native } synonyms format episodes duration genres status popularity trending favourites averageScore meanScore
  source isAdult countryOfOrigin hashtag season seasonYear bannerImage siteUrl
  description(asHtml:false)
  tags { name rank isMediaSpoiler isAdult category description }
  trailer { id site }
  externalLinks { site url type color icon language }
  coverImage { medium large extraLarge color }
  startDate { year month day } endDate { year month day }
  nextAiringEpisode { airingAt episode }
  studios(isMain: true) { nodes { id name } }
  allStudios: studios { edges { isMain node { id name isAnimationStudio } } }
  staff(sort:[RELEVANCE], perPage:18) { edges { role node { id name { full native } image { medium } } } }
  relations { edges { relationType(version: 2) node { id type format status title { romaji english native } coverImage { medium large } startDate { year month day } episodes chapters volumes averageScore isAdult siteUrl } } }
  airingSchedule(perPage:50) { nodes { airingAt episode } }
  stats { scoreDistribution { score amount } statusDistribution { status amount } }
  rankings { rank type allTime season year context }
} }`;
async function fetchShowPage(id){
  id=String(id);
  const hit=state.showCache.get(id); if(hit) return hit;
  let md=null, partial=false;
  try{ md=(await viaApi(`/show/${encodeURIComponent(id)}`, SHOW_QUERY, {id:+id})).Media; }
  catch(e){ try{ md=await fetchMediaById(id); partial=true; }catch(_){ md=null; } }
  if(!md) return null;
  const rec={ md, partial };
  if(!partial) state.showCache.set(id, rec);
  // Resolvable everywhere from now on — the board, the alerts and the AniList
  // sync all look shows up by id after you act on one from this page.
  if(!state.media.some(x=>String(x.id)===id)) state.full.set(id, md);
  for(const e of (md.staff&&md.staff.edges)||[]) if(e&&e.node) state.seenStaff.set(String(e.node.id), e.node);
  return rec;
}
const REL_ORDER=["PREQUEL","SEQUEL","PARENT","SIDE_STORY","SPIN_OFF","ALTERNATIVE","SOURCE","ADAPTATION","CHARACTER","SUMMARY","COMPILATION","CONTAINS","OTHER"];
const REL_LABEL_FULL={...REL_LABEL, SOURCE:"Source material", ADAPTATION:"Adaptations", CHARACTER:"Shares characters", PARENT:"Parent story"};
const MEDIA_FMT={...FMT_LABEL, MANGA:"Manga", NOVEL:"Light novel", ONE_SHOT:"One-shot"};
const COUNTRY={ JP:"Japan", CN:"China", KR:"South Korea", TW:"Taiwan" };
function fuzzyDateText(d){
  if(!d||!d.year) return "";
  if(!d.month) return String(d.year);
  return new Date(d.year, d.month-1, d.day||1).toLocaleDateString([], d.day?{year:"numeric",month:"short",day:"numeric"}:{year:"numeric",month:"short"});
}
function spHeroHtml(md, partial){
  const id=String(md.id), t=title(md), tt=md.title||{};
  const cover=coverOf(md), banner=md.bannerImage||"";
  const alt=[tt.romaji, tt.native].filter(x=>x&&x!==t);
  const mine=getRating(id);
  const p=!mine&&tasteReady()?predictScore(id, md):null;
  const topRank=(md.rankings||[]).filter(r=>r.allTime).sort((a,b)=>a.rank-b.rank)[0]
    || (md.rankings||[]).slice().sort((a,b)=>a.rank-b.rank)[0];
  const kicker=[FMT_LABEL[md.format]||md.format, seasonName(md), STATUS_WORD[md.status]||""].filter(Boolean);
  return `<div class="shw-hero" style="--shw-tint:${esc((md.coverImage&&md.coverImage.color)||"")||"var(--accent)"}">
    ${banner?`<img class="shw-banner" src="${esc(banner)}" alt="">`:cover?`<img class="shw-banner blur" src="${esc(cover)}" alt="">`:""}
    <div class="shw-scrim"></div>
    <div class="shw-hero-in">
      <div class="shw-poster">${cover?`<img src="${esc(cover)}" alt="${esc(t)} cover" width="230" height="326">`:`<span class="vs-ph">🎬</span>`}</div>
      <div class="shw-head">
        <button type="button" class="shw-back" data-spback>← Back</button>
        <div class="shw-kicker">${kicker.map(esc).join(" · ")}</div>
        <h2 class="shw-title">${esc(t)}</h2>
        ${alt.length?`<div class="shw-alt">${alt.map(esc).join(" · ")}</div>`:""}
        <div class="shw-scores">
          ${md.averageScore?`<div class="shw-ring" style="--p:${md.averageScore}" title="AniList community average"><b>${md.averageScore}</b><span>AniList</span></div>`:""}
          ${mine?`<div class="shw-ring mine" style="--p:${Math.round(mine*10)}" title="Your score"><b>${esc(String(shownRating(id)))}</b><span>You</span></div>`
            : predUsable(p)?`<div class="shw-ring pred${p.conf<PRED_GOOD_CONF?" low":""}" style="--p:${Math.round(p.score*10)}" title="Predicted from your taste · ${Math.round(p.conf*100)}% evidence"><b>~${p.score}</b><span>For you</span></div>`:""}
          ${md.popularity?`<div class="shw-stat"><b>${compactNum(md.popularity)}</b><span>members</span></div>`:""}
          ${md.favourites?`<div class="shw-stat"><b>${compactNum(md.favourites)}</b><span>favourites</span></div>`:""}
          ${topRank?`<div class="shw-stat"><b>#${topRank.rank}</b><span>${esc(topRank.context)}${topRank.allTime?"":topRank.year?" "+topRank.year:""}</span></div>`:""}
        </div>
        <div class="shw-actions">
          <div class="shw-status">${statusPickerHtml(id,"")}</div>
          <button type="button" data-watch="${id}">${isWatched(id)?"★ In My List":"☆ Add to My List"}</button>
          <button type="button" class="bellbtn ${isFollowed(id)?"on":""}" data-bell="${id}">${isFollowed(id)?"🔔 Alerts on":"🔕 Notify me"}</button>
          <button type="button" data-peek="${id}" title="Rate it, write notes, track episodes and add it to lists">✎ Rate &amp; notes</button>
          <button type="button" data-spshare="${id}" title="Copy a link to this page">🔗 Copy link</button>
        </div>
      </div>
    </div>
  </div>
  ${partial?`<div class="loadwarn shw-warn"><span>AniList is busy, so this page is built from our catalogue — staff, the score distribution and rankings will appear once it answers.</span><button type="button" data-showretry>↻ Retry</button></div>`:""}`;
}
function spOverviewHtml(md){
  const raw=decodeEntities(String(md.description||"").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"")).trim();
  const paras=raw.split(/\n\s*\n|\n/).map(s=>s.trim()).filter(Boolean);
  const na=nextAir(md);
  const next=na?`<div class="shw-next"><span>🕒 Episode ${na.episode}</span><b>${new Date(na.airingAt*1000).toLocaleString([], timeOpts({weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</b><span class="pill cd">in ${cdLive(na.airingAt)}</span></div>`:"";
  const prog=(isWatched(md.id)||getProgress(md.id))?progressRowHtml(md):"";
  return `<h3>Overview</h3>${next}
    ${paras.length?`<div class="shw-desc">${paras.map(p=>`<p>${esc(p)}</p>`).join("")}</div>`:`<p class="shw-muted">No synopsis on AniList yet.</p>`}
    ${(md.genres||[]).length?`<div class="shw-genres">${md.genres.map(g=>`<span class="pill">${esc(g)}</span>`).join("")}</div>`:""}
    ${prog?`<div class="shw-prog">${prog}</div>`:""}`;
}
function spFactsHtml(md){
  const rows=[];
  const edges=(md.allStudios&&md.allStudios.edges)||[];
  const main=edges.filter(e=>e&&e.isMain&&e.node);
  const studios=main.length?main.map(e=>e.node):((md.studios&&md.studios.nodes)||[]).filter(Boolean);
  const studioLink=s=>`<a href="${browseHref("studio",s.id||"",s.id?"":s.name)}" data-browse="studio|${esc(String(s.id||""))}|${esc(s.name)}">${esc(s.name)}</a>`;
  if(studios.length) rows.push([studios.length>1?"Studios":"Studio", studios.map(studioLink).join(", ")]);
  const producers=edges.filter(e=>e&&!e.isMain&&e.node).slice(0,4).map(e=>e.node);
  if(producers.length) rows.push(["Producers", producers.map(studioLink).join(", ")]);
  if(md.source) rows.push(["Source", esc(SOURCE_LABEL[md.source]||md.source)]);
  /* "Adaptation range". AniList records WHAT an anime adapts and how long that
     source runs; it does not record which chapters a season covers, and
     inventing a range would be worse than leaving the row out. So the row states
     the source and its length, and where this entry sits in the anime's own run. */
  const src=((md.relations&&md.relations.edges)||[]).find(e=>e&&e.relationType==="SOURCE"&&e.node&&e.node.type==="MANGA");
  if(src){
    const n=src.node, len=[n.volumes?`${n.volumes} vol`:"", n.chapters?`${n.chapters} ch`:""].filter(Boolean).join(" · ");
    rows.push(["Adapts", `<a href="${esc(n.siteUrl||"https://anilist.co/manga/"+n.id)}" target="_blank" rel="noopener">${esc(title(n))}</a>
      <span class="shw-muted">${esc([MEDIA_FMT[n.format]||n.format, len||(n.status==="RELEASING"?"still running":""), ].filter(Boolean).join(" · "))}</span>`]);
  }
  const prequels=((md.relations&&md.relations.edges)||[]).filter(e=>e&&e.relationType==="PREQUEL"&&e.node&&e.node.type==="ANIME").length;
  const sequels=((md.relations&&md.relations.edges)||[]).filter(e=>e&&e.relationType==="SEQUEL"&&e.node&&e.node.type==="ANIME").length;
  if(prequels||sequels) rows.push(["In its run", esc(prequels&&sequels?"Has a prequel and a sequel":prequels?"Follows an earlier entry":"First entry — continued later")]);
  const aired=[fuzzyDateText(md.startDate), md.status==="RELEASING"?"now":fuzzyDateText(md.endDate)].filter(Boolean);
  if(aired.length) rows.push(["Aired", esc(aired.join(" – "))]);
  if(md.season&&md.seasonYear) rows.push(["Season", esc(seasonName(md))]);
  const eps=epTotal(md);
  if(eps||md.duration){
    const total=eps&&md.duration?eps*md.duration:0;
    rows.push(["Length", esc([eps?`${eps} episode${eps===1?"":"s"}`:"", md.duration?`${md.duration} min each`:"",
      total>=90?`≈ ${Math.round(total/60)} h total`:""].filter(Boolean).join(" · "))]);
  }
  if(md.countryOfOrigin) rows.push(["Country", esc(COUNTRY[md.countryOfOrigin]||md.countryOfOrigin)]);
  if(md.hashtag) rows.push(["Hashtag", esc(md.hashtag)]);
  const ranks=(md.rankings||[]).slice().sort((a,b)=>a.rank-b.rank).slice(0,3);
  if(ranks.length) rows.push(["Rankings", ranks.map(r=>esc(`#${r.rank} ${r.context}${r.allTime?"":[r.season?" "+r.season.charAt(0)+r.season.slice(1).toLowerCase():"", r.year?" "+r.year:""].join("")}`)).join("<br>")]);
  return `<h3>Details</h3><dl class="shw-facts">${rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}
/* Day 57. Every aired and scheduled episode, dated in the release you track —
   the same variant resolution the calendar and the pop-up schedule use, so the
   three can never disagree about when an episode came out. Shows that finished
   before AniList kept schedules still list every episode; they just say the date
   isn't on record rather than pretending there is no episode. */
const SP_EP_CAP = 300;
function spEpisodesHtml(md){
  const id=String(md.id);
  const nodes=((md.airingSchedule&&md.airingSchedule.nodes)||[]).slice().sort((a,b)=>a.episode-b.episode);
  const byEp=new Map(nodes.map(n=>[n.episode,n]));
  const total=Math.max(epTotal(md), nodes.length?nodes[nodes.length-1].episode:0);
  if(!total) return `<h3>Episodes</h3><p class="shw-muted">${md.status==="NOT_YET_RELEASED"?"Not announced yet — no episode count or schedule on AniList.":"AniList has no episode count or schedule for this one."}</p>`;
  const prog=getProgress(id), now=Date.now()/1000, avail=availableEp(md);
  const rows=[];
  for(let ep=1; ep<=Math.min(total,SP_EP_CAP); ep++){
    const n=byEp.get(ep);
    let ts=null, brk=false, up;
    if(n){
      const {variants}=variantsFor(md,n);
      const primary=preferredVariant(visibleVariants(variants));
      brk=!variants.length;
      ts=primary?primary.ts:n.airingAt;
      up=!brk&&ts>now;
    } else up = md.status==="NOT_YET_RELEASED" || (md.status!=="FINISHED" && ep>avail);
    const watched=!up&&!brk&&ep<=prog;
    const fin=isFinale(md,ep);
    const state_=brk?`<span class="pill brk">⏸ Break</span>`
      : up ? (ts?`<span class="pill cd">in ${cdLive(ts)}</span>`:`<span class="pill">upcoming</span>`)
      : watched ? `<span class="pill score">✓ watched</span>` : `<span class="pill">aired</span>`;
    const mark=(up||brk) ? `<span class="shw-mark-sp"></span>`
      : `<span class="mark ${watched?"on":""}" role="button" tabindex="0" data-mark="${id}|${ep}" aria-label="${watched?`Watched — mark episode ${ep} unwatched`:`Mark watched up to episode ${ep}`}" title="${watched?"Watched — click to unmark":"Mark watched (this & earlier)"}">${watched?"✓":""}</span>`;
    rows.push(`<div class="shw-ep${watched?" on":""}${up?" up":""}">
      ${mark}<span class="shw-ep-n">Ep ${ep}${fin?` <span class="pill fin">🏁 Finale</span>`:""}</span>
      <span class="shw-ep-d">${brk?"—":ts?new Date(ts*1000).toLocaleString([], timeOpts({weekday:"short",month:"short",day:"numeric",year:new Date(ts*1000).getFullYear()!==new Date().getFullYear()?"numeric":undefined,hour:"numeric",minute:"2-digit"})):`<span class="shw-muted">date not recorded</span>`}</span>
      ${state_}
    </div>`);
  }
  const watchedN=Math.min(prog,total);
  return `<h3>Episodes <span class="shw-h-n">${watchedN?`${watchedN} of ${total} watched`:`${total}`}</span></h3>
    <p class="num-hint" style="margin:-4px 0 8px">${TZ_SHORT?`Times in ${esc(TZ_SHORT)} — your time.`:"Times in your local timezone."} Tick an episode to mark it and everything before it watched.</p>
    <div class="shw-eps">${rows.join("")}</div>
    ${total>SP_EP_CAP?`<p class="shw-muted">Showing the first ${SP_EP_CAP} of ${total}.</p>`:""}`;
}
/* Day 58. The crowd's distribution with you placed on it — your own score if
   you gave one, the prediction if you didn't and there's enough to make one, and
   an honest sentence if neither. AniList buckets scores in tens. */
function spScoresHtml(md, partial){
  const id=String(md.id), mine=getRating(id);
  const p=!mine&&tasteReady()?predictScore(id, md):null;
  const you=mine || (predUsable(p)?p.score:null);
  const dist=((md.stats&&md.stats.scoreDistribution)||[]).filter(d=>d&&d.score);
  const byScore=new Map(dist.map(d=>[d.score,d.amount]));
  const total=dist.reduce((s,d)=>s+d.amount,0);
  const bucket=you?Math.min(100,Math.max(10,Math.round(you)*10)):null;
  let chart;
  if(total){
    const max=Math.max(...dist.map(d=>d.amount),1);
    chart=`<div class="shw-dist" role="img" aria-label="AniList score distribution">${[10,20,30,40,50,60,70,80,90,100].map(s=>{
      const a=byScore.get(s)||0, h=Math.max(2,Math.round(a/max*100));
      return `<div class="shw-bar${s===bucket?" you":""}" title="${compactNum(a)} scored ${s/10}/10">
        <i style="height:${h}%"></i>${s===bucket?`<em>${mine?"you":"~you"}</em>`:""}<span>${s/10}</span></div>`;
    }).join("")}</div>`;
  } else {
    chart=`<p class="shw-muted">${partial?"The distribution is loading from AniList.":md.averageScore?`Community average ★ ${md.averageScore}, but AniList hasn't published a distribution for it.`:"No community scores yet."}</p>`;
  }
  let line;
  if(mine){
    const below=total?[...byScore].filter(([s])=>s<bucket).reduce((n,[,a])=>n+a,0):0;
    line=`You scored it <b>${esc(String(shownRating(id)))}</b>${total?` — higher than ${Math.round(below/total*100)}% of AniList`:""}${md.averageScore?`, against a community average of <b>${(md.averageScore/10).toFixed(1)}</b>`:""}.`;
  } else if(predUsable(p)){
    line=`Predicted <b>~${p.score}</b> for you, from ${Math.round(p.conf*100)}% evidence${p.why&&p.why[0]?` — mostly <b>${esc(String(p.why[0].value))}</b> (${p.why[0].lift>=0?"+":""}${p.why[0].lift.toFixed(2)})`:""}. Rate it to replace the estimate.`;
  } else if(tasteReady()){
    line="Nothing you've rated has enough in common with this to estimate it — your own score would be the first word on it.";
  } else {
    line=`Rate ${TASTE_MIN_RATED} shows and this places a prediction of your score on the chart. You have ${tasteVectors().total}.`;
  }
  const sd=new Map(((md.stats&&md.stats.statusDistribution)||[]).map(d=>[d.status,d.amount]));
  const started=(sd.get("CURRENT")||0)+(sd.get("COMPLETED")||0)+(sd.get("DROPPED")||0)+(sd.get("PAUSED")||0);
  const drop=started>200?`<span>Dropped by <b>${Math.round((sd.get("DROPPED")||0)/started*100)}%</b> of the people who started it</span>`:"";
  const done=started>200&&md.status!=="NOT_YET_RELEASED"?`<span><b>${compactNum(sd.get("COMPLETED")||0)}</b> finished it · <b>${compactNum(sd.get("PLANNING")||0)}</b> plan to</span>`:"";
  return `<h3>Scores</h3>
    ${chart}
    <p class="shw-score-line">${line}</p>
    ${drop||done?`<div class="shw-sd">${drop}${done}</div>`:""}
    <div class="st-row shw-rate"><span class="st-row-label">⭐ Your rating:</span>${ratingPickerHtml(id)}${ratingOutHtml(id)}</div>`;
}
/* Day 59. Only links that exist. A dead "Official site" button is worse than no
   button, so every block here is omitted when it would be empty, and the section
   as a whole still has AniList to fall back on. */
function spWatchHtml(md){
  const links=(md.externalLinks||[]).filter(l=>l&&l.url);
  const dedupe=list=>{ const seen=new Set(); return list.filter(l=>{ const k=(l.site||l.url).toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; }); };
  const stream=streamChipsHTML(md);
  const info=dedupe(links.filter(l=>l.type==="INFO"));
  const social=dedupe(links.filter(l=>l.type==="SOCIAL"));
  const chip=l=>`<a class="shw-link" href="${esc(l.url)}" target="_blank" rel="noopener">${l.icon?`<img src="${esc(l.icon)}" alt="" width="14" height="14" loading="lazy">`:""}${esc(l.site||"Link")}${l.language?` <i>${esc(l.language)}</i>`:""}</a>`;
  const db=[`<a class="shw-link" href="${esc(md.siteUrl||"https://anilist.co/anime/"+md.id)}" target="_blank" rel="noopener">AniList</a>`,
    md.idMal?`<a class="shw-link" href="https://myanimelist.net/anime/${+md.idMal}" target="_blank" rel="noopener">MyAnimeList</a>`:""].join("");
  const trailer=trailerEmbedHTML(md);
  return `<h3>Watch &amp; links</h3>
    ${stream||`<p class="shw-muted">No streaming service is listed for it on AniList.</p>`}
    ${info.length?`<div class="shw-links"><span class="shw-sub">Official</span>${info.map(chip).join("")}</div>`:""}
    ${social.length?`<div class="shw-links"><span class="shw-sub">Social</span>${social.map(chip).join("")}</div>`:""}
    <div class="shw-links"><span class="shw-sub">Databases</span>${db}</div>
    ${trailer?`<div class="shw-trailer">${trailer}</div>`:""}`;
}
/* Day 60. Tags coloured by YOUR affinity for each one — the same shrunk lift the
   taste page charts — and sized by how central AniList says the tag is. With no
   ratings every tag is neutral and the legend says what would colour them, so
   the cloud is legible from a standing start. Spoiler tags stay folded. */
function tagAffinityStyle(row){
  if(!row) return "";
  const pct=Math.round(Math.min(55, 12+Math.abs(row.lift)*34));
  return ` style="--aff:color-mix(in srgb, var(${row.lift>=0?"--good":"--danger"}) ${pct}%, var(--bg3))"`;
}
function spTagsHtml(md){
  const tags=(md.tags||[]).filter(t=>t&&t.name&&!(t.isAdult&&state.hideNSFW)).sort((a,b)=>(b.rank||0)-(a.rank||0));
  if(!tags.length) return `<h3>Themes &amp; tags</h3><p class="shw-muted">No tags on AniList yet.</p>`;
  const aff=new Map(tasteDim("tag").map(r=>[r.value,r]));
  const chip=t=>{
    const row=aff.get(t.name);
    const size=(t.rank||0)>=80?"lg":(t.rank||0)>=60?"md":"sm";
    const tip=[t.description||"", `${t.rank||0}% relevant`,
      row?`you rate it ${row.lift>=0?"+":""}${row.lift.toFixed(2)} against your average, from ${row.n} of your shows`:"none of your rated shows carry it yet"].filter(Boolean).join(" · ");
    return `<a class="shw-tag ${size}${row?row.lift>=0?" pos":" neg":""}" href="${browseHref("tag","",t.name)}" data-browse="tag||${esc(t.name)}" title="${esc(tip)}"${tagAffinityStyle(row)}>${esc(t.name)}<i>${t.rank||0}</i></a>`;
  };
  const open=tags.filter(t=>!t.isMediaSpoiler), spoil=tags.filter(t=>t.isMediaSpoiler);
  const colored=open.filter(t=>aff.has(t.name)).length;
  const legend=colored
    ? `Coloured by your own taste: <b class="shw-pos">green</b> you rate above your average, <b class="shw-neg">red</b> below. Grey means nothing you've rated carries it.`
    : tasteVectors().total ? "None of these tags appear in enough of your rated shows to colour yet." : "Rate a few shows and these colour by how much you like each theme.";
  return `<h3>Themes &amp; tags</h3>
    <div class="shw-tags">${open.map(chip).join("")}</div>
    ${spoil.length?`<details class="shw-spoil"><summary>Show ${spoil.length} spoiler tag${spoil.length===1?"":"s"}</summary><div class="shw-tags">${spoil.map(chip).join("")}</div></details>`:""}
    <p class="num-hint" style="margin:8px 0 0">${legend} The number is how relevant AniList rates the tag.</p>`;
}
function spRelatedHtml(md){
  const edges=((md.relations&&md.relations.edges)||[]).filter(e=>e&&e.node&&!(state.hideNSFW&&e.node.isAdult));
  if(!edges.length) return `<h3>Related</h3><p class="shw-muted">No prequels, sequels, side stories or adaptations on record — this one stands alone.</p>`;
  const groups=new Map();
  for(const e of edges){ const k=REL_ORDER.includes(e.relationType)?e.relationType:"OTHER"; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(e.node); }
  const card=n=>{
    const anime=n.type==="ANIME", when=n.startDate&&n.startDate.year;
    const meta=[MEDIA_FMT[n.format]||n.format, when, anime&&n.episodes?`${n.episodes} ep`:"", !anime&&n.volumes?`${n.volumes} vol`:"", n.averageScore?`★ ${n.averageScore}`:"", STATUS_WORD[n.status]||""].filter(Boolean);
    const inner=`<img src="${esc((n.coverImage&&(n.coverImage.large||n.coverImage.medium))||"")}" alt="" loading="lazy"><span class="shw-rel-t">${esc(title(n))}</span><span class="shw-rel-m">${esc(meta.join(" · "))}</span>`;
    return anime
      ? `<a class="shw-rel" href="${showHref(n.id)}" data-showpage="${esc(String(n.id))}">${inner}</a>`
      : `<a class="shw-rel ext" href="${esc(n.siteUrl||`https://anilist.co/${String(n.type||"manga").toLowerCase()}/${n.id}`)}" target="_blank" rel="noopener">${inner}<span class="shw-ext" aria-label="opens AniList">↗</span></a>`;
  };
  return `<h3>Related</h3>${REL_ORDER.filter(k=>groups.has(k)).map(k=>`
    <div class="shw-relg"><div class="shw-sub">${esc(REL_LABEL_FULL[k]||k)}</div><div class="shw-rels">${groups.get(k).sort(ftlCompare).map(card).join("")}</div></div>`).join("")}`;
}
function spStaffHtml(md, partial){
  const edges=(md.staff&&md.staff.edges)||[];
  if(!edges.length) return `<h3>Staff</h3><p class="shw-muted">${partial?"Staff will load when AniList answers.":"No staff credited on AniList yet."}</p>`;
  const people=new Map();
  for(const e of edges){ if(!e||!e.node) continue; const k=String(e.node.id); if(!people.has(k)) people.set(k,{node:e.node, roles:[]}); people.get(k).roles.push(e.role); }
  return `<h3>Staff</h3><div class="shw-people">${[...people.values()].map(({node,roles})=>`
    <a class="shw-person" href="${browseHref("staff",node.id)}" data-browse="staff|${esc(String(node.id))}|${esc(node.name&&node.name.full||"")}">
      ${node.image&&node.image.medium?`<img src="${esc(node.image.medium)}" alt="" loading="lazy" width="36" height="36">`:`<span class="shw-ph">👤</span>`}
      <span><b>${esc(node.name&&node.name.full||"")}</b><i>${esc(roles.join(", "))}</i></span></a>`).join("")}</div>`;
}
function renderShowPage(){
  const wrap=enterDisco("show");
  const id=state.showId;
  if(!id){
    wrap.innerHTML=`<div class="ev-loading">No show picked. Search for one above, or press <kbd>${IS_MAC?"⌘":"Ctrl"} K</kbd>.</div>`;
    return;
  }
  const rec=state.showCache.get(String(id)) || (state.showPartial&&String(state.showPartial.md.id)===String(id)?state.showPartial:null);
  if(!rec){
    if(wrap.dataset.loading!==String(id)){
      wrap.dataset.loading=String(id);
      wrap.innerHTML=`<div class="sp shw-loading"><div class="skel shw-skel-hero"></div>${skeletonCards(6)}</div>`;
      fetchShowPage(id).then(r=>{
        wrap.dataset.loading="";
        if(state.viewMode!=="show" || String(state.showId)!==String(id)) return;
        if(!r){ wrap.innerHTML=`<div class="ev-loading">Couldn't load this show — AniList and our catalogue both failed to answer. <button type="button" data-showretry>↻ Try again</button></div>`; return; }
        if(r.partial) state.showPartial=r;
        renderShowPage();
      });
    }
    return;
  }
  const md=rec.md, t=title(md);
  $("monthTitle").textContent=t;
  document.title=`${t} — Tsuzuki`;
  const nav=[["overview","Overview"],["episodes","Episodes"],["scores","Scores"],["tags","Tags"],["related","Related"],["similar","Similar"],["details","Details"],["watch","Watch"],["staff","Staff"]];
  // Rebuilt on every repaint (a status change, a tick on an episode), so the
  // scroll position has to survive it — and the similar list, which loads last,
  // must not flash back to a skeleton each time.
  const y=window.scrollY;
  wrap.innerHTML=`<article class="sp">
    ${spHeroHtml(md, rec.partial)}
    <nav class="shw-nav" aria-label="On this page">${nav.map(([k,l])=>`<a href="#shw-${k}" data-spjump="${k}">${l}</a>`).join("")}</nav>
    <div class="shw-grid">
      <div class="shw-main">
        <section class="shw-sec" id="shw-overview">${spOverviewHtml(md)}</section>
        <section class="shw-sec" id="shw-episodes">${spEpisodesHtml(md)}</section>
        <section class="shw-sec" id="shw-scores">${spScoresHtml(md, rec.partial)}</section>
        <section class="shw-sec" id="shw-tags">${spTagsHtml(md)}</section>
        <section class="shw-sec" id="shw-related">${spRelatedHtml(md)}</section>
        <section class="shw-sec" id="shw-similar"><h3>Similar shows</h3><div id="showSimSlot"></div></section>
      </div>
      <aside class="shw-side">
        <section class="shw-sec" id="shw-details">${spFactsHtml(md)}</section>
        <section class="shw-sec" id="shw-watch">${spWatchHtml(md)}</section>
        <section class="shw-sec" id="shw-staff">${spStaffHtml(md, rec.partial)}</section>
      </aside>
    </div>
  </article>`;
  if(wrap.dataset.shown===String(id)) window.scrollTo({top:y});
  wrap.dataset.shown=String(id);
  loadSimilar(md,"showSimSlot");
  if(state.showJump){
    const target=$("shw-"+state.showJump); state.showJump=null;
    if(target) setTimeout(()=>target.scrollIntoView({behavior:"smooth", block:"start"}), 60);
  }
}
document.addEventListener("click",e=>{
  const jump=e.target.closest("[data-spjump]");
  if(jump){ e.preventDefault(); const s=$("shw-"+jump.dataset.spjump); if(s) s.scrollIntoView({behavior:"smooth", block:"start"}); return; }
  if(e.target.closest("[data-spback]")){
    e.preventDefault();
    // Back through history when there is somewhere in THIS app to go back to;
    // a show page opened from a shared link has nowhere, so it lands on the calendar.
    if(state.navDepth>0) history.back();
    else setView("month");
    return;
  }
  if(e.target.closest("[data-showretry]")){
    e.preventDefault();
    state.showCache.delete(String(state.showId)); state.showPartial=null;
    const w=$("showWrap"); if(w) w.dataset.loading="";
    renderShowPage(); return;
  }
  const share=e.target.closest("[data-spshare]");
  if(share){
    e.preventDefault();
    const url=location.origin+location.pathname+showHref(share.dataset.spshare);
    const done=()=>toast("Link copied");
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(()=>window.prompt("Copy this link:",url));
    else window.prompt("Copy this link:",url);
  }
});

/* ---------- profile diff (Day 61) ----------
   How your taste moved since the end of last month. There is no stored copy of
   last month's profile to compare against — and there doesn't need to be: the
   activity log dates every rating and every show added, so the profile as it
   stood on the 1st can be REBUILT by running the same tasteVectors() over only
   the ratings and statuses that already existed then. Same swap-and-restore the
   Day 44 backtest uses, for the same reason: one implementation of the profile,
   never a second one that could drift.

   What it cannot rebuild is a score you have since CHANGED — the log records
   that you rated a show, not what the number was — so the diff uses your current
   scores throughout and what moves is which shows count. The card says so.

   A FIRST MONTH IS A REAL STATE, NOT AN ERROR. If the log began after the 1st
   there is no end-of-last-month to rebuild, and the card says when there will be
   rather than comparing against an empty profile and calling everything new. */
let diffCache=null;
function tasteAsOf(cutoff){
  const firstRate=new Map(), firstAdd=new Map();
  for(const [type,id,day] of state.activity){
    const m=type==="rate"?firstRate:type==="add"?firstAdd:null;
    if(m && (!m.has(id) || day<m.get(id))) m.set(id,day);
  }
  // Nothing in the log means it predates the log, and the caller has already
  // checked the log predates the cutoff — so it was there.
  const was=(m,id)=>{ const d=m.get(String(id)); return d ? d<cutoff : true; };
  const savedR=state.ratings, savedS=state.status;
  const ratings={}, status={};
  for(const id of Object.keys(savedR)) if(+savedR[id] && was(firstRate,id)) ratings[id]=savedR[id];
  for(const id of Object.keys(savedS)) if(was(firstAdd,id)) status[id]=savedS[id];
  const bump=()=>{ ratingsRev++; weakRev++; tasteCache=null; predCache=null; };
  try{
    state.ratings=ratings; state.status=status; bump();
    const v=tasteVectors(), a=tasteArchetype();
    return { rated:v.rated, total:v.total, myMean:v.myMean, dims:v.dims, arch:a?a.label:null };
  } finally {
    state.ratings=savedR; state.status=savedS; bump();
  }
}
function profileDiff(){
  const now=new Date();
  const cutoff=localDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const names={ lastName:MONTHS[(now.getMonth()+11)%12], curName:MONTHS[now.getMonth()], nextName:MONTHS[(now.getMonth()+1)%12] };
  const since=activitySince();
  if(!since || since>=cutoff) return { first:true, since, ...names };
  const sum=Object.values(state.ratings).reduce((s,v)=>s+(+v||0),0);
  const key=`${cutoff}:${state.activity.length}:${Object.keys(state.ratings).length}:${sum}:${Object.keys(state.status).length}:${state.media.length}:${state.extra.size}:${tasteAdjCount()}`;
  if(diffCache && diffCache.key===key) return diffCache.value;
  const then=tasteAsOf(cutoff), cur=tasteVectors(), a=tasteArchetype();
  const moves=[], arrived=[], faded=[];
  for(const dim of TASTE_DIMS){
    const before=new Map((then.dims[dim.key]||[]).map(r=>[r.value,r]));
    const after=new Map((cur.dims[dim.key]||[]).map(r=>[r.value,r]));
    for(const [val,r] of after){
      const o=before.get(val);
      if(o){ const d=Math.round((r.lift-o.lift)*100)/100; if(Math.abs(d)>=0.15) moves.push({ label:dim.label, value:val, from:o.lift, to:r.lift, d }); }
      else arrived.push({ label:dim.label, value:val, lift:r.lift, n:r.n });
    }
    for(const [val,o] of before) if(!after.has(val)) faded.push({ label:dim.label, value:val, lift:o.lift });
  }
  moves.sort((x,y)=>Math.abs(y.d)-Math.abs(x.d));
  arrived.sort((x,y)=>Math.abs(y.lift)-Math.abs(x.lift));
  const value={ then, cur:{ rated:cur.rated, total:cur.total, myMean:cur.myMean, arch:a?a.label:null },
    moves:moves.slice(0,8), arrived:arrived.slice(0,8), faded:faded.slice(0,5), ...names };
  diffCache={ key, value };
  return value;
}
function profileDiffHtml(){
  const d=profileDiff();
  const head=`<h3>📈 ${esc(d.curName)} so far, against the end of ${esc(d.lastName)}</h3>`;
  if(d.first){
    return `<section class="tz-diff">${head}<p class="num-hint" style="margin:0">Nothing to compare against yet. Tsuzuki started keeping a dated log of your ratings
      ${d.since?`on <b>${esc(new Date(d.since+"T12:00:00").toLocaleDateString([], {month:"long", day:"numeric"}))}</b>`:"the first time you rated something here"},
      so there's no end-of-${esc(d.lastName)} profile to rebuild. The first comparison appears on <b>1 ${esc(d.nextName)}</b>.</p></section>`;
  }
  const lift=v=>`${v>=0?"+":""}${v.toFixed(2)}`;
  const added=d.cur.total-d.then.total;
  const stats=`<div class="tz-sample">
      <span><b>${added>=0?"+":""}${added}</b> rated since the 1st</span>
      <span>your average <b>${d.then.myMean.toFixed(1)}</b> → <b>${d.cur.myMean.toFixed(1)}</b></span>
      ${d.then.arch&&d.cur.arch?`<span>${d.then.arch===d.cur.arch?`still a <b>${esc(d.cur.arch)}</b> viewer`:`<b>${esc(d.then.arch)}</b> → <b>${esc(d.cur.arch)}</b>`}</span>`:""}
    </div>`;
  if(d.then.rated<TASTE_MIN_RATED){
    return `<section class="tz-diff">${head}${stats}<p class="num-hint" style="margin:0 0 8px">At the end of ${esc(d.lastName)} you had ${d.then.total} rated show${d.then.total===1?"":"s"} — not enough for a profile, so there are no old axes to move. This is what's been built since:</p>
      ${d.arrived.length?`<div class="tz-chips">${d.arrived.map(x=>`<span class="rc-chip ${x.lift>=0?"pos":"neg"}" title="${esc(x.label)} · from ${x.n} shows">${esc(String(x.value))} <b>${lift(x.lift)}</b></span>`).join("")}</div>`:""}</section>`;
  }
  const max=Math.max(0.5, ...d.moves.map(m=>Math.abs(m.d)));
  return `<section class="tz-diff">${head}${stats}
    ${d.moves.length?`<div class="tz-moves">${d.moves.map(m=>`<div class="tz-move">
        <span class="tz-mv-n" title="${esc(m.label)}">${esc(String(m.value))} <i>${esc(m.label)}</i></span>
        <span class="tz-mv-track"><i class="${m.d>=0?"pos":"neg"}" style="width:${Math.round(Math.abs(m.d)/max*50)}%;${m.d>=0?"left:50%":"right:50%"}"></i><b></b></span>
        <span class="tz-mv-v">${lift(m.from)} → ${lift(m.to)} <em class="${m.d>=0?"pos":"neg"}">${m.d>=0?"▲":"▼"}${Math.abs(m.d).toFixed(2)}</em></span>
      </div>`).join("")}</div>`
      :`<p class="num-hint" style="margin:0">No axis moved by more than 0.15 — your taste held steady this month.</p>`}
    ${d.arrived.length?`<div class="tz-sub">New to your profile</div><div class="tz-chips">${d.arrived.map(x=>`<span class="rc-chip ${x.lift>=0?"pos":"neg"}" title="${esc(x.label)} · from ${x.n} shows">${esc(String(x.value))} <b>${lift(x.lift)}</b></span>`).join("")}</div>`:""}
    ${d.faded.length?`<div class="tz-sub">Dropped below the evidence bar</div><div class="tz-chips">${d.faded.map(x=>`<span class="rc-chip thin">${esc(String(x.value))}</span>`).join("")}</div>`:""}
    <p class="num-hint" style="margin:8px 0 0">Rebuilt from the dated activity log, using your current scores for every show — what moves month to month is which shows count.</p>
  </section>`;
}

/* ---------- because-you-follow (Days 62–64) ----------
   Recommendations grouped by the show in your library that triggered them.
   Every pick is attributed — to the library show it most resembles, weighted by
   how strongly that show speaks for you: a 9 you gave counts for more than a 7,
   a show you are watching counts as a firm-ish yes, a favourite adds to either.

   RAILS ARE ORDERED BY HOW STRONG THE REASON IS, AND WEAK ONES ARE NOT SHOWN.
   Strength is the mean attributed similarity of a rail's best three picks,
   nudged up a little for a rail with more to offer. A row titled "because you
   rated Frieren a 9" whose contents only faintly resemble Frieren is a claim the
   row cannot back, and a hidden rail costs nothing, so below the bar they go. */
const RAIL_MIN_STRENGTH = 0.16;
const RAIL_MIN_PICKS = 2;
let railsCache=null;
function railTriggers(v){
  const out=[];
  for(const id of new Set([...Object.keys(state.ratings), ...state.watch, ...state.favs])){
    if(isHidden(id)) continue;
    const md=findMediaById(id); if(!md) continue;
    const r=getRating(id), st=getStatusOf(id), fav=isFav(id);
    let w=0, kind=null;
    if(r && r>=v.myMean+0.5){ w=0.4+Math.min(1,(r-v.myMean)/Math.max(1,RATING_MAX-v.myMean))*0.6; kind="rated"; }
    else if(!r && st==="watching"){ w=0.5; kind="watching"; }
    else if(!r && st==="completed"){ w=0.35; kind="finished"; }
    if(fav){ w=Math.max(w,0.6)+0.15; if(kind!=="rated") kind="fav"; }
    if(w>0) out.push({ id:String(id), md, w:Math.min(1,w), kind, rating:r });
  }
  return out.sort((a,b)=>b.w-a.w).slice(0,60);
}
function becauseRails(){
  if(!tasteReady()) return { ready:false, rails:[] };
  const v=tasteVectors();
  const stamp=`${v.stamp}:${pairsRev}:${state.recNo.size}:${state.watch.size}:${state.favs.size}:${state.hidden.size}:${state.status?Object.keys(state.status).length:0}`;
  if(railsCache && railsCache.stamp===stamp) return railsCache;
  const trig=railTriggers(v);
  const res=recommendations("all",{});
  const groups=new Map();
  for(const row of res.rows.slice(0,160)){
    let best=null;
    for(const t of trig){ const s=simScore(row.md,t.md)*t.w; if(!best||s>best.s) best={t,s}; }
    if(!best) continue;
    let g=groups.get(best.t.id);
    if(!g){ g={ trigger:best.t, picks:[] }; groups.set(best.t.id,g); }
    g.picks.push({ ...row, sim:best.s });
  }
  const rails=[...groups.values()].map(g=>{
    g.picks.sort((a,b)=>b.sim-a.sim || b.score-a.score);
    const top=g.picks.slice(0,3);
    g.strength=Math.round(top.reduce((s,p)=>s+p.sim,0)/top.length*(0.85+0.15*Math.min(1,g.picks.length/6))*1000)/1000;
    g.shown=g.strength>=RAIL_MIN_STRENGTH && g.picks.length>=RAIL_MIN_PICKS;
    return g;
  }).sort((a,b)=>b.strength-a.strength);
  railsCache={ stamp, ready:true, rails, attributed:rails.reduce((n,g)=>n+g.picks.length,0), pool:res.pool };
  return railsCache;
}
function railTitleHtml(t){
  const name=`<b>${esc(title(t.md))}</b>`;
  if(t.kind==="rated") return `Because you rated ${name} a ${esc(String(shownRating(t.id)))}`;
  if(t.kind==="watching") return `Because you're watching ${name}`;
  if(t.kind==="finished") return `Because you finished ${name}`;
  return `Because ${name} is one of your favourites`;
}
function railHtml(g, compact){
  const picks=g.picks.slice(0, compact?12:16);
  return `<section class="rail${compact?" compact":""}">
    <div class="rail-h"><h4>${railTitleHtml(g.trigger)}</h4>
      <span class="rail-s" title="How closely these picks resemble it, weighted by how much you liked it">${Math.round(g.strength*100)}% match${compact?"":` · ${g.picks.length} pick${g.picks.length===1?"":"s"}`}</span></div>
    <div class="rail-row">${picks.map(p=>`<button type="button" class="rail-card" data-peek="${esc(p.id)}" title="${esc(title(p.md))} — ${esc(simReason(g.trigger.md,p.md))}">
      <span class="rail-cover"><img src="${esc(coverOf(p.md))}" alt="" loading="lazy"><span class="rc-pred${p.conf<PRED_GOOD_CONF?" low":""}">${p.score}</span></span>
      <span class="rail-t">${esc(title(p.md))}</span></button>`).join("")}</div>
  </section>`;
}
function becauseHtml(){
  const r=becauseRails();
  const shown=r.rails.filter(g=>g.shown), weak=r.rails.length-shown.length;
  if(!shown.length) return `<div class="ev-loading">No reason is strong enough to build a row around yet. Rows appear when several picks closely resemble a show you rated highly, are watching or have favourited — rate a few more of the shows you loved and they fill in.</div>`;
  return shown.map(g=>railHtml(g,false)).join("")+
    `<p class="num-hint" style="margin-top:14px">Every one of the <b>${r.attributed}</b> top picks is filed under the show in your library it most resembles.
      ${weak?`<b>${weak}</b> row${weak===1?" was":"s were"} too weak to show — their picks only faintly resemble the show they'd be named after.`:""}</p>`;
}
let homeRailsStamp=null;
function paintHomeRails(){
  const host=$("homeRails"); if(!host) return;
  const off=localStorage.getItem("anical.homerails")==="0";
  if(off || !tasteReady()){ host.hidden=true; host.innerHTML=""; homeRailsStamp=null; return; }
  const r=becauseRails();
  if(homeRailsStamp===r.stamp+state.titleLang && host.innerHTML) return;   // unchanged — a keystroke in search shouldn't rebuild covers
  const shown=r.rails.filter(g=>g.shown).slice(0,2);
  homeRailsStamp=r.stamp+state.titleLang;
  host.hidden=!shown.length;
  host.innerHTML=shown.length?`${shown.map(g=>railHtml(g,true)).join("")}
    <div class="rails-foot"><button type="button" class="sr-link" data-view-go="recs" data-recmode-go="because">All rows in ✨ For you →</button>
    <button type="button" class="sr-link" data-homerails-off>Hide these</button></div>`:"";
}
document.addEventListener("click",e=>{
  if(e.target.closest("[data-homerails-off]")){
    try{ localStorage.setItem("anical.homerails","0"); }catch(_){}
    paintHomeRails();
    toast("Rows hidden from the calendar", ()=>{ try{ localStorage.removeItem("anical.homerails"); }catch(_){} homeRailsStamp=null; paintHomeRails(); });
    return;
  }
  const go=e.target.closest("[data-view-go]");
  if(go){ e.preventDefault(); if(go.dataset.recmodeGo) state.recMode=go.dataset.recmodeGo; setView(go.dataset.viewGo); }
});

/* ---------- hidden gems (Days 78–80) ----------
   High score, low popularity, in the genres you already like. The score floor is
   fixed; the popularity ceiling is the dial. Genres come from the taste profile
   when there is one, from what is on your board when there isn't, and from
   nothing at all — every genre, stated as such — when neither exists.

   THE DIAL IS LIVE. A lower ceiling is a strict subset of a higher one, so
   moving the dial filters what is already fetched instantly and only reaches
   AniList when that leaves too few to be worth showing. Dragging it back and
   forth costs no requests at all. */
const GEM_DIAL = [
  { max:1500,  label:"Deep cut",         hint:"under 1,500 AniList members" },
  { max:4000,  label:"Obscure",          hint:"under 4,000 members" },
  { max:10000, label:"Under the radar",  hint:"under 10,000 members" },
  { max:25000, label:"Cult following",   hint:"under 25,000 members" },
  { max:60000, label:"Known in circles", hint:"under 60,000 members" },
];
const GEM_SCORE_FLOOR = 75;
const GEMS_QUERY=`query($g:[String],$ceil:Int,$floor:Int){ Page(page:1, perPage:50){ media(type:ANIME, genre_in:$g, averageScore_greater:$floor,
  popularity_lesser:$ceil, isAdult:false, format_in:[TV,TV_SHORT,MOVIE,ONA,OVA], sort:[SCORE_DESC]){ ${CARD_FIELDS} } } }`;
const gemsFetched=new Map();
// AniList answers an empty list for genre_in containing Ecchi once isAdult:false is
// set — measured, not guessed — so one such genre on your board blanked the whole page.
const GEM_SKIP_GENRES = new Set(["Ecchi","Hentai"]);
let gemsTimer=null;
function gemGenres(){
  if(tasteReady()){
    const g=tasteDim("genre").filter(r=>r.lift>0&&!r.thin&&!GEM_SKIP_GENRES.has(String(r.value))).slice(0,4).map(r=>String(r.value));
    if(g.length) return { genres:g, from:"taste" };
  }
  const counts={};
  for(const id of state.watch){ const md=findMediaById(id); if(!md) continue; for(const g of md.genres||[]) if(!GEM_SKIP_GENRES.has(g)) counts[g]=(counts[g]||0)+1; }
  const g=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,4).map(x=>x[0]);
  return g.length ? { genres:g, from:"library" } : { genres:[], from:"none" };
}
const gemsKey = (genres, ceil) => genres.slice().sort().join(",")+"|"+ceil;
function fetchGems(genres, ceil){
  const k=gemsKey(genres,ceil);
  if(gemsFetched.has(k)) return;
  const rec={ loading:true, list:[] }; gemsFetched.set(k,rec);
  viaApi(`/gems?genres=${encodeURIComponent(genres.slice().sort().join(","))}&ceil=${ceil}`, GEMS_QUERY, { g:genres.length?genres:null, ceil, floor:GEM_SCORE_FLOOR-1 })
    .then(d=>{ rec.list=keepLight((d.Page&&d.Page.media)||[]); })
    .catch(e=>{ rec.err=e.message||"AniList didn't answer"; })
    .finally(()=>{ rec.loading=false; if(state.viewMode==="gems") paintGems(); });
}
function gemRows(genres, ceil){
  const prefix=genres.slice().sort().join(",")+"|", all=new Map();
  for(const [k,rec] of gemsFetched) if(k.startsWith(prefix)) for(const md of rec.list) all.set(String(md.id), md);
  const gset=new Set(genres);
  const ready=tasteReady();
  return [...all.values()].filter(md=>{
    const id=String(md.id);
    return (md.popularity||0)<ceil && (md.averageScore||0)>=GEM_SCORE_FLOOR && (!gset.size || (md.genres||[]).some(g=>gset.has(g)))
      && !inLibrary(id) && !state.recNo.has(id) && !excluded(md);
  }).map(md=>{ const p=ready?predictScore(String(md.id), md):null; return { md, p:predUsable(p)?p:null }; })
    .sort((a,b)=> (b.md.averageScore||0)-(a.md.averageScore||0) || ((b.p?b.p.score:0)-(a.p?a.p.score:0)) || (a.md.popularity||0)-(b.md.popularity||0));
}
function gemCardHtml({md,p}){
  const id=esc(String(md.id)), studio=((md.studios&&md.studios.nodes)||[])[0];
  const obscure=Math.max(4, Math.min(100, Math.round(100-Math.log10(Math.max(10,md.popularity||10))/Math.log10(60000)*100)));
  return `<article class="gem">
    <a class="gem-cover" href="${showHref(md.id)}" data-showpage="${id}">
      <img src="${esc(coverOf(md))}" alt="" loading="lazy">
      <span class="gem-score" title="AniList average">★ ${md.averageScore}</span>
      ${p?`<span class="rc-pred${p.conf<PRED_GOOD_CONF?" low":""}" title="Predicted for you · ${Math.round(p.conf*100)}% evidence">${p.score}</span>`:""}
    </a>
    <div class="gem-body">
      <a class="gem-t" href="${showHref(md.id)}" data-showpage="${id}">${esc(title(md))}</a>
      <div class="rc-meta">${[FMT_LABEL[md.format]||md.format, yearOfMedia(md)||"", md.episodes?`${md.episodes} ep`:"", studio&&studio.name].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="gem-genres">${(md.genres||[]).slice(0,3).map(g=>`<span>${esc(g)}</span>`).join("")}</div>
      <div class="gem-obscure" title="How obscure: ${compactNum(md.popularity)} AniList members"><i style="width:${obscure}%"></i><span>${compactNum(md.popularity)} members</span></div>
      <div class="rc-act">
        <button type="button" class="primary" data-gemadd="${id}">＋ Plan to watch</button>
        <button type="button" data-peek="${id}">Quick look</button>
        <button type="button" data-gemno="${id}" title="Never suggest it again">✕</button>
      </div>
    </div>
  </article>`;
}
function renderGems(){
  const wrap=enterDisco("gems");
  // Mid-drag, the slider must not be rebuilt out from under the pointer.
  if(wrap.querySelector("#gemsDial") && document.activeElement===$("gemsDial")){ paintGems(); return; }
  const {genres, from}=gemGenres();
  const dial=GEM_DIAL[state.gemsDial]||GEM_DIAL[2];
  wrap.innerHTML=`<div class="board-top">
      <div class="board-head"><h2>💎 Hidden gems</h2>
        <div class="ev-sub">Scored ${GEM_SCORE_FLOOR}+ on AniList by people who found them, and seen by almost nobody — ${
          from==="taste"?"inside the genres your ratings say you like":from==="library"?"inside the genres on your board":"across every genre, until you rate or track a few shows"}.</div></div>
    </div>
    <div class="gem-ctl">
      <label class="gem-dial"><span class="gem-dial-h">How obscure <b id="gemsDialLabel">${esc(dial.label)}</b> <i id="gemsDialHint">${esc(dial.hint)}</i></span>
        <input type="range" id="gemsDial" min="0" max="${GEM_DIAL.length-1}" step="1" value="${state.gemsDial}" aria-valuetext="${esc(dial.label)}">
        <span class="gem-ticks">${GEM_DIAL.map((d,i)=>`<span>${i===0?"deeper":i===GEM_DIAL.length-1?"wider":""}</span>`).join("")}</span></label>
      <div class="gem-gs">${genres.length?genres.map(g=>`<button type="button" class="chip${state.gemsOff.has(g)?"":" on"}" data-gemgenre="${esc(g)}" aria-pressed="${!state.gemsOff.has(g)}">${esc(g)}</button>`).join(""):`<span class="num-hint" style="margin:0">All genres</span>`}</div>
    </div>
    <div id="gemsResults"></div>
    <section class="gem-years"><h3>🗓 The best thing you've never heard of, by year</h3>
      <p class="num-hint" style="margin:0 0 10px">One pick per year under the same obscurity ceiling, any genre, nothing already in your library.</p>
      <div id="gemsYears"></div></section>`;
  const input=$("gemsDial");
  input.addEventListener("input",()=>{
    state.gemsDial=+input.value;
    try{ localStorage.setItem("anical.gemsdial", String(state.gemsDial)); }catch(_){}
    const d=GEM_DIAL[state.gemsDial];
    $("gemsDialLabel").textContent=d.label; $("gemsDialHint").textContent=d.hint; input.setAttribute("aria-valuetext", d.label);
    paintGems();
  });
  paintGems();
}
function paintGems(){
  const host=$("gemsResults"); if(!host) return;
  const {genres}=gemGenres();
  const active=genres.filter(g=>!state.gemsOff.has(g));
  const dial=GEM_DIAL[state.gemsDial]||GEM_DIAL[2];
  const rows=gemRows(active, dial.max);
  const rec=gemsFetched.get(gemsKey(active, dial.max));
  // Debounced: a dial swept end to end settles before anything is requested.
  if(!rec && rows.length<18){ clearTimeout(gemsTimer); gemsTimer=setTimeout(()=>fetchGems(active, dial.max), 350); }
  if(!rows.length){
    host.innerHTML = (!rec||rec.loading) ? skeletonCards(6)
      : rec.err ? `<div class="ev-loading">Couldn't reach AniList — ${esc(rec.err)}. <button type="button" data-gemsretry>↻ Retry</button></div>`
      : `<div class="ev-loading">Nothing scored ${GEM_SCORE_FLOOR}+ ${esc(dial.hint)} in ${active.length?esc(active.join(", ")):"any genre"} that isn't already yours. Turn the dial toward <b>wider</b>.</div>`;
  } else {
    host.innerHTML=`<p class="num-hint" style="margin:0 0 10px"><b>${rows.length}</b> gem${rows.length===1?"":"s"} ${esc(dial.hint)}${active.length?` in ${esc(active.join(", "))}`:""}${rec&&rec.loading?" · looking for more…":""}</p>
      <div class="gem-grid">${rows.slice(0,48).map(gemCardHtml).join("")}</div>`;
  }
  paintUnderseen(dial.max);
}
/* Day 80. One aliased request per half of the range: each alias is one year's
   best-scored shows under the ceiling, so "one per year" is exactly what comes
   back rather than something reconstructed from a single list that may happen
   to skip a year. Light fields only — sixteen years of covers is enough weight. */
const UNDERSEEN_YEARS = 16;
const underseenFetched=new Map();
function underseenQuery(years){
  return `query($floor:Int,$ceil:Int){ ${years.map(y=>`y${y}: Page(perPage:6){ media(type:ANIME, startDate_greater:${(y-1)*10000+1231}, startDate_lesser:${(y+1)*10000+101},
    averageScore_greater:$floor, popularity_lesser:$ceil, isAdult:false, format_in:[TV,MOVIE,ONA,OVA], sort:[SCORE_DESC]){
    id type title { romaji english native } format episodes averageScore popularity genres coverImage { medium large } seasonYear startDate { year month day } isAdult countryOfOrigin studios(isMain:true){ nodes{ id name } } } }`).join("\n")} }`;
}
function paintUnderseen(ceil){
  const host=$("gemsYears"); if(!host) return;
  const thisYear=new Date().getFullYear();
  const years=Array.from({length:UNDERSEEN_YEARS},(_,i)=>thisYear-i);
  let rec=underseenFetched.get(ceil);
  if(!rec){
    rec={ loading:true, byYear:{} }; underseenFetched.set(ceil, rec);
    const halves=[years.slice(0,UNDERSEEN_YEARS/2), years.slice(UNDERSEEN_YEARS/2)];
    (async()=>{
      const ours=await apiGet(`/underseen?ceil=${ceil}`,{timeout:15000});
      if(ours && ours.data){
        for(const y of years) rec.byYear[y]=keepLight((ours.data["y"+y]&&ours.data["y"+y].media)||[]);
        rec.loading=false;
        if(state.viewMode==="gems" && (GEM_DIAL[state.gemsDial]||{}).max===ceil) paintUnderseen(ceil);
        return;
      }
      for(const half of halves){
        try{
          const d=await anilist(underseenQuery(half),{ floor:77, ceil });
          for(const y of half) rec.byYear[y]=keepLight((d["y"+y]&&d["y"+y].media)||[]);
        }catch(e){ rec.err=e.message||"AniList didn't answer"; }
        if(state.viewMode==="gems" && (GEM_DIAL[state.gemsDial]||{}).max===ceil) paintUnderseen(ceil);
      }
      rec.loading=false;
      if(state.viewMode==="gems" && (GEM_DIAL[state.gemsDial]||{}).max===ceil) paintUnderseen(ceil);
    })();
  }
  const rowsHtml=years.map(y=>{
    const list=rec.byYear[y];
    if(!list) return rec.loading?`<div class="uy-row"><span class="uy-y">${y}</span><span class="skel skel-line"></span></div>`:"";
    const pick=list.find(md=>!inLibrary(md.id)&&!state.recNo.has(String(md.id))&&!excluded(md));
    if(!pick) return `<div class="uy-row none"><span class="uy-y">${y}</span><span class="shw-muted">${list.length?"Everything that cleared the bar is already in your library":"Nothing cleared the bar this year"}</span></div>`;
    return `<a class="uy-row" href="${showHref(pick.id)}" data-showpage="${esc(String(pick.id))}">
      <span class="uy-y">${y}</span><img src="${esc((pick.coverImage&&pick.coverImage.medium)||"")}" alt="" loading="lazy" width="34" height="48">
      <span class="uy-t"><b>${esc(title(pick))}</b><i>${esc([FMT_LABEL[pick.format]||pick.format, (pick.genres||[]).slice(0,2).join(", ")].filter(Boolean).join(" · "))}</i></span>
      <span class="uy-s">★ ${pick.averageScore}</span><span class="uy-p">${compactNum(pick.popularity)} members</span></a>`;
  }).join("");
  host.innerHTML=(rec.err&&!Object.keys(rec.byYear).length)?`<div class="ev-loading">Couldn't load the year list — ${esc(rec.err)}.</div>`:`<div class="uy">${rowsHtml}</div>`;
}
document.addEventListener("click",e=>{
  const g=e.target.closest("[data-gemgenre]");
  if(g){ const k=g.dataset.gemgenre; if(state.gemsOff.has(k)) state.gemsOff.delete(k); else state.gemsOff.add(k); renderGems(); return; }
  if(e.target.closest("[data-gemsretry]")){
    const {genres}=gemGenres(), active=genres.filter(x=>!state.gemsOff.has(x));
    gemsFetched.delete(gemsKey(active,(GEM_DIAL[state.gemsDial]||GEM_DIAL[2]).max)); paintGems(); return;
  }
  const add=e.target.closest("[data-gemadd]");
  if(add){
    e.preventDefault(); e.stopPropagation();
    const id=add.dataset.gemadd, md=anyMedia(id), name=md?title(md):"Show";
    setStatusOf(id,"plan");
    // The board resolves shows by id, and a gem is only a card-weight record.
    fetchMediaById(id).then(full=>{ if(full && !findMediaById(id)) state.full.set(String(full.id), full); }).catch(()=>{});
    renderView();
    toast(`📋 ${name} · Plan to Watch`, ()=>{ setStatusOf(id,null,{stamp:false}); renderView(); });
    return;
  }
  const no=e.target.closest("[data-gemno]");
  if(no){
    e.preventDefault(); e.stopPropagation();
    const id=no.dataset.gemno;
    dismissRec(id,"no"); renderView();
    toast("Won't suggest that again", ()=>{ undismissRec(id); renderView(); });
  }
});

/* ---------- random show (Day 81) ----------
   The dice used to pick from everything loaded that scored 70+, whatever was on
   screen — so with "Movies · Romance" set it could hand you a TV mecha show.
   Now the pool is exactly what the active filters let through (on the calendar,
   the episodes actually shown; elsewhere, the same filters applied per show),
   the well-reviewed half is only preferred when there are enough of them to be
   worth preferring, and the last pick is never served twice running. */
function randomPool(){
  if(["month","week","agenda"].includes(state.viewMode)){
    const m=new Map(); for(const ev of rangeEvents()) m.set(String(ev.media.id), ev.media);
    return [...m.values()];
  }
  const f=state.filters, ep=f.premieresOnly?1:Math.max(1, f.airedMin||1);
  return state.media.filter(md=>passFilter({ media:md, episode:ep }));
}
function surpriseMe(){
  const pool=randomPool();
  const filtered=activeFilters().length>0 || searchActive(state.searchQ);
  if(!pool.length){ toast(filtered?"Nothing matches your active filters — loosen one and roll again.":"Nothing loaded to pick from yet."); return; }
  let last=null; try{ last=localStorage.getItem("anical.lastrandom"); }catch(e){}
  const fresh=pool.length>1 ? pool.filter(md=>String(md.id)!==last) : pool;
  const good=fresh.filter(md=>(md.averageScore||0)>=70);
  const bag=good.length>=5 ? good : fresh;
  const pick=bag[Math.floor(Math.random()*bag.length)];
  try{ localStorage.setItem("anical.lastrandom", String(pick.id)); }catch(e){}
  openDetail(pick,(nextAir(pick)||{}).episode||1);
  toast(pool.length===1 ? "🎲 Only one show matches your filters" : `🎲 Picked from ${pool.length} shows${filtered?" matching your filters":""}`, ()=>surpriseMe(), "🎲 Again");
}

/* ---------- discovery streak (Day 82) ----------
   One new show a day, the same one all day. The pick is chosen once, written
   down with enough to draw it (title, cover, year) and not re-chosen when the
   pool changes under it — otherwise opening a different season would swap
   today's card, which is exactly "changes once per day" failing. A hash of the
   date picks from the top of your recommendations when there is a profile, and
   from the most recognisable unseen shows when there isn't.

   Accept puts it on Plan to Watch; skip only records that you saw it. Either
   answer counts toward the streak, because the habit is looking, not agreeing. */
const DISC_HIST_MAX = 400;
function saveDiscovery(){ try{ localStorage.setItem("anical.discovery", JSON.stringify(state.discovery)); }catch(e){} }
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
let discEmptyAt=null;   // the pool size that last produced no candidate — no point re-ranking it every paint
function todaysDiscovery(){
  const d=state.discovery, today=localDay();
  if(d.day===today && d.pick) return d.pick;
  const poolStamp=`${today}:${state.media.length}:${state.extra.size}:${ratingsRev}`;
  if(discEmptyAt===poolStamp) return null;
  const answered=new Set(d.hist.map(h=>String(h[1])));
  const ok=md=>{ const id=String(md.id); return !answered.has(id) && !inLibrary(id) && !state.recNo.has(id) && !excluded(md) && (md.averageScore||0)>=65 && md.status!=="NOT_YET_RELEASED"; };
  let cands=[];
  if(tasteReady()) cands=recommendations("all",{}).rows.filter(r=>ok(r.md)).slice(0,25).map(r=>({md:r.md, pred:r.score}));
  if(!cands.length) cands=feedPool().filter(ok).sort((a,b)=>(b.popularity||0)-(a.popularity||0)).slice(0,40).map(md=>({md}));
  if(!cands.length){ discEmptyAt=poolStamp; return null; }
  const {md,pred}=cands[hashStr(today)%cands.length];
  d.day=today;
  d.pick={ id:String(md.id), t:title(md), img:coverOf(md), fmt:md.format||"", year:yearOfMedia(md)||null, score:md.averageScore||null,
    genres:(md.genres||[]).slice(0,3), pred:pred||null };
  saveDiscovery();
  return d.pick;
}
function discoveryAnswer(){ const today=localDay(), h=state.discovery.hist.find(r=>r[0]===today); return h?h[2]:null; }
function discoveryStreak(){
  const days=new Set(state.discovery.hist.map(h=>h[0]));
  const d=new Date();
  if(!days.has(localDay(d))) d.setDate(d.getDate()-1);   // today not answered yet doesn't break yesterday's run
  let n=0; while(days.has(localDay(d))){ n++; d.setDate(d.getDate()-1); }
  return n;
}
function paintDiscovery(){
  const card=$("discCard"), host=$("discovery"); if(!card||!host) return;
  const pick=todaysDiscovery();
  if(!pick){ card.style.display="none"; return; }
  card.style.display="";
  const ans=discoveryAnswer(), streak=discoveryStreak();
  const flame=streak?`<span class="disc-streak" title="Days in a row you've answered">🔥 ${streak}-day streak</span>`:"";
  host.innerHTML=`<div class="disc${ans?" done":""}">
    <a class="disc-cover" href="${showHref(pick.id)}" data-showpage="${esc(pick.id)}">${pick.img?`<img src="${esc(pick.img)}" alt="" loading="lazy">`:""}${pick.pred?`<span class="rc-pred">${pick.pred}</span>`:""}</a>
    <div class="disc-b">
      <a class="disc-t" href="${showHref(pick.id)}" data-showpage="${esc(pick.id)}">${esc(pick.t)}</a>
      <div class="disc-m">${esc([FMT_LABEL[pick.fmt]||pick.fmt, pick.year, pick.score?`★ ${pick.score}`:""].filter(Boolean).join(" · "))}</div>
      ${pick.genres.length?`<div class="gem-genres">${pick.genres.map(g=>`<span>${esc(g)}</span>`).join("")}</div>`:""}
      ${ans
        ? `<div class="disc-ans">${ans==="accept"?"✓ On your Plan to Watch":"Skipped"} · a new pick tomorrow</div>`
        : `<div class="disc-acts"><button type="button" class="primary" data-disc="accept">＋ I'll try it</button><button type="button" data-disc="skip">Skip</button></div>`}
      ${flame}
    </div></div>`;
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-disc]"); if(!b) return;
  e.preventDefault();
  const d=state.discovery, today=localDay(), pick=d.pick;
  if(!pick || d.day!==today) return;
  const choice=b.dataset.disc, before=getStatusOf(pick.id)||null;
  d.hist=d.hist.filter(h=>h[0]!==today);
  d.hist.push([today, pick.id, choice]);
  if(d.hist.length>DISC_HIST_MAX) d.hist.splice(0, d.hist.length-DISC_HIST_MAX);
  saveDiscovery();
  if(choice==="accept"){
    setStatusOf(pick.id,"plan");
    if(!findMediaById(pick.id)) fetchMediaById(pick.id).then(full=>{ if(full&&!findMediaById(pick.id)) state.full.set(String(full.id), full); }).catch(()=>{});
    renderView();
  }
  paintDiscovery();
  toast(choice==="accept"?`📋 ${pick.t} · Plan to Watch`:`Skipped · ${pick.t}`, ()=>{
    d.hist=d.hist.filter(h=>h[0]!==today); saveDiscovery();
    if(choice==="accept"){ setStatusOf(pick.id, before, {stamp:false}); renderView(); }
    paintDiscovery();
  });
});

/* ---------- browse: tags, studios, staff (Days 83–85) ----------
   Three real indexes on their own route — ?view=browse&kind=tag|studio|staff —
   each opening onto a page of its own: a tag's ranked result set, a studio's
   whole catalogue ranked by score, a person's credits grouped by role. Before
   this, a tag was a dropdown filter over one season and a studio was a rail of
   ten covers inside a pop-up.

   Every page here is one AniList request per screenful, remembered for the
   session, with "load more" rather than an eager crawl. The tag list itself
   changes a few times a year, so it is cached for a week (and kept out of the
   settings backup, like the schedule cache). */
const BROWSE_SORTS = {
  popular:  { label:"Most popular", al:["POPULARITY_DESC"] },
  score:    { label:"Top rated",    al:["SCORE_DESC","POPULARITY_DESC"] },
  newest:   { label:"Newest",       al:["START_DATE_DESC"] },
  trending: { label:"Trending",     al:["TRENDING_DESC"] },
};
const TAG_CACHE_KEY = "anical.cache.tags";
const TAG_CACHE_MS = 7*24*3600*1000;
const TAG_COLLECTION_QUERY=`query{ MediaTagCollection{ name description category rank isAdult } }`;
const TAG_MEDIA_QUERY=`query($tag:String,$page:Int,$sort:[MediaSort],$adult:Boolean){ Page(page:$page, perPage:40){ pageInfo{ hasNextPage total }
  media(type:ANIME, tag:$tag, minimumTagRank:50, isAdult:$adult, sort:$sort){ ${CARD_FIELDS} } } }`;
const STUDIO_PAGE_QUERY=`query($id:Int,$search:String,$page:Int){ Studio(id:$id, search:$search){ id name isAnimationStudio favourites siteUrl
  media(isMain:true, sort:[SCORE_DESC,POPULARITY_DESC], page:$page, perPage:50){ pageInfo{ hasNextPage } nodes{ ${CARD_FIELDS} } } } }`;
const STUDIO_LIST_QUERY=`query($search:String){ Page(perPage:36){ studios(search:$search, sort:[SEARCH_MATCH]){ id name isAnimationStudio favourites } } }`;
const STUDIO_TOP_QUERY=`query{ Page(perPage:50){ studios(sort:[FAVOURITES_DESC]){ id name isAnimationStudio favourites } } }`;
const STAFF_LIST_QUERY=`query($search:String){ Page(perPage:30){ staff(search:$search, sort:[SEARCH_MATCH]){ id name{ full native } image{ medium } primaryOccupations favourites } } }`;
const STAFF_TOP_QUERY=`query{ Page(perPage:30){ staff(sort:[FAVOURITES_DESC]){ id name{ full native } image{ medium } primaryOccupations favourites } } }`;
const STAFF_PAGE_QUERY=`query($id:Int,$page:Int){ Staff(id:$id){ id name{ full native } image{ large } description(asHtml:false) primaryOccupations yearsActive homeTown favourites siteUrl
  staffMedia(type:ANIME, sort:[START_DATE_DESC], page:$page, perPage:50){ pageInfo{ hasNextPage } edges{ staffRole node{ ${CARD_FIELDS} } } }
  characterMedia(sort:[START_DATE_DESC], page:1, perPage:40){ edges{ characterRole characters{ name{ full } } node{ id type title{ romaji english native } format episodes averageScore popularity genres isAdult countryOfOrigin coverImage{ medium large } startDate{ year } seasonYear } } } } }`;

const browseStore=new Map();   // route key -> { loading, err, data }
function browseLoad(key, fetcher){
  let rec=browseStore.get(key);
  if(rec) return rec;
  rec={ loading:true }; browseStore.set(key, rec);
  fetcher().then(d=>{ rec.data=d; }).catch(e=>{ rec.err=(e&&e.message)||"AniList didn't answer"; })
    .finally(()=>{ rec.loading=false; if(state.viewMode==="browse") renderBrowse(); });
  return rec;
}
function browseStatus(rec, what){
  if(rec.loading) return skeletonCards(12);
  if(rec.err) return `<div class="ev-loading">Couldn't load ${esc(what)} — ${esc(rec.err)}. <button type="button" data-browseretry>↻ Retry</button></div>`;
  return "";
}
function browseCardHtml(md, extra){
  const id=String(md.id), mine=getRating(id);
  const p=!mine&&tasteReady()?predictScore(id, md):null;
  const badge=mine?`<span class="rc-pred mine" title="Your score">${esc(String(shownRating(id)))}</span>`
    : predUsable(p)?`<span class="rc-pred${p.conf<PRED_GOOD_CONF?" low":""}" title="Predicted for you · ${Math.round(p.conf*100)}% evidence">${p.score}</span>`:"";
  return `<a class="bcard${inLibrary(id)?" mine":""}" href="${showHref(id)}" data-showpage="${esc(id)}">
    <span class="bcard-cover"><img src="${esc(coverOf(md))}" alt="" loading="lazy">${md.averageScore?`<span class="bcard-score">★ ${md.averageScore}</span>`:""}${badge}</span>
    <span class="bcard-t">${esc(title(md))}</span>
    <span class="bcard-m">${[FMT_LABEL[md.format]||md.format, yearOfMedia(md)||"TBA", extra].filter(Boolean).map(esc).join(" · ")}</span>
  </a>`;
}
const browseVisible = md => md && (!md.type||md.type==="ANIME") && !excluded(md);
function browseTabsHtml(){
  const k=state.browse.kind;
  return `<div class="sk-tabs" role="tablist">${[["tag","🏷 Tags"],["studio","🎬 Studios"],["staff","🎙 Staff"]].map(([key,label])=>
    `<a class="sk-tab${k===key?" on":""}" role="tab" aria-selected="${k===key}" href="${browseHref(key)}" data-browse="${key}||">${label}</a>`).join("")}</div>`;
}
function renderBrowse(){
  const wrap=enterDisco("browse");
  const b=state.browse||{kind:"tag"};
  // A repaint while someone is typing in a filter box (results landing, say)
  // must hand the box back exactly as it was: value, caret and focus.
  const a=document.activeElement;
  const typing=(a && a.matches && a.matches("[data-browsefilter]") && wrap.contains(a)) ? { kind:a.dataset.browsefilter, value:a.value, pos:a.selectionStart } : null;
  let body, heading;
  if(b.kind==="studio"){ [heading,body]=(b.id||b.name)?studioPageHtml(b):studioIndexHtml(); }
  else if(b.kind==="staff"){ [heading,body]=b.id?staffPageHtml(b):staffIndexHtml(); }
  else { [heading,body]=b.name?tagPageHtml(b):tagIndexHtml(); }
  $("monthTitle").textContent=heading;
  if(heading && heading!=="Browse") document.title=`${heading} — Tsuzuki`;
  wrap.innerHTML=`<div class="br">${browseTabsHtml()}${body}</div>`;
  if(typing){
    const again=wrap.querySelector(`[data-browsefilter="${typing.kind}"]`);
    if(again){
      again.value=typing.value; again.focus();
      try{ again.setSelectionRange(typing.pos,typing.pos); }catch(_){}
      if(typing.kind==="tags" && typing.value) again.dispatchEvent(new Event("input",{bubbles:true}));
    }
  }
}
function browseMore(key, fetchPage){
  const rec=browseStore.get(key); if(!rec||!rec.data||rec.more) return;
  rec.more=true; renderBrowse();
  fetchPage(rec.data.page+1).then(d=>{ rec.data.items=rec.data.items.concat(d.items); rec.data.page++; rec.data.hasNext=d.hasNext; })
    .catch(e=>toast("Couldn't load more — "+((e&&e.message)||"AniList didn't answer")))
    .finally(()=>{ rec.more=false; if(state.viewMode==="browse") renderBrowse(); });
}
const moreBtn = rec => rec.data&&rec.data.hasNext ? `<div class="br-more"><button type="button" data-browsemore ${rec.more?"disabled":""}>${rec.more?"Loading…":"Load more"}</button></div>` : "";

// --- tags ---
async function loadTagCollection(){
  try{
    const c=JSON.parse(localStorage.getItem(TAG_CACHE_KEY)||"null");
    if(c && Array.isArray(c.tags) && Date.now()-c.at<TAG_CACHE_MS) return c.tags;
  }catch(e){}
  const tags=(await viaApi("/tags", TAG_COLLECTION_QUERY)).MediaTagCollection||[];
  try{ localStorage.setItem(TAG_CACHE_KEY, JSON.stringify({at:Date.now(), tags})); }catch(e){}
  return tags;
}
const tagCategory = t => String(t.category||"").replace(/Sci-Fi/g,"Sci‑Fi").split("-").map(x=>x.replace(/‑/g,"-").trim()).filter(Boolean);
function tagChipHtml(t, row){
  return `<a class="br-tag${row?row.lift>=0?" pos":" neg":""}" href="${browseHref("tag","",t.name)}" data-browse="tag||${esc(t.name)}"
    data-tagname="${esc(normText(t.name))}" title="${esc((t.description||"")+(row?` · you: ${row.lift>=0?"+":""}${row.lift.toFixed(2)} from ${row.n} shows`:""))}"${tagAffinityStyle(row)}>${esc(t.name)}</a>`;
}
function tagIndexHtml(){
  const rec=browseLoad("tags", loadTagCollection);
  const head=`<div class="board-head"><h2>🏷 Browse by tag</h2><div class="ev-sub">Every theme, setting and trope AniList tracks — each one opens every show that carries it, ranked.</div></div>`;
  if(!rec.data) return ["Browse tags", head+browseStatus(rec,"the tag list")];
  const aff=new Map(tasteDim("tag").map(r=>[r.value,r]));
  const tags=rec.data.filter(t=>t&&t.name&&!(t.isAdult&&state.hideNSFW));
  const groups=new Map();
  for(const t of tags){
    // AniList joins category levels with "-", and one level is itself "Sci-Fi".
    const cat=tagCategory(t);
    const top=cat[0]||"Other";
    if(!groups.has(top)) groups.set(top, new Map());
    const sub=cat.slice(1).join(" – ")||"General";
    const g=groups.get(top); if(!g.has(sub)) g.set(sub,[]); g.get(sub).push(t);
  }
  const yours=tasteDim("tag").filter(r=>r.lift>0&&!r.thin).slice(0,14).map(r=>tags.find(t=>t.name===r.value)).filter(Boolean);
  const order=["Theme","Setting","Cast","Demographic","Technical","Sexual Content","Other"];
  const tops=[...groups.keys()].sort((a,b)=>(order.indexOf(a)<0?99:order.indexOf(a))-(order.indexOf(b)<0?99:order.indexOf(b)));
  return ["Browse tags", head+`
    <div class="br-bar"><input type="search" class="br-filter" data-browsefilter="tags" placeholder="Filter ${tags.length} tags…" autocomplete="off"></div>
    ${yours.length?`<section class="br-group"><h3>Tags you rate highest</h3><div class="br-tags">${yours.map(t=>tagChipHtml(t, aff.get(t.name))).join("")}</div></section>`:""}
    ${tops.map(top=>`<section class="br-group" data-tgroup><h3>${esc(top)}</h3>${[...groups.get(top)].sort((a,b)=>a[0].localeCompare(b[0])).map(([sub,list])=>
      `<div class="br-subg" data-tgroup><div class="shw-sub">${esc(sub)}</div><div class="br-tags">${list.sort((a,b)=>a.name.localeCompare(b.name)).map(t=>tagChipHtml(t, aff.get(t.name))).join("")}</div></div>`).join("")}</section>`).join("")}
    <p class="br-none" hidden>No tag matches that.</p>`];
}
function tagPageHtml(b){
  const sort=BROWSE_SORTS[state.browseSort]?state.browseSort:"popular";
  const key=`tag|${b.name}|${sort}|${state.hideNSFW?1:0}`;
  const fetchPage=async page=>{
    const d=(await viaApi(`/tag?name=${encodeURIComponent(b.name)}&sort=${sort}&page=${page}${state.hideNSFW?"":"&adult=1"}`,
      TAG_MEDIA_QUERY, { tag:b.name, page, sort:BROWSE_SORTS[sort].al, adult:state.hideNSFW?false:null })).Page;
    return { items:keepLight(d.media||[]), hasNext:!!(d.pageInfo&&d.pageInfo.hasNextPage), total:d.pageInfo&&d.pageInfo.total };
  };
  const rec=browseLoad(key, async()=>({ page:1, ...(await fetchPage(1)) }));
  rec.fetchPage=fetchPage; state.browseKey=key;
  const meta=(browseStore.get("tags")&&browseStore.get("tags").data||[]).find(t=>t.name===b.name);
  if(!browseStore.get("tags")) browseLoad("tags", loadTagCollection);
  const row=tasteDim("tag").find(r=>r.value===b.name);
  const head=`<div class="board-head"><div class="br-crumb"><a href="${browseHref("tag")}" data-browse="tag||">Tags</a>${meta&&meta.category?` › ${esc(tagCategory(meta).join(" › "))}`:""}</div>
    <h2>${esc(b.name)}</h2>
    <div class="ev-sub">${meta&&meta.description?esc(meta.description):""}${row?` <span class="br-aff ${row.lift>=0?"pos":"neg"}">You rate it ${row.lift>=0?"+":""}${row.lift.toFixed(2)} against your average, across ${row.n} show${row.n===1?"":"s"}.</span>`:""}</div></div>`;
  const sorts=`<div class="br-sorts">${Object.entries(BROWSE_SORTS).map(([k,s])=>`<button type="button" class="chip${k===sort?" on":""}" data-browsesort="${k}" aria-pressed="${k===sort}">${s.label}</button>`).join("")}
    ${rec.data&&rec.data.total?`<span class="num-hint" style="margin:0;flex-basis:auto">${rec.data.total.toLocaleString()} shows</span>`:""}</div>`;
  if(!rec.data) return [b.name, head+sorts+browseStatus(rec,"that tag")];
  const items=rec.data.items.filter(browseVisible);
  return [b.name, head+sorts+(items.length?`<div class="bgrid">${items.map(md=>browseCardHtml(md)).join("")}</div>${moreBtn(rec)}`
    :`<div class="ev-loading">No anime carry this tag strongly enough to list${state.hideNSFW?" (adult titles are hidden)":""}.</div>`)];
}

// --- studios ---
function studioIndexHtml(){
  const q=state.browseQuery.studio||"";
  const rec=q ? browseLoad(`studios?${q}`, async()=>(await viaApi(`/studios?q=${encodeURIComponent(q)}`, STUDIO_LIST_QUERY, {search:q})).Page.studios||[])
              : browseLoad("studios-top", async()=>(await viaApi("/studios", STUDIO_TOP_QUERY)).Page.studios||[]);
  const head=`<div class="board-head"><h2>🎬 Browse by studio</h2><div class="ev-sub">Every studio's whole catalogue, ranked by score — with how you've rated their work alongside.</div></div>`;
  // From your own library first: the studios you have an opinion about are the ones worth a shortcut.
  const mine=new Map();
  for(const id of new Set([...state.watch, ...Object.keys(state.ratings)])){
    const md=findMediaById(id); if(!md) continue;
    for(const s of (md.studios&&md.studios.nodes)||[]) if(s&&s.name){ const e=mine.get(s.name)||{name:s.name, id:s.id||"", n:0}; e.n++; mine.set(s.name,e); }
  }
  const aff=new Map(tasteDim("studio").map(r=>[r.value,r]));
  const yours=[...mine.values()].sort((a,b)=>((aff.get(b.name)||{}).lift||0)-((aff.get(a.name)||{}).lift||0) || b.n-a.n).slice(0,18);
  const chip=s=>{ const row=aff.get(s.name);
    return `<a class="br-tag${row?row.lift>=0?" pos":" neg":""}" href="${browseHref("studio",s.id||"",s.id?"":s.name)}" data-browse="studio|${esc(String(s.id||""))}|${esc(s.name)}"${tagAffinityStyle(row)}
      title="${esc(`${s.n} in your library`+(row?` · you: ${row.lift>=0?"+":""}${row.lift.toFixed(2)}`:""))}">${esc(s.name)} <i>${s.n}</i></a>`; };
  const list=rec.data?rec.data.filter(s=>s&&(q||s.isAnimationStudio)):[];
  return ["Browse studios", head+`
    <div class="br-bar"><input type="search" class="br-filter" data-browsefilter="studio" value="${esc(q)}" placeholder="Search any studio — e.g. Kyoto Animation" autocomplete="off"></div>
    ${yours.length&&!q?`<section class="br-group"><h3>In your library</h3><div class="br-tags">${yours.map(chip).join("")}</div></section>`:""}
    <section class="br-group"><h3>${q?`Studios matching “${esc(q)}”`:"Most-favourited animation studios"}</h3>
    ${rec.data?(list.length?`<div class="br-list">${list.map(s=>`<a class="br-item" href="${browseHref("studio",s.id)}" data-browse="studio|${s.id}|${esc(s.name)}">
      <b>${esc(s.name)}</b><i>${s.isAnimationStudio?"Animation studio":"Producer"}${s.favourites?` · ♥ ${compactNum(s.favourites)}`:""}</i></a>`).join("")}</div>`:`<p class="shw-muted">No studio by that name.</p>`)
      :browseStatus(rec,"studios")}</section>`];
}
const studioIds=new Map();   // name route -> resolved studio id
function studioPageHtml(b){
  const key=`studio|${b.id||""}|${b.id?"":b.name}`;
  const rec_sid=studioIds.get(key)||{}; studioIds.set(key, rec_sid);
  const fetchPage=async page=>{
    // A studio reached by name (a season record never asked for studio ids) is
    // resolved to its id once, so every page after that is a cacheable read.
    if(!b.id && !rec_sid.id){
      const found=await viaApi(`/studios?q=${encodeURIComponent(b.name)}`, STUDIO_LIST_QUERY, {search:b.name}).catch(()=>null);
      const list=(found&&found.Page&&found.Page.studios)||[];
      const hit=list.find(x=>normText(x.name)===normText(b.name))||list[0];
      if(hit) rec_sid.id=String(hit.id);
    }
    const sid=b.id||rec_sid.id;
    const s=(sid ? await viaApi(`/studio/${encodeURIComponent(sid)}/catalog?page=${page}`, STUDIO_PAGE_QUERY, { id:+sid, page })
                 : await anilist(STUDIO_PAGE_QUERY,{ search:b.name, page })).Studio;
    if(!s) throw new Error("no such studio");
    return { studio:s, items:keepLight((s.media&&s.media.nodes)||[]), hasNext:!!(s.media&&s.media.pageInfo&&s.media.pageInfo.hasNextPage) };
  };
  const rec=browseLoad(key, async()=>({ page:1, ...(await fetchPage(1)) }));
  rec.fetchPage=fetchPage; state.browseKey=key;
  const name=(rec.data&&rec.data.studio.name)||b.name||"Studio";
  const crumb=`<div class="br-crumb"><a href="${browseHref("studio")}" data-browse="studio||">Studios</a></div>`;
  if(!rec.data) return [name, `<div class="board-head">${crumb}<h2>${esc(name)}</h2></div>`+browseStatus(rec,"that studio")];
  const s=rec.data.studio, sort=["score","newest","popular"].includes(state.studioSort)?state.studioSort:"score";
  const items=rec.data.items.filter(browseVisible).slice();
  // Ranked by score, with the unscored at the bottom rather than treated as zero —
  // an announced show has no score yet, not a bad one.
  const cmp={ score:(x,y)=>(y.averageScore||-1)-(x.averageScore||-1)||(y.popularity||0)-(x.popularity||0),
    newest:(x,y)=>(yearOfMedia(y)||9999)-(yearOfMedia(x)||9999), popular:(x,y)=>(y.popularity||0)-(x.popularity||0) }[sort];
  items.sort(cmp);
  const row=tasteDim("studio").find(r=>r.value===s.name);
  const ratedHere=items.filter(md=>getRating(md.id));
  const avg=ratedHere.length?ratedHere.reduce((n,md)=>n+getRating(md.id),0)/ratedHere.length:0;
  const scored=items.filter(md=>md.averageScore);
  const crowd=scored.length?Math.round(scored.reduce((n,md)=>n+md.averageScore,0)/scored.length):0;
  const head=`<div class="board-head">${crumb}<h2>${esc(s.name)}</h2>
    <div class="tz-sample">
      <span>${s.isAnimationStudio?"Animation studio":"Producer"}</span>
      ${s.favourites?`<span>♥ <b>${compactNum(s.favourites)}</b> favourites</span>`:""}
      <span><b>${items.length}${rec.data.hasNext?"+":""}</b> titles loaded</span>
      ${crowd?`<span>average ★ <b>${crowd}</b></span>`:""}
      ${ratedHere.length?`<span>you've rated <b>${ratedHere.length}</b>, averaging <b>${avg.toFixed(1)}</b>${row?` (${row.lift>=0?"+":""}${row.lift.toFixed(2)} vs your average)`:""}</span>`:""}
      ${s.siteUrl?`<a href="${esc(s.siteUrl)}" target="_blank" rel="noopener">AniList ↗</a>`:""}
    </div></div>`;
  const sorts=`<div class="br-sorts">${[["score","Ranked by score"],["newest","Newest"],["popular","Most popular"]].map(([k,l])=>
    `<button type="button" class="chip${k===sort?" on":""}" data-studiosort="${k}" aria-pressed="${k===sort}">${l}</button>`).join("")}</div>`;
  return [s.name, head+sorts+(items.length?`<div class="bgrid ranked">${items.map((md,i)=>`<div class="bgrid-r"><span class="bgrid-n">${sort==="score"&&md.averageScore?i+1:""}</span>${browseCardHtml(md)}</div>`).join("")}</div>${moreBtn(rec)}`
    :`<div class="ev-loading">AniList lists no anime for this studio as a main studio.</div>`)];
}

// --- staff ---
function roleGroup(role){
  const r=String(role||"").replace(/\s*\([^)]*\)/g,"").replace(/\s+/g," ").trim();
  if(/^(chief )?director$/i.test(r)||/^series director$/i.test(r)) return "Director";
  if(/assistant director/i.test(r)) return "Assistant director";
  if(/episode director|unit director/i.test(r)) return "Episode director";
  if(/storyboard/i.test(r)) return "Storyboard";
  if(/series composition/i.test(r)) return "Series composition";
  if(/script|screenplay|scenario/i.test(r)) return "Script";
  if(/original (creator|story|work|character)/i.test(r)) return "Original creator";
  if(/character design/i.test(r)) return "Character design";
  if(/chief animation director/i.test(r)) return "Chief animation director";
  if(/animation director/i.test(r)) return "Animation director";
  if(/key animation|in-between|2nd key|animator/i.test(r)) return "Animation";
  if(/theme song|insert song|lyrics|arrangement|vocal|performance/i.test(r)) return "Songs";
  if(/music|composer/i.test(r)) return "Music";
  if(/sound director|sound effects/i.test(r)) return "Sound";
  if(/art director|background|art design|color design/i.test(r)) return "Art";
  if(/producer/i.test(r)) return "Producer";
  if(/mechanical design|prop design|design/i.test(r)) return "Design";
  if(/photography|cg|3d|editing/i.test(r)) return "Photography & CG";
  return r||"Other";
}
const ROLE_ORDER=["Director","Original creator","Series composition","Script","Character design","Chief animation director","Music","Voice acting",
  "Storyboard","Episode director","Assistant director","Animation director","Design","Art","Sound","Photography & CG","Songs","Producer","Animation"];
function staffIndexHtml(){
  const q=state.browseQuery.staff||"";
  const rec=q ? browseLoad(`staff?${q}`, async()=>(await viaApi(`/staff?q=${encodeURIComponent(q)}`, STAFF_LIST_QUERY, {search:q})).Page.staff||[])
              : browseLoad("staff-top", async()=>(await viaApi("/staff", STAFF_TOP_QUERY)).Page.staff||[]);
  const person=s=>`<a class="shw-person" href="${browseHref("staff",s.id)}" data-browse="staff|${s.id}|${esc(s.name&&s.name.full||"")}">
    ${s.image&&s.image.medium?`<img src="${esc(s.image.medium)}" alt="" loading="lazy" width="36" height="36">`:`<span class="shw-ph">👤</span>`}
    <span><b>${esc(s.name&&s.name.full||"")}</b><i>${esc((s.primaryOccupations||[]).slice(0,2).join(", ")||(s.name&&s.name.native)||"")}</i></span></a>`;
  const seen=[...state.seenStaff.values()].slice(-18).reverse();
  return ["Browse staff", `<div class="board-head"><h2>🎙 Browse by staff</h2><div class="ev-sub">Directors, writers, composers and voice actors — every credit, grouped by what they did.</div></div>
    <div class="br-bar"><input type="search" class="br-filter" data-browsefilter="staff" value="${esc(q)}" placeholder="Search a director, writer or voice actor…" autocomplete="off"></div>
    ${seen.length&&!q?`<section class="br-group"><h3>From show pages you've opened</h3><div class="shw-people grid">${seen.map(person).join("")}</div></section>`:""}
    <section class="br-group"><h3>${q?`People matching “${esc(q)}”`:"Most-favourited on AniList"}</h3>
      ${rec.data?(rec.data.length?`<div class="shw-people grid">${rec.data.map(person).join("")}</div>`:`<p class="shw-muted">Nobody by that name.</p>`):browseStatus(rec,"staff")}</section>`];
}
function staffPageHtml(b){
  const key=`staff|${b.id}`;
  const fetchPage=async page=>{
    const s=(await viaApi(`/staff/${encodeURIComponent(b.id)}?page=${page}`, STAFF_PAGE_QUERY, { id:+b.id, page })).Staff;
    if(!s) throw new Error("no such person");
    const credits=((s.staffMedia&&s.staffMedia.edges)||[]).filter(e=>e&&e.node).map(e=>({ role:e.staffRole, md:e.node }));
    const voices=page===1?((s.characterMedia&&s.characterMedia.edges)||[]).filter(e=>e&&e.node&&e.node.type==="ANIME")
      .map(e=>({ role:"Voice acting", detail:((e.characters||[]).map(c=>c&&c.name&&c.name.full).filter(Boolean)[0])||"", md:e.node })):[];
    keepLight(credits.map(c=>c.md));
    return { staff:s, items:credits.concat(voices), hasNext:!!(s.staffMedia&&s.staffMedia.pageInfo&&s.staffMedia.pageInfo.hasNextPage) };
  };
  const rec=browseLoad(key, async()=>({ page:1, ...(await fetchPage(1)) }));
  rec.fetchPage=fetchPage; state.browseKey=key;
  const crumb=`<div class="br-crumb"><a href="${browseHref("staff")}" data-browse="staff||">Staff</a></div>`;
  const name=(rec.data&&rec.data.staff.name.full)||b.name||"Staff";
  if(!rec.data) return [name, `<div class="board-head">${crumb}<h2>${esc(name)}</h2></div>`+browseStatus(rec,"that person")];
  const s=rec.data.staff;
  state.seenStaff.set(String(s.id), { id:s.id, name:s.name, image:{medium:s.image&&s.image.large}, primaryOccupations:s.primaryOccupations });
  // Grouped by role, one card per show per group: a key animator credited on
  // six episodes of the same series is one entry, with the episodes kept in the tooltip.
  const groups=new Map();
  for(const c of rec.data.items){
    if(!browseVisible(c.md)) continue;
    const g=roleGroup(c.role);
    if(!groups.has(g)) groups.set(g,new Map());
    const m=groups.get(g), k=String(c.md.id);
    const e=m.get(k)||{ md:c.md, roles:[], detail:c.detail||"" };
    if(c.role && !e.roles.includes(c.role)) e.roles.push(c.role);
    m.set(k,e);
  }
  const names=[...groups.keys()].sort((a,b)=>{ const ia=ROLE_ORDER.indexOf(a), ib=ROLE_ORDER.indexOf(b); return (ia<0?50:ia)-(ib<0?50:ib) || groups.get(b).size-groups.get(a).size; });
  const desc=decodeEntities(String(s.description||"").replace(/~!.*?!~/gs,"").replace(/<[^>]+>/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/__|\*\*/g,"")).trim();
  const facts=[(s.primaryOccupations||[]).join(", "), s.yearsActive&&s.yearsActive.length?`active since ${s.yearsActive[0]}`:"", s.homeTown||"", s.favourites?`♥ ${compactNum(s.favourites)}`:""].filter(Boolean);
  const head=`<div class="br-person">
      ${s.image&&s.image.large?`<img src="${esc(s.image.large)}" alt="" width="120" height="170">`:""}
      <div class="board-head">${crumb}<h2>${esc(s.name.full)}${s.name.native?` <small class="mtitle-sub">${esc(s.name.native)}</small>`:""}</h2>
        <div class="tz-sample">${facts.map(f=>`<span>${esc(f)}</span>`).join("")}${s.siteUrl?`<a href="${esc(s.siteUrl)}" target="_blank" rel="noopener">AniList ↗</a>`:""}</div>
        ${desc?`<details class="br-bio"><summary>${esc(desc.slice(0,220))}${desc.length>220?"…":""}</summary>${desc.length>220?`<p>${esc(desc)}</p>`:""}</details>`:""}
      </div></div>`;
  const nav=names.length>3?`<div class="br-sorts">${names.map(n=>`<a class="chip" href="#role-${encodeURIComponent(n)}" data-rolejump="${esc(n)}">${esc(n)} <i>${groups.get(n).size}</i></a>`).join("")}</div>`:"";
  return [s.name.full, head+nav+(names.length?names.map(n=>{
    const list=[...groups.get(n).values()].sort((x,y)=>(yearOfMedia(y.md)||9999)-(yearOfMedia(x.md)||9999));
    return `<section class="br-group" id="role-${esc(encodeURIComponent(n))}"><h3>${esc(n)} <span class="shw-h-n">${list.length}</span></h3>
      <div class="bgrid">${list.map(e=>`<span class="bgrid-r" title="${esc(e.roles.join(" · "))}">${browseCardHtml(e.md, e.detail||(e.roles.length===1&&e.roles[0]!==n?e.roles[0].replace(/\s*\([^)]*\)/g,""):""))}</span>`).join("")}</div></section>`;
  }).join("")+moreBtn(rec):`<div class="ev-loading">No anime credits on AniList for ${esc(s.name.full)}.</div>`)];
}
let browseTimer=null;
document.addEventListener("input",e=>{
  const inp=e.target.closest("[data-browsefilter]"); if(!inp) return;
  const kind=inp.dataset.browsefilter;
  if(kind==="tags"){
    // Client-side over a list that is already on screen — no re-render, no request.
    const q=normText(inp.value), wrap=$("browseWrap");
    let any=false;
    wrap.querySelectorAll("[data-tagname]").forEach(a=>{ const on=!q||a.dataset.tagname.includes(q); a.hidden=!on; if(on) any=true; });
    wrap.querySelectorAll(".br-subg").forEach(g=>{ g.hidden=![...g.querySelectorAll("[data-tagname]")].some(a=>!a.hidden); });
    wrap.querySelectorAll("section.br-group").forEach(g=>{ g.hidden=![...g.querySelectorAll("[data-tagname]")].some(a=>!a.hidden); });
    const none=wrap.querySelector(".br-none"); if(none) none.hidden=any;
    return;
  }
  clearTimeout(browseTimer);
  browseTimer=setTimeout(()=>{
    state.browseQuery[kind]=inp.value.trim();
    renderBrowse();
  },380);
});
document.addEventListener("click",e=>{
  const s=e.target.closest("[data-browsesort]");
  if(s){ state.browseSort=s.dataset.browsesort; try{ localStorage.setItem("anical.browsesort", state.browseSort); }catch(_){} renderBrowse(); return; }
  const ss=e.target.closest("[data-studiosort]");
  if(ss){ state.studioSort=ss.dataset.studiosort; renderBrowse(); return; }
  if(e.target.closest("[data-browsemore]")){ const rec=browseStore.get(state.browseKey); if(rec&&rec.fetchPage) browseMore(state.browseKey, rec.fetchPage); return; }
  if(e.target.closest("[data-browseretry]")){
    for(const [k,rec] of browseStore) if(rec.err) browseStore.delete(k);
    renderBrowse(); return;
  }
  const rj=e.target.closest("[data-rolejump]");
  if(rj){ e.preventDefault(); const t=document.getElementById("role-"+encodeURIComponent(rj.dataset.rolejump)); if(t) t.scrollIntoView({behavior:"smooth", block:"start"}); }
});

/* ---------- main load ---------- */
function rangeTitle(){
  if(state.viewMode==="events") return "Anime Events";
  if(state.viewMode==="board") return "My Board";
  if(state.viewMode==="lists") return "My Lists";
  if(state.viewMode==="gems") return "Hidden Gems";
  if(state.viewMode==="browse") return "Browse";
  if(state.viewMode==="show"){ const r=state.showCache.get(String(state.showId)); return r?title(r.md):"Show"; }
  if(state.viewMode==="dashboard"){
    const a=state.anchor, sn=seasonOf(a.getMonth());
    return sn.charAt(0)+sn.slice(1).toLowerCase()+" "+a.getFullYear()+" · Dashboard";
  }
  if(state.viewMode==="month") return MONTHS[state.anchor.getMonth()]+" "+state.anchor.getFullYear();
  const {start,end}=visibleRange();
  return start.toLocaleDateString([], {month:"short",day:"numeric"})+" – "+end.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"});
}
async function load(){
  $("monthTitle").textContent=rangeTitle();
  if(state.viewMode==="events"){   // events view needs no AniList data
    renderView();
    setStatus(false,"Real-life anime events & showcases");
    return;
  }
  if(state.viewMode==="board"){   // board fetches only the shows you follow, not a date range
    renderView();
    setStatus(false,`Your board · ${state.watch.size} tracked show${state.watch.size===1?"":"s"}`);
    return;
  }
  if(state.viewMode==="lists"){   // same for your own collections
    renderView();
    setStatus(false, listsStatusText());
    return;
  }
  // The show, browse and gems pages fetch their own data. They still want a
  // loaded range underneath — it is what resolves your rated shows for the
  // predictions they draw — so one is pulled in the background if nothing is
  // loaded yet (a deep link), without making the page wait for it.
  if(state.viewMode==="show"||state.viewMode==="browse"||state.viewMode==="gems"){
    renderView();
    setStatus(false, state.viewMode==="show"?"Show page · AniList":state.viewMode==="gems"?"Hidden gems · AniList":"Browse · AniList");
    if(!state.media.length){
      const {start,end}=visibleRange();
      Promise.all([loadDataForRange(start,end), loadOverrides()]).then(([res])=>{
        if(state.media.length) return;
        state.media=res.media; persistMedia();
        if(["show","browse","gems"].includes(state.viewMode)) renderView();
      }).catch(()=>{});
    }
    return;
  }
  loadNews();
  setStatus(true,"Pulling latest releases from AniList…");
  try{
    const {start,end}=visibleRange();
    // Corrections load alongside the schedule — they change what every row
    // says, so the first paint should already have them.
    const [res]=await Promise.all([loadDataForRange(start,end), loadOverrides()]);
    state.media=res.media;
    showLoadWarning(res.partial ? "partial" : null);
    buildGenreOptions();
    buildStreamOptions();
    buildTagOptions();
    renderGenreChips();
    renderView();
    renderWhatsNew();
    if(!otdDone){ otdDone=true; loadOnThisDay(); }
    const total=rangeEvents().length;
    setStatus(false,`Live · ${state.media.length} titles · ${total} episodes shown · updated ${new Date().toLocaleTimeString([], timeOpts({hour:"numeric",minute:"2-digit"}))}`);
    persistMedia();   // cache for an instant paint on the next launch
    $("footer").innerHTML=`Data: <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a> + <a href="https://www.animenewsnetwork.com" target="_blank" rel="noopener">Anime News Network</a> · refreshed on every launch. Times in your local timezone. Desktop alerts fire only while Tsuzuki is open.`;
  }catch(err){
    console.error(err);
    useFallback();
    showLoadWarning("failed");
    setStatus(false,"⚠ Live fetch failed — showing offline sample data. Click Refresh to retry.");
    $("footer").textContent="Network/API unavailable. Showing a small embedded sample so the app still works offline.";
  }
}
// Visible banner when AniList data is incomplete (rate-limited) or unreachable,
// with a one-click Retry. kind: "partial" | "failed" | null (hide).
function showLoadWarning(kind){
  const el=$("loadWarn"); if(!el) return;
  if(!kind){ el.style.display="none"; el.innerHTML=""; return; }
  const msg = kind==="failed"
    ? "⚠ Couldn't reach AniList — showing sample data."
    : "⚠ Some releases couldn't load (AniList rate limit) — a few titles may be missing.";
  el.style.display="";
  el.innerHTML=`<span>${msg}</span><button id="loadWarnRetry">↻ Retry</button><button class="lw-x" id="loadWarnX" aria-label="Dismiss">✕</button>`;
  $("loadWarnRetry").onclick=()=>{ state.seasonCache.clear(); showLoadWarning(null); load(); };
  $("loadWarnX").onclick=()=>{ el.style.display="none"; };
}
function setStatus(loading,text){ document.body.classList.toggle("loading",loading); $("statusText").textContent=text; }

function buildGenreOptions(){
  const set=new Set();
  for(const md of state.media) for(const g of md.genres||[]) set.add(g);
  const sel=$("fGenre"), cur=state.filters.genre;
  sel.innerHTML='<option value="">All genres</option>'+[...set].sort().map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join("");
  sel.value=cur;
}
function renderGenreChips(){
  const box=$("genreChips"); if(!box) return;
  const counts={};
  for(const md of state.media){ if(excluded(md))continue; for(const g of md.genres||[]) counts[g]=(counts[g]||0)+1; }
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,12).map(e=>e[0]);
  const cur=state.filters.genre;
  box.innerHTML=top.map(g=>`<span class="chip ${cur===g?'on':''}" data-chip="${esc(g)}">${esc(g)}</span>`).join("");
}
function buildStreamOptions(){
  const counts={};
  for(const md of state.media){ if(excluded(md))continue; const seen=new Set();
    for(const l of md.externalLinks||[]) if(l&&l.type==="STREAMING"&&l.site&&!seen.has(l.site)){ seen.add(l.site); counts[l.site]=(counts[l.site]||0)+1; } }
  const sites=Object.entries(counts).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,15).map(e=>e[0]);
  const sel=$("fStream"), cur=state.filters.stream||"";
  sel.innerHTML='<option value="">All platforms</option>'+sites.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("");
  sel.value=cur;
}
// AniList "tags" are finer than genres (e.g. Time Travel, Female Protagonist).
// Offer the most common meaningful ones; skip spoiler tags and weak (<rank) associations.
const MIN_TAG_RANK=50;
function buildTagOptions(){
  const counts={};
  for(const md of state.media){ if(excluded(md))continue;
    for(const t of md.tags||[]){ if(!t||t.isMediaSpoiler||(t.rank||0)<MIN_TAG_RANK) continue;
      if(t.isAdult && state.hideNSFW) continue; counts[t.name]=(counts[t.name]||0)+1; } }
  const tags=Object.entries(counts).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,30).map(e=>e[0]).sort();
  const sel=$("fTag"), cur=state.filters.tag||"";
  sel.innerHTML='<option value="">All tags</option>'+tags.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
  sel.value=cur;
}

/* ---------- offline fallback ---------- */
function useFallback(){
  const v=state.anchor, y=v.getFullYear(), m=v.getMonth();
  const mk=(name,day,ep,score,fmt)=>({id:name,title:{romaji:name,english:name},format:fmt,episodes:12,genres:["Action"],
    status:"RELEASING",popularity:1,averageScore:score,siteUrl:"https://anilist.co",description:"Offline sample entry.",
    coverImage:{medium:"",large:"",color:"#ff4a2e"},startDate:{year:y,month:m+1,day},trailer:null,
    studios:{nodes:[]},airingSchedule:{nodes:[{airingAt:Math.floor(new Date(y,m,day,18,0).getTime()/1000),episode:ep}]}});
  state.media=[mk("Sample: A New Season Begins",3,1,82,"TV"),mk("Sample: Returning Hit S2",4,1,88,"TV"),
    mk("Sample: Ongoing Adventure",10,5,75,"TV"),mk("Sample: Weekend Movie",14,1,79,"MOVIE"),mk("Sample: Late-night ONA",21,3,71,"ONA")];
  buildGenreOptions(); renderView();
}

/* ---------- shareable URL state (view · date · filters) ---------- */
function sameDay(a,b){ return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
function fmtDateParam(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
// Build a querystring from the current view / anchor date / filters. Only
// non-default values are included so the plain home URL stays clean ("/").
function stateToParams(){
  const p=new URLSearchParams(), f=state.filters||{};
  if(state.viewMode && state.viewMode!=="month") p.set("view",state.viewMode);
  if(state.viewMode==="show" && state.showId) p.set("id", state.showId);
  if(state.viewMode==="browse"){
    const b=state.browse||{};
    p.set("kind", b.kind||"tag");
    if(b.id) p.set("id", b.id);
    else if(b.name) p.set("name", b.name);
  }
  if(!sameDay(state.anchor,new Date())) p.set("date",fmtDateParam(state.anchor));
  if(f.format) p.set("format",f.format);
  if(f.genre) p.set("genre",f.genre);
  if(f.stream) p.set("stream",f.stream);
  if(f.tag) p.set("tag",f.tag);
  if(f.minScore) p.set("score",String(f.minScore));
  if(f.premieresOnly) p.set("prem","1");
  if(f.mine) p.set("mine","1");
  if(f.epsMin) p.set("epsmin",String(f.epsMin));
  if(f.epsMax) p.set("epsmax",String(f.epsMax));
  if(f.airedMin) p.set("epmin",String(f.airedMin));
  if(f.airedMax) p.set("epmax",String(f.airedMax));
  // Only when it differs from the default raw+sub, so a shared link of a
  // dub-only calendar arrives as a dub-only calendar.
  const air=[...enabledTypes()].sort().join(",");
  if(air!=="raw,sub") p.set("air",air);
  return p;
}
// push=true adds a history entry (view/date changes → Back works); push=false
// replaces it (filter tweaks shouldn't flood history).
function syncURL(push){
  const qs=stateToParams().toString();
  const url=location.pathname+(qs?("?"+qs):"");
  if(push && url===location.pathname+location.search) push=false;   // re-selecting the same view isn't a step
  try{ history[push?"pushState":"replaceState"](null,"",url); if(push) state.navDepth++; }catch(_){}
}
// Reflect state into the toolbar controls (view segment + filter inputs).
function syncControlsFromState(){
  document.querySelectorAll("#viewSeg button").forEach(b=>b.classList.toggle("active",b.dataset.view===state.viewMode));
  const f=state.filters;
  if($("fFormat")) $("fFormat").value=f.format||"";
  if($("fGenre")) $("fGenre").value=f.genre||"";
  if($("fStream")) $("fStream").value=f.stream||"";
  if($("fTag")) $("fTag").value=f.tag||"";
  if($("fScore")) $("fScore").value=String(f.minScore||0);
  if($("fPrem")) $("fPrem").checked=!!f.premieresOnly;
  if($("fMine")) $("fMine").checked=!!f.mine;
  airBtnLabel();
}
// Apply URL params onto state. reset=true (popstate) restores any *absent* key
// to its default; reset=false (initial load) only applies keys that are present,
// so it can't wipe the mobile agenda default or the user's saved filters.
function applyParamsToState(params, reset){
  const qv=params.get("view");
  // Kept as an allowlist rather than accepting anything, so a crafted link can't
  // put the app in a state it has no renderer for — which means every new view
  // has to be added here as well as to renderView(). `taste` and `recs` were
  // linkable-looking and silently ignored until this line caught up with them.
  if(qv && ["month","week","agenda","dashboard","events","board","lists","taste","recs","gems","browse","show"].includes(qv)) state.viewMode=qv;
  else if(reset) state.viewMode="month";
  // The two routes that carry a subject. A show page without a usable id has
  // nothing to render, so it falls back to the calendar rather than a blank page.
  if(state.viewMode==="show"){
    const id=String(params.get("id")||"").replace(/\D/g,"");
    if(id) state.showId=id; else if(qv==="show") state.viewMode="month";
  }
  if(state.viewMode==="browse"){
    const k=params.get("kind");
    state.browse={ kind:["tag","studio","staff"].includes(k)?k:"tag",
      id:String(params.get("id")||"").replace(/\D/g,"")||null, name:(params.get("name")||"").slice(0,120)||null };
  }
  const qd=params.get("date");
  if(qd && /^\d{4}-\d{2}-\d{2}$/.test(qd)){ const d=new Date(qd+"T12:00:00"); if(!isNaN(d)) state.anchor=d; }
  else if(reset) state.anchor=new Date();
  const f=state.filters;
  if(params.has("format")) f.format=params.get("format"); else if(reset) f.format="";
  if(params.has("genre")) f.genre=params.get("genre"); else if(reset) f.genre="";
  if(params.has("stream")) f.stream=params.get("stream"); else if(reset) f.stream="";
  if(params.has("tag")) f.tag=params.get("tag"); else if(reset) f.tag="";
  if(params.has("score")) f.minScore=+params.get("score")||0; else if(reset) f.minScore=0;
  if(params.has("prem")) f.premieresOnly=params.get("prem")==="1"; else if(reset) f.premieresOnly=false;
  if(params.has("mine")) f.mine=params.get("mine")==="1"; else if(reset) f.mine=false;
  for(const [q,key] of [["epsmin","epsMin"],["epsmax","epsMax"],["epmin","airedMin"],["epmax","airedMax"]]){
    if(params.has(q)){ const n=Math.max(0,Math.min(9999,parseInt(params.get(q),10)||0)); if(n) f[key]=n; else delete f[key]; }
    else if(reset) delete f[key];
  }
  if(params.has("air")){
    const s=new Set(String(params.get("air")).split(",").filter(t=>AIR_TYPES.includes(t)));
    if(s.size) state.airTypes=s;
  } else if(reset) state.airTypes=new Set(["raw","sub"]);
  syncControlsFromState();
}
// Browser Back/Forward: restore the state that URL encodes and reload.
window.addEventListener("popstate",()=>{ state.navDepth=Math.max(0,state.navDepth-1); applyParamsToState(new URLSearchParams(location.search), true); load(); });

/* ---------- navigation ---------- */
function step(dir){
  if(["events","board","lists","show","browse","gems"].includes(state.viewMode)) return;   // no date paging in these views
  const a=state.anchor;
  if(state.viewMode==="dashboard") state.anchor=new Date(a.getFullYear(),a.getMonth()+3*dir,1);
  else if(state.viewMode==="month") state.anchor=new Date(a.getFullYear(),a.getMonth()+dir,1);
  else if(state.viewMode==="week") state.anchor=new Date(a.getFullYear(),a.getMonth(),a.getDate()+7*dir);
  else state.anchor=new Date(a.getFullYear(),a.getMonth(),a.getDate()+14*dir);
  syncURL(true); load();
}
function setView(mode){
  state.viewMode=mode;
  if(mode!=="show"&&mode!=="browse") localStorage.setItem("anical.view",mode);   // a route with a subject isn't a place to relaunch into
  document.querySelectorAll("#viewSeg button").forEach(b=>b.classList.toggle("active",b.dataset.view===mode));
  // Immediately, not via load(): density is per view (Day 28) and load() is
  // network-bound, so leaving this to the eventual renderView() lets the old
  // view's layout sit under the new view's name for as long as a fetch takes.
  applyDensity();
  syncURL(true); load();
}

/* ---------- wire up ---------- */
$("verline").textContent="Tsuzuki v"+APP_VERSION;
$("prev").onclick=()=>step(-1);
$("next").onclick=()=>step(1);
$("today").onclick=()=>{ state.anchor=new Date(); syncURL(true); load(); };
$("refresh").onclick=()=>{ state.seasonCache.clear(); state.eventsData=null; load(); };
$("modalClose").onclick=closeModal;
$("overlay").onclick=e=>{ if(e.target===$("overlay")) closeModal(); };
/* a11y: focus management + Tab trap for the dialog */
(function(){
  const ov=$("overlay"); let lastFocused=null;
  const focusables=()=>[...ov.querySelectorAll("button,a[href],input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter(el=>el.offsetParent!==null);
  new MutationObserver(()=>{
    if(ov.classList.contains("on")){
      if(document.activeElement && !ov.contains(document.activeElement)) lastFocused=document.activeElement;
      const f=focusables(); if(f.length) f[0].focus();
    } else if(lastFocused){ try{ lastFocused.focus(); }catch(e){} lastFocused=null; }
  }).observe(ov,{attributes:true,attributeFilter:["class"]});
  ov.addEventListener("keydown",e=>{
    if(e.key!=="Tab"||!ov.classList.contains("on")) return;
    const f=focusables(); if(!f.length) return;
    const first=f[0], last=f[f.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  });
})();
document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ closeModal(); bulkClear(); } });
document.querySelectorAll("#viewSeg button").forEach(b=>b.onclick=()=>setView(b.dataset.view));
$("embedLink").onclick=e=>{ e.preventDefault(); openEmbed(); };
$("subscribeLink").onclick=e=>{ e.preventDefault(); openSubscribe(); };
$("settingsBtn").onclick=()=>openSettings();
$("ttChip").onclick=()=>openSkins();
$("airBtn").onclick=()=>openAirPanel();
airBtnLabel();
// surpriseMe() lives with Day 81 in the Discovery block — it respects filters now.
$("surpriseBtn").onclick=surpriseMe;
if($("palBtn")){
  $("palBtn").onclick=()=>palOpen();
  const k=$("palBtn").querySelector("kbd"); if(k) k.textContent=IS_MAC?"⌘K":"Ctrl K";
}
if($("savedBtn")) $("savedBtn").onclick=()=>openSavedSearches();

/* Collapsed filter row. The badge counts only filters that are actually
   narrowing the list, so a hidden-but-active filter can never look inactive —
   that is the one real risk of putting controls behind a disclosure. It opens
   itself on load if anything is already set, for the same reason. */
function activeFilterCount(){
  let n=0;
  // "" is unset for the selects, but #fScore's "any" option is the STRING "0",
  // which is truthy — counting it made the badge read 1 on every load and
  // auto-opened the panel forever.
  for(const id of ["fFormat","fGenre","fStream","fTag","fScore"]){
    const el=$(id); if(el && el.value && el.value!=="0") n++;
  }
  for(const id of ["fMine","fPrem"]){ const el=$(id); if(el&&el.checked) n++; }
  return n;
}
function syncFilterCount(){
  const n=activeFilterCount(), c=$("fCount");
  if(c) c.textContent = n ? String(n) : "";
}
function setFiltersOpen(open){
  document.body.classList.toggle("filters-open", open);
  const b=$("filtersBtn");
  if(b){ b.classList.toggle("on", open); b.setAttribute("aria-expanded", String(open)); }
}
$("filtersBtn").onclick=()=>setFiltersOpen(!document.body.classList.contains("filters-open"));

/* Collapsible rail cards. Keyed by the card's own id where it has one and by
   position otherwise, so the saved state survives a card being hidden (several
   of them start display:none and only appear once there's something to show). */
(function railCollapse(){
  const KEY="anical.railClosed";
  let closed;
  try{ closed=new Set(JSON.parse(localStorage.getItem(KEY)||"[]")); }catch(_){ closed=new Set(); }
  const cards=[...document.querySelectorAll(".side .card")];
  cards.forEach((card,i)=>{
    const h=card.querySelector("h3"); if(!h) return;
    const key=card.id||("rail"+i);
    if(closed.has(key)) card.classList.add("collapsed");
    h.setAttribute("role","button");
    h.setAttribute("tabindex","0");
    h.setAttribute("aria-expanded", String(!card.classList.contains("collapsed")));
    h.addEventListener("click",()=>{
      const nowClosed=card.classList.toggle("collapsed");
      h.setAttribute("aria-expanded", String(!nowClosed));
      if(nowClosed) closed.add(key); else closed.delete(key);
      try{ localStorage.setItem(KEY, JSON.stringify([...closed])); }catch(_){}
    });
  });
})();
$("filtersBtn").closest(".toolbar").addEventListener("change", syncFilterCount);
syncFilterCount();
setFiltersOpen(activeFilterCount()>0);
// quick genre chips: toggle the genre filter
document.addEventListener("click",e=>{
  const c=e.target.closest("[data-chip]"); if(!c) return;
  const g=c.dataset.chip;
  state.filters.genre = (state.filters.genre===g) ? "" : g;
  const sel=$("fGenre"); if(sel) sel.value=state.filters.genre;
  localStorage.setItem("anical.filters",JSON.stringify(state.filters));
  syncURL(false);
  renderView(); renderGenreChips();
  setStatus(false,`Live · ${state.media.length} titles · ${rangeEvents().length} episodes shown`);
});
// appearance settings (delegated; controls live inside the settings modal)
document.addEventListener("click",e=>{
  const th=e.target.closest("[data-theme]"), de=e.target.closest("[data-density]"), ac=e.target.closest("[data-accent]");
  if(!th&&!de&&!ac) return;
  if(th){ state.theme=th.dataset.theme; localStorage.setItem("anical.theme",state.theme); }
  // Density is per view now (Day 28) — the global key is left exactly as it was,
  // so it goes on serving as the default for views nobody has set.
  if(de) setDensityFor(state.viewMode, de.dataset.density);
  if(ac){ state.accent=ac.dataset.accent; localStorage.setItem("anical.accent",state.accent); }
  applyAppearance(); renderView(); openSettings();   // re-render modal so the active states update
});
document.addEventListener("click",e=>{
  if(!e.target.closest("#denReset")) return;
  state.densityBy={};
  try{ localStorage.removeItem("anical.densityBy"); }catch(_){}
  applyAppearance(); renderView(); openSettings();
});
// copy a feed URL
document.addEventListener("click",e=>{
  const c=e.target.closest("[data-copyfeed]"); if(!c) return;
  e.preventDefault(); const u=c.dataset.copyfeed;
  const done=()=>{ c.textContent="✓ Copied"; setTimeout(()=>{ if(c.isConnected) c.textContent="📋 Copy URL"; },1500); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done).catch(()=>window.prompt("Copy this URL:",u));
  else window.prompt("Copy this URL:",u);
});

/* ---------- keyboard shortcuts ---------- */
function openShortcutsHelp(){
  $("modalTitle").textContent="⌨️ Keyboard shortcuts";
  const rows=[[IS_MAC?"⌘ K":"Ctrl K","Command palette — shows, places, actions"],
    ["/","Focus the search box"],["↑ / ↓","Move through search results"],["Enter","Open the highlighted result"],["Shift Enter","Open its full show page"],
    ["T","Jump to today"],["← / →","Previous / next period"],
    ["M","Month view"],["W","Week view"],["A","Agenda view"],["D","Dashboard"],["L","Lists"],["E","Events"],
    ["F","For you"],["G","Hidden gems"],["B","Browse tags, studios & staff"],["R","Random show (respects filters)"],
    ["Esc","Close dialog · clear search"],["?","Show this help"]];
  $("modalBody").innerHTML=`<div class="kb-grid">`+
    rows.map(([k,v])=>`<kbd>${esc(k)}</kbd><span>${esc(v)}</span>`).join("")+`</div>`;
  $("overlay").classList.add("on");
}
document.addEventListener("keydown",e=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const tag=(e.target&&e.target.tagName||"").toLowerCase();
  if(tag==="input"||tag==="textarea"||tag==="select"||(e.target&&e.target.isContentEditable)) return;
  if($("overlay").classList.contains("on")) return;   // a dialog is open; let its own Esc handle it
  if(pal.open) return;                                 // …and so is the palette
  switch(e.key){
    case "/": e.preventDefault(); $("fSearch").focus(); break;
    case "f": case "F": setView("recs"); break;
    case "g": case "G": setView("gems"); break;
    case "b": case "B": openBrowse(state.viewMode==="browse"?state.browse.kind:"tag"); break;
    case "r": case "R": surpriseMe(); break;
    case "t": case "T": $("today").click(); break;
    case "ArrowLeft": step(-1); break;
    case "ArrowRight": step(1); break;
    case "m": case "M": setView("month"); break;
    case "w": case "W": setView("week"); break;
    case "a": case "A": setView("agenda"); break;
    case "d": case "D": setView("dashboard"); break;
    case "l": case "L": setView("lists"); break;
    case "e": case "E": setView("events"); break;
    case "?": e.preventDefault(); openShortcutsHelp(); break;
  }
});

// Keyboard activation for our custom role="button" elements (calendar events,
// agenda/sidebar rows, cover thumbnails, star/bell/mark, trailer…). Enter or Space
// dispatches a click, which flows through all the delegated click handlers below.
// Native <button>/<a>/form controls are left to the browser's own handling.
document.addEventListener("keydown",e=>{
  if(e.key!=="Enter" && e.key!==" " && e.key!=="Spacebar") return;
  const el=e.target;
  if(!el || !el.getAttribute || el.getAttribute("role")!=="button") return;
  const tag=el.tagName;
  if(tag==="BUTTON"||tag==="A"||tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA") return;
  e.preventDefault();   // stop Space from scrolling the page
  el.click();
});

// bell delegation (covers modal, sidebar, agenda)
document.addEventListener("click",e=>{ const b=e.target.closest("[data-bell]"); if(b){ e.preventDefault(); e.stopPropagation(); toggleNotify(b.dataset.bell); } });
// event-reminder bell delegation (event cards + event modal)
document.addEventListener("click",e=>{ const b=e.target.closest("[data-evbell]"); if(b){ e.preventDefault(); e.stopPropagation(); toggleEventNotify(b.dataset.evbell); } });
// watchlist star delegation (modal + agenda + sidebars). Un-starring drops the
// show off the board and forgets its status, so it gets an Undo like every
// other destructive list action does.
document.addEventListener("click",e=>{
  const w=e.target.closest("[data-watch]"); if(!w) return;
  e.preventDefault(); e.stopPropagation();
  const id=w.dataset.watch, prev=getStatusOf(id), was=isWatched(id);
  toggleWatch(id);
  if(!was) return;                     // adding needs no apology
  const md=findMediaById(id), name=md?title(md):"Show";
  toast(`Removed from My List · ${name}`,
        ()=>{ toggleWatch(id); if(prev) setStatusOf(id, prev, {stamp:false}); renderView(); });
});
// one-click status delegation (detail pop-up · board cards · search results).
// Picking a status tracks the show; picking the one it already has removes it.
document.addEventListener("click",e=>{
  const chip=e.target.closest("[data-st]"); if(!chip) return;
  e.preventDefault(); e.stopPropagation();
  const parts=String(chip.dataset.st).split("|"), id=parts[0], key=parts[1];
  const prev=getStatusOf(id), next=(prev===key) ? "" : key;
  const md=findMediaById(id);
  // a show added straight from the search results isn't in the loaded seasons yet
  if(next && md && !state.media.some(x=>String(x.id)===String(id))) state.media.push(md);
  setStatusOf(id, next);
  const name=md?title(md):"Show";
  const after=()=>{
    renderView();   // moves the board card / re-applies the ⭐ My List filter
    if(state.viewMode==="board") setStatus(false,`Your board · ${state.watch.size} tracked show${state.watch.size===1?"":"s"}`);
    else if(state.viewMode==="lists") setStatus(false, listsStatusText());
  };
  toast(next ? `${statusLabel(next)} · ${name}` : `Removed from board · ${name}`,
        ()=>{ setStatusOf(id, prev, {stamp:false}); after(); });
  after();
});
// rating delegation: 1–10 chips in the detail pop-up; the active one clears it
document.addEventListener("click",e=>{
  const chip=e.target.closest("[data-rt]"); if(!chip) return;
  e.preventDefault(); e.stopPropagation();
  const parts=String(chip.dataset.rt).split("|"), id=parts[0], n=+parts[1];
  const prev=getRating(id), prevAxes=getAxes(id), next=(prev===n)?0:n;
  setRating(id, next);
  const md=findMediaById(id), name=md?title(md):"Show";
  toast(next?`⭐ ${next}/10 · ${name}`:`Rating cleared · ${name}`, ()=>{ restoreRating(id, prev, prevAxes); renderView(); });
  renderView();   // the score shows up on every card for this show
});
// rating axes: repaint on every frame of the drag, write once on release.
document.addEventListener("input",e=>{
  const sl=e.target.closest("[data-ax]"); if(!sl) return;
  const parts=String(sl.dataset.ax).split("|"), id=parts[0], key=parts[1];
  const v=cleanAxis(sl.value);
  sl.setAttribute("aria-valuetext", axisValueLabel(v));
  paintAxis(id, key, v);
  paintComposite(id, {...getAxes(id), [key]:v});   // what the score becomes if you let go now
});
document.addEventListener("change",e=>{
  const sl=e.target.closest("[data-ax]"); if(!sl) return;
  const parts=String(sl.dataset.ax).split("|");
  setAxis(parts[0], parts[1], sl.value);
  renderView();   // the score pill on every card for this show
});
// No Undo toast per drag, on purpose. A toast every time a slider is released
// would fire five times while somebody scores one show, and the thing it would
// protect — the previous position of one slider — is a drag away. The action
// that genuinely destroys work is a chip click flattening all five, and that
// one has had an Undo since Day 13.
/* Axis weights. Same drag/release split as the axes themselves, for a stronger
   reason: `change` here rewrites every score in the library, so doing it on
   `input` would sweep the whole thing once per pixel. */
document.addEventListener("input",e=>{
  const sl=e.target.closest("[data-wt]"); if(!sl) return;
  const v=cleanWeight(sl.value);
  sl.setAttribute("aria-valuetext", weightText(v));
  const lab=document.querySelector('[data-wtval="'+CSS.escape(sl.dataset.wt)+'"]');
  if(lab){ lab.textContent=weightText(v); lab.className="ax-val"+(v?"":" none"); }
});
document.addEventListener("change",e=>{
  const sl=e.target.closest("[data-wt]"); if(!sl) return;
  const n=setAxisWeight(sl.dataset.wt, sl.value);
  const note=$("wtNote");
  if(note) note.textContent = weightsAllOff()
    ? "Every axis is off — so all five are counting equally, because otherwise there would be no score at all."
    : weightsAreDefault() ? "All five count the same."
    : n ? `${n} score${n===1?"":"s"} recalculated.` : "No scores changed.";
  const reset=$("wtReset"); if(reset) reset.disabled=weightsAreDefault();
  renderView();   // every card's score pill, at once — the acceptance line
});
document.addEventListener("click",e=>{
  const b=e.target.closest("#wtReset"); if(!b) return;
  e.preventDefault();
  const n=resetAxisWeights();
  openSettings();   // rebuild so all five sliders show ×1
  const note=$("wtNote"); if(note) note.textContent=`Back to equal — ${n} score${n===1?"":"s"} restored.`;
  renderView();
});
/* Head to head (Day 19). One card is the winner and the other is the loser, so
   the pair travels in the dataset rather than being read back off the DOM —
   the panel repaints itself the moment this fires. */
document.addEventListener("click",e=>{
  const card=e.target.closest("[data-vs]"); if(!card) return;
  e.preventDefault(); e.stopPropagation();
  const parts=String(card.dataset.vs).split("|");
  versusAnswer(parts[0], parts[1]);
});
/* Answering with the keyboard is the difference between ten comparisons and a
   hundred. Bubble phase, and only while the panel is the thing on screen: the
   arrow keys belong to whatever else is open otherwise. */
document.addEventListener("keydown",e=>{
  if(!isVersusOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag=(e.target&&e.target.tagName||"").toLowerCase();
  if(tag==="input"||tag==="textarea"||tag==="select") return;
  const p=state._vsPair; if(!p) return;
  if(e.key==="ArrowLeft"){ e.preventDefault(); versusAnswer(p[0], p[1]); }
  else if(e.key==="ArrowRight"){ e.preventDefault(); versusAnswer(p[1], p[0]); }
  else if(e.key==="s"||e.key==="S"){ e.preventDefault(); versusSkip(); }
});
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-axtoggle]"); if(!t) return;
  e.preventDefault(); e.stopPropagation();
  const wrap=t.closest(".ax-wrap"); if(!wrap) return;
  const open=!wrap.classList.contains("open");
  wrap.classList.toggle("open", open);
  t.setAttribute("aria-expanded", open?"true":"false");
});
/* The sort builder (Day 29). Every control edits `state.sort` in place and
   repaints both the panel and the views behind it, so the effect of a key is
   visible while you are still building the sort rather than after you close it. */
function editSort(fn){
  const rows=activeSort().map(r=>({...r}));
  const out=fn(rows);
  state.sort=cleanSort(out||rows);
  saveSortState();
  if(isSortOpen()) renderSortBuilder();
  renderView();
}
document.addEventListener("change",e=>{
  const sel=e.target.closest("[data-sortkey]"); if(!sel) return;
  const i=+sel.dataset.sortkey, key=sel.value;
  editSort(rows=>{ if(rows[i]){ rows[i].key=key; rows[i].dir = SORT_BY_KEY[key].asc?"asc":"desc"; } });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-sortdir]"); if(!b) return;
  e.preventDefault();
  const i=+b.dataset.sortdir;
  editSort(rows=>{ if(rows[i]) rows[i].dir = rows[i].dir==="asc"?"desc":"asc"; });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-sortup]"); if(!b) return;
  e.preventDefault();
  const i=+b.dataset.sortup;
  editSort(rows=>{ if(i>0){ const t=rows[i-1]; rows[i-1]=rows[i]; rows[i]=t; } });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-sortdel]"); if(!b) return;
  e.preventDefault();
  const i=+b.dataset.sortdel;
  editSort(rows=>{ rows.splice(i,1); });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-sortapply]"); if(!b) return;
  e.preventDefault();
  if(applyNamedSort(b.dataset.sortapply)){ renderSortBuilder(); renderView(); }
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-sortforget]"); if(!b) return;
  e.preventDefault();
  const gone=deleteNamedSort(b.dataset.sortforget);
  if(!gone) return;
  renderSortBuilder();
  toast(`Deleted “${gone.rec.name}”`, ()=>{
    state.sorts.splice(Math.min(gone.index,state.sorts.length), 0, gone.rec);
    saveSortState(); renderSortBuilder();
  });
});
document.addEventListener("click",e=>{
  if(e.target.closest("[data-sortopen]")) openSortBuilder();
});
/* Retrain in place (Day 53). One handler, and it repaints whatever surface the
   chip was on — the acceptance line is "without a reload", so the pop-up, the
   recommendations behind it and every card badge all have to move together. */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-tadj]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const parts=String(b.dataset.tadj).split("|");
  const dim=parts[0], dir=+parts[parts.length-1];
  const value=parts.slice(1,-1).join("|");   // a tag can contain a pipe; the ends are known
  const before=tasteAdjOf(dim,value);
  const now=nudgeTaste(dim, value, dir);
  if(now===before){ toast(`That is as far as it goes`); return; }
  repaintPredictions();
  const label=TASTE_BY_KEY[dim] ? TASTE_BY_KEY[dim].label : dim;
  toast(`${label}: ${value} ${now>0?"+":""}${now||"back to what you rated"}`,
        ()=>{ if(before) state.tasteAdj[adjKey(dim,value)]=before; else clearTasteAdj(dim,value);
              saveTasteAdj(); repaintPredictions(); });
});
/* Everything that can be showing a prediction, refreshed in one call. The show
   pop-up is rebuilt only when it is the thing open, and only its prediction row
   — reopening the whole modal would throw away scroll position and focus, which
   is the lesson Day 07 already paid for. */
function repaintPredictions(){
  const row=document.querySelector(".pr-row");
  if(row){
    const idEl=document.querySelector("[data-note]");
    const md=idEl?findMediaById(idEl.dataset.note):null;
    if(md){ const tmp=document.createElement("div"); tmp.innerHTML=predictRowHtml(md);
            if(tmp.firstElementChild) row.replaceWith(tmp.firstElementChild); else row.remove(); }
  }
  if(state.viewMode==="recs") renderRecs();
  else if(state.viewMode==="taste") renderTaste();
  else renderView();          // card badges everywhere else
}
/* The feed. One handler for the five commitments and the skip; "Seen it" is the
   only one that does not advance, because it has a second question to ask. */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-feed]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const [id,kind]=String(b.dataset.feed).split("|");
  if(kind==="seen"){ state.feedAsk=id; renderRecs(); return; }
  const md=findMediaById(id), name=md?title(md):"That one";
  const before=feedAnswer(id, kind);
  feedServe(); renderRecs();
  const said={ watching:"▶️ Watching", plan:"📋 Plan to watch", dropped:"🗑️ Dropped",
               no:"🚫 Won't suggest it again", skip:"Skipped" }[kind];
  toast(`${said} · ${name}`, ()=>{ feedUndo(id, before); state.feedCard=md; state.feedAsk=null; renderRecs(); });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-feedscore]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const [id,key]=String(b.dataset.feedscore).split("|");
  const md=findMediaById(id), name=md?title(md):"That one";
  const s=FEED_SCORES.find(x=>x.key===key);
  const before=feedAnswer(id, "seen", s?s.score:0);
  feedServe(); renderRecs();
  toast(s?`✅ ${name} · ${s.score}/10`:`✅ Watched · ${name}`,
        ()=>{ feedUndo(id, before); state.feedCard=md; state.feedAsk=null; renderRecs(); });
});
document.addEventListener("click",e=>{
  if(!e.target.closest("[data-feedreset]")) return;
  e.preventDefault();
  const was=[...state.feedSkip];
  state.feedSkip=new Set(); saveFeedSkips(); feedServe(); renderRecs();
  toast(`Forgot ${was.length} skip${was.length===1?"":"s"}`,
        ()=>{ state.feedSkip=new Set(was); saveFeedSkips(); feedServe(); renderRecs(); });
});
/* Keyboard, because a feed you have to aim at is a feed you stop using. Only
   while it is the thing on screen and nothing else has focus. */
document.addEventListener("keydown",e=>{
  if(state.viewMode!=="recs" || state.recMode!=="feed" || !state.feedCard) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if($("overlay").classList.contains("on")) return;
  const tag=(e.target&&e.target.tagName||"").toLowerCase();
  if(tag==="input"||tag==="textarea"||tag==="select") return;
  const id=String(state.feedCard.id);
  const hit=({ "1":"seen", "2":"watching", "3":"plan", "4":"dropped", "5":"no",
               " ":"skip", "ArrowRight":"skip" })[e.key];
  if(!hit) return;
  e.preventDefault();
  const el=document.querySelector(`[data-feed="${CSS.escape(id)}|${hit}"]`);
  if(el) el.click();
});
/* Recommendations (Days 45–49, 54). */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-recmode]"); if(!t) return;
  state.recMode=t.dataset.recmode; renderRecs();
});
document.addEventListener("change",e=>{
  const g=e.target.closest("[data-recgenre]");
  if(g){ state.recGenre=g.value; renderRecs(); return; }
  const a=e.target.closest("[data-recairing]");
  if(a){ state.recAiring=a.checked; renderRecs(); }
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-recadd]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const id=b.dataset.recadd, md=findMediaById(id);
  setStatusOf(id,"plan");
  renderRecs();
  toast(`📋 ${md?title(md):"Added"} · Plan to Watch`, ()=>{ setStatusOf(id,null,{stamp:false}); renderRecs(); });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-recno]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const [id,why]=String(b.dataset.recno).split("|");
  const md=findMediaById(id);
  dismissRec(id, why);
  renderRecs();
  toast(why==="seen"?`Marked as already seen · ${md?title(md):""}`:`Won't suggest that again`,
        ()=>{ undismissRec(id); renderRecs(); });
});
document.addEventListener("click",e=>{
  if(!e.target.closest("[data-recreset]")) return;
  e.preventDefault();
  const was=[...state.recNo];
  state.recNo=new Set(); saveRecDismiss(); renderRecs();
  toast(`Restored ${was.length} dismissed pick${was.length===1?"":"s"}`,
        ()=>{ state.recNo=new Set(was); saveRecDismiss(); renderRecs(); });
});
/* Favourites, pins and the archive (Days 25–27). */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-fav]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const id=b.dataset.fav, on=toggleFav(id);
  const md=findMediaById(id), name=md?title(md):"Show";
  refreshLibraryRow(id); renderView();
  toast(on?`♥ ${name}`:`Removed from favourites · ${name}`,
        ()=>{ toggleFav(id); refreshLibraryRow(id); renderView(); });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-pin]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const id=b.dataset.pin, md=findMediaById(id), name=md?title(md):"Show";
  const r=togglePin(id);
  // A refusal has to say why, and say what to do about it. A button that just
  // fails to do anything reads as broken, which is the specific thing the
  // acceptance line is asking to be avoided.
  if(r==="full"){
    const first=findMediaById(state.pins[0]);
    toast(`${PIN_MAX} pins is the limit — unpin one first${first?` (oldest: ${title(first)})`:""}`);
    return;
  }
  refreshLibraryRow(id); renderView();
  toast(r?`📌 Pinned · ${name}`:`Unpinned · ${name}`,
        ()=>{ togglePin(id); refreshLibraryRow(id); renderView(); });
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-arch]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const id=b.dataset.arch, on=toggleArchived(id);
  const md=findMediaById(id), name=md?title(md):"Show";
  refreshLibraryRow(id); renderView();
  toast(on?`🗃 Archived · ${name} — nothing lost`:`Back on the board · ${name}`,
        ()=>{ toggleArchived(id); refreshLibraryRow(id); renderView(); });
});
document.addEventListener("click",e=>{
  if(!e.target.closest("[data-archtoggle]")) return;
  state.showArchived=!state.showArchived;
  renderView();
});
/* Note templates (Day 22): insert at the caret, never over the note. */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-notetpl]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  insertNoteTemplate($("noteBox"), b.dataset.notetpl);
});
/* Spoiler notes (Day 24). Marking is per note and immediate; the card mark and
   the notes index both read the same flag, so one click hides it everywhere. */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-notespoil]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const id=b.dataset.notespoil, on=!isSpoilerNote(id);
  setSpoilerNote(id, on);
  // Marking it while you are looking at it must not blur it under your cursor —
  // you are plainly allowed to see the note you just chose to hide.
  if(on) revealNote(id);
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", on?"true":"false");
  b.textContent = on ? "🙈 Spoiler" : "🙈 Mark spoiler";
  renderView();                       // the 📝 mark on every card stops carrying the text
  toast(on?"Note hidden as a spoiler":"Note no longer hidden");
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-notereveal]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const id=b.dataset.notereveal;
  revealNote(id);
  const wrap=document.querySelector('[data-notewrap="'+CSS.escape(String(id))+'"]');
  if(wrap) wrap.classList.remove("hid");
});
// …and in the notes index, where a row reveals in place rather than opening.
document.addEventListener("click",e=>{
  const row=e.target.closest("[data-noteopen]"); if(!row) return;
  const id=row.dataset.noteopen;
  if(isSpoilerNote(id) && !noteRevealed(id)){
    revealNote(id);
    $("noteResults").innerHTML=notesPanelHTML(state._noteQ);
    return;
  }
  const md=findMediaById(id);
  if(md) openDetail(md,1); else toast("That show isn't loaded right now");
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Enter" && e.key!==" ") return;
  const row=e.target.closest && e.target.closest("[data-noteopen]"); if(!row) return;
  e.preventDefault(); row.click();
});
// private notes: auto-save shortly after typing stops, with a live counter
document.addEventListener("input",e=>{
  const box=e.target.closest("[data-note]"); if(!box) return;
  const cnt=$("noteCount"); if(cnt) cnt.textContent=`${box.value.length} / ${NOTE_MAX}`;
  const label=$("noteState"); if(label) label.textContent="Saving…";
  notePending={id:box.dataset.note, el:box};
  clearTimeout(noteTimer);
  noteTimer=setTimeout(saveNoteNow,600);
});
// don't lose a note to a closed tab, a backgrounded PWA or a hard refresh
window.addEventListener("pagehide", saveNoteNow);
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") saveNoteNow(); });
/* ---------- custom collections: chips, columns, drag & drop ---------- */
// add/remove a show from a list (detail pop-up chips)
document.addEventListener("click",e=>{
  const chip=e.target.closest("[data-col]"); if(!chip) return;
  e.preventDefault(); e.stopPropagation();
  const parts=String(chip.dataset.col).split("|"), colId=parts[0], mid=parts[1];
  const col=collectionById(colId); if(!col) return;
  const added=toggleInCollection(colId, mid);
  const md=findMediaById(mid), name=md?title(md):"Show";
  refreshCollectionPickers(mid);
  toast(`${added?"Added to":"Removed from"} ${col.name} · ${name}`,
        ()=>{ toggleInCollection(colId, mid); refreshCollectionPickers(mid); if(state.viewMode==="lists") renderLists(); });
  if(state.viewMode==="lists") renderLists();
});
// make a new list — from the Lists view (no media id) or from a show's pop-up
document.addEventListener("click",e=>{
  const btn=e.target.closest("[data-col-new]"); if(!btn) return;
  e.preventDefault(); e.stopPropagation();
  const mid=btn.dataset.colNew||"";
  const name=window.prompt("Name your new list:", "");
  if(name===null) return;
  const col=createCollection(name);
  if(!col){ if(name.trim()==="") return; alert("That name can't be used."); return; }
  if(mid){ addToCollection(col.id, mid); refreshCollectionPickers(mid); }
  if(state.viewMode==="lists") renderLists();
  setStatus(false, state.viewMode==="lists" ? listsStatusText() : `Created list “${col.name}”`);
});
document.addEventListener("click",e=>{
  const btn=e.target.closest("[data-col-rename]"); if(!btn) return;
  e.preventDefault(); e.stopPropagation();
  const col=collectionById(btn.dataset.colRename); if(!col) return;
  const name=window.prompt("Rename list:", col.name);
  if(name===null) return;
  if(!renameCollection(col.id, name)) return;
  renderLists();
});
document.addEventListener("click",e=>{
  const btn=e.target.closest("[data-col-del]"); if(!btn) return;
  e.preventDefault(); e.stopPropagation();
  const removed=deleteCollection(btn.dataset.colDel); if(!removed) return;
  renderLists();
  // no confirm dialog — the Undo in the toast is faster and less annoying
  toast(`Deleted “${removed.col.name}” (${removed.col.ids.length} show${removed.col.ids.length===1?"":"s"})`,
        ()=>{ restoreCollection(removed.index, removed.col); renderLists(); });
});
document.addEventListener("click",e=>{
  const btn=e.target.closest("[data-col-move]"); if(!btn) return;
  e.preventDefault(); e.stopPropagation();
  const parts=String(btn.dataset.colMove).split("|");
  if(moveCollection(parts[0], +parts[1])) renderLists();
});
// per-card "Move to…" — the pointer-free equivalent of dragging
document.addEventListener("change",e=>{
  const sel=e.target.closest("[data-lmove]"); if(!sel) return;
  const parts=String(sel.dataset.lmove).split("|"), mid=parts[0], from=parts[1]||"";
  const to=sel.value;
  if(!moveBetweenCollections(mid, from, to)){ renderLists(); return; }
  const md=findMediaById(mid), name=md?title(md):"Show";
  const toCol=collectionById(to);
  renderLists();
  toast(`Moved to ${toCol?toCol.name:"Not in a list"} · ${name}`,
        ()=>{ moveBetweenCollections(mid, to, from); renderLists(); });
});
// drag & drop between columns (mouse/trackpad; touch uses the picker above)
let listDrag=null;
document.addEventListener("dragstart",e=>{
  const card=e.target.closest("[data-lcard]"); if(!card) return;
  listDrag={mid:card.dataset.lcard, from:card.dataset.lfrom||""};
  card.classList.add("dragging");
  if(e.dataTransfer){ e.dataTransfer.effectAllowed="move"; try{ e.dataTransfer.setData("text/plain", card.dataset.lcard); }catch(_){} }
});
document.addEventListener("dragend",()=>{
  listDrag=null;
  document.querySelectorAll(".board-card.dragging").forEach(el=>el.classList.remove("dragging"));
  document.querySelectorAll(".board-col.drop-on").forEach(el=>el.classList.remove("drop-on"));
});
document.addEventListener("dragover",e=>{
  if(!listDrag) return;
  const col=e.target.closest("[data-ldrop]"); if(!col) return;
  e.preventDefault();
  if(e.dataTransfer) e.dataTransfer.dropEffect="move";
  if(col.dataset.ldrop!==listDrag.from) col.classList.add("drop-on");
});
document.addEventListener("dragleave",e=>{
  const col=e.target.closest("[data-ldrop]");
  if(col && !col.contains(e.relatedTarget)) col.classList.remove("drop-on");
});
document.addEventListener("drop",e=>{
  if(!listDrag) return;
  const col=e.target.closest("[data-ldrop]"); if(!col) return;
  e.preventDefault();
  const {mid, from}=listDrag, to=col.dataset.ldrop||"";
  listDrag=null;
  if(!moveBetweenCollections(mid, from, to)){ renderLists(); return; }
  const md=findMediaById(mid), name=md?title(md):"Show", toCol=collectionById(to);
  renderLists();
  toast(`Moved to ${toCol?toCol.name:"Not in a list"} · ${name}`,
        ()=>{ moveBetweenCollections(mid, to, from); renderLists(); });
});
// board / list card delegation: open the show detail (but not when using a control on the card)
document.addEventListener("click",e=>{
  if(e.target.closest("select,button,[data-st],[data-rt]")) return;
  const c=e.target.closest("[data-openshow]"); if(!c) return;
  const md=findMediaById(c.dataset.openshow); if(md) openDetail(md,(nextAir(md)||{}).episode||1);
});
// "＋ Add anime" (board) → the search box is where shows come from
document.addEventListener("click",e=>{ if(e.target.closest("[data-focus-search]")) focusSearch(); });
// mark-watched delegation (detail-modal schedule). Click an episode = watched up to here; click again = unwatch from here.
document.addEventListener("click",e=>{
  const m=e.target.closest("[data-mark]"); if(!m) return; e.preventDefault(); e.stopPropagation();
  const parts=m.dataset.mark.split("|"), id=parts[0], ep=+parts[1], cur=getProgress(id);
  setProgress(id, ep<=cur ? ep-1 : ep);
  refreshProgressUI(id);
});
/* The counter's own buttons (Overview tab). Every one of them lands in
   setProgress, which is what keeps the AniList queue and the episode ceiling
   from having a second, subtly different implementation here. */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-prog]"); if(!b||b.disabled) return;
  e.preventDefault(); e.stopPropagation();
  const [id,op]=b.dataset.prog.split("|");
  const md=findMediaById(id), before=getProgress(id);
  let next=before;
  if(op==="inc") next=before+1;
  else if(op==="dec") next=before-1;
  else if(op==="max") next=Math.max(before, maxAiredEp(md||{}));   // the latest *aired* episode, not the last one announced
  else if(op==="zero") next=0;
  if(next===before) return;
  setProgress(id,next);
  refreshProgressUI(id, `[data-prog="${CSS.escape(b.dataset.prog)}"]`);
  // Clearing a show's progress is the one move here that throws work away.
  // Toasted after the repaint: the repaint can raise a toast of its own.
  if(op==="zero") toast(`Progress cleared · ${md?title(md):"Show"}`, ()=>{ setProgress(id,before); refreshProgressUI(id); });
});
/* The same counter, typed. The buttons above move one episode at a time, which
   is the wrong tool for "I got through eight of these on a plane" — this is the
   number itself, editable in place. It lands in the same setProgress, so the
   episode ceiling and the AniList queue are not reimplemented here either.
   Going *backwards* throws watched episodes away, so it gets an Undo, exactly
   like Reset does. */
function commitProgInput(inp){
  const id=String(inp.dataset.prognum||""), before=getProgress(id), md=findMediaById(id);
  const raw=String(inp.value).trim();
  const typed=raw===""?0:parseInt(raw,10);
  // Anything that isn't a whole number ≥ 0 reverts. Reading "e" or "-3" as
  // "clear this show's progress" is the one interpretation nobody wants.
  setProgress(id, (Number.isFinite(typed)&&typed>=0) ? typed : before);
  const after=getProgress(id);
  if(after===before){ inp.value=String(before); return; }   // unchanged, or clamped straight back
  refreshProgressUI(id, `[data-prognum="${CSS.escape(id)}"]`);
  if(after<before) toast(after?`Watched up to ep ${after} · ${md?title(md):"Show"}`:`Progress cleared · ${md?title(md):"Show"}`,
        ()=>{ setProgress(id,before); refreshProgressUI(id); });
}
document.addEventListener("change",e=>{
  const inp=e.target.closest&&e.target.closest("[data-prognum]"); if(!inp) return;
  commitProgInput(inp);
});
/* Enter commits without waiting for a blur; Escape abandons the edit and leaves
   the show open. Registered in the CAPTURE phase deliberately: the modal's own
   "Escape closes everything" listener sits on document too and is registered
   further up this file, so a bubble-phase stopPropagation here would run after
   it had already closed the show. Capture runs first regardless of order. */
document.addEventListener("keydown",e=>{
  const inp=e.target.closest&&e.target.closest("[data-prognum]"); if(!inp) return;
  if(e.key==="Enter"){ e.preventDefault(); e.stopPropagation(); commitProgInput(inp); }
  else if(e.key==="Escape"){ e.stopPropagation(); inp.value=String(getProgress(inp.dataset.prognum)); inp.blur(); }
}, true);
// started / finished dates: a correction to what the status change stamped.
document.addEventListener("change",e=>{
  const inp=e.target.closest&&e.target.closest("[data-date]"); if(!inp) return;
  const [id,which]=String(inp.dataset.date).split("|");
  const before=getDates(id);
  setDate(id, which, inp.value);
  const md=findMediaById(id), name=md?title(md):"Show", label=which==="end"?"Finished":"Started";
  toast(inp.value?`${label} ${inp.value} · ${name}`:`${label} date cleared · ${name}`,
        ()=>{ writeDates(id, before); refreshStatusPickers(id); });
});
// auto-progress opt-in (Day 08). Off freezes the counter; it never rewinds it.
document.addEventListener("change",e=>{
  const c=e.target.closest("[data-autoprog]"); if(!c) return;
  const id=c.dataset.autoprog, md=findMediaById(id), name=md?title(md):"Show";
  setAutoProg(id,c.checked);
  refreshProgressUI(id);
  toast(c.checked ? `Marking episodes as they air · ${name}` : `Auto-marking off · ${name}`);
});
/* Repaint everything progress touches: the counter row and the schedule ticks
   in the open pop-up, then the views behind it (cards, Continue Watching).
   In place rather than a full openDetail() — that rebuilt the modal and threw
   away scroll position and focus on every single +1. */
function refreshProgressUI(id, focusSel){
  const md=findMediaById(id);
  if(md && String(state._modalId)===String(id)){
    const row=document.querySelector(".pg-row");
    if(row){
      const tmp=document.createElement("div"); tmp.innerHTML=progressRowHtml(md);
      const fresh=tmp.firstElementChild;
      if(fresh){
        row.replaceWith(fresh);
        // Keep the keyboard where it was — unless the click just disabled the
        // button it was on ("caught up" twice), in which case let it go.
        const again=focusSel&&fresh.querySelector(focusSel);
        if(again && !again.disabled){ again.focus(); if(again.select) again.select(); }
      }
    }
    const panel=$("mpanel-schedule");
    if(panel){
      const keep=panel.querySelector(".sched-scroll");
      const top=keep?keep.scrollTop:0;
      panel.innerHTML=renderScheduleList(md);
      const back=panel.querySelector(".sched-scroll");
      if(back) back.scrollTop=top;
    }
  }
  renderView();   // board/list bars and the Continue Watching rail
}

// hide / "not interested": toggle and refresh. Hiding takes a show out of every
// view at once, and the modal it was hidden from closes with it — an Undo is
// the only way back that doesn't involve hunting through settings.
document.addEventListener("click",e=>{
  const h=e.target.closest("[data-hide]"); if(!h) return;
  e.preventDefault(); e.stopPropagation();
  const id=h.dataset.hide, wasHidden=state.hidden.has(String(id));
  toggleHidden(id); closeModal(); renderView();
  const md=findMediaById(id), name=md?title(md):"Show";
  toast(wasHidden ? `Unhidden · ${name}` : `Hidden · ${name}`,
        ()=>{ toggleHidden(id); renderView(); });
});

// share: copy a deep link (?show=<id>) to the clipboard
document.addEventListener("click",e=>{
  const s=e.target.closest("[data-share]"); if(!s) return;
  e.preventDefault(); e.stopPropagation();
  const link=location.origin+location.pathname+"?show="+encodeURIComponent(s.dataset.share);
  const done=()=>{ const o=s.textContent; s.textContent="✓ Link copied"; setTimeout(()=>{ if(s.isConnected) s.textContent=o; },1600); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done).catch(()=>window.prompt("Copy this link:",link));
  else window.prompt("Copy this link:",link);
});

// the "you're showing dubs only" empty-state link opens the air-type panel
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-open-air]"); if(!a) return;
  e.preventDefault(); e.stopPropagation();
  openAirPanel();
});

// "this time is wrong": open the report form for the show in the modal
document.addEventListener("click",e=>{
  const r=e.target.closest("[data-report]"); if(!r) return;
  e.preventDefault(); e.stopPropagation();
  const md=findMediaById(r.dataset.report); if(md) openReport(md,null);
});

// "It's out now" — a measurement, not a complaint. The offset is computed on
// the server from its own clock and the known broadcast time; all this sends is
// the show, the episode, the release type and (where we know it) the region, so
// recording and rendering agree for someone who has set one by hand. No region
// means the server falls back to its edge geo, which is right far more often
// than a browser guess.
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-released]"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  if(b.disabled) return;
  const [mediaId,episode,airType]=b.dataset.released.split("|");
  const original=b.textContent;
  b.disabled=true; b.textContent="Sending…";
  try{
    const res=await fetch("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({kind:"released",mediaId,episode:+episode,airType,region:userRegion()||undefined})});
    const j=await res.json().catch(()=>({}));
    if(res.ok&&j.ok){
      b.textContent="✓ Thanks — recorded";
      b.title="Recorded"+(j.region?" for "+j.region:"")+". Once three people agree, the estimate becomes a measured time.";
    }else{
      // Say which guard rejected it. "Failed" teaches nobody anything, and the
      // usual cause is a real one: tapping long after the episode landed.
      b.disabled=false; b.textContent=original;
      b.title=(j&&j.error)?j.error:"Could not record that right now — try again later.";
      toast((j&&j.error)||"Could not record that right now.");
    }
  }catch(err){
    b.disabled=false; b.textContent=original;
    toast("Could not reach the server — check your connection.");
  }
});

// related-anime navigation: open the clicked relation in the detail modal
document.addEventListener("click",e=>{
  const r=e.target.closest("[data-rel]"); if(!r) return;
  e.preventDefault(); e.stopPropagation();
  openShowById(r.dataset.rel);
});
// recommendation thumbnails open that show
document.addEventListener("click",e=>{ const r=e.target.closest("[data-rec]"); if(r){ e.preventDefault(); e.stopPropagation(); openShowById(r.dataset.rec); } });

// inline trailer: swap the facade for the real player on click
document.addEventListener("click",e=>{
  const t=e.target.closest(".trailer[data-embed]"); if(!t) return;
  const src=t.dataset.embed; const sep=src.includes("?")?"&":"?";
  t.classList.add("playing"); t.removeAttribute("data-embed");
  t.innerHTML=`<iframe src="${esc(src)}${sep}autoplay=1&rel=0" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
});

// add-to-calendar delegation (Google Calendar link / .ics download)
document.addEventListener("click",e=>{
  const btn=e.target.closest(".calbtn"); if(!btn) return;
  const host=btn.closest("[data-cal]"); if(!host) return;
  e.preventDefault(); e.stopPropagation();
  let opts; try{ opts=JSON.parse(host.dataset.cal); }catch(_){ return; }
  const cd=calDataFromOpts(opts); if(!cd) return;
  if(btn.dataset.go==="gcal") window.open(gcalUrl(cd),"_blank","noopener");
  else downloadFile(slugFile(cd.title)+".ics", buildICS(cd), "text/calendar");
});

/* ---------- active filters, as chips (Day 30) ----------
   A filter you cannot see is a filter you will blame the data for. The controls
   that set these live in a wide toolbar and two nested panels, and three of them
   are checkboxes whose state is a single tick — so "why is this show missing"
   was a question you had to answer by auditing a row of dropdowns.

   ONE LIST DEFINES WHAT IS ACTIVE, and both rendering and clearing read it. A
   chip that appears but does not clear, or a filter that clears but leaves its
   chip, are the two failure modes here, and neither is reachable if the label
   and the reset live in the same record. */
const FILTER_CHIPS = [
  { id:"search",   on:()=>!!state.search,                   label:()=>`🔍 “${state.search}”`,
    clear:()=>{ state.search=""; const el=$("fSearch"); if(el) el.value=""; hideSearchResults&&hideSearchResults(); } },
  { id:"mine",     on:()=>!!state.filters.mine,             label:()=>"⭐ My list only",
    clear:()=>{ state.filters.mine=false; const el=$("fMine"); if(el) el.checked=false; } },
  { id:"format",   on:()=>!!state.filters.format,           label:()=>FMT_LABEL[state.filters.format]||state.filters.format,
    clear:()=>{ state.filters.format=""; const el=$("fFormat"); if(el) el.value=""; } },
  { id:"genre",    on:()=>!!state.filters.genre,            label:()=>state.filters.genre,
    clear:()=>{ state.filters.genre=""; const el=$("fGenre"); if(el) el.value=""; } },
  { id:"tag",      on:()=>!!state.filters.tag,              label:()=>state.filters.tag,
    clear:()=>{ state.filters.tag=""; const el=$("fTag"); if(el) el.value=""; } },
  { id:"stream",   on:()=>!!state.filters.stream,           label:()=>state.filters.stream,
    clear:()=>{ state.filters.stream=""; const el=$("fStream"); if(el) el.value=""; } },
  { id:"minScore", on:()=>+state.filters.minScore>0,        label:()=>`★ ${state.filters.minScore}+`,
    clear:()=>{ state.filters.minScore=0; const el=$("fScore"); if(el) el.value="0"; } },
  { id:"prem",     on:()=>!!state.filters.premieresOnly,    label:()=>"Premieres only",
    clear:()=>{ state.filters.premieresOnly=false; const el=$("fPrem"); if(el) el.checked=false; } },
  { id:"eps",      on:()=>state.filters.epsMin||state.filters.epsMax,
    label:()=>`${state.filters.epsMin||"1"}–${state.filters.epsMax||"∞"} episodes`,
    clear:()=>{ delete state.filters.epsMin; delete state.filters.epsMax; } },
  { id:"aired",    on:()=>state.filters.airedMin||state.filters.airedMax,
    label:()=>`Episode ${state.filters.airedMin||"1"}–${state.filters.airedMax||"∞"}`,
    clear:()=>{ delete state.filters.airedMin; delete state.filters.airedMax; } },
  // These two are ON by default, so a chip is only honest when they are OFF —
  // chipping a default would put permanent noise above everybody's calendar.
  { id:"nsfw",     on:()=>!state.hideNSFW,                  label:()=>"🔞 Showing NSFW",
    clear:()=>{ state.hideNSFW=true; localStorage.setItem("anical.hideNSFW","1"); const el=$("fNSFW"); if(el) el.checked=true; } },
  { id:"donghua",  on:()=>!state.showDonghua,               label:()=>"Donghua hidden",
    clear:()=>{ state.showDonghua=true; localStorage.setItem("anical.showDonghua","1"); } },
];
const activeFilters = () => FILTER_CHIPS.filter(f=>f.on());
function paintActiveFilters(){
  const host=$("activeFilters"); if(!host) return;
  const on=activeFilters();
  host.hidden=!on.length;
  if(!on.length){ host.innerHTML=""; return; }
  host.innerHTML=on.map(f=>
    `<button type="button" class="afx-chip" data-unfilter="${f.id}" title="Remove this filter">
      ${esc(String(f.label()))}<i aria-hidden="true">✕</i></button>`).join("")
    +(on.length>1?`<button type="button" class="afx-clear" data-unfilter="*">Clear all</button>`:"");
}
function clearFilter(id){
  const list = id==="*" ? activeFilters() : FILTER_CHIPS.filter(f=>f.id===id);
  if(!list.length) return;
  for(const f of list) f.clear();
  localStorage.setItem("anical.filters", JSON.stringify(state.filters));
  applyAppearance();
  syncURL(false);
  renderView();
  renderGenreChips();
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-unfilter]"); if(!b) return;
  e.preventDefault();
  clearFilter(b.dataset.unfilter);
});
// filters
function onFilter(){
  state.filters.format=$("fFormat").value;
  state.filters.genre=$("fGenre").value;
  state.filters.stream=$("fStream").value;
  state.filters.tag=$("fTag").value;
  state.filters.minScore=+$("fScore").value;
  state.filters.premieresOnly=$("fPrem").checked;
  state.filters.mine=$("fMine").checked;
  localStorage.setItem("anical.filters",JSON.stringify(state.filters));
  syncURL(false);
  renderView();
  renderGenreChips();
  setStatus(false,`Live · ${state.media.length} titles · ${rangeEvents().length} episodes shown`);
}
["fFormat","fGenre","fStream","fTag","fScore"].forEach(id=>$(id).onchange=onFilter);
$("fPrem").onchange=onFilter;
$("fMine").onchange=onFilter;
$("fTitleLang").onchange=()=>{
  state.titleLang=$("fTitleLang").value;
  localStorage.setItem("anical.titleLang",state.titleLang);
  renderView();   // re-renders calendar + sidebars (+ dashboard if active) with new titles
};
$("fNSFW").onchange=()=>{
  state.hideNSFW=$("fNSFW").checked;
  localStorage.setItem("anical.hideNSFW", state.hideNSFW?"1":"0");
  renderView();   // re-applies everywhere (calendar, sidebars, dashboard); search refreshes on next keystroke
  setStatus(false,`Live · ${state.media.length} titles · ${rangeEvents().length} episodes shown`);
};

/* search — queries ALL of AniList (not just loaded seasons). Typing shows
   instant local matches, then replaces them with global results; picking one
   jumps the calendar to that show's next episode and opens its details.      */
// Next episode, in the release the viewer is actually tracking (see
// primaryAirType). Break weeks are skipped — there is nothing to wait for.
// Keeps the {episode, airingAt} shape older callers expect and adds the
// resolved variant + any delay note alongside it.
function nextAir(md){
  const now=Date.now()/1000;
  let best=null;
  for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]){
    const {status,variants}=variantsFor(md,n);
    // visibleVariants, not the raw list: "next episode" has to name the same
    // release the calendar is showing, or the modal disagrees with the grid.
    const v=preferredVariant(visibleVariants(variants));
    if(!v||v.ts<=now) continue;
    if(!best||v.ts<best.airingAt) best={episode:n.episode, airingAt:v.ts, air:v, status};
  }
  return best;
}
function hideSearchResults(){ $("searchResults").classList.remove("on"); srIndex=-1; }
async function searchAniList(q){
  // Our search answers from the cached seasons first and only reaches upstream
  // for titles it doesn't hold — so typing in the box usually costs AniList
  // nothing. Still falls back to AniList directly if our API can't answer.
  const ours=await apiGet(`/search?full=1&q=${encodeURIComponent(q)}${state.hideNSFW?"":"&includeAdult=1"}`);
  if(ours&&Array.isArray(ours.media)) return ours.media;
  const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({query:SEARCH_QUERY,variables:{search:q}})});
  if(!res.ok) throw new Error("AniList HTTP "+res.status);
  const j=await res.json(); if(j.errors) throw new Error(j.errors[0].message);
  return j.data.Page.media;
}
function searchRowHTML(md){
  const na=nextAir(md);
  const sub=na ? `Next: ${new Date(na.airingAt*1000).toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"})} · Ep ${na.episode}`
               : (md.startDate&&md.startDate.year ? `${md.startDate.year}` : "")+((md.status?" · "+md.status.replace(/_/g," ").toLowerCase():"")||"—");
  const sc=md.averageScore?`<span class="pill score">★ ${md.averageScore}</span>`:"";
  // Quick-add strip: one click puts the show on the board with that status, without
  // leaving the search — so adding several shows in a row stays a single flow.
  return `<div class="sr-row" role="button" tabindex="0" aria-label="${esc(title(md))}" data-sid="${md.id}">
    <img src="${md.coverImage&&md.coverImage.medium?esc(md.coverImage.medium):""}" alt="" loading="lazy" width="34" height="46">
    <div style="min-width:0;flex:1"><div class="srt">${esc(title(md))}</div>
      <div class="srm"><span class="pill">${esc(FMT_LABEL[md.format]||md.format||"?")}</span>${sc}${myMarks(md.id)}<span>${esc(sub)}</span></div>
      <div class="sr-add">
        <span class="sr-add-label" data-st-label="${md.id}" data-on-label="On board:" data-off-label="Add:">${getStatusOf(md.id)?"On board:":"Add:"}</span>
        ${statusPickerHtml(md.id,"sm")}
      </div>
    </div></div>`;
}
function showSearchRows(list, head){
  const box=$("searchResults");
  head=head||"";
  if(!list.length){ box.innerHTML=head+`<div class="sr-empty">No anime found for “${esc(state.search)}”.</div>`; box.classList.add("on"); srIndex=-1; return; }
  state.searchResults=new Map(list.map(md=>[String(md.id),md]));
  box.innerHTML=head+list.slice(0,10).map(searchRowHTML).join("")+
    `<div class="sr-foot"><span><kbd>↵</kbd> open</span><span><kbd>⇧↵</kbd> full page</span><span><kbd>${IS_MAC?"⌘":"Ctrl"} K</kbd> everything</span></div>`;
  box.classList.add("on");
  srIndex=-1;
  box.querySelectorAll("[data-sid]").forEach(el=>{
    el.onclick=ev=>{ if(ev.target.closest("[data-st]")) return;   // status chips add in place
      if(ev.shiftKey){ recordSearch($("fSearch").value); openSearchResultPage(el.dataset.sid); return; }
      selectSearchResult(el.dataset.sid); };
  });
}
/* ↑/↓ through the results, Enter opens the highlighted one */
let srIndex=-1;
function srRows(){ const b=$("searchResults"); return b.classList.contains("on") ? [...b.querySelectorAll("[data-sid],[data-rerun],[data-runsaved]")] : []; }
function srMove(delta){
  const rows=srRows(); if(!rows.length) return false;
  srIndex = srIndex<0 ? (delta>0?0:rows.length-1) : (srIndex+delta+rows.length)%rows.length;
  rows.forEach((r,n)=>r.classList.toggle("active", n===srIndex));
  rows[srIndex].scrollIntoView({block:"nearest"});
  return true;
}
function pickTargetTs(md){
  // Jump to the release the viewer tracks — landing on the JP broadcast day
  // when they follow dubs would scroll them to a day with nothing on it.
  const times=[];
  for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[]){
    const v=trackedVariant(md,n);
    if(v) times.push(v.ts);
  }
  times.sort((a,b)=>a-b);
  const now=Date.now()/1000;
  const up=times.find(t=>t>now);
  if(up) return up;
  if(times.length) return times[times.length-1];   // last aired
  return sdTs(md.startDate);                        // may be null
}
function clearSearchBox(){ $("fSearch").value=""; state.search=""; state.searchQ=null; hideSearchResults(); }
// Shift-Enter: the show page instead of the calendar jump.
function openSearchResultPage(id){
  id=String(id);
  const md=state.searchResults&&state.searchResults.get(id);
  if(md && md.airingSchedule && !state.media.some(x=>String(x.id)===id)) state.full.set(id, md);
  clearSearchBox();
  openShowPage(id);
}
function selectSearchResult(id){
  id=String(id);
  const md=(state.searchResults&&state.searchResults.get(id))||state.media.find(x=>String(x.id)===id);
  if(!md) return;
  recordSearch($("fSearch").value);                                 // Day 72 — a picked result means the query worked
  if(!state.media.some(x=>String(x.id)===id)) state.media.push(md);   // make it renderable now
  clearSearchBox();                                                  // unfilter so the month shows context
  const target=pickTargetTs(md);
  if(target){
    state.anchor=new Date(target*1000);
    if(!["month","agenda"].includes(state.viewMode)){   // pick a view that will actually show it
      state.viewMode="month"; localStorage.setItem("anical.view","month");
      document.querySelectorAll("#viewSeg button").forEach(b=>b.classList.toggle("active",b.dataset.view==="month"));
      syncURL(true);
    }
  }
  openDetail(md,(nextAir(md)||{}).episode||1);   // instant payoff (full schedule)
  load();                                        // refresh calendar around the new date
}
let searchSeq=0, searchTimer=null, histTimer=null;
// Views the search box doesn't filter — rebuilding them per keystroke is pure cost.
const SEARCH_UNFILTERED = ["board","lists","events","show","browse","gems"];
function onSearch(){
  const raw=$("fSearch").value.trim();
  const q=parseSearch(raw);
  state.search=raw.toLowerCase();
  state.searchQ=q;
  // The typed text filters the calendar; the board and events views aren't filtered
  // by it, so don't rebuild them on every keystroke.
  if(!SEARCH_UNFILTERED.includes(state.viewMode)){
    renderView();   // live-filter the loaded calendar by what's typed
    setStatus(false,`Live · ${state.media.length} titles · ${rangeEvents().length} episodes shown`);
  }
  const box=$("searchResults");
  clearTimeout(histTimer);
  if(!raw){ state.searchResults=new Map(); clearTimeout(searchTimer); searchSeq++; showSearchHome(); return; }
  const head=searchOpsHtml(q);
  // 1) instant local matches — fuzzy, operator-aware and ranked (Days 69, 73, 74)
  const loc=searchActive(q) ? rankSearch(searchUniverse(), q).map(r=>r.md) : [];
  if(loc.length) showSearchRows(loc, head);
  else if(!searchActive(q)){ box.innerHTML=head||`<div class="sr-empty">Keep typing…</div>`; box.classList.add("on"); srIndex=-1; }
  else { box.innerHTML=head+'<div class="sr-empty">Searching AniList…</div>'; box.classList.add("on"); srIndex=-1; }
  // A pause long enough to read the results counts as having used the query.
  histTimer=setTimeout(()=>{ if($("fSearch").value.trim()===raw && box.querySelector("[data-sid]")) recordSearch(raw); }, 2600);
  if(!searchActive(q)){ clearTimeout(searchTimer); searchSeq++; return; }
  // 2) debounced global search across all of AniList — by title when there is
  // one, by the operators AniList understands when there isn't.
  clearTimeout(searchTimer);
  const seq=++searchSeq;
  searchTimer=setTimeout(async()=>{
    try{
      const results = q.rawText.length>=2 ? await searchAniList(q.rawText) : await searchByOps(q);
      if(seq!==searchSeq || $("fSearch").value.trim()!==raw) return;   // stale / changed
      const ranked=rankSearch(loc.concat((results||[]).filter(md=>!nsfwHidden(md)&&!isHidden(md.id))), q).map(r=>r.md);
      showSearchRows(ranked, head);
    }catch(err){
      if(seq!==searchSeq) return;
      if(!loc.length){ const b=$("searchResults"); b.innerHTML=head+'<div class="sr-empty">Search is unavailable right now — check your connection.</div>'; b.classList.add("on"); }
    }
  },280);
}
$("fSearch").oninput=onSearch;
$("fSearch").onfocus=()=>{ if($("fSearch").value.trim()) onSearch(); else showSearchHome(); };
$("fSearch").onkeydown=e=>{
  if(e.key==="Escape"){ e.stopPropagation(); clearSearchBox(); clearTimeout(searchTimer); searchSeq++;
    if(!SEARCH_UNFILTERED.includes(state.viewMode)){ renderView();
      setStatus(false,`Live · ${state.media.length} titles · ${rangeEvents().length} episodes shown`); } }
  else if(e.key==="ArrowDown"){ if(srMove(1)) e.preventDefault(); }
  else if(e.key==="ArrowUp"){ if(srMove(-1)) e.preventDefault(); }
  else if(e.key==="Enter"){
    const raw=$("fSearch").value.trim();
    const rows=srRows(); const row=rows[srIndex>=0?srIndex:0];
    if(!row || (!raw && srIndex<0)) return;
    e.preventDefault();
    if(row.dataset.sid && e.shiftKey){ recordSearch(raw); openSearchResultPage(row.dataset.sid); return; }
    if(raw) recordSearch(raw);
    row.click();
  }
};
document.addEventListener("click",e=>{ if(!e.target.closest(".search-wrap")) hideSearchResults(); });

// notifications
$("notifyBtn").onclick=()=>{
  if(!("Notification" in window)) return;
  if(Notification.permission==="default") Notification.requestPermission().then(()=>{ updateNotifyBtn(); scheduleNotifications(); syncPushSubscription(); });
  else updateNotifyBtn();
};
$("leadSel").onchange=()=>{ state.notifyLead=+$("leadSel").value; localStorage.setItem("anical.lead",state.notifyLead); clearAllScheduled(); clearAllTriggered().then(scheduleNotifications); syncPushSubscription(); };

// restore UI state
$("fFormat").value=state.filters.format;
$("fScore").value=String(state.filters.minScore);
$("fPrem").checked=!!state.filters.premieresOnly;
$("fMine").checked=!!state.filters.mine;
$("fNSFW").checked=state.hideNSFW;
$("fTitleLang").value=state.titleLang;
$("leadSel").value=String(state.notifyLead);
document.querySelectorAll("#viewSeg button").forEach(b=>b.classList.toggle("active",b.dataset.view===state.viewMode));
updateNotifyBtn();

// live tick: refresh countdowns / agenda + roll notifications forward.
// Both timers no-op while the tab is hidden (saves CPU/battery on a backgrounded
// tab); a visibilitychange handler catches everything up the moment it's shown.
function minuteTick(){
  if(document.hidden) return;
  if(state.viewMode==="agenda" && !$("overlay").classList.contains("on")){ const w=$("calWrap"); w.innerHTML=""; renderAgenda(w); }
  scheduleNotifications();
}
setInterval(minuteTick, 60000);
// 1-second tick so every visible countdown ("in 3h 12m 04s") actually moves
setInterval(()=>{ if(!document.hidden) tickCountdowns(); }, 1000);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ tickCountdowns(); minuteTick(); } });

// PWA: install prompt + service worker
let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredPrompt=e; const b=$("installBtn"); if(b) b.style.display=""; });
{ const ib=$("installBtn"); if(ib) ib.onclick=async()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); try{ await deferredPrompt.userChoice; }catch(_){ } deferredPrompt=null; ib.style.display="none"; }; }
window.addEventListener("appinstalled",()=>{ const b=$("installBtn"); if(b) b.style.display="none"; });
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("/sw.js").catch(()=>{});
    navigator.serviceWorker.ready.then(reg=>{ swReg=reg; scheduleNotifications(); scheduleEventNotifications(); syncPushSubscription(); }).catch(()=>{});  // enables closed-app alerts where supported
  });
}

/* ---------- analytics (Cloudflare Web Analytics — privacy-friendly, no cookies, nothing to host) ----------
   Paste your token from dash.cloudflare.com → Web Analytics into CF_TOKEN to enable.
   Stays completely off (no beacon loaded) until a token is set. */
const CF_TOKEN="";
if(CF_TOKEN){ const s=document.createElement("script"); s.defer=true; s.src="https://static.cloudflareinsights.com/beacon.min.js"; s.setAttribute("data-cf-beacon", JSON.stringify({token:CF_TOKEN})); document.head.appendChild(s); }

// An AniList sign-in comes back as a URL fragment. Consume it before anything
// reads the URL, so the token is out of the address bar immediately.
const _alFresh=alCaptureToken();

// deep links: ?view=<mode>, ?date=YYYY-MM-DD, ?format/genre/stream/tag/score/prem/mine, ?show=<id>
const _params=new URLSearchParams(location.search);
applyParamsToState(_params, false);   // reset=false: only apply keys present in the URL
async function openShowById(id){
  let md=findMediaById(id);
  if(!md && state.light.has(String(id))) return peekShow(id);   // a card-weight record needs the full fetch first
  if(!md){ try{ md=await fetchMediaById(id); }catch(e){ console.warn("?show fetch failed",e); } if(md && !state.media.some(x=>String(x.id)===String(md.id))) state.media.push(md); }
  if(md) openDetail(md,(nextAir(md)||{}).episode||1);
}

/* Skin preview for /admin. The theme id is handed over in localStorage rather
   than a URL parameter on purpose: a ?theme= link would let anyone wear an
   event skin, and being the only one wearing it is the entire point. */
async function applySkinPreview(){
  let id=null;
  try{ id=localStorage.getItem(SKIN_PREVIEW_KEY); }catch(e){}
  if(!id) return;
  const cat=await loadThemeCatalog();
  const t=cat&&cat[id];
  if(!t){ try{ localStorage.removeItem(SKIN_PREVIEW_KEY); }catch(e){} return; }
  state.skinPreview=t;
  applyAppearance();
  toast(`Previewing "${t.name||id}" — nobody else sees this.`, ()=>{
    try{ localStorage.removeItem(SKIN_PREVIEW_KEY); }catch(e){}
    state.skinPreview=null; applyAppearance();
  }, "Stop preview");
}

// initial pull (on every launch), then honor ?show=
(async function boot(){
  // Identity + skin. Not awaited in the normal case — the calendar must not
  // wait on a cosmetic lookup, and the cached skin has already painted.
  const arriving=_params.get("login");
  const identity=refreshIdentity().catch(()=>null);
  if(!arriving) identity.then(()=>{});
  applySkinPreview().catch(()=>{});

  // Coming back from Discord. `ok` is the success case and has to *say* so:
  // without it a completed sign-in looks identical to a page reload, which is
  // how you end up unsure whether it worked.
  if(arriving){
    // Strip it before anything else, so a reload can't replay the message.
    history.replaceState(null,"",location.pathname+location.search.replace(/([?&])login=[^&]*(&|$)/,"$1").replace(/[?&]$/,"")+location.hash);
    if(arriving==="ok"){
      identity.then(j=>{
        const u=j&&j.user;
        if(!u){ state.loginProblem="The sign-in came back but the session didn't stick. If you're on http://localhost, check the server log."; toast(state.loginProblem); return openSettings(); }
        const name=u.globalName||u.username||"you";
        if(state.skin) toast(`Signed in as ${name} — ${state.skin.name} applied.`);
        else toast(`Signed in as ${name}.`);
      });
    } else {
      const said={cancelled:"Discord sign-in cancelled.",
        expired:"That sign-in link expired — start it again from Settings.",
        unconfigured:"Discord sign-in isn't set up on this deployment yet.",
        failed:"Discord sign-in failed. Check the redirect URI and client secret."}[arriving]||"Discord sign-in didn't complete.";
      // Also parked in state so Settings can still show it after the toast has
      // gone. A two-second flash is not how you report a failed login.
      state.loginProblem=said;
      toast(said);
      openSettings();
    }
  }

  // instant paint from the last cached schedule (then load() refreshes in the background)
  if(["month","week","agenda"].includes(state.viewMode)){
    const cached=readCache(3*24*3600*1000);
    if(cached){ const ca=new Date(cached.anchor);
      if(ca.getFullYear()===state.anchor.getFullYear() && ca.getMonth()===state.anchor.getMonth() && !_params.get("show")){
        state.media=cached.media; try{ buildGenreOptions(); }catch(e){} renderView(); setStatus(true,"Showing your last schedule — refreshing…");
      }
    }
  }
  await load();

  // AniList: identify the signed-in user, drain anything the last session left
  // queued, and on a fresh sign-in pull the list straight away — the whole
  // point of connecting is not having to press a second button.
  if(alTokenValid()){
    try{
      if(!alState.user) await alFetchViewer();
      if(_alFresh){ await alPull(); toast("AniList list imported."); openSettings(); }
      else if(alState.queue.length) alRunQueue();
    }catch(e){ console.warn("AniList sync on boot failed", e); }
  }

  const qs=_params.get("show");
  if(qs) openShowById(qs);
  else if(!_alFresh) maybeShowChangelog();   // greet returning visitors with release notes (once)
})();

/* ============================================================
   Chat widget
   ------------------------------------------------------------
   Talks to /api/chat, which streams Server-Sent Events. EventSource
   can't be used because the transcript is sent in a POST body, so the
   frames are parsed by hand off the fetch stream.

   The browser holds nothing but plain user/assistant text: tool calls
   and the model's reasoning stay server-side, so a tampered localStorage
   can only change what the user appears to have typed.
   ============================================================ */
const CHAT_LS   = "anical.chat";
const CHAT_MAX  = 8;               // turns kept — must match MAX_TURNS in chat.mjs
const CHAT_SUGG = [
  "What airs today?",
  "When does the next episode of Frieren drop?",
  "What's worth watching next season?",
  "Any news on a One Punch Man season 4?",
];

const chat = { msgs:[], busy:false, open:false };

try{ const raw=localStorage.getItem(CHAT_LS); if(raw) chat.msgs=JSON.parse(raw).slice(-CHAT_MAX); }catch(e){ chat.msgs=[]; }
function chatSave(){ try{ localStorage.setItem(CHAT_LS, JSON.stringify(chat.msgs.slice(-CHAT_MAX))); }catch(e){} }

/* Markdown-lite. Everything is escaped first and only a fixed set of
   inline patterns is re-introduced, so model output can never inject
   markup. Links are forced to http(s) — a javascript: URL in a citation
   would otherwise be one click from running. */
function chatMd(src){
  const lines=String(src||"").split("\n");
  const out=[]; let list=null;
  const inline=s=>esc(s)
    .replace(/`([^`]+)`/g,(m,c)=>`<code>${c}</code>`)
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")            // non-greedy: bold often wraps an italic span
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,"$1<em>$2</em>")   // after bold, so ** is already gone
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(m,t,u)=>`<a href="${u}" target="_blank" rel="noopener nofollow">${t}</a>`);
  for(const ln of lines){
    const li=ln.match(/^\s*[-*]\s+(.*)$/);
    if(li){ if(!list){ list=[]; } list.push(`<li>${inline(li[1])}</li>`); continue; }
    if(list){ out.push(`<ul>${list.join("")}</ul>`); list=null; }
    if(ln.trim()) out.push(`<p>${inline(ln)}</p>`);
  }
  if(list) out.push(`<ul>${list.join("")}</ul>`);
  return out.join("");
}

function chatScroll(){ const l=$("chatLog"); l.scrollTop=l.scrollHeight; }

function chatBubble(role, html){
  const d=document.createElement("div");
  d.className="chat-msg "+role;
  d.innerHTML=html;
  $("chatLog").appendChild(d);
  chatScroll();
  return d;
}

function chatRenderIntro(){
  const d=document.createElement("div");
  d.className="chat-intro";
  d.innerHTML="Ask anything about anime. Release times come from this calendar — including the corrections you won't find on AniList — and anything else gets looked up on the web."
    +`<div class="chat-sugg">${CHAT_SUGG.map(s=>`<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>`;
  d.querySelectorAll("button").forEach(b=>{
    b.onclick=()=>{ $("chatInput").value=b.dataset.q; chatSubmit(); };
  });
  $("chatLog").appendChild(d);
}

function chatRender(){
  const log=$("chatLog");
  log.innerHTML="";
  if(!chat.msgs.length){ chatRenderIntro(); return; }
  for(const m of chat.msgs){
    if(m.role==="user") chatBubble("me", esc(m.text).replace(/\n/g,"<br>"));
    else{
      const b=chatBubble("bot", chatMd(m.text));
      if(m.sources&&m.sources.length) b.appendChild(chatSourceRow(m.sources));
    }
  }
  chatScroll();
}

function chatSourceRow(items){
  const row=document.createElement("div");
  row.className="chat-src";
  row.innerHTML=items.map(s=>{
    if(!/^https?:\/\//i.test(s.url||"")) return "";
    let host=s.url; try{ host=new URL(s.url).hostname.replace(/^www\./,""); }catch(e){}
    return `<a href="${esc(s.url)}" target="_blank" rel="noopener nofollow" title="${esc(s.title||host)}">${esc(host)}</a>`;
  }).join("");
  return row;
}

function chatOpen(on){
  chat.open=on;
  $("chatPanel").classList.toggle("on",on);
  $("chatFab").classList.toggle("open",on);
  $("chatFab").setAttribute("aria-expanded", on?"true":"false");
  $("chatFab").setAttribute("aria-label", on?"Close anime chat":"Open anime chat");
  if(on){
    $("chatFab").classList.remove("unread");
    if(!$("chatLog").childElementCount) chatRender();
    chatScroll();
    if(window.innerWidth>700) setTimeout(()=>$("chatInput").focus(),40);
  }
}

async function chatSubmit(){
  if(chat.busy) return;
  const box=$("chatInput");
  const text=box.value.trim();
  if(!text) return;

  box.value=""; box.style.height="auto";
  chat.msgs.push({role:"user",text});
  if(chat.msgs.length===1) $("chatLog").innerHTML="";
  chatBubble("me", esc(text).replace(/\n/g,"<br>"));
  chatSave();

  chat.busy=true;
  $("chatSend").disabled=true;

  const status=document.createElement("div");
  status.className="chat-status";
  status.innerHTML='<span class="spin"></span><span class="cs-t">Thinking…</span>';
  $("chatLog").appendChild(status);
  chatScroll();

  let bubble=null, answer="", sources=[];
  const paint=()=>{ bubble.innerHTML=chatMd(answer)+'<span class="chat-caret"></span>'; chatScroll(); };

  try{
    const res=await fetch("/api/chat",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({messages:chat.msgs.slice(-CHAT_MAX).map(m=>({role:m.role,text:m.text}))}),
    });

    if(!res.ok||!res.body){
      let msg="Chat is unavailable right now.";
      try{ const j=await res.json(); if(j&&j.error) msg=j.error; }catch(e){}
      throw new Error(msg);
    }

    const reader=res.body.getReader(), dec=new TextDecoder();
    let buf="";
    for(;;){
      const {value,done}=await reader.read();
      if(done) break;
      buf+=dec.decode(value,{stream:true});
      const frames=buf.split("\n\n");
      buf=frames.pop()||"";
      for(const frame of frames){
        const ev=(frame.match(/^event:\s*(.+)$/m)||[])[1];
        const dl=(frame.match(/^data:\s*(.+)$/m)||[])[1];
        if(!ev||!dl) continue;
        let data; try{ data=JSON.parse(dl); }catch(e){ continue; }

        if(ev==="status"&&!bubble){ status.querySelector(".cs-t").textContent=data.text+"…"; }
        else if(ev==="delta"){
          if(!bubble){ status.remove(); bubble=chatBubble("bot",""); }
          answer+=data.text; paint();
        }
        else if(ev==="sources"){ sources=data.items||[]; }
        else if(ev==="error"){ throw new Error(data.message); }
      }
    }
    if(!answer) throw new Error("No answer came back. Try again.");
  }catch(err){
    status.remove();
    if(bubble&&answer) bubble.innerHTML=chatMd(answer);   // keep the partial answer
    else if(bubble) bubble.remove();
    chatBubble("err", esc(err.message||"Something went wrong."));
    chat.busy=false; $("chatSend").disabled=false;
    if(!chat.open) $("chatFab").classList.add("unread");
    return;
  }

  status.remove();
  bubble.innerHTML=chatMd(answer);
  if(sources.length) bubble.appendChild(chatSourceRow(sources));
  chat.msgs.push({role:"assistant",text:answer,sources});
  chat.msgs=chat.msgs.slice(-CHAT_MAX);
  chatSave();
  chatScroll();

  chat.busy=false;
  $("chatSend").disabled=false;
  if(!chat.open) $("chatFab").classList.add("unread");
}

$("chatFab").onclick=()=>chatOpen(!chat.open);
$("chatClose").onclick=()=>{ chatOpen(false); $("chatFab").focus(); };
$("chatClear").onclick=()=>{ chat.msgs=[]; chatSave(); chatRender(); $("chatInput").focus(); };
$("chatForm").onsubmit=e=>{ e.preventDefault(); chatSubmit(); };

$("chatInput").addEventListener("input",e=>{
  e.target.style.height="auto";
  e.target.style.height=Math.min(e.target.scrollHeight,110)+"px";
});
$("chatInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); chatSubmit(); }
});

// Capture phase so Esc closes the chat before the page-level handler decides
// what Esc means — otherwise a chat opened over a show dialog can't be closed.
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&chat.open){ e.stopPropagation(); chatOpen(false); $("chatFab").focus(); }
},true);
