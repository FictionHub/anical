// xml-lite — a tiny dependency-free XML reader for the function runtime.
//
// Why it exists: two ingest adapters (ann.mjs, studio.mjs) parse XML payloads
// from sources that publish nothing else, but the Node function runtime has no
// DOMParser and the functions intentionally install zero dependencies beyond
// what Netlify itself needs. This module covers the slice those payloads
// actually use: flat element lists with attributes, text content, CDATA
// sections and entity escapes — think RSS <item> blocks or ANN's iseries of
// <info type="..."> records.
//
// What it does NOT do: namespaces, attributes containing ">" entities beyond
// quoted basics, or nesting of the SAME tag inside itself. Those shapes simply
// don't occur in the payloads we read; if one ever returns wrong data, run the
// ingest:test suite against a real sample before trusting a parse.

// Decode the five XML predeclared entities plus numeric character references
// (&#039; and &#x27;). Done in char order so "&amp;lt;" stays "&lt;" and does
// not decode twice.
export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Parse an open tag's attribute string: 'id="12345" type=\'TV\''.
export function parseAttrs(s) {
  const out = {};
  const re = /([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m; (m = re.exec(s)); ) out[m[1]] = m[2] ?? m[3] ?? "";
  return out;
}

// Every <tag ...>…</tag> (or self-closing <tag .../>) in the document, in
// document order. Nested foreign tags stay inside `inner`; a same-name tag
// inside itself would end the outer element early — not supported, by design.
export function extractElements(xml, tagName) {
  const open = new RegExp(`<${tagName}(\\s[^>]*?)?/?>`, "g");
  const out = [];
  for (let m; (m = open.exec(xml)); ) {
    const attrs = parseAttrs(m[1] || "");
    const selfClosed = /[/:]>$/.test(m[0]);
    let inner = "";
    if (!selfClosed) {
      const close = `</${tagName}>`;
      const end = xml.indexOf(close, open.lastIndex);
      if (end === -1) break;
      inner = xml.slice(open.lastIndex, end);
      open.lastIndex = end + close.length;   // continue the scan past the element
    }
    out.push({ attrs, inner });
  }
  return out;
}

// Inner markup → readable text: CDATA unwrapped, remaining tags dropped,
// entities decoded, whitespace collapsed.
export function textOf(inner) {
  const noCdata = String(inner).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(noCdata.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// URL inside a piece of inner markup (used to dig cover-image sources out of
// bundled <img> tags). Returns the first match or null.
export function firstUrlOf(inner) {
  const m = String(inner).match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}
