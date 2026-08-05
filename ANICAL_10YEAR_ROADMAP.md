# Tsuzuki · The Decade Plan

**Product & engineering roadmap · 2026 → 2036**

Ten years to grow a calendar into a platform.

A month-by-month plan to take Tsuzuki from a calendar built on someone else's data to an independent anime-data platform, native apps, an ML discovery engine and an open ecosystem. Each month is one hard engineering milestone — most are a single step inside a year-long program — and the four flagships a year ship the week before a new anime season.

## Roadmap Stats
- **120** monthly milestones
- **10** year-long programs
- **40** seasonal flagships
- **v3 → v12** version arc

## Where this actually stands · Aug 2026

Month one of Year 1 shipped, and then some. Twelve slots below are already partly or wholly built — the public API landed five months early, the theming engine two years early, a grounded tool-calling assistant eight years early. Those slots are **rescoped, not deleted**.

| Marker | Means |
|---|---|
| ✅ | Shipped. The heading stays; the text underneath is now the work that remains. |
| ◐ | A working version exists. The milestone is the version that survives scale. |

A shipped milestone does not free its month. The month is still the month — what changed is what it is for. Where a slot was overtaken, the entry says what exists today before it says what is left, because the gap between "we have one" and "it holds up" is where the actual engineering is.

**The version arc moved up one.** This document originally ran v2 → v11, one major per year, Year 1 being v2.x. The app is already on **v3.1** — v3.0 shipped in August 2026 carrying the public API, the corrected sub/dub/broadcast times, the grounded assistant and AniList sync, and v3.1 followed within the month with the restructured show details, the rebuilt franchise timeline and the client moving onto our own servers. All of that is Year 1's work by content, even though it arrived in Year 1's first month. So every year below is relabelled one major higher and the arc now reads **v3 → v12**.

Do not read that as a schedule. **A major tracks shipped scope, not the calendar** — it gets bumped when a release earns it, and v3.0 earned it in week one. The `(vN.x)` on each year is the version that year is *expected to be working in*, not a version the year is obliged to produce. If the majors run ahead again, relabel again; the alternative is a version number that lies to keep a document tidy.

**Where the number actually lives.** `APP_VERSION` in `site/index.html` is derived at commit time by `scripts/stamp-version.mjs` as `<major.minor>.<commit count>`, reading the major.minor from the newest in-app CHANGELOG entry — so writing that entry *is* the release. Three neighbouring version numbers are deliberately independent of this arc and must not be dragged along with it: the public API's (`1.1`, matching the `/api/v1` route) and the data-format ones (`SCHEMA_VERSION`, `OVERRIDES_VERSION`, `THEMES_VERSION`, each still `1`).

---

## Year 1: Aug 2026 – Jul 2027 · Own the Data (v3.x)

**Focus**: Stop depending on AniList — stand up an independent, authoritative anime-schedule platform and move the client onto it. Half-done as of Aug 2026: the catalog and the public API exist and the client reads them first, with AniList still the fallback underneath.

### 2026 · 08 | Ingestion backbone ✅ shipped
`ingest.mjs` runs every two hours, refreshes whichever season the catalog holds the stalest copy of, normalizes each show into a versioned canonical schema and archives the raw payload — all through a shared retry and rate-limit budget, all in Netlify Blobs, with no database provisioned. ANN, TMDB and studio feeds have adapter stubs returning `{skipped:true}` so they have somewhere to land without reshaping the orchestrator.

**What's left in this slot**: make one stub real, and prove the orchestrator holds when a source is down mid-run and a second contradicts the first.

### 2026 · 09 | Entity-resolution engine 🚀
Merge the same show across every source into one canonical record — fuzzy title/season/staff matching, dedupe, and review tooling for the ambiguous cases machines can't call.

### 2026 · 10 | Confidence & conflict resolution ◐ partly built
One source pair already does this properly: the Crunchyroll ingest scores title-match confidence *and* requires a clear margin over the runner-up, refuses values outside a plausibility band, cancels two observations that disagree and flags them for a human, and stamps every written rule with `source` and `verifiedAt`.

