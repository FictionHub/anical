/* ============================================================
   Tsuzuki — Events data builder (self-sustaining, worldwide)
   Scrapes the upcoming anime-convention list from AnimeCons.com
   (worldwide: US, Canada, UK, Germany, Japan, Australia, …) and
   writes site/events.json with lat/lon so the website's Events
   view can sort/filter by distance from the user.

   Geocoding uses the free, key-less Open-Meteo geocoding API and a
   committed cache (scripts/geocache.json) so each city is looked up
   at most once. Runs in GitHub Actions (server-side → no CORS),
   zero npm deps. Robust: browser UA (the site 403s bots), skips
   Cancelled events, and refuses to overwrite a good events.json if
   the scrape yields too few rows.

   Run locally:  node scripts/build-events.mjs
   ============================================================ */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "events.json");
const CACHE = join(ROOT, "scripts", "geocache.json");
const SRC = "https://animecons.com/events/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MIN_OK = 20, MAX_KEEP = 500;

const MONTHS = { January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11 };
const iso = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(+d).padStart(2,"0")}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const ENT = { amp:"&", lt:"<", gt:">", quot:'"', "#39":"'", apos:"'", nbsp:" ",
  ouml:"ö",Ouml:"Ö",auml:"ä",Auml:"Ä",uuml:"ü",Uuml:"Ü",szlig:"ß",
  eacute:"é",egrave:"è",ecirc:"ê",agrave:"à",acirc:"â",ccedil:"ç",ntilde:"ñ",
  oacute:"ó",aacute:"á",iacute:"í",uacute:"ú",ograve:"ò",ugrave:"ù",oslash:"ø",aring:"å" };
function decodeHtml(s){
  return String(s).replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n))
    .replace(/&([a-z0-9]+);/gi,(m,n)=>ENT[n]!=null?ENT[n]:(ENT[n.toLowerCase()]!=null?ENT[n.toLowerCase()]:m));
}
const stripTags = s => decodeHtml(s.replace(/<[^>]+>/g,"")).replace(/\s+/g," ").trim();

const US_STATES = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia"};
const COUNTRIES = {UK:"GB","United Kingdom":"GB",Canada:"CA",Germany:"DE",Japan:"JP",France:"FR",Australia:"AU",Mexico:"MX",Italy:"IT",Spain:"ES",Netherlands:"NL",Belgium:"BE",Brazil:"BR","New Zealand":"NZ",Ireland:"IE",Austria:"AT",Switzerland:"CH",Sweden:"SE",Norway:"NO",Finland:"FI",Denmark:"DK",Poland:"PL",Portugal:"PT",Singapore:"SG",Philippines:"PH",Malaysia:"MY",Indonesia:"ID",Chile:"CL",Argentina:"AR",Colombia:"CO",Peru:"PE","South Korea":"KR",Taiwan:"TW","Hong Kong":"HK"};

function parseLoc(loc){
  const t = loc.split(",").map(s=>s.trim()).filter(Boolean);
  if(!t.length) return null;
  const tail = t[t.length-1];
  if(COUNTRIES[tail]!=null){
    const cc = COUNTRIES[tail];
    const city = t.length>=4 ? t[t.length-3] : t[t.length-2] || t[0];
    return { city, cc, admin1:null };
  }
  // assume US/territory state code in the tail
  const city = t[t.length-2] || t[0];
  return { city, cc:"US", admin1: US_STATES[tail] || null };
}

function parse(html){
  const out=[];
  const rowRe=/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
  let r;
  while((r=rowRe.exec(html))){
    const [,c1,c2,c3]=r;
    const link=c1.match(/<a href="(\/events\/info\/[^"]+)">([\s\S]*?)<\/a>/);
    if(!link) continue;
    if(/label-danger|<strike>/i.test(c1)) continue;       // skip Cancelled
    const name=stripTags(link[2]), d=parseDate(stripTags(c2));
    if(!name||!d) continue;
    const location=stripTags(c3.replace(/<br\s*\/?>/gi,", "));
    const online=/online|virtual|stream/i.test(location)||/online/i.test(name);
    const ev={ id:"ac"+(link[1].match(/\/info\/(\d+)/)?.[1]||out.length), title:name, start:d.start,
      type:online?"Online Showcase":"Convention", location, url:"https://animecons.com"+link[1], approx:false };
    if(d.end&&d.end!==d.start) ev.end=d.end;
    out.push(ev);
  }
  return out;
}
function parseDate(s){
  s=s.replace(/\s+/g," ").trim(); let m;
  if((m=s.match(/^([A-Za-z]+) (\d{1,2})\s*[–-]\s*([A-Za-z]+) (\d{1,2}), (\d{4})$/))){
    const[,a,d1,b,d2,y]=m; if(!(a in MONTHS)||!(b in MONTHS))return null; let y1=+y; if(MONTHS[a]>MONTHS[b])y1=+y-1;
    return {start:iso(y1,MONTHS[a],d1),end:iso(+y,MONTHS[b],d2)};
  }
  if((m=s.match(/^([A-Za-z]+) (\d{1,2})\s*[–-]\s*(\d{1,2}), (\d{4})$/))){
    const[,mo,d1,d2,y]=m; if(!(mo in MONTHS))return null; return {start:iso(+y,MONTHS[mo],d1),end:iso(+y,MONTHS[mo],d2)};
  }
  if((m=s.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/))){
    const[,mo,d,y]=m; if(!(mo in MONTHS))return null; return {start:iso(+y,MONTHS[mo],d)};
  }
  return null;
}

