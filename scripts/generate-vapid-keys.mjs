/* ============================================================
   Generate a VAPID key pair for Web Push (used by the
   netlify/functions push-* functions).

   Zero deps — uses Node's built-in crypto. Run once:
     node scripts/generate-vapid-keys.mjs

   The PUBLIC key is not secret — it's embedded in site/index.html
   as VAPID_PUBLIC_KEY so browsers can subscribe.
   The PRIVATE key must be kept secret — set it as the Netlify
   environment variable VAPID_PRIVATE_KEY (Site configuration →
   Environment variables). Never commit it.
   ============================================================ */
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pubJwk = publicKey.export({ format: "jwk" });
const privJwk = privateKey.export({ format: "jwk" });

const pubRaw = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pubJwk.x, "base64url"),
  Buffer.from(pubJwk.y, "base64url"),
]);

console.log("VAPID_PUBLIC_KEY  =", pubRaw.toString("base64url"));
console.log("VAPID_PRIVATE_KEY =", Buffer.from(privJwk.d, "base64url").toString("base64url"));
console.log("\nNext steps:");
console.log("  1. Put VAPID_PUBLIC_KEY into site/index.html (const VAPID_PUBLIC_KEY = \"...\";)");
console.log("  2. Set VAPID_PRIVATE_KEY (and optionally VAPID_SUBJECT, CRON_SECRET) as");
console.log("     Netlify environment variables (Site configuration -> Environment variables).");
