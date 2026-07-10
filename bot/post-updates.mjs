/* ============================================================
   Tsuzuki community — channel updater bot
   Pulls the SAME data as https://tsuzuki.netlify.app and posts
   it as embeds into #this-week, #premieres, #finales, #anime-news.

   Sources:  AniList GraphQL (schedules) + Anime News Network via rss2json.
   Times use Discord <t:..> markup, so each member sees their own timezone.
   Re-running replaces the bot's previous post in each channel (no spam),
   which makes it safe to run on a schedule.

   Run:
     PowerShell:
       $env:BOT_TOKEN="xxx"; $env:GUILD_ID="123"; node post-updates.mjs
     Optional env:
       DAYS=7      window for schedule/premieres/finales (default 7)
       PING=1      ping the 🔔 Premiere / 📰 News roles when posting
   ============================================================ */

const TOKEN = process.env.BOT_TOKEN;
const GUILD = process.env.GUILD_ID;
const DAYS  = +(process.env.DAYS || 7);        // window for the #this-week schedule
const LOOKAHEAD = +(process.env.LOOKAHEAD || 30); // window for #premieres / #finales
const PING  = process.env.PING === "1";
const SITE  = "https://tsuzuki.netlify.app";
const API   = "https://discord.com/api/v10";

if (!TOKEN || !GUILD) { console.error("Missing BOT_TOKEN or GUILD_ID."); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- Discord REST ---------------- */
async function rest(method, path, body) {
  for (;;) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({ retry_after: 1 }));
      await sleep(Math.ceil((j.retry_after || 1) * 1000) + 300); continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    if (res.status === 204) return null;
    return res.json();
  }
}