**What's left**: generalize it. Per-field provenance across every source rather than one scraper's bespoke rules, a confidence model that isn't re-invented per adapter, and a rules engine that turns a three-way disagreement into the single time the calendar shows.

### 2026 · 11 | Historical backfill
Reconstruct 20+ years of airing history into the new schema, reconciling gaps and errors across sources, to power trends, "on this day" and analytics.

### 2026 · 12 | Real-time change detection 🚀
Detect schedule changes within minutes — a diffing pipeline, change-event stream and delay/cancellation alerts — so followers hear about a slip before it airs.

### 2027 · 01 | Data-quality console ◐ partly built
`/admin` already turns a reader report into a correction in one click — exact time, delay, break or show-wide offset rule, with the JSON patch previewed, written to the live store and the report marked `applied` in the same action. The datetime field self-seeds from `/api/v1/anime/{id}` so a maintainer edits the real current value.

**What's left** is the half that scales: automated anomaly detection finding the problems nobody reported (impossible dates, missing episodes, a season that lost half its entries overnight), audit trails, and a correction workflow that works with more than one maintainer.

### 2027 · 02 | Public data API + CDN ✅ shipped early
`/api/v1` has served the corrected dataset keyless and CORS-open since Aug 2026, documented at `/api/`. Seasons are cached per instance, concurrent misses collapse into one upstream fetch, a stale copy is served in preference to a 503, and responses are CDN-cached five minutes on top. The reason it exists rather than pointing people at AniList: every response carries the release variants and the correction layer, which AniList has no way to express.

**What's left in this slot**: the parts that make it a contract rather than an endpoint — a versioned schema consumers can depend on, keys and rate tiers, published SLA targets, and a deprecation policy.

### 2027 · 03 | Observability & SLOs 🚀
Full telemetry, tracing and alerting across ingestion and serving, with SLOs, error budgets and on-call runbooks — the calendar becomes something trustworthy 24/7.

### 2027 · 04 | Offline-first client core
Rebuild the web client on a local-first data layer with background sync and a service-worker cache, so the whole app works offline and paints instantly.

### 2027 · 05 | Web-vitals program
A sustained performance effort — code-splitting, streaming render, an image pipeline and edge caching — to hit top-tier Core Web Vitals on low-end mobile site-wide.

### 2027 · 06 | Accessibility & i18n foundation 🚀
WCAG 2.2 AA across the app plus the internationalization framework (string extraction, ICU messages, RTL) the next decade of languages depends on.

### 2027 · 07 | Platform hardening
Load-test the pipeline to 10× current traffic, add regional read replicas, backups and disaster recovery, and document the platform end to end.

---

## Year 2: Aug 2027 – Jul 2028 · Accounts, Sync & Trust (v4.x)

**Focus**: Give millions of anonymous users a real, secure, synced identity — and the safety infrastructure to support it.

### 2027 · 08 | Identity service ◐ partly built
Discord OAuth, a signed-cookie session (HMAC-SHA256 over the payload, `HttpOnly; Secure; SameSite=Lax`, ninety days) and a grant lookup deliberately kept *out* of the token — so a skin granted five minutes ago reaches someone who signed in last month — all ship today. But it is identity and nothing else: sign-in exists so an event skin can find the account it was granted to, and no part of a user's library sits behind it.

**What's left**: passkeys, more than one provider, device management and session revocation. The version that can hold someone's data and survive a security review, not the version that can name them.

### 2027 · 09 | CRDT sync engine 🚀
A conflict-free cross-device sync engine for lists, progress and settings — offline edits, causal merge and a clean migration path off localStorage.

### 2027 · 10 | Anonymous → account migration
Move the existing localStorage-only user base into accounts with zero data loss — linking, merge-conflict UX and a reversible, staged rollout.

### 2027 · 11 | External library sync ◐ partly built
AniList two-way sync ships today, entirely in the browser: OAuth implicit grant (the code flow was rejected deliberately — it needs a secret, a secret needs a server), pull is AniList-wins, push is local-wins, nothing is ever deleted remotely, and a queue that survives a reload runs one write per ~2.2s with 429 backoff, dropping a permanently failing show rather than wedging.

