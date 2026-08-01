# AniCal · The Decade Plan

**Product & engineering roadmap · 2026 → 2036**

Ten years to grow a calendar into a platform.

A month-by-month plan to take AniCal from a thin AniList client to an independent anime-data platform, native apps, an ML discovery engine and an open ecosystem. Each month is one hard engineering milestone — most are a single step inside a year-long program — and the four flagships a year ship the week before a new anime season.

## Roadmap Stats
- **120** monthly milestones
- **10** year-long programs
- **40** seasonal flagships
- **v2 → v11** version arc

---

## Year 1: Aug 2026 – Jul 2027 · Own the Data (v2.x)

**Focus**: Stop being a thin AniList client — stand up an independent, authoritative anime-schedule platform and rebuild the client on it.

### 2026 · 08 | Ingestion backbone
Stand up the data backend — a versioned schema and resilient ingestion workers pulling AniList, ANN, TMDB and studio feeds on schedule, with retries, rate-limit budgeting and raw-payload archival.

### 2026 · 09 | Entity-resolution engine 🚀
Merge the same show across every source into one canonical record — fuzzy title/season/staff matching, dedupe, and review tooling for the ambiguous cases machines can't call.

### 2026 · 10 | Confidence & conflict resolution
When sources disagree on an air date, decide who's right: per-field provenance, confidence scoring and a rules engine so the calendar shows one time you can trust.

### 2026 · 11 | Historical backfill
Reconstruct 20+ years of airing history into the new schema, reconciling gaps and errors across sources, to power trends, "on this day" and analytics.

### 2026 · 12 | Real-time change detection 🚀
Detect schedule changes within minutes — a diffing pipeline, change-event stream and delay/cancellation alerts — so followers hear about a slip before it airs.

### 2027 · 01 | Data-quality console
An internal ops console with automated anomaly detection (impossible dates, missing episodes), correction workflows and audit trails to keep the dataset clean at scale.

### 2027 · 02 | Public data API + CDN
Serve the authoritative dataset through a cached, versioned public API behind a global CDN, with schema docs, keys and SLA targets.

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

## Year 2: Aug 2027 – Jul 2028 · Accounts, Sync & Trust (v3.x)

**Focus**: Give millions of anonymous users a real, secure, synced identity — and the safety infrastructure to support it.

### 2027 · 08 | Identity service
A production identity service — passkeys, OAuth providers, sessions and device management — built to survive a security review, not just render a login form.

### 2027 · 09 | CRDT sync engine 🚀
A conflict-free cross-device sync engine for lists, progress and settings — offline edits, causal merge and a clean migration path off localStorage.

### 2027 · 10 | Anonymous → account migration
Move the existing localStorage-only user base into accounts with zero data loss — linking, merge-conflict UX and a reversible, staged rollout.

### 2027 · 11 | External library sync
Bidirectional sync with AniList and MyAnimeList — mapping catalogs, reconciling progress both ways, and degrading gracefully through their outages.

### 2027 · 12 | Privacy, security & compliance 🚀
A real security program — threat model, third-party pen-test, encryption at rest, retention policy — plus GDPR/CCPA export and delete built into the platform.

### 2028 · 01 | Lists & taxonomy service
A flexible lists/collections system — statuses, custom lists, tags, notes, ratings — with a shareable data model, bulk operations and server-side versioning.

### 2028 · 02 | Notifications platform
A unified notification service: web push, email, scheduling, per-user preferences, quiet hours, delivery tracking and retries — powering every alert AniCal sends.

### 2028 · 03 | Stats pipeline & Wrapped 🚀
An analytics pipeline turning your history into stats, streaks and a shareable seasonal "Wrapped," computed server-side at scale.

### 2028 · 04 | Content model & show page 2.0
A richer content model — staff, relations, streaming, reviews — behind a rebuilt show experience with real editorial and structured-data depth.

### 2028 · 05 | Theming & design-system engine
A tokenized theming engine (palettes, fonts, density) and a shared component library that will keep web and the coming native apps in sync.

### 2028 · 06 | Abuse & account safety 🚀
Rate limiting, bot detection and account-takeover protection — the unglamorous infrastructure that lets everything social ship without getting overrun.

