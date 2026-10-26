// Curated source ids, overridable from the environment.
//
// ANN and TMDB both pull a small, hand-checked list of ids rather than crawling
// a catalog. Keeping the list in code makes it reviewable, but it also meant an
// id that went dead — or a newly wanted show — needed a deploy to change. These
// two helpers let the same list be replaced from the Netlify UI:
//
//   ANN_IDS=12345/23755   TMDB_IDS=93405,130631
//
// The important half is what happens to bad input. A malformed id must never be
// sent upstream: ANN answers a bad id with a <warning> and a 200, so a typo
// would look like a healthy run that found nothing. Non-integers are dropped,
// duplicates collapse, and an explicitly empty value returns an empty list —
// which the adapters report as skipped with a reason instead of fetching an
// empty batch.
export function configuredIds(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const ids = String(raw)
    .split(/[\s,/]+/)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}
