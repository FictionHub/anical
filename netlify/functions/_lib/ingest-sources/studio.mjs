// Studio-feed adapter — stub. The roadmap calls for pulling studio feeds
// directly (announcements, official schedules), but that needs a curated list
// of studio RSS/JSON endpoints, which doesn't exist yet. Returning the same
// { source, raw, media, skipped, reason } shape as every other adapter so the
// orchestrator in ingest.mjs never has to special-case an unimplemented source.
export async function ingestStudios() {
  return { source: "studios", raw: [], media: [], skipped: true, reason: "no studio feed list configured yet" };
}
