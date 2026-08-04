// Release-schedule overrides — the correction layer that sits on top of AniList.
//
// AniList's `airingSchedule` is the *Japanese TV broadcast* time. That is not
// what most people watch: a simulcast viewer wants the Crunchyroll/HIDIVE drop,
// a dub viewer wants a time AniList does not carry at all, and neither reflects
// the week a broadcast is pre-empted by a movie or a sports block.
//
// This module turns one AniList airing node into the *variants* that actually
// exist for that episode (raw / sub / dub), applying human corrections on top.
//
// It is mirrored by an inline copy in site/index.html (the client has no build
// step, so it can't import this file). Keep the two in sync — the shapes and
// the resolution order are the contract.
//
// Override document shape (see site/data/overrides.json for the shipped seed):
//
//   {
//     "version": 1,
//     "shows": {
//       "<anilistId>": {
//         // show-level rules: offset in minutes from the JP broadcast
//         "sub": { "offsetMin": 0,     "platform": "Crunchyroll" },
//         "dub": { "offsetMin": 20160, "platform": "Crunchyroll", "fromEpisode": 1 },
//         // per-episode exact times + status, both of which beat the rules
//         "episodes": {
//           "5": {
//             "sub": { "airingAt": 1754323600, "platform": "Crunchyroll" },
//             "status": { "kind": "delay", "shiftMin": 10080, "reason": "…" }
//           },
//           "6": { "status": { "kind": "break", "reason": "Broadcast break" } }
//         }
//       }
//     }
//   }
//
// status.kind:
//   "delay" — episode moved. `shiftMin` shifts every variant; an explicit
//             per-episode `airingAt` wins over the shift.
//   "break" — no episode this slot. Produces no playable variants at all, so it
//             never generates a countdown or a notification.
//   "early" — released ahead of the listed time (same fields as "delay").
//   "note"  — informational only; times are unchanged.

export const OVERRIDES_VERSION = 1;
export const AIR_TYPES = ["raw", "sub", "dub"];

const MIN = 60;

// Streaming platforms that simulcast close enough to the JP broadcast that
// "the sub lands around the broadcast time" is a useful estimate rather than a
// guess. Anything outside this list gets no estimated sub variant — we would
// rather show nothing than show a time we invented.
const SIMULCAST_SITES = new Set([
  "Crunchyroll", "HIDIVE", "Netflix", "Amazon Prime Video", "Hulu",
  "Disney Plus", "Bilibili TV", "Muse Asia", "Ani-One Asia", "YouTube",
]);

// Read the committed seed. It ships inside the function bundle via
// `included_files` in netlify.toml, so this is a disk read rather than the
// function fetching its own website over HTTP — no round trip, and no failure
// mode where a cold CDN or a mid-flight deploy silently drops every correction.
// The HTTP path stays as a fallback for any environment where the file wasn't
// bundled, and both are allowed to fail: corrections are additive.
export async function loadSeed(siteUrl) {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const roots = [process.cwd(), process.env.LAMBDA_TASK_ROOT, "/var/task"].filter(Boolean);
  for (const root of roots) {
    try { return JSON.parse(await readFile(join(root, "site", "data", "overrides.json"), "utf8")); }
    catch { /* try the next root */ }
  }
  if (siteUrl) {
    try {
      const r = await fetch(`${siteUrl}/data/overrides.json`);
      if (r.ok) return await r.json();
    } catch { /* fall through */ }
  }
  console.warn("overrides: seed not found on disk or over HTTP — live store only");
  return null;
}

export function showOverride(overrides, mediaId) {
  if (!overrides || !overrides.shows) return null;
  return overrides.shows[String(mediaId)] || null;
}

function inRange(rule, episode) {
  if (!rule) return false;
  if (rule.fromEpisode != null && episode < rule.fromEpisode) return false;
  if (rule.toEpisode != null && episode > rule.toEpisode) return false;
  return true;
}

function streamingSites(media) {
  return ((media && media.externalLinks) || [])
    .filter(l => l && l.type === "STREAMING" && l.site)
    .map(l => l.site);
}