**What's left**: MyAnimeList, catalog mapping between the two, and moving sync server-side so it keeps running when no tab is open.

### 2027 · 12 | Privacy, security & compliance 🚀
A real security program — threat model, third-party pen-test, encryption at rest, retention policy — plus GDPR/CCPA export and delete built into the platform.

### 2028 · 01 | Lists & taxonomy service
A flexible lists/collections system — statuses, custom lists, tags, notes, ratings — with a shareable data model, bulk operations and server-side versioning.

### 2028 · 02 | Notifications platform ◐ partly built
Web push works end to end — VAPID, a scheduled sender every fifteen minutes, per-show follows with a lead time and an `airType`, subscriptions in Netlify Blobs pruned automatically on 404/410, and a `dry=1` probe so a quiet pipeline can be interrogated rather than guessed at. A configuration failure answers `ok:false` with a reason instead of a 500, because a 500 every fifteen minutes is an alarm that teaches you to ignore alarms.

**What's left**: one channel with one message shape is not a platform. Email, digests, scheduling, per-user preferences and quiet hours, delivery tracking and retries — one service every alert Tsuzuki sends goes through.

### 2028 · 03 | Stats pipeline & Wrapped 🚀
An analytics pipeline turning your history into stats, streaks and a shareable seasonal "Wrapped," computed server-side at scale.

### 2028 · 04 | Content model & show page 2.0
A richer content model — staff, relations, streaming, reviews — behind a rebuilt show experience with real editorial and structured-data depth.

### 2028 · 05 | Theming & design-system engine ✅ shipped early
The skin engine landed Aug 2026 and went further than this slot asked. A theme carries a thirteen-variable palette plus `font`, `shape`, `effects` and five art layers, all painted in one fixed `#skinLayers` stacking context so nothing else has to be re-stacked. Motifs and ornaments are generated SVG inlined as `data:` URIs — no host to go down, no dead link in six months. The set is committed JSON served through `/api/themes`, so **a new skin costs no deploy**, with an editor and a grant flow in `/admin`.

**What's left in this slot**: the other half of the heading — a shared component library, and tokens that survive leaving the browser for the native clients in Year 5.

### 2028 · 06 | Abuse & account safety 🚀
Rate limiting, bot detection and account-takeover protection — the unglamorous infrastructure that lets everything social ship without getting overrun.

### 2028 · 07 | Scale & unit economics
Re-architect hot paths, add caching tiers and autoscaling, and drive down per-user cost so accounts stay sustainable at millions of users.

---

## Year 3: Aug 2028 – Jul 2029 · Discovery ML Platform (v5.x)

**Focus**: Build a genuine machine-learning platform for recommendations and search — pipelines, models, evaluation and experimentation.

### 2028 · 08 | Event & feature pipeline
An events pipeline capturing implicit and explicit signals into a feature store — the data foundation every model this year trains on.

### 2028 · 09 | Taste embeddings + on-device inference 🚀
Train show and user embeddings and ship a privacy-preserving on-device recommender, with cold-start handling and an offline evaluation harness.

### 2028 · 10 | Ranking & experimentation platform
A server-side ranking service plus an A/B experimentation framework — assignment, metrics, guardrails — so recommendations improve by evidence, not taste.

### 2028 · 11 | Semantic search
A vector index over the catalog with a natural-language query layer, hybrid lexical-plus-semantic ranking and typo tolerance.

### 2028 · 12 | Personalized season model 🚀
A ranked-for-you season model blending hype signals, taste and social proof — with trailers and one-tap follow — retrained each season.

### 2029 · 01 | Similarity graph
A content-plus-behavior similarity graph — "more like this," staff and studio lineages — with tunable dials, served at low latency.

### 2029 · 02 | Media pipeline (trailers/art)
An ingestion, transcoding and CDN pipeline for trailers and artwork — autoplay reels, PV history and rights-aware handling.

### 2029 · 03 | Streaming availability graph 🚀
Build and continuously refresh a per-region "where to watch" graph across services, with price and free-vs-sub status.

