/* Tsuzuki — shared application state and common helpers.
 *
 * Feature code is split into ordered classic scripts in /app/. They share one
 * global lexical scope, so keep their order in index.html. This is an
 * intentional no-build-step layout, not a set of ES modules yet.
 *
 * APP_VERSION is stamped into index.html; see scripts/stamp-version.mjs.
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
// application scripts are cached separately, and a version bump must not
// invalidate unchanged application code. Falls back to "dev" when opened directly.
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
  radius: +(localStorage.getItem("anical.radius")||12),             // card corner radius, px (Day 210)
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
