/* Catalog, releases, notifications, and stored data helpers.
 * Loaded in order as a classic script after /app.js.
 * Top-level declarations share the global scope; preserve this order.
 */
"use strict";

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