### 2029 · 04 | Dub & regional-release modeling ◐ partly built
Release variants already exist and are the product's whole argument: one AniList airing node fans out into `raw` / `sub` / `dub`, with a human correction layer over the top and offsets measured continuously off Crunchyroll's published calendar (the measured spread is 0–63 minutes, so the naive "simulcast lands with the broadcast" assumption is wrong for most shows). `dub` is never estimated — no data means no row, because an invented dub date is worse than none. Alerts resolve through the same path.

**What's left**: the *regional* half, which has no version at all. Availability and premieres modelled per country rather than per platform, with their own schedules — and the client/server duplication (`schedule-overrides.mjs` mirrors the client by hand) collapsed into one implementation.

### 2029 · 05 | Source-adaptation graph
Link every adaptation to its manga or light-novel source with chapter-level coverage mapping, powering "read on from here."

### 2029 · 06 | Cross-media franchise graph 🚀
A unified franchise knowledge graph across anime, film, ONA and manga, with computed watch/read order and gap detection.

### 2029 · 07 | Recsys quality & safety
Bias and quality audits, feedback loops, "why am I seeing this," and guardrails against filter bubbles and NSFW leakage.

---

## Year 4: Aug 2029 – Jul 2030 · Social Graph at Scale (v6.x)

**Focus**: A real-time social platform — feeds, UGC and community — with trust and safety engineered for premiere-night scale.

### 2029 · 08 | Social graph service
A follow/friend graph service with privacy scopes, blocking and a fan-out-capable design that can feed millions of timelines.

### 2029 · 09 | Ranked activity feed 🚀
A real-time, ranked activity feed on a hybrid fan-out architecture, with relevance ranking and abuse-resistant delivery.

### 2029 · 10 | UGC platform
Backend for reviews, ratings and threaded comments — edit history, spoiler tagging and structured-data output for SEO.

### 2029 · 11 | Real-time watch parties
Synced countdowns and live reaction threads over a real-time transport, holding up across thousands of concurrent rooms.

### 2029 · 12 | Trust & safety platform 🚀
ML spam/abuse classification plus human moderation ops — queues, appeals, policy — because social at scale lives or dies on this.

### 2030 · 01 | Collaborative lists
Shared, role-based lists with real-time co-editing and conflict resolution, built on the sync engine.

### 2030 · 02 | Clubs & communities
Group spaces — genre and studio clubs — with their own feeds, membership, events and discovery.

### 2030 · 03 | Reputation & anti-gaming 🚀
Achievements, reputation and leaderboards with real anti-gaming — sybil resistance and signal weighting — so contribution actually means something.

### 2030 · 04 | Air-time scale
Survive premiere-night comment spikes: sharding, backpressure, rate control and live moderation, so finale nights don't fall over.

### 2030 · 05 | Community data contributions ◐ partly built
The intake exists: a ⚠ report button in every show's details, length-capped and keyed by show + episode + a hash of the reporter's IP so one person can't flood the queue, feeding a maintainer who clears it in `/admin`.

**What's left**: everything past one maintainer — review and consensus between contributors, contribution history and standing, telling a reporter what happened to their report, and a path back into the ingestion platform rather than only into the override store.

### 2030 · 06 | Embed & syndication platform 🚀 · ◐ partly built
`site/embed/` ships a self-contained iframe of the next few days, `days` and `limit` params, fetched client-side so it is never stale and never needs a rebuild — and every placement is a backlink.

**What's left**: the platform. Theming-aware embeds of any list, profile or single show, sizing and performance budgets enforced rather than documented, and syndication for partner sites.

### 2030 · 07 | Community governance
Transparency reports, moderation metrics, guidelines and appeals — governance for a real community.

---

## Year 5: Aug 2030 – Jul 2031 · Native Everywhere (v7.x)

**Focus**: Real native platform engineering across six surfaces — phones, watches, TVs — on one shared core.

### 2030 · 08 | Shared core & mobile architecture
A cross-platform core — data, sync and domain logic — and the app architecture the native clients will all build on.

