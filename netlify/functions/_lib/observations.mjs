// Per-region release observations — the first-party measurement network.
//
// WHY THIS EXISTS
// AniList publishes the Japanese broadcast time. The time a viewer actually
// gets an episode is that plus a per-show, per-platform, per-REGION offset, and
// no upstream source we can reach publishes it. The Crunchyroll calendar has it
// and is region-localised, but it is behind a bot challenge and only ever
// exposes releases that have already happened — so a capture taken before a
// slot can never measure it. Their private API is reachable but needs a
// credential that isn't ours to hold. A competitor's API would just move the
// dependency somewhere worse.
//
// What is left is the thing nobody else can copy: the people already watching.
// A viewer in Germany knows when episode 5 appeared in Germany. This turns that
// into data.
//
// WHAT MAKES AN OBSERVATION CHEAP TO COLLECT
// An offset is stable for a whole season — the scraper's own notes put it well:
// "a show measured once stays measured". So this needs roughly one confirmed
// observation per show, per air type, per region. Not a crawl. That is why a
// small user base can still cover the long tail the scrape keeps missing.
//
// SAFETY — this writes to a store every visitor reads, so the guards decide
// whether the feature is an asset or a vandalism surface:
//   • One observation per reporter per episode. Re-reporting overwrites your
//     own vote; it never adds a second one.
//   • MIN_OBSERVERS distinct reporters must agree before anything is derived.
//   • They must agree within AGREEMENT_MIN of each other, or the group is
//     treated as conflicting and derives nothing.
//   • The result must land inside the same plausibility band the scraper uses.
//   • The median is taken, not the mean, so one wild value cannot drag it.

// Mirrors BAND in scripts/ingest-crunchyroll.mjs. A simulcast lands within
// hours of broadcast; a dub within months. Outside these it is far likelier to
// be a mis-tap than a real value, and a confidently wrong time is worse than
// none.
export const BAND = {
  sub: { min: -10, max: 12 * 60 },
  dub: { min: 0, max: 120 * 24 * 60 },
  raw: { min: -10, max: 12 * 60 },
};

export const MIN_OBSERVERS = 3;    // distinct reporters before anything is derived
export const AGREEMENT_MIN = 15;   // they must fall inside this spread, in minutes
export const OBSERVATION_TTL_MS = 120 * 24 * 3600_000;   // stale votes stop counting

export const observationKey = (mediaId, episode, airType, region, reporter) =>
  `${mediaId}-${episode}-${airType}-${region}-${reporter}`;

export const groupKey = (mediaId, airType, region) => `${mediaId}|${airType}|${region}`;

export function inBand(airType, offsetMin) {
  const b = BAND[airType];
  if (!b) return false;
  return offsetMin >= b.min && offsetMin <= b.max;
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// Decide what a group of observations for one (show, airType, region) supports.
// Returns { status, offsetMin?, observers, spread, reason? } — never throws, and
// never returns an offset it would not be willing to publish.
export function deriveOffset(observations, now = Date.now()) {
  const fresh = observations.filter(o => now - (o.createdAt || 0) < OBSERVATION_TTL_MS);
  if (!fresh.length) return { status: "none", observers: 0, reason: "no fresh observations" };

  // One vote per reporter. A later observation from the same person replaces
  // their earlier one rather than counting twice.
  const byReporter = new Map();
  for (const o of fresh) {
    const prev = byReporter.get(o.reporter);
    if (!prev || (o.createdAt || 0) > (prev.createdAt || 0)) byReporter.set(o.reporter, o);
  }
  const votes = [...byReporter.values()];
  const offsets = votes.map(o => o.offsetMin).filter(Number.isFinite);

  if (offsets.length < MIN_OBSERVERS) {
    return { status: "pending", observers: offsets.length, needed: MIN_OBSERVERS, reason: "not enough independent observers yet" };
  }

  const spread = Math.max(...offsets) - Math.min(...offsets);
  if (spread > AGREEMENT_MIN) {
    // Genuine disagreement. Could be a staggered rollout, could be a bad actor.
    // Either way it is a question for a human, not something to publish.
    return { status: "conflicting", observers: offsets.length, spread, reason: `observers disagree by ${spread} min` };
  }

  const offsetMin = median(offsets);
  const airType = votes[0].airType;
  if (!inBand(airType, offsetMin)) {
    return { status: "out-of-band", observers: offsets.length, spread, offsetMin, reason: `${offsetMin} min is outside the plausible ${airType} band` };
  }

  return { status: "derived", offsetMin, observers: offsets.length, spread, airType };
}

// Turn derived groups into the region-scoped patch that /api/overrides accepts.
// Never touches a rule marked `pinned` — the escape hatch for a human decision
// this network would otherwise keep re-deriving.
export function buildRegionPatch(derivations, existing = {}) {
  const shows = {};
  const skipped = [];

  for (const d of derivations) {
    if (d.result.status !== "derived") { skipped.push({ ...d, why: d.result.reason }); continue; }
    const { mediaId, airType, region } = d;
    const cur = existing[mediaId] && existing[mediaId].regions && existing[mediaId].regions[region];
    const curRule = cur && cur[airType];
    if (curRule && curRule.pinned) { skipped.push({ ...d, why: "pinned — left alone" }); continue; }
    if (curRule && curRule.offsetMin === d.result.offsetMin) { skipped.push({ ...d, why: "unchanged" }); continue; }

    shows[mediaId] = shows[mediaId] || { regions: {} };
    shows[mediaId].regions[region] = shows[mediaId].regions[region] || {};
    shows[mediaId].regions[region][airType] = {
      offsetMin: d.result.offsetMin,
      source: `observations (${d.result.observers} reporters, spread ${d.result.spread}m)`,
      verifiedAt: new Date().toISOString(),
    };
  }

  return { patch: { shows }, skipped };
}
