// Stamp the app build number into site/index.html.
//
// Version = <MAJOR_MINOR>.<git commit count>. Run automatically before every
// commit by .githooks/pre-commit, so the build number ticks up on its own and
// always matches the commit it ships in. Nothing to host, no build step.
//
// Run manually with: node scripts/stamp-version.mjs
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dirname, "..", "site", "index.html");
// The CHANGELOG travelled with the application when it was split out of the
// document in Aug 2026; the stamp deliberately did not. Keeping the version in
// index.html is what lets app.js keep its ETag across a version-only commit —
// see the banner in site/app.js.
const APP = join(__dirname, "..", "site", "app.js");

const html = await readFile(INDEX, "utf8");
const app = await readFile(APP, "utf8");

// MAJOR_MINOR is derived, not typed.
//
// It used to be a hand-edited constant that had to be kept equal to the `v:` of
// the newest CHANGELOG entry, and twice it wasn't: 2.5.x shipped stamped under a
// v2.8 changelog, then 3.0.x under a v3.1 one. The footer build number and the
// "What's new" heading are the same version to a reader, so a mismatch between
// them is a bug the reader can see. Reading it from the changelog makes the
// entry you write when shipping the single source of truth and deletes the
// manual step that drifted.
//
// To release: add the CHANGELOG entry in site/app.js with the new `v:`.
// That is the entire procedure — nothing in this file needs editing.
function majorMinor(src) {
  const re = /\{\s*id:\s*(\d+)\s*,\s*v:\s*"([^"]+)"/g;
  let m, best = null;
  while ((m = re.exec(src))) if (!best || +m[1] > best.id) best = { id: +m[1], v: m[2] };
  return best && best.v;
}

const MAJOR_MINOR = majorMinor(app);
// Fail loud rather than fall back to a guess. A blocked commit costs seconds; a
// silently wrong version number ships to every user, which is the exact failure
// this script exists to prevent.
if (!MAJOR_MINOR) {
  console.error('stamp-version: no CHANGELOG entry found in site/app.js — expected `{ id:N, v:"X.Y", … }`');
  process.exit(1);
}

// A pre-commit hook runs before the new commit exists, so the commit being
// created is the current count + 1. (Falls back to the raw count if anything
// about git is off, e.g. detached/no-HEAD states.)
let count;
try { count = parseInt(execSync("git rev-list --count HEAD").toString().trim(), 10) + 1; }
catch { count = 1; }
const version = `${MAJOR_MINOR}.${count}`;

const re = /window\.APP_VERSION = "[^"]*";/;
if (!re.test(html)) { console.error("stamp-version: APP_VERSION marker not found in site/index.html"); process.exit(1); }

const next = html.replace(re, `window.APP_VERSION = "${version}";`);
if (next !== html) { await writeFile(INDEX, next, "utf8"); console.log("stamp-version: " + version); }
else { console.log("stamp-version: already " + version); }
