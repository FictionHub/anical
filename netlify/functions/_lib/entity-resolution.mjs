// Entity resolution — 2026·09 decade-roadmap milestone.
//
// Maps every external ID (AniList, TMDB, ANN, studio feeds) onto one canonical
// identity, so a show that appears in three sources is one record, not three.
//
// Stores (Netlify Blobs):
//   entity-resolution:<canonicalId>   — canonical record with all external IDs
//   entity-lookup:<source>:<sourceId> → canonicalId                  — reverse index
//
// Canonical ID is the AniList ID when we have one (it's the most complete
// source), otherwise a stable hash of the best-known title + year.
//
// Matching strategy, in order of confidence:
//   1. Exact external ID match (we already know this source's ID)
//   2. Title + year + season match against AniList records
//   3. Title + year fuzzy match (NFKD-folded, case-insensitive)
//   4. No match → new canonical identity
//
// Confidence per source per field:
//   high   = exact ID match or two sources agree
//   medium = single source, title+year confirmed
//   low    = single source, title only, year guessed

import { getStore } from "@netlify/blobs";
import { normalizeAniList, mergeRecord, SCHEMA_VERSION } from "./ingest-schema.mjs";

const RESOLUTION_STORE = "entity-resolution";
const LOOKUP_STORE = "entity-lookup";

// Canonical identity shape.
export function makeCanonicalRecord(canonicalId, externalIds, titles) {
  return {
    schemaVersion: SCHEMA_VERSION,
    canonicalId,
    externalIds,           // { anilist: 123, tmdb: 456, ann: 789, studio: [...] }
    titles,                // [{ source, romaji, english, native }, ...]
    confidence: {},        // { source: "high"|"medium"|"low", ... }
    primarySource: null,   // set after first resolution pass
    aliases: [],           // alternate titles discovered across sources
    lastResolved: Date.now(),
    updatedAt: Date.now(),
  };
}

// Reverse lookup key.
const lookupKey = (source, sourceId) => `${source}:${String(sourceId)}`;

// Read a canonical record by any external ID we've seen before.
export async function resolveByExternalId(source, sourceId) {
  const lookupStore = getStore(LOOKUP_STORE);
  const canonicalId = await lookupStore.get(lookupKey(source, sourceId), { type: "json" }).catch(() => null);
  if (!canonicalId) return null;

  const resolutionStore = getStore(RESOLUTION_STORE);
  return resolutionStore.get(String(canonicalId), { type: "json" }).catch(() => null);
}

// Store a canonical record and its reverse index entries.
export async function storeCanonicalRecord(record) {
  const resolutionStore = getStore(RESOLUTION_STORE);
  const lookupStore = getStore(LOOKUP_STORE);

  await resolutionStore.setJSON(String(record.canonicalId), record).catch(() => {});

  const promises = [];
  for (const [source, ids] of Object.entries(record.externalIds)) {
    const idList = Array.isArray(ids) ? ids : [ids];
    for (const id of idList) {
      promises.push(lookupStore.setJSON(lookupKey(source, id), String(record.canonicalId)).catch(() => {}));
    }
  }
  await Promise.all(promises);
}

// NFKD-fold a title for matching: strip accents, lowercase, collapse whitespace.
const foldTitle = s => String(s || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")
  .trim();

// Title similarity: Jaro-Winkler-lite via longest common substring ratio.
const lcs = (a, b) => {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let max = 0;
  const dp = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    let prev = 0;
    for (let j = 1; j <= m; j++) {
      const cur = dp[j];
      if (b[i - 1] === a[j - 1]) dp[j] = prev + 1;
      else dp[j] = 0;
      prev = cur;
      if (dp[j] > max) max = dp[j];
    }
  }
  return max / Math.max(m, n);
};

// Match a normalized record against an existing canonical record by title/year.
function titleMatchScore(rec, canon) {
  const recTitle = foldTitle(rec.title?.romaji || rec.title?.english || rec.title?.native || "");
  const recYear = rec.startDate?.year || rec.seasonYear || null;
  if (!recTitle) return 0;

  let best = 0;
  for (const t of (canon.titles || [])) {
    const canonTitle = foldTitle(t.romaji || t.english || t.native || "");
    if (!canonTitle) continue;
    const sim = lcs(recTitle, canonTitle);
    let score = sim * 0.8; // title similarity dominates

    // Year agreement is a strong tiebreaker.
    if (recYear && t.year) {
      score += recYear === t.year ? 0.15 : Math.abs(recYear - t.year) <= 1 ? 0.05 : -0.1;
    }
    if (recYear === (canon.seasonYear || null)) score += 0.05;

    if (score > best) best = score;
  }
  return best;
}

