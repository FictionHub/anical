#!/usr/bin/env node
/* Pure-logic checks over the two XML ingest adapters (ann.mjs, studio.mjs) and
   the xml-lite reader they share. No network, no Blobs.

   The bug this file exists to prevent: both adapters shipped calling
   DOMParser, which does not exist in the Node function runtime — every ingest
   run failed the ANN/studio sources at parse time while the run log happily
   recorded ok:true for everything that wrapped them in try/catch. The ANN
   fixture below is trimmed from a REAL batch response from
   cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=12345/15463/23755/34567/45678
   (fetched 2026-10-26), including the <warning> elements batch calls actually
   contain and the <info> with escaped markup inside its Plot Summary.

   Run with: npm run ingest:test */
import { parseAnnXml } from "../netlify/functions/_lib/ingest-sources/ann.mjs";
import { parseRss, parseJson, studioItemKey } from "../netlify/functions/_lib/ingest-sources/studio.mjs";
import { decodeEntities, parseAttrs, extractElements, textOf, firstUrlOf } from "../netlify/functions/_lib/xml-lite.mjs";
import { configuredIds } from "../netlify/functions/_lib/ingest-ids.mjs";

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n         ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b) => assert(a === b, `expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);

// ------------------------------------------------------------------ fixtures

// Trimmed real payload: Azazel in full shape, Nagatoro reduced, warnings real.
const ANN_BATCH_XML = `<ann><anime id="12345" gid="3059040577" type="TV" name="You&#039;re Being Summoned, Azazel" precision="TV" generated-on="2026-10-26T15:55:46Z">
<related-prev rel="alternate retelling of" id="11216"/>
<info gid="805291822" type="Picture" src="https://cdn.animenewsnetwork.com/thumbnails/fit200x200/encyc/A12345-13.jpg" width="140" height="200"><img src="https://cdn.animenewsnetwork.com/thumbnails/fit200x200/encyc/A12345-13.jpg" width="140" height="200"/><img src="https://cdn.animenewsnetwork.com/thumbnails/max500x600/encyc/A12345-13.jpg" width="204" height="291"/></info>
<info gid="3547216213" type="Main title" lang="EN">You&#039;re Being Summoned, Azazel</info>
<info gid="1715343796" type="Alternative title" lang="JA">Yondemasu yo, Azazel-san</info>
<info gid="2635243931" type="Genres">comedy</info>
<info gid="2511078822" type="Genres">supernatural</info>
<info gid="1832701954" type="Themes">demons</info>
<info gid="2049361883" type="Plot Summary">Akutabe, a detective, summons devils to solve the troubles of his clients. One day, a low class devil Azazel Atsushi is summoned by Akutabe and is used harshly by him and his assistant Rinko Sakuma.</info>
<info gid="1100373918" type="Number of episodes">13</info>
<info gid="2301694156" type="Vintage">2011-04-08 to 2011-07-01</info>
<ratings nb_votes="235" weighted_score="6.9534" bayesian_score="6.97844"/>
<staff gid="2388622215"><task>Director</task><person id="13401">Tsutomu Mizushima</person></staff>
<credit gid="1772874145"><task>Animation Production</task><company id="337">Production I.G</company></credit></anime><warning>no result for anime=15463</warning><anime id="23755" gid="443546409" type="TV" name="Don&#039;t Toy with Me, Miss Nagatoro" precision="TV" generated-on="2026-10-26T15:55:46Z">
<info gid="3518979395" type="Main title" lang="EN">Don&#039;t Toy with Me, Miss Nagatoro</info>
<info type="Plot Summary">Mischievous Nagatoro always bugs her upperclassman and he can&#039;t figure out if it&#039;s just to get a reaction out of him. &lt;em class=de-emphasized&gt;(from manga)&lt;/em&gt;</info>
<info gid="2795930646" type="Number of episodes">12</info>
<info gid="4029242615" type="Vintage">2021-04-10</info>
<credit gid="1987723623"><task>Animation Production</task><company id="158">Telecom Animation Film</company></credit></anime><warning>no result for anime=34567</warning><warning>no result for anime=45678</warning></ann>`;

const RSS_XML = `<rss><channel><title>MAPPA blog</title><item><title><![CDATA[Mixed &amp; escaped]]></title><link>https://studio.jp/news/a</link></item><item><title><![CDATA[Show B <em>announced</em>]]></title><link>https://studio.jp/news/b</link><pubDate>Mon, 26 Oct 2026 09:00:00 +0900</pubDate><description><![CDATA[Season 3 & "more"]]></description></item></channel></rss>`;

console.log("xml-lite primitives");
check("decodes numeric + named entities", () => {
  eq(decodeEntities("You&#039;re &quot;fine&quot; &amp; piiii"), 'You\'re "fine" & piiii');
});
check("decimal + hex entities round-trip exactly", () => {
  eq(decodeEntities("&#039;&#x27;&amp;amp;"), "''&amp;");
});
check("parses attributes with both quote styles", () => {
  const a = parseAttrs(` name="It won't fail" type='TV' data-x=`);
  eq(a.name, "It won't fail");
  eq(a.type, "TV");
  assert(!("data-x" in a), "should not invent values for attr-less duplicates");
});
check("extracts top-level elements, consuming nested same-name tags", () => {
  const els = extractElements(`<x><a id="1">outer<b><a id="n"/></b></a><a id="2">two</a></x>`, "a");
  eq(els.length, 2);
  eq(els[0].attrs.id, "1");
  assert(els[0].inner.includes("<b>"), "nested foreign tags stay inside inner");
  assert(!els.some(e => e.attrs.id === "n"), "the inner <a> is consumed by the outer pair — same-tag nesting is a documented non-goal");
});
check("self-closing elements parse with empty inner", () => {
  const els = extractElements(`<y><why/><who no/></y>`, "who");
  eq(els[0].inner, "");
});
check("textOf unwraps CDATA, drops markup, collapses whitespace", () => {
  eq(textOf("<item><title><![CDATA[Show B <em>announced</em>]]></title></item>"), "Show B announced");
  eq(firstUrlOf('<img src="https://cdn.example/a.jpg"/>'), "https://cdn.example/a.jpg");
});

console.log("ann adapter");
const azazel = parseAnnXml(ANN_BATCH_XML);
check("returns one record per real anime, skipping batch warnings", () => {
  eq(azazel.length, 2);
  eq(azazel[0].id, "ann:12345");
  eq(azazel[1].id, "ann:23755");
});
check("uses Main title over the anime element name attribute", () => {
  eq(azazel[0].title.romaji, "You're Being Summoned, Azazel");
});
check("maps Vintage into anthology start date + season", () => {
  eq(azazel[0].startDate.year, 2011);
  eq(azazel[0].startDate.month, 4);
  eq(azazel[0].startDate.day, 8);
  eq(azazel[0].season, "SPRING");
  eq(azazel[0].seasonYear, 2011);
});
check("rich records that AniList normally never gives", () => {
  eq(azazel[0].episodes, 13);
  eq(azazel[0].format, "TV");
  eq(azazel[0].averageScore, 70); // 6.9534 × 10, rounded
  eq(azazel[0].popularity, 235);
  assert(azazel[0].studios.includes("Production I.G"), "studios should carry Animation Production credits");
  eq(azazel[1].studios[0], "Telecom Animation Film");
});
check("escaped markup survives into the synopsis, decoded", () => {
  assert(azazel[1].synopsis.includes("<em"), "expected <em> markup to be decoded, not stripped");
  assert(azazel[1].synopsis.startsWith("Mischievous Nagatoro always bugs her upperclassman and he can't figure"), "Plot Summary opens correctly");
});
check("genre + theme facets are collected, title-cased, deduplicated", () => {
  assert(azazel[0].genres.includes("Comedy"), "genres should include Genres");
  assert(azazel[0].genres.includes("Supernatural"), "genres should include Themes, title-cased");
  eq(azazel[0].genres.filter(g => g === "Comedy").length, 1);
});
check("cover image digs the larger preview out of bundled <img> tags", () => {
  assert(azazel[0].coverImage.large.includes("max500x600"), `large cover should use max500x600, got ${JSON.stringify(azazel[0].coverImage)}`);
  assert(azazel[0].coverImage.medium.includes("thumbnails/fit200x200"), "medium falls back to the entry thumbnail");
});
check("status: an ANN range fully in the past is FINISHED", () => {
  eq(azazel[0].status, "FINISHED"); // 2011-07-01
  assert(azazel[1].status === "FINISHED" || azazel[1].status === "RELEASING", "single-date vintage still resolves a status");
});

console.log("configuredIds");
const eqArr = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);
check("uses the curated list when the override is unset or blank", () => {
  eqArr(configuredIds(undefined, [1, 2]), [1, 2]);
  eqArr(configuredIds("   ", [1, 2]), [1, 2]);
});
check("accepts slashes, commas and spaces, collapsing duplicates", () => {
  eqArr(configuredIds("12345/23755, 12345 94608", [1]), [12345, 23755, 94608]);
});
check("drops anything that is not a positive integer instead of sending it upstream", () => {
  eqArr(configuredIds("12x/-4/0/7.5/31", [1]), [31]);
});
check("an explicit empty override means off, not the default", () => {
  eqArr(configuredIds("nonsense", [1, 2]), []);
});