### 2030 · 09 | iOS app 🚀
A genuinely native iOS app — SwiftUI surfaces, background refresh, App Store review, TestFlight beta — not a webview in a shell.

### 2030 · 10 | Android app
A native Android app with Material design, background-sync workers and a Play Store launch.

### 2030 · 11 | Native push infrastructure
A push backend spanning APNs and FCM with per-user targeting, scheduling, batching and delivery analytics for every alert type.

### 2030 · 12 | Widgets & live activities 🚀
Home-screen widgets and iOS Live Activities / Android ongoing notifications for live episode countdowns.

### 2031 · 01 | Wearables
Apple Watch and Wear OS apps with complications and tiles, syncing independently of the phone.

### 2031 · 02 | Deep OS integration
System calendars, share sheets, Handoff and App Intents — the platform hooks that make Tsuzuki feel native.

### 2031 · 03 | Offline-first, everywhere 🚀
One offline-first sync engine shared across web and native, with background sync and conflict resolution proven on flaky mobile networks.

### 2031 · 04 | Voice & assistants
Siri, Google Assistant and App Intents so "what's airing today" and "next episode of X" work hands-free.

### 2031 · 05 | TV apps
Android TV and tvOS lean-back apps with a "now airing" experience and casting.

### 2031 · 06 | Apps 1.0 GA + release ops 🚀
General availability on every store, plus a real native release process — staged rollouts, crash monitoring and CI/CD for mobile.

### 2031 · 07 | Cross-platform parity & QA
Automated cross-platform test suites and a design-system bridge keeping six surfaces behaving as one product.

---

## Year 6: Aug 2031 – Jul 2032 · Business & API Platform (v8.x)

**Focus**: Make Tsuzuki financially sustainable and turn it into a platform others build on — billing, a real API, and partnerships.

### 2031 · 08 | Billing & entitlements
A payments and billing system — subscriptions, entitlements, tax, dunning, refunds — built to survive audits and the ugly edge cases.

### 2031 · 09 | Tsuzuki Premium 🚀
Launch Premium end-to-end — plans, paywall logic, receipts, cross-platform purchases — with a free tier that never compromises the core calendar.

### 2031 · 10 | Public API v2 (write + OAuth)
A first-class write API with OAuth scopes, rate tiers, quotas and versioning — a product, not an endpoint.

### 2031 · 11 | Developer platform & SDKs
A developer portal, official SDKs (JS, Python, Swift, Kotlin), a sandbox and an app-review process for third parties.

### 2031 · 12 | Integrations platform 🚀
A webhook and app framework powering first-party Discord/Notion/Google-Calendar apps and third-party ones alike.

### 2032 · 01 | B2B / organization accounts
Organization accounts with roles, SSO, billing and shared workspaces for fan sites and companies.

### 2032 · 02 | Studio/distributor portal
A portal for rights-holders to publish official schedules and metadata directly — the beginning of first-party data.

### 2032 · 03 | Data licensing & partnerships 🚀
License the authoritative dataset to partners with contracts, usage metering and SLAs — a real, contracted revenue line.

### 2032 · 04 | Ethical sponsorship system
A privacy-preserving, non-tracking sponsorship system with clear labeling and user controls.

### 2032 · 05 | Affiliate & commerce
Transparent affiliate stream/buy links with attribution and reporting, opt-out by design.

### 2032 · 06 | White-label platform 🚀
A self-serve white-label platform so partners can run Tsuzuki-powered calendars under their own brand.

### 2032 · 07 | Finance & transparency
Financial reporting, a public transparency and sustainability report, and unit economics that make the project durable.

---

## Year 7: Aug 2032 – Jul 2033 · Global Platform (v9.x)

**Focus**: Go truly global — a localization operation, region-aware data and rights, and multi-region infrastructure.

### 2032 · 08 | Localization ops pipeline
A translation-management pipeline — extraction, translation memory, vendor plus community, QA, continuous localization — the machine that ships 30 languages.

### 2032 · 09 | 20+ language launch 🚀
Full UI and content localization across 20-plus languages including CJK and RTL, with locale-aware formatting everywhere.

### 2032 · 10 | Region-aware data & rights
Model airing times, availability and rights per country — not just timezone — across the whole dataset.

