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
Site details → Change site name) so it serves from `https://tsuzuki.netlify.app`. Set up the
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
(add the property, then **Sitemaps → submit `https://tsuzuki.netlify.app/sitemap.xml`**)
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

Subscriptions (push endpoint + followed-show ids + lead time) are stored in Netlify Blobs,
keyed by push endpoint, and pruned automatically when a subscription expires (404/410 from
the push service).

## Embed widget — free backlinks
`site/embed/` is a self-contained `<iframe>` widget showing the next few days of airing anime.
It fetches AniList client-side (always live, no rebuild) and links back to the main site —
so every place someone embeds it becomes a backlink. Grab the snippet from the app footer's
**⧉ Embed this calendar** link (with a live preview + copy button), or use directly:
```html
<iframe src="https://tsuzuki.netlify.app/embed/?days=7" width="360" height="520"
        style="border:1px solid #2a3140;border-radius:12px" title="Tsuzuki — anime airing schedule"></iframe>
```
Query params: `days` (1–31, default 7) and `limit` (max rows, default 25).

## Notes
- The bot token lives only in GitHub's encrypted secrets — not on your PC and not in the code.
- Editing the site? Just commit & push — Netlify redeploys. Editing the Discord post format?
  Change `bot/post-updates.mjs` and push; the next scheduled run uses it.
- This replaces both the manual Netlify drag-and-drop and the local Windows Task Scheduler job.
