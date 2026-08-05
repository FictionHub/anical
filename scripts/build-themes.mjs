/* ============================================================
   Tsuzuki — skin seed generator

   Builds site/data/themes.json: the committed set of character/series
   skins the site ships with. The live Blobs layer (edited in /admin)
   is merged on top at read time, exactly like the schedule-override
   seed — so themes added in the admin panel cost no deploy, and the
   ones in here survive a wiped store.

   A skin is not a recolour. Recolouring alone produces ten sites that
   are obviously the same site in different paint, which is what the
   first version of this did. What actually reads as a different
   product is *structure*: the shape of every corner, the weight of
   every border, the typeface on every heading, and a texture running
   under the whole page. So a theme carries all of it:

     colors    the full CSS variable palette
     font      a display face for headings only — body text keeps the
               system stack, because a decorative face at 12px across a
               grid of air times is a skin that made the product worse
     shape     corner radii, border weight, surface blur
     effects   vignette / grain / scanlines / glow strength
     backdrop  the show's banner, behind everything
     header    the same art as a band behind the toolbar
     cutout    the show's poster in a corner, edges dissolved into the
               page so it reads as part of the layout, not a screenshot
     watermark art on empty days and empty lists
     pattern   a tiling motif drawn from the palette (see MOTIFS)
     ornament  a corner flourish, likewise drawn

   The palette comes from the art it sits next to: AniList publishes a
   dominant colour per title, and taking the hue from that and the
   imagery from the banner is what keeps a skin coherent when the show
   updates its key art. Hand-picked hex codes drift.

   The drawn layers (pattern, ornament) are generated SVG inlined as
   data: URIs — no host to go down, no dead link in six months, and a
   texture actually made of the theme's own colours.

   Run:  node scripts/build-themes.mjs
         node scripts/build-themes.mjs --add 21519
         node scripts/build-themes.mjs --check      (verify every remote URL still resolves)
   ============================================================ */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "data", "themes.json");
const ANILIST = "https://graphql.anilist.co";
const SCHEMA_VERSION = 1;

/* ---------------- the shipped set ----------------
   Each entry pairs a title with the treatment that suits it. `motif` picks a
   texture, `font` a display face, `shape` how sharp the whole UI is, and
   `effects` what sits over the top. Add a row, re-run, done. */
const SEED = {
  154587: { motif: "runes",    font: "cormorant", shape: "soft",    effects: { vignette: 0.5 } },
  113415: { motif: "slash",    font: "bebas",     shape: "sharp",   effects: { grain: 0.35, glowStrength: 0.8 } },
  127230: { motif: "teeth",    font: "anton",     shape: "brutal",  effects: { grain: 0.5 } },
  101922: { motif: "asanoha",  font: "shippori",  shape: "classic", effects: { vignette: 0.35 } },
  21:     { motif: "seigaiha", font: "bangers",   shape: "bouncy",  effects: { glowStrength: 0.6 } },
  140960: { motif: "hearts",   font: "baloo",     shape: "bouncy",  effects: { vignette: 0.2 } },
  151807: { motif: "hex",      font: "orbitron",  shape: "tech",    effects: { scanlines: 0.35, glowStrength: 0.9 } },
  11061:  { motif: "hatch",    font: "titan",     shape: "classic", effects: {} },
  20605:  { motif: "cracks",   font: "oswald",    shape: "brutal",  effects: { grain: 0.55, vignette: 0.5 } },
  21519:  { motif: "stars",    font: "sawarabi",  shape: "soft",    effects: { vignette: 0.45 } },
};

