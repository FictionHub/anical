# Tsuzuki · Daily Feature Backlog

**Tactical backlog · Year 1 · Aug 2026 → Jul 2027**

Three hundred sixty-five days, three hundred sixty-five features.

A shippable feature every single day — the hands-on companion to the strategic 10-year roadmap. None of these are already in Tsuzuki, and none are the big backend milestones; they're the consumer-facing wins you build day to day while the platform work runs underneath.

## Daily Build, Batched Deploy

Read this before planning against the dates below, because the deploy budget does not allow one deploy per day.

**The constraint.** Netlify's free tier gives 300 credits/month and every deploy costs ~15 — a static site with no build command costs the same as any other. That is a hard ceiling of **~20 deploys/month**, shared between content refreshes, feature ships and hotfixes. Deploys bill per **push**, not per commit.

**What that means for this backlog.** Build a feature a day; push in batches of two or three. Users see a drop every ~2–3 days containing several features, which reads as a bigger release than a daily trickle would. The daily cadence governs your development rhythm, not the deploy button.

**A rough monthly allocation:**

| Purpose | Deploys/month | Credits |
|---|---|---|
| Feature drops (2–3 backlog items each) | 12 | 180 |
| SEO / content refresh (weekly) | 4 | 60 |
| Hotfix reserve | 4 | 60 |
| **Total** | **20** | **300** |

**What is already fresh without a deploy.** The app reads AniList live from the client, so schedule data, scores and airing times are never stale for real users no matter when you last deployed. Deploy frequency only governs three things: new app code, the static SEO pages Google crawls, and the `.ics` feeds. Of those, only the feeds are both user-facing and time-sensitive — moving them to a Netlify Function would decouple them from deploys entirely, since function invocations bill against a separate 125k/month quota you have barely touched.

Shipping weekly was never a development limit. It is a deploy-budget limit, and the way past it is batching, not frequency.

## Backlog Stats
- **365** daily features
- **12** monthly themes
- **1** ship every day

## How This Sits with the Roadmap

The **10-year roadmap** is the strategic spine (a hard system per year — data platform, sync, ML, native…). This backlog is the **daily delight layer** that keeps users happy and the app growing while that deeper work lands. A few themes rhyme with roadmap years (recs, streaming, stats) — here they're the light, client-side versions you can ship now; the roadmap later rebuilds them as the heavy, backend-powered versions.

## How This Maps to the Old Weekly Backlog

All 52 weekly features survive — none were cut. The big ones (the rating engine, recommendations, show pages, franchise hubs) were never one-day features, so each is decomposed into its real shipping spine: data layer → minimal UI → surfacing → polish. The small ones (Discord block, command palette) stay as single days. The remaining slots are new features sized to a day. Entries carrying a former weekly item are tagged `[W##]`.

---

## Month 01: August 2026 · Personal library, deeper

### Day 01 · Aug 1 | Watch statuses ✅ shipped
Watching / Plan / On-hold / Dropped / Completed, with a status-board view and per-status counts. `[W01]`

### Day 02 · Aug 1 | Ratings & private notes ✅ shipped
A 1–10 personal score and free-text notes per show, surfaced on cards and in the modal. `[W02]` — `de9501d1`

### Day 03 · Aug 1 | Custom collections ✅ shipped
Make your own lists, rename them, and drag shows between them. `[W03]` — `0108f174`

### Day 04 · Aug 4 | Collection covers
Auto-pick a mosaic of the first four shows as each list's cover art.

### Day 05 · Aug 5 | Bulk select
Shift-click a range of cards, then set status or collection for all of them at once.

### Day 06 · Aug 6 | Undo toast
Every destructive list action gets a six-second "Undo" instead of a confirm dialog.

### Day 07 · Aug 7 | Episode progress
A per-show "watched up to ep N" counter with +1 and "caught up" buttons.

### Day 08 · Aug 8 | Auto-progress from airing
Mark episodes watched as they air, opt-in per show.

### Day 09 · Aug 9 | Progress bars on cards
A thin fill under each cover showing watched versus total.

### Day 10 · Aug 10 | "Next up" rail
The single next unwatched episode across everything you're watching.

### Day 11 · Aug 11 | Rewatch counter
A rewatch tally per show that survives resetting progress.

### Day 12 · Aug 12 | Started & finished dates
Auto-stamped when a show enters Watching or Completed, editable after.

### Day 13 · Aug 13 | Rating axes (data)
Split the single score into story, art, sound, characters and enjoyment behind the scenes. Old 1–10 scores migrate as the composite, so nobody loses their history. `[W04]`

### Day 14 · Aug 14 | Rating axes (UI)
Five sliders with half-points in the modal, composite recalculating live. `[W04]`

### Day 15 · Aug 15 | Composite weights
Drag how much each axis counts toward your score, stored per user. `[W04]`

### Day 16 · Aug 16 | Your rating distribution
Your own score histogram, so you can see if you're a 7-out-of-10 person.

### Day 17 · Aug 17 | Score normalization
An optional "spread my scores" toggle that stretches a clustered list across the range.

### Day 18 · Aug 18 | Head-to-head core (data)
Store pairwise comparisons and derive an ordering from them. `[W05]`

### Day 19 · Aug 19 | Head-to-head UI
A two-card "which did you like more?" screen with a skip button. `[W05]`

### Day 20 · Aug 20 | Calibration run
A guided ten-pair session that seeds the ordering from scratch. `[W05]`