### 2032 · 11 | Localized SEO at scale
Generate and maintain per-language SEO landing pages and sitemaps across the entire catalog.

### 2032 · 12 | Multi-region infrastructure 🚀
Re-architect to multi-region active-active — data locality, latency-based routing and regional failover.

### 2033 · 01 | Community translation platform
A platform for fans to translate and review Tsuzuki itself, feeding straight into the localization pipeline.

### 2033 · 02 | Global payments & pricing
Local currencies, purchasing-power pricing, regional payment methods and worldwide tax handling.

### 2033 · 03 | Global compliance & privacy 🚀
Meet GDPR, CCPA, APPI and regional regimes with a privacy center, data residency and automated data-subject requests.

### 2033 · 04 | Regional charts & culture
Country-specific trending, charts and editorial that respect regional fandoms rather than flattening them.

### 2033 · 05 | Localized accessibility
Localized screen-reader support, audio descriptions and accessibility QA in every language.

### 2033 · 06 | Localized lifecycle & growth 🚀
Localized push, digests and onboarding across regions, measured and tuned per-locale.

### 2033 · 07 | Global scale & resilience
Chaos testing, capacity planning and cost optimization for a globally distributed, always-on platform.

---

## Year 8: Aug 2033 – Jul 2034 · Industry Integrations (v10.x)

**Focus**: Plug into where anime is actually watched, made and sold — streaming, studios and the wider industry.

### 2033 · 08 | Streaming integration framework
A framework to integrate streaming services — auth, catalog mapping and playback-state where their APIs allow.

### 2033 · 09 | Cross-service "continue watching" 🚀
Real cross-service resume that tracks playback progress and deep-links to the exact episode where you stopped.

### 2033 · 10 | Cast & living-room
Chromecast and AirPlay casting and a living-room "now airing" experience.

### 2033 · 11 | Calendar ecosystem (2-way)
Production-grade two-way sync with Google, Apple and Outlook, including updates, cancellations and recurrence.

### 2033 · 12 | Creator / studio platform 🚀
A first-party platform where verified studios publish official schedules, announcements and assets — cutting reliance on scrapers.

### 2034 · 01 | Verification & rights management
Verified accounts, ownership/claim flows and rights management for titles.

### 2034 · 02 | Official announcement network
An official announcements feed from rights-holders, distributed to followers and show pages.

### 2034 · 03 | Events & ticketing 🚀
Integrate theatrical screenings, premieres and conventions with tickets, maps and reminders.

### 2034 · 04 | Commerce calendar
Track home-video, soundtrack and merch releases with retailer integrations.

### 2034 · 05 | Extension runtime
A sandboxed plugin runtime so developers can extend the app safely, without risking users' data.

### 2034 · 06 | Plugin SDK + marketplace 🚀
General availability of the extension platform, with review, payments and distribution.

### 2034 · 07 | Partner analytics
A B2B analytics product for studios — reach, follows, engagement — built on privacy-safe aggregates.

---

## Year 9: Aug 2034 – Jul 2035 · Applied AI (v11.x)

**Focus**: Serious, safe AI — grounded models, generation pipelines, and the evaluation and guardrails to ship them responsibly.

### 2034 · 08 | Recap-generation pipeline
A grounded recap pipeline — retrieval, generation, fact-checking and human review — producing per-show summaries you can actually trust.

### 2034 · 09 | Spoiler-safe "Catch me up" 🚀
Recaps bounded to your exact progress, gated by a spoiler-safety model and evaluation — hard, because being wrong once ruins the show.

### 2034 · 10 | Predictive scheduling models
Train models that predict delays, breaks and schedule shifts from historical patterns, with calibrated confidence.

### 2034 · 11 | Planning & optimization
A watch-planner that optimizes your week against real constraints — time, mood, group — with reminders.

### 2034 · 12 | Agentic assistant 🚀 · ◐ partly built
This one arrived eight years early. `chat.mjs` answers over SSE, grounded in the corrected schedule through tool calls, and falls back to Google Search for anything the calendar doesn't hold.