const FONTS = {
  cormorant: { family: '"Cormorant Garamond",Georgia,serif', css: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap", scale: 1.18 },
  bebas:     { family: '"Bebas Neue",Impact,sans-serif',     css: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap", scale: 1.22 },
  anton:     { family: '"Anton",Impact,sans-serif',          css: "https://fonts.googleapis.com/css2?family=Anton&display=swap", scale: 1.12 },
  shippori:  { family: '"Shippori Mincho",Georgia,serif',    css: "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600;700&display=swap", scale: 1.05 },
  bangers:   { family: '"Bangers",Impact,cursive',           css: "https://fonts.googleapis.com/css2?family=Bangers&display=swap", scale: 1.2 },
  baloo:     { family: '"Baloo 2",Verdana,sans-serif',       css: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&display=swap", scale: 1.08 },
  orbitron:  { family: '"Orbitron",Verdana,sans-serif',      css: "https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&display=swap", scale: 1.0 },
  titan:     { family: '"Titan One",Impact,cursive',         css: "https://fonts.googleapis.com/css2?family=Titan+One&display=swap", scale: 1.06 },
  oswald:    { family: '"Oswald",Impact,sans-serif',         css: "https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&display=swap", scale: 1.1 },
  sawarabi:  { family: '"Sawarabi Mincho",Georgia,serif',    css: "https://fonts.googleapis.com/css2?family=Sawarabi+Mincho&display=swap", scale: 1.05 },
};

const SHAPES = {
  soft:    { radius: 16, chipRadius: 24, border: 1, cardBlur: 14 },
  classic: { radius: 10, chipRadius: 18, border: 1, cardBlur: 10 },
  bouncy:  { radius: 20, chipRadius: 28, border: 2, cardBlur: 12 },
  sharp:   { radius: 3,  chipRadius: 4,  border: 2, cardBlur: 8 },
  brutal:  { radius: 0,  chipRadius: 2,  border: 2, cardBlur: 6 },
  tech:    { radius: 4,  chipRadius: 6,  border: 1, cardBlur: 16 },
};

/* ---------------- drawn layers ----------------
   Tileable SVG built from the palette. Kept free of parentheses and
   apostrophes so the percent-encoded result survives the strict character
   class _lib/themes.mjs validates data: URIs against. */

// encodeURIComponent leaves !'()* alone, and those would break out of a CSS
// url(). Escape them too, so what ships is provably inert inside url("…").
const dataUri = svg =>
  "data:image/svg+xml," +
  encodeURIComponent(svg.replace(/\s+/g, " ").trim())
    .replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const svgWrap = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const MOTIFS = {
  // Frieren — a quiet diamond lattice with a rune tick, like tooled leather.
  runes: c => svgWrap(80, 80, `
    <g fill="none" stroke="${c}" stroke-width="1.1" opacity="0.9">
      <path d="M40 6 L74 40 L40 74 L6 40 Z"/>
      <path d="M40 22 L58 40 L40 58 L22 40 Z"/>
      <path d="M40 34 v12 M34 40 h12"/>
    </g>`),
  // Jujutsu Kaisen — cursed slashes, uneven on purpose.
  slash: c => svgWrap(90, 90, `
    <g stroke="${c}" stroke-width="2.2" stroke-linecap="round" opacity="0.85">
      <path d="M8 78 L34 20"/><path d="M40 82 L70 14"/><path d="M62 70 L86 30"/>
      <path d="M14 42 L28 12"/>
    </g>`),
  // Chainsaw Man — a chain of teeth, blunt and mechanical.
  teeth: c => svgWrap(64, 32, `
    <g fill="${c}" opacity="0.85">
      <path d="M0 22 L10 6 L20 22 Z"/><path d="M22 22 L32 6 L42 22 Z"/><path d="M44 22 L54 6 L64 22 Z"/>
      <rect x="0" y="24" width="64" height="3"/>
    </g>`),
  // Demon Slayer — asanoha, the hemp-leaf pattern on Tanjiro's haori.
  asanoha: c => svgWrap(60, 104, `
    <g fill="none" stroke="${c}" stroke-width="1.1" opacity="0.85">
      <path d="M30 0 L60 17 L60 52 L30 69 L0 52 L0 17 Z"/>
      <path d="M30 0 L30 69 M0 17 L60 52 M60 17 L0 52"/>
      <path d="M30 35 L0 17 M30 35 L60 17 M30 35 L0 52 M30 35 L60 52"/>
    </g>`),
  // One Piece — seigaiha waves, the sea in every frame.
  seigaiha: c => svgWrap(80, 40, `
    <g fill="none" stroke="${c}" stroke-width="1.6" opacity="0.8">
      <path d="M0 40 a40 40 0 0 1 80 0"/><path d="M0 40 a28 28 0 0 1 56 0" transform="translate(12 0)"/>
      <path d="M0 40 a16 16 0 0 1 32 0" transform="translate(24 0)"/>
      <path d="M-40 40 a40 40 0 0 1 80 0" transform="translate(0 -20)"/>
      <path d="M40 40 a40 40 0 0 1 80 0" transform="translate(0 -20)"/>
    </g>`),
  // Spy x Family — hearts and surveillance dots, the whole show in two shapes.
  hearts: c => svgWrap(72, 72, `
    <g fill="${c}" opacity="0.8">
      <path d="M18 30 c-7-8 2-17 9-11 7-6 16 3 9 11 l-9 9 z"/>
      <circle cx="56" cy="20" r="2.6"/><circle cx="48" cy="52" r="2.6"/><circle cx="20" cy="60" r="2.6"/>
      <circle cx="64" cy="62" r="1.6"/>
    </g>`),
  // Solo Leveling — a hexagonal system grid.
  hex: c => svgWrap(56, 96, `
    <g fill="none" stroke="${c}" stroke-width="1.2" opacity="0.8">
      <path d="M28 2 L54 17 L54 47 L28 62 L2 47 L2 17 Z"/>
      <path d="M28 50 L54 65 L54 95 L28 110 L2 95 L2 65 Z"/>
    </g>`),
  // Hunter x Hunter — plain cross-hatch, like the manga's screentone.
  hatch: c => svgWrap(24, 24, `
    <g stroke="${c}" stroke-width="1" opacity="0.7">
      <path d="M-4 4 L4 -4 M-4 16 L16 -4 M-4 28 L28 -4 M8 28 L28 8 M20 28 L28 20"/>
    </g>`),
  // Tokyo Ghoul — fracture lines, nothing symmetrical.
  cracks: c => svgWrap(120, 120, `
    <g fill="none" stroke="${c}" stroke-width="1.3" opacity="0.75" stroke-linecap="round">
      <path d="M10 4 L34 38 L22 66 L48 96 L40 118"/>
      <path d="M34 38 L64 30 L92 52"/><path d="M48 96 L84 88 L116 104"/>
      <path d="M92 52 L104 24 M92 52 L118 60"/><path d="M22 66 L0 82"/>
    </g>`),
  // Your Name — scattered stars and one comet.
  stars: c => svgWrap(100, 100, `
    <g fill="${c}" opacity="0.85">
      <circle cx="14" cy="18" r="1.5"/><circle cx="62" cy="10" r="1"/><circle cx="88" cy="34" r="1.6"/>
      <circle cx="34" cy="54" r="1"/><circle cx="70" cy="72" r="1.4"/><circle cx="18" cy="86" r="1.1"/>
      <path d="M44 26 l1.6 4.6 4.6 1.6 -4.6 1.6 -1.6 4.6 -1.6 -4.6 -4.6 -1.6 4.6 -1.6 z"/>
    </g>
    <path d="M78 52 L94 44" stroke="${c}" stroke-width="1.2" opacity="0.6" stroke-linecap="round"/>`),
};

// A corner flourish — a quarter-frame that anchors the layout without
// competing with anything. Drawn once, rotated per corner by the client.
const ornamentSvg = c => dataUri(svgWrap(240, 240, `
  <g fill="none" stroke="${c}" stroke-linecap="round">
    <path d="M0 236 L0 120 a120 120 0 0 1 120 -120 L236 0" stroke-width="2" opacity="0.55"/>
    <path d="M0 200 L0 132 a132 132 0 0 1 132 -132 L200 0" stroke-width="1" opacity="0.35"/>
    <path d="M0 96 L0 60 a60 60 0 0 1 60 -60 L96 0" stroke-width="3" opacity="0.7"/>
  </g>`));

/* ---------------- colour ----------------
   Everything works in HSL: a palette generated by nudging one hue stays
   internally consistent under any hue, which is the point — the alternative is
   ten hand-tuned palettes that each need re-tuning when a banner changes. */

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  const n = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100); l = clamp(l, 0, 100);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = n => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// A full palette from one dominant colour. The accent is the show's own colour
// pulled into a band that stays legible on a dark surface — AniList's dominant
// colour is often a pastel sampled from a bright frame, and used raw it
// vanishes against light text. The neutrals are that same hue at very low
// saturation, which is what stops a skin looking like a coloured accent bolted
// onto stock grey chrome.
function paletteFrom(colorHex) {
  const [h, s0, l0] = rgbToHsl(...hexToRgb(colorHex || "#8b5cf6"));
  const s = clamp(s0 < 25 ? 55 : s0, 45, 85);
  const accent = hsl(h, s, clamp(l0, 58, 70));
  const partner = h + (h > 20 && h < 200 ? 165 : -145);
  const accent2 = hsl(partner, clamp(s - 8, 40, 75), 64);
  return {
    bg: hsl(h, 22, 5), bg2: hsl(h, 20, 8), bg3: hsl(h, 18, 12),
    line: hsl(h, 16, 20), txt: hsl(h, 14, 94), muted: hsl(h, 11, 62),
    accent, accent2,
    // Semantic colours keep their meaning — a premiere must read as a premiere
    // in every skin — but take some of the skin's hue so they don't sit on top
    // of the palette as foreign objects.
    premiere: hsl(38 + (h - 38) * 0.18, 88, 55),
    today: hsl(h, clamp(s, 50, 70), 52),
    good: hsl(142 + (h - 142) * 0.15, 62, 52),
    now: hsl(348 + (h - 348) * 0.12, 92, 66),
    finale: hsl(0 + h * 0.08, 78, 60),
    glow: accent,
  };
}

const slugify = s => String(s || "theme").toLowerCase().normalize("NFKD")
  .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40);

function themeFor(md, recipe) {
  const name = md.title.english || md.title.romaji;
  const p = paletteFrom(md.coverImage && md.coverImage.color);
  const { glow, ...colors } = p;
  const banner = md.bannerImage || null;
  const cover = (md.coverImage && (md.coverImage.extraLarge || md.coverImage.large)) || null;
  const motif = MOTIFS[recipe.motif] || MOTIFS.hatch;

  return {
    id: slugify(name),
    name,
    series: name,
    mediaId: md.id,
    mode: "dark",
    colors,
    glow,
    font: FONTS[recipe.font] || FONTS.oswald,
    shape: SHAPES[recipe.shape] || SHAPES.classic,
    effects: { vignette: 0, grain: 0, scanlines: 0, glowStrength: 0.45, ...recipe.effects },
    // The banner, behind everything. Dimmed and blurred — this sits under a
    // calendar people read times off, and art that competes with the text is
    // art that made the product worse.
    backdrop: banner ? { url: banner, opacity: 0.34, blur: 4, position: "center 20%" } : null,
    // The same art as a band behind the toolbar, sharper and stronger: it is
    // the strip visible on every view, so it carries most of the recognition.
    header: banner ? { url: banner, opacity: 0.62, position: "center 38%" } : null,
    // The poster in a corner with its edges dissolved. Not a transparent
    // character PNG — there is no honest source for one — but masked hard
    // enough that it reads as part of the page rather than a pasted rectangle.
    cutout: cover ? { url: cover, corner: "bottom-right", width: 380, opacity: 0.5, offsetX: -8, offsetY: -8, fade: 0.62, flip: false } : null,
    watermark: cover ? { url: cover, opacity: 0.08 } : null,
    // Drawn from the palette, inlined — see the header comment.
    pattern: { url: dataUri(motif(colors.accent)), opacity: 0.07, size: 160 },
    ornament: { url: ornamentSvg(colors.accent2), corner: "top-left", width: 260, opacity: 0.35, offsetX: 0, offsetY: 0 },
  };
}

/* ---------------- fetch + ship ---------------- */

const QUERY = `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids,type:ANIME){
  id title{ romaji english } bannerImage coverImage{ extraLarge large color }
} } }`;

async function fetchMedia(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const res = await fetch(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { ids: ids.slice(i, i + 50) } }),
    });
    if (!res.ok) throw new Error("AniList HTTP " + res.status);
    const j = await res.json();
    if (j.errors) throw new Error(j.errors[0].message);
    out.push(...((j.data.Page && j.data.Page.media) || []));
  }
  return out;
}