### Day 21 · Aug 21 | Comparison-derived scores
Turn the pairwise ordering into suggested 1–10 scores you can accept or ignore. `[W05]`

### Day 22 · Aug 22 | Note templates
Quick-insert prompts — favourite episode, best moment, who to recommend it to.

### Day 23 · Aug 23 | Note search
Full-text search across your private notes.

### Day 24 · Aug 24 | Spoiler-tagged notes
Blur note text until tapped, per note.

### Day 25 · Aug 25 | Favourites
A one-tap heart, separate from score, with a favourites-first sort.

### Day 26 · Aug 26 | Pinned shows
Pin up to five shows to the top of every view.

### Day 27 · Aug 27 | Archive
Hide finished shows from the main views without deleting them.

### Day 28 · Aug 28 | List density
Compact, comfortable and grid toggles for every list view.

### Day 29 · Aug 29 | Sort builder
Multi-key sorting — status, then score, then title — that you can save.

### Day 30 · Aug 30 | Filter chips
Active filters shown as removable chips above every list.

### Day 31 · Aug 31 | Month wrap
An end-of-month summary card of what you added, rated and finished.

---

## Month 02: September 2026 · The rating engine & recommendations

*The positioning shift: not a release schedule with a list attached, but the anime info site that knows your taste.*

### Day 32 · Sep 1 | Taste vectors (data)
Build genre, tag, studio, era and length vectors from your ratings, cached locally. `[W06]`

### Day 33 · Sep 2 | Genre affinity
Your over- and under-rated genres versus the crowd average, as a bar chart. `[W06]`

### Day 34 · Sep 3 | Studio affinity
The same treatment for studios, with your best and worst called out. `[W06]`

### Day 35 · Sep 4 | Tag affinity
AniList tags ranked by how much they actually move your score. `[W06]`

### Day 36 · Sep 5 | Era & length axes
Decade and episode-count preferences pulled out as their own dimensions. `[W06]`

### Day 37 · Sep 6 | Taste profile page
Every axis on one readable page, with a shareable one-line summary. `[W06]`

### Day 38 · Sep 7 | Taste archetype
A named label for your profile — "character-first slow burn" — with the reasoning behind it.

### Day 39 · Sep 8 | Predictor v1
A nearest-neighbour score estimate built from your rated shows. `[W07]`

### Day 40 · Sep 9 | Confidence scoring
How much the predictor trusts itself, derived from sample size and axis coverage. `[W07]`

### Day 41 · Sep 10 | Predicted badge
The estimate on every unrated card, greyed out when confidence is low. `[W07]`

### Day 42 · Sep 11 | Low-confidence honesty
"Not enough signal yet" instead of a number, with exactly what to rate to fix it. `[W07]`

### Day 43 · Sep 12 | Predictor v2
Fold the head-to-head pairs in as a ranking signal, not just the 1–10 scores. `[W07]`

### Day 44 · Sep 13 | Predictor backtest
Hold out your own ratings and show the predictor's error rate, openly.

### Day 45 · Sep 14 | Recommendations engine
Rank the unrated catalogue by predicted score, minus everything you've already seen. `[W08]`

### Day 46 · Sep 15 | Recommendations page
The ranked picks on a dedicated page, not a rail. `[W08]`

### Day 47 · Sep 16 | Rec filters
Length, season, genre, status and streaming-service filters on the recs page. `[W08]`

### Day 48 · Sep 17 | Safe bet mode
High-confidence, high-predicted picks only. `[W08]`

### Day 49 · Sep 18 | Surprise me mode
Deliberately outside your usual axes, with the risk stated up front. `[W08]`

### Day 50 · Sep 19 | Short commitment mode
Recommendations capped by total runtime, for when you have six hours and no more.

### Day 51 · Sep 20 | Reasoning capture
Record which rated shows and which axes drove each prediction. `[W09]`

### Day 52 · Sep 21 | Why this pick
Open any prediction into its reasoning — the shows it leaned on, the axes that moved it. `[W09]`

### Day 53 · Sep 22 | Retrain in place
Thumbs and axis sliders on the reasoning panel that update the profile on the spot. `[W09]`

### Day 54 · Sep 23 | Rec feedback loop
"Not interested" and "already seen" that permanently reshape future picks.

### Day 55 · Sep 24 | Show page shell
A real per-show route with staff, studio, source and adaptation range. `[W10]`

### Day 56 · Sep 25 | Show page — related entries
Prequels, sequels, side stories and adaptations, all linked. `[W10]`

### Day 57 · Sep 26 | Show page — airing history
The full episode list with air dates and your progress against it. `[W10]`

### Day 58 · Sep 27 | Show page — score panel
The crowd's rating distribution next to your predicted or actual score. `[W10]`

### Day 59 · Sep 28 | Show page — streaming & links
Where to watch, official site and trailer, in one block. `[W10]`

### Day 60 · Sep 29 | Show page — themes & tags
The tag cloud, colour-coded by your own affinity for each tag. `[W10]`

### Day 61 · Sep 30 | Profile diff
How your taste shifted this month versus last.

---

## Month 03: October 2026 · Discovery & search

### Day 62 · Oct 1 | Because-you-follow engine
Group recommendations by the followed show that triggered them. `[W11]`

### Day 63 · Oct 2 | Reason rails
Reason-tagged rows on the home page — "because you rated Frieren a 9". `[W11]`

