/* Calendar views, modals, and appearance.
 * Loaded in order as a classic script after /app.js.
 * Top-level declarations share the global scope; preserve this order.
 */
"use strict";

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
function closeModal(){ saveNoteNow(); state._modalKind=null; $("overlay").classList.remove("on"); const after=changelogAfterClose; changelogAfterClose=null; if(after) setTimeout(after,0); }

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
applyAppearance();   // set stored appearance before the first paint


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
