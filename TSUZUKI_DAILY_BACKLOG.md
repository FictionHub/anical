# Tsuzuki · Daily Feature Backlog

**Tactical backlog · Year 1 · Aug 2026 → Jul 2027**

Three hundred sixty-five days, three hundred sixty-five features.

A shippable feature every single day — the hands-on companion to the strategic 10-year roadmap. None of these are the big backend milestones; they're the consumer-facing wins you build day to day while the platform work runs underneath.

**Revised Aug 2026.** The first version of this document was written on the assumption that nothing in it existed yet. A month of building broke that: push, theming, release variants, corrections and reporting all landed early, so the days that overlap them have been rewritten to the part that is actually left. Those entries carry a status marker (see below). September 2026 is untouched by this revision.

## Picking This Up Cold

Everything below assumes these invariants. Check them before starting a day; they are the things that are expensive to rediscover.

- **The client is one file.** `site/index.html` (~6,000 lines) holds the entire app — markup, CSS and JS, all inline. Most days land there. Find the neighbouring feature and match its idiom rather than introducing a new pattern. It has grown ~2,000 lines in a month; that is the file's normal, not a problem to fix mid-day.
- **There is no build step.** `site/` is uploaded as-is (`netlify.toml` sets `publish = "site"` with no build command). The SEO pages are generated and committed by GitHub Actions, not built on Netlify. Do not add a bundler, framework or npm dependency to the client without a deliberate decision — it changes the deploy story for every day after it.
- **Storage is `localStorage`, namespaced `anical.*`** — `anical.collections`, `anical.notes`, `anical.filters`, `anical.hidden`, and so on. The prefix is pre-rebrand and deliberately unchanged: renaming it to `tsuzuki.*` would orphan every existing user's data. New keys keep the `anical.` prefix. Migrations are additive — never drop or repurpose a key an earlier version wrote.
- **Sign-in exists, and holds nothing.** Discord OAuth + a signed session cookie ship (`netlify/functions/auth.mjs`, `_lib/session.mjs`), but only so an event skin can find the account it was granted to. The server stores a Discord id, name and avatar hash — no list, no ratings, no notes. Every day below is still a local-first feature; **do not** reach for the session as a place to put user data without a deliberate decision, because the settings panel currently promises the opposite.
- **The version is derived, not typed.** `.githooks/pre-commit` runs `scripts/stamp-version.mjs`, which rewrites `APP_VERSION` in `site/index.html` as `<major.minor>.<commit count>` — and reads the major.minor from the newest CHANGELOG entry in that same file. So **adding the changelog entry is the whole release procedure**; never hand-edit `APP_VERSION`, and there is no longer a constant in the script to bump. The app is on **v3.4** as of Aug 2026. Three other version numbers live nearby and are all independent of it — the public API's (`VERSION` in `api.mjs`, currently `1.1`, matching the `/api/v1` route) and the data-format ones (`SCHEMA_VERSION`, `OVERRIDES_VERSION`, `THEMES_VERSION`, all `1`). None of them move when the app version does.
- **Schedule data comes from our own API first.** The client calls `/api/v1/seasons/...?full=1`, `/api/v1/anime/<id>?full=1` and `/api/v1/search` before touching AniList, and falls back to AniList directly whenever our API can't answer — so the site is never *dependent* on its own backend. Data is still never stale for deploy reasons; it is now also corrected before it arrives. Only the SEO pages, `.ics` feeds and app code are deploy-bound.
- **The correction layer is mirrored by hand.** `site/index.html` resolves release variants (`raw`/`sub`/`dub`) client-side; `netlify/functions/_lib/schedule-overrides.mjs` is the same logic again for `push-send.mjs`, because the client can't import it without a build step. **Change one, change the other** — the shapes and resolution order are the contract. Any day that touches air times touches both.
- **Where non-client work lives.** `netlify/functions/` for server and scheduled work — `api.mjs` (public read API), `ingest.mjs` (scheduled, every 2h), `push-send.mjs` (scheduled, every 15m), `auth.mjs`, `themes.mjs`, `grants.mjs`, `chat.mjs`, `overrides.mjs`, `report.mjs`, with shared code in `_lib/` (`catalog.mjs` is the read path everything goes through). `scripts/` for static generation and tooling (`build-seo.mjs`, `build-events.mjs`, `build-themes.mjs`, `ingest-crunchyroll.mjs`); `bot/` for Discord and social posts; `.github/workflows/` for the schedules that drive them.
- **AniList is rate-limited** to roughly 30 requests/minute and currently degraded. `netlify/functions/_lib/ingest-http.mjs` has the shared limiter and retry helper — reuse it rather than writing a bare `fetch` loop. Server-side, prefer `_lib/catalog.mjs`: memory → Blobs snapshot → AniList, so one cold request pays for a whole season.

### Reading a day

Each entry carries a layer, an acceptance line, and sometimes a prerequisite:

| Layer | Means | Visible on its own? |
|---|---|---|
| `data` | Model, schema or computation | **No** — batch it with the day that surfaces it |
| `ui` | New interface in the app | Yes |
| `surface` | Existing capability exposed somewhere new | Yes |
| `polish` | Motion, theming, micro-interaction | Yes |
| `a11y` | Accessibility work | Sometimes |
| `content` | Generated static output | To crawlers |
| `infra` | Functions, workflows, configuration | No |

**Done when** is the acceptance condition — observable in the running app, not a description of the code. **Needs** names a day that must land first.

Some days also carry a status:

| Marker | Means |
|---|---|
| ✅ shipped | Built. Kept for the record, with the commit where it landed. |
| ◐ | Something in the codebase already covers part of this. The entry has been rewritten to the remaining half, and says what exists first. |

A `◐` day is usually *smaller* than it looks and occasionally larger — inheriting a working implementation means inheriting its assumptions too. Read what exists before estimating.

## Daily Build, Batched Deploy

Read this before planning against the dates below, because the deploy budget does not allow one deploy per day.

**The constraint.** Netlify's free tier gives 300 credits/month and every deploy costs ~15 — a static site with no build command costs the same as any other. That is a hard ceiling of **~20 deploys/month**, shared between content refreshes, feature ships and hotfixes. Deploys bill per **push**, not per commit.

**What that means for this backlog.** Build a feature a day; push in batches of two or three. Users see a drop every ~2–3 days containing several features, which reads as a bigger release than a daily trickle would. The daily cadence governs your development rhythm, not the deploy button. The layer chip tells you what can travel alone: a `data` day pushed by itself spends 15 credits on nothing a user can see.

**A rough monthly allocation:**

| Purpose | Deploys/month | Credits |
|---|---|---|
| Feature drops (2–3 backlog items each) | 12 | 180 |
| SEO / content refresh (weekly) | 4 | 60 |
| Hotfix reserve | 4 | 60 |
| **Total** | **20** | **300** |

**Not every push costs 15 credits any more.** `netlify.toml` carries an `ignore` rule — `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- site netlify package.json package-lock.json` — so a push touching only docs, `bot/`, `.github/`, `scripts/` or `data/` exits 0 and Netlify cancels the build. This is verified, not theoretical: the daily Crunchyroll ingest commits to `data/derived-offsets.json` at the repo root every day and has never cost a credit. **Editing this backlog is free. Shipping a feature is not.**

**What is already fresh without a deploy.** Schedule data reaches users through `/api/v1` (Netlify Blobs, refreshed by the scheduled ingest) with a live AniList fallback, so it is never stale for real users no matter when you last deployed. Corrections go out through `POST /api/overrides` and skins through `/api/themes` — both blob-backed, both instant, neither costing a deploy. Deploy frequency now governs only three things: new app code, the static SEO pages Google crawls, and the `.ics` feeds. Of those, only the feeds are both user-facing and time-sensitive — moving them to a Netlify Function would decouple them entirely, since invocations bill against a separate 125k/month quota you have barely touched.

Shipping weekly was never a development limit. It is a deploy-budget limit, and the way past it is batching, not frequency.

## Backlog Stats
- **365** daily features
- **12** monthly themes
- **1** build every day, **1** drop every 2–3
- **40** days carrying a status marker — 15 shipped, 25 partly built

## How This Sits with the Roadmap

The **10-year roadmap** is the strategic spine (a hard system per year — data platform, sync, ML, native…). This backlog is the **daily delight layer** that keeps users happy and the app growing while that deeper work lands. A few themes rhyme with roadmap years (recs, streaming, stats) — here they're the light, client-side versions you can ship now; the roadmap later rebuilds them as the heavy, backend-powered versions.

That division held for exactly one month. Twelve roadmap slots were overtaken by work that shipped early — the public API, the theming engine, release variants, web push, a grounded assistant — and were rescoped in place rather than deleted. The knock-on for *this* document is the `◐` days: where the heavy version arrived first, the light version below is no longer the thing to build, so the entry now describes the user-facing half that the backend shipped without.

## How This Maps to the Old Weekly Backlog

All 52 weekly features survive — none were cut. The big ones (the rating engine, recommendations, show pages, franchise hubs) were never one-day features, so each is decomposed into its real shipping spine: data layer → minimal UI → surfacing → polish. The small ones (Discord block, command palette) stay as single days. The remaining slots are new features sized to a day. Entries carrying a former weekly item are tagged `[W##]`.

---

## Month 01: August 2026 · Personal library, deeper

### Day 01 · Aug 1 | Watch statuses ✅ shipped
Watching / Plan / On-hold / Dropped / Completed, with a status-board view and per-status counts. `[W01]`
> `ui` — **Done when** every show can hold exactly one status, the board view groups by it, and the counts survive a reload.

### Day 02 · Aug 1 | Ratings & private notes ✅ shipped
A 1–10 personal score and free-text notes per show, surfaced on cards and in the modal. `[W02]` — `de9501d1`
> `ui` — **Done when** a score and a note persist per show and both appear on the card and in the detail modal.

### Day 03 · Aug 1 | Custom collections ✅ shipped
Make your own lists, rename them, and drag shows between them. `[W03]` — `0108f174`
> `ui` — **Done when** a user-made list can be created, renamed, deleted and reordered, and a show can belong to several at once.

### Day 04 · Aug 4 | Collection covers ✅ shipped
Auto-pick a mosaic of the first four shows as each list's cover art. `collectionCoverHtml` tiles up to four covers into the 30px square in every list's column header: one show fills it, two split it, three give the first the left half, four make a 2×2. An empty list — or one whose art hasn't been fetched yet — gets a 📚 placeholder of the same size, and the "Not in a list" column gets a matching 📥 one so the headers stay on one line. List columns went 252px → 274px to pay for the tile. — `4fdb2071`
> `polish` — **Done when** a collection holding at least one show renders a four-up mosaic wherever collections are listed, and an empty one falls back to a placeholder. **Needs** Day 03.

### Day 05 · Aug 5 | Bulk select ✅ shipped
Shift-click a range of cards, then set status or collection for all of them at once. Works in both card views (board and 📚 Lists): shift-click extends a run from the last card touched, in layout order and across columns; ctrl/⌘-click toggles one; a plain click still opens the show. A bar appears with the five statuses, a "take it off the board" chip, and an "Add to list…" picker that can also make the list. Every bulk action is one Undo, not N. — `4fdb2071`
> `ui` — **Done when** a shift-click range selects contiguous cards and one action applies to the whole selection.

**Two things worth knowing before touching this.** The selection is *ids*, not elements — the same show appears in several list columns and both instances light up, which is right, but it means a three-card range can highlight six cards. And the selection handler is registered *above* the open-a-show handler on purpose: it calls `stopImmediatePropagation`, which only stops listeners added after it, so moving the block down the file would make every shift-click also open a modal.