// Resolve a normalized record onto a canonical identity. Returns
// { canonicalId, record, matched: boolean, confidence: "high"|"medium"|"low" }.
export async function resolveMedia(md, allCanonicals = null) {
  const externalIds = { ...(md.externalIds || {}) };
  const sourceId = externalIds.anilist || externalIds.tmdb || externalIds.ann;

  // 1. Exact external ID match — already known.
  for (const [source, id] of Object.entries(externalIds)) {
    const ids = Array.isArray(id) ? id : [id];
    for (const i of ids) {
      const existing = await resolveByExternalId(source, i);
      if (existing) {
        return { canonicalId: existing.canonicalId, record: existing, matched: true, confidence: "high" };
      }
    }
  }

  // 2. Title + year + season match against existing canonicals.
  const canonicals = allCanonicals || await listCanonicals();
  let best = null;
  for (const canon of canonicals) {
    const score = titleMatchScore(md, canon);
    if (score > 0.75 && (!best || score > best.score)) {
      best = { canon, score };
    }
  }

  if (best && best.score >= 0.85) {
    // High confidence: title + year + season all line up.
    return { canonicalId: best.canon.canonicalId, record: best.canon, matched: true, confidence: "high" };
  }
  if (best && best.score >= 0.65) {
    // Medium confidence: title matches, year close but not certain.
    return { canonicalId: best.canon.canonicalId, record: best.canon, matched: true, confidence: "medium" };
  }

  // 3. No match → create new canonical identity.
  const canonicalId = externalIds.anilist ? `anilist:${externalIds.anilist}`
    : externalIds.tmdb ? `tmdb:${externalIds.tmdb}`
    : `canonical:${foldTitle(md.title?.romaji || md.title?.english || "unknown")}-${Date.now()}`;

  const titles = [];
  if (md.title) titles.push({ source: md.source || "unknown", romaji: md.title.romaji, english: md.title.english, native: md.title.native, year: md.startDate?.year || md.seasonYear });
  const record = makeCanonicalRecord(canonicalId, externalIds, titles);
  record.primarySource = md.source || "unknown";
  record.confidence = { [md.source || "unknown"]: "medium" };

  return { canonicalId, record, matched: false, confidence: "low" };
}

// List all canonical records (bounded). Used for matching candidates.
async function listCanonicals() {
  const store = getStore(RESOLUTION_STORE);
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const out = [];
  for (const b of blobs.slice(0, 500)) {
    const rec = await store.get(b.key, { type: "json" }).catch(() => null);
    if (rec) out.push(rec);
  }
  return out;
}

// Merge a source record onto its canonical identity, updating provenance.
export async function mergeIntoCanonical(md, { canonicalId, record, confidence }) {
  const resolutionStore = getStore(RESOLUTION_STORE);
  const now = Date.now();

  // Add this source's external ID.
  const externalIds = { ...(record && record.externalIds) || {} };
  const src = md.source || "unknown";
  const idVal = md.externalIds?.[src] || md.id;
  if (idVal) {
    const cur = externalIds[src];
    if (Array.isArray(cur)) {
      if (!cur.includes(idVal)) cur.push(idVal);
    } else if (cur !== idVal) {
      externalIds[src] = [cur, idVal].filter(Boolean);
    } else {
      externalIds[src] = idVal;
    }
  }

  // Add this source's title.
  const titles = [...(record && record.titles || [])];
  if (md.title) {
    titles.push({ source: src, romaji: md.title.romaji, english: md.title.english, native: md.title.native, year: md.startDate?.year || md.seasonYear });
  }

  const merged = {
    ...record,
    canonicalId,
    externalIds,
    titles,
    confidence: { ...(record && record.confidence || {}), [src]: confidence },
    primarySource: record?.primarySource || src,
    lastResolved: now,
    updatedAt: now,
  };

  await storeCanonicalRecord(merged);
  return merged;
}

// Normalize a record from any source into canonical shape with provenance.
export function normalizeSourceRecord(md, source) {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    id: `${source}:${md.externalIds?.[source] || md.id}`,
    externalIds: { ...(md.externalIds || {}), [source]: md.externalIds?.[source] || md.id },
    title: md.title || {},
    format: md.format || null,
    episodes: md.episodes ?? null,
    duration: md.duration ?? null,
    status: md.status || null,
    source: md.source || source,
    isAdult: !!md.isAdult,
    season: md.season || null,
    seasonYear: md.seasonYear || null,
    startDate: md.startDate || null,
    endDate: md.endDate || null,
    studios: md.studios || [],
    genres: md.genres || [],
    averageScore: md.averageScore ?? null,
    popularity: md.popularity ?? null,
    airingSchedule: md.airingSchedule || [],
    coverImage: md.coverImage || null,
    bannerImage: md.bannerImage || null,
    siteUrl: md.siteUrl || null,
    synopsis: md.synopsis || null,
    tags: md.tags || [],
    provenance: { [source]: { fetchedAt: Date.now(), fields: ["*"], confidence: "medium" } },
    updatedAt: Date.now(),
  };
  return base;
}

// What the resolution layer knows about a canonical ID.
export async function getCanonical(canonicalId) {
  const store = getStore(RESOLUTION_STORE);
  return store.get(String(canonicalId), { type: "json" }).catch(() => null);
}
