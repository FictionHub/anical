// Conflict resolution & confidence scoring — 2026·10 decade-roadmap milestone.
//
// When two sources disagree on a field (AniList says ep 5 airs at 18:00, TMDB
// says 18:30), we need to:
//   1. Detect the conflict
//   2. Score confidence per source per field
//   3. Pick a winner or mark as "conflicting" for human review
//
// Source priority (higher wins ties):
//   anilist  — titles, episodes, status, airing schedule (primary)
//   tmdb     — network/platform, alternate air dates, posters
//   ann      — English titles, announcements, vintage dates
//   studios  — announcements only, low confidence

export const SOURCE_PRIORITY = { anilist: 4, tmdb: 3, ann: 2, studios: 1 };

// Per-field source authority: which source is authoritative for which fields.
export const FIELD_AUTHORITY = {
  title: ["anilist", "tmdb", "ann"],
  episodes: ["anilist", "tmdb"],
  status: ["anilist"],
  airingSchedule: ["anilist"],
  averageScore: ["anilist", "tmdb"],
  popularity: ["anilist", "tmdb"],
  studios: ["anilist", "tmdb", "studios"],
  genres: ["anilist", "tmdb"],
  startDate: ["anilist", "tmdb", "ann"],
  endDate: ["anilist", "tmdb"],
  coverImage: ["anilist", "tmdb"],
  siteUrl: ["anilist", "tmdb"],
};

// Confidence levels.
export const CONFIDENCE = { HIGH: "high", MEDIUM: "medium", LOW: "low", CONFLICTING: "conflicting" };

// Score confidence for a single source's value on a field.
// Factors: source authority for the field, whether other sources agree,
// recency of the data.
export function scoreConfidence(source, field, value, allProvenance, allValues) {
  let score = 0.5; // base

  // Source authority for this field.
  const authorities = FIELD_AUTHORITY[field] || [];
  if (authorities.includes(source)) score += 0.2;
  const priority = SOURCE_PRIORITY[source] || 0;
  score += (priority / 4) * 0.2;

  // Agreement with other sources boosts confidence.
  const others = Object.entries(allValues || {}).filter(([s]) => s !== source);
  const agreeing = others.some(([, v]) => valuesEqual(v, value));
  if (agreeing) score += 0.2;

  // Recency: data fetched within 24h is more trustworthy.
  const prov = allProvenance?.[source];
  if (prov) {
    const age = Date.now() - (prov.fetchedAt || 0);
    if (age < 86400000) score += 0.1; // within a day
  }

  if (score >= 0.8) return CONFIDENCE.HIGH;
  if (score >= 0.6) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  if (typeof a === "object" && typeof b === "object" && a && b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// Detect conflicts between an existing record and an incoming record.
// Returns { conflicts: { field: { existing, incoming, sources } }, resolved: {} }.
export function detectConflicts(existing, incoming) {
  const conflicts = {};
  const resolved = {};

  const allFields = new Set([...Object.keys(existing || {}), ...Object.keys(incoming || {})]);
  for (const field of allFields) {
    if (field === "provenance" || field === "externalIds" || field === "updatedAt" || field === "schemaVersion" || field === "canonicalId") continue;

    const cur = existing?.[field];
    const inc = incoming[field];

    if (cur == null && inc == null) continue;
    if (cur == null) { resolved[field] = inc; continue; }
    if (inc == null) { resolved[field] = cur; continue; }

    if (valuesEqual(cur, inc)) {
      resolved[field] = cur;
      continue;
    }

    // Conflict detected.
    conflicts[field] = {
      existing: cur,
      incoming: inc,
      sources: Object.keys((existing && existing.provenance) || {}).concat(
        Object.keys((incoming && incoming.provenance) || {})
      ).filter((v, i, arr) => arr.indexOf(v) === i),
    };
  }

  return { conflicts, resolved };
}

// Resolve a conflict for a single field, picking the winner by source priority
// and confidence. Returns { winner, reason, confidence }.
export function resolveConflict(field, conflicts, provenance) {
  const conflict = conflicts[field];
  if (!conflict) return null;

  const candidates = [];
  for (const source of conflict.sources) {
    const conf = scoreConfidence(source, field,
      source === "existing" ? conflict.existing : conflict.incoming,
      provenance, {});
    candidates.push({ source, value: source === "existing" ? conflict.existing : conflict.incoming, confidence: conf });
  }

  // Sort by priority then confidence.
  candidates.sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] || 0;
    const pb = SOURCE_PRIORITY[b.source] || 0;
    if (pb !== pa) return pb - pa;
    const rank = { high: 3, medium: 2, low: 1 };
    return (rank[b.confidence] || 0) - (rank[a.confidence] || 0);
  });

  const winner = candidates[0];
  const hasConflict = candidates.length > 1 && candidates.some(c =>
    c.confidence === winner.confidence && SOURCE_PRIORITY[c.source] === SOURCE_PRIORITY[winner.source]
  );

  return {
    winner: winner.value,
    winnerSource: winner.source,
    confidence: winner.confidence,
    conflicting: hasConflict ? CONFIDENCE.CONFLICTING : null,
    reason: hasConflict ? "sources tied — needs human review" : `authority: ${winner.source}`,
  };
}

// Merge two records with conflict tracking.
// Returns { merged, conflicts: { field: { resolution, ... } } }.
export function mergeWithConfidence(existing, incoming) {
  if (!existing) return { merged: incoming, conflicts: {} };
  if (!incoming) return { merged: existing, conflicts: {} };

  const { conflicts, resolved } = detectConflicts(existing, incoming);
  const provenance = { ...existing.provenance, ...incoming.provenance };
  const conflictResolutions = {};

  for (const [field, conflict] of Object.entries(conflicts)) {
    const resolution = resolveConflict(field, conflicts, provenance);
    conflictResolutions[field] = resolution;
    resolved[field] = resolution.winner;
    // Record which source won and its confidence.
    if (!provenance[resolution.winnerSource]) provenance[resolution.winnerSource] = {};
    provenance[resolution.winnerSource].fields = provenance[resolution.winnerSource].fields || [];
    if (!provenance[resolution.winnerSource].fields.includes(field)) {
      provenance[resolution.winnerSource].fields.push(field);
    }
    provenance[resolution.winnerSource].confidence = resolution.confidence;
    if (resolution.conflicting) {
      provenance[resolution.winnerSource].conflict = true;
    }
  }

  const merged = {
    ...existing,
    ...resolved,
    provenance,
    updatedAt: Date.now(),
    schemaVersion: existing.schemaVersion || 1,
  };

  // Track unresolved conflicts for human review.
  const unresolved = Object.entries(conflictResolutions)
    .filter(([, r]) => r.conflicting)
    .map(([f]) => f);
  if (unresolved.length) {
    merged.unresolvedConflicts = unresolved;
  }

  return { merged, conflicts: conflictResolutions };
}

// Confidence summary for a canonical record — what can we trust?
export function confidenceSummary(record) {
  const prov = record && record.provenance || {};
  const out = { overall: "high", fields: {}, lowConfidence: [], conflicting: [] };

  for (const [source, p] of Object.entries(prov)) {
    const conf = p.confidence || "medium";
    if (conf === "low") out.lowConfidence.push(source);
    if (p.conflict) out.conflicting.push(source);
  }

  if (out.conflicting.length) out.overall = "conflicting";
  else if (out.lowConfidence.length) out.overall = "medium";

  return out;
}
