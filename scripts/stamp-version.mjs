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

const MAJOR_MINOR = "2.2";
const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dirname, "..", "site", "index.html");

// A pre-commit hook runs before the new commit exists, so the commit being
// created is the current count + 1. (Falls back to the raw count if anything
// about git is off, e.g. detached/no-HEAD states.)
let count;
try { count = parseInt(execSync("git rev-list --count HEAD").toString().trim(), 10) + 1; }
catch { count = 1; }
const version = `${MAJOR_MINOR}.${count}`;

const html = await readFile(INDEX, "utf8");
const re = /const APP_VERSION = "[^"]*";/;
if (!re.test(html)) { console.error("stamp-version: APP_VERSION marker not found in site/index.html"); process.exit(1); }

const next = html.replace(re, `const APP_VERSION = "${version}";`);
if (next !== html) { await writeFile(INDEX, next, "utf8"); console.log("stamp-version: " + version); }
else { console.log("stamp-version: already " + version); }