// One AniList airing node -> the variants that exist for it.
// Returns { status, variants: [{ type, ts, exact, platform, estimated }] }.
// A "break" yields an empty variants array — callers should render the status
// instead of an episode row.
export function variantsFor(media, node, override) {
  const ov = override || null;
  const ep = node.episode;
  const epOv = (ov && ov.episodes && ov.episodes[String(ep)]) || null;
  const status = (epOv && epOv.status) || null;

  if (status && status.kind === "break") return { status, variants: [] };

  const shift = status && (status.kind === "delay" || status.kind === "early") && status.shiftMin
    ? status.shiftMin * MIN
    : 0;

  const variants = [];

  // raw — the JP broadcast. Always exists, always exact (it is the source of truth).
  const rawTs = (epOv && epOv.raw && epOv.raw.airingAt) || node.airingAt + shift;
  variants.push({ type: "raw", ts: rawTs, exact: true, estimated: false, platform: null });

  // sub — exact override, then show-level rule, then a simulcast estimate.
  if (epOv && epOv.sub && epOv.sub.airingAt) {
    variants.push({
      type: "sub", ts: epOv.sub.airingAt, exact: true, estimated: false,
      platform: epOv.sub.platform || (ov.sub && ov.sub.platform) || null,
    });
  } else if (ov && inRange(ov.sub, ep)) {
    variants.push({
      type: "sub", ts: rawTs + (ov.sub.offsetMin || 0) * MIN, exact: true, estimated: false,
      platform: ov.sub.platform || null,
    });
  } else {
    const site = streamingSites(media).find(s => SIMULCAST_SITES.has(s));
    if (site) variants.push({ type: "sub", ts: rawTs, exact: false, estimated: true, platform: site });
  }

  // dub — override data only. There is no honest way to estimate a dub date.
  if (epOv && epOv.dub && epOv.dub.airingAt) {
    variants.push({
      type: "dub", ts: epOv.dub.airingAt, exact: true, estimated: false,
      platform: epOv.dub.platform || (ov.dub && ov.dub.platform) || null,
    });
  } else if (ov && inRange(ov.dub, ep)) {
    variants.push({
      type: "dub", ts: rawTs + (ov.dub.offsetMin || 0) * MIN, exact: true, estimated: false,
      platform: ov.dub.platform || null,
    });
  }

  return { status, variants };
}

// Pick the variant a viewer with this preference should be alerted about /
// see first. Falls back through sub -> raw -> dub so a preference that has no
// data never silently drops the episode.
export function preferredVariant(variants, preferred) {
  if (!variants.length) return null;
  const order = [preferred, "sub", "raw", "dub"];
  for (const t of order) {
    const v = variants.find(x => x.type === t);
    if (v) return v;
  }
  return variants[0];
}

// Shallow-merge a live override document over the static seed, per show.
export function mergeOverrides(seed, live) {
  const out = { version: OVERRIDES_VERSION, shows: { ...((seed && seed.shows) || {}) } };
  for (const [id, rec] of Object.entries((live && live.shows) || {})) {
    const base = out.shows[id];
    out.shows[id] = base
      ? { ...base, ...rec, episodes: { ...(base.episodes || {}), ...(rec.episodes || {}) } }
      : rec;
  }
  out.updatedAt = (live && live.updatedAt) || (seed && seed.updatedAt) || null;
  return out;
}

// Reject anything that isn't a well-formed override document before it is
// written to the store — a malformed blob would break every client at once.
export function validateOverrides(doc) {
  if (!doc || typeof doc !== "object") return "not an object";
  if (!doc.shows || typeof doc.shows !== "object") return "missing shows{}";
  const ids = Object.keys(doc.shows);
  if (ids.length > 5000) return "too many shows (max 5000)";
  for (const id of ids) {
    if (!/^\d+$/.test(id)) return `show key "${id}" is not an AniList id`;
    const rec = doc.shows[id];
    if (!rec || typeof rec !== "object") return `show ${id} is not an object`;
    for (const t of ["sub", "dub"]) {
      const r = rec[t];
      if (r == null) continue;
      if (typeof r !== "object") return `show ${id}.${t} is not an object`;
      if (r.offsetMin != null && !Number.isFinite(r.offsetMin)) return `show ${id}.${t}.offsetMin is not a number`;
    }
    for (const [ep, e] of Object.entries(rec.episodes || {})) {
      if (!/^\d+$/.test(ep)) return `show ${id} episode key "${ep}" is not a number`;
      if (!e || typeof e !== "object") return `show ${id} episode ${ep} is not an object`;
      for (const t of AIR_TYPES) {
        if (e[t] && !Number.isFinite(e[t].airingAt)) return `show ${id} ep ${ep}.${t}.airingAt is not a unix time`;
      }
      if (e.status && !["delay", "break", "early", "note"].includes(e.status.kind)) {
        return `show ${id} ep ${ep} has unknown status.kind "${e.status.kind}"`;
      }
    }
  }
  return null;
}
