# Tsuzuki — site + Discord automation

This repo does two things, entirely in the cloud (no dependency on your PC):

1. **Hosts the website** (`/site`) — auto-deployed to Netlify on every push.
2. **Posts daily Discord updates** (`/bot`) — a GitHub Actions cron job runs
   `bot/post-updates.mjs` once a day and posts the schedule / premieres / finales / news.
3. **Posts daily to social media** (`/bot`) — a second cron job runs
   `bot/post-social.mjs` and posts a short "today in anime" blurb to Bluesky, Mastodon, and Twitter/X.

```
site/                 the Tsuzuki website (index.html, sitemap.xml, robots.txt, og-image.png, favicon.svg, 404.html)
site/embed/           embeddable "what's airing" widget (iframe) for other sites — generates backlinks
scripts/build-seo.mjs generates static SEO landing pages (/today/, /<season>-<year>/) from AniList at deploy time
bot/post-updates.mjs  pulls AniList + ANN and posts embeds to Discord
bot/post-social.mjs   pulls AniList and posts a daily blurb to Bluesky / Mastodon / Twitter-X
netlify.toml          tells Netlify to publish /site (and run the SEO build step)
.github/workflows/daily-discord.yml   daily Discord cron job
.github/workflows/daily-social.yml    daily social-media cron job
.github/workflows/refresh-pages.yml   daily Netlify rebuild so /today/ stays fresh (optional)
```

## One-time setup

### A. Push this repo to GitHub
```bash
cd "C:\Users\krays\Desktop\stuff for anical\anical"
git add .
git commit -m "Add site + Discord automation"
git remote add origin https://github.com/<you>/<repo>.git   # if not already set
git push -u origin main
```

### B. Auto-deploy the site (Netlify ↔ GitHub)
In Netlify, link this repo to your site and rename it to **tsuzuki** (Site configuration →
Site details → Change site name) so it serves from `https://tsuzuki.top`. Set up the
link under **Site configuration → Build & deploy → Link repository** (or *Add new site →
Import an existing project* if starting fresh). Netlify reads `netlify.toml`, so just confirm
the **publish directory is `site`** and leave the build command empty. Every push now deploys
automatically. To preserve SEO, keep the old `anicalendar` name as a domain alias (or add a
301 redirect) pointing at the new site.

### C. Daily Discord job (GitHub Actions)
Add two encrypted secrets under **GitHub repo → Settings → Secrets and variables →
Actions → New repository secret**:
- `BOT_TOKEN` — your Discord bot token
- `GUILD_ID`  — `1512821009131110542`

The job runs daily at 08:00 UTC. To test it now without waiting: **Actions tab → Daily
Discord update → Run workflow**. Edit the `cron:` line in the workflow to change the time.

