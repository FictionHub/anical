/* My Plan: a local-first, user-facing watch workspace. Loaded after boot.js so
   it can reuse the calendar's existing media, status, rating and alert actions. */
(() => {
  "use strict";

  const STORE = "anical.experience.";
  const get = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(STORE + key)); return value == null ? fallback : value; }
    catch (_) { return fallback; }
  };
  const put = (key, value) => { try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch (_) {} };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, +n || 0));
  const safeTitle = md => (md && typeof title === "function" ? title(md) : "") || "Untitled anime";
  const escText = value => typeof esc === "function" ? esc(value) : String(value == null ? "" : value).replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const watchedThisWeek = () => {
    const monday=dayStart(new Date()); monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
    const first=dayKey(monday);
    return (state.activity||[]).filter(row=>Array.isArray(row)&&row[0]==="ep"&&String(row[2]||"")>=first)
      .reduce((sum,row)=>sum+(+row[3]||1),0);
  };
  const dayLabel = d => d.toLocaleDateString([], {weekday:"long", month:"short", day:"numeric"});
  const timeLabel = (ts, zone) => {
    try { return new Intl.DateTimeFormat([], {hour:"numeric", minute:"2-digit", ...(zone && zone!=="local" ? {timeZone:zone} : {})}).format(new Date(ts*1000)); }
    catch (_) { return new Date(ts*1000).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}); }
  };
  const allMedia = () => {
    const map = new Map();
    for (const md of [...(state.media||[]), ...((state.extra&&[...state.extra.values()])||[])]) if (md&&md.id) map.set(String(md.id),md);
    if (state.showCache) for (const [id, row] of state.showCache) if (row&&row.md) map.set(String(id),row.md);
    return [...map.values()];
  };
  const mediaById = id => (typeof findMediaById === "function" && findMediaById(String(id))) || allMedia().find(md=>String(md.id)===String(id)) || null;
  const tracked = () => [...(state.watch||[])].map(String).map(mediaById).filter(Boolean);
  const totalEps = md => typeof epTotal === "function" ? epTotal(md) : (+md.episodes||0);
  const watchedEps = md => typeof getProgress === "function" ? getProgress(md.id) : (+state.progress[String(md.id)]||0);
  const isLiveStatus = md => !["completed","dropped","onhold"].includes(getStatusOf(md.id));
  const eventRows = (days=7, onlyToday=false) => {
    const now=Date.now()/1000, start=dayStart(new Date()), end=new Date(start);
    end.setDate(end.getDate()+(onlyToday?1:days));
    const startTs=onlyToday?Math.max(now,start.getTime()/1000):now, endTs=end.getTime()/1000;
    const out=[];
    for(const md of tracked()){
      if(!isLiveStatus(md)) continue;
      for(const node of (md.airingSchedule&&md.airingSchedule.nodes)||[]){
        const variant=typeof trackedVariant==="function"?trackedVariant(md,node):null;
        if(!variant) continue;
        const ts=variant.ts||node.airingAt;
        if(ts<startTs||ts>=endTs) continue;
        out.push({md,ep:node.episode,ts,air:variant});
      }
    }
    return out.sort((a,b)=>a.ts-b.ts||safeTitle(a.md).localeCompare(safeTitle(b.md)));
  };
  const art = md => {
    if(get("lowBandwidth",false)||state.showImages===false) return "";
    const src=md&&md.coverImage&&(md.coverImage.medium||md.coverImage.large);
    return src?`<img class="mx-cover" src="${escText(src)}" alt="" loading="lazy" decoding="async">`:"";
  };
  const typeLabel = air => air ? `${air.estimated?"~":""}${({raw:"Broadcast",sub:"Sub",dub:"Dub"})[air.type]||air.type||"Release"}${air.platform?` · ${air.platform}`:""}` : "Release time unavailable";
  const runtimeMins = md => Math.max(0,(+md.episodes||totalEps(md)||0)*(+md.duration||24));
  const runtimeText = mins => mins<60?`${mins} min`:`${Math.floor(mins/60)} hr ${mins%60?`${mins%60} min`:""}`.trim();

  let root, dialog, content, currentTab="today", returnFocus=null, selected=new Set();
  const tabList=[
    ["today","Today"],["week","My week"],["catchup","Catch up"],["discover","Discover"],
    ["library","Library"],["recap","Recap"],["share","Share"],["settings","Customize"]
  ];
  const tabsHtml=()=>{
    const order=get("homeOrder",tabList.map(t=>t[0])), hidden=new Set(get("hiddenTabs",[]));
    const visible=tabList.filter(([id])=>!hidden.has(id)).slice().sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
    if(!visible.some(([id])=>id===currentTab)) visible.unshift(tabList.find(([id])=>id===currentTab));
    return `<div class="mx-tabs" role="tablist" aria-label="My watch plan">${visible.filter(Boolean).map(([id,label])=>`<button type="button" role="tab" data-xtab="${id}" aria-selected="${currentTab===id}" tabindex="${currentTab===id?0:-1}" class="${currentTab===id?"on":""}">${label}</button>`).join("")}</div>`;
  };
  const panelHeader=()=>`<div class="mx-head"><div><div class="mx-eyebrow">YOUR LOCAL WATCH SPACE</div><h2 id="mxTitle">${currentTab==="today"?"Your anime, at a glance":tabList.find(t=>t[0]===currentTab)?.[1]||"My watch plan"}</h2><p class="mx-sub">Your list and planning notes stay in this browser unless you export or share selected public titles.</p></div><button type="button" class="mx-close" data-xclose aria-label="Close My Plan">✕</button></div>`;
  const shell = inner => `${panelHeader()}${tabsHtml()}<div class="mx-content" id="mxContent">${inner}</div>`;
  const action = (name,label,attrs="") => `<button type="button" data-xaction="${name}" ${attrs}>${label}</button>`;
  const card = (titleText, body, extra="") => `<section class="mx-card ${extra}"><h3>${titleText}</h3>${body}</section>`;
  const empty = (titleText,body,buttonLabel="Browse anime",buttonAction="browse") => `<div class="mx-empty"><strong>${titleText}</strong><p>${body}</p>${action(buttonAction,buttonLabel)}</div>`;
  const showLink = (md,label) => `<button class="mx-title" type="button" data-xopen="${escText(md.id)}">${escText(label||safeTitle(md))}</button>`;
  function showRow(md, meta, actions=""){
    const id=String(md.id), total=totalEps(md), watched=watchedEps(md);
    return `<article class="mx-row" data-mid="${escText(id)}">${art(md)}<div class="mx-row-main">${showLink(md)}<div class="mx-meta">${escText(meta||"")}${total?` · ${watched}/${total} watched`:""}${get("progressNote",{})[id]?` · ${escText(get("progressNote",{})[id])}`:""}</div>${actions?`<div class="mx-actions">${actions}</div>`:""}</div></article>`;
  }
  function episodeRow(row){
    const md=row.md, watched=watchedEps(md), isDone=watched>=row.ep;
    const conf=row.air&&row.air.estimated?"Estimated":"Listed release time";
    // Guarded reads, not bare JSON.parse: this runs on every My Plan render and
    // a corrupt value in either key would throw mid-render. These two live in
    // the SHARED namespace (data.js writes them), so they are read directly
    // rather than through get(), which prefixes this file's own store.
    const leads=(()=>{try{return JSON.parse(localStorage.getItem("anical.notifyLeadBy")||"{}")||{};}catch(_){return {};}})();
    const airPrefs=(()=>{try{return JSON.parse(localStorage.getItem("anical.notifyAirBy")||"{}")||{};}catch(_){return {};}})();
    return `<article class="mx-row mx-episode" data-mid="${escText(md.id)}">${art(md)}<div class="mx-row-main">${showLink(md)}<div class="mx-meta">Ep ${row.ep} · ${dayLabel(new Date(row.ts*1000))} at ${timeLabel(row.ts)} · ${escText(typeLabel(row.air))} · ${conf}${get("spoilerSafe",true)?" · details are spoiler-safe":""}</div><div class="mx-actions">${action("watched",isDone?`✓ Watched through ${watched}`:`Mark episode ${row.ep} watched`,`data-id="${escText(md.id)}" data-ep="${row.ep}" ${isDone?"disabled":""}`)}${action("alert",isFollowed(md.id)?"🔔 Alerts on":"🔕 Follow alerts",`data-id="${escText(md.id)}"`)}<label class="mx-quick-pref">Alert <select aria-label="Alert lead time for ${escText(safeTitle(md))}" data-xlead="${escText(md.id)}"><option value="5" ${+(leads[md.id]||state.notifyLead)===5?"selected":""}>5m</option><option value="10" ${+(leads[md.id]||state.notifyLead)===10?"selected":""}>10m</option><option value="15" ${+(leads[md.id]||state.notifyLead)===15?"selected":""}>15m</option><option value="30" ${+(leads[md.id]||state.notifyLead)===30?"selected":""}>30m</option></select></label><label class="mx-quick-pref">Release <select aria-label="Release type for ${escText(safeTitle(md))}" data-xair="${escText(md.id)}"><option value="auto" ${!airPrefs[md.id]?"selected":""}>Auto</option><option value="raw" ${airPrefs[md.id]==="raw"?"selected":""}>Broadcast</option><option value="sub" ${airPrefs[md.id]==="sub"?"selected":""}>Sub</option><option value="dub" ${airPrefs[md.id]==="dub"?"selected":""}>Dub</option></select></label>${action("rate","⭐ Rate",`data-id="${escText(md.id)}"`)}${action("pause","Pause show",`data-id="${escText(md.id)}"`)}</div></div></article>`;
  }
  function emptyWithFilters(titleText,body){
    const active=state.filters&&Object.values(state.filters).some(Boolean);
    return empty(titleText,body,active?"Clear filters":"Browse premieres",active?"clear-filters":"premieres");
  }
  function renderToday(){
    const today=eventRows(1,true), tonight=eventRows(1,true).filter(r=>new Date(r.ts*1000).getHours()>=18);
    const afterSix=new Date().getHours()>=18;
    const focus=afterSix&&tonight.length?tonight:today;
    const counts=eventRows(7,false).length, watchedWeek=watchedThisWeek(), mins=counts*(+get("episodeMinutes",24)||24);
    const connected=navigator.onLine;
    const start=`<div class="mx-status ${connected?"online":"offline"}" role="status">${connected?"● Live connection":"○ Offline · your saved list is still here"}${state.media&&state.media.length?` · ${state.media.length} titles loaded`:""}</div>`;
    const story=focus.length?focus.map(episodeRow).join(""):empty("A quiet day on your watch list","Nothing you follow is scheduled today. Try a short film, revisit your Plan to Watch shelf, or check the full calendar.","Open the calendar","calendar");
    const catchup=catchupRows().slice(0,3).map(x=>showRow(x.md,`${x.left} episode${x.left===1?"":"s"} available to catch up`)).join("");
    const goal=clamp(get("weeklyGoal",3),1,30), goalPct=Math.min(100,Math.round(watchedWeek/goal*100));
    const tipSeen=new Set(get("tipsSeen",[]));
    const tip=!tipSeen.has("plan")?`<div class="mx-tip"><span>Tip: mark an episode watched here, or tap the bell to follow alerts for just that show.</span>${action("dismiss-tip","Got it")}</div>`:"";
    const promptId=get("ratePrompt",""); const promptMd=promptId&&mediaById(promptId);
    return `${start}${tip}<div class="mx-stats"><div><b>${today.length}</b><span>episodes today</span></div><div><b>${watchedWeek} / ${goal}</b><span>episodes watched this week</span></div><div><b>≈ ${runtimeText(mins)}</b><span>upcoming watch time</span></div></div><div class="mx-goal"><div><b>Weekly goal</b><span>${Math.min(watchedWeek,goal)} of ${goal} episodes watched · ${goalPct}%</span></div><div class="mx-progress"><i style="width:${goalPct}%"></i></div></div>${promptMd?card("Want to rate your finished show?",`${showRow(promptMd,"You just marked this series watched.",action("rate","⭐ Rate this show",`data-id="${escText(promptId)}"`))}${action("dismiss-rating","Maybe later")}`):""}${card(afterSix?"Tonight":"Today",story)}${card("Continue where you left off",catchup||empty("Nothing in progress","Start tracking a show and your next episode will appear here.","Find a show","search"))}<div class="mx-shortcuts">${action("tab-week","🗓 Plan the week")}${action("tab-catchup","↗ Catch up")}${action("tab-discover","✨ Find something")}</div>`;
  }
  function renderWeek(){
    const rows=eventRows(7,false), grouped=new Map();
    for(const row of rows){ const key=dayKey(new Date(row.ts*1000)); if(!grouped.has(key)) grouped.set(key,[]); grouped.get(key).push(row); }
    const count=rows.length, watchedWeek=watchedThisWeek(), mins=count*(+get("episodeMinutes",24)||24), goal=clamp(get("weeklyGoal",3),1,30);
    const weeks=[...grouped.entries()].map(([day,items])=>`<section class="mx-day"><h4>${escText(dayLabel(new Date(day+"T12:00:00")))} <span>${items.length} ep${items.length===1?"":"s"}</span></h4>${items.map(episodeRow).join("")}</section>`).join("");
    const estimate=`<div class="mx-stats"><div><b>${count}</b><span>episodes queued</span></div><div><b>≈ ${runtimeText(mins)}</b><span>estimated watch time</span></div><div><b>${tracked().filter(isLiveStatus).length}</b><span>active shows</span></div></div><div class="mx-goal"><div><b>Weekly watch goal</b><span>${Math.min(watchedWeek,goal)} / ${goal} episodes watched</span></div><div class="mx-progress"><i style="width:${Math.min(100,Math.round(watchedWeek/goal*100))}%"></i></div></div>`;
    const print=`<div class="mx-actions">${action("print","Print this week")}${action("calendar","Open calendar")}</div>`;
    return `${estimate}<p class="mx-hint">Estimated using ${+get("episodeMinutes",24)||24} minutes per episode. Times use your device’s time zone; the estimate adjusts when you change episode length below.</p>${weeks||empty("No releases in the next week","This week is clear. Browse your list for a completed series or preview next season.","Preview next season","season")}${card("Compare release times","<p>Choose a show to compare its broadcast, sub and dub dates when those dates are available.</p><select class=\"mx-input\" data-xselect=\"variant-show\"><option value=\"\">Choose a followed show</option>"+tracked().map(md=>`<option value=\"${escText(md.id)}\">${escText(safeTitle(md))}</option>`).join("")+"</select><div id=\"mxVariants\" class=\"mx-variant-list\"></div>")}<div class="mx-shortcuts">${print}${action("tab-catchup","Make a catch-up plan")}</div>`;
  }
  function catchupRows(){
    return tracked().filter(md=>["watching","plan",""].includes(getStatusOf(md.id))).map(md=>{
      const total=totalEps(md), available=Math.max(typeof availableEp==="function"?availableEp(md):0,total&&md.status==="FINISHED"?total:0), left=Math.max(0,available-watchedEps(md));
      return {md,left,available,total,minutes:left*(+md.duration||24)};
    }).filter(x=>x.left>0).sort((a,b)=>a.left-b.left||safeTitle(a.md).localeCompare(safeTitle(b.md)));
  }
  function renderCatchup(){
    const rows=catchupRows(), daily=clamp(get("catchupDaily",1),1,12);
    const hours=rows.reduce((n,x)=>n+x.minutes,0);
    const items=rows.map(x=>{
      const buttons=action("catchup-start",`Plan ${daily}/day`,`data-id="${escText(x.md.id)}" data-left="${x.left}"`)+action("pause","Pause",`data-id="${escText(x.md.id)}"`);
      return showRow(x.md,`${x.left} available episode${x.left===1?"":"s"} · about ${runtimeText(x.minutes)} to catch up`,buttons);
    }).join("");
    const finished=tracked().filter(md=>md.status==="RELEASING"&&totalEps(md)).map(md=>{const total=totalEps(md),last=(md.airingSchedule&&md.airingSchedule.nodes||[]).filter(n=>n.episode===total).sort((a,b)=>a.airingAt-b.airingAt)[0];return {md,last,total};}).filter(x=>x.last&&x.last.airingAt>Date.now()/1000).sort((a,b)=>a.last.airingAt-b.last.airingAt);
    const countdown=finished.slice(0,4).map(x=>showRow(x.md,`Season finale expected ${new Date(x.last.airingAt*1000).toLocaleDateString([], {month:"short",day:"numeric"})} · ${Math.max(0,x.total-watchedEps(x.md))} eps remain`)).join("");
    const plans=rows.map(x=>`<label class="mx-checkrow">${showLink(x.md)}<span>${x.left} eps · finish in ≈ ${Math.ceil(x.left/daily)} days</span><input type="checkbox" data-catchup="${escText(x.md.id)}" checked></label>`).join("");
    const plan=rows.length?card("A manageable catch-up plan",`<div class="mx-field"><label for="mxDaily">Episodes per day</label><input class="mx-input" id="mxDaily" data-xinput="catchupDaily" type="number" min="1" max="12" value="${daily}"></div>${plans}<div class="mx-hint">All selected shows together: about ${runtimeText(hours)}. Pause a show anytime; progress stays saved.</div>`):"";
    return `<div class="mx-stats"><div><b>${rows.length}</b><span>shows with episodes ready</span></div><div><b>${rows.reduce((n,x)=>n+x.left,0)}</b><span>episodes to catch up</span></div><div><b>≈ ${runtimeText(hours)}</b><span>total watch time</span></div></div>${rows.length?card("Catch up",items):empty("You’re caught up","Nothing available to watch right now. Your next releases will appear in My Week.","See what’s airing","calendar")}${plan}${card("Season finales coming up",countdown||`<p class="mx-muted">No followed season finale has a confirmed date yet.</p>`)}${action("clear-completed","Hide completed shows from My Plan")}`;
  }
  const MOODS={comfort:{label:"Comfort watch",genres:["Comedy","Slice of Life","Romance"]},action:{label:"Big adventure",genres:["Action","Adventure","Fantasy"]},mystery:{label:"A mystery",genres:["Mystery","Thriller","Psychological"]},short:{label:"Something short",max:360},fresh:{label:"Currently airing",airing:true},wild:{label:"Outside my usual picks",wild:true}};
  function filteredCandidates(){
    const mood=get("mood","comfort"), pref=MOODS[mood]||MOODS.comfort, max=+get("maxRuntime",0)||0;
    let pool=allMedia().filter(md=>!state.watch.has(String(md.id))&&!state.hidden.has(String(md.id))&&(!state.hideNSFW||!isAdultMedia(md)));
    if(pref.genres) pool=pool.filter(md=>(md.genres||[]).some(g=>pref.genres.includes(g)));
    if(pref.airing) pool=pool.filter(md=>md.status==="RELEASING");
    if(pref.max) pool=pool.filter(md=>runtimeMins(md)<=pref.max);
    if(max) pool=pool.filter(md=>runtimeMins(md)<=max);
    const ignored=new Set(get("ignoredGenres",[]));
    pool=pool.filter(md=>!(md.genres||[]).some(g=>ignored.has(g)));
    if(pref.wild&&typeof recommendations==="function"){
      const rec=recommendations("wild"); if(rec&&rec.ready){const byId=new Map(rec.rows.map(r=>[String(r.id),r]));pool=pool.map(md=>({md,score:(byId.get(String(md.id))||{}).score||0,novelty:(byId.get(String(md.id))||{}).novelty||0})).sort((a,b)=>b.novelty-a.novelty||b.score-a.score).map(x=>x.md);}
    }
    return pool;
  }
  function renderDiscover(){
    const current=get("mood","comfort"), pool=filteredCandidates();
    const currentShow=state.showId&&mediaById(state.showId);
    const taste=typeof recommendations==="function"?recommendations("safe"):null;
    const seasonal=typeof seasonPreviewRows==="function"?seasonPreviewRows().slice(0,5):[];
    const moodButtons=Object.entries(MOODS).map(([id,m])=>`<button type="button" class="mx-mood ${id===current?"on":""}" data-xmood="${id}" aria-pressed="${id===current}">${m.label}</button>`).join("");
    const candidate=pool.slice(0,8).map(md=>{
      const actions=action("compare-add","＋ Compare",`data-id="${escText(md.id)}"`)+action("later","Decide later",`data-id="${escText(md.id)}"`)+action("exclude","Not for me",`data-id="${escText(md.id)}"`);
      return showRow(md,`${(md.genres||[]).slice(0,3).join(" · ")||"Anime"}${md.averageScore?` · ★ ${md.averageScore}`:""}`,actions);
    }).join("");
    const because=taste&&taste.ready?taste.rows.slice(0,4).map(r=>showRow(r.md,`Because you liked ${(r.why||[]).slice(0,2).map(w=>w.value||w).join(" and ")||"similar shows"} · predicted ${r.score.toFixed(1)}/10`,action("compare-add","＋ Compare",`data-id="${escText(r.id)}"`))).join(""):"";
    const similar=currentShow&&typeof recSimilar==="function"?"":currentShow?showRow(currentShow,"Start discovery from this show",action("open-show","View similar shows",`data-id="${escText(currentShow.id)}"`)):"";
    const season=seasonal.map(r=>{
      const actions=action("compare-add","＋ Compare",`data-id="${escText(r.id)}"`);
      return showRow(r.md,`Upcoming · ${(r.md.genres||[]).slice(0,2).join(" · ")||"Anime"}${r.score!=null?` · predicted ${r.score.toFixed(1)}`:""}`,actions);
    }).join("");
    return `${card("What are you in the mood for?",`<div class="mx-moods" role="group" aria-label="Choose a mood">${moodButtons}</div><div class="mx-field"><label for="mxMaxRuntime">Time available</label><select class="mx-input" id="mxMaxRuntime" data-xselect="maxRuntime"><option value="0">Any length</option><option value="180" ${+get("maxRuntime",0)===180?"selected":""}>Under 3 hours</option><option value="360" ${+get("maxRuntime",0)===360?"selected":""}>Under 6 hours</option><option value="720" ${+get("maxRuntime",0)===720?"selected":""}>Under 12 hours</option></select></div>${action("surprise","🎲 Pick one for me")}${action("quiz","Ask me two quick questions")}`)}<div class="mx-hint">Showing ${pool.length} unseen title${pool.length===1?"":"s"} from the data already loaded. Streaming availability varies by country; open a show to see AniList’s listed links.</div>${card("Your shortlist",`<div class="mx-shortlist">${renderShortlist()}</div>${action("compare","Compare my shortlist",selected.size<2?"disabled":"")}`)}${card("Picked for your taste",because||`<p class="mx-muted">Rate a few shows to unlock explainable recommendations, or use the mood picker above.</p>`)}${currentShow?card("Something like the show you’re viewing",similar):""}${card("Next season preview",season||`<p class="mx-muted">Load the next season from the app’s For you view to see a personalized preview here.</p>`)}${card("Search help","<p>Try <code>genre:romance</code>, <code>format:movie</code>, <code>status:airing</code>, or press Ctrl/⌘K to jump to a show. Search also forgives typos.</p>")}`;
  }
  function renderShortlist(){
    const ids=[...selected].slice(0,4),rows=ids.map(id=>{const md=mediaById(id);return md?`<span class="mx-short-chip">${escText(safeTitle(md))}<button type="button" aria-label="Remove ${escText(safeTitle(md))}" data-xaction="compare-remove" data-id="${escText(id)}">×</button></span>`:""}).join("");
    return rows||`<p class="mx-muted">Add up to four shows from a recommendation to compare runtime, episodes, genres, score and release status.</p>`;
  }
  function renderLibrary(){
    const list=tracked().sort((a,b)=>safeTitle(a).localeCompare(safeTitle(b)));
    const statuses=["watching","plan","onhold","completed","dropped"];
    const groups=statuses.map(key=>{
      const group=list.filter(md=>getStatusOf(md.id)===key);
      const rows=group.map(md=>showRow(md,`${getStatusOf(md.id)}${rewatchCount(md.id)?` · ${rewatchCount(md.id)} rewatch${rewatchCount(md.id)===1?"":"es"}`:""}`,`<label class="mx-select"><input type="checkbox" data-xselect-id="${escText(md.id)}" ${selected.has(String(md.id))?"checked":""}> Select</label>${action("journal","📝 Journal","data-id="+escText(md.id))}${action("later","Decide later","data-id="+escText(md.id))}`)).join("");
      return group.length?card(`${key[0].toUpperCase()+key.slice(1)} · ${group.length}`,rows):"";
    }).join("");
    const bulk=`<div class="mx-actions">${action("bulk-pause","Pause selected",selected.size?"":"disabled")}${action("bulk-hide-completed","Hide completed",list.some(md=>getStatusOf(md.id)==="completed")?"":"disabled")}${action("bulk-list","Move selected to a list",selected.size?"":"disabled")}</div>`;
    const lists=(state.collections||[]).map(c=>`<li>${escText(c.name)} <span>${c.ids.length} shows</span>${action("share-collection","Share","data-id="+escText(c.id))}</li>`).join("");
    const collectionCard=card("Your collections",`<ul class="mx-simple-list">${lists||"<li>No collections yet. Add a show to a list from its detail page.</li>"}</ul>${action("make-list","＋ Create a shareable list")}`);
    const newSeason=newSeasonRows();
    const seasonFollows=new Set(get("seasonFollow",[]).map(String));
    const nextSeason=newSeason.map(x=>showRow(x.md,`Sequel to ${safeTitle(x.parent)} · ${x.md.status==="RELEASING"?"airing now":"upcoming"}`,action("season-follow",seasonFollows.has(String(x.md.id))?"✓ Following":"🔔 Follow new season",`data-id="${escText(x.md.id)}"`))).join("");
    return `<div class="mx-actions">${action("sample","Preview with sample data")}${action("calendar","Open calendar")}</div>${groups||empty("Your library is empty","Search a show and add it to Watching, Plan to Watch, or a custom list. Nothing is uploaded unless you connect AniList.","Find a show","search")}${list.length?card("Bulk actions",bulk):""}${collectionCard}${card("New season follow-up",nextSeason||`<p class="mx-muted">Upcoming titles appear as the schedule loads. Add completed series to AniList or your list so sequels are easier to spot.</p>`)}${card("Availability notes",`<p>Keep your own region and service reminder on a show. These notes are private and are not a promise that a service carries the title.</p>${list.slice(0,8).map(md=>`<label class="mx-field"><span>${escText(safeTitle(md))}</span><input class="mx-input" data-xavailability="${escText(md.id)}" maxlength="120" placeholder="Where you watch / regional note" value="${escText(get("availability",{})[String(md.id)]||"")}"></label>`).join("")}`)}`;
  }
  function recapCounts(year){
    const prefix=String(year)+"-", rows=(state.activity||[]).filter(r=>Array.isArray(r)&&String(r[2]||"").startsWith(prefix));
    const ids=(type)=>new Set(rows.filter(r=>r[0]===type).map(r=>String(r[1]))).size;
    const episodes=rows.filter(r=>r[0]==="ep").reduce((n,r)=>n+(+r[3]||1),0);
    const top=Object.entries(state.ratings||{}).filter(([id,score])=>+score>0&&mediaById(id)).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const genres={}; for(const md of tracked()) for(const g of md.genres||[]) genres[g]=(genres[g]||0)+1;
    return {rows,added:ids("add"),finished:ids("finish"),rated:ids("rate"),episodes,top,genres:Object.entries(genres).sort((a,b)=>b[1]-a[1]).slice(0,4)};
  }
  function renderRecap(){
    const year=+get("recapYear",new Date().getFullYear()), r=recapCounts(year), knownFrom=typeof activitySince==="function"?activitySince():null;
    const incomplete=knownFrom&&knownFrom.slice(0,4)>String(year);
    const top=r.top.map(([id,score])=>{const md=mediaById(id);return md?showRow(md,`Your rating · ${(+score).toFixed(1)}/10`):""}).join("");
    const stats=`<div class="mx-stats mx-stats-4"><div><b>${r.episodes}</b><span>episodes marked watched</span></div><div><b>${r.finished}</b><span>shows completed in activity</span></div><div><b>${r.rated}</b><span>shows rated</span></div><div><b>${r.added}</b><span>shows added</span></div></div>`;
    const genreLine=r.genres.map(([g,n])=>`${g} (${n})`).join(" · ")||"No genre history yet";
    const seasons=[["Winter",[1,2,3]],["Spring",[4,5,6]],["Summer",[7,8,9]],["Fall",[10,11,12]]].map(([name,months])=>{
      const rows=r.rows.filter(x=>months.includes(+String(x[2]||"").slice(5,7)));
      const episodes=rows.filter(x=>x[0]==="ep").reduce((n,x)=>n+(+x[3]||1),0);
      const finished=new Set(rows.filter(x=>x[0]==="finish").map(x=>String(x[1]))).size;
      return `<div><b>${name}</b><span>${episodes} episodes · ${finished} completed</span></div>`;
    }).join("");
    return `<div class="mx-actions"><label class="mx-field">Year <select class="mx-input" data-xselect="recapYear">${Array.from({length:6},(_,i)=>new Date().getFullYear()-i).map(y=>`<option ${y===year?"selected":""}>${y}</option>`).join("")}</select></label>${action("share-recap","Create a share card")}${action("print","Print recap")}</div>${stats}${incomplete?`<p class="mx-hint">Your activity log begins ${escText(knownFrom)}; earlier activity isn’t included. Finished dates and ratings are based on what is still saved on this device.</p>`:""}${card("Your year in anime",`<p>You watched ${r.episodes} episode${r.episodes===1?"":"s"}, completed ${r.finished} shows and rated ${r.rated} titles in ${year}.</p><p>Most common genres in your current list: <b>${escText(genreLine)}</b></p><p class="mx-muted">This recap is generated from local activity. It may be incomplete if you only recently started using this browser.</p>`)}${card("Season recap",`<div class="mx-stats mx-stats-4">${seasons}</div><p class="mx-muted">Season totals use the activity recorded in this browser, so older seasons may be incomplete.</p>`)}${card("Your highest-rated shows",top||`<p class="mx-muted">Rate a show and it will appear here.</p>`)}`;
  }
  function renderSettings(){
    const spoiler=get("spoilerSafe",true), quiet=get("quiet",{enabled:false,start:"22:00",end:"08:00"}), textScale=clamp(get("textScale",100),90,130), contrast=get("highContrast",false);
    const order=get("homeOrder",tabList.map(t=>t[0]));
    const cardRows=order.map((id,i)=>`<div class="mx-order"><span>${escText(tabList.find(t=>t[0]===id)?.[1]||id)}</span><button type="button" data-xorder="${i}|-1" aria-label="Move up" ${i===0?"disabled":""}>↑</button><button type="button" data-xorder="${i}|1" aria-label="Move down" ${i===order.length-1?"disabled":""}>↓</button><button type="button" data-xhide="${escText(id)}">${get("hiddenTabs",[]).includes(id)?"Show":"Hide"}</button></div>`).join("");
    const permission=("Notification" in window)?Notification.permission:"unsupported";
    return `${card("Your home screen",`<p>Choose what appears in My Plan and put the sections you use most first.</p>${cardRows}<div class="mx-actions">${action("reset-order","Restore default order")}${action("widget-link","Create a compact home-screen link")}</div>`)}${card("Spoiler and data preferences",`<label class="mx-toggle"><input type="checkbox" data-xtoggle="spoilerSafe" ${spoiler?"checked":""}> Hide unreleased episode titles and plot details in My Plan</label><label class="mx-toggle"><input type="checkbox" data-xtoggle="lowBandwidth" ${get("lowBandwidth",false)?"checked":""}> Low-bandwidth mode: hide cover art and reduce animation</label><label class="mx-toggle"><input type="checkbox" data-xtoggle="highContrast" ${contrast?"checked":""}> Higher contrast</label><label class="mx-field">Text size <input type="range" min="90" max="130" step="5" value="${textScale}" data-xrange="textScale"><span>${textScale}%</span></label><label class="mx-field">Weekly goal <input class="mx-input" type="number" min="1" max="30" value="${clamp(get("weeklyGoal",3),1,30)}" data-xinput="weeklyGoal"></label><label class="mx-field">Minutes per episode <input class="mx-input" type="number" min="5" max="120" value="${clamp(get("episodeMinutes",24),5,120)}" data-xinput="episodeMinutes"></label><p class="mx-hint">The board, notes, ratings and these preferences are stored in this browser. Share links include only titles you select.</p>`)}${card("Episode alerts",`<p>Current browser permission: <b>${escText(permission)}</b>. We explain the choices before asking the browser; permission is requested only after you press Enable.</p><label class="mx-toggle"><input type="checkbox" data-xtoggle="quiet.enabled" ${quiet.enabled?"checked":""}> Quiet hours</label><div class="mx-actions"><label class="mx-field">From <input class="mx-input" type="time" data-xquiet="start" value="${escText(quiet.start||"22:00")}"></label><label class="mx-field">Until <input class="mx-input" type="time" data-xquiet="end" value="${escText(quiet.end||"08:00")}"></label></div><div class="mx-field"><label for="mxLead">Default alert lead time</label><select class="mx-input" id="mxLead" data-xselect="notifyLead">${[5,10,15,30].map(n=>`<option value="${n}" ${+state.notifyLead===n?"selected":""}>${n} minutes</option>`).join("")}</select></div><p class="mx-hint">Each show can still override the lead time and alert release in its schedule. Quiet hours move alerts to the next morning.</p>${action("enable-alerts","🔔 Enable browser alerts")}`)}${card("Time zone preview",`<p>Your calendar uses your device’s local zone. Preview the next release in another zone:</p><select class="mx-input" data-xselect="timezone"><option value="local">Device time zone</option>${["UTC","Europe/Berlin","America/New_York","America/Los_Angeles","Asia/Tokyo","Australia/Sydney"].map(z=>`<option value="${z}" ${get("timezone","local")===z?"selected":""}>${z}</option>`).join("")}</select><div class="mx-hint">Chosen preview zone is saved on this device.</div>`)}${card("Keyboard and help",`<p>Keyboard: <kbd>Ctrl/⌘ K</kbd> search · <kbd>←</kbd>/<kbd>→</kbd> change date · <kbd>T</kbd> jump to today · <kbd>?</kbd> shortcuts.</p><p>Use Tab and Shift+Tab to move around this panel. Press Escape to close it.</p><div class="mx-actions">${action("help","Open help & privacy guide")}${action("tour","Restart first-run walkthrough")}${action("sample","Preview sample calendar")}</div>`)}${card("Offline and storage",`<p role="status">${navigator.onLine?"Online — the app will refresh the schedule when opened.":"Offline — cached schedule and all local tracking remain available."}</p><p>The site can be installed as a PWA. A compact personalized agenda can be added as a browser home-screen shortcut; web browsers do not provide a live OS widget API to this site.</p>${action("data-settings","Open data backup & AniList settings")}`)}`;
  }
  function renderShare(){
    const collections=(state.collections||[]).map(c=>`<option value="${escText(c.id)}">${escText(c.name)} (${c.ids.length})</option>`).join("");
    const seasonal=tracked().filter(md=>String(md.seasonYear||md.startDate?.year||"")===String(new Date().getFullYear())||md.status==="RELEASING");
    const rows=seasonal.map(md=>`<label class="mx-checkrow">${showLink(md)}<span>${escText((md.genres||[]).slice(0,2).join(" · "))}</span><input type="checkbox" data-xshare="${escText(md.id)}" ${get("shareSelected",[]).includes(String(md.id))?"checked":""}></label>`).join("");
    const shareList=rows||empty("No seasonal picks yet","Add a show to your list, or select a custom collection below.","Go to Library","tab-library");
    return `${card("Season watchlist",`<p>Select the titles you want to share. Shared pages contain public title metadata only; your scores, notes, progress and alert settings stay private.</p>${shareList}<div class="mx-actions"><label class="mx-field">Or choose a collection <select class="mx-input" data-xselect="shareCollection"><option value="">Choose collection</option>${collections}</select></label><label class="mx-toggle"><input type="checkbox" data-xtoggle="shareScores" ${get("shareScores",false)?"checked":""}> Include my selected ratings</label></div>${action("share-watchlist","Create read-only share link",(get("shareSelected",[]).length||get("shareCollection",""))?"":"disabled")}`)}${card("Watch together",`<p>Share a small shortlist with friends without exposing your account, notes, or full library.</p><div class="mx-shortlist">${renderShortlist()}</div>${action("share-shortlist","Share this shortlist",selected.size?"":"disabled")}`)}${card("Share cards and recaps",`<p>Generate a title card, a seasonal highlight card, or your year in review. Cards use the titles and options you select.</p><div class="mx-actions">${action("share-card","Create a card for a show",selected.size?"":"disabled")}${action("share-recap","Create my year card")}${action("season-card","Create seasonal card")}</div><div id="mxShareResult"></div>`)}${card("Embed / home-screen agenda",`<p>Create a compact link that shows only public release times for selected shows. Add that link to your phone’s home screen for quick access.</p>${action("widget-link","Create agenda shortcut")}`)}`;
  }
  function renderQuiz(){
    const mood=get("quizMood","comfort"), length=+get("quizLength",360), airing=get("quizAiring",false);
    return `<div class="mx-quiz"><p>Two quick choices, then we’ll choose from shows already in the schedule.</p><label class="mx-field">What sounds good? <select class="mx-input" data-xselect="quizMood">${Object.entries(MOODS).map(([k,v])=>`<option value="${k}" ${mood===k?"selected":""}>${escText(v.label)}</option>`).join("")}</select></label><label class="mx-field">How much time? <select class="mx-input" data-xselect="quizLength"><option value="180" ${length===180?"selected":""}>A few hours</option><option value="360" ${length===360?"selected":""}>A short season</option><option value="99999" ${length===99999?"selected":""}>Any length</option></select></label><label class="mx-toggle"><input type="checkbox" data-xtoggle="quizAiring" ${airing?"checked":""}> Only titles airing now</label>${action("quiz-pick","Pick a show")}</div>`;
  }
  function renderCompare(){
    const rows=[...selected].map(id=>mediaById(id)).filter(Boolean);
    if(rows.length<2) return empty("Choose two to compare","Add shows from Discover or Library. We compare public metadata; your ratings are shown only here, on your device.","Browse recommendations","tab-discover");
    return `<div class="mx-compare" role="table" aria-label="Anime shortlist comparison"><div class="mx-compare-head"><span>Title</span>${rows.map(md=>showLink(md)).join("")}</div>${[["Episodes",md=>totalEps(md)||"Unknown"],["Approx watch time",md=>runtimeText(runtimeMins(md))||"Unknown"],["Genres",md=>(md.genres||[]).slice(0,4).join(", ")||"Unknown"],["Community score",md=>md.averageScore?`★ ${md.averageScore}/100`:"Not listed"],["Your rating",md=>getRating(md.id)?`${getRating(md.id)}/10`:"Not rated"],["Status",md=>md.status||"Unknown"],["Streaming links",md=>(md.externalLinks||[]).filter(x=>x.type==="STREAMING").length?`${(md.externalLinks||[]).filter(x=>x.type==="STREAMING").length} listed on AniList`:"No link listed"]].map(([label,fn])=>`<div class="mx-compare-row"><b>${label}</b>${rows.map(md=>`<span>${escText(String(fn(md)))}</span>`).join("")}</div>`).join("")}</div>${action("back-discover","Back to Discover")}`;
  }
  function renderContent(){
    if(currentTab==="today") return renderToday();
    if(currentTab==="week") return renderWeek();
    if(currentTab==="catchup") return renderCatchup();
    if(currentTab==="discover") return get("quizOpen",false)?renderQuiz():get("compareOpen",false)?renderCompare():renderDiscover();
    if(currentTab==="library") return renderLibrary();
    if(currentTab==="recap") return renderRecap();
    if(currentTab==="share") return renderShare();
    return renderSettings();
  }
  function render(){
    content.innerHTML=shell(renderContent());
    if(currentTab==="discover"&&get("compareOpen",false)){
      const compare=content.querySelector(".mx-compare"), columns=compare&&compare.querySelectorAll(".mx-compare-head .mx-title").length;
      if(compare&&columns){compare.style.setProperty("--mx-columns",columns);compare.style.setProperty("--mx-min-width",`${160+columns*138}px`);}
    }
    const promptId=get("ratePrompt","");
    if(promptId&&currentTab!=="today"&&!getRating(promptId)){
      const md=mediaById(promptId), body=content.querySelector(".mx-content");
      if(md&&body)body.insertAdjacentHTML("afterbegin",card("Quick rating",`${showRow(md,"You just marked an episode watched.",action("rate","⭐ Rate now",`data-id="${escText(promptId)}"`))}${action("dismiss-rating","Later")}`));
    }
    if(currentTab==="week"){
      const select=content.querySelector('[data-xselect="variant-show"]');
      if(select){ select.value=get("variantShow",""); if(select.value) updateVariantCard(select.value); }
    }
  }
  function open(tab="today", trigger=null){
    currentTab=tabList.some(t=>t[0]===tab)?tab:"today"; returnFocus=trigger||document.activeElement;
    root.hidden=false; root.setAttribute("aria-hidden","false"); requestAnimationFrame(()=>root.classList.add("on")); document.body.classList.add("mx-open"); render();
    const close=root.querySelector("[data-xclose]"); if(close) close.focus();
  }
  function close(){ root.classList.remove("on"); root.setAttribute("aria-hidden","true"); document.body.classList.remove("mx-open"); setTimeout(()=>{ if(!root.classList.contains("on")) root.hidden=true; },180); if(returnFocus&&returnFocus.focus) returnFocus.focus(); }
  function goto(tab){ currentTab=tab; put("tab",tab); put("quizOpen",false); put("compareOpen",false); render(); const t=root.querySelector(`[data-xtab="${tab}"]`); if(t) t.focus(); }
  function startTour(){
    let step=0;
    const pages=[
      ["Your watch list","Add a few shows using Search or Discover. This browser keeps your progress, notes, and ratings locally. You can export them or connect AniList in Settings.","Open Search","search"],
      ["Choose your release","Tsuzuki can show the Japanese broadcast, subtitles, and confirmed dubs. Your calendar time zone comes from this device; choose a second zone in Customize.","Open release settings","air"],
      ["Alerts are optional","You can set a per-show bell and lead time. The browser asks permission only after you choose Enable. Nothing is sent to a server unless you opt into an account integration.","Finish","done"]
    ];
    const draw=()=>{
      const p=pages[step]; content.innerHTML=shell(`<div class="mx-tour"><div class="mx-tour-step">${step+1} of ${pages.length}</div><h3>${escText(p[0])}</h3><p>${escText(p[1])}</p><div class="mx-actions"><button type="button" data-xaction="tour-back" ${step===0?"disabled":""}>Back</button><button type="button" class="primary" data-xaction="tour-next">${p[2]}</button><button type="button" data-xaction="tour-skip">Skip</button></div></div>`);
    };
    put("tourDone",false); currentTab="settings"; open("settings"); step=0; draw();
    root.dataset.tour="1";
  }
  function finishTour(){put("tourDone",true);delete root.dataset.tour;render();toast("You’re all set. Your plan is ready.");}
  function mdOpen(id){ const md=mediaById(id); close(); if(md&&typeof openShowById==="function") openShowById(id); else if(typeof openShowById==="function") openShowById(id); }
  function rememberShare(ids){ put("shareSelected",[...new Set(ids.map(String))].slice(0,40)); }
  function base64json(obj){ const bytes=new TextEncoder().encode(JSON.stringify(obj)); let binary=""; for(const b of bytes) binary+=String.fromCharCode(b); return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
  function sharedUrl(payload){ return `${location.origin}${location.pathname}?watchlist=${encodeURIComponent(base64json(payload))}`; }
  function copyText(text){
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=>toast("Share link copied.")).catch(()=>window.prompt("Copy this link:",text));
    else window.prompt("Copy this link:",text);
  }
  function makeShareCard(ids,heading="My anime picks",scores=false){
    const shows=ids.map(mediaById).filter(Boolean).slice(0,8),canvas=document.createElement("canvas");
    canvas.width=1200;canvas.height=630;const ctx=canvas.getContext("2d");
    const grad=ctx.createLinearGradient(0,0,1200,630);grad.addColorStop(0,"#201321");grad.addColorStop(1,"#4c1f36");ctx.fillStyle=grad;ctx.fillRect(0,0,1200,630);
    ctx.fillStyle="#ff6a4e";ctx.fillRect(60,70,12,490);ctx.fillStyle="#fff";ctx.font="700 50px system-ui";ctx.fillText(String(heading).slice(0,30),100,130);
    ctx.font="24px system-ui";ctx.fillStyle="rgba(255,255,255,.72)";ctx.fillText("Tsuzuki · my anime picks",100,174);
    shows.forEach((md,i)=>{const y=242+i*47;ctx.fillStyle="#fff";ctx.font="600 26px system-ui";ctx.fillText((i+1)+". "+safeTitle(md).slice(0,48),100,y);if(scores&&getRating(md.id)){ctx.fillStyle="#ffca63";ctx.font="600 22px system-ui";ctx.fillText((+getRating(md.id)).toFixed(1)+"/10",1030,y);}});
    ctx.fillStyle="rgba(255,255,255,.5)";ctx.font="18px system-ui";ctx.fillText("Shared by choice · private notes and progress are not included",100,585);
    const link=document.createElement("a");link.download="tsuzuki-anime-picks.png";link.href=canvas.toDataURL("image/png");link.click();
    const result=root.querySelector("#mxShareResult");if(result)result.innerHTML=`<p role="status">Share card downloaded. ${shows.length} titles included.</p>`;
  }
  function newSeasonRows(){
    const complete=tracked().filter(md=>getStatusOf(md.id)==="completed");
    const completeIds=new Set(complete.map(md=>String(md.id))), candidates=allMedia();
    const rows=[];
    for(const parent of complete){
      for(const edge of (parent.relations&&parent.relations.edges)||[]){
        const rel=edge.relationType||edge.relationTypeVersion2;
        const child=edge.node; if(!child||rel!=="SEQUEL") continue;
        const md=mediaById(child.id)||child;
        if(!state.watch.has(String(md.id))) rows.push({parent,md});
      }
    }
    return rows.filter((x,i,a)=>a.findIndex(y=>String(y.md.id)===String(x.md.id))===i).slice(0,8);
  }
  function updateVariantCard(id){
    const slot=root.querySelector("#mxVariants");if(!slot)return;
    const md=mediaById(id), nodes=md&&md.airingSchedule&&md.airingSchedule.nodes||[];
    const node=nodes.filter(n=>n.airingAt>Date.now()/1000).sort((a,b)=>a.airingAt-b.airingAt)[0];
    if(!node){slot.innerHTML=`<p class="mx-muted">No upcoming episode is listed for this show.</p>`;return;}
    const variants=typeof variantsFor==="function"?variantsFor(md,node).variants:[];
    const zone=get("timezone","local");
    slot.innerHTML=variants.length?variants.map(v=>`<div class="mx-variant"><b>${escText(typeLabel(v))}</b><span>${new Date(v.ts*1000).toLocaleString([], {weekday:"short",month:"short",day:"numeric"})} · ${timeLabel(v.ts)}${zone!=="local"?` · ${timeLabel(v.ts,zone)} ${escText(zone)}`:""}</span><small>${v.estimated?"Estimated from the broadcast schedule":"Listed / confirmed correction"}</small></div>`).join(""):`<p class="mx-muted">Only one release time is available.</p>`;
  }
  function rescheduleAlerts(){
    if(typeof clearAllScheduled==="function")clearAllScheduled();
    if(typeof clearAllTriggered==="function")clearAllTriggered().then(()=>{if(typeof scheduleNotifications==="function")scheduleNotifications();});
    else if(typeof scheduleNotifications==="function")scheduleNotifications();
    if(typeof syncPushSubscription==="function")syncPushSubscription();
  }
  function setupShowTools(){
    const body=document.getElementById("modalBody");if(!body)return;
    const inject=()=>{
      const main=body.querySelector(".detail-main");if(!main||main.querySelector(".mx-show-tools"))return;
      const marker=body.querySelector("[data-watch],[data-st-label]");const id=marker&&(marker.dataset.watch||marker.dataset.stLabel);if(!id)return;
      const md=mediaById(id), levels=get("spoilerLevels",{}), level=levels[id]||(get("spoilerSafe",true)?"hide":"show");
      const leads=(()=>{try{return JSON.parse(localStorage.getItem("anical.notifyLeadBy")||"{}");}catch(_){return {};}})();
      const alerts=(()=>{try{return JSON.parse(localStorage.getItem("anical.notifyAirBy")||"{}");}catch(_){return {};}})();
      const rels=(md&&md.relations&&md.relations.edges||[]).filter(e=>e&&e.node&&e.node.type==="ANIME");
      const order=rels.map(e=>`${e.relationType||"Related"}: ${e.node.title&&(e.node.title.english||e.node.title.romaji)||"Related title"}`).slice(0,4).join(" · ");
      const services=(md&&md.externalLinks||[]).filter(x=>x&&x.type==="STREAMING").slice(0,6);
      const box=document.createElement("section");box.className="mx-show-tools";box.innerHTML=`<h4>My watch details</h4><div class="mx-meta">${md&&totalEps(md)?`About ${runtimeText(runtimeMins(md))} to finish · ${md.episodes} episodes`:"Watch-time estimate unavailable until the episode count is known."}${order?` · Start here: ${escText(order)}`:""}</div><div class="mx-actions"><button type="button" data-xaction="journal" data-id="${escText(id)}">📝 Private journal</button><button type="button" data-xaction="show-card" data-id="${escText(id)}">▧ Share card</button></div><label class="mx-field">Spoilers <select class="mx-input" data-xspoiler="${escText(id)}"><option value="hide" ${level==="hide"?"selected":""}>Hide plot details</option><option value="blur" ${level==="blur"?"selected":""}>Blur until tapped</option><option value="show" ${level==="show"?"selected":""}>Show details</option></select></label><label class="mx-field">Resume reminder <input class="mx-input" data-xprogress-note="${escText(id)}" maxlength="100" value="${escText(get("progressNote",{})[id]||"")}" placeholder="Resume at episode 6"></label><div class="mx-actions"><label class="mx-quick-pref">Alert lead <select data-xlead="${escText(id)}"><option value="5" ${+(leads[id]||state.notifyLead)===5?"selected":""}>5 min</option><option value="10" ${+(leads[id]||state.notifyLead)===10?"selected":""}>10 min</option><option value="15" ${+(leads[id]||state.notifyLead)===15?"selected":""}>15 min</option><option value="30" ${+(leads[id]||state.notifyLead)===30?"selected":""}>30 min</option></select></label><label class="mx-quick-pref">Alert for <select data-xair="${escText(id)}"><option value="auto" ${!alerts[id]?"selected":""}>Preferred release</option><option value="raw" ${alerts[id]==="raw"?"selected":""}>Broadcast</option><option value="sub" ${alerts[id]==="sub"?"selected":""}>Sub</option><option value="dub" ${alerts[id]==="dub"?"selected":""}>Dub</option></select></label></div><div class="mx-hint">Where to watch: ${services.length?services.map(x=>`<a href="${escText(x.url)}" target="_blank" rel="noopener">${escText(x.site)}</a>`).join(" · ")+" · listed by AniList; check your region":"No streaming link listed by AniList"}. Availability is not region-confirmed.</div>`;
      box.insertAdjacentHTML("beforeend",`<label class="mx-field">My availability note <input class="mx-input" data-xavailability="${escText(id)}" maxlength="120" placeholder="My region / service reminder" value="${escText(get("availability",{})[id]||"")}"></label>`);
      main.prepend(box);
      const desc=body.querySelector(".desc");if(desc){desc.tabIndex=0;desc.setAttribute("role","button");desc.setAttribute("aria-label",level==="show"?"Show description":"Reveal description");desc.classList.toggle("mx-spoiler-hidden",level!=="show");desc.classList.toggle("mx-spoiler-blur",level==="blur");}
    };
    inject();
  }
  function applyPrefs(){
    document.body.classList.toggle("mx-low-bandwidth",get("lowBandwidth",false));
    document.body.classList.toggle("mx-high-contrast",get("highContrast",false));
    document.body.classList.toggle("mx-spoiler-safe",get("spoilerSafe",true));
    document.documentElement.style.setProperty("--mx-text-scale",String(clamp(get("textScale",100),90,130)/100));
  }
  function toggleAlerts(){
    if(!("Notification" in window)){toast("This browser does not support episode alerts.");return;}
    if(Notification.permission==="denied"){toast("Alerts are blocked in browser settings. Change the site permission there, then try again.");return;}
    const explanation="Tsuzuki can show local episode reminders for shows you follow. The browser controls when they appear. You can turn each show off at any time. Enable alerts now?";
    if(!window.confirm(explanation)) return;
    Notification.requestPermission().then(p=>{if(typeof updateNotifyBtn==="function")updateNotifyBtn();if(p==="granted"){scheduleNotifications();if(typeof syncPushSubscription==="function")syncPushSubscription();toast("Episode alerts enabled.");}else toast("No alerts were enabled.");});
  }
  function seasonFor(id){
    const list=state.collections||[];let c=list.find(x=>x.id===id);if(c)return c;
    c=createCollection("My season picks");if(!c)return null;return c;
  }
  function renderPublished(){
    const params=new URLSearchParams(location.search),raw=params.get("watchlist");if(!raw)return false;
    try{
      const binary=atob(raw.replace(/-/g,"+").replace(/_/g,"/"));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const data=JSON.parse(new TextDecoder().decode(bytes));
      const ids=Array.isArray(data.ids)?data.ids.map(String).slice(0,40):[];
      root.classList.add("mx-published");open("share");
      const paint=()=>{
        const titleRows=ids.map(id=>{const md=mediaById(id);return md?`<article class="mx-row">${art(md)}<div class="mx-row-main"><b>${escText(safeTitle(md))}</b><div class="mx-meta">${escText((md.genres||[]).slice(0,3).join(" · "))}${md.averageScore?` · community ★ ${md.averageScore}/100`:""}${data.ratings&&data.ratings[id]?` · shared rating ${escText(data.ratings[id])}/10`:""}</div></div></article>`:`<p class="mx-muted">Loading title ${escText(id)}…</p>`}).join("");
        const schedule=ids.map(id=>mediaById(id)).filter(Boolean).flatMap(md=>(md.airingSchedule&&md.airingSchedule.nodes||[]).map(n=>{const v=typeof trackedVariant==="function"?trackedVariant(md,n):null;return v?{md,ep:n.episode,ts:v.ts||n.airingAt,air:v}:null;})).filter(r=>r&&r.ts>Date.now()/1000&&r.ts<Date.now()/1000+7*86400).sort((a,b)=>a.ts-b.ts).slice(0,15);
        const agenda=schedule.length?`<h3>Next 7 days</h3>${schedule.map(r=>`<div class="mx-row"><div class="mx-row-main"><b>${escText(safeTitle(r.md))}</b><div class="mx-meta">Episode ${r.ep} · ${dayLabel(new Date(r.ts*1000))} at ${timeLabel(r.ts)} · ${escText(typeLabel(r.air))}</div></div></div>`).join("")}`:`<p class="mx-muted">No episode time is listed for these shows in the next week.</p>`;
        content.innerHTML=shell(`<div class="mx-published-head"><span>READ-ONLY WATCHLIST</span><h3>${escText(String(data.name||"Anime watchlist").slice(0,80))}</h3><p>Selected titles only. No private notes, watch progress, alerts, or settings are shared.</p></div>${titleRows}${card("Quick agenda",agenda)}${action("calendar","Explore the release calendar")}`);
      };
      paint();
      Promise.all(ids.filter(id=>!mediaById(id)).map(async id=>{try{const md=await fetchMediaById(id);if(md&&state.extra instanceof Map)state.extra.set(String(id),md);}catch(_){}})).then(paint);
    }catch(_){toast("This shared list link is incomplete or invalid.");}
    return true;
  }
  function attachUi(){
    const launcher=document.createElement("button");launcher.type="button";launcher.id="experienceBtn";launcher.className="mx-launch";launcher.textContent="🗓 My Plan";launcher.setAttribute("aria-haspopup","dialog");launcher.setAttribute("aria-controls","mxRoot");
    const nav=document.querySelector("header .nav");if(nav){nav.append(launcher);const help=document.createElement("button");help.type="button";help.className="mx-help";help.textContent="?";help.title="Help, shortcuts, and privacy";help.setAttribute("aria-label","Open help and privacy guide");help.addEventListener("click",()=>{open("settings",help);setTimeout(()=>window.alert("Search shows with the box or Ctrl/⌘K. T jumps to today; arrow keys change the date. My Plan has your watch queue and private library tools. Notes, ratings and progress stay in this browser unless you connect AniList."),50);});nav.append(help);}
    const bottom=document.createElement("nav");bottom.className="mx-bottom";bottom.setAttribute("aria-label","Quick navigation");bottom.innerHTML=`<button data-xbottom="today" aria-label="My Plan">🗓<span>Today</span></button><button data-xbottom="calendar" aria-label="Calendar">📅<span>Calendar</span></button><button data-xbottom="library" aria-label="Library">📚<span>Library</span></button><button data-xbottom="discover" aria-label="Discover">✨<span>Discover</span></button><button data-xbottom="search" aria-label="Search">⌕<span>Search</span></button>`;
    document.body.append(bottom);
    root=document.createElement("div");root.id="mxRoot";root.className="mx-root";root.hidden=true;root.setAttribute("aria-hidden","true");
    root.innerHTML=`<div class="mx-scrim" data-xclose></div><section class="mx-dialog" role="dialog" aria-modal="true" aria-labelledby="mxTitle" tabindex="-1"><div class="mx-shell"></div></section>`;
    document.body.append(root);dialog=root.querySelector(".mx-dialog");content=root.querySelector(".mx-shell");
    launcher.addEventListener("click",()=>open("today",launcher));
    if(typeof trackedVariant==="function"){
      const base=trackedVariant;
      window.trackedVariant=function(md,node){
        let prefs={};try{prefs=JSON.parse(localStorage.getItem("anical.notifyAirBy")||"{}");}catch(_){}
        const choice=prefs[String(md&&md.id)];
        if(choice&&typeof variantsFor==="function"&&typeof visibleVariants==="function"){
          const variants=variantsFor(md,node).variants;
          return preferredVariant(variants,choice)||base(md,node);
        }
        return base(md,node);
      };
      if(typeof scheduleNotifications==="function"&&"Notification" in window&&Notification.permission==="granted")scheduleNotifications();
    }
    if(typeof toggleNotify==="function"){
      const baseToggle=toggleNotify;
      window.toggleNotify=function(id){
        if(!isFollowed(id)&&"Notification" in window&&Notification.permission==="default"){
          if(!window.confirm("Episode alerts are optional. Tsuzuki will ask your browser to show local reminders for this show; it won’t send your list to a server. Continue?"))return;
        }
        return baseToggle(id);
      };
    }
    document.addEventListener("click",onClick);
    document.addEventListener("change",onChange);
    document.addEventListener("input",onInput);
    document.addEventListener("keydown",onKey);
    window.addEventListener("online",()=>{const s=root.querySelector(".mx-status");if(s){s.classList.add("online");s.classList.remove("offline");s.textContent="● Live connection";}});
    window.addEventListener("offline",()=>{const s=root.querySelector(".mx-status");if(s){s.classList.add("offline");s.classList.remove("online");s.textContent="○ Offline · saved tracking is available";}});
    applyPrefs();
    if(renderPublished()) return;
    if(!localStorage.getItem(STORE+"tourDone")) setTimeout(()=>{
      const latest=Array.isArray(CHANGELOG)&&CHANGELOG.length?CHANGELOG[0].id:0;
      const waitForReleaseNotes=()=>{
        if(localStorage.getItem(STORE+"tourDone"))return;
        if((+localStorage.getItem("anical.changelogSeen")||0)<latest||document.querySelector("#overlay.on")){setTimeout(waitForReleaseNotes,500);return;}
        startTour();
      };
      waitForReleaseNotes();
    },1800);
  }
  function onClick(e){
    const t=e.target.closest("button,[data-xopen],[data-xclose]");if(!t)return;
    if(t.hasAttribute("data-xopen")){e.preventDefault();mdOpen(t.dataset.xopen);return;}
    if(t.id==="experienceBtn")return;
    if(t.dataset.xmood){put("mood",t.dataset.xmood);render();return;}
    if(t.hasAttribute("data-xbottom")){const v=t.dataset.xbottom;if(v==="today")open("today",t);else if(v==="calendar")setView("agenda");else if(v==="library")open("library",t);else if(v==="discover")open("discover",t);else if(v==="search")focusSearch();return;}
    if(t.hasAttribute("data-xtab")){put("compareOpen",false);goto(t.dataset.xtab);return;}
    if(t.hasAttribute("data-xclose")){close();return;}
    if(!t.hasAttribute("data-xaction"))return;
    e.preventDefault();const op=t.dataset.xaction,id=String(t.dataset.id||""),md=mediaById(id);
    if(op==="tab-week"||op==="tab-catchup"||op==="tab-discover"||op==="tab-library"){goto(op.slice(4));return;}
    if(op==="calendar"){close();setView("agenda");return;}
    if(op==="dismiss-tip"){const tips=new Set(get("tipsSeen",[]));tips.add("plan");put("tipsSeen",[...tips]);render();return;}
    if(op==="search"){close();focusSearch();return;}
    if(op==="premieres"){close();state.filters.premieresOnly=true;localStorage.setItem("anical.filters",JSON.stringify(state.filters));setView("month");return;}
    if(op==="clear-filters"){state.filters={format:"",genre:"",stream:"",tag:"",minScore:0,premieresOnly:false,mine:false};try{localStorage.setItem("anical.filters",JSON.stringify(state.filters));syncControlsFromState();renderView();}catch(_){}render();return;}
    if(op==="watched"&&md){const next=Math.max(watchedEps(md),+t.dataset.ep||0);setProgress(id,next);if(totalEps(md)&&next>=totalEps(md))setStatusOf(id,"completed");if(!getRating(id))put("ratePrompt",id);render();return;}
    if(op==="pause"&&md){setStatusOf(id,"onhold");render();toast(`${safeTitle(md)} moved to On Hold.`);return;}
    if(op==="alert"&&md){if(typeof toggleNotify==="function")toggleNotify(id);render();return;}
    if(op==="show-card"&&md){makeShareCard([id],safeTitle(md),false);return;}
    if(op==="rate"&&md){const answer=window.prompt(`Rate ${safeTitle(md)} from 1 to 10:`,getRating(id)||"");if(answer!==null){const score=clamp(answer,0,10);if(score>0){setRating(id,score);put("ratePrompt","");render();toast(`Saved your ${score}/10 rating.`);}}return;}
    if(op==="dismiss-rating"){put("ratePrompt","");render();return;}
    if(op==="later"&&md){let c=(state.collections||[]).find(x=>x.name==="Decide later");if(!c)c=createCollection("Decide later");if(c&&!c.ids.includes(id)){c.ids.push(id);saveCollections();}toast("Added to Decide later.");render();return;}
    if(op==="season-follow"&&md){const list=new Set(get("seasonFollow",[]).map(String)),auto=new Set(get("seasonAutoAlert",[]).map(String));if(list.has(id)){list.delete(id);if(auto.has(id)){auto.delete(id);if(isFollowed(id)&&typeof toggleNotify==="function")toggleNotify(id);}toast("Stopped following this sequel.");}else{list.add(id);const seen=new Set(get("seasonSeen",[]).map(String));seen.add(id);put("seasonSeen",[...seen]);if(typeof toggleNotify==="function"&&!isFollowed(id)){auto.add(id);toggleNotify(id);}toast("Following this sequel’s episode schedule.");}put("seasonAutoAlert",[...auto]);put("seasonFollow",[...list]);render();return;}
    if(op==="compare-add"&&md){if(selected.has(id))selected.delete(id);else if(selected.size<4)selected.add(id);else toast("Compare up to four titles at a time.");render();return;}
    if(op==="compare-remove"){selected.delete(id);render();return;}
    if(op==="compare"){put("compareOpen",true);render();return;}
    if(op==="back-discover"){put("compareOpen",false);render();return;}
    if(op==="surprise"){const pool=filteredCandidates();if(!pool.length){toast("No matches are loaded for those choices. Try another mood or clear a filter.");return;}const pick=pool[Math.floor(Math.random()*pool.length)];content.querySelector(".mx-content").insertAdjacentHTML("afterbegin",`<div class="mx-pick">${showRow(pick,`Picked for ${escText((MOODS[get("mood","comfort")]||MOODS.comfort).label.toLowerCase())}`,`${action("open-show","Open details",`data-id="${escText(pick.id)}"`)}${action("later","Decide later",`data-id="${escText(pick.id)}"`)}${action("exclude","Not for me",`data-id="${escText(pick.id)}"`)}`)}</div>`);return;}
    if(op==="open-show"&&md){mdOpen(id);return;}
    if(op==="exclude"&&md){const reason=window.prompt("Why should we leave this out? Enter a genre, or leave blank to skip it in this browser.");if(reason){const g=reason.trim();const ig=get("ignoredGenres",[]);ig.push(g);put("ignoredGenres",[...new Set(ig)]);}else{const no=new Set([...(state.recNo||[]),id]);state.recNo=no;try{localStorage.setItem("anical.recno",JSON.stringify([...no]));}catch(_){}}render();return;}
    if(op==="quiz"){put("quizOpen",true);put("compareOpen",false);render();return;}
    if(op==="quiz-pick"){const pool=filteredCandidates();const pref=MOODS[get("quizMood","comfort")]||MOODS.comfort;let picks=pool.filter(x=>runtimeMins(x)<=+get("quizLength",360));if(get("quizAiring",false))picks=picks.filter(x=>x.status==="RELEASING");if(!picks.length){toast("No match is loaded yet. Try a wider time range or clear the airing filter.");return;}const pick=picks[Math.floor(Math.random()*picks.length)];put("quizOpen",false);content.querySelector(".mx-content").innerHTML=`<div class="mx-pick">${showRow(pick,`Your ${escText(pref.label.toLowerCase())} pick`,`${action("open-show","Open details",`data-id="${escText(pick.id)}"`)}${action("later","Decide later",`data-id="${escText(pick.id)}"`)}`)}</div>${action("tab-discover","Pick again")}`;return;}
    if(op==="share-watchlist"||op==="share-shortlist"||op==="share-collection"||op==="widget-link"){
      let ids=op==="share-shortlist"?[...selected]:get("shareSelected",[]);
      if(op==="share-watchlist"&&!ids.length&&get("shareCollection","")){const c=(state.collections||[]).find(x=>x.id===get("shareCollection",""));ids=c?c.ids:[];}
      if(op==="share-collection"){const c=(state.collections||[]).find(x=>x.id===id);ids=c?c.ids:[];}
      if(op==="widget-link"){ids=get("shareSelected",[]);if(!ids.length)ids=tracked().filter(md=>isLiveStatus(md)).map(md=>String(md.id)).slice(0,12);}
      const ratings=get("shareScores",false)?Object.fromEntries(ids.map(x=>[String(x),getRating(x)]).filter(([,n])=>n>0)):undefined;
      const payload={name:op==="widget-link"?"My anime agenda":op==="share-shortlist"?"Watch together shortlist":"My seasonal watchlist",ids:ids.map(String).slice(0,40),...(ratings?{ratings}:{})};
      copyText(sharedUrl(payload));return;
    }
    if(op==="share-card"){const ids=selected.size?[...selected]:get("shareSelected",[]);if(!ids.length){toast("Choose at least one show first.");goto("share");return;}makeShareCard(ids,"My anime picks",get("shareScores",false));return;}
    if(op==="share-recap"){const r=recapCounts(+get("recapYear",new Date().getFullYear()));const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=630;const c=canvas.getContext("2d");c.fillStyle="#201321";c.fillRect(0,0,1200,630);c.fillStyle="#ff6a4e";c.fillRect(70,70,12,490);c.fillStyle="#fff";c.font="700 48px system-ui";c.fillText(`${get("recapYear",new Date().getFullYear())} in anime`,120,150);c.font="28px system-ui";c.fillText(`${r.episodes} episodes · ${r.finished} completed · ${r.rated} rated`,120,230);c.font="20px system-ui";c.fillStyle="rgba(255,255,255,.7)";c.fillText("Generated from this browser’s local activity",120,570);const a=document.createElement("a");a.download="tsuzuki-year-in-anime.png";a.href=canvas.toDataURL();a.click();toast("Your recap card was downloaded.");return;}
    if(op==="season-card"){const ids=get("shareSelected",[]);if(!ids.length){toast("Select a few seasonal titles first.");goto("share");return;}makeShareCard(ids,"My season picks",get("shareScores",false));return;}
    if(op==="print"){window.print();return;}
    if(op==="enable-alerts"){toggleAlerts();return;}
    if(op==="help"){window.alert("Tsuzuki stores your list, progress, ratings and notes in this browser. A shared watchlist contains only the titles you select. Search: genre:romance, format:movie, status:airing. Shortcuts: Ctrl/⌘K, T, ←/→, ?. Browser alerts are optional and controlled in Customize.");return;}
    if(op==="tour"){startTour();return;}
    if(op==="tour-next"){if(root.dataset.tour){const step=+(root.dataset.step||0);if(step>=2){finishTour();return;}root.dataset.step=String(step+1);const pages=[["Your watch list","Add a few shows using Search or Discover. This browser keeps your progress, notes, and ratings locally.","Open Search","search"],["Choose your release","Choose the broadcast, sub, or dub times you prefer. Your device time zone is used by default.","Open release settings","air"],["Alerts are optional","Alerts are per show. Enable them only if you want a browser reminder.","Finish","done"]];const p=pages[step+1];content.innerHTML=shell(`<div class="mx-tour"><div class="mx-tour-step">${step+2} of 3</div><h3>${p[0]}</h3><p>${p[1]}</p><div class="mx-actions"><button data-xaction="tour-back">Back</button><button class="primary" data-xaction="tour-next">${p[2]}</button><button data-xaction="tour-skip">Skip</button></div></div>`);root.dataset.step=String(step+1);return;}}
    if(op==="tour-back"){const step=Math.max(0,+(root.dataset.step||0)-1);root.dataset.step=String(step);const p=[["Your watch list","Add shows using Search or Discover. Your data stays in this browser.","Continue"],["Choose your release","Choose broadcast, sub, or dub times. Device time zone is used by default.","Continue"],["Alerts are optional","Enable only if you want browser reminders.","Finish"]][step];content.innerHTML=shell(`<div class="mx-tour"><div class="mx-tour-step">${step+1} of 3</div><h3>${p[0]}</h3><p>${p[1]}</p><div class="mx-actions"><button data-xaction="tour-next">${p[2]}</button><button data-xaction="tour-skip">Skip</button></div></div>`);return;}
    if(op==="tour-skip"||op==="done"){finishTour();return;}
    if(op==="air"){close();if(typeof openAirPanel==="function")openAirPanel();return;}
    if(op==="data-settings"){close();openSettings();return;}
    if(op==="sample"){put("samplePreview",true);renderSample();return;}
    if(op==="sample-close"){put("samplePreview",false);goto("today");return;}
    if(op==="bulk-pause"){for(const sel of selected)setStatusOf(sel,"onhold");selected.clear();render();toast("Selected shows moved to On Hold.");return;}
    if(op==="bulk-hide-completed"){for(const md of tracked().filter(x=>getStatusOf(x.id)==="completed"))state.archived.add(String(md.id));localStorage.setItem("anical.archived",JSON.stringify([...state.archived]));render();toast("Completed shows were archived; ratings and progress remain saved.");return;}
    if(op==="bulk-list"){const name=window.prompt("Name this list:","My shortlist");if(name){const c=createCollection(name);if(c){for(const sel of selected)addToCollection(c.id,sel);selected.clear();render();toast("Selected titles added to your list.");}}return;}
    if(op==="make-list"){const name=window.prompt("Name your collection:","My season picks");if(name){createCollection(name);render();}return;}
    if(op==="reset-order"){put("homeOrder",tabList.map(t=>t[0]));put("hiddenTabs",[]);render();return;}
    if(op==="hide-completed"){for(const md of tracked().filter(x=>getStatusOf(x.id)==="completed"))state.archived.add(String(md.id));localStorage.setItem("anical.archived",JSON.stringify([...state.archived]));render();return;}
    if(op==="tab-library"){goto("library");return;}
    if(op==="season"&&typeof loadSeasonPreview==="function"){loadSeasonPreview().then(()=>{goto("discover");});return;}
    if(op==="catchup-start"&&md){const daily=clamp(get("catchupDaily",1),1,12);put("catchupPlan",{id,perDay:daily,start:dayKey(new Date()),left:+t.dataset.left||0});toast(`Plan saved: ${daily} episode${daily===1?"":"s"} a day.`);return;}
    if(op==="share-card"&&md){makeShareCard([id],safeTitle(md),false);return;}
    if(op==="journal"&&md){openJournal(md);return;}
    if(op==="open-show"&&id){mdOpen(id);return;}
  }
  function renderSample(){
    const sample=[{title:"Sample: A New Season Begins",format:"TV",episodes:12,genres:["Adventure","Fantasy"],air:"Today · 18:00"},{title:"Sample: Returning Hit",format:"TV",episodes:12,genres:["Action","Drama"],air:"Tomorrow · 20:30"},{title:"Sample: Weekend Film",format:"MOVIE",episodes:1,genres:["Comedy"],air:"Saturday · 14:00"}];
    content.querySelector(".mx-content").innerHTML=`<div class="mx-sample-banner">SAMPLE DATA · Preview only. No progress, list, or settings are changed.</div>${sample.map(x=>`<article class="mx-row"><div class="mx-sample-cover" aria-hidden="true">✦</div><div><b>${escText(x.title)}</b><div class="mx-meta">${x.format} · ${x.episodes} episodes · ${x.genres.join(" · ")} · ${x.air}</div><button type="button" data-xaction="sample-close">Try your own schedule</button></div></article>`).join("")}`;
  }
  function openJournal(md){
    const id=String(md.id),journal=get("journal",{}),entries=Array.isArray(journal[id])?journal[id]:[];
    const timeline=(state.activity||[]).filter(x=>Array.isArray(x)&&String(x[1])===id).map(x=>({day:x[2],label:({add:"Added to your list",rate:"Rated",finish:"Completed",start:"Started watching",drop:"Dropped",note:"Added a note",ep:`Watched ${x[3]||1} episode${(+x[3]||1)===1?"":"s"}`})[x[0]]||"Updated"}));
    const dates=state.dates&&state.dates[id]||{};if(dates.start)timeline.push({day:dates.start,label:"Started"});if(dates.end)timeline.push({day:dates.end,label:"Finished"});
    const body=`<div class="mx-journal"><p>Private journal for <b>${escText(safeTitle(md))}</b>. Entries stay on this device.</p><label class="mx-field">Progress reminder <input class="mx-input" data-xprogress-note="${escText(id)}" maxlength="100" value="${escText(get("progressNote",{})[id]||"")}" placeholder="Resume at episode 6"></label><textarea class="mx-input" data-xjournal="${escText(id)}" maxlength="800" rows="4" placeholder="Add a dated note or reaction…"></textarea><div class="mx-actions"><button type="button" data-xjournal-add="${escText(id)}">Save journal entry</button><label class="mx-toggle"><input type="checkbox" data-xjournal-spoiler="1"> Mark as spoiler</label></div><h4>Private journal</h4>${entries.slice().reverse().map(x=>`<article class="mx-jentry"><small>${escText(x.day||"")}${x.spoiler?" · spoiler":""}</small><p>${x.spoiler&&get("spoilerSafe",true)?"Spoiler hidden · reveal in Customize":escText(x.text||"")}</p></article>`).join("")||"<p class=\"mx-muted\">No journal entries yet.</p>"}<h4>Watch history</h4>${timeline.sort((a,b)=>String(b.day).localeCompare(String(a.day))).map(x=>`<article class="mx-jentry"><small>${escText(x.day||"")}</small><p>${escText(x.label)}</p></article>`).join("")||"<p class=\"mx-muted\">Your watch history will appear as you track progress.</p>"}</div>`;
    const modal=document.createElement("div");modal.className="mx-mini-modal";modal.innerHTML=`<div class="mx-mini-back" data-xmini-close></div><section class="mx-mini-dialog" role="dialog" aria-modal="true" aria-labelledby="mxJournalTitle"><div class="mx-head"><h3 id="mxJournalTitle">Show journal</h3><button data-xmini-close aria-label="Close">✕</button></div>${body}</section>`;root.append(modal);modal.querySelector("textarea").focus();
  }
  function onChange(e){
    const el=e.target;
    if(el.dataset.xselect){const k=el.dataset.xselect;put(k,el.value);if(k==="notifyLead"){state.notifyLead=+el.value;localStorage.setItem("anical.lead",String(state.notifyLead));rescheduleAlerts();}if(k==="variant-show"){put("variantShow",el.value);updateVariantCard(el.value);}render();return;}
    if(el.dataset.xtoggle){const k=el.dataset.xtoggle;let val=el.checked;if(k==="quiet.enabled"){const q=get("quiet",{start:"22:00",end:"08:00"});q.enabled=val;put("quiet",q);rescheduleAlerts();}else{put(k,val);applyPrefs();}render();return;}
    if(el.dataset.xquiet){const q=get("quiet",{enabled:false,start:"22:00",end:"08:00"});q[el.dataset.xquiet]=el.value;put("quiet",q);rescheduleAlerts();return;}
    if(el.dataset.xlead){let leads={};try{leads=JSON.parse(localStorage.getItem("anical.notifyLeadBy")||"{}");}catch(_){}leads[el.dataset.xlead]=clamp(el.value,1,120);localStorage.setItem("anical.notifyLeadBy",JSON.stringify(leads));rescheduleAlerts();return;}
    if(el.dataset.xair){let prefs={};try{prefs=JSON.parse(localStorage.getItem("anical.notifyAirBy")||"{}");}catch(_){}if(el.value==="auto")delete prefs[el.dataset.xair];else prefs[el.dataset.xair]=el.value;localStorage.setItem("anical.notifyAirBy",JSON.stringify(prefs));rescheduleAlerts();return;}
    if(el.dataset.xspoiler){const levels=get("spoilerLevels",{});levels[el.dataset.xspoiler]=el.value;put("spoilerLevels",levels);applyPrefs();const desc=document.querySelector("#modalBody .desc");if(desc){desc.classList.toggle("mx-spoiler-hidden",el.value==="hide");desc.classList.toggle("mx-spoiler-blur",el.value==="blur");desc.classList.remove("mx-revealed");}return;}
    if(el.dataset.xshare){const ids=new Set(get("shareSelected",[]).map(String));el.checked?ids.add(el.dataset.xshare):ids.delete(el.dataset.xshare);rememberShare([...ids]);render();return;}
    if(el.dataset.xselectId){const id=String(el.dataset.xselectId);el.checked?selected.add(id):selected.delete(id);return;}
    if(el.dataset.xcatchup){const plan=get("catchupSelection",[]);const ids=new Set(plan.map(String));el.checked?ids.add(el.dataset.xcatchup):ids.delete(el.dataset.xcatchup);put("catchupSelection",[...ids]);return;}
    if(el.dataset.xavailability){const values=get("availability",{});values[el.dataset.xavailability]=el.value;put("availability",values);return;}
    if(el.dataset.xprogressNote){const values=get("progressNote",{});values[el.dataset.xprogressNote]=el.value.trim().slice(0,100);put("progressNote",values);return;}
    if(el.dataset.xmood){put("mood",el.dataset.xmood);render();return;}
    if(el.dataset.xrange){put(el.dataset.xrange,+el.value);applyPrefs();const label=el.parentElement.querySelector("span");if(label)label.textContent=el.value+"%";return;}
    if(el.dataset.xinput){const key=el.dataset.xinput,value=+el.value;put(key,key==="episodeMinutes"?clamp(value,5,120):key==="weeklyGoal"?clamp(value,1,30):clamp(value,1,12));render();return;}
  }
  function onInput(e){const el=e.target;if(el.dataset.xinput){const key=el.dataset.xinput,value=+el.value;put(key,key==="episodeMinutes"?clamp(value,5,120):key==="weeklyGoal"?clamp(value,1,30):clamp(value,1,12));return;}if(el.dataset.xavailability){const values=get("availability",{});values[el.dataset.xavailability]=el.value;put("availability",values);return;}if(el.dataset.xprogressNote){const values=get("progressNote",{});values[el.dataset.xprogressNote]=el.value.slice(0,100);put("progressNote",values);return;}}
  function onKey(e){
    if(e.key==="Escape"&&root&&!root.hidden){const mini=root.querySelector(".mx-mini-modal");if(mini){mini.remove();return;}close();return;}
    if(!root||root.hidden||!dialog)return;
    if(e.key==="Tab"){const nodes=[...dialog.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']")].filter(x=>x.offsetParent!==null);if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  }
  function onChangeJournal(e){const el=e.target;if(el.matches("[data-xjournal-add]")){const id=String(el.dataset.xjournalAdd),modal=el.closest(".mx-mini-modal"),area=modal.querySelector("[data-xjournal]");const text=(area.value||"").trim();if(!text)return;const all=get("journal",{}),rows=Array.isArray(all[id])?all[id]:[];rows.push({day:dayKey(new Date()),text:text.slice(0,800),spoiler:!!modal.querySelector("[data-xjournal-spoiler]")?.checked});all[id]=rows.slice(-100);put("journal",all);if(typeof logActivity==="function")logActivity("note",id);modal.remove();render();toast("Journal entry saved on this device.");}}
  function addGlobalDelegates(){
    document.addEventListener("click",e=>{const b=e.target.closest("[data-xjournal-add],[data-xmini-close],[data-xorder],[data-xhide]");if(!b)return;if(b.hasAttribute("data-xmini-close")){b.closest(".mx-mini-modal")?.remove();return;}if(b.hasAttribute("data-xjournal-add")){onChangeJournal({target:b});return;}if(b.hasAttribute("data-xorder")){const [i,dir]=b.dataset.xorder.split("|").map(Number),order=get("homeOrder",tabList.map(t=>t[0])),j=i+dir;if(j>=0&&j<order.length){[order[i],order[j]]=[order[j],order[i]];put("homeOrder",order);render();}return;}if(b.hasAttribute("data-xhide")){const hidden=new Set(get("hiddenTabs",[]));hidden.has(b.dataset.xhide)?hidden.delete(b.dataset.xhide):hidden.add(b.dataset.xhide);put("hiddenTabs",[...hidden]);render();}});
    document.addEventListener("click",e=>{const b=e.target.closest("[data-xaction='sample-close']");if(b){put("samplePreview",false);goto("today");}});
    document.addEventListener("click",e=>{const desc=e.target.closest("#modalBody .desc.mx-spoiler-hidden,#modalBody .desc.mx-spoiler-blur");if(desc){desc.classList.toggle("mx-revealed");desc.setAttribute("aria-label",desc.classList.contains("mx-revealed")?"Description revealed; activate to hide it again":"Reveal description");}});
    document.addEventListener("keydown",e=>{if(e.key==="?"&&!/input|textarea|select/i.test(e.target.tagName||"")){open("settings");window.setTimeout(()=>window.alert("Search shows with the box or Ctrl/⌘K. T jumps to today; arrow keys change the date. My Plan has your weekly queue, catch-up list, and private library tools."),50);}});
    const modalBody=document.getElementById("modalBody");if(modalBody)new MutationObserver(setupShowTools).observe(modalBody,{childList:true,subtree:true});
    setupShowTools();
  }
  function addStyles(){
    const css=`
      .mx-launch{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));font-weight:700}.mx-root[hidden]{display:none}.mx-root{position:fixed;inset:0;z-index:1200;opacity:0;pointer-events:none;transition:opacity .18s ease}.mx-root.on{opacity:1;pointer-events:auto}.mx-scrim{position:absolute;inset:0;background:rgba(8,7,12,.68);backdrop-filter:blur(4px)}.mx-dialog{position:absolute;inset:3vh max(2vw,16px);max-width:1040px;margin:auto;max-height:94vh;display:flex;flex-direction:column;background:var(--bg2);color:var(--txt);border:1px solid var(--line);border-radius:18px;box-shadow:0 25px 90px #0008;overflow:hidden;outline:none}.mx-shell{display:flex;flex-direction:column;min-height:0;height:100%}.mx-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 24px 12px;border-bottom:1px solid var(--line)}.mx-head h2{margin:0;font-size:24px}.mx-eyebrow{font-size:10px;letter-spacing:.14em;color:var(--accent);font-weight:800;margin-bottom:5px}.mx-sub{margin:5px 0 0;color:var(--muted);font-size:12px;max-width:64ch}.mx-close{font-size:18px;min-width:38px}.mx-tabs{display:flex;gap:5px;padding:10px 20px;border-bottom:1px solid var(--line);overflow:auto;scrollbar-width:thin}.mx-tabs button{white-space:nowrap;border:0;border-radius:999px;background:transparent;padding:8px 12px;color:var(--muted)}.mx-tabs button.on,.mx-tabs button[aria-selected=true]{background:color-mix(in srgb,var(--accent) 17%,var(--bg3));color:var(--txt);font-weight:700}.mx-content{padding:18px 24px 30px;overflow:auto;min-height:0;overscroll-behavior:contain;flex:1;line-height:1.45;transform:scale(var(--mx-text-scale,1));transform-origin:top left;width:calc(100% / var(--mx-text-scale,1))}.mx-card{border:1px solid var(--line);background:var(--bg3);border-radius:14px;padding:15px;margin:0 0 13px}.mx-card h3{margin:0 0 10px;font-size:15px}.mx-card p{margin:6px 0 10px}.mx-status{padding:7px 10px;border-radius:8px;font-size:12px;margin-bottom:12px;background:color-mix(in srgb,var(--good) 10%,var(--bg2));color:var(--txt)}.mx-status.offline{background:color-mix(in srgb,var(--premiere) 14%,var(--bg2))}.mx-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 14px}.mx-stats-4{grid-template-columns:repeat(4,minmax(0,1fr))}.mx-stats>div{padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--bg3)}.mx-stats b,.mx-stats span{display:block}.mx-stats b{font-size:19px}.mx-stats span{font-size:11px;color:var(--muted);margin-top:3px}.mx-row{display:flex;gap:11px;align-items:center;padding:9px 0;border-top:1px solid var(--line);min-width:0}.mx-row:first-child{border-top:0}.mx-cover{width:46px;height:62px;object-fit:cover;border-radius:6px;background:var(--bg);flex:none}.mx-row-main{min-width:0;flex:1}.mx-title{padding:0;border:0;background:transparent;color:var(--txt);font:inherit;font-weight:750;text-align:left;white-space:normal}.mx-title:hover{text-decoration:underline;color:var(--accent)}.mx-meta,.mx-muted,.mx-hint{font-size:12px;color:var(--muted)}.mx-hint{margin:7px 0 12px}.mx-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.mx-actions button{font-size:11px;padding:6px 9px}.mx-actions button:disabled{opacity:.45}.mx-empty{border:1px dashed var(--line);border-radius:12px;padding:20px;text-align:center;color:var(--muted)}.mx-empty strong{display:block;color:var(--txt);margin-bottom:5px}.mx-empty p{font-size:13px}.mx-shortcuts{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 14px}.mx-day{margin:15px 0}.mx-day h4{display:flex;justify-content:space-between;margin:0;padding:7px 0;border-bottom:1px solid var(--line)}.mx-day h4 span{font-size:11px;color:var(--muted);font-weight:400}.mx-variant{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;padding:8px 0;border-top:1px solid var(--line)}.mx-variant small{grid-column:1/-1;color:var(--muted)}.mx-field{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.mx-field>label,.mx-field>span:first-child{font-size:12px;color:var(--muted)}.mx-input{max-width:100%;min-width:150px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt);font:inherit}.mx-checkrow,.mx-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:13px}.mx-checkrow span{color:var(--muted);font-size:11px}.mx-toggle{justify-content:flex-start}.mx-moods{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 14px}.mx-mood.on{border-color:var(--accent);color:var(--accent)}.mx-short-chip{display:inline-flex;gap:5px;align-items:center;padding:5px 8px;margin:2px;border:1px solid var(--line);border-radius:999px;font-size:12px}.mx-short-chip button{border:0;background:none;padding:0 2px}.mx-simple-list{list-style:none;padding:0;margin:0}.mx-simple-list li{padding:8px 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.mx-simple-list span{color:var(--muted);font-size:12px}.mx-select{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px}.mx-order{display:flex;align-items:center;gap:7px;padding:6px 0;border-top:1px solid var(--line)}.mx-order span{flex:1}.mx-order button{padding:4px 8px;font-size:11px}.mx-compare{overflow:auto}.mx-compare-head,.mx-compare-row{display:grid;grid-template-columns:minmax(120px,1fr) repeat(2,minmax(130px,1fr));gap:8px;padding:10px;border-bottom:1px solid var(--line);min-width:520px}.mx-compare-head{font-weight:700}.mx-compare-row{font-size:12px}.mx-compare-row b{color:var(--muted)}.mx-pick{padding:10px;border:1px solid var(--accent);border-radius:12px;margin-bottom:12px}.mx-sample-banner{padding:12px;background:color-mix(in srgb,var(--premiere) 18%,var(--bg3));border-radius:10px;font-weight:800;letter-spacing:.04em;margin-bottom:10px}.mx-sample-cover{width:46px;height:62px;display:grid;place-items:center;background:var(--bg);border-radius:6px;color:var(--accent);font-size:24px}.mx-tour{max-width:640px;margin:30px auto;padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--bg3)}.mx-tour h3{font-size:22px}.mx-tour-step{color:var(--accent);font-weight:800;font-size:12px}.mx-published-head{padding:20px;border-radius:12px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 22%,var(--bg3)),var(--bg3));margin-bottom:16px}.mx-published-head span{font-size:10px;letter-spacing:.13em;color:var(--accent);font-weight:800}.mx-jentry{border-top:1px solid var(--line);padding:8px 0}.mx-jentry small{color:var(--muted)}.mx-mini-modal{position:absolute;inset:0;z-index:2;display:grid;place-items:center;padding:16px}.mx-mini-back{position:absolute;inset:0;background:#0009}.mx-mini-dialog{position:relative;width:min(620px,100%);max-height:90%;overflow:auto;background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:18px}.mx-mini-dialog .mx-head{padding:0 0 12px}.mx-mini-dialog .mx-head h3{margin:0}.mx-bottom{display:none}.mx-high-contrast{--line:#8c8c9a;--muted:#c2c2ce}.mx-low-bandwidth .mx-cover{display:none}.mx-low-bandwidth .mx-root *{animation:none!important;transition:none!important}
      @media(max-width:700px){.mx-launch{font-size:11px;padding:7px 8px}.mx-dialog{inset:0;border-radius:0;max-height:100dvh;max-width:none}.mx-head{padding:15px 15px 10px}.mx-head h2{font-size:20px}.mx-tabs{padding:8px 10px}.mx-content{padding:13px 13px calc(80px + env(safe-area-inset-bottom))}.mx-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.mx-stats-4{grid-template-columns:repeat(2,minmax(0,1fr))}.mx-bottom{display:flex;position:fixed;z-index:1000;left:0;right:0;bottom:0;padding:5px 8px calc(5px + env(safe-area-inset-bottom));justify-content:space-around;background:color-mix(in srgb,var(--bg2) 94%,transparent);border-top:1px solid var(--line);backdrop-filter:blur(16px)}.mx-bottom button{background:none;border:0;display:flex;flex-direction:column;gap:1px;align-items:center;font-size:18px;padding:3px 9px}.mx-bottom span{font-size:9px;color:var(--muted)}body{padding-bottom:58px}.mx-row{align-items:flex-start}.mx-cover{width:38px;height:52px}.mx-actions button{min-height:36px}.mx-compare-head,.mx-compare-row{grid-template-columns:minmax(100px,1fr) repeat(2,minmax(115px,1fr));min-width:440px}}
      @media(prefers-reduced-motion:reduce){.mx-root,.mx-root *{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
      @media print{body *{visibility:hidden!important}.mx-root,.mx-root *{visibility:visible!important}.mx-root{position:static;opacity:1!important;pointer-events:auto!important}.mx-scrim,.mx-close,.mx-tabs,.mx-bottom,.mx-actions,.mx-launch{display:none!important}.mx-dialog{position:static;inset:auto;max-height:none;max-width:none;border:0;box-shadow:none}.mx-content{overflow:visible}.mx-card{break-inside:avoid}}
    `;
    const style=document.createElement("style");style.id="mxStyles";style.textContent=css;document.head.append(style);
    const extra=document.createElement("style");extra.id="mxA11yStyles";extra.textContent=`#overlay{z-index:1300}.mx-quick-pref{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--muted)}.mx-quick-pref select{max-width:96px;padding:5px 6px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--txt)}.mx-tip{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:9px 11px;margin:0 0 12px;border-left:3px solid var(--accent);border-radius:8px;background:var(--bg3);font-size:12px}.mx-goal{margin:0 0 14px;padding:10px 12px;border:1px solid var(--line);border-radius:10px}.mx-goal>div:first-child{display:flex;justify-content:space-between;font-size:12px}.mx-goal span{color:var(--muted)}.mx-progress{height:6px;background:var(--bg);border-radius:9px;margin-top:8px;overflow:hidden}.mx-progress i{display:block;height:100%;background:var(--accent);border-radius:9px}.mx-compare-head,.mx-compare-row{grid-template-columns:minmax(120px,1fr) repeat(var(--mx-columns,2),minmax(130px,1fr));min-width:var(--mx-min-width,520px)}.mx-spoiler-safe #modalBody .desc.mx-spoiler-hidden:not(.mx-revealed),#modalBody .desc.mx-spoiler-blur:not(.mx-revealed){filter:blur(7px);cursor:pointer;user-select:none}.mx-high-contrast{--line:#858596;--muted:#ddddE7}.mx-dialog :focus-visible,.mx-mini-dialog :focus-visible{outline:3px solid var(--accent2);outline-offset:2px}.mx-sample-banner{border:1px solid var(--premiere)}@media(max-width:700px){.mx-quick-pref{font-size:9px}.mx-quick-pref select{max-width:70px}.mx-checkrow{align-items:flex-start}.mx-checkrow input{align-self:center}}`;
    document.head.append(extra);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",()=>{addStyles();attachUi();addGlobalDelegates();},{once:true});
  else {addStyles();attachUi();addGlobalDelegates();}
})();