### Day 64 · Oct 3 | Rail ordering
Rails sorted by how strong each reason is, with the weak ones hidden entirely.

### Day 65 · Oct 4 | Command palette shell
⌘/Ctrl-K opens a fuzzy launcher over everything. `[W12]`

### Day 66 · Oct 5 | Palette — show jump
Type a title, land on its page or modal. `[W12]`

### Day 67 · Oct 6 | Palette — actions
Set status, add to collection, rate — all without leaving the keyboard. `[W12]`

### Day 68 · Oct 7 | Palette — recent & frequent
Your last actions and most-visited shows ranked to the top.

### Day 69 · Oct 8 | Search operators
`genre:`, `studio:`, `year:` and `score:>8` in the main search box.

### Day 70 · Oct 9 | Saved searches
Save a complex filter combo as a named one-tap search. `[W13]`

### Day 71 · Oct 10 | Search presets on the home page
Pin saved searches as chips you can reach in one tap. `[W13]`

### Day 72 · Oct 11 | Search history
Your recent queries, one tap to rerun.

### Day 73 · Oct 12 | Fuzzy title matching
Typo-tolerant search across romaji, english and native titles.

### Day 74 · Oct 13 | Search-as-you-type ranking
Popularity, your affinity and exact-prefix weighting blended into one ranking.

### Day 75 · Oct 14 | Similar shows engine
A content-similarity score from tags, genres, staff and studio. `[W14]`

### Day 76 · Oct 15 | Similar in the modal
The closest five shows, each with a line on why it's close. `[W14]`

### Day 77 · Oct 16 | Airing-now filter on similar
Related shows currently broadcasting, right in the show modal. `[W14]`

### Day 78 · Oct 17 | Hidden gems query
High score, low popularity, inside the genres you already follow. `[W15]`

### Day 79 · Oct 18 | Hidden gems page
The full list, with a "how obscure" dial you control. `[W15]`

### Day 80 · Oct 19 | Underseen by year
The best-rated thing you've never heard of, one per year.

### Day 81 · Oct 20 | Random show
A dice button that respects whatever filters are currently active.

### Day 82 · Oct 21 | Discovery streak
A daily "one new show" card you can accept or skip.

### Day 83 · Oct 22 | Browse by tag
A real tag index page, not just a search shortcut.

### Day 84 · Oct 23 | Browse by studio
Studio pages listing everything they've made, ranked.

### Day 85 · Oct 24 | Browse by staff
Director and writer pages, given the same treatment.

### Day 86 · Oct 25 | Browse by year
A year index with the season breakdown underneath.

### Day 87 · Oct 26 | Trending now
What's climbing on AniList this week, filtered through your taste profile.

### Day 88 · Oct 27 | Seasonal preview
Next season's full lineup with predicted scores already attached.

### Day 89 · Oct 28 | Compare two shows
A side-by-side of any two titles' stats and your rating axes.

### Day 90 · Oct 29 | Watchlist triage
A swipe-style queue to clear your Plan-to-Watch pile fast.

### Day 91 · Oct 30 | Discovery settings
How adventurous the recommendations are, as a single slider.

### Day 92 · Oct 31 | Month wrap
What you discovered and added this month.

---

## Month 04: November 2026 · Sharing — no account needed

### Day 93 · Nov 1 | Canvas renderer
A client-side image renderer that every share card builds on. `[W16]`

### Day 94 · Nov 2 | List poster
Your My List rendered as a poster image you can save and post anywhere. `[W16]`

### Day 95 · Nov 3 | Poster layouts
Grid, ranked and minimal variants of the same poster. `[W16]`

### Day 96 · Nov 4 | Poster theming
The poster picks up your own app palette.

### Day 97 · Nov 5 | URL state encoder
Compress an entire list into a URL fragment — zero backend. `[W17]`

### Day 98 · Nov 6 | Public list links
Open someone else's shared URL as a read-only list. `[W17]`

### Day 99 · Nov 7 | Shared-list import
"Copy this into my library" straight from a shared link.

### Day 100 · Nov 8 | QR for any share
A QR code for any share URL, rendered locally, no shortener involved.

### Day 101 · Nov 9 | Tier list board
Drag shows into S/A/B/C/D tiers. `[W18]`

### Day 102 · Nov 10 | Tier list — custom tiers
Rename, recolour and add your own rows. `[W18]`

### Day 103 · Nov 11 | Tier list share
Export the board as both a URL and an image. `[W18]`

### Day 104 · Nov 12 | Tier list from ratings
Auto-seed the tiers from the scores you've already given.

### Day 105 · Nov 13 | Discord markdown block
Your currently-watching as clean, paste-ready Discord markdown. `[W19]`

### Day 106 · Nov 14 | Discord embed preview
See how the paste will actually render before you copy it. `[W19]`

### Day 107 · Nov 15 | Reddit & forum formats
The same block as Reddit markdown and BBCode.

### Day 108 · Nov 16 | Plain-text list
A clipboard-friendly numbered list for everywhere else.

### Day 109 · Nov 17 | Seasonal bingo generator
A shareable seasonal challenge card for your community. `[W20]`

### Day 110 · Nov 18 | Bingo — custom squares
Write your own challenges into the card. `[W20]`

### Day 111 · Nov 19 | Bingo — progress tracking
Squares tick themselves from your watch data. `[W20]`

### Day 112 · Nov 20 | Share card for one show
A single-show card carrying your score and note.

