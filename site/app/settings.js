/* Settings panels, lists, and event views.
 * Loaded in order as a classic script after /app.js.
 * Top-level declarations share the global scope; preserve this order.
 */
"use strict";

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
