#!/usr/bin/env node
/* Pure-logic checks over the /today/ renderer in netlify/functions/today.mjs.
   No network, no Blobs, no real clock: renderToday() is handed a fixed media
   array and a fixed timestamp, so every assertion below is about the rendering
   and nothing else.

   The bug this file exists to prevent: /today/ shipped for months as a static
   page baked weekly, so it named the wrong day. The first test is therefore the
   one that matters — the date in the output has to be the date passed in.

   Run with: npm run today:test */
import { renderToday } from "../netlify/functions/today.mjs";

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n         ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const has = (hay, needle) => assert(hay.includes(needle), `expected output to contain ${JSON.stringify(needle)}`);
const hasnt = (hay, needle) => assert(!hay.includes(needle), `expected output NOT to contain ${JSON.stringify(needle)}`);

// 2026-08-17T12:00:00Z, a Monday.
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);
const D = (h, m = 0) => Math.floor(Date.UTC(2026, 7, 17, h, m, 0) / 1000);

const show = (id, name, over = {}) => ({
  id, title: { english: name, romaji: name }, format: "TV", episodes: 12,
  genres: ["Action"], averageScore: 70, popularity: 5000, status: "RELEASING",
  season: "SUMMER", seasonYear: 2026, coverImage: { medium: "https://x/c.jpg" },
  startDate: { year: 2026, month: 7, day: 5 }, endDate: {},
  studios: { nodes: [{ name: "Studio X" }] }, airingSchedule: { nodes: [] }, ...over,
});

console.log("today: date");
check("names the day it was rendered for, not the day it was built", () => {
  const html = renderToday([show(1, "Alpha", { airingSchedule: { nodes: [{ airingAt: D(14), episode: 3 }] } })], NOW);
  has(html, "Monday, August 17, 2026");
  hasnt(html, "August 13");
});
check("canonical stays /today/ regardless of the date", () => {
  has(renderToday([], NOW), `href="https://tsuzuki.top/today/"`);
});

console.log("today: episode selection");
check("includes episodes inside the UTC day", () => {
  const html = renderToday([show(1, "Alpha", { airingSchedule: { nodes: [{ airingAt: D(0), episode: 1 }, { airingAt: D(23, 59), episode: 2 }] } })], NOW);
  has(html, "Episode 1");
  has(html, "Episode 2");
});
check("excludes episodes outside the UTC day", () => {
  const before = Math.floor(Date.UTC(2026, 7, 16, 23, 59) / 1000);
  const after = Math.floor(Date.UTC(2026, 7, 18, 0, 1) / 1000);
  const html = renderToday([
    show(1, "Yesterday", { airingSchedule: { nodes: [{ airingAt: before, episode: 9 }] } }),
    show(2, "Tomorrow", { airingSchedule: { nodes: [{ airingAt: after, episode: 9 }] } }),
  ], NOW);
  hasnt(html, "Yesterday");
  hasnt(html, "Tomorrow");
});
check("orders by air time", () => {
  const html = renderToday([
    show(1, "Late", { airingSchedule: { nodes: [{ airingAt: D(20), episode: 1 }] } }),
    show(2, "Early", { airingSchedule: { nodes: [{ airingAt: D(6), episode: 1 }] } }),
  ], NOW);
  assert(html.indexOf("Early") < html.indexOf("Late"), "Early should render before Late");
});

console.log("today: safety and edges");
check("drops adult titles", () => {
  const html = renderToday([show(1, "Nope", { isAdult: true, airingSchedule: { nodes: [{ airingAt: D(12), episode: 1 }] } })], NOW);
  hasnt(html, "Nope");
});
check("an empty day still renders a valid page", () => {
  const html = renderToday([], NOW);
  has(html, "<!DOCTYPE html>");
  has(html, "No episodes are scheduled");
  has(html, "Monday, August 17, 2026");
});
check("tolerates media with no airingSchedule at all", () => {
  has(renderToday([show(1, "Bare", { airingSchedule: null })], NOW), "<!DOCTYPE html>");
});
check("counts premieres and finales in the lede", () => {
  const html = renderToday([
    show(1, "Prem", { airingSchedule: { nodes: [{ airingAt: D(9), episode: 1 }] } }),
    show(2, "Fin", { episodes: 12, airingSchedule: { nodes: [{ airingAt: D(10), episode: 12 }] } }),
  ], NOW);
  has(html, "1 premiere");
  has(html, "1 finale");
});
check("links every listed show to its own page", () => {
  const html = renderToday([show(1, "Alpha Beta", { airingSchedule: { nodes: [{ airingAt: D(12), episode: 4 }] } })], NOW);
  has(html, `href="/anime/alpha-beta-1/"`);
});
check("season nav is built around the rendered date, not the build date", () => {
  // 17 Aug 2026 is SUMMER 2026, so the window is Spring 2026 → Winter 2027.
  const html = renderToday([], NOW);
  for (const s of ["spring-2026", "summer-2026", "fall-2026", "winter-2027"]) has(html, `href="/${s}/"`);
});

console.log(failures ? `\n${failures} failing check(s).` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