### Day 113 · Nov 21 | Share card for stats
Your top genres and hours watched, as an image.

### Day 114 · Nov 22 | Open Graph for shared links
Shared URLs preview properly on Discord, X and everywhere else.

### Day 115 · Nov 23 | Share sheet
One panel listing every share format available for the current view.

### Day 116 · Nov 24 | Copy-link everywhere
A copy button on every show, list and filtered view.

### Day 117 · Nov 25 | Embed a list
An iframe snippet for any public list.

### Day 118 · Nov 26 | Compare with a friend
Diff two shared lists: the overlap, their picks, yours.

### Day 119 · Nov 27 | Taste match score
A percentage match between two shared profiles.

### Day 120 · Nov 28 | Recommend to a friend
Pick shows their list is missing that your profile predicts they'd like.

### Day 121 · Nov 29 | Share privacy
Choose exactly which fields — notes, scores, statuses — a share URL carries.

### Day 122 · Nov 30 | Month wrap
What you shared, and who imported it.

---

## Month 05: December 2026 · Notifications & reminders

### Day 123 · Dec 1 | Reminder lead times
One-day, one-hour and at-air alerts, each chosen independently. `[W21]`

### Day 124 · Dec 2 | Per-show lead override
A different lead time for the shows you actually care about. `[W21]`

### Day 125 · Dec 3 | Reminder preview
See the exact notification text before you commit to it.

### Day 126 · Dec 4 | Premiere alerts
A distinct alert type for first episodes. `[W22]`

### Day 127 · Dec 5 | Finale alerts
The same for last episodes, worded to match the moment. `[W22]`

### Day 128 · Dec 6 | Season-start digest
One notification when a new season's shows begin.

### Day 129 · Dec 7 | Week-ahead digest
A single weekly summary of your upcoming episodes. `[W23]`

### Day 130 · Dec 8 | Digest scheduling
Pick the day and hour the digest arrives. `[W23]`

### Day 131 · Dec 9 | Digest content controls
Choose which sections the digest includes.

### Day 132 · Dec 10 | Quiet hours
A nightly window where nothing fires. `[W24]`

### Day 133 · Dec 11 | Per-show mute
Silence one show without unfollowing it. `[W24]`

### Day 134 · Dec 12 | Test notification
A one-tap "does this actually work" button. `[W24]`

### Day 135 · Dec 13 | Notification history
The last thirty alerts, in-app, showing what fired and when.

### Day 136 · Dec 14 | Delivery diagnostics
Why a notification didn't arrive, explained in plain language.

### Day 137 · Dec 15 | Permission re-prompt flow
A graceful path back after a denied notification permission.

### Day 138 · Dec 16 | Multi-device push
The same subscription across devices, without duplicate alerts.

### Day 139 · Dec 17 | Delayed-episode handling
Reschedule the alert automatically when AniList moves an air time.

### Day 140 · Dec 18 | Break & hiatus alerts
Tell me when a show I follow goes on break.

### Day 141 · Dec 19 | Batch alerts
Group same-hour episodes into one notification instead of five.

### Day 142 · Dec 20 | Rich notifications
Cover art and episode number in the notification body.

### Day 143 · Dec 21 | Notification actions
"Mark watched" and "snooze" straight from the notification.

### Day 144 · Dec 22 | Snooze
Push any reminder forward by an hour or a day.

### Day 145 · Dec 23 | Calendar-style reminders
An .ics alarm option for people who live inside their calendar.

### Day 146 · Dec 24 | Streaming-release lead
Alert on the streaming drop, not the Japanese broadcast.

### Day 147 · Dec 25 | Region-aware timing
Reminders in your timezone, with the source time shown alongside.

### Day 148 · Dec 26 | Do-not-disturb sync
Respect the OS focus mode wherever the browser exposes it.

### Day 149 · Dec 27 | Reminder rules
"Only premieres", "only shows I'm behind on" — saved as reusable rules.

### Day 150 · Dec 28 | Backlog nudge
An opt-in weekly poke about shows you've stalled on.

### Day 151 · Dec 29 | Alert volume cap
A hard ceiling on notifications per day.

### Day 152 · Dec 30 | Notification settings page
Every control above, in one screen, with a reset button.

### Day 153 · Dec 31 | Month wrap
What fired, and what you actually watched because of it.

---

## Month 06: January 2027 · Stats & insights

### Day 154 · Jan 1 | Stats data layer
A single computed stats object that every panel reads from. `[W25]`

### Day 155 · Jan 2 | Hours watched
Total, this season and all-time, with the arithmetic shown. `[W25]`

### Day 156 · Jan 3 | Top genres panel
Your most-watched genres by hours, not by title count. `[W25]`

### Day 157 · Jan 4 | Top studios panel
The same treatment for studios. `[W25]`

### Day 158 · Jan 5 | Day-of-week pattern
When you actually watch, as a heatmap. `[W25]`

### Day 159 · Jan 6 | Time-of-day pattern
The same thing at hourly resolution.

### Day 160 · Jan 7 | Completion rate
How often you finish what you start, broken down by genre.

### Day 161 · Jan 8 | Drop analysis
Where in a run you tend to drop, as an episode-number histogram.

### Day 162 · Jan 9 | Watch streaks
Consecutive days with something watched. `[W26]`

### Day 163 · Jan 10 | Streak calendar
A year-view contribution grid of your watching. `[W26]`

