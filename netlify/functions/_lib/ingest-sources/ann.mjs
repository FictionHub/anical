// Anime News Network adapter — stub. ANN has no public JSON API; their data is
// either XML reports (encyclopedia dumps) or HTML. Real implementation needs a
// decision on which ANN feed to parse (and how to stay polite about request
// volume against a non-API source) — tracked for the same 2026·08/09 window as
// the rest of the ingestion backbone, just not blocking this scaffold.
export async function ingestANN() {
  return { source: "ann", raw: [], media: [], skipped: true, reason: "no public API — needs an XML/HTML parser, not yet implemented" };
}
