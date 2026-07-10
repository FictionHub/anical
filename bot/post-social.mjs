/* ============================================================
   Tsuzuki — daily social auto-poster
   Pulls the SAME AniList data as https://tsuzuki.netlify.app and
   posts a short "today / this week in anime" blurb to:
     • Bluesky   (AT Protocol)
     • Mastodon  (any instance)
     • Twitter/X (API v2, OAuth 1.0a user context)

   Every platform is OPTIONAL — it only posts where the matching
   credentials are present, and one platform failing never stops the
   others (Promise.allSettled). Zero npm dependencies (Node 20+ fetch
   + built-in crypto only), so it runs as-is on GitHub Actions.

   ----------------------------------------------------------------
   Credentials (set as GitHub Actions secrets / env vars):

   Bluesky:
     BSKY_HANDLE          e.g. anical.bsky.social
     BSKY_APP_PASSWORD    Settings → App Passwords (NOT your login pw)

   Mastodon:
     MASTODON_BASE        e.g. https://mastodon.social
     MASTODON_TOKEN       Preferences → Development → New app → access token

   Twitter / X (all four required; app needs Read+Write):
     X_API_KEY            (consumer key)
     X_API_SECRET         (consumer secret)
     X_ACCESS_TOKEN
     X_ACCESS_SECRET

   Optional:
     DAYS=7               look-ahead window for the "this week" count
     DRY_RUN=1            compose & print the posts but don't send
   ============================================================ */

import crypto from "node:crypto";

const SITE = "https://tsuzuki.netlify.app";
const DAYS = +(process.env.DAYS || 7);
const DRY  = process.env.DRY_RUN === "1";

