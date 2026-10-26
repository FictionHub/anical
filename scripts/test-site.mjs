#!/usr/bin/env node
/* Checks over what is actually committed under site/ — the generated page tree,
   the redirect rules that point into it, and the sitemaps that list it.

   These are all invariants a build can break without any pure-logic suite
   noticing, because every one of them is about files on disk rather than about
   a function's output:

     - a 301 whose target directory was deleted sends every inbound link to a 404;
     - a 301 whose source still exists on disk shadows a live page — Netlify
       matches redirects before the filesystem, so the page is unreachable;
     - two directories carrying the same AniList id are two canonicals for one
       show, which is exactly what the prune exists to prevent;
     - a page whose <link rel="canonical"> names a different directory tells
       Google to consolidate it onto a URL that is not the one serving it;
     - a sitemap <loc> with no file behind it is a guaranteed crawl error.

   Nothing here fetches anything or runs the generator: it reads the tree the
   last refresh-pages run committed.

   Run with: npm run site:test */
import { open, readdir, readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const ORIGIN = "https://tsuzuki.top";

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok   ${name}`))
    .catch(e => { failures++; console.log(`  FAIL ${name}\n         ${e.message}`); });
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const exists = async p => { try { await access(p); return true; } catch { return false; } };

// Every directory immediately under `group` that is a generated page.
async function pageDirs(group) {
  const root = join(SITE, group);
  const names = await readdir(root, { withFileTypes: true });
  return names.filter(d => d.isDirectory()).map(d => d.name).sort();
}
const idOf = slug => { const m = /-(\d+)$/.exec(slug); return m ? m[1] : null; };

/* ---------- site/_redirects ---------- */
console.log("_redirects");
await check("the file exists and its rules are well formed", async () => {
  const file = join(SITE, "_redirects");
  assert(await exists(file), "site/_redirects is missing — the prune's 301s have nowhere to live");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const rules = lines.filter(l => l.trim() && !l.trimStart().startsWith("#"));
  assert(rules.length, "no rules at all");
  for (const line of rules) {
    const parts = line.trim().split(/\s+/);
    assert(parts.length === 3, `expected "from to status", got: ${line}`);
    assert(/^\d{3}$/.test(parts[2]), `status is not a code: ${line}`);
    assert(parts[0].startsWith("/"), `source is not a site path: ${line}`);
  }
});
await check("the generated block is marked once, closed, and comes first", async () => {
  const text = await readFile(join(SITE, "_redirects"), "utf8");
  const start = "# --- generated:";
  const end = "# --- end generated";
  const starts = text.split(start).length - 1;
  const ends = text.split(end).length - 1;
  assert(starts === ends, `unbalanced generated markers: ${starts} open, ${ends} close`);
  assert(starts <= 1, `${starts} generated blocks — they must merge, never stack`);
  if (starts) {
    assert(text.indexOf(start) < text.indexOf(end), "block closes before it opens");
    // First match wins in Netlify's _redirects, so a hand-written rule above the
    // generated block would silently disable every 301 in it.
    const lines = text.split(/\r?\n/);
    const firstRule = lines.findIndex(l => l.trim() && !l.trimStart().startsWith("#"));
    assert(firstRule >= 0, "the block exists but the file has no rules");
    assert(lines.slice(0, firstRule).join("\n").includes(start),
      `the first rule is "${lines[firstRule]}" and no generated block opens above it — hand-written rules must come after the block`);
  }
});
await check("every redirect target exists on disk", async () => {
  const lines = (await readFile(join(SITE, "_redirects"), "utf8")).split(/\r?\n/);
  const missing = [];
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const to = line.trim().split(/\s+/)[1];
    if (!/^\/(anime|where-to-watch)\//.test(to)) continue;   // only the generated groups are checked
    if (!(await exists(join(SITE, to.replace(/^\/|\/$/g, ""), "index.html")))) missing.push(to);
  }
  assert(!missing.length, `${missing.length} redirect target(s) have no page: ${missing.slice(0, 5).join(", ")}`);
});
await check("no redirect shadows a page that is still on disk", async () => {
  const lines = (await readFile(join(SITE, "_redirects"), "utf8")).split(/\r?\n/);
  const shadowed = [];
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const from = line.trim().split(/\s+/)[0];
    if (await exists(join(SITE, from.replace(/^\/|\/$/g, ""), "index.html"))) shadowed.push(from);
  }
  assert(!shadowed.length, `${shadowed.length} rule(s) 301 a live page away: ${shadowed.slice(0, 5).join(", ")}`);
});
await check("no rule redirects the same source twice", async () => {
  const lines = (await readFile(join(SITE, "_redirects"), "utf8")).split(/\r?\n/);
  const seen = new Set(), dupes = [];
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const from = line.trim().split(/\s+/)[0];
    if (seen.has(from)) dupes.push(from);
    seen.add(from);
  }
  assert(!dupes.length, `duplicate source(s): ${dupes.slice(0, 5).join(", ")}`);
});
await check("no rule is a hop in the middle of a chain", async () => {
  // writeRedirects collapses A→B→C to A→C. A source that also appears as some
  // other rule's target means that merge did not happen, and every request pays
  // an extra round trip to learn where it was going.
  const lines = (await readFile(join(SITE, "_redirects"), "utf8")).split(/\r?\n/);
  const sources = new Set(), targets = new Set();
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const [from, to] = line.trim().split(/\s+/);
    sources.add(from); targets.add(to);
  }
  const chained = [...sources].filter(s => targets.has(s));
  assert(!chained.length, `still-chained source(s): ${chained.slice(0, 5).join(", ")}`);
});

/* ---------- generated page tree ---------- */
console.log("pages");
for (const group of ["anime", "where-to-watch"]) {
  await check(`${group}/ carries one page per AniList id`, async () => {
    const dirs = await pageDirs(group);
    assert(dirs.length, `no pages under site/${group}/`);
    const byId = new Map();
    const noId = [];
    for (const name of dirs) {
      const id = idOf(name);
      if (!id) { noId.push(name); continue; }
      if (byId.has(id)) throw new Error(`two directories claim AniList ${id}: ${byId.get(id)} and ${name}`);
      byId.set(id, name);
    }
    // Every generated page is named "<slug>-<id>", so an unparseable name means
    // something other than the generator wrote this directory.
    assert(!noId.length, `directory without an AniList id: ${noId.slice(0, 5).join(", ")}`);
  });
  await check(`${group}/ every page directory has an index.html`, async () => {
    const dirs = await pageDirs(group);
    const broken = [];
    for (const name of dirs) if (!(await exists(join(SITE, group, name, "index.html")))) broken.push(name);
    assert(!broken.length, `${broken.length} empty page dir(s): ${broken.slice(0, 5).join(", ")}`);
  });
  await check(`${group}/ every page claims its own URL`, async () => {
    // The generator writes a page into <slug>-<id>/ and prints the same slug as
    // its canonical. If the two ever disagree — a stale template, a directory
    // renamed by hand — Google is told to consolidate a page onto a URL that is
    // not the one serving it, and every one of these pages is a copy of a
    // pattern, so the mistake is invisible without reading them.
    const dirs = await pageDirs(group);
    const wrong = [];
    for (const name of dirs) {
      const file = join(SITE, group, name, "index.html");
      const fh = await open(file, "r");
      try {
        const buf = Buffer.alloc(16384);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const head = buf.subarray(0, bytesRead).toString("utf8");
        const want = `${ORIGIN}/${group}/${name}/`;
        const canonical = /rel="canonical"\s+href="([^"]*)"/.exec(head);
        if (!canonical) { wrong.push(`${group}/${name}: no canonical`); continue; }
        if (canonical[1] !== want) wrong.push(`${group}/${name}: canonical is ${canonical[1]}`);
      } finally { await fh.close(); }
    }
    assert(!wrong.length, `${wrong.length} page(s) point elsewhere: ${wrong.slice(0, 3).join("; ")}`);
  });
}

/* ---------- sitemaps ---------- */
console.log("sitemaps");
async function locs(file) {
  const text = await readFile(join(SITE, file), "utf8");
  return [...text.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1].trim());
}
await check("the sitemap index points at sitemaps that exist", async () => {
  const entries = await locs("sitemap.xml");
  assert(entries.length, "sitemap.xml lists nothing");
  for (const url of entries) {
    const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : null;
    assert(path, `loc is not on ${ORIGIN}: ${url}`);
    assert(await exists(join(SITE, path.replace(/^\//, ""))), `indexed sitemap is missing: ${path}`);
  }
});
for (const file of ["sitemap-main.xml", "sitemap-anime.xml"]) {
  await check(`${file}: every <loc> has a page behind it`, async () => {
    const entries = await locs(file);
    assert(entries.length, `${file} lists nothing`);
    const missing = [];
    for (const url of entries) {
      const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url;
      const rel = path.replace(/^\//, "").replace(/\/$/, "");
      const target = rel ? join(SITE, rel, "index.html") : join(SITE, "index.html");
      if (!(await exists(target))) missing.push(path);
    }
    assert(!missing.length, `${missing.length} listed page(s) do not exist: ${missing.slice(0, 5).join(", ")}`);
  });
  await check(`${file}: no <loc> is listed twice`, async () => {
    const entries = await locs(file);
    const seen = new Set(), dupes = [];
    for (const url of entries) { if (seen.has(url)) dupes.push(url); seen.add(url); }
    assert(!dupes.length, `${dupes.length} duplicate url(s): ${dupes.slice(0, 5).join(", ")}`);
  });
}

if (failures) console.log(`\nFAILED ${failures}`);
else console.log("\nall site checks pass");
process.exit(failures ? 1 : 0);
