#!/usr/bin/env node
/* One-off (and occasionally useful) cleanup for duplicate SEO pages.

   scripts/build-seo.mjs prunes duplicates as part of a successful build, but it
   can only do that while it has this run's page list in memory — and until now
   the repository already contained the output of years of title changes. This
   tool applies the same rule to what is on disk, using the URLs in
   site/sitemap-anime.xml as "what the last build produced". The sitemap is
   written by the generator from the pages it just built, so it is the closest
   thing to that list that survives between runs.

   Default is a dry run: it prints what would go and writes nothing. Pass
   --apply to delete the stale directories and rewrite site/_redirects.

   Run: npm run prune:seo          (report only)
        npm run prune:seo -- --apply */
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pruneSeoPages, writeRedirects } from "./lib/seo-prune.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(APP_DIR, "..", "site");
const apply = process.argv.includes("--apply");

// Every <loc> for one group, as a bare slug. A sitemap URL always ends in a
// slash and is always absolute; anything else is not ours to act on.
async function slugsFromSitemap(file, group) {
  const xml = await readFile(file, "utf8").catch(() => "");
  const re = new RegExp(`<loc>[^<]*/${group}/([^</]+)/</loc>`, "g");
  return new Set([...xml.matchAll(re)].map(m => m[1]));
}

const groups = {
  anime: await slugsFromSitemap(join(SITE_DIR, "sitemap-anime.xml"), "anime"),
  "where-to-watch": await slugsFromSitemap(join(SITE_DIR, "sitemap-anime.xml"), "where-to-watch"),
};

// A handful of shows left two pages behind and then dropped out of the built
// seasons, so the sitemap names neither of them and the rule above can never
// pick a winner. The generator's name for a page is animeSlug():
// slugify(english || romaji) + "-" + id. AniList still returns those titles, so
// which slug the generator would write today is not a guess — and that page is
// already on disk. Checked against AniList on 2026-10-26; re-check a title here
// (one GraphQL query by id) before trusting it years later.
const KNOWN_CURRENT = {
  198369: "detective-conan-fallen-angel-of-the-highway-198369",           // english title
  213506: "hokuto-no-ken-kenou-gun-zako-tachi-no-banka-part-2-213506",    // no english, romaji
  179874: "mononoke-the-movie-chapter-iii-the-curse-of-the-serpent-179874", // english title
};
const hasPage = async (group, slug) =>
  access(join(SITE_DIR, group, slug, "index.html")).then(() => true, () => false);

// The sitemap is the only evidence of what the last build produced. With no
// entries for a group, this is not a cleanup opportunity — it is a missing or
// truncated sitemap, and deleting on that signal is how a maintenance script
// eats a site.
for (const [group, keep] of Object.entries(groups)) {
  if (!keep.size) {
    console.error(`refusing to prune ${group}: sitemap-anime.xml lists no ${group} pages`);
    process.exit(1);
  }
}

// Now that the sitemap is known to be trustworthy, let the checked titles above
// settle their ids too — but only where that page really exists in the group,
// so a stale entry here can never point a prune at nothing.
for (const [group, keep] of Object.entries(groups)) {
  for (const slug of Object.values(KNOWN_CURRENT)) {
    if (await hasPage(group, slug)) keep.add(slug);
  }
}

const result = await pruneSeoPages({ siteDir: SITE_DIR, groups, apply });

for (const name of result.removed) console.log(`${apply ? "removed" : "would remove"}  ${name}`);
for (const s of result.skipped) console.log(`skipped ${s.group}/${s.id}: ${s.reason} (${s.slugs.join(", ")})`);

if (apply) {
  // The sitemap is also the record of which pages exist, so a rule pointing at
  // a path that is live again is cancelled rather than kept.
  const live = new Set();
  for (const [group, keep] of Object.entries(groups)) {
    for (const slug of keep) live.add(`/${group}/${slug}/`);
  }
  const r = await writeRedirects(join(SITE_DIR, "_redirects"), result.redirects, { live });
  console.log(`${r.written ? "wrote" : "cleared"} site/_redirects with ${r.count} redirect${r.count === 1 ? "" : "s"}`);
}

console.log(
  `\n${result.removed.length} stale page${result.removed.length === 1 ? "" : "s"} ` +
  `${apply ? "removed" : "to remove"}, ${result.redirects.length} redirect${result.redirects.length === 1 ? "" : "s"}, ` +
  `${result.skipped.length} ambiguous (left alone).` +
  (apply ? "" : "\nDry run — re-run with --apply to make the changes."),
);
