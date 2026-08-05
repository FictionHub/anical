// Discord sign-in — identity only.
//
//   GET  /api/auth/login     -> 302 to Discord's consent screen
//   GET  /api/auth/callback  -> exchanges the code, sets the session, 302 home
//   GET  /api/auth/me        -> who you are + which skin you've been granted
//   POST /api/auth/logout    -> clears the session
//
// What this is for: nothing but knowing which account you are, so a skin granted
// in /admin can find you. No list, rating, note or collection ever leaves the
// browser — that stays true, and the settings copy says so.
//
// What is stored server-side: your Discord id, username, display name and
// avatar hash, so the admin panel can grant a theme by name instead of by
// snowflake. That's it. Signing out clears the cookie; the directory row is
// removed with the grant in /admin.
//
// Authorization-code flow, not implicit: the token exchange needs the client
// secret, which can only live on the server. That is also why this can't copy
// the AniList sign-in already in site/index.html.
//
// Setup (Discord Developer Portal -> your app):
//   OAuth2 -> Redirects: add https://<site>/api/auth/callback
//   Netlify env: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET
//   (SESSION_SECRET: any long random string — `openssl rand -base64 48`)
import { getStore } from "@netlify/blobs";
import {
  sessionsEnabled, newSession, currentUser, sessionCookie, clearSessionCookie,
  newOAuthState, verifyOAuthState, oauthCookie, clearOauthCookie, isSecureRequest,
} from "./_lib/session.mjs";

const DISCORD_API = "https://discord.com/api/v10";
const GRANT_STORE = "user-themes";
const DIRECTORY_STORE = "user-directory";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

const configured = () =>
  !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && sessionsEnabled());

// Derived from the request rather than hardcoded, so deploy previews and a
// custom domain both work — but Discord only accepts redirect URIs registered
// on the app, so every origin you actually sign in from has to be listed there.
const redirectUri = url => `${url.origin}/api/auth/callback`;

// A failed sign-in lands the user back on the site with a message, not on a
// JSON error page. They clicked a button; they should end up looking at the
// thing they clicked from.
const backHome = (path, outcome, secure) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: outcome ? `${path}${path.includes("?") ? "&" : "?"}login=${encodeURIComponent(outcome)}` : path,
      "Set-Cookie": clearOauthCookie(secure),
      "Cache-Control": "no-store",
    },
  });

async function grantFor(discordId) {
  try {
    const rec = await getStore(GRANT_STORE).get(String(discordId), { type: "json" });
    return rec && rec.themeId ? rec : null;
  } catch (err) {
    console.warn("auth: grant lookup failed —", err.message);
    return null;
  }
}

/* ---------- routes ---------- */

function login(url, secure) {
  const returnTo = url.searchParams.get("returnTo") || "/";
  const { token } = newOAuthState(returnTo);
  const authorize = new URL(`${DISCORD_API.replace("/api/v10", "")}/oauth2/authorize`);
  authorize.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri(url));
  authorize.searchParams.set("response_type", "code");
  // `identify` and nothing else. No email, no guilds, no message access —
  // the consent screen should be honest about how little this needs.
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", token);
  // Deliberately NOT prompt=none. It would skip the consent screen for someone
  // who has already approved, which is a small win, but its behaviour on a
  // first-ever authorization is provider-specific — and the failure mode is
  // that nobody can ever sign in for the first time. Not a trade worth making
  // to save one click.
  return new Response(null, {
    status: 302,
    headers: { Location: authorize.toString(), "Set-Cookie": oauthCookie(token, secure), "Cache-Control": "no-store" },
  });
}

async function callback(req, url, secure) {
  const state = verifyOAuthState(req, url.searchParams.get("state"));
  if (!state) return backHome("/", "expired", secure);   // stale tab, or a forged callback

  const denied = url.searchParams.get("error");
  if (denied) return backHome(state.returnTo, denied === "access_denied" ? "cancelled" : "failed", secure);

  const code = url.searchParams.get("code");
  if (!code) return backHome(state.returnTo, "failed", secure);

  let token;
  try {
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(url),
      }),
    });
    if (!res.ok) {
      console.warn("auth: token exchange failed", res.status, (await res.text()).slice(0, 200));
      return backHome(state.returnTo, "failed", secure);
    }
    token = await res.json();
  } catch (err) {
    console.warn("auth: token exchange threw —", err.message);
    return backHome(state.returnTo, "failed", secure);
  }

  let me;
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!res.ok) return backHome(state.returnTo, "failed", secure);
    me = await res.json();
  } catch (err) {
    console.warn("auth: /users/@me threw —", err.message);
    return backHome(state.returnTo, "failed", secure);
  }
  if (!me || !me.id) return backHome(state.returnTo, "failed", secure);

  const user = { id: String(me.id), username: me.username || null, globalName: me.global_name || null, avatar: me.avatar || null };

  // Directory row so /admin can grant a theme by typing a name. Best-effort:
  // failing to record it must not fail the sign-in, it only costs the admin the
  // convenience of search.
  try {
    const dir = getStore(DIRECTORY_STORE);
    const existing = await dir.get(user.id, { type: "json" }).catch(() => null);
    await dir.setJSON(user.id, { ...user, firstSeen: (existing && existing.firstSeen) || Date.now(), lastSeen: Date.now() });
  } catch (err) { console.warn("auth: directory write failed —", err.message); }

  // Discord's access token is deliberately dropped here. It was needed for one
  // call and keeping it would mean holding a credential that can read a user's
  // account for as long as the row exists.
  //
  // `login=ok` is what lets the app say "signed in as …" on arrival. Without it
  // a successful sign-in is indistinguishable from a page reload, which is
  // exactly how you end up unsure whether it worked.
  const back = state.returnTo + (state.returnTo.includes("?") ? "&" : "?") + "login=ok";
  return new Response(null, {
    status: 302,
    headers: [
      ["Location", back],
      ["Set-Cookie", sessionCookie(newSession(user), secure)],
      ["Set-Cookie", clearOauthCookie(secure)],
      ["Cache-Control", "no-store"],
    ],
  });
}

async function whoami(req) {
  const user = currentUser(req);
  if (!user) return json({ ok: true, configured: configured(), user: null, grant: null });
  // Read the grant fresh every time. It is not in the session token precisely
  // so that a theme granted five minutes ago reaches someone who signed in last
  // month, without them having to sign out and back in.
  return json({ ok: true, configured: true, user, grant: await grantFor(user.id) });
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/+|\/+$/g, "").split("/").pop();
  const secure = isSecureRequest(req);

  if (route === "logout") {
    if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure) });
  }

  if (route === "me") return await whoami(req);

  if (!configured()) {
    // Say which piece is missing — this is a maintainer-facing message, and
    // "not configured" without the name of the variable wastes an evening.
    const missing = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET"].filter(k => !process.env[k]);
    console.warn("auth: not configured — missing", missing.join(", "));
    if (route === "login") return backHome("/", "unconfigured", secure);
    return json({ ok: false, error: "Discord sign-in is not configured", missing }, 503);
  }

  try {
    if (route === "login") return login(url, secure);
    if (route === "callback") return await callback(req, url, secure);
  } catch (err) {
    console.error("auth: unhandled —", err && err.stack ? err.stack : err);
    return backHome("/", "failed", secure);
  }

  return json({ ok: false, error: `Unknown auth route "${route}"` }, 404);
};
