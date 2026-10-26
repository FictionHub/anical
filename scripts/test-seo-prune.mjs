#!/usr/bin/env node
/* Checks over scripts/lib/seo-prune.mjs — the duplicate-page cleanup that runs
   after the SEO generator.

   The bug this prevents: the generator names a page after the show's CURRENT
   title, so a retitled show leaves yesterday's directory behind. Both pages
   claim to be canonical for the same AniList id; the stale one keeps ranking
   with older data and nothing ever removes it. The prune has exactly one job:
   delete the duplicate that this build did NOT produce, 301 it to the one this
   build did, and leave every ambiguous case alone — a wrong guess deletes the
   page Google is showing.

   Run with: npm run prune:test */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugId, supersedeStalePages, pruneSeoPages, writeRedirects, BLOCK_START, BLOCK_END } from "./lib/seo-prune.mjs";

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok   ${name}`))
    .catch(e => { failures++; console.log(`  FAIL ${name}\n         ${e.message}`); });
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);

// A throwaway site/ with the given page directories. Each is a real generated
// page (one index.html) unless listed in `empty`.
async function fixture(groups) {
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-prune-"));
  for (const [group, names] of Object.entries(groups)) {
    for (const name of names) {
      const page = join(dir, group, name);
      await mkdir(page, { recursive: true });
      if (name !== "empty") await writeFile(join(page, "index.html"), "<html></html>");
    }
  }
  return dir;
}
const exists = async p => { try { await readFile(p); return true; } catch { return false; } };

console.log("slugId");
await check("reads the AniList id off a generated slug", () => {
  eq(slugId("kaiju-girl-caramelise-204466"), "204466");
  eq(slugId("one-piece-heroines-197178"), "197178");
});
await check("returns null when there is no id to read", () => {
  eq(slugId("anime"), null);
  eq(slugId("spring-2026"), "2026"); // matches the shape; only generated groups are ever scanned
  eq(slugId(""), null);
  eq(slugId(undefined), null);
});

console.log("supersedeStalePages");
await check("removes the old slug and redirects it to the current one", async () => {
  const siteDir = await fixture({
    anime: ["kaiju-girl-caramelise-204466", "otome-kaijuu-caramelise-204466"],
  });
  try {
    const r = await supersedeStalePages({
      siteDir, group: "anime", keep: new Set(["kaiju-girl-caramelise-204466"]),
    });
    eq(r.removed, ["otome-kaijuu-caramelise-204466"]);
    eq(r.redirects, [{
      from: "/anime/otome-kaijuu-caramelise-204466/",
      to: "/anime/kaiju-girl-caramelise-204466/",
    }]);
    assert(await exists(join(siteDir, "anime", "kaiju-girl-caramelise-204466", "index.html")), "keeper must survive");
    assert(!(await exists(join(siteDir, "anime", "otome-kaijuu-caramelise-204466", "index.html"))), "stale page must be gone");
  } finally { await rm(siteDir, { recursive: true, force: true }); }
});
await check("leaves both pages alone when neither slug is in this build", async () => {
  const siteDir = await fixture({
    anime: ["old-title-198369", "older-title-198369"],
  });
  try {
    const r = await supersedeStalePages({ siteDir, group: "anime", keep: new Set(["something-else-1"]) });
    eq(r.removed, []);
    eq(r.redirects, []);
    eq(r.skipped.map(s => s.reason), ["no current slug"]);
    assert(await exists(join(siteDir, "anime", "old-title-198369", "index.html")), "must not delete on a guess");
  } finally { await rm(siteDir, { recursive: true, force: true }); }
});
await check("does nothing at all when the build produced no pages for the group", async () => {
  const siteDir = await fixture({ anime: ["a-old-1", "a-new-1"] });
  try {
    const r = await supersedeStalePages({ siteDir, group: "anime", keep: new Set() });
    eq(r.removed, []);
    eq(r.skipped, []);
    assert(await exists(join(siteDir, "anime", "a-old-1", "index.html")), "an empty keep set is a failed run, not a deletion order");
  } finally { await rm(siteDir, { recursive: true, force: true }); }
});
await check("apply:false reports the same plan without touching disk", async () => {
  const siteDir = await fixture({ anime: ["a-old-1", "a-new-1"] });
  try {
    const r = await supersedeStalePages({ siteDir, group: "anime", keep: new Set(["a-new-1"]), apply: false });
    eq(r.removed, ["a-old-1"]);
    assert(await exists(join(siteDir, "anime", "a-old-1", "index.html")), "dry run must not delete");
  } finally { await rm(siteDir, { recursive: true, force: true }); }
});
await check("refuses to delete a directory that is not a generated page", async () => {
  const siteDir = await fixture({ anime: ["a-new-1"] });
  // A same-id directory with no index.html is someone else's, not yesterday's
  // build output. Report it instead of deleting it.
  await mkdir(join(siteDir, "anime", "a-old-1"), { recursive: true });
  try {
    const r = await supersedeStalePages({ siteDir, group: "anime", keep: new Set(["a-new-1"]) });
    eq(r.removed, []);
    eq(r.skipped.map(s => s.reason), ["a-old-1 is not a generated page"]);
    eq(await readdir(join(siteDir, "anime")), ["a-new-1", "a-old-1"]);
  } finally { await rm(siteDir, { recursive: true, force: true }); }
});
await check("handles two groups in one pass", async () => {
  const siteDir = await fixture({
    anime: ["show-old-7", "show-new-7"],
    "where-to-watch": ["watch-old-7", "watch-new-7"],
  });
  try {
    const r = await pruneSeoPages({
      siteDir,
      groups: { anime: new Set(["show-new-7"]), "where-to-watch": new Set(["watch-new-7"]) },
    });
    eq(r.removed, ["anime/show-old-7", "where-to-watch/watch-old-7"]);
    eq(r.redirects.map(x => x.from), ["/anime/show-old-7/", "/where-to-watch/watch-old-7/"]);
  } finally { await rm(siteDir, { recursive: true, force: true }); }
});

console.log("writeRedirects");
await check("writes the block before hand-written rules (first match wins)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    await writeFile(file, "/* /index.html 200\n", "utf8");
    const r = await writeRedirects(file, [{ from: "/anime/old-1/", to: "/anime/new-1/" }]);
    const text = await readFile(file, "utf8");
    eq(r.count, 1);
    assert(text.startsWith(BLOCK_START), "managed block must come first");
    assert(text.includes("/anime/old-1/ /anime/new-1/ 301"), "redirect line missing");
    assert(text.includes("/* /index.html 200"), "hand-written rule was lost");
    assert(text.indexOf(BLOCK_END) < text.indexOf("/* /index.html"), "catch-all must stay after the 301s");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
await check("re-running keeps the old redirects and adds the new one", async () => {
  // The crucial case: the second build sees no stale page at all (the first
  // run deleted it), so it reports an empty plan. The 301 must survive anyway,
  // and a later prune of a different show must not erase it either.
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    await writeFile(file, "/* /index.html 200\n", "utf8");
    await writeRedirects(file, [{ from: "/anime/old-1/", to: "/anime/new-1/" }]);
    await writeRedirects(file, []);
    let text = await readFile(file, "utf8");
    assert(text.includes("/anime/old-1/ /anime/new-1/ 301"), "an empty plan must not clear a live redirect");

    await writeRedirects(file, [{ from: "/anime/old-2/", to: "/anime/new-2/" }]);
    text = await readFile(file, "utf8");
    assert(text.includes("/anime/old-1/ /anime/new-1/ 301"), "older redirect should survive");
    assert(text.includes("/anime/old-2/ /anime/new-2/ 301"), "new redirect should be added");
    eq((text.match(new RegExp(BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
    assert(text.includes("/* /index.html 200"), "hand-written rule was lost");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
await check("a live path cancels its redirect", async () => {
  // A retitle that is later reverted (or a slug that a newer build reuses) puts
  // the old directory back. Keeping the 301 would shadow the page that now
  // exists, so the rule goes.
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    await writeRedirects(file, [{ from: "/anime/old-1/", to: "/anime/new-1/" }]);
    const r = await writeRedirects(file, [], { live: new Set(["/anime/old-1/"]) });
    eq(r.count, 0);
    eq(r.written, false);
    assert(!(await exists(file)), "with nothing left to say the file goes away");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
await check("collapses a chain to one hop", async () => {
  // Two retitles in a row: A was 301'd to B last week, B is 301'd to C today.
  // Leaving A → B → C costs an extra round trip and keeps a dead URL in the
  // chain, so A must point straight at C.
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    await writeRedirects(file, [
      { from: "/anime/first-1/", to: "/anime/second-1/" },
      { from: "/anime/second-1/", to: "/anime/third-1/" },
    ]);
    const text = await readFile(file, "utf8");
    assert(text.includes("/anime/first-1/ /anime/third-1/ 301"), "chain should collapse to A → C");
    assert(text.includes("/anime/second-1/ /anime/third-1/ 301"), "the last hop still resolves");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
await check("drops redirects that only lead back to themselves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    const r = await writeRedirects(file, [
      { from: "/anime/a-1/", to: "/anime/a-1/" },
      { from: "/anime/b-1/", to: "/anime/c-1/" },
      { from: "/anime/c-1/", to: "/anime/b-1/" },
    ]);
    eq(r.count, 0);
    eq(r.written, false);
    assert(!(await exists(file)), "no usable rule should leave no file");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
await check("an empty plan keeps manual rules and drops nothing it did not write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    await writeFile(file, `/api/* /.netlify/functions/:splat 200\n`, "utf8");
    const r = await writeRedirects(file, []);
    const text = await readFile(file, "utf8");
    eq(r.written, true);
    eq(r.count, 0);
    assert(!text.includes(BLOCK_START), "no block when there is nothing to redirect");
    eq(text.trim(), "/api/* /.netlify/functions/:splat 200", "manual rule should survive untouched");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
await check("no redirects and no manual rules leaves no file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    const r = await writeRedirects(file, []);
    eq(r.written, false);
    assert(!(await exists(file)), "should not create an empty _redirects");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
await check("removes a managed block whose rules all went live", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tsuzuki-redirects-"));
  const file = join(dir, "_redirects");
  try {
    await writeFile(file, `${BLOCK_START}\n/anime/old-1/ /anime/new-1/ 301\n${BLOCK_END}\n\n/api/* /.netlify/functions/:splat 200\n`, "utf8");
    const r = await writeRedirects(file, [], { live: new Set(["/anime/old-1/"]) });
    const text = await readFile(file, "utf8");
    eq(r.count, 0);
    assert(!text.includes(BLOCK_START), "empty block should be removed");
    assert(!text.includes("/anime/old-1/"), "the cancelled rule should be gone");
    assert(text.includes("/api/*"), "manual rule should survive");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

if (failures) console.log(`\nFAILED ${failures}`);
else console.log("\nall prune checks pass");
process.exit(failures ? 1 : 0);