// A skin whose art 404s is worse than a skin with no art, so every remote URL
// is checked before it ships. data: layers need no checking — that is the point
// of them.
async function checkUrls(themes) {
  const urls = new Set();
  for (const t of Object.values(themes)) {
    for (const layer of ["backdrop", "header", "cutout", "watermark", "pattern", "ornament"]) {
      const u = t[layer] && t[layer].url;
      if (u && u.startsWith("https://")) urls.add(u);
    }
    if (t.font && t.font.css) urls.add(t.font.css);
  }
  let bad = 0;
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: "GET", headers: { Range: "bytes=0-0" } });
      if (!r.ok && r.status !== 206) { console.warn(`  ✗ ${r.status} ${u}`); bad++; }
    } catch (err) { console.warn(`  ✗ ${err.message} ${u}`); bad++; }
  }
  console.log(`Checked ${urls.size} remote URLs — ${bad ? `${bad} broken` : "all good"}.`);
  return bad;
}

const args = process.argv.slice(2);
if (args.includes("--check")) {
  const doc = JSON.parse(await readFile(OUT, "utf8"));
  process.exit((await checkUrls(doc.themes)) ? 1 : 0);
}

const extra = args.reduce((acc, a, i) => (a === "--add" && args[i + 1] ? [...acc, +args[i + 1]] : acc), []);
const ids = [...new Set([...Object.keys(SEED).map(Number), ...extra])];
const media = await fetchMedia(ids);

const themes = {};
for (const md of media) {
  // A title added with --add and no recipe gets a sane default rather than
  // nothing — you can refine it in /admin afterwards.
  const recipe = SEED[md.id] || { motif: "hatch", font: "oswald", shape: "classic", effects: {} };
  const t = themeFor(md, recipe);
  themes[t.id] = t;
  console.log(`${t.id.padEnd(30)} ${recipe.motif.padEnd(9)} ${recipe.font.padEnd(10)} ${recipe.shape.padEnd(8)} accent ${t.colors.accent}`);
}

await checkUrls(themes);
await writeFile(OUT, JSON.stringify({ version: SCHEMA_VERSION, generatedAt: new Date().toISOString(), themes }, null, 2) + "\n", "utf8");
console.log(`\nWrote ${Object.keys(themes).length} themes to site/data/themes.json`);