### Day 06 · Aug 6 | Undo toast ✅ shipped
Every destructive list action gets a six-second "Undo" instead of a confirm dialog. Half of this already existed — status changes, ratings, list membership, moves and list deletion all toasted, and the app has never had a `confirm()` in it. What was missing was the actions that quietly threw work away: un-starring a show (which drops it off the board *and* forgets its status), hiding a show (which removes it from every view and closes the modal you'd undo from), and "Unhide all" in settings (which discards a list built one show at a time). All three now hand back exactly what they took, and the undo window went 5.5s → 6s. — `4fdb2071`
> `ui` — **Done when** removing a show or deleting a collection is reversible from a toast, and no destructive action prompts a modal confirm.

### Day 07 · Aug 7 | Episode progress ✅ shipped
The fast path, built on what was already there. `progressRowHtml` puts a counter in the detail modal's Overview, between Where to watch and Your rating: `−`, a live `Ep 5 of 14`, `+1`, `✓ Caught up (ep 6)` and a `Reset`, with the progress bar under it. Every button lands in the existing `setProgress`, which grew the ceiling rather than each caller having its own — `epTotal(md)` prefers AniList's `episodes` and falls back to the highest episode in the airing schedule, so a show with neither is uncapped instead of capped at zero. "Caught up" resolves to `maxAiredEp`, not the announced episode count, and disables itself once you're there.
> `ui` — **Done when** +1 and "caught up" write through the existing `setProgress` rather than a second code path, progress cannot exceed the episode count, "caught up" sets it to the latest *aired* episode, and the AniList queue picks the change up exactly as marking a row does today.

**One thing that changed underneath.** The schedule list's ✓ marks used to refresh by calling `openDetail()` again — a full modal rebuild that threw away scroll position and focus on every click. Both paths now go through `refreshProgressUI(id)`, which swaps the counter row and the schedule panel in place and re-renders the views behind. Clicking `+1` five times no longer bounces you to the top of the pop-up four times.

### Day 08 · Aug 8 | Auto-progress from airing ✅ shipped
A checkbox in the counter row — "mark episodes watched as they air". `state.autoProg` (`anical.autoprog`) is a map, not a set: the key is the opt-in, the value is the highest **aired** episode `sweepAutoProgress()` has already accounted for. That second number is what makes a manual correction stick — unmark episode 8 and the sweep leaves it alone until episode 9 genuinely airs, where a plain "push progress up to whatever has aired" would undo you on the next render. Opting in stamps the current aired episode rather than marking the back catalogue watched; opting out deletes the key and touches progress not at all. The sweep runs at the top of `renderView()` and only writes when something has aired since the last pass.
> `surface` — **Done when** an opted-in show advances its counter as episodes air, and opting out freezes it without losing history. **Needs** Day 07.

### Day 09 · Aug 9 | Progress bars on cards ✅ shipped
`progressBarHtml` renders a 4px fill under the cover; `cardCoverHtml` wraps art plus bar so the board and 📚 Lists cards can't drift apart — they are the same card in two views. The bar is the width of the art, not the card. A show whose episode count nobody knows yet (`epTotal` returns 0 — no `episodes` from AniList, no schedule to infer one from) gets the watched number in a small chip instead of a fill: a proportional bar needs a denominator, and inventing one reads as "nearly finished" on a show with fifty episodes left.
> `surface` — **Done when** every card with progress shows a proportional bar, and shows without an episode count degrade gracefully. **Needs** Day 07.

### Day 10 · Aug 10 | "Next up" rail ◐
The Continue Watching card already renders one row per started show with a newer aired episode (`▶ Next: Episode N`, top ten). Two things stop it being this feature: it ranks by AniList popularity rather than by when the episode aired, and it only sees `state.media` — the fetched seasons — so a show you fell behind on last season is invisible in it.
> `surface` — **Done when** the rail orders by air date, covers every Watching show rather than only the loaded seasons, and an item disappears once marked watched. **Needs** Day 07.

### Day 11 · Aug 11 | Rewatch counter
A rewatch tally per show that survives resetting progress.
> `data` — **Done when** completing a show a second time increments the tally, and resetting progress leaves it intact.

### Day 12 · Aug 12 | Started & finished dates
Auto-stamped when a show enters Watching or Completed, editable after.
> `data` — **Done when** both dates stamp automatically on the status change and can be corrected by hand afterwards.

### Day 13 · Aug 13 | Rating axes (data)
Split the single score into story, art, sound, characters and enjoyment behind the scenes. Old 1–10 scores migrate as the composite, so nobody loses their history. `[W04]`
> `data` — **Done when** an existing single score reads back as the composite with no visible change, and the migration is idempotent across reloads.

### Day 14 · Aug 14 | Rating axes (UI)
Five sliders with half-points in the modal, composite recalculating live. `[W04]`
> `ui` — **Done when** the five sliders accept half-points and the composite updates as you drag. **Needs** Day 13.

### Day 15 · Aug 15 | Composite weights
Drag how much each axis counts toward your score, stored per user. `[W04]`
> `ui` — **Done when** changing the weights recomputes every composite in the library at once. **Needs** Day 14.

### Day 16 · Aug 16 | Your rating distribution
Your own score histogram, so you can see if you're a 7-out-of-10 person.
> `surface` — **Done when** the histogram reflects the current library and updates after any rating change.

### Day 17 · Aug 17 | Score normalization
An optional "spread my scores" toggle that stretches a clustered list across the range.
> `data` — **Done when** the toggle changes displayed scores only, never the stored ones, and is fully reversible.

### Day 18 · Aug 18 | Head-to-head core (data)
Store pairwise comparisons and derive an ordering from them. `[W05]`
> `data` — **Done when** recorded pairs produce a stable total ordering and contradictory pairs resolve without crashing.

### Day 19 · Aug 19 | Head-to-head UI
A two-card "which did you like more?" screen with a skip button. `[W05]`
> `ui` — **Done when** each answer records a pair and serves the next, and skipping never re-serves the same pair twice in a session. **Needs** Day 18.

### Day 20 · Aug 20 | Calibration run
A guided ten-pair session that seeds the ordering from scratch. `[W05]`
> `surface` — **Done when** ten answers produce a usable ordering from an empty comparison history. **Needs** Day 19.

### Day 21 · Aug 21 | Comparison-derived scores
Turn the pairwise ordering into suggested 1–10 scores you can accept or ignore. `[W05]`
> `surface` — **Done when** suggestions appear as proposals only and nothing is written until accepted. **Needs** Day 18.

### Day 22 · Aug 22 | Note templates
Quick-insert prompts — favourite episode, best moment, who to recommend it to.
> `ui` — **Done when** a template inserts at the cursor without overwriting existing note text.

### Day 23 · Aug 23 | Note search
Full-text search across your private notes.
> `surface` — **Done when** a query matches note bodies and returns the owning shows, case-insensitively.

### Day 24 · Aug 24 | Spoiler-tagged notes
Blur note text until tapped, per note.
> `ui` — **Done when** a note marked spoiler renders blurred everywhere it appears and reveals only on explicit interaction.

### Day 25 · Aug 25 | Favourites
A one-tap heart, separate from score, with a favourites-first sort.
> `ui` — **Done when** favouriting is independent of status and score, and the sort puts favourites first without hiding anything.

### Day 26 · Aug 26 | Pinned shows
Pin up to five shows to the top of every view.
> `ui` — **Done when** pins persist across views and reloads, and the sixth pin is refused with an explanation.

### Day 27 · Aug 27 | Archive
Hide finished shows from the main views without deleting them.
> `ui` — **Done when** archived shows vanish from default views, remain findable through a filter, and keep all their data.

### Day 28 · Aug 28 | List density ◐
Comfortable and Compact already ship as one global appearance toggle (`anical.density` → a `dense` class on `body`). Missing: the grid option, and per-view memory — density is currently one setting for the entire app.
> `ui` — **Done when** grid joins the existing two, the choice applies to every list view, and each view remembers its own rather than sharing one.

### Day 29 · Aug 29 | Sort builder
Multi-key sorting — status, then score, then title — that you can save.
> `ui` — **Done when** a multi-key sort can be built, saved, reapplied and deleted.

### Day 30 · Aug 30 | Filter chips
Active filters shown as removable chips above every list.
> `surface` — **Done when** every active filter has a chip, removing it updates results immediately, and clearing all restores the full list.

### Day 31 · Aug 31 | Month wrap
An end-of-month summary card of what you added, rated and finished.
> `surface` — **Done when** the card reports real counts for the month and reads sensibly in a month with no activity.

---

## Month 02: September 2026 · The rating engine & recommendations

*The positioning shift: not a release schedule with a list attached, but the anime info site that knows your taste.*

### Day 32 · Sep 1 | Taste vectors (data)
Build genre, tag, studio, era and length vectors from your ratings, cached locally. `[W06]`
> `data` — **Done when** vectors compute from the rated library, cache locally, and recompute when a rating changes. **Needs** Day 13.

### Day 33 · Sep 2 | Genre affinity
Your over- and under-rated genres versus the crowd average, as a bar chart. `[W06]`
> `ui` — **Done when** each genre shows your average against the crowd's, with the delta signed. **Needs** Day 32.

### Day 34 · Sep 3 | Studio affinity
The same treatment for studios, with your best and worst called out. `[W06]`
> `ui` — **Done when** studios rank by delta and thin-sample studios are marked as such. **Needs** Day 32.

### Day 35 · Sep 4 | Tag affinity
AniList tags ranked by how much they actually move your score. `[W06]`
> `ui` — **Done when** tags rank by score impact rather than raw frequency. **Needs** Day 32.

### Day 36 · Sep 5 | Era & length axes
Decade and episode-count preferences pulled out as their own dimensions. `[W06]`
> `ui` — **Done when** both axes render from the vectors and handle a library spanning one decade only. **Needs** Day 32.

### Day 37 · Sep 6 | Taste profile page
Every axis on one readable page, with a shareable one-line summary. `[W06]`
> `ui` — **Done when** one route shows all axes and states its own sample size honestly. **Needs** Day 36.

### Day 38 · Sep 7 | Taste archetype
A named label for your profile — "character-first slow burn" — with the reasoning behind it.
> `surface` — **Done when** the label derives from the axes and the reasoning names which ones drove it. **Needs** Day 37.

### Day 39 · Sep 8 | Predictor v1
A nearest-neighbour score estimate built from your rated shows. `[W07]`
> `data` — **Done when** any unrated show returns an estimate, and an empty library returns no estimate rather than a default. **Needs** Day 32.

### Day 40 · Sep 9 | Confidence scoring
How much the predictor trusts itself, derived from sample size and axis coverage. `[W07]`
> `data` — **Done when** every estimate carries a confidence that falls as neighbours thin out. **Needs** Day 39.

### Day 41 · Sep 10 | Predicted badge
The estimate on every unrated card, greyed out when confidence is low. `[W07]`
> `surface` — **Done when** unrated cards show the badge, rated ones show the real score instead, and low confidence is visually distinct. **Needs** Day 40.

### Day 42 · Sep 11 | Low-confidence honesty
"Not enough signal yet" instead of a number, with exactly what to rate to fix it. `[W07]`
> `ui` — **Done when** below-threshold predictions show no number and name specific shows to rate. **Needs** Day 41.

### Day 43 · Sep 12 | Predictor v2
Fold the head-to-head pairs in as a ranking signal, not just the 1–10 scores. `[W07]`
> `data` — **Done when** recorded pairs measurably change predictions and the predictor still works with zero pairs. **Needs** Days 18, 39.

### Day 44 · Sep 13 | Predictor backtest
Hold out your own ratings and show the predictor's error rate, openly.
> `surface` — **Done when** a hold-out run reports mean error against your real scores. **Needs** Day 43.

### Day 45 · Sep 14 | Recommendations engine
Rank the unrated catalogue by predicted score, minus everything you've already seen. `[W08]`
> `data` — **Done when** the ranking excludes everything already in the library and returns a stable order. **Needs** Day 43.

### Day 46 · Sep 15 | Recommendations page
The ranked picks on a dedicated page, not a rail. `[W08]`
> `ui` — **Done when** one route lists ranked picks with scores and confidence. **Needs** Day 45.

### Day 47 · Sep 16 | Rec filters
Length, season, genre, status and streaming-service filters on the recs page. `[W08]`
> `ui` — **Done when** filters compose, and an over-filtered result explains itself rather than showing blank. **Needs** Day 46.

### Day 48 · Sep 17 | Safe bet mode
High-confidence, high-predicted picks only. `[W08]`
> `surface` — **Done when** the mode returns only picks above both thresholds and says so when none qualify. **Needs** Day 46.

### Day 49 · Sep 18 | Surprise me mode
Deliberately outside your usual axes, with the risk stated up front. `[W08]`
> `surface` — **Done when** picks sit measurably outside your dominant axes and each states which axis it departs from. **Needs** Day 46.

### Day 50 · Sep 19 | Short commitment mode
Recommendations capped by total runtime, for when you have six hours and no more.
> `surface` — **Done when** the returned set's total runtime stays under the cap. **Needs** Day 46.

### Day 51 · Sep 20 | Reasoning capture
Record which rated shows and which axes drove each prediction. `[W09]`
> `data` — **Done when** every prediction carries its contributing shows and axis weights. **Needs** Day 45.

### Day 52 · Sep 21 | Why this pick
Open any prediction into its reasoning — the shows it leaned on, the axes that moved it. `[W09]`
> `ui` — **Done when** any prediction opens into a panel naming its evidence. **Needs** Day 51.

### Day 53 · Sep 22 | Retrain in place
Thumbs and axis sliders on the reasoning panel that update the profile on the spot. `[W09]`
> `ui` — **Done when** an adjustment changes the surrounding predictions without a reload. **Needs** Day 52.

### Day 54 · Sep 23 | Rec feedback loop
"Not interested" and "already seen" that permanently reshape future picks.
> `data` — **Done when** a dismissal persists and the show never returns to recommendations. **Needs** Day 45.

### Day 55 · Sep 24 | Show page shell
A real per-show route with staff, studio, source and adaptation range. `[W10]`
> `ui` — **Done when** a per-show route renders from AniList data and deep-links correctly.

### Day 56 · Sep 25 | Show page — related entries
Prequels, sequels, side stories and adaptations, all linked. `[W10]`
> `surface` — **Done when** relations render as links and a show with none degrades cleanly. **Needs** Day 55.

### Day 57 · Sep 26 | Show page — airing history
The full episode list with air dates and your progress against it. `[W10]`
> `surface` — **Done when** every aired and scheduled episode lists with its date and watched state. **Needs** Days 07, 55.

### Day 58 · Sep 27 | Show page — score panel
The crowd's rating distribution next to your predicted or actual score. `[W10]`
> `surface` — **Done when** the panel shows your score when rated and the prediction when not. **Needs** Days 41, 55.

### Day 59 · Sep 28 | Show page — streaming & links
Where to watch, official site and trailer, in one block. `[W10]`
> `surface` — **Done when** available links render and missing ones are omitted rather than shown dead. **Needs** Day 55.

### Day 60 · Sep 29 | Show page — themes & tags
The tag cloud, colour-coded by your own affinity for each tag. `[W10]`
> `surface` — **Done when** tags colour by affinity and stay legible with no ratings yet. **Needs** Days 35, 55.

### Day 61 · Sep 30 | Profile diff
How your taste shifted this month versus last.
> `surface` — **Done when** the diff reports real axis movement and handles a first month with no prior. **Needs** Day 37.

---

## Month 03: October 2026 · Discovery & search

### Day 62 · Oct 1 | Because-you-follow engine
Group recommendations by the followed show that triggered them. `[W11]`
> `data` — **Done when** every pick attributes to a specific followed show. **Needs** Day 51.

### Day 63 · Oct 2 | Reason rails
Reason-tagged rows on the home page — "because you rated Frieren a 9". `[W11]`
> `ui` — **Done when** the home page renders reason-titled rows naming the trigger show. **Needs** Day 62.

### Day 64 · Oct 3 | Rail ordering
Rails sorted by how strong each reason is, with the weak ones hidden entirely.
> `surface` — **Done when** rails order by reason strength and below-threshold rails do not render. **Needs** Day 63.

### Day 65 · Oct 4 | Command palette shell
⌘/Ctrl-K opens a fuzzy launcher over everything. `[W12]`
> `ui` — **Done when** the shortcut opens and closes the palette, focus traps inside it, and Escape returns focus.

### Day 66 · Oct 5 | Palette — show jump
Type a title, land on its page or modal. `[W12]`
> `surface` — **Done when** a title query navigates to the show on Enter. **Needs** Day 65.

### Day 67 · Oct 6 | Palette — actions
Set status, add to collection, rate — all without leaving the keyboard. `[W12]`
> `surface` — **Done when** each action completes from the keyboard alone and reports its result. **Needs** Day 65.

### Day 68 · Oct 7 | Palette — recent & frequent
Your last actions and most-visited shows ranked to the top.
> `surface` — **Done when** an empty query shows recents, and usage reorders them. **Needs** Day 65.

### Day 69 · Oct 8 | Search operators
`genre:`, `studio:`, `year:` and `score:>8` in the main search box.
> `ui` — **Done when** operators parse and compose, and an unknown operator falls back to plain text search.

### Day 70 · Oct 9 | Saved searches
Save a complex filter combo as a named one-tap search. `[W13]`
> `ui` — **Done when** a filter set saves under a name, reapplies exactly, and can be deleted. **Needs** Day 29.

### Day 71 · Oct 10 | Search presets on the home page
Pin saved searches as chips you can reach in one tap. `[W13]`
> `surface` — **Done when** pinned searches render as chips and run on tap. **Needs** Day 70.

### Day 72 · Oct 11 | Search history
Your recent queries, one tap to rerun.
> `ui` — **Done when** recent queries persist, rerun on tap, and can be cleared.

### Day 73 · Oct 12 | Fuzzy title matching
Typo-tolerant search across romaji, english and native titles.
> `data` — **Done when** a one-character typo still finds the show across all three title forms.

### Day 74 · Oct 13 | Search-as-you-type ranking
Popularity, your affinity and exact-prefix weighting blended into one ranking.
> `data` — **Done when** an exact prefix outranks a fuzzy match and results feel stable while typing. **Needs** Day 73.

### Day 75 · Oct 14 | Similar shows engine
A content-similarity score from tags, genres, staff and studio. `[W14]`
> `data` — **Done when** any show returns ranked neighbours, excluding itself.

### Day 76 · Oct 15 | Similar in the modal
The closest five shows, each with a line on why it's close. `[W14]`
> `surface` — **Done when** the modal lists five neighbours with a stated reason each. **Needs** Day 75.

### Day 77 · Oct 16 | Airing-now filter on similar
Related shows currently broadcasting, right in the show modal. `[W14]`
> `surface` — **Done when** the filter narrows neighbours to currently-airing and says so when none are. **Needs** Day 76.

### Day 78 · Oct 17 | Hidden gems query
High score, low popularity, inside the genres you already follow. `[W15]`
> `data` — **Done when** results clear a score floor and a popularity ceiling and intersect your genres. **Needs** Day 33.

### Day 79 · Oct 18 | Hidden gems page
The full list, with a "how obscure" dial you control. `[W15]`
> `ui` — **Done when** the dial moves the popularity ceiling and results update live. **Needs** Day 78.

### Day 80 · Oct 19 | Underseen by year
The best-rated thing you've never heard of, one per year.
> `surface` — **Done when** each year returns one pick absent from your library. **Needs** Day 78.

### Day 81 · Oct 20 | Random show
A dice button that respects whatever filters are currently active.
> `ui` — **Done when** the pick always satisfies the active filters and never repeats twice running.

### Day 82 · Oct 21 | Discovery streak
A daily "one new show" card you can accept or skip.
> `surface` — **Done when** the card changes once per day and both choices persist. **Needs** Day 45.

### Day 83 · Oct 22 | Browse by tag
A real tag index page, not just a search shortcut.
> `ui` — **Done when** tags list on their own route and each opens a filtered result set.

### Day 84 · Oct 23 | Browse by studio
Studio pages listing everything they've made, ranked.
> `ui` — **Done when** a studio route lists its catalogue ranked by score.

### Day 85 · Oct 24 | Browse by staff
Director and writer pages, given the same treatment.
> `ui` — **Done when** a staff route lists credits grouped by role. **Needs** Day 84.

### Day 86 · Oct 25 | Browse by year
A year index with the season breakdown underneath.
> `ui` — **Done when** a year route lists its four seasons, each linking onward.

### Day 87 · Oct 26 | Trending now
What's climbing on AniList this week, filtered through your taste profile.
> `surface` — **Done when** trending results reorder by your affinity and work with an empty profile. **Needs** Day 32.

### Day 88 · Oct 27 | Seasonal preview
Next season's full lineup with predicted scores already attached.
> `surface` — **Done when** next season lists with predictions and confidence per title. **Needs** Day 41.

### Day 89 · Oct 28 | Compare two shows
A side-by-side of any two titles' stats and your rating axes.
> `ui` — **Done when** any two shows render side by side with matching rows aligned. **Needs** Day 14.

### Day 90 · Oct 29 | Watchlist triage
A swipe-style queue to clear your Plan-to-Watch pile fast.
> `ui` — **Done when** each decision applies immediately and the queue survives an interrupted session.

### Day 91 · Oct 30 | Discovery settings
How adventurous the recommendations are, as a single slider.
> `ui` — **Done when** the slider measurably changes rec output and persists. **Needs** Day 49.

### Day 92 · Oct 31 | Month wrap
What you discovered and added this month.
> `surface` — **Done when** the card reports what was added from discovery specifically.

---

## Month 04: November 2026 · Sharing — no account needed

### Day 93 · Nov 1 | Canvas renderer
A client-side image renderer that every share card builds on. `[W16]`
> `data` — **Done when** a canvas exports a PNG blob at 2× scale with no external asset requests.

### Day 94 · Nov 2 | List poster
Your My List rendered as a poster image you can save and post anywhere. `[W16]`
> `ui` — **Done when** the poster renders the real list and downloads as a PNG. **Needs** Day 93.

### Day 95 · Nov 3 | Poster layouts
Grid, ranked and minimal variants of the same poster. `[W16]`
> `ui` — **Done when** all three variants render the same data without clipping. **Needs** Day 94.

### Day 96 · Nov 4 | Poster theming
The poster picks up your own app palette.
> `polish` — **Done when** the poster matches the active theme, including a custom accent. **Needs** Day 94.

### Day 97 · Nov 5 | URL state encoder
Compress an entire list into a URL fragment — zero backend. `[W17]`
> `data` — **Done when** a list round-trips through the fragment losslessly and a 100-show list stays under browser URL limits.

### Day 98 · Nov 6 | Public list links
Open someone else's shared URL as a read-only list. `[W17]`
> `ui` — **Done when** a shared URL renders read-only and cannot mutate the viewer's library. **Needs** Day 97.

### Day 99 · Nov 7 | Shared-list import
"Copy this into my library" straight from a shared link.
> `surface` — **Done when** import merges rather than replaces, and shows a diff before committing. **Needs** Day 98.

### Day 100 · Nov 8 | QR for any share
A QR code for any share URL, rendered locally, no shortener involved.
> `ui` — **Done when** the QR renders offline and scans back to the exact URL. **Needs** Day 97.

### Day 101 · Nov 9 | Tier list board
Drag shows into S/A/B/C/D tiers. `[W18]`
> `ui` — **Done when** drag-and-drop assigns tiers, and the board is operable by keyboard too.

### Day 102 · Nov 10 | Tier list — custom tiers
Rename, recolour and add your own rows. `[W18]`
> `ui` — **Done when** tiers can be added, renamed, recoloured and removed without stranding their shows. **Needs** Day 101.

### Day 103 · Nov 11 | Tier list share
Export the board as both a URL and an image. `[W18]`
> `surface` — **Done when** both exports reproduce the board exactly. **Needs** Days 93, 97, 101.

### Day 104 · Nov 12 | Tier list from ratings
Auto-seed the tiers from the scores you've already given.
> `surface` — **Done when** seeding places every rated show and leaves unrated ones in the tray. **Needs** Day 101.

### Day 105 · Nov 13 | Discord markdown block
Your currently-watching as clean, paste-ready Discord markdown. `[W19]`
> `ui` — **Done when** the copied block renders correctly in Discord and stays under the message length limit.

### Day 106 · Nov 14 | Discord embed preview
See how the paste will actually render before you copy it. `[W19]`
> `ui` — **Done when** the preview matches Discord's real rendering closely enough to trust. **Needs** Day 105.

### Day 107 · Nov 15 | Reddit & forum formats
The same block as Reddit markdown and BBCode.
> `surface` — **Done when** both formats copy correctly and escape their own special characters. **Needs** Day 105.

### Day 108 · Nov 16 | Plain-text list
A clipboard-friendly numbered list for everywhere else.
> `surface` — **Done when** the plain-text export carries no markup. **Needs** Day 105.

### Day 109 · Nov 17 | Seasonal bingo generator
A shareable seasonal challenge card for your community. `[W20]`
> `ui` — **Done when** a card generates from the current season and encodes into a shareable URL. **Needs** Day 97.

### Day 110 · Nov 18 | Bingo — custom squares
Write your own challenges into the card. `[W20]`
> `ui` — **Done when** custom squares persist and survive the share round-trip. **Needs** Day 109.

### Day 111 · Nov 19 | Bingo — progress tracking
Squares tick themselves from your watch data. `[W20]`
> `surface` — **Done when** squares with a derivable condition tick automatically and manual ones stay manual. **Needs** Day 109.

### Day 112 · Nov 20 | Share card for one show
A single-show card carrying your score and note.
> `surface` — **Done when** the card renders artwork, score and note, omitting any that are absent. **Needs** Day 93.

### Day 113 · Nov 21 | Share card for stats
Your top genres and hours watched, as an image.
> `surface` — **Done when** the card renders real figures and stays readable at social-thumbnail size. **Needs** Day 93.

### Day 114 · Nov 22 | Open Graph for shared links
Shared URLs preview properly on Discord, X and everywhere else.
> `content` — **Done when** a shared URL produces a correct title, description and image in a link-preview debugger. **Needs** Day 98.

### Day 115 · Nov 23 | Share sheet
One panel listing every share format available for the current view.
> `ui` — **Done when** the panel offers only formats valid for the current view.

### Day 116 · Nov 24 | Copy-link everywhere
A copy button on every show, list and filtered view.
> `surface` — **Done when** every view yields a URL that restores its exact state.

### Day 117 · Nov 25 | Embed a list
An iframe snippet for any public list.
> `surface` — **Done when** the snippet renders standalone and is not affected by host page CSS. **Needs** Day 98.

### Day 118 · Nov 26 | Compare with a friend
Diff two shared lists: the overlap, their picks, yours.
> `ui` — **Done when** two shared URLs produce a three-way diff. **Needs** Day 98.

### Day 119 · Nov 27 | Taste match score
A percentage match between two shared profiles.
> `surface` — **Done when** the score is symmetric and explains what drove it. **Needs** Days 32, 118.

### Day 120 · Nov 28 | Recommend to a friend
Pick shows their list is missing that your profile predicts they'd like.
> `surface` — **Done when** picks are absent from their list and ranked by their profile, not yours. **Needs** Day 119.

### Day 121 · Nov 29 | Share privacy
Choose exactly which fields — notes, scores, statuses — a share URL carries.
> `ui` — **Done when** excluded fields are genuinely absent from the encoded URL, not merely hidden. **Needs** Day 97.

### Day 122 · Nov 30 | Month wrap
What you shared, and who imported it.
> `surface` — **Done when** the card reports share activity without any server-side tracking.

---

## Month 05: December 2026 · Notifications & reminders

### Day 123 · Dec 1 | Reminder lead times ◐
`push-send.mjs` already fires at `v.ts − lead` with a per-subscription `lead` in minutes (default 10), and dedupes on an `id-episode-airType` tag so nothing double-fires. What it cannot do is *more than one*: a subscriber gets exactly one lead, so "warn me the day before and again at air" is unrepresentable. `[W21]`
> `infra` — **Done when** one-day, one-hour and at-air leads can be enabled independently and each fires once at the right offset. **Watch the `sent` tag**: a second lead for the same episode hashes to the tag the first one already wrote, so it would be skipped as already-sent — the tag format has to carry the lead. Touches `netlify/functions/push-send.mjs`.

### Day 124 · Dec 2 | Per-show lead override
A different lead time for the shows you actually care about. `[W21]`
> `ui` — **Done when** a per-show lead overrides the subscription-wide default (`data.lead`) and reverts cleanly. The store currently holds a flat `mediaIds` array per endpoint — this is the day it becomes a map. **Needs** Day 123.

### Day 125 · Dec 3 | Reminder preview
See the exact notification text before you commit to it.
> `ui` — **Done when** the preview matches what actually sends, including the show title and episode number.

### Day 126 · Dec 4 | Premiere alerts
A distinct alert type for first episodes. `[W22]`
> `infra` — **Done when** episode 1 fires a differently-worded alert and cannot double-fire with the regular one. **Needs** Day 123.

### Day 127 · Dec 5 | Finale alerts
The same for last episodes, worded to match the moment. `[W22]`
> `infra` — **Done when** the known final episode fires the finale alert and shows with unknown counts do not false-positive. **Needs** Day 123.

### Day 128 · Dec 6 | Season-start digest
One notification when a new season's shows begin.
> `infra` — **Done when** the digest fires once per season and lists only followed shows. **Needs** Day 123.

### Day 129 · Dec 7 | Week-ahead digest
A single weekly summary of your upcoming episodes. `[W23]`
> `infra` — **Done when** one weekly notification covers seven days and suppresses itself when empty. **Needs** Day 123.

### Day 130 · Dec 8 | Digest scheduling
Pick the day and hour the digest arrives. `[W23]`
> `ui` — **Done when** the digest arrives in the chosen local slot. **Needs** Day 129.

### Day 131 · Dec 9 | Digest content controls
Choose which sections the digest includes.
> `ui` — **Done when** disabled sections are absent from the delivered digest. **Needs** Day 129.

### Day 132 · Dec 10 | Quiet hours
A nightly window where nothing fires. `[W24]`
> `infra` — **Done when** nothing delivers inside the window, including across a midnight boundary. **Needs** Day 123.

### Day 133 · Dec 11 | Per-show mute
Silence one show without unfollowing it. `[W24]`
> `ui` — **Done when** a muted show keeps its follow state but sends nothing. **Needs** Day 123.

### Day 134 · Dec 12 | Test notification
A one-tap "does this actually work" button. `[W24]`
> `ui` — **Done when** the button delivers a real notification and reports failure with a reason.

### Day 135 · Dec 13 | Notification history
The last thirty alerts, in-app, showing what fired and when.
> `ui` — **Done when** history records deliveries with timestamps and caps at thirty.

### Day 136 · Dec 14 | Delivery diagnostics
Why a notification didn't arrive, explained in plain language.
> `ui` — **Done when** each failure mode — permission, expired subscription, quiet hours — reports distinctly. **Needs** Day 135.

### Day 137 · Dec 15 | Permission re-prompt flow
A graceful path back after a denied notification permission.
> `ui` — **Done when** a denied state explains how to re-enable it in the browser rather than silently failing.

### Day 138 · Dec 16 | Multi-device push ◐
Already true in the narrow sense: subscriptions are keyed by push endpoint (`_lib/subs.mjs` → `keyFor`), so two devices are two rows and each receives exactly one copy. The real gap runs the other way — each device carries its own `mediaIds`, `lead` and `airType`, so following a show on your phone doesn't follow it on your laptop, and nothing ties the two rows to one person.
> `infra` — **Done when** one person's devices share a follow list, each device still receives exactly one copy, and removing one device leaves the others working. This is the first day that genuinely wants `_lib/session.mjs` — re-read the sign-in invariant before reaching for it, because the settings panel currently promises nothing of yours is uploaded. Touches `netlify/functions/_lib/subs.mjs`.

### Day 139 · Dec 17 | Delayed-episode handling ◐
Air times already resolve through the correction layer on every run, so a moved time is simply read correctly — there is no stored fire time to go stale, and nothing to "reschedule". Two real gaps remain: a run only fires inside a ~16-minute window (`RUN_WINDOW_MS`), so an episode moved *into* a window that has already passed is missed in silence; and an alert already sent against the old time is never followed by a correction.
> `infra` — **Done when** an episode whose time moves past its window still alerts, and a move that happens after the alert went out sends a correction instead of leaving the wrong time standing. **Needs** Day 123.

### Day 140 · Dec 18 | Break & hiatus alerts ◐
Breaks are already modelled and already *suppress* alerts — `variantsFor` returns no variants for a break week, so the run produces nothing at all. The missing half is telling the follower, because silence is indistinguishable from a show that quietly stopped.
> `infra` — **Done when** a break notifies once carrying the reason the override record already stores, never weekly, and the resumption is announced too. **Needs** Day 123.

### Day 141 · Dec 19 | Batch alerts
Group same-hour episodes into one notification instead of five.
> `infra` — **Done when** episodes sharing an hour arrive as one grouped notification. **Needs** Day 123.

### Day 142 · Dec 20 | Rich notifications ◐
The payload already carries cover art as `icon`, the episode number in the title, the platform and resolved time in the body, and a per-episode `tag` so the OS collapses duplicates. What's missing is `image` — the large banner some platforms render — and the fallback when art fails to load rather than merely being absent.
> `polish` — **Done when** a large image renders where the platform supports it and a failed image degrades to the current icon-plus-text form. **Needs** Day 123.

### Day 143 · Dec 21 | Notification actions
"Mark watched" and "snooze" straight from the notification.
> `surface` — **Done when** both actions work without focusing the app. **Needs** Days 07, 123.

### Day 144 · Dec 22 | Snooze
Push any reminder forward by an hour or a day.
> `surface` — **Done when** a snoozed reminder re-fires once at the new time. **Needs** Day 143.

### Day 145 · Dec 23 | Calendar-style reminders
An .ics alarm option for people who live inside their calendar.
> `content` — **Done when** the feed carries VALARM entries that a real calendar client honours.

### Day 146 · Dec 24 | Streaming-release lead ✅ shipped
Landed Aug 2026 with release variants. `push-subscribe.mjs` stores the subscriber's `airType`; `push-send.mjs` resolves through `preferredVariant`, so alerts land on the simulcast by default and the dub only if asked, falling back to the broadcast time flagged approximate where no override exists. The body names which release it is — `Simulcast (approx.)` / `Dub` / `JP broadcast` — and the platform.
> `infra` — Nothing left in this day. If it comes up, spend it on Day 147, which is still entirely open.

### Day 147 · Dec 25 | Region-aware timing
Reminders in your timezone, with the source time shown alongside.
> `ui` — **Done when** both times display and the conversion survives a DST boundary. **Needs** Day 123.

### Day 148 · Dec 26 | Do-not-disturb sync
Respect the OS focus mode wherever the browser exposes it.
> `infra` — **Done when** the app defers to OS focus state where the API exists and falls back to quiet hours where it does not. **Needs** Day 132.

### Day 149 · Dec 27 | Reminder rules
"Only premieres", "only shows I'm behind on" — saved as reusable rules.
> `ui` — **Done when** rules compose and their combined effect is previewable. **Needs** Day 126.

### Day 150 · Dec 28 | Backlog nudge
An opt-in weekly poke about shows you've stalled on.
> `infra` — **Done when** the nudge fires only for genuinely stalled shows and never for archived ones. **Needs** Days 07, 27.

### Day 151 · Dec 29 | Alert volume cap
A hard ceiling on notifications per day.
> `infra` — **Done when** the cap holds and suppressed alerts roll into the next digest rather than vanishing. **Needs** Day 129.

### Day 152 · Dec 30 | Notification settings page
Every control above, in one screen, with a reset button.
> `ui` — **Done when** every notification setting is reachable from one route and reset restores defaults.

### Day 153 · Dec 31 | Month wrap
What fired, and what you actually watched because of it.
> `surface` — **Done when** the card correlates deliveries with subsequent watches. **Needs** Day 135.

---

## Month 06: January 2027 · Stats & insights

### Day 154 · Jan 1 | Stats data layer
A single computed stats object that every panel reads from. `[W25]`
> `data` — **Done when** one computation feeds every panel and recomputes on library change. Existing charts live in `renderDashboard()`.

### Day 155 · Jan 2 | Hours watched
Total, this season and all-time, with the arithmetic shown. `[W25]`
> `ui` — **Done when** all three figures render and account for episode duration, not episode count. **Needs** Day 154.

### Day 156 · Jan 3 | Top genres panel
Your most-watched genres by hours, not by title count. `[W25]`
> `ui` — **Done when** ranking uses hours and the distinction from count is visible. **Needs** Day 155.

### Day 157 · Jan 4 | Top studios panel
The same treatment for studios. `[W25]`
> `ui` — **Done when** studios rank by hours with co-productions attributed sensibly. **Needs** Day 155.

### Day 158 · Jan 5 | Day-of-week pattern
When you actually watch, as a heatmap. `[W25]`
> `ui` — **Done when** the heatmap reflects real watch timestamps and reads in both themes. **Needs** Days 12, 154.

### Day 159 · Jan 6 | Time-of-day pattern
The same thing at hourly resolution.
> `ui` — **Done when** hourly buckets render in local time. **Needs** Day 158.

### Day 160 · Jan 7 | Completion rate
How often you finish what you start, broken down by genre.
> `surface` — **Done when** the rate excludes still-airing shows from the denominator. **Needs** Day 154.

### Day 161 · Jan 8 | Drop analysis
Where in a run you tend to drop, as an episode-number histogram.
> `surface` — **Done when** the histogram normalises by series length so long and short shows compare fairly. **Needs** Day 160.

### Day 162 · Jan 9 | Watch streaks
Consecutive days with something watched. `[W26]`
> `data` — **Done when** the streak counts correctly across timezone changes and breaks only on a genuinely empty day. **Needs** Day 07.

### Day 163 · Jan 10 | Streak calendar
A year-view contribution grid of your watching. `[W26]`
> `ui` — **Done when** the grid renders a full year, scrolls horizontally on mobile, and is screen-reader navigable. **Needs** Day 162.

### Day 164 · Jan 11 | Backlog burndown
Your Plan-to-Watch pile over time, trending. `[W26]`
> `ui` — **Done when** the chart plots real history and states that it only covers tracked days. **Needs** Day 154.

### Day 165 · Jan 12 | Backlog estimator
Total hours to clear everything you're behind on. `[W28]`
> `surface` — **Done when** the estimate counts unwatched episodes only and excludes archived shows. **Needs** Days 07, 27.

### Day 166 · Jan 13 | Catch-up planner
How many episodes a day to be current by a date you pick. `[W28]`
> `ui` — **Done when** the plan accounts for episodes still to air before the target date. **Needs** Day 165.

### Day 167 · Jan 14 | Season Wrapped generator
The end-of-season recap engine. `[W27]`
> `data` — **Done when** any past season produces a complete recap payload. **Needs** Day 154.

### Day 168 · Jan 15 | Wrapped — top five
Your highest-rated shows of the season, as a card. `[W27]`
> `ui` — **Done when** the card handles a season with fewer than five rated shows. **Needs** Day 167.

### Day 169 · Jan 16 | Wrapped — superlatives
Biggest surprise, biggest disappointment, most binged. `[W27]`
> `surface` — **Done when** each superlative derives from prediction-versus-actual and omits itself when unearned. **Needs** Days 44, 167.

### Day 170 · Jan 17 | Wrapped — share image
The whole recap as one poster. `[W27]`
> `surface` — **Done when** the poster renders the recap and downloads. **Needs** Days 93, 167.

### Day 171 · Jan 18 | Year in review
The same treatment stretched across a full year.
> `surface` — **Done when** a full year renders using the same engine. **Needs** Day 167.

### Day 172 · Jan 19 | Rating drift
How your average score has moved over time.
> `surface` — **Done when** the trend plots by rating date and states its sample size. **Needs** Days 12, 154.

### Day 173 · Jan 20 | Genre drift
Which genres grew and shrank in your watching, year over year.
> `surface` — **Done when** growth and decline are signed and a single-year library says so. **Needs** Day 172.

### Day 174 · Jan 21 | Studio loyalty
Which studios you keep coming back to.
> `surface` — **Done when** repeat-rate ranks above raw count. **Needs** Day 157.

### Day 175 · Jan 22 | Score versus crowd
Where you sit against the average, per show.
> `surface` — **Done when** every rated show shows a signed delta against the crowd. **Needs** Day 154.

### Day 176 · Jan 23 | Contrarian picks
The shows you rate furthest from everyone else.
> `surface` — **Done when** picks rank by absolute delta with direction shown. **Needs** Day 175.

### Day 177 · Jan 24 | Longest binge
Your biggest single-day episode count.
> `surface` — **Done when** the figure is a real recorded day, not an estimate. **Needs** Day 162.

### Day 178 · Jan 25 | Watch anniversaries
"A year ago today you started X."
> `surface` — **Done when** anniversaries fire on the right date and stay silent when there are none. **Needs** Day 12.

### Day 179 · Jan 26 | Milestone badges
100 episodes, 50 shows, 1000 hours — earned quietly, no fanfare.
> `polish` — **Done when** badges award once, persist, and never un-award. **Needs** Day 155.

### Day 180 · Jan 27 | Pace versus airing
Are you keeping up with currently-airing shows, per show.
> `surface` — **Done when** each airing show reports episodes behind, and zero reads as caught up. **Needs** Day 07.

### Day 181 · Jan 28 | Stats export
Every panel's underlying numbers, as JSON.
> `surface` — **Done when** the export contains every displayed figure and is valid JSON. **Needs** Day 154.

### Day 182 · Jan 29 | Stats page layout
Reorder and hide panels to build your own dashboard.
> `ui` — **Done when** order and visibility persist and a hidden panel stops computing.

### Day 183 · Jan 30 | Stats privacy
A local-only toggle so nothing computed ever leaves the device.
> `ui` — **Done when** enabling it demonstrably suppresses every outbound request from the stats layer.

### Day 184 · Jan 31 | Month wrap
January in numbers.
> `surface` — **Done when** the card summarises the month from the stats layer. **Needs** Day 154.

---

## Month 07: February 2027 · Theming & delight

### Day 185 · Feb 1 | Palette engine ◐
The engine exists, and went further than this day asked: `SKIN_VARS` resolves a thirteen-variable palette (`bg`, `bg2`, `bg3`, `line`, `txt`, `muted`, `accent`, `accent2`, `premiere`, `today`, `good`, `now`, `finale`) plus eight shape and type variables, applied to `body` in one pass by `applySkin()`. The acceptance line is still unmet, though: **73 six-digit hex literals remain hardcoded in `site/index.html`**, so a skin repaints most of the page and leaves the rest — which is exactly why some surfaces don't move when you wear one. `[W29]`
> `data` — **Done when** every colour resolves through a token, the hex count outside the token definitions is zero, and wearing a skin visibly repaints every surface. Current accent key is `anical.accent` — a `"#a|#b"` pair set on `:root` one layer *above* the skin, which is why it survives `applySkin()`.

### Day 186 · Feb 2 | Theme gallery ◐
`site/data/themes.json` is a gallery already: a curated set served through `/api/themes`, cached in `anical.skin` for an instant first paint, with `anical.skinOn` as the wearer's own switch. But a skin is *granted*, not chosen — handed out per Discord account, and the only user control is turning yours off. This day is the user-owned half: palettes you make and keep locally, sitting alongside a granted skin rather than fighting it. `[W29]`
> `ui` — **Done when** a user-made palette saves, names, switches instantly and survives a reload, and the precedence between a granted skin and a self-made one is a stated rule rather than whichever call ran last. **Needs** Day 185.

### Day 187 · Feb 3 | Theme import & export ◐
A theme is already pure JSON — nothing binary in the repo, no upload endpoint, generated by `scripts/build-themes.mjs` and served from `/api/themes` — so the shareable format exists. Missing is the user-facing round trip. `[W29]`
> `surface` — **Done when** a palette round-trips through a paste-able string losslessly and a malformed one is rejected with a reason. Reuse the server's character class for `pattern` and `ornament`: an imported theme is untrusted input that ends up inside a CSS `url()`. **Needs** Day 186.

### Day 188 · Feb 4 | Community palettes ✅ shipped early
The bundled set ships — ten motifs generated from each show's own art and its AniList dominant colour (asanoha for Demon Slayer, seigaiha for One Piece, cursed slashes for Jujutsu Kaisen, a hex grid for Solo Leveling), regenerated with `node scripts/build-themes.mjs` and URL-verified with `--check`.
> `polish` — **What's left**: not one of them has been through a contrast guard, because there isn't one yet. Audit the shipped set the day Day 190 lands and fix what fails. **Needs** Day 190.

### Day 189 · Feb 5 | Live palette editor ◐
`/admin` → **Skins** already edits and previews against the real running site, handed over in `localStorage` (`anical.previewSkin`) rather than a `?theme=` URL — deliberately, because a link would let anyone wear an event skin. That is the maintainer's editor. This day is the same capability pointed at a user's own palette.
> `ui` — **Done when** edits apply live and can be abandoned without saving. **Needs** Day 186.

### Day 190 · Feb 6 | Contrast guard
Warn when a palette breaks readable contrast.
> `a11y` — **Done when** any token pair below WCAG AA warns before the palette can be saved, **and** the shipped `themes.json` set is audited against the same rule — those palettes were derived from cover art with no contrast check anywhere in the pipeline. **Needs** Day 189.

### Day 191 · Feb 7 | Cover-art theming ◐
`build-themes.mjs` already derives a palette from a show's art and its AniList dominant colour — but at build time, for the curated set only. This day is the runtime version: the accent adapting to whatever show you happen to be looking at. `[W31]`
> `polish` — **Done when** the extracted accent passes the contrast guard or falls back to the default. **Needs** Day 190.

### Day 192 · Feb 8 | Per-show accent memory
Remember the extracted accent so it doesn't flicker on every open. `[W31]`
> `data` — **Done when** reopening a show applies its accent with no visible flash. **Needs** Day 191.

### Day 193 · Feb 9 | Ambient seasons
Opt-in seasonal UI touches tied to the current anime season. `[W30]`
> `polish` — **Done when** ambience is off by default and respects `prefers-reduced-motion`.

### Day 194 · Feb 10 | Sakura mode
Spring petals, reduced-motion safe. `[W30]`
> `polish` — **Done when** the effect runs on canvas, idles under 1% CPU, and stops entirely under reduced motion. **Needs** Day 193.

### Day 195 · Feb 11 | Snow mode
The winter equivalent. `[W30]`
> `polish` — **Done when** it reuses the same particle system as sakura. **Needs** Day 194.

### Day 196 · Feb 12 | Summer & autumn ambience
The other two, completing the set. `[W30]`
> `polish` — **Done when** all four seasons exist and the current one auto-selects. **Needs** Day 195.

### Day 197 · Feb 13 | Ambience intensity
A dial from "barely there" to "full".
> `ui` — **Done when** the dial changes particle density live and zero means no canvas at all. **Needs** Day 196.

### Day 198 · Feb 14 | Finale confetti
A small celebration when you finish a show. `[W32]`
> `polish` — **Done when** it fires once on completion only and is suppressed under reduced motion.

### Day 199 · Feb 15 | Watched checkoff animation
A satisfying tick when you mark an episode. `[W32]`
> `polish` — **Done when** the animation never delays the state change it accompanies. **Needs** Day 07.

### Day 200 · Feb 16 | Rating flourish
A tiny animation tuned to how high you scored something.
> `polish` — **Done when** the flourish varies with score and stays under 400ms. **Needs** Day 14.

### Day 201 · Feb 17 | Reduced-motion audit
Every animation above respects `prefers-reduced-motion`. `[W32]`
> `a11y` — **Done when** no animation runs with the OS setting enabled, verified across every view.

### Day 202 · Feb 18 | Loading skeletons
Real skeletons instead of spinners, everywhere.
> `polish` — **Done when** skeletons match the shape of the content they replace and cause no layout shift.

### Day 203 · Feb 19 | Empty states
Illustrated, useful empty states that suggest a next action.
> `ui` — **Done when** every list view has an empty state naming a concrete next action.

### Day 204 · Feb 20 | Error states
Friendly errors that say what to do, not just what broke.
> `ui` — **Done when** each failure mode states a recovery action and offers retry where retry can work.

### Day 205 · Feb 21 | Page transitions
A subtle shared-element transition into show pages.
> `polish` — **Done when** the transition never blocks interaction and is skipped under reduced motion. **Needs** Day 55.

### Day 206 · Feb 22 | Hover previews
A quick synopsis card on hover — keyboard-reachable too.
> `ui` — **Done when** the preview opens on focus as well as hover and dismisses on Escape.

### Day 207 · Feb 23 | Sound design (opt-in)
Three tiny sounds, off by default.
> `polish` — **Done when** sound is off by default, respects the OS mute, and each sound is under 20KB.

### Day 208 · Feb 24 | Icon set pass
A consistent icon family across the whole app.
> `polish` — **Done when** every icon comes from one family and each carries an accessible label.

### Day 209 · Feb 25 | Typography pass
A proper type scale with tighter headings.
> `polish` — **Done when** every text size resolves to a scale step and body copy sits near 65 characters.

### Day 210 · Feb 26 | Density & radius controls ◐
The tokens already exist and already reshape the page wholesale — `--radius`, `--skin-chip-radius`, `--skin-border`, `--skin-card-blur`, all set by `applySkin()` from a theme's `shape` block. They are simply not user controls.
> `ui` — **Done when** both controls apply app-wide through those existing tokens and persist, and a self-made setting is not silently overwritten the next time a skin applies. **Needs** Days 28, 185.

### Day 211 · Feb 27 | App icon variants
Pick the PWA icon that matches your theme.
> `polish` — **Done when** the manifest icon changes with the selection and survives reinstall.

### Day 212 · Feb 28 | Month wrap
February's look, before and after.
> `surface` — **Done when** the card shows a genuine before-and-after of the theming work.

---

## Month 08: March 2027 · Accessibility & inclusivity

### Day 213 · Mar 1 | Accessibility audit baseline
An automated axe pass wired into the workflow, with the score recorded.
> `infra` — **Done when** the pass runs on demand and records a baseline violation count to improve against.

### Day 214 · Mar 2 | Font-size slider
Scale the whole UI, not just body text. `[W33]`
> `a11y` — **Done when** scaling reflows without clipping at every step. **Needs** Day 209.

### Day 215 · Mar 3 | Line-height & spacing controls
The readability half of the same panel. `[W33]`
> `a11y` — **Done when** both controls apply app-wide and persist. **Needs** Day 214.

### Day 216 · Mar 4 | Dyslexia-friendly font
An opt-in typeface applied across the app. `[W33]`
> `a11y` — **Done when** the face applies everywhere including numerals, self-hosted with no external request. **Needs** Day 209.

### Day 217 · Mar 5 | High-contrast theme
A dedicated, tested high-contrast palette. `[W34]`
> `a11y` — **Done when** every token pair clears WCAG AAA. **Needs** Day 190.

### Day 218 · Mar 6 | Forced-colors support
Respect Windows high-contrast mode properly.
> `a11y` — **Done when** the app is fully usable under `forced-colors: active`. **Needs** Day 217.

### Day 219 · Mar 7 | Reduced-motion audit v2
The full pass across every remaining animation. `[W34]`
> `a11y` — **Done when** the audit finds zero unguarded animations. **Needs** Day 201.

### Day 220 · Mar 8 | Focus-visible pass
A clear, consistent focus ring everywhere.
> `a11y` — **Done when** every interactive element shows a visible ring meeting contrast requirements.

### Day 221 · Mar 9 | Focus order pass
Tab order that matches visual order on every view. `[W35]`
> `a11y` — **Done when** tab order matches reading order on every view with no positive tabindex. **Needs** Day 220.

### Day 222 · Mar 10 | Focus trapping
Modals that hold focus and return it correctly on close.
> `a11y` — **Done when** focus cannot escape an open modal and returns to the trigger on close. **Needs** Day 221.

### Day 223 · Mar 11 | Skip links
Skip to content, skip to filters, skip to results.
> `a11y` — **Done when** skip links are the first tab stops and become visible on focus.

### Day 224 · Mar 12 | Landmark regions
Proper header, nav, main and aside structure for screen readers.
> `a11y` — **Done when** every view exposes correct landmarks with no content outside one.

### Day 225 · Mar 13 | Heading hierarchy
A real h1–h6 outline on every page.
> `a11y` — **Done when** every view has exactly one h1 and no skipped levels. **Needs** Day 224.

### Day 226 · Mar 14 | Alt text pass
Meaningful alt text on covers, banners and icons.
> `a11y` — **Done when** informative images carry descriptive alt and decorative ones are hidden from the tree.

### Day 227 · Mar 15 | Live regions
Screen-reader announcements for countdowns and status updates. `[W36]`
> `a11y` — **Done when** status changes announce once without flooding on every countdown tick.

### Day 228 · Mar 16 | Announce filter results
"42 shows match" spoken whenever filters change. `[W36]`
> `a11y` — **Done when** result counts announce on change, debounced. **Needs** Day 227.

### Day 229 · Mar 17 | Keyboard shortcut sheet
A complete, searchable shortcut reference. `[W35]`
> `ui` — **Done when** the sheet lists every real binding and is itself keyboard-reachable.

### Day 230 · Mar 18 | Rebindable shortcuts
Change any shortcut, stored locally.
> `ui` — **Done when** rebinding persists and conflicts are refused with an explanation. **Needs** Day 229.

### Day 231 · Mar 19 | Keyboard-only list management
Reorder collections without touching a mouse.
> `a11y` — **Done when** every drag interaction has a keyboard equivalent. **Needs** Days 03, 221.

### Day 232 · Mar 20 | Screen-reader table mode
The calendar as a navigable table alternative.
> `a11y` — **Done when** the alternative conveys the same information with proper table semantics.

### Day 233 · Mar 21 | Calendar keyboard navigation
Arrow keys through days and episodes.
> `a11y` — **Done when** arrows move between days and episodes with focus always visible. **Needs** Day 220.

### Day 234 · Mar 22 | Touch target audit
Every control at least 44px on touch.
> `a11y` — **Done when** no interactive target is under 44px at touch widths.

### Day 235 · Mar 23 | Colour-blind safe palettes
Deuteranopia, protanopia and tritanopia variants.
> `a11y` — **Done when** all three variants keep every status distinguishable. **Needs** Day 185.

### Day 236 · Mar 24 | Never colour alone
Icons and text alongside every colour-coded status.
> `a11y` — **Done when** no state is conveyed by colour alone anywhere in the app. **Needs** Day 235.

### Day 237 · Mar 25 | Text spacing resilience
Survive the WCAG text-spacing override without breaking layout.
> `a11y` — **Done when** the override causes no clipping or overlap on any view. **Needs** Day 215.

### Day 238 · Mar 26 | Zoom to 400%
A reflow pass so nothing is lost at extreme zoom.
> `a11y` — **Done when** 400% zoom loses no content and forces no horizontal scroll. **Needs** Day 214.

### Day 239 · Mar 27 | Language & locale
Proper `lang` attributes and locale-aware date formatting.
> `a11y` — **Done when** dates format to the user's locale and non-English text carries its own `lang`.

### Day 240 · Mar 28 | Native title display
Native titles rendered with correct scripts and fonts.
> `a11y` — **Done when** Japanese titles render correctly with the right `lang` and no tofu. **Needs** Day 239.

### Day 241 · Mar 29 | Content warnings
Opt-in flags for common triggers, derived from tags.
> `ui` — **Done when** flags derive from tags, are off by default, and blur rather than remove.

### Day 242 · Mar 30 | Accessibility statement
An honest page on what's supported and what isn't.
> `content` — **Done when** the page names real known gaps rather than claiming full compliance. **Needs** Day 213.

### Day 243 · Mar 31 | Month wrap
The audit score, before and after.
> `surface` — **Done when** the card reports the real violation delta since Day 213. **Needs** Day 213.

---

## Month 09: April 2027 · Where to watch

### Day 244 · Apr 1 | Streaming data layer
Normalize availability out of AniList's external links. `[W37]`
> `data` — **Done when** raw external links resolve to a known service list and unknowns are retained, not dropped.

### Day 245 · Apr 2 | Service picker
Choose your subscriptions, stored locally. `[W37]`
> `ui` — **Done when** selections persist and drive every downstream filter. **Needs** Day 244.

### Day 246 · Apr 3 | Only-on-my-services filter
Dim or hide what you can't actually stream. `[W37]`
> `surface` — **Done when** the filter offers both dim and hide, and unknown availability is treated as unknown rather than unavailable. **Needs** Day 245.

### Day 247 · Apr 4 | Service badges
Small, recognisable service marks on every card.
> `surface` — **Done when** badges render inline with no external image requests. **Needs** Day 244.

### Day 248 · Apr 5 | Region selector
Availability by country, not just timezone. `[W38]`
> `data` — **Done when** region is stored separately from timezone and defaults sensibly. **Needs** Day 244.

### Day 249 · Apr 6 | Region-aware badges
The badges change when you change region. `[W38]`
> `surface` — **Done when** switching region visibly changes availability. **Needs** Day 248.

### Day 250 · Apr 7 | Region mismatch warning
"This is on Crunchyroll — but not in your region."
> `ui` — **Done when** a service present globally but absent locally is called out explicitly. **Needs** Day 249.

### Day 251 · Apr 8 | Resume links
One-click deep links to the exact show on each service. `[W40]`
> `surface` — **Done when** links open the show's own page, not a search result. **Needs** Day 244.

### Day 252 · Apr 9 | Episode-level deep links
Straight to the next episode, wherever the service allows it. `[W40]`
> `surface` — **Done when** services supporting episode links use them and the rest fall back to the show page. **Needs** Days 07, 251.

### Day 253 · Apr 10 | Dub availability ◐
Dub is already a first-class release type rather than a badge: `variantsFor` fans one AniList airing node into `raw` / `sub` / `dub`, and dub is *never* estimated — no override data means no dub row at all, because an invented dub date is worse than none. "Unknown" is therefore already its own state, expressed as absence. What's missing is availability as distinct from *timing*: knowing a dub exists on a service without knowing when its next episode drops. `[W39]`
> `data` — **Done when** dub availability is distinguished from dub scheduling, and a show with a known dub but no dated episode says so rather than showing nothing at all. **Needs** Day 244.

### Day 254 · Apr 11 | Dub calendar track ◐
Dub releases already render as their own variant chips and can already be turned off — `anical.airTypes` through `enabledTypes()`, plus the condensing rules in `anical.hideRules`. What doesn't exist is the *lane*: dub sits interleaved with everything else instead of reading as a separate track. `[W39]`
> `ui` — **Done when** dub releases render as their own lane and the existing toggle still turns them off — one control, not a second one that disagrees with the first. **Needs** Day 253.

### Day 255 · Apr 12 | Dub lead time ◐
The gap is already measured rather than guessed. `scripts/ingest-crunchyroll.mjs` derives dub offsets daily inside a 0–120 day plausibility band and extrapolates an episode only from a cadence confirmed uniform — LIAR GAME's dub sits two weeks and an hour behind its sub, verified across 17 episodes. The figure is sitting in `data/derived-offsets.json`; nobody is ever shown it.
> `surface` — **Done when** the expected gap displays from the derived offset, cadence-derived figures say so in the UI as they already do in the `source` string, and an unmeasured show reads as unknown rather than zero. **Needs** Day 253.

### Day 256 · Apr 13 | Sub versus dub preference ◐
The global default exists twice over, in two stores that don't know about each other: `anical.airTypes` decides which releases the calendar renders, and each push subscription carries its own `airType` for alerts. Neither has per-show overrides.
> `ui` — **Done when** a per-show override beats the global default in the calendar *and* in the alert — which means reconciling those two stores, not adding a third. **Needs** Day 254.

### Day 257 · Apr 14 | Simulcast timing ✅ shipped
The feature the whole correction layer was built for. The modal's schedule list renders every known variant for an episode with its own clock — broadcast, simulcast and dub together — with `~` marking an estimated simulcast and the platform named. Offsets are measured from Crunchyroll's published `<time datetime>` values rather than assumed.
> `surface` — Nothing left. Worth carrying forward: the measured spread was **0 to 63 minutes**, which is the entire reason Days 258 and 146 exist.

### Day 258 · Apr 15 | Streaming countdown ◐
The corrected sub time already resolves and already displays. The countdown still ticks against whichever release the row is for rather than against the service *you* use — and where no override exists it falls back to the broadcast time flagged `~`, which the measurements say is wrong by about half an hour for most shows. Half an hour is exactly long enough to make someone miss it.
> `surface` — **Done when** the countdown targets your service's drop wherever an override exists, and visibly refuses to imply precision where only the estimate is available. **Needs** Day 257.

### Day 259 · Apr 16 | Free versus paid
Mark what's watchable without a subscription.
> `surface` — **Done when** free availability is marked distinctly from paid. **Needs** Day 244.

### Day 260 · Apr 17 | Ad-tier awareness
Flag where a free tier exists but lags behind.
> `surface` — **Done when** the lag is stated rather than the tier merely being listed. **Needs** Day 259.

### Day 261 · Apr 18 | Where-to-watch page per show
The existing pages, upgraded with everything above.
> `content` — **Done when** the generated pages carry the new availability data. Touches `scripts/build-seo.mjs`. **Needs** Day 244.

### Day 262 · Apr 19 | Where-to-watch index
Everything airing, grouped by service.
> `content` — **Done when** the index groups the airing season by service. **Needs** Day 261.

### Day 263 · Apr 20 | Service coverage stats
What percentage of your list each service actually covers.
> `surface` — **Done when** coverage is computed against your real library. **Needs** Days 245, 154.

### Day 264 · Apr 21 | Subscription advisor
Which single service would unlock the most of your backlog.
> `surface` — **Done when** the recommendation names the marginal gain over what you already have. **Needs** Day 263.

### Day 265 · Apr 22 | Cancel advisor
Which subscription you're barely using, from your own watch data.
> `surface` — **Done when** the advice cites actual hours watched per service. **Needs** Day 263.

### Day 266 · Apr 23 | Cost per hour
What each service actually costs you per hour watched.
> `ui` — **Done when** user-entered costs divide by real hours watched. **Needs** Day 265.

### Day 267 · Apr 24 | Physical release links
Where a show exists on disc, for the shows that warrant it.
> `surface` — **Done when** disc availability shows where known and is absent, not empty, where not.

### Day 268 · Apr 25 | Legal-only mode
A setting that hides anything without a legitimate source.
> `ui` — **Done when** the mode hides unlicensed titles and explains why they are hidden. **Needs** Day 244.

### Day 269 · Apr 26 | Missing availability reports ◐
The intake exists and works: `netlify/functions/report.mjs`, reached from **⚠ Report a wrong time** in every show's details, length-capped and keyed by show + episode + a hash of the reporter's IP so one person can't flood it, cleared by a maintainer in `/admin`. It accepts times and nothing else.
> `ui` — **Done when** the same path accepts a wrong or missing service link, capturing show, service and problem, and confirms receipt — without handing the queue a second schema that `/admin` doesn't know how to apply.

### Day 270 · Apr 27 | Availability change alerts
Tell me when something on my list gains or loses a service.
> `infra` — **Done when** a change fires exactly one notification. **Needs** Days 123, 244.

### Day 271 · Apr 28 | Leaving soon
Flag titles about to drop off a service you use.
> `surface` — **Done when** expiring titles are flagged with their remaining window. **Needs** Day 270.

### Day 272 · Apr 29 | New on your services
What arrived this week on services you actually have.
> `surface` — **Done when** the list covers only your selected services and only the last seven days. **Needs** Day 245.

### Day 273 · Apr 30 | Month wrap
Coverage and cost, summarised.
> `surface` — **Done when** the card reports coverage and cost per hour together. **Needs** Day 266.

---

## Month 10: May 2027 · Franchises & deep catalog

### Day 274 · May 1 | Relation graph
Build the full prequel, sequel and side-story graph per title. `[W41]`
> `data` — **Done when** the graph traverses without infinite loops on circular relations.

### Day 275 · May 2 | Franchise detection
Cluster related entries into a single franchise. `[W41]`
> `data` — **Done when** every entry of a known franchise lands in one cluster with a stable identifier. **Needs** Day 274.

### Day 276 · May 3 | Franchise hub page
Every entry of a franchise, in one place. `[W41]`
> `ui` — **Done when** one route lists the whole franchise with your progress on each. **Needs** Day 275.

### Day 277 · May 4 | Release order view
The franchise in the order it actually came out. `[W41]`
> `surface` — **Done when** ordering is by air date with undated entries placed sensibly. **Needs** Day 276.

### Day 278 · May 5 | Watch order view
The recommended order, with the reasoning shown. `[W41]`
> `surface` — **Done when** the order differs from release where warranted and states why. **Needs** Day 277.

### Day 279 · May 6 | Watch order — community variants
Alternate orders, labelled by who recommends them.
> `ui` — **Done when** multiple orders coexist, each attributed. **Needs** Day 278.

### Day 280 · May 7 | Franchise progress
How much of a franchise you've completed, as one bar.
> `surface` — **Done when** the bar counts episodes, not entries. **Needs** Days 07, 276.

### Day 281 · May 8 | Where to start
The right entry point for a franchise you haven't touched.
> `surface` — **Done when** the suggestion names one entry and justifies it. **Needs** Day 278.

### Day 282 · May 9 | Skip guidance
Recap episodes and filler flagged as skippable.
> `surface` — **Done when** skippable episodes are marked and never auto-skipped. **Needs** Day 57.

### Day 283 · May 10 | Franchise stats
Total runtime, span in years, studios involved.
> `surface` — **Done when** all three compute across the whole cluster. **Needs** Day 276.

### Day 284 · May 11 | Sequel watch
Auto-flag announced sequels for shows you've completed. `[W42]`
> `data` — **Done when** a sequel to a completed show is flagged, and unannounced ones are not guessed at. **Needs** Day 274.

### Day 285 · May 12 | Sequel alerts
A notification when a sequel is announced or finally dated. `[W42]`
> `infra` — **Done when** announcement and dating fire distinct alerts, once each. **Needs** Days 123, 284.

### Day 286 · May 13 | Announced-but-undated
A tracker for the shows stuck in limbo.
> `ui` — **Done when** undated announcements list separately with their announcement date. **Needs** Day 284.

### Day 287 · May 14 | Adaptation mapping
Link an anime to its source manga or light novel. `[W43]`
> `data` — **Done when** the source resolves where AniList has the relation, and originals are marked as such.

### Day 288 · May 15 | Adaptation range
Which volumes or chapters an anime actually covers. `[W43]`
> `surface` — **Done when** the range displays where known and is absent where not — never guessed. **Needs** Day 287.

### Day 289 · May 16 | Read on from here
The exact chapter to continue from once the anime ends. `[W43]`
> `surface` — **Done when** the pointer derives from the adaptation range and states its confidence. **Needs** Day 288.

### Day 290 · May 17 | Source status
Is the source finished, ongoing, or on hiatus.
> `surface` — **Done when** all three states are distinguished, hiatus included. **Needs** Day 287.

### Day 291 · May 18 | Source progress tracking
Track your manga and light-novel reading alongside the anime.
> `data` — **Done when** reading progress persists separately from watch progress. **Needs** Days 07, 287.

### Day 292 · May 19 | Anime-original divergence
Flag where an adaptation departs from its source.
> `surface` — **Done when** divergence is flagged where data supports it and silent where it does not. **Needs** Day 288.

### Day 293 · May 20 | Character data layer
Pull characters and voice actors per show. `[W44]`
> `data` — **Done when** characters and their VAs resolve per show, respecting the AniList rate limit.

### Day 294 · May 21 | Character pages
A real page per character, with every appearance. `[W44]`
> `ui` — **Done when** a character route lists every appearance across shows. **Needs** Day 293.

### Day 295 · May 22 | Voice actor pages
Every role, sortable by year and popularity. `[W44]`
> `ui` — **Done when** a VA route lists roles with both sorts working. **Needs** Day 293.

### Day 296 · May 23 | Follow a person
Alerts when a followed staff member or VA has new work. `[W44]`
> `infra` — **Done when** following persists and new credits notify once. **Needs** Days 123, 295.

### Day 297 · May 24 | Staff pages
Directors, writers and composers with their filmographies.
> `ui` — **Done when** a staff route groups credits by role. **Needs** Day 293.

### Day 298 · May 25 | Studio deep pages
A studio's full history, with their score trend over time.
> `ui` — **Done when** the trend plots by year with sample sizes visible. **Needs** Day 84.

### Day 299 · May 26 | Franchise timeline
A chronological in-universe timeline, where the data allows it.
> `ui` — **Done when** the timeline renders where chronology is known and is omitted where it is not. **Needs** Day 276.

### Day 300 · May 27 | Related-by-staff
"From the director of…" as its own discovery axis.
> `surface` — **Done when** shared key staff surfaces as a discovery reason. **Needs** Days 62, 297.

### Day 301 · May 28 | Seiyuu affinity
Which voice actors keep turning up in shows you rate highly.
> `surface` — **Done when** affinity weights by your scores, not appearance count. **Needs** Days 32, 293.

### Day 302 · May 29 | Composer affinity
The same for music, because it matters more than people admit.
> `surface` — **Done when** composer affinity computes on the same basis. **Needs** Day 301.

### Day 303 · May 30 | Deep catalog search
Search restricted to pre-2010, for the archive divers.
> `surface` — **Done when** the era filter composes with every other search filter. **Needs** Day 69.

### Day 304 · May 31 | Month wrap
How much of your franchises you actually finished.
> `surface` — **Done when** the card reports franchise completion across the library. **Needs** Day 280.

---

## Month 11: June 2027 · Growth & embeds

### Day 305 · Jun 1 | Embed renderer v2
A themeable, resizable widget core. `[W45]`
> `data` — **Done when** the widget renders standalone and is immune to host page CSS.

### Day 306 · Jun 2 | Embed builder UI
A live preview with a copy button. `[W45]`
> `ui` — **Done when** the preview matches the embedded result exactly. **Needs** Day 305.

### Day 307 · Jun 3 | Embed — list widget
Any list or collection, as an embed. `[W45]`
> `surface` — **Done when** any list embeds and stays current without a redeploy. **Needs** Day 306.

### Day 308 · Jun 4 | Embed — calendar widget
Your airing calendar, embedded anywhere.
> `surface` — **Done when** the calendar embeds and renders in the viewer's timezone. **Needs** Day 306.

### Day 309 · Jun 5 | Embed — single show widget
One show's countdown, for a signature or a sidebar.
> `surface` — **Done when** the countdown embeds and ticks live. **Needs** Day 306.

### Day 310 · Jun 6 | Embed themes
Light, dark, transparent and custom-palette embeds. `[W45]`
> `polish` — **Done when** all four render correctly on both light and dark host pages. **Needs** Days 185, 306.

### Day 311 · Jun 7 | Embed sizing
Fixed, responsive and auto-height variants. `[W45]`
> `ui` — **Done when** auto-height reports its height to the host without clipping. **Needs** Day 306.

### Day 312 · Jun 8 | Embed performance budget
A hard size cap so embeds stay light on other people's pages.
> `infra` — **Done when** the embed payload stays under an explicit budget, enforced not merely documented. **Needs** Day 305.

### Day 313 · Jun 9 | OG image generator
Per-page share images, generated at build time. `[W46]`
> `content` — **Done when** every generated page gets its own image. Touches `scripts/build-seo.mjs`.

### Day 314 · Jun 10 | Season share cards
A card per season page, using the season's best art. `[W46]`
> `content` — **Done when** each season page has a distinct image. **Needs** Day 313.

### Day 315 · Jun 11 | Show OG images
The existing per-show images, upgraded with score and dates. `[W46]`
> `content` — **Done when** show images carry score and air dates legibly at thumbnail size. **Needs** Day 313.

### Day 316 · Jun 12 | List OG images
Shared lists get a real preview image.
> `content` — **Done when** a shared list URL previews with a generated image. **Needs** Days 98, 313.

### Day 317 · Jun 13 | Add to Google Calendar ✅ shipped
`subRow()` already renders a Google Calendar link per feed — `calendar.google.com/calendar/u/0/r?cid=<https feed url>` — next to a copy-URL button. `[W47]`
> `surface` — Nothing left.

### Day 318 · Jun 14 | Add to Apple Calendar ✅ shipped
Done properly: the same row builds a `webcal:` URL by scheme-swapping the https feed, so it subscribes rather than downloading a one-off file. `netlify.toml` serves `/feeds/*` as `text/calendar; charset=utf-8` — which is load-bearing, because `nosniff` is on and a wrong Content-Type makes calendar clients reject the feed outright. `[W47]`
> `surface` — Nothing left.

### Day 319 · Jun 15 | Add to Outlook ◐
Outlook is currently served by the same `webcal:` link as Apple. It works, but it isn't the Microsoft path — and the button reading "＋ Apple / Outlook" is the tell. `[W47]`
> `surface` — **Done when** Outlook has its own pre-filled link and one button stops standing in for two products. **Needs** Day 317.

### Day 320 · Jun 16 | Add to Yahoo
Completing the set. `[W47]`
> `surface` — **Done when** all four calendar targets work from one control. **Needs** Day 319.

### Day 321 · Jun 17 | Subscribe-feed builder
Build a filtered .ics feed out of any view.
> `infra` — **Done when** a filtered feed URL generates and validates as .ics. Consider serving from a function rather than a static file — see the deploy-budget note.

### Day 322 · Jun 18 | Feed per collection
Every collection gets its own subscribable calendar URL.
> `surface` — **Done when** each collection yields a feed reflecting its current contents. **Needs** Days 03, 321.

### Day 323 · Jun 19 | Feed refresh transparency
Show when a feed last updated, and how often it will.
> `content` — **Done when** the feed states its own refresh cadence honestly. **Needs** Day 321.

### Day 324 · Jun 20 | RSS feeds
An RSS alternative for people who live in readers.
> `content` — **Done when** the RSS feed validates and carries the same items as the .ics. **Needs** Day 321.

### Day 325 · Jun 21 | Browser extension shell
The extension skeleton and store listing. `[W48]`
> `infra` — **Done when** the extension loads unpacked and requests only the permissions it uses.

### Day 326 · Jun 22 | Extension — new tab
Airing today, on every new tab. `[W48]`
> `ui` — **Done when** the new tab renders today's episodes and works offline from cache. **Needs** Day 325.

### Day 327 · Jun 23 | Extension — badge
An unwatched-episode count on the toolbar icon. `[W48]`
> `surface` — **Done when** the badge reflects the real count and clears when caught up. **Needs** Days 07, 325.

### Day 328 · Jun 24 | Extension — quick add
Right-click any AniList or MAL page to add the show.
> `surface` — **Done when** the context menu resolves the show from the page and adds it. **Needs** Day 325.

### Day 329 · Jun 25 | PWA install prompt
A well-timed, dismissible install invitation.
> `ui` — **Done when** the prompt appears only after genuine engagement and never returns once dismissed.

### Day 330 · Jun 26 | PWA offline mode
The app usable without a connection, from cached data.
> `infra` — **Done when** the app opens offline and states that data may be stale.

### Day 331 · Jun 27 | Widget-ready manifest
Home-screen shortcuts straight to your most-used views.
> `infra` — **Done when** manifest shortcuts deep-link into the right views. **Needs** Day 330.

### Day 332 · Jun 28 | Growth loop
Every share format carries a subtle, non-spammy link back.
> `polish` — **Done when** attribution is present in every share format without dominating it. **Needs** Day 115.

### Day 333 · Jun 29 | Landing page refresh
The SEO pages upgraded with the year's new features.
> `content` — **Done when** the generated pages describe what the app actually does now. Touches `scripts/build-seo.mjs`.

### Day 334 · Jun 30 | Month wrap
Reach: embeds, feeds and installs.
> `surface` — **Done when** the card reports reach without introducing third-party tracking.

---

## Month 12: July 2027 · Power tools & portability

### Day 335 · Jul 1 | Omnibox
One input for search, quick-add and commands. `[W49]`
> `ui` — **Done when** one input routes to search, add or command by what you type. **Needs** Day 65.

### Day 336 · Jul 2 | Quick-add from anywhere
Add a show without leaving your current view. `[W49]`
> `surface` — **Done when** adding never navigates away and confirms inline. **Needs** Day 335.

### Day 337 · Jul 3 | Paste to import
Paste a list of titles and match them in bulk.
> `ui` — **Done when** pasted titles resolve to matches with ambiguous ones surfaced for confirmation. **Needs** Day 73.

### Day 338 · Jul 4 | Bulk edit mode
Multi-select with a full action bar.
> `ui` — **Done when** every single-show action has a bulk equivalent. **Needs** Day 05.

### Day 339 · Jul 5 | Batch rating
Rate a run of shows in a single pass.
> `surface` — **Done when** a queue rates in sequence and can be abandoned partway without loss. **Needs** Day 338.

### Day 340 · Jul 6 | Keyboard macros
Chain several actions into one shortcut.
> `ui` — **Done when** a macro records, replays and can be deleted. **Needs** Day 230.

### Day 341 · Jul 7 | Saved views
The entire app state — filters, sort, density — as a named view.
> `data` — **Done when** a view captures and restores every display setting. **Needs** Days 29, 70.

### Day 342 · Jul 8 | View switcher
Jump between saved views from the command palette.
> `surface` — **Done when** views are reachable from the palette. **Needs** Days 65, 341.

### Day 343 · Jul 9 | Export — list as CSV
Every show with status, score and dates. `[W50]`
> `surface` — **Done when** the CSV opens correctly in a spreadsheet with commas and quotes escaped.

### Day 344 · Jul 10 | Export — full JSON ✅ shipped
`exportSettings()` writes `tsuzuki-settings.json` — `{type:"anical-settings", version:1, exported, data}` — carrying every `anical.*` key except the four derived caches in `NO_BACKUP` (`cache.v1`, `seenIds`, `lastVisit`, `overrides`). `pickImport()` reads it back and `applySettings()` restores it, so the round trip works today. `[W50]`
> `surface` — **What's left**: import is a blind overwrite ending in `location.reload()` — no diff, no conflict handling. That's Days 346 and 350, and they inherit this format rather than inventing a second one.

### Day 345 · Jul 11 | Export — stats bundle
The computed numbers as their own file. `[W50]`
> `surface` — **Done when** the bundle carries every stats-layer figure. **Needs** Days 181, 343.

### Day 346 · Jul 12 | Import — from CSV
Bring a list back in, with a dry-run diff first.
> `ui` — **Done when** the dry run shows adds, updates and conflicts before anything is written. **Needs** Day 343.

### Day 347 · Jul 13 | Import — from MAL XML
The standard MyAnimeList export format.
> `data` — **Done when** a real MAL export imports with statuses and scores mapped correctly. **Needs** Day 346.

### Day 348 · Jul 14 | Import — from AniList
A direct pull, improved over the current import.
> `data` — **Done when** the pull is paginated within the rate limit and reports progress. **Needs** Day 346.

### Day 349 · Jul 15 | Import — from Kitsu & Simkl
The remaining common sources.
> `data` — **Done when** both formats import through the same pipeline. **Needs** Day 348.

### Day 350 · Jul 16 | Import conflict resolution
A clear diff whenever an import disagrees with your data.
> `ui` — **Done when** each conflict can be resolved individually or in bulk. **Needs** Day 346.

### Day 351 · Jul 17 | Backup reminder
A gentle nudge when your last export has gone stale. `[W50]`
> `ui` — **Done when** the reminder tracks the real last-export date and is dismissible for good. **Needs** Day 344.

### Day 352 · Jul 18 | Auto-backup to file
A periodic download you can turn on and forget about.
> `surface` — **Done when** the download fires on schedule without stealing focus. **Needs** Day 344.

### Day 353 · Jul 19 | Report wrong data ◐
Exactly one field already has this: **⚠ Report a wrong time** posts to `netlify/functions/report.mjs`, length-capped and keyed by show + episode + a hash of the reporter's IP. Every other displayed field has nothing. `[W51]`
> `ui` — **Done when** any displayed field can be reported with its current and proposed value, through the existing endpoint rather than a second one.

### Day 354 · Jul 20 | Correction queue ◐
The queue exists — `GET /api/report?secret=…`, listed and cleared in `/admin`, where one click turns a report into a live correction with the JSON patch previewed first. What doesn't exist is the reporter's view of it: from outside, it is still a suggestion box with no back wall. `[W51]`
> `infra` — **Done when** submitted reports are listed back to the person who filed them. **Needs** Day 353.

### Day 355 · Jul 21 | Correction status ◐
The status is already tracked: applying a correction marks the report `applied` in the same action that writes the live store. It is simply never shown to whoever filed it. `[W51]`
> `surface` — **Done when** each report carries a status its reporter can see — including "read and rejected", which the store currently has no way to express at all. **Needs** Day 354.

### Day 356 · Jul 22 | Local overrides
Fix a wrong air time for yourself immediately, while upstream catches up.
> `data` — **Done when** a local override wins over upstream and is clearly marked as yours. **Mind the key**: `anical.overrides` is already taken — it is the read-through cache of the *remote* correction document, and it sits in `NO_BACKUP` precisely because it's derived. Your own overrides need their own key, and that one belongs *in* the backup. **Needs** Day 353.

### Day 357 · Jul 23 | Data provenance ◐
Server-side this exists: every rule the Crunchyroll ingest writes carries `source` and `verifiedAt`, and cadence-derived figures say so in the source string. None of it survives the trip to the client.
> `surface` — **Done when** every displayed field can name its source, using the provenance already stored rather than inventing a parallel one. **Needs** Day 356.

### Day 358 · Jul 24 | Sync code v2 ◐
v1 ships and the "v2" in this title was more accurate than it knew: `copySyncCode()` base64-encodes `collectSettings()` to the clipboard, `pasteSyncCode()` reads it back through a `window.prompt()`. It works, and it is exactly as crude as that sounds — the code never expires, has no size bound, and travels through a browser prompt. `[W52]`
> `infra` — **Done when** pairing completes in under a minute and the code expires. Note that a code which expires needs somewhere to expire *on*: this is the second day (with Day 138) that wants server-held state. Decide those two together rather than twice.

### Day 359 · Jul 25 | Sync conflict prompts
A readable diff when two devices disagree. `[W52]`
> `ui` — **Done when** conflicts show both sides and resolve per field. **Needs** Day 358.

### Day 360 · Jul 26 | Sync history
What synced when, with the ability to roll back.
> `surface` — **Done when** history lists syncs and a rollback restores the prior state. **Needs** Day 359.

### Day 361 · Jul 27 | Selective sync
Choose which parts of your data travel between devices.
> `ui` — **Done when** excluded sections genuinely never leave the device. **Needs** Day 358.

### Day 362 · Jul 28 | Storage inspector
What the app is storing, with per-section clearing.
> `ui` — **Done when** every `anical.*` key is listed with its size and can be cleared individually.

### Day 363 · Jul 29 | Reset with a parachute
A full reset that exports a backup first.
> `ui` — **Done when** reset cannot complete without the backup being written first. **Needs** Day 344.

### Day 364 · Jul 30 | Settings search
Find any setting by name.
> `surface` — **Done when** search finds every setting and jumps to it.

### Day 365 · Jul 31 | Year one wrap
The whole year's shipping, as one shareable page.
> `content` — **Done when** the page lists everything actually shipped, generated rather than hand-written.

---

## How to Use This Backlog

Pick one a day and build it. Reorder freely — the only rule is a **visible improvement every drop**, so momentum never depends on the long backend milestones landing first.

**On slipping.** Days are a cadence, not a contract. A feature that turns out to be two days is two days; the calendar dates are a map, not a debt. Pull the next item forward when you're ahead — weeks 2 and 3 of the old backlog both shipped on Aug 1, which is exactly how this is meant to work.

**On the spines.** Where a feature is decomposed across several days (`data → UI → surfacing → polish`), the data day usually ships nothing visible on its own. That is an argument for batching: land the data day and the UI day in the same push, so every deploy is a visible change.

**On deploys.** Build daily, deploy every 2–3 days, ~12 feature drops a month. See *Daily Build, Batched Deploy* above — the 20-deploy ceiling is the real constraint on this backlog, and pushing more often buys nothing users can see while costing you the budget for hotfixes.

**On the days that got overtaken.** Thirty-five entries now carry a marker because the code arrived before the plan did. Two things are worth taking from that. First, **read the codebase before estimating a day** — a third of the ones checked turned out to be half-built, and one (Day 344) was simply finished. Second, an overtaken day is rarely free: what shipped was usually the engine, and what's left is the part where a user can reach it. Day 185 is the clearest case — the palette engine exists and is good, and 73 hardcoded hex literals mean it still doesn't repaint the whole page.

**Keeping this honest.** When a feature lands early, mark its day the same session, with the commit. The cost of not doing that is not embarrassment — it's the day you spend re-building something, or the acceptance line you write against an app that no longer works that way.

---

*Tsuzuki · 365 daily features · Aug 2026 → Jul 2027 · revised Aug 2026*