/* ---------------- AniList (mirrors the website) ---------------- */
const ANILIST = "https://graphql.anilist.co";
const QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id title { romaji english } episodes
      airingSchedule { nodes { airingAt episode } }
    }
  }
}`;
const seasonOf = m => (m<=2?"WINTER":m<=5?"SPRING":m<=8?"SUMMER":"FALL");
function prevSeason(s,y){ const o=["WINTER","SPRING","SUMMER","FALL"],i=o.indexOf(s); return i===0?{season:"FALL",year:y-1}:{season:o[i-1],year:y}; }
function seasonsForRange(start,end){
  const map=new Map(); let d=new Date(start.getFullYear(),start.getMonth(),1); const last=new Date(end.getFullYear(),end.getMonth(),1);
  while(d<=last){ const s=seasonOf(d.getMonth()); map.set(s+"-"+d.getFullYear(),{season:s,year:d.getFullYear()}); d.setMonth(d.getMonth()+1); }
  const first=[...map.values()][0]; const p=prevSeason(first.season,first.year); map.set(p.season+"-"+p.year,p);
  return [...map.values()];
}
const title = md => md.title.english || md.title.romaji;
const isFinale = (md,ep) => !!md.episodes && md.episodes>1 && ep===md.episodes;

async function fetchSeason(season,year){
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
  return all;
}
async function loadEvents(){
  const now=Math.floor(Date.now()/1000), end=now+DAYS*86400;
  const seasons=seasonsForRange(new Date(now*1000),new Date(end*1000));
  const results=await Promise.allSettled(seasons.map(s=>fetchSeason(s.season,s.year)));
  const seen=new Set(),media=[];
  for(const r of results) if(r.status==="fulfilled") for(const md of r.value) if(!seen.has(md.id)){ seen.add(md.id); media.push(md); }
  const events=[];
  for(const md of media) for(const n of (md.airingSchedule&&md.airingSchedule.nodes)||[])
    if(n.airingAt>=now && n.airingAt<=end) events.push({md,ep:n.episode,ts:n.airingAt});
  events.sort((a,b)=>a.ts-b.ts);
  return { events, now };
}

/* ---------------- compose the post text ---------------- */
const decode = s => String(s==null?"":s).replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">");
const dayKey = ts => new Date(ts*1000).toISOString().slice(0,10);

// uniq titles preserving order
function uniqTitles(list){ const s=new Set(),out=[]; for(const e of list){ const t=decode(title(e.md)); if(!s.has(t)){ s.add(t); out.push(t); } } return out; }

// join up to N names into "A, B, C +X more" within a soft budget
function nameList(names, max, budget){
  const shown=[]; let used=0;
  for(const n of names){ if(shown.length>=max) break; if(used+n.length+2>budget) break; shown.push(n); used+=n.length+2; }
  const extra=names.length-shown.length;
  return shown.join(", ") + (extra>0?` +${extra} more`:"");
}

/* Build platform-specific text. limit = hard char cap for that platform.
   The link is counted generously (Bluesky/Mastodon count raw length;
   X counts every URL as 23 via t.co, so we leave headroom).            */
function buildText({events, now}, {limit, tags}){
  const today = dayKey(now);
  const todays   = events.filter(e=>dayKey(e.ts)===today);
  const premToday= todays.filter(e=>e.ep===1);
  const finToday = todays.filter(e=>isFinale(e.md,e.ep));

  const link = SITE;
  const tagLine = tags;
  // reserve room for "\n\n" + link + "\n" + tags
  const reserved = 2 + 24 /*url worst-case*/ + 1 + tagLine.length + 4;
  const budget = Math.max(40, limit - reserved);

  let head;
  if(premToday.length){
    head = `🆕 Premiering today: ${nameList(uniqTitles(premToday), 4, budget-22)}`;
  } else if(finToday.length){
    head = `🏁 Season finale today: ${nameList(uniqTitles(finToday), 4, budget-24)}`;
  } else if(todays.length){
    head = `🗓️ Airing today (${todays.length} eps): ${nameList(uniqTitles(todays), 4, budget-26)}`;
  } else {
    head = `🗓️ This week in anime: ${events.length} episodes on the calendar`;
  }
  // trim head to budget just in case
  if(head.length>budget) head = head.slice(0,budget-1)+"…";
  return `${head}\n\n${link}\n${tagLine}`;
}

/* ============================================================
   BLUESKY  (AT Protocol)
   ============================================================ */
async function postBluesky(data){
  const handle = process.env.BSKY_HANDLE, pw = process.env.BSKY_APP_PASSWORD;
  if(!handle || !pw) return { platform:"Bluesky", skipped:true };
  const base = "https://bsky.social/xrpc";

  const text = buildText(data,{ limit:300, tags:"#anime #anitwt" });
  if(DRY){ console.log("[DRY] Bluesky:\n"+text); return { platform:"Bluesky", dry:true }; }

  const ses = await fetch(`${base}/com.atproto.server.createSession`,{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ identifier:handle, password:pw })
  });
  if(!ses.ok) throw new Error("Bluesky auth "+ses.status+" "+await ses.text());
  const { accessJwt, did } = await ses.json();

  // detect the URL as a clickable facet (byte offsets, UTF-8)
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const urlByte = enc.encode(SITE);
  const start = indexOfBytes(bytes, urlByte);
  const facets = start>=0 ? [{
    index:{ byteStart:start, byteEnd:start+urlByte.length },
    features:[{ $type:"app.bsky.richtext.facet#link", uri:SITE }]
  }] : undefined;

  const rec = await fetch(`${base}/com.atproto.repo.createRecord`,{
    method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${accessJwt}` },
    body:JSON.stringify({
      repo:did, collection:"app.bsky.feed.post",
      record:{ $type:"app.bsky.feed.post", text, facets, createdAt:new Date().toISOString() }
    })
  });
  if(!rec.ok) throw new Error("Bluesky post "+rec.status+" "+await rec.text());
  return { platform:"Bluesky", ok:true };
}
function indexOfBytes(hay, needle){
  outer: for(let i=0;i<=hay.length-needle.length;i++){
    for(let j=0;j<needle.length;j++) if(hay[i+j]!==needle[j]) continue outer;
    return i;
  }
  return -1;
}

/* ============================================================
   MASTODON
   ============================================================ */
