// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// credentials.js — the auth/session layer: password verification + JWT
// issuance/verification.
//
// The credential CRYPTO and minting (encrypt/decrypt, scrypt hashing, the
// credential mint) moved UP to name/credentials.js — all minting is the
// Name's, a being password is optional. This file is the cross-cutting
// session layer: a Name auths THROUGH a Being, and the session token carries
// both `beingId` and `nameId`. It imports the crypto from name/ and re-exports
// it so existing importers of this path keep working unchanged.
//
//   PASSWORD  verifyPassword(being, candidate) → scrypt compare with a
//             5-second timeout so an extreme cost factor can't stall the loop.
//   ISSUANCE  generateToken(being)      → session JWT shipped to clients
//             generateNameToken(nameId) → name-only session token (no being)
//             signInternalToken(args)   → short-lived server-to-server JWT
//   VERIFICATION  decodeToken(token)       → cheap parse, never throws, no DB
//                 verifyTokenStrict(token) → decode + lookup + revocation check

import crypto from "crypto";
import { loadProjection } from "../../projections.js";
import { getStoryConfigValue } from "../../../storyConfig.js";
import {
  encryptCredential,
  decryptCredential,
  hashPassword,
  comparePassword,
  mintCredentialSpec,
} from "../../name/credentials.js";

// The credential crypto/minting now lives in name/credentials.js (all minting
// is the Name's). Re-exported here so every existing importer of this file
// keeps working; the session layer below (verifyPassword) uses comparePassword.
export { encryptCredential, decryptCredential, hashPassword, comparePassword, mintCredentialSpec };

if (!process.env.JWT_SECRET)
  throw new Error(
    "JWT_SECRET is required. Run the setup wizard or add it to .env",
  );
const JWT_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────────────
// HS256 JWT (sync, node:crypto HMAC)
//
// These being-tokens are signed AND decoded on synchronous hot paths
// (the IBP HTTP adapter's extractIdentity, the host request log, WS
// connect). jose, the project's other JWT library, is async-only, so
// using it here would force those paths async and ripple through every
// caller. A symmetric HS256 token is just base64url(header).base64url(
// payload).base64url(HMAC-SHA256), a few lines of node:crypto, so we
// mint and verify them directly and carry no JWT dependency at all.
// jose stays for the ASYMMETRIC story-identity tokens (storyIdentity.js).
// ─────────────────────────────────────────────────────────────────────

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

// "30d" | "24h" | "60s" | <number of seconds> → seconds.
function expiresInToSeconds(expiresIn) {
  if (typeof expiresIn === "number") return Math.floor(expiresIn);
  const m = String(expiresIn).match(/^(\d+)\s*([smhd])?$/);
  if (!m) throw new Error(`invalid expiresIn: ${expiresIn}`);
  return Number(m[1]) * UNIT_SECONDS[m[2] || "s"];
}

const b64urlJson = (obj) =>
  Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

