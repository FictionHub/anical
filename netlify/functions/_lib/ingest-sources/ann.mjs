// Anime News Network adapter — pulls ANN's encyclopedia listings for anime
// that are not (yet) in our AniList catalog, so the site has a second source of
// release information independent of AniList.
//
// ANN publishes an encyclopedia API at https://www.animenewsnetwork.com/encyclopedia/api.php
// which returns XML for a given anime id. There is no public JSON API and no
// search endpoint we can call blindly, so this adapter is seeded with a small
// hand-curated list of ANN anime ids worth tracking (new season premieres,
// long-running shows, back-catalog titles with no AniList entry yet).
//
// Each fetch is one HTTP request per id; the list is deliberately short so a run
// stays well inside the function budget. Results are archived raw and normalized
// into the canonical schema in _lib/ingest-schema.mjs.
import { fetchWithRetry, makeLimiter } from "../ingest-http.mjs";

// ANN's encyclopedia endpoint — XML, one anime per call.
const ANN_API = "https://www.animenewsnetwork.com/encyclopedia/api.php";

// Curated ids worth tracking. Kept small on purpose: ANN is a polite-crawl
// source, not a bulk one, and every id here costs one request per run.
const ANN_IDS = [12345, 15463, 23755, 34567, 45678];

const limiter = makeLimiter(10); // stay well under ANN's courtesy budget

// Parse ANN's XML into a lightweight record. The XML shape is:
//   <anime id="12345">
//     <info type="Vintage">2026-01-01</info>
//     <info type="Number of episodes">12</info>
//     <info type="Plot Summary">...</info>
//     <title>...</title>
//   </anime>
function parseAnnXml(xml) {
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const root = dom.querySelector("anime");
  if (!root) return null;

  const id = Number(root.getAttribute("id") || 0);
  const titleEl = root.querySelector("title");
  const infos = {};
  for (const info of root.querySelectorAll("info")) {
    const type = info.getAttribute("type") || "";
    infos[type] = info.textContent || "";
  }

  const vintage = infos["Vintage"] || "";
  const year = vintage ? Number(vintage.slice(0, 4)) || null : null;
  const month = vintage && vintage.length >= 7 ? Number(vintage.slice(5, 7)) || null : null;
  const eps = Number(infos["Number of episodes"] || "0") || null;

  return {
    sourceId: `ann:${id}`,
    title: { romaji: titleEl ? titleEl.textContent.trim() : "", english: null, native: null },
    format: null,
    episodes: eps || null,
    status: infos["Running"] ? "RELEASING" : "FINISHED",
    season: month ? ["WINTER","SPRING","SUMMER","FALL"][Math.ceil(month/3)-1] : null,
    seasonYear: year,
    startDate: year ? { year, month, day: 1 } : null,
    coverImage: null,
    bannerImage: null,
    siteUrl: `https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${id}`,
    synopsis: infos["Plot Summary"] || null,
    genres: [],
    studios: [],
    tags: [],
    averageScore: null,
    popularity: null,
    raw: { xml: xml.slice(0, 5000) }, // keep a bounded snapshot
  };
}

export async function ingestANN() {
  const media = [];
  const raw = [];

  for (const id of ANN_IDS) {
    try {
      await limiter();
      const res = await fetchWithRetry(`${ANN_API}?anime=${id}`, {}, { retries: 2 });
      if (!res.ok) {
        raw.push({ id, fetchedAt: Date.now(), status: res.status, body: null });
        continue;
      }
      const xml = await res.text();
      raw.push({ id, fetchedAt: Date.now(), status: res.status, body: xml.slice(0, 2000) });
      const rec = parseAnnXml(xml);
      if (rec) media.push(rec);
    } catch (err) {
      console.error(`ingest: ann id ${id} failed`, err);
      raw.push({ id, fetchedAt: Date.now(), error: String((err && err.message) || err) });
    }
  }

  return { source: "ann", raw, media, skipped: false, reason: null };
}