### 2028 · 07 | Scale & unit economics
Re-architect hot paths, add caching tiers and autoscaling, and drive down per-user cost so accounts stay sustainable at millions of users.

---

## Year 3: Aug 2028 – Jul 2029 · Discovery ML Platform (v4.x)

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

### 2029 · 04 | Dub & regional-release modeling
Model dub availability and premieres as first-class, region-aware entities distinct from sub, with their own schedules and alerts.

### 2029 · 05 | Source-adaptation graph
Link every adaptation to its manga or light-novel source with chapter-level coverage mapping, powering "read on from here."

### 2029 · 06 | Cross-media franchise graph 🚀
A unified franchise knowledge graph across anime, film, ONA and manga, with computed watch/read order and gap detection.

### 2029 · 07 | Recsys quality & safety
Bias and quality audits, feedback loops, "why am I seeing this," and guardrails against filter bubbles and NSFW leakage.

---

## Year 4: Aug 2029 – Jul 2030 · Social Graph at Scale (v5.x)

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

### 2030 · 05 | Community data contributions
Let the community fix and enrich the dataset through a review-and-consensus workflow that feeds back into the ingestion platform.

### 2030 · 06 | Embed & syndication platform 🚀
A theming-aware embed platform — profiles, lists, next-episode — plus syndication for partner sites, generating backlinks and reach.

### 2030 · 07 | Community governance
Transparency reports, moderation metrics, guidelines and appeals — governance for a real community.

---

## Year 5: Aug 2030 – Jul 2031 · Native Everywhere (v6.x)

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
System calendars, share sheets, Handoff and App Intents — the platform hooks that make AniCal feel native.

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

## Year 6: Aug 2031 – Jul 2032 · Business & API Platform (v7.x)

**Focus**: Make AniCal financially sustainable and turn it into a platform others build on — billing, a real API, and partnerships.

### 2031 · 08 | Billing & entitlements
A payments and billing system — subscriptions, entitlements, tax, dunning, refunds — built to survive audits and the ugly edge cases.

### 2031 · 09 | AniCal Premium 🚀
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
A self-serve white-label platform so partners can run AniCal-powered calendars under their own brand.

### 2032 · 07 | Finance & transparency
Financial reporting, a public transparency and sustainability report, and unit economics that make the project durable.

---

## Year 7: Aug 2032 – Jul 2033 · Global Platform (v8.x)

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
A platform for fans to translate and review AniCal itself, feeding straight into the localization pipeline.

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

## Year 8: Aug 2033 – Jul 2034 · Industry Integrations (v9.x)

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

## Year 9: Aug 2034 – Jul 2035 · Applied AI (v10.x)

**Focus**: Serious, safe AI — grounded models, generation pipelines, and the evaluation and guardrails to ship them responsibly.

### 2034 · 08 | Recap-generation pipeline
A grounded recap pipeline — retrieval, generation, fact-checking and human review — producing per-show summaries you can actually trust.

### 2034 · 09 | Spoiler-safe "Catch me up" 🚀
Recaps bounded to your exact progress, gated by a spoiler-safety model and evaluation — hard, because being wrong once ruins the show.

### 2034 · 10 | Predictive scheduling models
Train models that predict delays, breaks and schedule shifts from historical patterns, with calibrated confidence.

### 2034 · 11 | Planning & optimization
A watch-planner that optimizes your week against real constraints — time, mood, group — with reminders.

### 2034 · 12 | Agentic assistant 🚀
A grounded, tool-using assistant over your data and the catalog, with guardrails, evaluations and abuse protection.

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

## Year 10: Aug 2035 – Jul 2036 · Open Platform (v11.x)

**Focus**: Open ecosystem — federation, data ownership, extensibility and independence from any single platform.

### 2035 · 08 | Federation & interop framework
An interop layer that lets AniCal sync with other anime communities and aggregators on open standards.

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

### 2036 · 07 | Decade retrospective
Ten years in: a public roadmap check, what landed vs what changed, and the next horizon.

---

## Notes

A roadmap is a hypothesis, not a contract — scope and dates flex with reality. What holds is the **shape**: ten hard programs, each built one monthly milestone at a time, the flagships timed to the seasons, and every notable change announced in the app.

---

*AniCal · 120 milestones · 10 programs · Aug 2026 → Jul 2036*