### Day 164 · Jan 11 | Backlog burndown
Your Plan-to-Watch pile over time, trending. `[W26]`

### Day 165 · Jan 12 | Backlog estimator
Total hours to clear everything you're behind on. `[W28]`

### Day 166 · Jan 13 | Catch-up planner
How many episodes a day to be current by a date you pick. `[W28]`

### Day 167 · Jan 14 | Season Wrapped generator
The end-of-season recap engine. `[W27]`

### Day 168 · Jan 15 | Wrapped — top five
Your highest-rated shows of the season, as a card. `[W27]`

### Day 169 · Jan 16 | Wrapped — superlatives
Biggest surprise, biggest disappointment, most binged. `[W27]`

### Day 170 · Jan 17 | Wrapped — share image
The whole recap as one poster. `[W27]`

### Day 171 · Jan 18 | Year in review
The same treatment stretched across a full year.

### Day 172 · Jan 19 | Rating drift
How your average score has moved over time.

### Day 173 · Jan 20 | Genre drift
Which genres grew and shrank in your watching, year over year.

### Day 174 · Jan 21 | Studio loyalty
Which studios you keep coming back to.

### Day 175 · Jan 22 | Score versus crowd
Where you sit against the average, per show.

### Day 176 · Jan 23 | Contrarian picks
The shows you rate furthest from everyone else.

### Day 177 · Jan 24 | Longest binge
Your biggest single-day episode count.

### Day 178 · Jan 25 | Watch anniversaries
"A year ago today you started X."

### Day 179 · Jan 26 | Milestone badges
100 episodes, 50 shows, 1000 hours — earned quietly, no fanfare.

### Day 180 · Jan 27 | Pace versus airing
Are you keeping up with currently-airing shows, per show.

### Day 181 · Jan 28 | Stats export
Every panel's underlying numbers, as JSON.

### Day 182 · Jan 29 | Stats page layout
Reorder and hide panels to build your own dashboard.

### Day 183 · Jan 30 | Stats privacy
A local-only toggle so nothing computed ever leaves the device.

### Day 184 · Jan 31 | Month wrap
January in numbers.

---

## Month 07: February 2027 · Theming & delight

### Day 185 · Feb 1 | Palette engine
Themes as data, not hardcoded CSS. `[W29]`

### Day 186 · Feb 2 | Theme gallery
Save, name and switch between multiple palettes. `[W29]`

### Day 187 · Feb 3 | Theme import & export
Palettes as a shareable string. `[W29]`

### Day 188 · Feb 4 | Community palettes
A bundled set of good starting themes.

### Day 189 · Feb 5 | Live palette editor
Edit colours with the app updating underneath you.

### Day 190 · Feb 6 | Contrast guard
Warn when a palette breaks readable contrast.

### Day 191 · Feb 7 | Cover-art theming
The accent adapts to the artwork of the show you're viewing. `[W31]`

### Day 192 · Feb 8 | Per-show accent memory
Remember the extracted accent so it doesn't flicker on every open. `[W31]`

### Day 193 · Feb 9 | Ambient seasons
Opt-in seasonal UI touches tied to the current anime season. `[W30]`

### Day 194 · Feb 10 | Sakura mode
Spring petals, reduced-motion safe. `[W30]`

### Day 195 · Feb 11 | Snow mode
The winter equivalent. `[W30]`

### Day 196 · Feb 12 | Summer & autumn ambience
The other two, completing the set. `[W30]`

### Day 197 · Feb 13 | Ambience intensity
A dial from "barely there" to "full".

### Day 198 · Feb 14 | Finale confetti
A small celebration when you finish a show. `[W32]`

### Day 199 · Feb 15 | Watched checkoff animation
A satisfying tick when you mark an episode. `[W32]`

### Day 200 · Feb 16 | Rating flourish
A tiny animation tuned to how high you scored something.

### Day 201 · Feb 17 | Reduced-motion audit
Every animation above respects `prefers-reduced-motion`. `[W32]`

### Day 202 · Feb 18 | Loading skeletons
Real skeletons instead of spinners, everywhere.

### Day 203 · Feb 19 | Empty states
Illustrated, useful empty states that suggest a next action.

### Day 204 · Feb 20 | Error states
Friendly errors that say what to do, not just what broke.

### Day 205 · Feb 21 | Page transitions
A subtle shared-element transition into show pages.

### Day 206 · Feb 22 | Hover previews
A quick synopsis card on hover — keyboard-reachable too.

### Day 207 · Feb 23 | Sound design (opt-in)
Three tiny sounds, off by default.

### Day 208 · Feb 24 | Icon set pass
A consistent icon family across the whole app.

### Day 209 · Feb 25 | Typography pass
A proper type scale with tighter headings.

### Day 210 · Feb 26 | Density & radius controls
Sharp or soft, tight or airy, as user settings.

### Day 211 · Feb 27 | App icon variants
Pick the PWA icon that matches your theme.

### Day 212 · Feb 28 | Month wrap
February's look, before and after.

---

## Month 08: March 2027 · Accessibility & inclusivity

### Day 213 · Mar 1 | Accessibility audit baseline
An automated axe pass wired into the workflow, with the score recorded.

### Day 214 · Mar 2 | Font-size slider
Scale the whole UI, not just body text. `[W33]`

### Day 215 · Mar 3 | Line-height & spacing controls
The readability half of the same panel. `[W33]`