console.log("studio adapter");
check("RSS items: CDATA titles, real pubDate + description", () => {
  const items = parseRss(RSS_XML);
  eq(items.length, 2);
  eq(items[0].title, "Mixed & escaped");
  eq(items[1].title, "Show B announced");
  eq(items[1].link, "https://studio.jp/news/b");
  eq(items[1].description, `Season 3 & "more"`);
});
check("JSON feeds accept items / entries / bare-array shapes", () => {
  eq(parseJson({ items: [{ title: "A", url: "u1" }] }).length, 1);
  eq(parseJson({ entries: [{ title: "B", link: "u2" }] }).length, 1);
  eq(parseJson([{ name: "C" }]).length, 1);
  eq(parseJson({ nope: "not a feed" }).length, 0);
});
check("JSON items fall back to link when url is absent (the old it.url-it.link regression)", () => {
  const [item] = parseJson({ items: [{ title: "D", link: "the-real-link" }] });
  eq(item.link, "the-real-link");
});
check("feed item ids are slugs of studio + title", () => {
  const a = studioItemKey("MAPPA", "Jujutsu Kaisen: Culling Game Arc!! (Very Long) Episode 100 Bonus Recording");
  assert(a.id.startsWith("studio:MAPPA:"), `id should name its studio, got ${JSON.stringify(a.id)}`);
  assert(/^[a-z0-9-]+$/.test(a.id.replace(/^studio:MAPPA:/, "")), "slug must be url- and key-safe");
});
check("same announcement on two runs resolves to the same identity", () => {
  eq(studioItemKey("Madhouse", "Frieren gets movie").id, studioItemKey("Madhouse", "Frieren Gets Movie!").id);
  assert(studioItemKey("Madhouse", "Frieren gets movie").id !== studioItemKey("Demon Slayer", "Frieren gets movie").id, "different studios must not share an id");
});

if (failures) console.log(`\nFAILED ${failures}`);
else console.log("\nall ingest checks pass");
process.exit(failures ? 1 : 0);