### D. Daily social-media job (GitHub Actions)
Posts a short blurb (today's premieres / finales / episode count + a link) to each platform
**you provide secrets for** — add as many or as few as you like. Same secrets page as above.

**Bluesky** (easiest, recommended)
- `BSKY_HANDLE` — e.g. `anical.bsky.social`
- `BSKY_APP_PASSWORD` — Bluesky → *Settings → Privacy and security → App passwords*
  (create one; **not** your normal login password)

**Mastodon**
- `MASTODON_BASE` — your instance URL, e.g. `https://mastodon.social`
- `MASTODON_TOKEN` — *Preferences → Development → New application* (scope `write:statuses`),
  then copy **Your access token**

**Twitter / X** (all four required; the X app must have **Read and Write** permission)
- `X_API_KEY`, `X_API_SECRET` — the app's API Key & Secret (consumer keys)
- `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` — the access token & secret for your account
- Get these from the [X Developer Portal](https://developer.twitter.com/) → your project/app →
  *Keys and tokens*. Note: X's free tier caps posts/day — fine for one daily post.

Runs daily at **08:05 UTC**. Test without sending: **Actions → Daily social post → Run
workflow → check "dry_run"** (composes and logs the posts but doesn't publish). Locally you
can also run `DRY_RUN=1 node bot/post-social.mjs`.

## SEO
The site ships with `sitemap.xml`, a `Sitemap:` line in `robots.txt`, Open Graph + Twitter
card tags (with `og-image.png`), and JSON-LD structured data (`WebSite` + `WebApplication`).
After deploy, submit the site once in [Google Search Console](https://search.google.com/search-console)
(add the property, then **Sitemaps → submit `https://tsuzuki.top/sitemap.xml`**)
to start getting indexed.

### Programmatic SEO landing pages
The app itself is JS-only, so crawlers see little text. `scripts/build-seo.mjs` fixes that:
on every Netlify deploy it pulls live AniList data and writes **static, server-rendered**
pages that target real searches:
- `/today/` → *"what anime is airing today"*
- `/winter-2026/`, `/spring-2026/`, … (previous → next+1 season) → *"<season> <year> anime schedule"*

Each page has real titles + dates in the HTML, a canonical URL, Open Graph tags, and
`ItemList` JSON-LD, and is listed in the regenerated `sitemap.xml`. The generator has **zero
npm deps** and **always exits 0**, so a transient AniList outage can never fail a deploy.
The pages are git-ignored (rebuilt on deploy); run `node scripts/build-seo.mjs` to preview locally.

**Keep `/today/` fresh:** seasons rarely change, but the "airing today" page should rebuild
daily. `.github/workflows/refresh-pages.yml` does this by pinging a **Netlify build hook**:
1. Netlify → *Site configuration → Build & deploy → Build hooks → Add build hook*, copy the URL.
2. GitHub → repo *Settings → Secrets and variables → Actions* → add secret `NETLIFY_BUILD_HOOK` = that URL.

Without the secret the workflow simply no-ops.

## Push notifications (Web Push / VAPID)
Episode alerts work two ways:
- **In-browser** (existing): Notification Triggers / in-page timers — only fire while the
  browser (or, on supported browsers, a kept-alive service worker) is around.
- **Server-driven** (new): `netlify/functions/push-*.mjs` + a Netlify **scheduled function**
  (`push-send.mjs`, runs every 15 minutes) send real Web Push notifications for shows a user
  has the 🔔 bell enabled on — these arrive even if Tsuzuki is fully closed.

Setup (one-time):
1. `node scripts/generate-vapid-keys.mjs` → prints a VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.
2. Put `VAPID_PUBLIC_KEY` into `site/index.html` (`const VAPID_PUBLIC_KEY = "...";`) — it's
   public, safe to commit.
3. In Netlify → *Site configuration → Environment variables*, add:
   - `VAPID_PRIVATE_KEY` — the private key from step 1 (secret, never commit)
   - `VAPID_SUBJECT` — optional, e.g. `mailto:you@example.com`
   - `CRON_SECRET` — optional random string, lets you manually trigger
     `/.netlify/functions/push-send?secret=...` for testing
4. Deploy. `@netlify/blobs` and `web-push` (declared in `netlify/functions/package.json`)
   are installed automatically by Netlify — no local `npm install` needed.

**Rotating keys** replaces a pair, and the pair has to move together: put the new public key
in `site/index.html`, in `VAPID_PUBLIC_DEFAULT` at the top of `push-send.mjs`, and set the new
`VAPID_PRIVATE_KEY`. (`VAPID_PUBLIC_KEY` also works as an environment variable and wins over the
committed default — handy for testing a new pair before committing it. It is not required:
requiring it is what made every scheduled run answer 500 for weeks, since nothing above ever
told you to set it.)

If push alerts go quiet, ask the function itself rather than reading the run log:

    curl "https://<site>/.netlify/functions/push-send?secret=$CRON_SECRET&dry=1"

`dry=1` resolves and counts the notifications that are due without sending any. A scheduled run
never answers 500 any more — a configuration or upstream problem comes back as `ok:false` with a
`reason` (`vapid-private-key-missing`, `vapid-invalid`, `store-unavailable`,
`schedule-unavailable`), because a 500 every 15 minutes is an alarm that teaches you to ignore
alarms.

Subscriptions (push endpoint + followed-show ids + lead time) are stored in Netlify Blobs,
keyed by push endpoint, and pruned automatically when a subscription expires (404/410 from
the push service).

## Discord sign-in + skins
Skins are full site themes tied to a character or a series — the entire colour
palette plus art layered into the UI (page backdrop, header band, a corner
cutout, an empty-state watermark). They're handed out to individual people at
events, which is the only reason sign-in exists: something has to know which
account you are so a grant can find you.

**Sign-in is identity and nothing else.** Your list, ratings, notes and
collections are still never uploaded, and the settings panel says so where you
sign in. What is stored server-side is your Discord id, name and avatar hash, so
the admin panel can grant a skin by name instead of by snowflake.

Setup (one-time):
1. Discord Developer Portal → your app → **OAuth2 → Redirects**, add
   `https://<site>/api/auth/callback`. Add one per origin you sign in from —
   Discord only accepts redirect URIs registered on the app.
2. Netlify → *Site configuration → Environment variables*:
   - `DISCORD_CLIENT_ID` — the application id (same app the bot uses)
   - `DISCORD_CLIENT_SECRET` — OAuth2 → Client secret
   - `SESSION_SECRET` — any long random string (`openssl rand -base64 48`)
3. Deploy. Without these, sign-in is *off* rather than broken: the settings panel
   explains which variables are missing and the rest of the site is unaffected.

Sessions are a signed cookie, not a stored row — HMAC-SHA256 over the payload
with `SESSION_SECRET`, `HttpOnly; Secure; SameSite=Lax`, 90 days. The grant is
deliberately **not** in the token, so a skin granted five minutes ago reaches
someone who signed in last month without them having to sign out and back in.

### What a skin actually is
Not a recolour. Recolouring alone gives you the same site in different paint —
which is what the first version of this did, and it read as exactly that. What
makes a skin feel like a different product is **structure**, so a theme carries
all of it:

| field | what it changes |
| --- | --- |
| `colors` | the full 13-variable palette |
| `font` | a display face for headings only — body copy and the calendar keep the system stack, because a decorative face at 12px across a grid of air times is a skin that made the product worse |
| `shape` | corner radii, border weight, surface blur. `--radius` already drives most of the page, so this reshapes it wholesale |
| `effects` | vignette / grain / scanlines / glow strength |
| `backdrop` | the show's banner behind everything |
| `header` | the same art as a band behind the toolbar |
| `cutout` | the poster in a corner, edges dissolved via a mask so it reads as part of the layout rather than a screenshot pasted on top |
| `watermark` | art on empty days and empty lists |
| `pattern` | a tiling motif drawn from the palette |
| `ornament` | a corner flourish, likewise drawn |

Every art layer lives in one fixed `#skinLayers` container at `z-index:-1` —
behind all content, above the page background, in explicit paint order. One
stacking context for the whole system means nothing else has to be re-stacked
and no layer can end up on top of a dialog.

`pattern` and `ornament` are generated SVG inlined as `data:` URIs rather than
fetched: no host to go down, no dead link in six months, and a texture actually
made of the theme's own colours. They're safe as CSS backgrounds specifically —
an SVG referenced by `background-image` renders in the browser's secure static
mode, where script is inert — and both the server and the client hold them to a
character class that can't break out of `url()`.

### Making a skin
`site/data/themes.json` is the committed set, generated from each show's own art
and its AniList dominant colour:

    node scripts/build-themes.mjs                    # regenerate the shipped set
    node scripts/build-themes.mjs --add 21519        # add a title by AniList id
    node scripts/build-themes.mjs --check            # verify every image URL still resolves

Images are external `https://` URLs — the shipped set points at AniList's CDN,
which the site already loads every cover from. So a theme is pure JSON: nothing
binary in the repo, no upload endpoint, and **a new skin costs no deploy**. The
tradeoff is that a skin is only as available as its image host, hence `--check`.

Each title in `SEED` pairs an AniList id with a *recipe* — which motif, which
display face, how sharp the whole UI is, what sits over the top:

    154587: { motif: "runes",  font: "cormorant", shape: "soft",   effects: { vignette: 0.5 } },
    113415: { motif: "slash",  font: "bebas",     shape: "sharp",  effects: { grain: 0.35, glowStrength: 0.8 } },

Ten motifs ship (asanoha for Demon Slayer, seigaiha for One Piece, cursed
slashes for Jujutsu Kaisen, a hex grid for Solo Leveling…). Add a row, re-run,
and refine in `/admin` afterwards — a title added with `--add` and no recipe
gets a sane default rather than nothing.

If you have real transparent character PNGs, point `cutout.url` at one and it
beats the poster fallback outright — that layer was built for exactly that, the
poster is just the honest best available without an art source.

### Granting one
`/admin` → **Skins** to edit or preview (preview renders on the real site and is
visible only to you — it's handed over in `localStorage`, not a URL, because a
`?theme=` link would let anyone wear an event skin). **Grants** to assign one to
a Discord user id.

A grant is permanent: no expiry, and nothing the client re-checks for a lapse.
The wearer can toggle it off for themselves in Settings. **Remove** exists to
undo a mistyped id and to delete someone's stored row on request — it is not a
timed revoke.

## The catalog (how data reaches the app)
`netlify/functions/_lib/catalog.mjs` is the read path everything else goes
through. A lookup resolves in three tiers — per-instance memory, then a Netlify
Blobs snapshot shared by every instance and every visitor, then AniList, whose
answer is written back into tier 2. So one cold request pays for a season and
every request after it is free, and an AniList outage degrades to slightly stale
data instead of an error.

`netlify/functions/api.mjs` reads from it, `push-send.mjs` reads from it, and the
app itself reads from it: `site/index.html` calls `/api/v1/seasons/...?full=1`,
`/api/v1/anime/<id>?full=1` and `/api/v1/search` before touching AniList. Every
one of those calls still falls back to AniList directly if our API can't answer,
so the site is never *dependent* on its own backend.

What still goes upstream: a season nobody has requested in six hours, a title
outside the cached seasons, a search for something not currently airing, and the
scheduled worker below. What no longer does: an ordinary page load.

## Ingestion backbone (data platform)
`netlify/functions/ingest.mjs` is a Netlify **scheduled function** (every 2
hours) that refreshes **one season per run — whichever the catalog holds the
stalest copy of** — through a shared retry + rate-limit budget
(`_lib/ingest-http.mjs`), writes it into the catalog, normalizes each show into a
versioned canonical schema (`_lib/ingest-schema.mjs`), and archives the raw API
payload — all in Netlify Blobs, so there's no separate database to provision.
`_lib/ingest-sources/` also has stub adapters for ANN, TMDB and studio feeds
(each returns `{skipped:true, reason:"..."}` today) so those sources have a place
to land the moment they're implemented, without changing the orchestrator's
shape.

It used to crawl all three seasons in one invocation — up to 18 paginated
requests behind a 25/min limiter, comfortably over a minute — inside a function
whose execution limit is a few seconds. Every run was killed before it wrote its
log, which is why `/api/ingest/status` reported "no ingestion run yet" for weeks
while the schedule fired on time. One season per run finishes inside the budget,
and running more often covers the same ground.

This is the first milestone (2026·08) of the 10-year roadmap's "Own the Data"
year — entity resolution across sources, conflict resolution when they
disagree, and historical backfill are the months that follow, building on the
canonical records this worker writes.

- Check the latest run: `curl https://<site>/api/ingest/status`
- Manually trigger a run (uses the same `CRON_SECRET` as push-send.mjs):
  `curl "https://<site>/.netlify/functions/ingest?secret=$CRON_SECRET"`
- Force a specific season (fastest way to warm the catalog after an outage):
  `curl "https://<site>/.netlify/functions/ingest?secret=$CRON_SECRET&season=SUMMER&year=2026"`
- See what the catalog can answer without going upstream: `curl https://<site>/api/v1`
  and read the `catalog` block.

## Release variants + the correction layer
AniList publishes the **Japanese TV broadcast** time and nothing else. That is
the wrong number for nearly every viewer: a simulcast watcher wants the
Crunchyroll/HIDIVE drop, a dub watcher wants a date AniList doesn't carry at
all, and neither reflects the week a broadcast is pre-empted. So one AniList
airing node fans out into the **variants** that actually exist for that episode
— `raw` / `sub` / `dub` — with human corrections layered on top.

- **Client**: the "release variants" section of `site/index.html`.
- **Server**: `netlify/functions/_lib/schedule-overrides.mjs` — the mirror of the
  same logic, used by `push-send.mjs`. The client can't import it (no build
  step), so **change one, change the other**; the shapes and resolution order
  are the contract.

**What's exact and what isn't.** `raw` comes straight from AniList and is
always exact. `sub` is exact when there's override data, otherwise it falls back
to the broadcast time flagged **estimated** (rendered with a `~`) for shows on a
known simulcast platform. `dub` is *never* estimated — no data means no dub row,
because an invented dub date is worse than none.

### The maintainer console (`/admin/`)
`site/admin/index.html` — noindex, `Disallow`ed in robots.txt, and useless
without `ADMIN_SECRET` (which it keeps in `sessionStorage`, never in the URL,
because URLs leak through history and `Referer`). It lists the reader-report
queue and turns a report into a correction in one click: pick *exact time /
delay / break / show-wide offset rule*, preview the JSON patch, apply. Applying
writes the live store and marks the report `applied` in the same action.

The datetime field self-seeds from `/api/v1/anime/{id}`, so a maintainer adjusts
the real current value instead of typing one from memory.

Without this the report intake was a suggestion box with no back wall — reports
accumulated in a blob store nobody read.

### Seed data and how it was measured
The seed is **not** guesswork. Crunchyroll publishes its release calendar with
machine-readable `<time datetime>` values carrying an explicit UTC offset; each
`offsetMin` below is that published release time minus AniList's published
broadcast time for the same episode.

Measured 2026-08-04, and the spread is the whole argument for this feature:

| Show | sub offset | dub offset |
|---|---|---|
| Young Ladies Don't Play Fighting Games | 0 | — |
| Skeleton Knight in Another World S2 | 0 | 0 (same slot) |
| Love Unseen Beneath the Clear Night Sky | +30 | — |
| Oh Boy, Was I Wrong About Her | +30 | — |
| Grand Blue Dreaming S3 | +30 | — |
| A Livid Lady's Guide to Getting Even | +60 | — |
| LIAR GAME | +60 | +20220 (2 weeks + 1h) |
| The Insipid Prince's Furtive Grab for the Throne | +63 | — |

**0 to 63 minutes.** The estimated-sub fallback (which assumes the simulcast
lands with the broadcast) is therefore wrong for most shows — usually by half an
hour, which is exactly long enough to make someone miss it. The 63 is not a typo:
that broadcast starts at `:57` and Crunchyroll publishes on the hour.

The one derived figure is LIAR GAME's dub, and it was checked rather than
assumed: Crunchyroll listed dub ep16 at the same instant as subtitled ep18, and
the broadcast cadence was confirmed at exactly 7 days across 17 episodes. The
resolved output lands on 2026-08-03T16:00Z — the exact instant Crunchyroll lists.

### Automated ingestion
`scripts/ingest-crunchyroll.mjs`, run daily by
`.github/workflows/ingest-crunchyroll.yml`, measures those offsets continuously
instead of by hand.

**Why Actions and not a scheduled function**: crunchyroll.com answers
non-browser clients with `403`. A Netlify Function can't get past that and can't
run a browser; Actions can, on the same free minutes that already build the SEO
pages.

**Why it costs no Netlify credits**: the commit only touches
`data/derived-offsets.json` at the *repo root* — nothing under `site/`. The
`ignore` rule in netlify.toml (`git diff --quiet … -- site`) exits 0 and Netlify
cancels the build. Verified: a data-only commit exits 0, a `site/` commit exits
1. Corrections reach users through `POST /api/overrides` — the blob store, no
deploy. **git is the audit trail; the blob store is what serves.**

**A capture only ever contains releases that have already happened.** This was
written the other way round — "Crunchyroll publishes firm times a day or two
ahead" — and that is wrong in the way that matters. Verified 2026-08-05: a
capture taken at 16:11Z contained nothing dated after 16:00Z, so an episode due
at 16:15Z was simply absent, and the ingest could not measure it however many
times it was re-run. The calendar exposes the past, not the schedule.

The consequence is a timing rule: **capture *after* the slot you care about, not
before.** Each run still captures a slice and offsets accumulate, and a show
measured once stays measured — but a show whose episode has not aired yet cannot
be measured at all. `--rows` now prints the window a capture covers and how old
its newest row is, so "the show isn't on the calendar" stops looking identical to
"you captured too early".

This limit is also the argument for the observation network below: the moment a
release is worth measuring is the moment it lands, and there is always someone
watching who knows.

**What it refuses to do** — it writes to a store every visitor and every API
consumer reads, so the guards matter more than the happy path:

| Guard | Behaviour |
|---|---|
| Title match | Needs high confidence *and* a clear margin over the runner-up. A set-identical title bypasses the margin (unambiguous by definition) unless two titles are identical, which is refused outright. |
| Episode placement | Extrapolates a dub's episode only from a cadence confirmed uniform; an irregular schedule is skipped, not guessed. |
| Plausibility band | Sub −10 min…12 h, dub 0…120 days. Outside that it's likelier a mismatch than a real value — reported, never written. |
| Disagreement | Two observations of the same show that conflict cancel each other out and get flagged for a human. |
| `"pinned": true` | Never touched. The escape hatch for a human decision the scraper would otherwise keep reverting. |
| Unchanged values | Skipped, so the store doesn't churn. |

Every written rule carries `source` and `verifiedAt`, and cadence-derived
figures say so in the source string.

The run summary posts a table of what it derived plus a **"Needs a human"**
section for conflicts and out-of-band values.

```bash
node scripts/ingest-crunchyroll.mjs --dry-run            # derive and print only
node scripts/ingest-crunchyroll.mjs --rows rows.json     # skip the browser (tests)
```

**Setup**: add `ADMIN_SECRET` to the repo's Actions secrets, same value as the
Netlify env var. Without it the job still derives and commits but publishes
nothing, so a fork degrades quietly instead of failing.

Verified against the hand-measured sample: the automated pipeline reproduces all
ten offsets exactly, including LIAR GAME's cadence-derived dub. Its safety rails
have 36 tests.

**Other sources still open**: TMDB episode data via the existing
`_lib/ingest-sources/tmdb.mjs` stub (also brings per-region watch providers), and
reader reports through `/admin/`.

## Release observations — per-region times, measured by the people watching
An offset is not one number. The Japanese broadcast is global; the time a viewer
actually gets the episode differs by region, and no source we can reach publishes
that. The Crunchyroll calendar has it and is region-localised — a German capture
comes back full of `STAFFEL` — but it is behind a bot challenge, and it only
shows the past. Their private API (`beta-api.crunchyroll.com`) answers a plain
server request with a real `401` rather than a challenge, so it is reachable, but
the only way in is a client credential that is not ours to hold. A competitor's
API would just relocate the dependency.

So the source is the audience. `POST /api/report` with `kind: "released"` records
that an episode has appeared, tagged with the reporter's country from Netlify's
edge geo (`context.geo`), and the offset is computed **server-side** from the
known broadcast time — a browser clock is not evidence, and neither is a number
the caller picks. `netlify/functions/_lib/observations.mjs` holds the rules:

| Guard | Behaviour |
|---|---|
| One vote each | Keyed by show + episode + air type + region + hashed IP. Re-reporting replaces your own vote. |
| `MIN_OBSERVERS` | 3 distinct reporters before anything is derived. |
| `AGREEMENT_MIN` | They must fall within 15 minutes of each other, or the group is conflicting and derives nothing. |
| Median, not mean | One wild value cannot drag the result. |
| Plausibility band | The same band the scraper uses. Outside it, nothing is written. |
| `pinned` | Never touched, exactly as in the scraper. |

The scheduled ingest worker runs the consensus pass every two hours and writes
the survivors as region rules. Conflicting groups are reported rather than
published — a region that genuinely staggers its release and someone gaming the
input look identical at this layer, and both are questions for a human.

Why this is worth building rather than scraping harder: an offset is stable for a
season, so this needs roughly *one* confirmed observation per show per region —
not a crawl. It is also the only part of the dataset a competitor cannot copy.

**Overrides schema v2.** Region rules live alongside the global ones and resolve
most-specific-first — an exact per-episode time, then the region rule, then the
global rule, then the simulcast estimate. A region with no rule falls through to
the global behaviour rather than guessing.

```json
"184356": {
  "sub": { "offsetMin": 0 },
  "regions": { "DE": { "sub": { "offsetMin": 60, "source": "observations (3 reporters, spread 4m)" } } }
}
```

v1 documents are still valid and resolve identically. The client resolves the
viewer's region **in the browser**, from its own timezone, never from server
geo — every `/api/v1` response is CDN-cached by URL, so a geo-varying body would
serve one visitor's region to the next.

**Two override layers**, merged in this order:
1. `site/data/overrides.json` — committed, reviewable, cached, works offline.
   Its `_readme` key documents the full schema. Permanent facts (a season's dub
   cadence, a fixed simulcast offset) belong here.
2. `/api/overrides` (`netlify/functions/overrides.mjs`, Netlify Blobs) — the
   fast lane. A wrong time gets fixed in minutes instead of costing one of the
   ~20 monthly deploys. One-off weekly delays can live here only.

Both fail soft: with neither reachable the app behaves as it always did, plus
the estimated simulcast row, and a cached copy covers an offline launch.

```bash
# a one-week delay, merged into whatever is already live
curl -X POST "https://<site>/api/overrides?secret=$ADMIN_SECRET" \
     -H 'Content-Type: application/json' \
     -d '{"shows":{"170942":{"episodes":{"5":{"status":{"kind":"delay","shiftMin":10080,"reason":"Pre-empted"}}}}}}'

# replace the whole document
curl -X POST "https://<site>/api/overrides?secret=$ADMIN_SECRET&mode=replace" -d @overrides.json

# read the reader-report queue
curl "https://<site>/api/report?secret=$ADMIN_SECRET"
```

Set `ADMIN_SECRET` in **Netlify → Site configuration → Environment variables**
(it falls back to `CRON_SECRET` if unset). Reports come in from the
**⚠ Report a wrong time** button in every show's details
(`netlify/functions/report.mjs`); they're length-capped and keyed by show +
episode + a hash of the reporter's IP, so one person can't flood the queue.

Episode alerts follow the same resolution: `push-subscribe.mjs` stores the
subscriber's `airType`, and `push-send.mjs` alerts on that release — and never
on an episode marked as a break.

## Public API (`/api/v1`)
`netlify/functions/api.mjs` serves a free, keyless, CORS-open read API; the docs
live at `site/api/index.html` (`/api/`, hand-written and in the sitemap).

The reason it exists rather than pointing people at AniList: **every response
carries the release variants and the correction layer**. AniList has one time
per episode, no dub dates and no way to express a pre-empted week — that gap is
the entire product.

| Endpoint | Returns |
|---|---|
| `GET /api/v1` | Service description + machine-readable endpoint list |
| `GET /api/v1/schedule` | Corrected schedule for a window (`start`, `days`, `airType`, `platform`, `format`, `includeAdult`) |
| `GET /api/v1/anime/<anilistId>` | One title, full variant schedule, break weeks, and its raw corrections record |
| `GET /api/v1/seasons/<season>/<year>` | A season's lineup, each with `nextEpisode` resolved through the correction layer |
| `GET /api/v1/airing` | Currently-airing titles AniList assigned **no season** — unreachable by any season query, already folded into `/schedule` |
| `GET /api/v1/overrides` | The raw correction document |

**Cost control matters here more than politeness.** A `/schedule` request spans
three seasons at up to three pages each — nine upstream calls — and AniList rate
limits *us*, not the caller. So seasons are cached per instance for 10 minutes
and shared across every request and parameter combination, concurrent misses are
collapsed into one upstream fetch, and a stale copy is served in preference to a
503 when AniList is down. Responses are CDN-cached for 5 minutes on top of that.
The per-client 60/min limiter is a spike damper, not a quota — it resets on every
cold start, by design.

## AniList account sync (two-way)
Two separate things, both in `site/index.html`:

- **Public import** (unchanged): type a username, read their *public* list. No
  sign-in, one direction.
- **Connected sync** (new): OAuth **implicit grant**, so private entries come
  across and local changes go back. The code flow was rejected deliberately — it
  needs a client secret, a secret needs a server, and this app doesn't have one.
  The token lives in the browser and reaches nothing but AniList.

**Already configured** — `ANILIST_CLIENT_ID = "47767"` in `site/index.html`. The
client id is public by design (it travels in the authorize URL on every sign-in),
so it is committed like the VAPID public key; the implicit flow has no secret to
protect. Left empty, the settings panel says so instead of half-working.

**One thing must match**: the *Redirect URL* on the app registration at
[anilist.co/settings/developer](https://anilist.co/settings/developer) has to be
`https://tsuzuki.top` (or wherever the site actually lives). The code
deliberately does **not** send a `redirect_uri` — AniList matches it exactly, so
a trailing slash or a leftover query string turns sign-in into an error page.
Omitting it makes AniList use the registered URL, which is the only one that can
be right. Consequence worth knowing: signing in from a local dev server bounces
you to the production site.

Behaviour worth knowing before changing any of it:

- **Pull is AniList-wins, push is local-wins.** Pull is an explicit button, so
  rebuilding the local copy is the only non-surprising policy.
- **Nothing is ever deleted remotely.** Un-starring a show, clearing a status or
  clearing a score are local-only. Deleting someone's AniList entry — and its
  score and progress with it — because they tidied a Tsuzuki board is not
  recoverable.
- **Private notes never sync.** Ratings do, because "sync my list" is understood
  to include scores. Notes aren't.
- **Scores go out as `scoreRaw`** (0–100), so the account's own scoring scale
  doesn't matter.
- **The push queue survives a reload** (`anical.al.queue`) and runs one write per
  ~2.2s with 429 backoff. A permanent failure on one show drops that show rather
  than wedging the queue.

## Embed widget — free backlinks
`site/embed/` is a self-contained `<iframe>` widget showing the next few days of airing anime.
It fetches AniList client-side (always live, no rebuild) and links back to the main site —
so every place someone embeds it becomes a backlink. Grab the snippet from the app footer's
**⧉ Embed this calendar** link (with a live preview + copy button), or use directly:
```html
<iframe src="https://tsuzuki.top/embed/?days=7" width="360" height="520"
        style="border:1px solid #2a3140;border-radius:12px" title="Tsuzuki — anime airing schedule"></iframe>
```
Query params: `days` (1–31, default 7) and `limit` (max rows, default 25).

## Notes
- The bot token lives only in GitHub's encrypted secrets — not on your PC and not in the code.
- Editing the site? Just commit & push — Netlify redeploys. Editing the Discord post format?
  Change `bot/post-updates.mjs` and push; the next scheduled run uses it.
- This replaces both the manual Netlify drag-and-drop and the local Windows Task Scheduler job.