### Day 216 · Mar 4 | Dyslexia-friendly font
An opt-in typeface applied across the app. `[W33]`

### Day 217 · Mar 5 | High-contrast theme
A dedicated, tested high-contrast palette. `[W34]`

### Day 218 · Mar 6 | Forced-colors support
Respect Windows high-contrast mode properly.

### Day 219 · Mar 7 | Reduced-motion audit v2
The full pass across every remaining animation. `[W34]`

### Day 220 · Mar 8 | Focus-visible pass
A clear, consistent focus ring everywhere.

### Day 221 · Mar 9 | Focus order pass
Tab order that matches visual order on every view. `[W35]`

### Day 222 · Mar 10 | Focus trapping
Modals that hold focus and return it correctly on close.

### Day 223 · Mar 11 | Skip links
Skip to content, skip to filters, skip to results.

### Day 224 · Mar 12 | Landmark regions
Proper header, nav, main and aside structure for screen readers.

### Day 225 · Mar 13 | Heading hierarchy
A real h1–h6 outline on every page.

### Day 226 · Mar 14 | Alt text pass
Meaningful alt text on covers, banners and icons.

### Day 227 · Mar 15 | Live regions
Screen-reader announcements for countdowns and status updates. `[W36]`

### Day 228 · Mar 16 | Announce filter results
"42 shows match" spoken whenever filters change. `[W36]`

### Day 229 · Mar 17 | Keyboard shortcut sheet
A complete, searchable shortcut reference. `[W35]`

### Day 230 · Mar 18 | Rebindable shortcuts
Change any shortcut, stored locally.

### Day 231 · Mar 19 | Keyboard-only list management
Reorder collections without touching a mouse.

### Day 232 · Mar 20 | Screen-reader table mode
The calendar as a navigable table alternative.

### Day 233 · Mar 21 | Calendar keyboard navigation
Arrow keys through days and episodes.

### Day 234 · Mar 22 | Touch target audit
Every control at least 44px on touch.

### Day 235 · Mar 23 | Colour-blind safe palettes
Deuteranopia, protanopia and tritanopia variants.

### Day 236 · Mar 24 | Never colour alone
Icons and text alongside every colour-coded status.

### Day 237 · Mar 25 | Text spacing resilience
Survive the WCAG text-spacing override without breaking layout.

### Day 238 · Mar 26 | Zoom to 400%
A reflow pass so nothing is lost at extreme zoom.

### Day 239 · Mar 27 | Language & locale
Proper `lang` attributes and locale-aware date formatting.

### Day 240 · Mar 28 | Native title display
Native titles rendered with correct scripts and fonts.

### Day 241 · Mar 29 | Content warnings
Opt-in flags for common triggers, derived from tags.

### Day 242 · Mar 30 | Accessibility statement
An honest page on what's supported and what isn't.

### Day 243 · Mar 31 | Month wrap
The audit score, before and after.

---

## Month 09: April 2027 · Where to watch

### Day 244 · Apr 1 | Streaming data layer
Normalize availability out of AniList's external links. `[W37]`

### Day 245 · Apr 2 | Service picker
Choose your subscriptions, stored locally. `[W37]`

### Day 246 · Apr 3 | Only-on-my-services filter
Dim or hide what you can't actually stream. `[W37]`

### Day 247 · Apr 4 | Service badges
Small, recognisable service marks on every card.

### Day 248 · Apr 5 | Region selector
Availability by country, not just timezone. `[W38]`

### Day 249 · Apr 6 | Region-aware badges
The badges change when you change region. `[W38]`

### Day 250 · Apr 7 | Region mismatch warning
"This is on Crunchyroll — but not in your region."

### Day 251 · Apr 8 | Resume links
One-click deep links to the exact show on each service. `[W40]`

### Day 252 · Apr 9 | Episode-level deep links
Straight to the next episode, wherever the service allows it. `[W40]`

### Day 253 · Apr 10 | Dub availability
Dub badges, driven from the data. `[W39]`

### Day 254 · Apr 11 | Dub calendar track
A separate calendar lane for dub releases. `[W39]`

### Day 255 · Apr 12 | Dub lead time
Dubs lag; show the expected gap instead of hiding it.

### Day 256 · Apr 13 | Sub versus dub preference
A global default, with per-show overrides.

### Day 257 · Apr 14 | Simulcast timing
The streaming drop time versus the Japanese broadcast.

### Day 258 · Apr 15 | Streaming countdown
The countdown that matters is your service's, not the broadcast's.

### Day 259 · Apr 16 | Free versus paid
Mark what's watchable without a subscription.

### Day 260 · Apr 17 | Ad-tier awareness
Flag where a free tier exists but lags behind.

### Day 261 · Apr 18 | Where-to-watch page per show
The existing pages, upgraded with everything above.

### Day 262 · Apr 19 | Where-to-watch index
Everything airing, grouped by service.

### Day 263 · Apr 20 | Service coverage stats
What percentage of your list each service actually covers.

### Day 264 · Apr 21 | Subscription advisor
Which single service would unlock the most of your backlog.

### Day 265 · Apr 22 | Cancel advisor
Which subscription you're barely using, from your own watch data.

### Day 266 · Apr 23 | Cost per hour
What each service actually costs you per hour watched.

### Day 267 · Apr 24 | Physical release links
Where a show exists on disc, for the shows that warrant it.