**What's left** is precisely why this was a Year 9 slot rather than a weekend: guardrails, evaluation against a real question set, abuse protection and cost control, and grounding in *your* data rather than only the catalog. An assistant that answers confidently and wrong about an air time is worse than no assistant, because the whole product is being right about air times.

### 2035 · 01 | Generative seasonal media
Auto-generated seasonal video and podcast digests, produced through a human-in-the-loop review pipeline.

### 2035 · 02 | Sentiment & hype modeling
Aggregate social and press signals into per-show sentiment and hype, with source weighting and manipulation resistance.

### 2035 · 03 | App-wide spoiler protection 🚀
A vision-plus-text spoiler-detection system that blurs art, titles and discussion beyond your progress, everywhere.

### 2035 · 04 | Adaptive interface
An interface that adapts layout and surfaces to learned habits, measured against real engagement and satisfaction.

### 2035 · 05 | Accessibility AI
Auto-generated alt text and audio descriptions, quality-gated and on by default.

### 2035 · 06 | On-device recs 2.0 + privacy 🚀
Next-gen private, on-device models with federated signals and formal privacy guarantees.

### 2035 · 07 | AI safety & evaluation
Robustness testing, failure-mode analysis, and formal properties guarantees for all AI systems.

---

## Year 10: Aug 2035 – Jul 2036 · Open Platform (v12.x)

**Focus**: Open ecosystem — federation, data ownership, extensibility and independence from any single platform.

### 2035 · 08 | Federation & interop framework
An interop layer that lets Tsuzuki sync with other anime communities and aggregators on open standards.

### 2035 · 09 | User data portability 🚀
Export and import your full profile, lists and history to compete with or switch to other platforms.

### 2035 · 10 | Community governance 2.0
Formal governance structures, user councils and transparent decision-making around major changes.

### 2035 · 11 | Self-hosted option
A self-hosted, self-contained version of the backend that communities can run independently.

### 2035 · 12 | Non-profit transition 🚀
A transition to a non-profit or public-benefit structure with long-term sustainability independent of any founder.

### 2036 · 01 | Open-source core
Release the core sync, data and recommendation engines under a permissive open-source license.

### 2036 · 02 | Academic research program
Partner with universities on anime recommendation, schedule prediction and community dynamics research.

### 2036 · 03 | Sustainability fund 🚀
A fund from data licensing, partnerships and premium features that supports the long-term mission.

### 2036 · 04 | Interop conformance suite
A test suite and reference client for the open protocols, so "works with Tsuzuki" is something a third party can verify rather than claim.

### 2036 · 05 | Operations handover
Documented runbooks, funded infrastructure and more than one person able to operate every system — the unglamorous work that decides whether a decade outlives whoever started it.

### 2036 · 06 | Open platform 1.0 🚀
Federation, the open-source core, the self-hosted build and the governance model shipped together as one versioned release against a public specification.

### 2036 · 07 | Decade retrospective
Ten years in: a public roadmap check, what landed vs what changed, and the next horizon.

---

## Notes

A roadmap is a hypothesis, not a contract — scope and dates flex with reality. What holds is the **shape**: ten hard programs, each built one monthly milestone at a time, the flagships timed to the seasons, and every notable change announced in the app.

**On the twelve overtaken slots.** The first revision of this document was written before a month of building moved twelve milestones — one of them by eight years. The response was not to congratulate the calendar and delete them. Every one of those slots described a *system*, and what shipped was a working *instance*: an API with no versioning contract, an identity service that holds no data, an assistant with no evaluation. The month stays; it now buys the difference. If a future revision finds another slot overtaken, do the same thing — rewrite what the month is for, and resist the temptation to declare a year finished because its demo works.

**On what shipping early actually proved.** The rescoped entries share a pattern worth naming: the easy 80% of a platform milestone is now a weekend, and the remaining 20% — provenance, evaluation, revocation, SLAs, the behaviour when a source contradicts another — is still the year it always was. Plan the later years on that assumption.

---

*Tsuzuki · 120 milestones · 10 programs · Aug 2026 → Jul 2036 · rescoped Aug 2026*
