/* Rating, prediction, recommendation, and feed logic.
 * Loaded in order as a classic script after /app.js.
 * Top-level declarations share the global scope; preserve this order.
 */
"use strict";

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
