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
   texture, `font` a display face, `shape` how sharp the whole UI is, `effects`
   what sits over the top, and `rarity` what it costs to own (see
   netlify/functions/_lib/economy.mjs). Add a row, re-run, done.

   `color` is an override for the palette's base hue. AniList publishes a
   dominant colour per title and it is usually the right answer, but it is
   sampled from the cover art — so a show with no colour at all falls back to
   stock violet, and a show whose cover is mostly skin tones gets a palette that
   says nothing about it. Death Note is not beige. Where the override is present
   it is the show's signature colour, not its cover's average.

   RARITY BUDGET, deliberately shaped rather than sprinkled: 5 legendary, 10
   epic, 15 rare, 20 common. The legendaries are the four or five titles someone
   would actually save four thousand Tung Tungs for; making a long tail of them
   would make none of them feel like one. */
const SEED = {
  /* ---- legendary (5) ---- */
  21:     { motif: "seigaiha", font: "bangers",   shape: "bouncy",  rarity: "legendary", effects: { glowStrength: 0.6 } },
  154587: { motif: "runes",    font: "cormorant", shape: "soft",    rarity: "legendary", effects: { vignette: 0.5 } },
  16498:  { motif: "wings",    font: "cinzel",    shape: "brutal",  rarity: "legendary", color: "#8a1f1f", effects: { grain: 0.4, vignette: 0.5 } },
  5114:   { motif: "alchemy",  font: "cinzel",    shape: "classic", rarity: "legendary", color: "#c8102e", effects: { vignette: 0.4 } },
  30:     { motif: "prism",    font: "dela",      shape: "brutal",  rarity: "legendary", color: "#7a3fd6", effects: { scanlines: 0.3, grain: 0.35 } },

  /* ---- epic (10) ---- */
  113415: { motif: "slash",    font: "bebas",     shape: "sharp",   rarity: "epic", effects: { grain: 0.35, glowStrength: 0.8 } },
  101922: { motif: "asanoha",  font: "shippori",  shape: "classic", rarity: "epic", effects: { vignette: 0.35 } },
  127230: { motif: "teeth",    font: "anton",     shape: "brutal",  rarity: "epic", effects: { grain: 0.5 } },
  1535:   { motif: "feather",  font: "playfair",  shape: "sharp",   rarity: "epic", color: "#b3001b", effects: { grain: 0.45, vignette: 0.6 } },
  9253:   { motif: "circuit",  font: "rajdhani",  shape: "tech",    rarity: "epic", color: "#3f8f7a", effects: { scanlines: 0.4, grain: 0.3 } },
  151807: { motif: "hex",      font: "orbitron",  shape: "tech",    rarity: "epic", effects: { scanlines: 0.35, glowStrength: 0.9 } },
  101348: { motif: "runes",    font: "cinzel",    shape: "brutal",  rarity: "epic", color: "#7d4a2a", effects: { grain: 0.5, vignette: 0.45 } },
  21519:  { motif: "stars",    font: "sawarabi",  shape: "soft",    rarity: "epic", effects: { vignette: 0.45 } },
  199:    { motif: "spirit",   font: "yuji",      shape: "soft",    rarity: "epic", color: "#c0392b", effects: { vignette: 0.4 } },
  120377: { motif: "glitch",   font: "zendots",   shape: "tech",    rarity: "epic", color: "#ffe600", effects: { scanlines: 0.55, glowStrength: 1 } },

  /* ---- rare (15) ---- */
  11061:  { motif: "hatch",    font: "titan",     shape: "classic", rarity: "rare", effects: {} },
  20605:  { motif: "cracks",   font: "oswald",    shape: "brutal",  rarity: "rare", effects: { grain: 0.55, vignette: 0.5 } },
  140960: { motif: "hearts",   font: "baloo",     shape: "bouncy",  rarity: "rare", effects: { vignette: 0.2 } },
  21507:  { motif: "spiral",   font: "russo",     shape: "bouncy",  rarity: "rare", color: "#4fb286", effects: { glowStrength: 0.8 } },
  21087:  { motif: "target",   font: "anton",     shape: "sharp",   rarity: "rare", color: "#f2c200", effects: { glowStrength: 0.7 } },
  97986:  { motif: "leaf",     font: "cormorant", shape: "soft",    rarity: "rare", color: "#3f8f5a", effects: { vignette: 0.5 } },
  21827:  { motif: "feather",  font: "playfair",  shape: "soft",    rarity: "rare", effects: { vignette: 0.3 } },
  20954:  { motif: "bubble",   font: "fredoka",   shape: "round",   rarity: "rare", effects: { vignette: 0.25 } },
  21355:  { motif: "clock",    font: "cormorant", shape: "classic", rarity: "rare", color: "#5b6fd6", effects: { vignette: 0.4 } },
  150672: { motif: "starburst",font: "unbounded", shape: "neo",     rarity: "rare", color: "#ff35c9", effects: { glowStrength: 0.9 } },
  130003: { motif: "notes",    font: "fredoka",   shape: "round",   rarity: "rare", color: "#e86ea4", effects: { glowStrength: 0.6 } },
  171018: { motif: "spiral",   font: "dela",      shape: "bouncy",  rarity: "rare", color: "#7be04a", effects: { glowStrength: 0.85, grain: 0.25 } },
  47:     { motif: "glitch",   font: "russo",     shape: "brutal",  rarity: "rare", color: "#d81e2f", effects: { grain: 0.5, scanlines: 0.35 } },
  1575:   { motif: "wings",    font: "cinzel",    shape: "sharp",   rarity: "rare", color: "#8f2fd6", effects: { vignette: 0.45 } },
  2001:   { motif: "drill",    font: "titan",     shape: "bouncy",  rarity: "rare", color: "#f1442e", effects: { glowStrength: 0.9 } },

  /* ---- common (20) ---- */
  1:      { motif: "rain",     font: "space",     shape: "classic", rarity: "common", color: "#3f7fa8", effects: { grain: 0.4, vignette: 0.4 } },
  116674: { motif: "slash",    font: "kanit",     shape: "sharp",   rarity: "common", effects: { grain: 0.3 } },
  21459:  { motif: "chevron",  font: "russo",     shape: "bouncy",  rarity: "common", color: "#2f7fd6", effects: { glowStrength: 0.7 } },
  21202:  { motif: "bubble",   font: "fredoka",   shape: "round",   rarity: "common", effects: {} },
  137822: { motif: "grid",     font: "kanit",     shape: "tech",    rarity: "common", effects: { glowStrength: 0.7 } },
  105333: { motif: "circuit",  font: "syne",      shape: "classic", rarity: "common", color: "#8fbf3f", effects: {} },
  20464:  { motif: "chevron",  font: "kanit",     shape: "bouncy",  rarity: "common", effects: {} },
  101921: { motif: "hearts",   font: "playfair",  shape: "classic", rarity: "common", effects: { vignette: 0.3 } },
  124080: { motif: "dots",     font: "fredoka",   shape: "round",   rarity: "common", effects: {} },
  4224:   { motif: "dots",     font: "baloo",     shape: "round",   rarity: "common", effects: {} },
  20665:  { motif: "notes",    font: "playfair",  shape: "soft",    rarity: "common", effects: { vignette: 0.35 } },
  108465: { motif: "runes",    font: "cormorant", shape: "classic", rarity: "common", effects: {} },
  43:     { motif: "circuit",  font: "rajdhani",  shape: "tech",    rarity: "common", color: "#2fb3a8", effects: { scanlines: 0.45 } },
  339:    { motif: "glitch",   font: "space",     shape: "tech",    rarity: "common", color: "#a05fd6", effects: { scanlines: 0.6, grain: 0.5 } },
  5680:   { motif: "notes",    font: "fredoka",   shape: "round",   rarity: "common", effects: {} },
  161645: { motif: "asanoha",  font: "yuji",      shape: "soft",    rarity: "common", color: "#c0623f", effects: { vignette: 0.3 } },
  153288: { motif: "triangle", font: "unbounded", shape: "sharp",   rarity: "common", color: "#3f6fd6", effects: { glowStrength: 0.8 } },
  153518: { motif: "scales",   font: "cinzel",    shape: "classic", rarity: "common", color: "#c98a3f", effects: { vignette: 0.35 } },
  11757:  { motif: "grid",     font: "orbitron",  shape: "tech",    rarity: "common", color: "#3fa8d6", effects: { glowStrength: 0.6 } },
  164:    { motif: "leaf",     font: "yuji",      shape: "soft",    rarity: "common", color: "#4f7a4a", effects: { vignette: 0.45 } },
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
  cinzel:    { family: '"Cinzel",Georgia,serif',             css: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap", scale: 1.06 },
  playfair:  { family: '"Playfair Display",Georgia,serif',   css: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&display=swap", scale: 1.08 },
  russo:     { family: '"Russo One",Impact,sans-serif',      css: "https://fonts.googleapis.com/css2?family=Russo+One&display=swap", scale: 1.04 },
  rajdhani:  { family: '"Rajdhani",Verdana,sans-serif',      css: "https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&display=swap", scale: 1.14 },
  kanit:     { family: '"Kanit",Verdana,sans-serif',         css: "https://fonts.googleapis.com/css2?family=Kanit:wght@600;700&display=swap", scale: 1.06 },
  space:     { family: '"Space Grotesk",Verdana,sans-serif', css: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&display=swap", scale: 1.02 },
  syne:      { family: '"Syne",Verdana,sans-serif',          css: "https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap", scale: 1.04 },
  unbounded: { family: '"Unbounded",Verdana,sans-serif',     css: "https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&display=swap", scale: 1.0 },
  zendots:   { family: '"Zen Dots",Verdana,sans-serif',      css: "https://fonts.googleapis.com/css2?family=Zen+Dots&display=swap", scale: 0.98 },
  dela:      { family: '"Dela Gothic One",Impact,sans-serif',css: "https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap", scale: 1.02 },
  fredoka:   { family: '"Fredoka",Verdana,sans-serif',       css: "https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&display=swap", scale: 1.1 },
  yuji:      { family: '"Yuji Syuku",Georgia,serif',         css: "https://fonts.googleapis.com/css2?family=Yuji+Syuku&display=swap", scale: 1.08 },
};

const SHAPES = {
  soft:    { radius: 16, chipRadius: 24, border: 1, cardBlur: 14 },
  classic: { radius: 10, chipRadius: 18, border: 1, cardBlur: 10 },
  bouncy:  { radius: 20, chipRadius: 28, border: 2, cardBlur: 12 },
  sharp:   { radius: 3,  chipRadius: 4,  border: 2, cardBlur: 8 },
  brutal:  { radius: 0,  chipRadius: 2,  border: 2, cardBlur: 6 },
  tech:    { radius: 4,  chipRadius: 6,  border: 1, cardBlur: 16 },
  round:   { radius: 26, chipRadius: 30, border: 1, cardBlur: 18 },
  neo:     { radius: 24, chipRadius: 30, border: 2, cardBlur: 22 },
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

  /* ---- added with the skin economy ----
     Fifty skins need more than ten textures: past about a dozen themes the
     motif stops being decoration and becomes the thing that tells two skins
     apart at a glance in the gallery grid. Same rules as above — tileable, no
     apostrophes or parentheses, stroked from one palette colour. */

  // Attack on Titan — the Survey Corps wings, reduced to two opposed sweeps.
  wings: c => svgWrap(120, 80, `
    <g fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="0.8">
      <path d="M60 58 C44 52 30 40 22 22 C38 30 50 38 60 48"/>
      <path d="M60 58 C76 52 90 40 98 22 C82 30 70 38 60 48"/>
      <path d="M60 46 L60 68"/>
    </g>`),
  // Fullmetal Alchemist — a transmutation circle, quartered.
  alchemy: c => svgWrap(120, 120, `
    <g fill="none" stroke="${c}" stroke-width="1.2" opacity="0.75">
      <circle cx="60" cy="60" r="44"/><circle cx="60" cy="60" r="30"/>
      <path d="M60 16 L98 82 L22 82 Z"/>
      <path d="M60 104 L22 38 L98 38 Z"/>
    </g>`),
  // Evangelion — a refracted beam, all hard angles and no curves.
  prism: c => svgWrap(110, 110, `
    <g fill="none" stroke="${c}" stroke-width="1.4" opacity="0.75">
      <path d="M10 96 L48 20 L86 96 Z"/>
      <path d="M0 62 L34 62 M62 62 L110 42 M62 70 L110 78 M62 78 L110 100"/>
    </g>`),
  // Death Note / Violet Evergarden — a falling quill feather.
  feather: c => svgWrap(90, 120, `
    <g fill="none" stroke="${c}" stroke-width="1.1" opacity="0.8">
      <path d="M44 8 C22 40 20 76 40 112"/>
      <path d="M44 22 L24 34 M46 38 L26 50 M48 54 L28 66 M50 70 L32 82 M52 86 L36 96"/>
      <path d="M44 22 L62 30 M46 38 L64 46 M48 54 L66 62 M50 70 L66 78"/>
    </g>`),
  // Steins;Gate / Ghost in the Shell / Dr. Stone — board traces and vias.
  circuit: c => svgWrap(96, 96, `
    <g fill="none" stroke="${c}" stroke-width="1.1" opacity="0.75">
      <path d="M0 24 L28 24 L28 52 L60 52 L60 20 L96 20"/>
      <path d="M0 72 L20 72 L20 92 M44 96 L44 68 L96 68"/>
      <path d="M68 96 L68 84 L96 84"/>
    </g>
    <g fill="${c}" opacity="0.8">
      <circle cx="28" cy="24" r="2.4"/><circle cx="60" cy="52" r="2.4"/>
      <circle cx="44" cy="68" r="2.4"/><circle cx="20" cy="72" r="2"/>
    </g>`),
  // Edgerunners / Akira / Lain — a signal that lost some rows.
  glitch: c => svgWrap(100, 60, `
    <g fill="${c}" opacity="0.7">
      <rect x="0" y="6" width="38" height="3"/><rect x="46" y="6" width="22" height="3"/>
      <rect x="12" y="20" width="56" height="2"/><rect x="76" y="20" width="18" height="2"/>
      <rect x="0" y="34" width="20" height="4"/><rect x="30" y="34" width="64" height="4"/>
      <rect x="24" y="48" width="30" height="2"/><rect x="62" y="48" width="34" height="2"/>
    </g>`),
  // Spirited Away — a torii gate and a soot sprite.
  spirit: c => svgWrap(110, 110, `
    <g fill="none" stroke="${c}" stroke-width="1.6" opacity="0.75">
      <path d="M18 26 L92 26 M22 36 L88 36 M30 26 L30 88 M80 26 L80 88"/>
      <path d="M14 22 L96 22"/>
    </g>
    <g fill="${c}" opacity="0.55">
      <circle cx="55" cy="70" r="6"/><circle cx="52" cy="68" r="1.2"/><circle cx="58" cy="68" r="1.2"/>
    </g>`),
  // Mob Psycho / Dandadan — psychic spirals, off-centre on purpose.
  spiral: c => svgWrap(100, 100, `
    <g fill="none" stroke="${c}" stroke-width="1.3" opacity="0.75">
      <path d="M50 20 a30 30 0 1 1 -21 51 a22 22 0 1 0 15 -37 a14 14 0 1 1 10 24"/>
    </g>`),
  // One Punch Man — a fist-shaped impact, drawn as a burst.
  target: c => svgWrap(100, 100, `
    <g fill="none" stroke="${c}" stroke-width="1.3" opacity="0.7">
      <circle cx="50" cy="50" r="12"/><circle cx="50" cy="50" r="26"/>
      <path d="M50 4 L50 20 M50 80 L50 96 M4 50 L20 50 M80 50 L96 50"/>
      <path d="M18 18 L30 30 M82 18 L70 30 M18 82 L30 70 M82 82 L70 70"/>
    </g>`),
  // Made in Abyss / Mononoke — veins of a leaf, layered.
  leaf: c => svgWrap(90, 110, `
    <g fill="none" stroke="${c}" stroke-width="1.1" opacity="0.8">
      <path d="M45 6 C18 34 18 76 45 104 C72 76 72 34 45 6 Z"/>
      <path d="M45 10 L45 100"/>
      <path d="M45 28 L26 38 M45 46 L22 58 M45 64 L26 76 M45 82 L32 92"/>
      <path d="M45 28 L64 38 M45 46 L68 58 M45 64 L64 76 M45 82 L58 92"/>
    </g>`),
  // A Silent Voice / Konosuba — bubbles rising, unevenly.
  bubble: c => svgWrap(90, 90, `
    <g fill="none" stroke="${c}" stroke-width="1.2" opacity="0.75">
      <circle cx="20" cy="24" r="9"/><circle cx="58" cy="14" r="5"/><circle cx="74" cy="44" r="11"/>
      <circle cx="34" cy="60" r="6"/><circle cx="12" cy="76" r="4"/><circle cx="60" cy="78" r="7"/>
    </g>`),
  // Re:Zero — clock hands at every wrong hour.
  clock: c => svgWrap(110, 110, `
    <g fill="none" stroke="${c}" stroke-width="1.2" opacity="0.75">
      <circle cx="55" cy="55" r="40"/>
      <path d="M55 55 L55 24 M55 55 L78 66"/>
      <path d="M55 17 L55 23 M55 87 L55 93 M17 55 L23 55 M87 55 L93 55"/>
    </g>`),
  // Oshi no Ko — a four-pointed idol star with its own light.
  starburst: c => svgWrap(96, 96, `
    <g fill="${c}" opacity="0.75">
      <path d="M48 8 C52 34 62 44 88 48 C62 52 52 62 48 88 C44 62 34 52 8 48 C34 44 44 34 48 8 Z"/>
    </g>
    <g fill="${c}" opacity="0.5">
      <path d="M16 12 C18 20 21 23 29 25 C21 27 18 30 16 38 C14 30 11 27 3 25 C11 23 14 20 16 12 Z"/>
    </g>`),
  // Bocchi / K-On! / Your Lie in April — beams and a rest.
  notes: c => svgWrap(100, 80, `
    <g fill="none" stroke="${c}" stroke-width="1.3" opacity="0.8">
      <path d="M26 54 L26 14 L58 8 L58 46"/><path d="M26 24 L58 18"/>
    </g>
    <g fill="${c}" opacity="0.8">
      <ellipse cx="19" cy="56" rx="8" ry="6" transform="rotate(-18 19 56)"/>
      <ellipse cx="51" cy="48" rx="8" ry="6" transform="rotate(-18 51 48)"/>
    </g>
    <path d="M78 22 L78 62" stroke="${c}" stroke-width="1.1" opacity="0.5"/>`),
  // Gurren Lagann — the drill, repeated as a chevron stack.
  drill: c => svgWrap(70, 100, `
    <g fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" opacity="0.8">
      <path d="M35 6 L58 34 L12 34 Z"/>
      <path d="M35 34 L54 56 L16 56 Z"/>
      <path d="M35 56 L50 74 L20 74 Z"/>
      <path d="M35 74 L45 88 L25 88 Z"/>
    </g>`),
  // MHA / Haikyuu — a bold moving chevron.
  chevron: c => svgWrap(60, 40, `
    <g fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity="0.6">
      <path d="M4 6 L28 20 L4 34"/><path d="M32 6 L56 20 L32 34"/>
    </g>`),
  // Horimiya / Toradora — plain polka, the friendliest texture there is.
  dots: c => svgWrap(48, 48, `
    <g fill="${c}" opacity="0.75">
      <circle cx="12" cy="12" r="3"/><circle cx="36" cy="36" r="3"/>
      <circle cx="36" cy="12" r="1.4"/><circle cx="12" cy="36" r="1.4"/>
    </g>`),
  // Blue Lock / SAO — a field grid with lit intersections.
  grid: c => svgWrap(64, 64, `
    <g stroke="${c}" stroke-width="0.9" opacity="0.55">
      <path d="M0 0 L64 0 M0 32 L64 32 M0 0 L0 64 M32 0 L32 64"/>
    </g>
    <g fill="${c}" opacity="0.8"><circle cx="32" cy="32" r="1.8"/><circle cx="0" cy="0" r="1.8"/></g>`),
  // Kaiju No. 8 — tessellated triangles, half of them filled.
  triangle: c => svgWrap(60, 52, `
    <g fill="none" stroke="${c}" stroke-width="1.1" opacity="0.7">
      <path d="M0 52 L15 0 L30 52 Z"/><path d="M30 52 L45 0 L60 52 Z"/>
    </g>
    <g fill="${c}" opacity="0.35"><path d="M15 0 L30 52 L45 0 Z"/></g>`),
  // Delicious in Dungeon — dragon scales, overlapping.
  scales: c => svgWrap(60, 34, `
    <g fill="none" stroke="${c}" stroke-width="1.2" opacity="0.75">
      <path d="M0 34 a15 17 0 0 1 30 0 a15 17 0 0 1 30 0"/>
      <path d="M-15 17 a15 17 0 0 1 30 0 a15 17 0 0 1 30 0 a15 17 0 0 1 30 0"/>
    </g>`),
  // Cowboy Bebop — rain on a window, one direction, never even.
  rain: c => svgWrap(80, 90, `
    <g stroke="${c}" stroke-width="1.1" stroke-linecap="round" opacity="0.6">
      <path d="M10 0 L2 22 M34 0 L26 26 M60 4 L52 24 M74 0 L66 18"/>
      <path d="M20 40 L12 64 M46 36 L38 62 M68 44 L60 66"/>
      <path d="M6 70 L0 88 M32 74 L26 90 M56 72 L48 90"/>
    </g>`),
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

// The id is permanent: it is what a wallet stores when someone owns the skin, so
// renaming one later orphans every ownership row pointing at it. Trimming dashes
// happens AFTER the 40-character cut, because the cut is what creates them —
// "Re:ZERO -Starting Life in Another World-" landed on a trailing dash.
const slugify = s => String(s || "theme").toLowerCase().normalize("NFKD")
  .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-")
  .slice(0, 40).replace(/^-+|-+$/g, "") || "theme";

function themeFor(md, recipe) {
  const name = md.title.english || md.title.romaji;
  // The recipe's colour wins where it is given. AniList's dominant colour is
  // sampled from the cover, which is the right answer for most titles and a
  // useless one for the rest: a show with no colour at all lands on stock
  // violet, and a cover that is mostly a face lands on a skin tone. Neither
  // says anything about the show.
  const p = paletteFrom(recipe.color || (md.coverImage && md.coverImage.color));
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
    // What it costs to own — see netlify/functions/_lib/economy.mjs. A missing
    // rarity reads as Common everywhere, so an --add title is buyable rather
    // than unreachable until someone gets round to classifying it.
    rarity: recipe.rarity || "common",
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
  const recipe = SEED[md.id] || { motif: "hatch", font: "oswald", shape: "classic", rarity: "common", effects: {} };
  if (!MOTIFS[recipe.motif]) console.warn(`  ! ${md.id}: no motif "${recipe.motif}" — falling back to hatch`);
  if (!FONTS[recipe.font]) console.warn(`  ! ${md.id}: no font "${recipe.font}" — falling back to oswald`);
  if (!SHAPES[recipe.shape]) console.warn(`  ! ${md.id}: no shape "${recipe.shape}" — falling back to classic`);
  const t = themeFor(md, recipe);
  themes[t.id] = t;
  console.log(`${t.id.padEnd(28)} ${String(t.rarity).padEnd(10)} ${recipe.motif.padEnd(10)} ${recipe.font.padEnd(10)} ${recipe.shape.padEnd(8)} accent ${t.colors.accent}${recipe.color ? "  (colour set by hand)" : ""}`);
}
const byRarity = Object.values(themes).reduce((m, t) => { m[t.rarity] = (m[t.rarity] || 0) + 1; return m; }, {});
console.log("\nBy rarity: " + Object.entries(byRarity).map(([r, n]) => `${r} ${n}`).join(" · "));

await checkUrls(themes);
await writeFile(OUT, JSON.stringify({ version: SCHEMA_VERSION, generatedAt: new Date().toISOString(), themes }, null, 2) + "\n", "utf8");
console.log(`\nWrote ${Object.keys(themes).length} themes to site/data/themes.json`);