/* ---------------- AniList (mirrors the website) ---------------- */
const ANILIST = "https://graphql.anilist.co";
const QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id title { romaji english } format episodes status popularity averageScore siteUrl isAdult genres
      coverImage { medium }
      airingSchedule { nodes { airingAt episode } }
    }
  }
}`;
const seasonCache = new Map();
function seasonOf(m){ return m<=2?"WINTER":m<=5?"SPRING":m<=8?"SUMMER":"FALL"; }
function prevSeason(s,y){ const o=["WINTER","SPRING","SUMMER","FALL"],i=o.indexOf(s); return i===0?{season:"FALL",year:y-1}:{season:o[i-1],year:y}; }
function seasonsForRange(start,end){
  const map=new Map(); let d=new Date(start.getFullYear(),start.getMonth(),1); const last=new Date(end.getFullYear(),end.getMonth(),1);
  while(d<=last){ const s=seasonOf(d.getMonth()); map.set(s+"-"+d.getFullYear(),{season:s,year:d.getFullYear()}); d.setMonth(d.getMonth()+1); }
  const first=[...map.values()][0]; const p=prevSeason(first.season,first.year); map.set(p.season+"-"+p.year,p);
  return [...map.values()];
}
const title = md => md.title.english || md.title.romaji;
const isFinale = (md,ep) => !!md.episodes && md.episodes>1 && ep===md.episodes;
// NSFW guard: AniList's isAdult flag (authoritative) or the Hentai genre.
// Used to keep adult covers OUT of embed images (the title can still be listed).
const isAdultMedia = md => !!(md && (md.isAdult || (md.genres||[]).includes("Hentai")));

async function fetchSeason(season,year){
  const key=season+"-"+year; if(seasonCache.has(key)) return seasonCache.get(key);
  let all=[],page=1,more=true,tries=0;
  while(more && page<=3){   // 150/season covers a full normal season (low-popularity premieres/finales included) while staying within AniList's rate limit
    const res=await fetch(ANILIST,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({query:QUERY,variables:{season,seasonYear:year,page}})});
    if(res.status===429 && tries<5){ const wait=(+(res.headers.get("retry-after"))||2)+0.3; tries++; await new Promise(r=>setTimeout(r,wait*1000)); continue; }
    if(!res.ok) throw new Error("AniList HTTP "+res.status);
    tries=0;
    const j=await res.json(); if(j.errors) throw new Error(j.errors[0].message);
    all=all.concat(j.data.Page.media); more=j.data.Page.pageInfo.hasNextPage; page++;
  }
  seasonCache.set(key,all); return all;
}
async function loadEvents(){
  const now=Math.floor(Date.now()/1000), end=now+Math.max(DAYS,LOOKAHEAD)*86400;
  const seasons=seasonsForRange(new Date(now*1000),new Date(end*1000));
  const results=await Promise.allSettled(seasons.map(s=>fetchSeason(s.season,s.year)));
  const seen=new Set(),media=[];
  for(const r of results) if(r.status==="fulfilled") for(const md of r.value) if(!seen.has(md.id)){ seen.add(md.id); media.push(md); }
  const events=[];
  for(const md of media) for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[])
    if(n.airingAt>=now && n.airingAt<=end) events.push({md,ep:n.episode,ts:n.airingAt});
  events.sort((a,b)=>a.ts-b.ts);
  return { events, now, weekEnd: now+DAYS*86400, lookEnd: now+LOOKAHEAD*86400 };
}

/* ---------------- ANN news ---------------- */
const ANN="https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us";
async function fetchNews(){
  const res=await fetch("https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(ANN));
  if(!res.ok) throw new Error("news HTTP "+res.status);
  const j=await res.json(); if(j.status!=="ok") throw new Error("news feed error");
  return j.items||[];
}

/* ---------------- embed builders ---------------- */
const decode = s => String(s==null?"":s).replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)));
const T = (ts,f="t") => `<t:${Math.floor(ts)}:${f}>`;
function clamp(lines, max=3900){ let out="",used=0; for(const l of lines){ if(used+l.length+1>max){ out+="\n…more at the site."; break; } out+=(out?"\n":"")+l; used+=l.length+1; } return out||"—"; }

function weekEmbed({events}){
  const lines=[]; let day=null;
  for(const e of events){
    const d=new Date(e.ts*1000);
    const dk=d.toDateString();
    if(dk!==day){ day=dk; lines.push(`\n__**${d.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}**__`); }
    const tag=e.ep===1?"🆕":isFinale(e.md,e.ep)?"🏁":"";
    lines.push(`${T(e.ts)} **${decode(title(e.md))}** · Ep ${e.ep}${tag?" "+tag:""}`);
  }
  return {
    title:`🗓️ This Week in Anime`, url:SITE, color:0x8b5cf6,
    description: events.length?clamp(lines):"No episodes scheduled in the next "+DAYS+" days.",
    footer:{text:`AniList · next ${DAYS} days · 🆕 premiere  🏁 finale`}, timestamp:new Date().toISOString(),
  };
}
function listEmbed(items, {emoji,name,color,line,days=LOOKAHEAD}){
  const lines=items.map(line);
  return {
    title:`${emoji} ${name}`, url:SITE, color,
    description: items.length?clamp(lines):`No ${name.toLowerCase()} in the next ${days} days.`,
    footer:{text:`AniList · next ${days} days`}, timestamp:new Date().toISOString(),
    // thumbnail = first NON-adult cover (never show a hentai/NSFW image; its title can still appear in the list)
    thumbnail: (()=>{ const s=items.find(it=>it.md && it.md.coverImage && !isAdultMedia(it.md)); return s ? {url:s.md.coverImage.medium} : undefined; })(),
  };
}
function newsEmbed(items){
  const lines=items.slice(0,15).map(i=>{
    const ts=Math.floor(new Date(i.pubDate.replace(" ","T")+"Z").getTime()/1000);
    return `• [${decode(i.title)}](${i.link}) · ${T(ts,"R")}`;
  });
  return { title:`📰 Latest Anime News`, url:"https://www.animenewsnetwork.com/news/", color:0x1abc9c,
    description: lines.length?clamp(lines):"Couldn't load news right now.",
    footer:{text:"Anime News Network"}, timestamp:new Date().toISOString() };
}

/* ---------------- posting ---------------- */
let BOT_ID=null;
async function clearOwn(channelId){
  const msgs=await rest("GET",`/channels/${channelId}/messages?limit=50`);
  for(const m of msgs){ if(m.author.id===BOT_ID){ await rest("DELETE",`/channels/${channelId}/messages/${m.id}`); await sleep(350); } }
}
async function post(channelId, embed, pingRoleId){
  await clearOwn(channelId);
  const content = (PING && pingRoleId) ? `<@&${pingRoleId}>` : undefined;
  await rest("POST",`/channels/${channelId}/messages`,{ content, embeds:[embed],
    allowed_mentions: pingRoleId ? {roles:[pingRoleId]} : {parse:[]} });
}

(async () => {
  const me=await rest("GET","/users/@me"); BOT_ID=me.id;
  const channels=await rest("GET",`/guilds/${GUILD}/channels`);
  const roles=await rest("GET",`/guilds/${GUILD}/roles`);
  const chan=n=>{ const c=channels.find(x=>x.name===n && x.type===0); return c&&c.id; };
  const role=n=>{ const r=roles.find(x=>x.name===n); return r&&r.id; };

  const [{events,weekEnd,lookEnd},news]=await Promise.all([
    loadEvents(),
    fetchNews().catch(e=>{ console.error("news failed:",e.message); return []; }),
  ]);
  const weekEvents=events.filter(e=>e.ts<=weekEnd);
  const premieres=events.filter(e=>e.ep===1 && e.ts<=lookEnd);
  const finales=events.filter(e=>isFinale(e.md,e.ep) && e.ts<=lookEnd);

  const jobs=[
    ["this-week",  weekEmbed({events:weekEvents}), null],
    ["premieres",  listEmbed(premieres,{emoji:"🌸",name:"New Premieres",color:0xf59e0b,
        line:e=>`${T(e.ts,"f")} · **${decode(title(e.md))}** · ${e.md.format||"?"}${e.md.averageScore?` · ★${e.md.averageScore}`:""}`}),
        role("🔔 Premiere Pings")],
    ["finales",    listEmbed(finales,{emoji:"🏁",name:"Season Finales",color:0xef4444,
        line:e=>`${T(e.ts,"f")} · **${decode(title(e.md))}** · Ep ${e.ep}${e.md.averageScore?` · ★${e.md.averageScore}`:""}`}),
        null],
    ["anime-news", newsEmbed(news), role("📰 News Pings")],
  ];

  for(const [name,embed,pingRole] of jobs){
    const id=chan(name);
    if(!id){ console.log(`skip · #${name} not found`); continue; }
    await post(id,embed,pingRole);
    console.log(`posted · #${name}`);
  }
  console.log("\n✅ All channels updated.");
})().catch(e=>{ console.error("\n❌ Failed:",e.message); process.exit(1); });
