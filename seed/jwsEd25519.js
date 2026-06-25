// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// jwsEd25519.js — EdDSA (ed25519) JWT sign + verify with node:crypto (replaces the `jose` dependency
// for the ASYMMETRIC story-identity / federation tokens in storyIdentity.js).
//
// This is the JWS Compact Serialization for EdDSA, nothing exotic: a token is
//   base64url({"alg":"EdDSA"}) . base64url(payload) . base64url(ed25519-signature-over-the-first-two)
// signed with the one-shot `crypto.sign(null, data, ed25519Key)` and verified with
// `crypto.verify(null, …)` — the SAME ed25519 path storyIdentity.js already uses for raw signData /
// verifySignedData (the curve IS the algorithm; alg arg is null). Keys are PEM strings (PKCS8 private,
// SPKI public), which node:crypto accepts directly, so no importPKCS8/importSPKI is needed.
//
// CROSS-COMPATIBLE WITH jose: jose's jwtVerify({algorithms:["EdDSA"]}) accepts tokens this signs, and
// this verify accepts jose's tokens — proven by the round-trip suite in verify-jws-ed25519.mjs. That
// matters because federation tokens are verified by REMOTE stories (which may run jose).
//
// SECURITY: verify is strict EdDSA-only — it REJECTS any other `alg` in the header ("none", "HS256",
// "RS256", …), the alg-confusion defense. It checks `exp` (and `nbf` if present) like jose, with an
// optional clock tolerance (default 0, matching jose). A bad signature, a tampered header/payload, a
// wrong key, an expired token, or a non-EdDSA alg all THROW — callers catch (verifyCanopyToken returns
// { valid:false, error }).

import crypto from "crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const b64urlJson = (obj) => b64url(Buffer.from(JSON.stringify(obj), "utf8"));

// Parse a jose-style time span ("5m", "7d", "1h", "30s", "2w", "1y") → seconds. A bare number is
// already seconds. Mirrors jose's setExpirationTime(string) = "relative to now" semantics.
const UNIT_SECONDS = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  w: 604800, week: 604800, weeks: 604800,
  y: 31557600, yr: 31557600, year: 31557600, years: 31557600,
};
function parseTimeSpanSeconds(v) {
  if (typeof v === "number") return Math.floor(v);
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
  if (!m) throw new Error(`jws: invalid time span "${v}"`);
  const unit = UNIT_SECONDS[m[2].toLowerCase()];
  if (!unit) throw new Error(`jws: unknown time unit "${m[2]}"`);
  return Math.floor(parseFloat(m[1]) * unit);
}

/**
 * Sign an EdDSA JWT. `payload` is the claim set; `iat` is stamped (now); `exp` is added when
 * `expiresIn` is given (a time-span string like "5m" or a number of seconds). Returns the compact
 * token string. `privateKeyPem` is a PKCS8 PEM (or any key node:crypto's ed25519 sign accepts).
 */
export function signJwtEdDSA(payload, privateKeyPem, { expiresIn = null } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat };
  if (expiresIn != null) claims.exp = iat + parseTimeSpanSeconds(expiresIn);
  const signingInput = `${b64urlJson({ alg: "EdDSA" })}.${b64urlJson(claims)}`;
  const sig = crypto
    .sign(null, Buffer.from(signingInput, "utf8"), privateKeyPem)
    .toString("base64url");
  return `${signingInput}.${sig}`;
}

/**
 * Verify an EdDSA JWT and return the decoded payload, or THROW on any failure (bad shape, non-EdDSA
 * alg, bad signature, wrong key, expired). `publicKeyPem` is an SPKI PEM. Strict EdDSA-only.
 */
export function verifyJwtEdDSA(token, publicKeyPem, { clockToleranceSec = 0, now = null } = {}) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("jws: malformed token (expected 3 segments)");
  const [h, p, s] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  } catch {
    throw new Error("jws: invalid protected header");
  }
  // ALG-CONFUSION DEFENSE: this verifier is ed25519 only. Reject "none", "HS256", "RS256", anything.
  if (!header || header.alg !== "EdDSA") {
    throw new Error(`jws: unexpected alg "${header?.alg}" (only EdDSA accepted)`);
  }

  const signingInput = `${h}.${p}`;
  let valid;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(signingInput, "utf8"),
      publicKeyPem,
      Buffer.from(s, "base64url"),
    );
  } catch {
    valid = false; // a malformed key / signature buffer is a failed verify, never a throw to the caller
  }
  if (!valid) throw new Error("jws: signature verification failed");

  let payload;
  try {
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    throw new Error("jws: invalid payload");
  }

  const nowSec = Math.floor((now != null ? now : Date.now()) / 1000);
  if (typeof payload.exp === "number" && nowSec > payload.exp + clockToleranceSec) {
    throw new Error('jws: "exp" claim timestamp check failed (token expired)');
  }
  if (typeof payload.nbf === "number" && nowSec + clockToleranceSec < payload.nbf) {
    throw new Error('jws: "nbf" claim timestamp check failed (token not yet valid)');
  }
  return payload;
}

export { parseTimeSpanSeconds };