async function postMastodon(data){
  const baseRaw = process.env.MASTODON_BASE, token = process.env.MASTODON_TOKEN;
  if(!baseRaw || !token) return { platform:"Mastodon", skipped:true };
  // Normalize to just scheme://host — tolerate a pasted profile URL, path,
  // @handle, trailing slash, or missing scheme.
  let base;
  try {
    const raw = baseRaw.trim();
    base = new URL(/^https?:\/\//i.test(raw) ? raw : "https://"+raw).origin;
  } catch {
    throw new Error(`Mastodon: MASTODON_BASE is not a valid URL: "${baseRaw}". Use just the instance origin, e.g. https://mastodon.social`);
  }
  const text = buildText(data,{ limit:500, tags:"#anime #animecalendar #seasonalanime" });
  if(DRY){ console.log(`[DRY] Mastodon (-> ${base}):\n`+text); return { platform:"Mastodon", dry:true }; }

  // Preflight: verify_credentials disambiguates a bad base (404) from a bad
  // token (401/403) WITHOUT printing the secret, and confirms we're reaching
  // a real Mastodon instance before we try to post.
  const who = await fetch(`${base}/api/v1/accounts/verify_credentials`,{ headers:{ Authorization:`Bearer ${token}` } });
  if(!who.ok){
    const b = await who.text();
    if(who.status===404)
      throw new Error(`Mastodon: MASTODON_BASE is not a reachable Mastodon API (verify_credentials returned 404). Set it to your instance origin only, e.g. https://mastodon.social. ${b}`);
    if(who.status===401 || who.status===403)
      throw new Error(`Mastodon: token rejected (${who.status}). Create a new access token with the 'write:statuses' scope under Preferences -> Development. ${b}`);
    throw new Error(`Mastodon verify_credentials ${who.status} ${b}`);
  }
  const acct = await who.json().catch(()=>({}));
  console.log(`  Mastodon: authenticated as @${acct.username||"?"} on ${base}`);

  // Idempotency key is per-RUN (not per-day) so a deleted earlier post can't
  // make Mastodon replay-then-404 a stale record on the next run.
  const res = await fetch(`${base}/api/v1/statuses`,{
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}`,
              "Idempotency-Key":"anical-"+Math.floor(Date.now()/1000) },
    body:JSON.stringify({ status:text, visibility:"public" })
  });
  if(!res.ok){
    const body = await res.text();
    let hint = "";
    if(res.status===404) hint = " (404 on create even though auth succeeded — usually a stale Idempotency-Key replay; this run uses a fresh key, so a re-run should clear it.)";
    else if(res.status===422) hint = " (422 — post rejected, e.g. too long or empty.)";
    throw new Error(`Mastodon ${res.status}${hint} ${body}`);
  }
  return { platform:"Mastodon", ok:true };
}

/* ============================================================
   TWITTER / X  (API v2 create tweet, OAuth 1.0a user context)
   ============================================================ */
const rfc3986 = s => encodeURIComponent(s).replace(/[!*'()]/g, c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());

function oauthHeader(method, url, consumerKey, consumerSecret, token, tokenSecret){
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_token: token,
    oauth_version: "1.0",
  };
  // JSON-body POST → only oauth params participate in the signature
  const params = Object.keys(oauth).sort().map(k=>`${rfc3986(k)}=${rfc3986(oauth[k])}`).join("&");
  const base = [method.toUpperCase(), rfc3986(url), rfc3986(params)].join("&");
  const signingKey = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  const all = { ...oauth, oauth_signature: signature };
  return "OAuth " + Object.keys(all).sort().map(k=>`${rfc3986(k)}="${rfc3986(all[k])}"`).join(", ");
}

async function postTwitter(data){
  const ck=process.env.X_API_KEY, cs=process.env.X_API_SECRET,
        tk=process.env.X_ACCESS_TOKEN, ts=process.env.X_ACCESS_SECRET;
  if(!ck||!cs||!tk||!ts) return { platform:"Twitter/X", skipped:true };
  const url = "https://api.twitter.com/2/tweets";
  const text = buildText(data,{ limit:280, tags:"#anime #anitwt" });
  if(DRY){ console.log("[DRY] Twitter/X:\n"+text); return { platform:"Twitter/X", dry:true }; }
  const res = await fetch(url,{
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization: oauthHeader("POST",url,ck,cs,tk,ts) },
    body:JSON.stringify({ text })
  });
  if(!res.ok) throw new Error("Twitter "+res.status+" "+await res.text());
  return { platform:"Twitter/X", ok:true };
}

/* ---------------- run ---------------- */
(async () => {
  const data = await loadEvents();
  console.log(`Loaded ${data.events.length} episode(s) in the next ${DAYS} days.`);

  const results = await Promise.allSettled([
    postBluesky(data),
    postMastodon(data),
    postTwitter(data),
  ]);

  let failures = 0;
  for(const r of results){
    if(r.status==="fulfilled"){
      const v=r.value;
      if(v.skipped) console.log(`• ${v.platform}: skipped (no credentials)`);
      else if(v.dry) console.log(`• ${v.platform}: dry run`);
      else console.log(`✅ ${v.platform}: posted`);
    } else {
      failures++;
      console.error(`❌ ${r.reason.message}`);
    }
  }
  if(failures){ console.error(`\n${failures} platform(s) failed.`); process.exit(1); }
  console.log("\nDone.");
})().catch(e=>{ console.error("Fatal:",e.message); process.exit(1); });
