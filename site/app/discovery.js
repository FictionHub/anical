/* Discovery, search, and show pages.
 * Loaded in order as a classic script after /app.js.
 * Top-level declarations share the global scope; preserve this order.
 */
"use strict";

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
  state.browse={ kind:["tag","studio","staff","year"].includes(kind)?kind:"tag", id:id?String(id):null, name:name||null };
  setView("browse");
  window.scrollTo({top:0});
}
function browseHref(kind, id, name){
  const p=new URLSearchParams({view:"browse", kind});
  if(kind==="year" && id) p.set("y", id);
  else if(id) p.set("id", id);
  if(name) p.set("name", name);
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
  return `<div class="sk-tabs" role="tablist">${[["tag","🏷 Tags"],["studio","🎬 Studios"],["staff","🎙 Staff"],["year","📅 Years"]].map(([key,label])=>
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
  else if(b.kind==="year"){ [heading,body]=b.id?yearPageHtml(b):yearIndexHtml(); }
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

// --- year ---
function yearIndexHtml(){
  const head=`<div class="board-head"><h2>📅 Browse by year</h2><div class="ev-sub">Every year with anime on record — four seasons apiece, each linking to its season page.</div></div>`;
  const years=[];
  for(let y=new Date().getUTCFullYear(); y>=1917; y--) years.push(y);
  const chips=years.map(y=>`<a class="br-tag" href="${browseHref("year",y)}" data-browse="year|${y}">${y}</a>`).join("");
  return ["Browse years", head+`<section class="br-group"><h3>Jump to a year</h3><div class="br-list">${chunks(chips,18).map(r=>`<div class="br-row">${r.join("")}</div>`).join("")}</div></section>`];
}
function chunks(items,n){ const out=[]; for(let i=0;i<items.length;i+=n) out.push(items.slice(i,i+n)); return out; }
function yearPageHtml(b){
  const year=+b.id;
  const key=`year|${year}`;
  const rec=browseLoad(key, async()=>{
    const data=await viaApi(`/year?y=${year}&sort=score&page=1`, null);
    return { year, items: data.Page ? data.Page.media : [], hasNext: data.Page ? data.Page.pageInfo.hasNextPage : false };
  });
  const head=`<div class="board-head"><h2>${year}</h2><div class="ev-sub">Everything released in ${year}, four seasons underneath.</div></div>`;
  if(!rec.data) return [String(year), head+browseStatus(rec,"that year")];
  const sort=["score","newest","popular"].includes(state.browseSort)?state.browseSort:"score";
  const items=rec.data.items.filter(browseVisible).slice();
  const cmp={ score:(x,y)=>(y.averageScore||-1)-(x.averageScore||-1)||(y.popularity||0)-(x.popularity||0),
    newest:(x,y)=>(y.seasonYear||0)-(x.seasonYear||0) || (seasonIdx(y.season)-seasonIdx(x.season)),
    popular:(x,y)=>(y.popularity||0)-(x.popularity||0) }[sort];
  items.sort(cmp);
  const seasons={ WINTER:[], SPRING:[], SUMMER:[], FALL:[] };
  for(const md of items){
    const s=(md.season||"WINTER").toUpperCase();
    if(seasons[s]) seasons[s].push(md);
  }
  const seasonHtml=s=>`<section class="br-group"><h3>${s} ${year}</h3><div class="bgrid">${seasons[s].map(md=>`<span class="bgrid-r">${browseCardHtml(md)}</span>`).join("")||`<p class="shw-muted">No ${s.toLowerCase()} shows on record.</p>`}</div></section>`;
  return [String(year), head+`
    <div class="br-bar"><span class="num-hint" style="margin:0">Sort: ${[["score","By score"],["newest","Newest"],["popular","Most popular"]].map(([k,l])=>`<button type="button" class="chip${k===sort?" on":""}" data-browsesort="${k}" aria-pressed="${k===sort}">${l}</button>`).join("")}</span></div>
    ${seasonHtml("WINTER")}${seasonHtml("SPRING")}${seasonHtml("SUMMER")}${seasonHtml("FALL")}${moreBtn(rec)}`];
}
function seasonIdx(s){ return {WINTER:0,SPRING:1,SUMMER:2,FALL:3}[String(s).toUpperCase()]||0; }

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
