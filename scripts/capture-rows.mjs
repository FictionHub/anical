// Print a devtools snippet that captures the Crunchyroll calendar by hand.
//
// WHY THIS EXISTS
// The automated scrape in ingest-crunchyroll.mjs no longer works from anywhere
// we can run it. Crunchyroll sits behind a Cloudflare challenge that answers
// headless Chromium with "Just a moment..." and an empty body — from a GitHub
// Actions runner AND from a residential connection, so it is headless-browser
// detection rather than an IP reputation problem. Getting a headless browser
// past that check means faking what the check measures, which this project is
// not going to do.
//
// A real browser that a person is actually looking at loads the page normally.
// So the fetch step becomes manual and everything after it stays automated:
// matching titles to AniList, deriving the offsets, validating, publishing.
// That is the expensive, error-prone part, and it is unchanged.
//
// USAGE
//   1. node scripts/capture-rows.mjs            # prints the snippet
//   2. open https://www.crunchyroll.com/simulcastcalendar in your browser
//   3. paste the snippet into the devtools console (F12)
//      -> it copies the rows to your clipboard and says how many it found
//   4. paste into data/crunchyroll-rows.json
//   5. node scripts/ingest-crunchyroll.mjs --rows data/crunchyroll-rows.json
//
// Step 5 does the preflight, derivation and publish exactly as the scheduled
// job would have. Add --dry-run to derive without publishing.
import { extractRows } from "./ingest-crunchyroll.mjs";

const snippet = `copy(JSON.stringify((${extractRows.toString()})(), null, 2)), console.log("Crunchyroll rows copied:", (${extractRows.toString()})().length)`;

console.log(`
Open the calendar in a normal browser tab, then paste this into the devtools
console (F12). It copies the captured rows to your clipboard.

Crunchyroll shows the page in the language of your IP; the extractor handles
that, but keep the tab on one locale for the whole capture.

------------------------------------------------------------------------------
${snippet}
------------------------------------------------------------------------------

Then: save the clipboard to data/crunchyroll-rows.json and run

  node scripts/ingest-crunchyroll.mjs --rows data/crunchyroll-rows.json
`);
