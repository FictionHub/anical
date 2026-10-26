#!/usr/bin/env node
/* Checks that the app's script shell actually hangs together.
   No network, no Blobs, no DOM: this reads the files and asserts about them.

   WHY THIS FILE EXISTS. The client under site/ is deliberately not linted —
   eslint.config.mjs ignores site/** because nine classic scripts sharing one
   global scope cannot be modelled per file. That is the right call for
   no-undef, but it left the shell itself unchecked, and the shell has one
   property nothing else verifies: every <script src> in index.html is fetched
   as a CLASSIC script, in order, into a single shared global scope.

   /app/i18n.js shipped as an ES module — top-level `export` — inside that
   list. The browser rejected the whole file with a SyntaxError, so
   initI18n() was undefined when app.js called it at line 211, and that one
   throw halted app.js before the localStorage hydration, the skin constants
   and `$`. The site booted to nothing. Nothing caught it, because the tests
   extract individual declarations by name and skipped the file entirely.

   Each check below is a way of asking the question that would have failed
   that commit.

   Run with: npm run shell:test */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n         ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const index = readFileSync(join(SITE, "index.html"), "utf8");
const sw = readFileSync(join(SITE, "sw.js"), "utf8");

// Every external script the page loads, in document order. Inline <script>
// blocks (the JSON-LD, the APP_VERSION stamp) carry no src and are skipped:
// they are not part of the shared scope.
const scripts = [...index.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1]);

const pathOf = url => join(SITE, url.replace(/^\//, "").split("?")[0]);
const readOf = url => readFileSync(pathOf(url), "utf8");

console.log("shell: the script list is what it claims to be");
check("index.html loads at least the scripts the app is documented as loading", () => {
  assert(scripts.length >= 8, `found only ${scripts.length} <script src> tags in index.html`);
});
check("no script tag is empty or malformed", () => {
  for (const s of scripts) assert(s && s.startsWith("/"), `bad script src: ${JSON.stringify(s)}`);
});

console.log("shell: every loaded script exists on disk");
for (const url of scripts) {
  check(`${url} exists`, () => {
    assert(existsSync(pathOf(url)), `${url} is referenced by index.html but ${pathOf(url)} does not exist`);
  });
}

console.log("shell: every loaded script is a classic script");
// This is the check that would have caught the i18n break. A module keyword at
// the top level is a SyntaxError in a classic script, and the whole file — not
// just that line — is discarded.
const MODULE_KEYWORD = /^\s*(?:export|import)\s/m;
for (const url of scripts) {
  if (!existsSync(pathOf(url))) continue;
  check(`${url} carries no module syntax`, () => {
    const src = readOf(url);
    const m = src.match(MODULE_KEYWORD);
    // The message is built only on failure. It reads `m[0]`, so constructing it
    // unconditionally would throw on the pass case, where m is null.
    if (!m) return;
    const line = src.slice(0, m.index).split("\n").length;
    throw new Error(
      `${url} contains \`${m[0].trim()}\` at line ${line}. index.html loads it as a classic script, ` +
      `so the browser discards the WHOLE file with a SyntaxError. Nine scripts share one global ` +
      `scope here and there is no build step: drop the keyword and declare the name globally, ` +
      `or stop loading the file.`);
  });
}

console.log("shell: the app boots");
// Parsing is not enough — a file can be valid and still leave the caller with
// nothing. This walks the top-level calls in app.js and confirms the functions
// they name are declared somewhere earlier in the load order.
check("every top-level call in app.js is defined by a script loaded before it", () => {
  const appJs = readOf("/app.js");
  const at = scripts.indexOf("/app.js");
  assert(at >= 0, "index.html no longer loads /app.js");
  // Map to real paths before existsSync: these are URL paths (/app.js), and
  // existsSync("/app.js") is false on Windows and would silently drop every
  // earlier script out of the search.
  const earlier = scripts.slice(0, at).filter(u => existsSync(pathOf(u))).map(readOf).join("\n");

  // Top-level `name(` at column zero, which is how this codebase writes an
  // immediate call. Function-scoped and method calls are indented and so are
  // not matched.
  const calls = [...appJs.matchAll(/^([A-Za-z_$][\w$]*)\s*\(/gm)];
  const declared = name => new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?function\\s+${name}\\b`).test(earlier);
  // `state` etc. are objects, and the handful of calls below are the ones this
  // check is really about — the ones whose absence halts the file.
  const missing = calls.map(c => c[1]).filter(n => !declared(n) && !/^(if|for|while|switch|catch|return|typeof|new|void)$/.test(n));
  assert(missing.length === 0,
    `app.js calls ${[...new Set(missing)].join(", ")} at top level but no earlier script declares it — ` +
    `the throw halts app.js here and everything below dies with it`);
});

console.log("shell: the service worker can boot offline");
// SHELL is what a fresh install precaches. A script that boots the app but is
// missing from SHELL opens online and comes up blank offline.
const shellList = (sw.match(/const SHELL = \[([^\]]*)\]/s) || [])[1];
check("sw.js declares SHELL", () => {
  assert(shellList, "could not find `const SHELL = [...]` in sw.js");
});
check("every script index.html loads is precached in SHELL", () => {
  const cached = new Set([...shellList.matchAll(/"([^"]+)"/g)].map(m => m[1].split("?")[0]));
  const missing = scripts.filter(s => !cached.has(s));
  assert(missing.length === 0, `${missing.join(", ")} load(s) in index.html but are not in SHELL — ` +
    `a fresh install would open with a blank app offline`);
});

console.log("shell: the test harnesses load the same scripts");
// test-ratings.mjs and test-feed.mjs extract declarations from a concatenated
// copy of the client. If that list drifts from index.html the suites test a
// shape the browser never sees.
for (const file of ["test-ratings.mjs", "test-feed.mjs"]) {
  check(`${file} lists every non-IIFE script from index.html`, () => {
    const harness = readFileSync(join(ROOT, "scripts", file), "utf8");
    const block = (harness.match(/const SCRIPT = \[([\s\S]*?)\]/) || [])[1];
    assert(block, `could not find the SCRIPT list in scripts/${file}`);
    const listed = new Set([...block.matchAll(/"([^"]+)"/g)].map(m => "site/" + m[1].replace(/^\//, "")));
    // experience.js is an IIFE with DOM side effects and is deliberately out.
    const expected = scripts.map(s => s.replace(/^\//, "site/")).filter(s => s !== "site/app/experience.js");
    const missing = expected.filter(s => !listed.has(s));
    assert(missing.length === 0, `${file} does not load ${missing.join(", ")} — ` +
      `it would test a script list the browser never sees`);
  });
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall shell checks pass");
process.exit(failures ? 1 : 0);