### Day 268 · Apr 25 | Legal-only mode
A setting that hides anything without a legitimate source.

### Day 269 · Apr 26 | Missing availability reports
A one-tap "this link is wrong" that queues a correction.

### Day 270 · Apr 27 | Availability change alerts
Tell me when something on my list gains or loses a service.

### Day 271 · Apr 28 | Leaving soon
Flag titles about to drop off a service you use.

### Day 272 · Apr 29 | New on your services
What arrived this week on services you actually have.

### Day 273 · Apr 30 | Month wrap
Coverage and cost, summarised.

---

## Month 10: May 2027 · Franchises & deep catalog

### Day 274 · May 1 | Relation graph
Build the full prequel, sequel and side-story graph per title. `[W41]`

### Day 275 · May 2 | Franchise detection
Cluster related entries into a single franchise. `[W41]`

### Day 276 · May 3 | Franchise hub page
Every entry of a franchise, in one place. `[W41]`

### Day 277 · May 4 | Release order view
The franchise in the order it actually came out. `[W41]`

### Day 278 · May 5 | Watch order view
The recommended order, with the reasoning shown. `[W41]`

### Day 279 · May 6 | Watch order — community variants
Alternate orders, labelled by who recommends them.

### Day 280 · May 7 | Franchise progress
How much of a franchise you've completed, as one bar.

### Day 281 · May 8 | Where to start
The right entry point for a franchise you haven't touched.

### Day 282 · May 9 | Skip guidance
Recap episodes and filler flagged as skippable.

### Day 283 · May 10 | Franchise stats
Total runtime, span in years, studios involved.

### Day 284 · May 11 | Sequel watch
Auto-flag announced sequels for the shows you've completed. `[W42]`

### Day 285 · May 12 | Sequel alerts
A notification when a sequel is announced or finally dated. `[W42]`

### Day 286 · May 13 | Announced-but-undated
A tracker for the shows stuck in limbo.

### Day 287 · May 14 | Adaptation mapping
Link an anime to its source manga or light novel. `[W43]`

### Day 288 · May 15 | Adaptation range
Which volumes or chapters an anime actually covers. `[W43]`

### Day 289 · May 16 | Read on from here
The exact chapter to continue from once the anime ends. `[W43]`

### Day 290 · May 17 | Source status
Is the source finished, ongoing, or on hiatus.

### Day 291 · May 18 | Source progress tracking
Track your manga and light-novel reading alongside the anime.

### Day 292 · May 19 | Anime-original divergence
Flag where an adaptation departs from its source.

### Day 293 · May 20 | Character data layer
Pull characters and voice actors per show. `[W44]`

### Day 294 · May 21 | Character pages
A real page per character, with every appearance. `[W44]`

### Day 295 · May 22 | Voice actor pages
Every role, sortable by year and popularity. `[W44]`

### Day 296 · May 23 | Follow a person
Alerts when a followed staff member or VA has new work. `[W44]`

### Day 297 · May 24 | Staff pages
Directors, writers and composers with their filmographies.

### Day 298 · May 25 | Studio deep pages
A studio's full history, with their score trend over time.

### Day 299 · May 26 | Franchise timeline
A chronological in-universe timeline, where the data allows it.

### Day 300 · May 27 | Related-by-staff
"From the director of…" as its own discovery axis.

### Day 301 · May 28 | Seiyuu affinity
Which voice actors keep turning up in shows you rate highly.

### Day 302 · May 29 | Composer affinity
The same for music, because it matters more than people admit.

### Day 303 · May 30 | Deep catalog search
Search restricted to pre-2010, for the archive divers.

### Day 304 · May 31 | Month wrap
How much of your franchises you actually finished.

---

## Month 11: June 2027 · Growth & embeds

### Day 305 · Jun 1 | Embed renderer v2
A themeable, resizable widget core. `[W45]`

### Day 306 · Jun 2 | Embed builder UI
A live preview with a copy button. `[W45]`

### Day 307 · Jun 3 | Embed — list widget
Any list or collection, as an embed. `[W45]`

### Day 308 · Jun 4 | Embed — calendar widget
Your airing calendar, embedded anywhere.

### Day 309 · Jun 5 | Embed — single show widget
One show's countdown, for a signature or a sidebar.

### Day 310 · Jun 6 | Embed themes
Light, dark, transparent and custom-palette embeds. `[W45]`

### Day 311 · Jun 7 | Embed sizing
Fixed, responsive and auto-height variants. `[W45]`

### Day 312 · Jun 8 | Embed performance budget
A hard size cap so embeds stay light on other people's pages.

### Day 313 · Jun 9 | OG image generator
Per-page share images, generated at build time. `[W46]`

### Day 314 · Jun 10 | Season share cards
A card per season page, using the season's best art. `[W46]`

### Day 315 · Jun 11 | Show OG images
The existing per-show images, upgraded with score and dates. `[W46]`

### Day 316 · Jun 12 | List OG images
Shared lists get a real preview image.

### Day 317 · Jun 13 | Add to Google Calendar
A direct link, not just an .ics download. `[W47]`

### Day 318 · Jun 14 | Add to Apple Calendar
The webcal path, done properly. `[W47]`

### Day 319 · Jun 15 | Add to Outlook
The Microsoft variant. `[W47]`

### Day 320 · Jun 16 | Add to Yahoo
Completing the set. `[W47]`

### Day 321 · Jun 17 | Subscribe-feed builder
Build a filtered .ics feed out of any view.

