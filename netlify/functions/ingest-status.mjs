// GET /api/ingest/status — latest ingestion run summary (per-source counts,
// errors, timing). A minimal readout to see the ingestion backbone is actually
// running, well ahead of the full data-quality console (2027·01 milestone).
import { getStore } from "@netlify/blobs";

export default async () => {
  const runsStore = getStore("ingest-runs");
  const latest = await runsStore.get("latest", { type: "json" }).catch(() => null);
  if (!latest) {
    return new Response(JSON.stringify({ ok: true, runs: 0, message: "No ingestion run yet." }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(latest, null, 2), { headers: { "Content-Type": "application/json" } });
};