async function geocode(city, cc, admin1){
  const res=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`,
    {headers:{Accept:"application/json"}});
  if(!res.ok) throw new Error("geo HTTP "+res.status);
  const rs=(await res.json()).results||[];
  const pick = rs.find(r=>(!cc||r.country_code===cc)&&(!admin1||r.admin1===admin1))
            || rs.find(r=>!cc||r.country_code===cc) || rs[0];
  return pick ? { lat:+pick.latitude.toFixed(4), lon:+pick.longitude.toFixed(4) } : null;
}

(async()=>{
  let html;
  try{ const res=await fetch(SRC,{headers:{"User-Agent":UA,Accept:"text/html"}}); if(!res.ok)throw new Error("HTTP "+res.status); html=await res.text(); }
  catch(e){ console.warn("Fetch failed:",e.message,"— keeping existing events.json."); process.exit(0); }

  const todayISO=new Date().toISOString().slice(0,10);
  const seen=new Set();
  let events=parse(html).filter(e=>(e.end||e.start)>=todayISO)
    .filter(e=>seen.has(e.id)?false:(seen.add(e.id),true))
    .sort((a,b)=>a.start.localeCompare(b.start)).slice(0,MAX_KEEP);

  if(events.length<MIN_OK){ console.warn(`Only ${events.length} events (<${MIN_OK}) — keeping existing file.`); process.exit(0); }

  // merge curated supplement — major events AnimeCons doesn't list (AnimeJapan, Jump Festa, TGS…)
  try{
    const extra=JSON.parse(await readFile(join(ROOT,"scripts","events-extra.json"),"utf8"));
    if(Array.isArray(extra)){
      const have=new Set(events.map(e=>e.id));
      let added=0;
      for(const e of extra) if(e&&e.start&&(e.end||e.start)>=todayISO&&!have.has(e.id)){ events.push(e); have.add(e.id); added++; }
      events.sort((a,b)=>a.start.localeCompare(b.start));
      console.log(`Merged ${added} supplemental event(s) from events-extra.json.`);
    }
  }catch(err){ console.warn("events-extra.json:",err.message); }

  // geocode (cached)
  let cache={}; try{ cache=JSON.parse(await readFile(CACHE,"utf8")); }catch{}
  let lookups=0;
  for(const e of events){
    const p=parseLoc(e.location); if(!p||!p.city) continue;
    const key=`${p.city}|${p.cc}|${p.admin1||""}`;
    if(!(key in cache)){
      try{ cache[key]=await geocode(p.city,p.cc,p.admin1); lookups++; await sleep(120); }
      catch(err){ console.warn("geocode failed for",key,err.message); cache[key]=null; }
    }
    const g=cache[key];
    if(g){ e.lat=g.lat; e.lon=g.lon; }
  }
  await writeFile(CACHE, JSON.stringify(cache,null,0)+"\n", "utf8");
  console.log(`Geocoded ${lookups} new cities (${Object.keys(cache).length} cached); ${events.filter(e=>e.lat!=null).length}/${events.length} events have coords.`);

  let prev=null; try{ prev=await readFile(OUT,"utf8"); }catch{}
  const next=JSON.stringify(events,null,2)+"\n";
  if(prev===next){ console.log(`No change (${events.length} events).`); process.exit(0); }
  await writeFile(OUT, next, "utf8");
  console.log(`✅ Wrote ${events.length} worldwide events to site/events.json (source: AnimeCons.com)`);
})().catch(e=>{ console.warn("Non-fatal:",e.message); process.exit(0); });
