// Versioned canonical schema for the ingestion backbone (2026·08 decade-roadmap
// milestone). Every source adapter normalizes into this shape before it's merged
// into the "ingest-canonical" Blobs store, keyed by "<source>:<sourceId>" today
// and re-keyed onto a resolved canonical id once entity resolution (2026·09)
// lands. Bump SCHEMA_VERSION on any breaking shape change so a future migration
// pass can find every record still on an old version.
export const SCHEMA_VERSION = 1;

export function normalizeAniList(md) {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `anilist:${md.id}`,
    externalIds: { anilist: md.id },
    title: md.title || {},
    format: md.format || null,
    episodes: md.episodes ?? null,
    duration: md.duration ?? null,
    status: md.status || null,
    source: md.source || null,
    isAdult: !!md.isAdult,
    season: md.season || null,
    seasonYear: md.seasonYear || null,
    startDate: md.startDate || null,
    endDate: md.endDate || null,
    studios: ((md.studios && md.studios.nodes) || []).map(s => s.name),
    genres: md.genres || [],
    averageScore: md.averageScore ?? null,
    popularity: md.popularity ?? null,
    airingSchedule: ((md.airingSchedule && md.airingSchedule.nodes) || [])
      .map(n => ({ episode: n.episode, airingAt: n.airingAt })),
    coverImage: md.coverImage || null,
    bannerImage: md.bannerImage || null,
    siteUrl: md.siteUrl || null,
    // Per-field provenance: which source last wrote which fields, and when.
    // "*" means "everything not explicitly listed elsewhere". Real per-field
    // confidence scoring / conflict resolution across sources is 2026·10 work —
    // this is intentionally just enough structure for that pass to build on.
    provenance: { anilist: { fetchedAt: now, fields: ["*"] } },
    updatedAt: now,
  };
}

// Additive merge: a field already set by a higher-priority/earlier source is
// left alone; only gaps get filled by the incoming record. AniList is the only
// live source today, so this never actually has to arbitrate yet — it exists so
// ANN/TMDB/studio feeds have somewhere safe to land the moment they go live.
export function mergeRecord(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "provenance") { merged.provenance = { ...existing.provenance, ...v }; continue; }
    if (k === "externalIds") { merged.externalIds = { ...existing.externalIds, ...v }; continue; }
    if (v == null) continue;
    const cur = existing[k];
    if (cur == null || (Array.isArray(cur) && !cur.length)) merged[k] = v;
  }
  merged.schemaVersion = SCHEMA_VERSION;
  merged.updatedAt = Date.now();
  return merged;
}