function signJwtHS256(payload, secret, { expiresIn } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat };
  if (expiresIn != null) body.exp = iat + expiresInToSeconds(expiresIn);
  const data = `${b64urlJson({ alg: "HS256", typ: "JWT" })}.${b64urlJson(body)}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// Verifies signature + expiry. Throws on any failure (malformed, bad
// signature, expired); decodeToken catches and returns null.
function verifyJwtHS256(token, secret) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new Error("bad signature");
  const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (decoded.exp != null && Math.floor(Date.now() / 1000) >= decoded.exp)
    throw new Error("token expired");
  return decoded;
}

// ─────────────────────────────────────────────────────────────────────
// PASSWORD VERIFICATION
// ─────────────────────────────────────────────────────────────────────

/**
 * Verify a password against a being's stored scrypt hash. scrypt is
 * intentionally slow (memory-hard); the timeout prevents a pathological
 * stored cost factor from blocking the event loop.
 */
const PASSWORD_VERIFY_TIMEOUT_MS = 5000;

export async function verifyPassword(being, password) {
  if (!being?.password || !password) return false;
  let timer;
  try {
    return await Promise.race([
      comparePassword(password, being.password),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Password verification timed out")),
          PASSWORD_VERIFY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate a session JWT for a being. Issued when the being claims an
 * identity (login / register / token re-claim); shipped to the client as the
 * session token. Carries a unique `jti` for revocation; expiry configurable
 * via story config (default 30 days).
 */
export function generateToken(being) {
  const expiresIn = getStoryConfigValue("jwtExpiryDays")
    ? `${Math.max(1, Math.min(Number(getStoryConfigValue("jwtExpiryDays")), 365))}d`
    : "30d";

  return signJwtHS256(
    {
      beingId: being._id,
      name: being.name,
      // The PORTAL identity: the Name this being expresses (its trueName).
      // null when the being has no trueName yet.
      nameId: being.trueName || null,
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn },
  );
}

/**
 * Mint a NAME-only session token — the "name, no being yet" state (a
 * name:connect with no being selected). Carries `nameId` and NO `beingId`.
 * The signing key is NOT in the token (it lives in the in-memory signing
 * session from the password unlock); the token persists only the IDENTITY.
 */
export function generateNameToken(nameId) {
  const expiresIn = getStoryConfigValue("jwtExpiryDays")
    ? `${Math.max(1, Math.min(Number(getStoryConfigValue("jwtExpiryDays")), 365))}d`
    : "30d";
  return signJwtHS256(
    { beingId: null, name: null, nameId: String(nameId), jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn },
  );
}

/**
 * Sign an internal server-to-server JWT. Used by the conversation runtime to
 * authorize tool calls against the local MCP server — forwards the originating
 * being's identity. Short-lived (24h default), no `jti`, never leaves the
 * server.
 */
export function signInternalToken({
  beingId,
  name,
  clientSessionId,
  expiresIn = "24h",
}) {
  if (!beingId) throw new Error("signInternalToken: `beingId` is required");
  const payload = {
    beingId: String(beingId),
    name: name || null,
  };
  if (clientSessionId) payload.clientSessionId = clientSessionId;
  return signJwtHS256(payload, JWT_SECRET, { expiresIn });
}

/**
 * Cheap JWT decode. Returns `{ beingId, name, nameId, iat, jti }` on success,
 * `null` for missing or invalid tokens. Never throws. Does NOT verify the
 * being still exists or check revocation — those are verifyTokenStrict's job.
 */
export function decodeToken(token) {
  if (typeof token !== "string" || !token) return null;
  try {
    const decoded = verifyJwtHS256(token, JWT_SECRET);
    return {
      beingId: decoded.beingId,
      name: decoded.name,
      nameId: decoded.nameId ?? null,
      iat: decoded.iat,
      jti: decoded.jti,
    };
  } catch {
    return null;
  }
}

/**
 * Strict JWT verification. Decodes, confirms the Being (or the name-only
 * Name) still exists, and checks `qualities.auth.tokensInvalidBefore` to
 * reject tokens issued before the last revoke. Returns
 * `{ beingId, name, nameId, jwt, being }` or `null` on any failure. Pass
 * `{ loadBeing: false }` to skip the extra fetch.
 */
export async function verifyTokenStrict(token, { loadBeing = true } = {}) {
  const decoded = decodeToken(token);
  if (!decoded) return null;

  // NAME-only token (a name:connect session, no being yet). Verify the Name
  // still exists and isn't banished, then seat the session's nameId with NO
  // being (the portal lands at the picker). Acts still need the signing
  // session unlocked (the key isn't in the token).
  if (!decoded.beingId && decoded.nameId) {
    const nameSlot = await loadProjection("name", decoded.nameId, "0");
    if (!nameSlot?.state) return null;
    const { isNameBanished } = await import("../../name/closure.js");
    if (await isNameBanished(decoded.nameId)) return null;
    return { beingId: null, name: null, nameId: decoded.nameId, jwt: token, being: null };
  }

  const slot = await loadProjection("being", decoded.beingId, "0");
  if (!slot || slot.tombstoned) return null;
  const being = { _id: slot.id, position: slot.position, ...slot.state };

  const authMeta =
    being.qualities instanceof Map
      ? being.qualities.get("auth")
      : being.qualities?.auth;
  if (authMeta?.tokensInvalidBefore) {
    const invalidBefore =
      new Date(authMeta.tokensInvalidBefore).getTime() / 1000;
    if (decoded.iat && decoded.iat < invalidBefore) return null;
  }

  return {
    beingId: decoded.beingId,
    name: decoded.name,
    nameId: decoded.nameId ?? null,
    jwt: token,
    being: loadBeing ? being : null,
  };
}
