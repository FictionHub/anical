/* Application startup, navigation, and chat.
 * Loaded in order as a classic script after /app.js.
 * Top-level declarations share the global scope; preserve this order.
 */
"use strict";

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
  if(qv && ["month","week","agenda","dashboard","events","board","lists","taste","recs","gems","browse","show","franchise"].includes(qv)) state.viewMode=qv;
  else if(reset) state.viewMode="month";
  // The two routes that carry a subject. A show page without a usable id has
  // nothing to render, so it falls back to the calendar rather than a blank page.
  if(state.viewMode==="show"){
    const id=String(params.get("id")||"").replace(/\D/g,"");
    if(id) state.showId=id; else if(qv==="show") state.viewMode="month";
  }
  if(state.viewMode==="browse"){
    const k=params.get("kind");
    state.browse={ kind:["tag","studio","staff","year"].includes(k)?k:"tag",
      id:k==="year"?String(params.get("y")||"").replace(/\D/g,"")||null:String(params.get("id")||"").replace(/\D/g,"")||null,
      name:(params.get("name")||"").slice(0,120)||null };
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
      if(_alFresh){ await alPull(); toast("AniList list imported."); }
      else if(alState.queue.length) alRunQueue();
    }catch(e){ console.warn("AniList sync on boot failed", e); }
  }

  const qs=_params.get("show");
  const continueStartup=()=>{ if(qs) openShowById(qs); else if(_alFresh||state.loginProblem) openSettings(); };
  if(!maybeShowChangelog(continueStartup)) continueStartup();
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