### Day 322 · Jun 18 | Feed per collection
Every collection gets its own subscribable calendar URL.

### Day 323 · Jun 19 | Feed refresh transparency
Show when a feed last updated, and how often it will.

### Day 324 · Jun 20 | RSS feeds
An RSS alternative for people who live in readers.

### Day 325 · Jun 21 | Browser extension shell
The extension skeleton and store listing. `[W48]`

### Day 326 · Jun 22 | Extension — new tab
Airing today, on every new tab. `[W48]`

### Day 327 · Jun 23 | Extension — badge
An unwatched-episode count on the toolbar icon. `[W48]`

### Day 328 · Jun 24 | Extension — quick add
Right-click any AniList or MAL page to add the show.

### Day 329 · Jun 25 | PWA install prompt
A well-timed, dismissible install invitation.

### Day 330 · Jun 26 | PWA offline mode
The app usable without a connection, from cached data.

### Day 331 · Jun 27 | Widget-ready manifest
Home-screen shortcuts straight to your most-used views.

### Day 332 · Jun 28 | Growth loop
Every share format carries a subtle, non-spammy link back.

### Day 333 · Jun 29 | Landing page refresh
The SEO pages upgraded with the year's new features.

### Day 334 · Jun 30 | Month wrap
Reach: embeds, feeds and installs.

---

## Month 12: July 2027 · Power tools & portability

### Day 335 · Jul 1 | Omnibox
One input for search, quick-add and commands. `[W49]`

### Day 336 · Jul 2 | Quick-add from anywhere
Add a show without leaving your current view. `[W49]`

### Day 337 · Jul 3 | Paste to import
Paste a list of titles and match them in bulk.

### Day 338 · Jul 4 | Bulk edit mode
Multi-select with a full action bar.

### Day 339 · Jul 5 | Batch rating
Rate a run of shows in a single pass.

### Day 340 · Jul 6 | Keyboard macros
Chain several actions into one shortcut.

### Day 341 · Jul 7 | Saved views
The entire app state — filters, sort, density — as a named view.

### Day 342 · Jul 8 | View switcher
Jump between saved views from the command palette.

### Day 343 · Jul 9 | Export — list as CSV
Every show with status, score and dates. `[W50]`

### Day 344 · Jul 10 | Export — full JSON
Everything, including notes and settings. `[W50]`

### Day 345 · Jul 11 | Export — stats bundle
The computed numbers as their own file. `[W50]`

### Day 346 · Jul 12 | Import — from CSV
Bring a list back in, with a dry-run diff first.

### Day 347 · Jul 13 | Import — from MAL XML
The standard MyAnimeList export format.

### Day 348 · Jul 14 | Import — from AniList
A direct pull, improved over the current import.

### Day 349 · Jul 15 | Import — from Kitsu & Simkl
The remaining common sources.

### Day 350 · Jul 16 | Import conflict resolution
A clear diff whenever an import disagrees with your data.

### Day 351 · Jul 17 | Backup reminder
A gentle nudge when your last export has gone stale. `[W50]`

### Day 352 · Jul 18 | Auto-backup to file
A periodic download you can turn on and forget about.

### Day 353 · Jul 19 | Report wrong data
A one-tap correction on any field. `[W51]`

### Day 354 · Jul 20 | Correction queue
Where reports go — visible, so it doesn't feel like a void. `[W51]`

### Day 355 · Jul 21 | Correction status
Tell the reporter what actually happened to their report. `[W51]`

### Day 356 · Jul 22 | Local overrides
Fix a wrong air time for yourself immediately, while upstream catches up.

### Day 357 · Jul 23 | Data provenance
Show which source each field came from.

### Day 358 · Jul 24 | Sync code v2
A cleaner multi-device pairing flow. `[W52]`

### Day 359 · Jul 25 | Sync conflict prompts
A readable diff when two devices disagree. `[W52]`

### Day 360 · Jul 26 | Sync history
What synced when, with the ability to roll back.

### Day 361 · Jul 27 | Selective sync
Choose which parts of your data travel between devices.

### Day 362 · Jul 28 | Storage inspector
What the app is storing, with per-section clearing.

### Day 363 · Jul 29 | Reset with a parachute
A full reset that exports a backup first.

### Day 364 · Jul 30 | Settings search
Find any setting by name.

### Day 365 · Jul 31 | Year one wrap
The whole year's shipping, as one shareable page.

---

## How to Use This Backlog

Pick one a day and ship it. Reorder freely — the only rule is a **visible improvement every day**, so momentum never depends on the long backend milestones landing first.

**On slipping.** Days are a cadence, not a contract. A feature that turns out to be two days is two days; the calendar dates are a map, not a debt. Pull the next item forward when you're ahead — weeks 2 and 3 of the old backlog both shipped on Aug 1, which is exactly how this is meant to work.

**On the spines.** Where a feature is decomposed across several days (`data → UI → surfacing → polish`), the data day usually ships nothing visible on its own. That is an argument for batching: land the data day and the UI day in the same push, so every deploy is a visible change.

**On deploys.** Build daily, deploy every 2–3 days, ~12 feature drops a month. See *Daily Build, Batched Deploy* above — the 20-deploy ceiling is the real constraint on this backlog, and pushing more often buys nothing users can see while costing you the budget for hotfixes.

---

*Tsuzuki · 365 daily features · Aug 2026 → Jul 2027*
