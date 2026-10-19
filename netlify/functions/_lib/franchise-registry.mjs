// Franchise detection & clustering — 2026·05 Month 10, Day 275.
//
// Builds on getFranchise() (Day 274) which traverses the relation graph from a
// root show. This module clusters related entries into a single franchise with a
// stable identifier, so every entry of a known franchise lands in one cluster.
//
// Stores (Netlify Blobs):
//   franchise-registry:<franchiseId> — { franchiseId, name, members: [{ id, relationType, seasonYear, season }], rootId, updatedAt }
//   franchise-lookup:<anilistId> → franchiseId — reverse index for fast lookup
//
// Franchise ID format: "franchise:<anilistRootId>" — the root show's AniList ID
// is the stable identifier since it never changes.
//
// Detection strategy:
//   1. For each show in a season, check if it's already in a franchise (lookup)
//   2. If not, run getFranchise() from it and register all members
//   3. If a show is related to two existing franchises, merge them (rare)
//
// Runs as part of the ingest worker, one season per run.

import { getStore } from "@netlify/blobs";
import { getFranchise } from "./catalog.mjs";

const REGISTRY_STORE = "franchise-registry";
const LOOKUP_STORE = "franchise-lookup";

const franchiseKey = id => `franchise:${id}`;
const lookupKey = id => `lookup:${id}`;

// Register a single franchise in the registry.
export async function registerFranchise(franchise) {
  const registryStore = getStore(REGISTRY_STORE);
  const lookupStore = getStore(LOOKUP_STORE);

  await registryStore.setJSON(franchiseKey(franchise.franchiseId), {
    ...franchise,
    updatedAt: Date.now(),
  }).catch(() => {});

  const promises = franchise.members.map(m =>
    lookupStore.setJSON(lookupKey(m.id), franchise.franchiseId).catch(() => {})
  );
  await Promise.all(promises);
}

// Look up which franchise a show belongs to, if any.
export async function findFranchiseForShow(anilistId) {
  const lookupStore = getStore(LOOKUP_STORE);
  return lookupStore.get(lookupKey(anilistId), { type: "json" }).catch(() => null);
}

// Get all members of a franchise.
export async function getFranchiseMembers(franchiseId) {
  const registryStore = getStore(REGISTRY_STORE);
  return registryStore.get(franchiseKey(franchiseId), { type: "json" }).catch(() => null);
}

// List all franchises (bounded).
export async function listFranchises(limit = 200) {
  const registryStore = getStore(REGISTRY_STORE);
  const { blobs } = await registryStore.list().catch(() => ({ blobs: [] }));
  const out = [];
  for (const b of blobs.slice(0, limit)) {
    const rec = await registryStore.get(b.key, { type: "json" }).catch(() => null);
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Detect franchises across a list of shows. For each show not already in a
// franchise, traverse its relation graph and register. Returns stats.
export async function detectFranchises(mediaList) {
  let detected = 0, merged = 0, skipped = 0;

  for (const md of mediaList || []) {
    const id = String(md.id);
    if (!id) continue;

    // Skip if already in a known franchise.
    const existing = await findFranchiseForShow(id);
    if (existing) { skipped++; continue; }

    // Traverse the relation graph from this show.
    let franchise;
    try {
      franchise = await getFranchise(id, { maxNodes: 50, maxDepth: 6 });
    } catch (err) {
      console.error(`franchise: detection failed for ${id} —`, err.message);
      continue;
    }

    if (!franchise || !franchise.nodes || franchise.nodes.length < 2) {
      // Single show, not really a franchise. Skip.
      continue;
    }

    // Build member list.
    const members = franchise.nodes.map(n => ({
      id: n.id,
      relationType: n.relation || "root",
      seasonYear: n.seasonYear,
      season: n.season,
      title: n.title?.romaji || n.title?.english || "Unknown",
    }));

    // Check if any member already belongs to another franchise (merge case).
    let franchiseId = franchiseKey(id); // default: root show's ID
    for (const m of members) {
      const other = await findFranchiseForShow(m.id);
      if (other && other !== franchiseId) {
        franchiseId = other; // merge into existing
        merged++;
        break;
      }
    }

    const franchiseRec = {
      franchiseId,
      rootId: id,
      name: franchise.nodes.find(n => n.id === id)?.title?.romaji || franchise.nodes.find(n => n.id === id)?.title?.english || "Unknown Franchise",
      members,
      showCount: members.length,
      seasons: [...new Set(members.map(m => m.seasonYear).filter(Boolean))],
    };

    await registerFranchise(franchiseRec);
    detected++;
  }

  return { detected, merged, skipped };
}
