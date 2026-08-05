// Sessions for the Discord sign-in.
//
// Stateless and signed rather than stored: the session carries who you are,
// nothing else, so there is nothing to look up and nothing to leak if the store
// goes down. Entitlements are deliberately NOT in the token — a theme granted
// in the admin panel has to reach a user who is already signed in, and a token
// minted before the grant would carry a stale "no theme" forever.
//
// Format:  base64url(payloadJson) + "." + base64url(hmacSha256(payload))
// Not JWT. There is no third party to interoperate with, no algorithm field to
// confuse, and no library to keep patched — one HMAC and a constant-time
// compare is the whole security surface.
//
// Requires SESSION_SECRET in the site environment. Without it, sign-in is off
// rather than insecure: sessionsEnabled() is false and the auth endpoints say
// so, the same way the app already degrades when the AniList client id is unset.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const SESSION_COOKIE = "tsz_session";
const OAUTH_COOKIE = "tsz_oauth";
const SESSION_TTL_S = 90 * 24 * 3600;   // long: this is a cosmetic identity, not a bank
const OAUTH_TTL_S = 10 * 60;            // a sign-in round trip, generously

export const sessionsEnabled = () => !!process.env.SESSION_SECRET;

const b64u = buf => Buffer.from(buf).toString("base64url");
const unb64u = s => Buffer.from(String(s), "base64url");

function hmac(payloadB64) {
  return createHmac("sha256", process.env.SESSION_SECRET || "").update(payloadB64).digest();
}

export function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  return `${body}.${b64u(hmac(body))}`;
}

// Returns the payload, or null for anything at all wrong — bad shape, bad
// signature, expired. Callers never need to distinguish, and telling them apart
// in an error message is how you build an oracle.
export function verifyToken(token) {
  if (!process.env.SESSION_SECRET || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  let given, expected;
  try { given = unb64u(token.slice(dot + 1)); } catch { return null; }
  expected = hmac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(unb64u(body).toString("utf8")); } catch { return null; }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* ---------- cookies ---------- */

export function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// Is this request actually on https? Netlify terminates TLS ahead of the
// function, so trust the forwarded protocol first and fall back to the URL.
export function isSecureRequest(req) {
  const fwd = req.headers.get("x-forwarded-proto");
  if (fwd) return fwd.split(",")[0].trim() === "https";
  try { return new URL(req.url).protocol === "https:"; } catch { return true; }
}

// SameSite=Lax, not Strict: the browser arrives at the callback as a top-level
// navigation from discord.com, and Strict would withhold the cookie on exactly
// that request — the one place it is needed.
//
// Secure is conditional rather than always on. It must be set in production,
// but `netlify dev` serves http://localhost, and a Secure cookie there is at
// best browser-dependent — Chrome grants localhost an exception, others do not.
// An unconditional Secure flag makes sign-in fail locally in a way that looks
// exactly like a misconfigured Discord app, which is a miserable thing to debug.
function cookie(name, value, maxAge, secure) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) bits.splice(2, 0, "Secure");
  return bits.join("; ");
}

export const sessionCookie = (token, secure) => cookie(SESSION_COOKIE, token, SESSION_TTL_S, secure);
export const clearSessionCookie = secure => cookie(SESSION_COOKIE, "", 0, secure);
export const oauthCookie = (token, secure) => cookie(OAUTH_COOKIE, token, OAUTH_TTL_S, secure);
export const clearOauthCookie = secure => cookie(OAUTH_COOKIE, "", 0, secure);

/* ---------- the two token kinds ---------- */

export const newSession = user => signToken({ k: "s", sub: user.id, u: user.username, g: user.globalName || null, a: user.avatar || null }, SESSION_TTL_S);

export function currentUser(req) {
  const p = verifyToken(readCookie(req, SESSION_COOKIE));
  if (!p || p.k !== "s" || !p.sub) return null;
  return { id: String(p.sub), username: p.u || null, globalName: p.g || null, avatar: p.a || null };
}

// CSRF guard for the OAuth round trip. The nonce goes out in BOTH the `state`
// query parameter and an HttpOnly cookie; the callback requires them to match,
// so a forged callback from another site fails — it can put anything in the URL
// but cannot set our cookie.
export function newOAuthState(returnTo) {
  const nonce = randomBytes(16).toString("base64url");
  return { nonce, token: signToken({ k: "o", n: nonce, r: returnTo || "/" }, OAUTH_TTL_S) };
}

export function verifyOAuthState(req, stateParam) {
  const fromCookie = verifyToken(readCookie(req, OAUTH_COOKIE));
  const fromUrl = verifyToken(stateParam);
  if (!fromCookie || !fromUrl) return null;
  if (fromCookie.k !== "o" || fromUrl.k !== "o") return null;
  const a = Buffer.from(String(fromCookie.n)), b = Buffer.from(String(fromUrl.n));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // Only ever send people back inside this site. An open redirect here would
  // let a phishing page borrow our domain for the hop.
  const r = String(fromUrl.r || "/");
  return { returnTo: /^\/(?!\/)/.test(r) ? r : "/" };
}
