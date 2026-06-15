// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// credentials.js — password verification + JWT issuance/verification.
//
// Three concerns share this file because they share the JWT_SECRET
// boot check:
//
//   PASSWORD  verifyPassword(being, candidate) → bcrypt compare with
//             a 5-second timeout so an extreme cost factor can't
//             stall the event loop indefinitely.
//
//   ISSUANCE  generateToken(being)         → session JWT shipped to
//                                             clients (cookie/bearer)
//             signInternalToken(args)      → short-lived server-to-
//                                             server JWT (24h) used
//                                             by the LLM runtime to
//                                             call its own MCP layer
//                                             under the originating
//                                             being's identity
//
//   VERIFICATION  decodeToken(token)        → cheap parse, never
//                                             throws, no DB read
//                 verifyTokenStrict(token)  → decode + Being lookup +
//                                             tokensInvalidBefore
//                                             revocation check

import bcrypt from "bcrypt";
import crypto from "crypto";
import Being from "../being.js";
import { loadProjection } from "../../projections.js";
import { getRealityConfigValue } from "../../../realityConfig.js";

if (!process.env.JWT_SECRET)
  throw new Error(
    "JWT_SECRET is required. Run the setup wizard or add it to .env",
  );
const JWT_SECRET = process.env.JWT_SECRET;

// AES key derived from JWT_SECRET via HKDF. The label binds the key to
// the credential use case so a JWT signed with the same secret cannot
// be mistaken for a credential blob and vice versa. hkdfSync returns
// an ArrayBuffer; wrap it so cipher APIs accept it.
const CREDENTIAL_KEY = Buffer.from(
  crypto.hkdfSync(
    "sha256",
    Buffer.from(JWT_SECRET, "utf8"),
    Buffer.alloc(0),
    Buffer.from("treeos.credential.v1", "utf8"),
    32,
  ),
);

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
// jose stays for the ASYMMETRIC reality-identity tokens
// (realityIdentity.js), the case it is actually built for.
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

// Verifies signature + expiry, mirroring jsonwebtoken's jwt.verify
// defaults. Throws on any failure (malformed, bad signature, expired);
// decodeToken catches and returns null.
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
// CREDENTIAL ENCRYPTION
//
// When a being's password is auto-generated (the being parent did not
// pick one), we store the plaintext alongside the bcrypt hash so the
// being and its being parent can retrieve it later. The plaintext is
// encrypted at rest with a key derived from JWT_SECRET; a stolen DB
// dump does not leak credentials.
//
// "Being parent" here means the being that performed the birth act
// (the parentBeingId recorded inside the be:birth Fact's spec). It is
// NOT the SUMMON sense (anyone calling anyone) and NOT the live
// parentBeingId on the being row. See lineage.js findBeingParent.
//
// Wire format: base64( iv(12) || tag(16) || ciphertext ).
// ─────────────────────────────────────────────────────────────────────

export function encryptCredential(plaintext) {
  if (typeof plaintext !== "string" || !plaintext)
    throw new Error("encryptCredential: plaintext required");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", CREDENTIAL_KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptCredential(blob) {
  if (typeof blob !== "string" || !blob) return null;
  try {
    const buf = Buffer.from(blob, "base64");
    if (buf.length < 28) return null;
    const iv  = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct  = buf.subarray(28);
    const dec = crypto.createDecipheriv("aes-256-gcm", CREDENTIAL_KEY, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Mint a credential pair from an optional plaintext. When the caller
// passes plaintext (a human typed it, a being parent chose it), the
// plain stays null and only the bcrypt hash is stored. When the caller passes
// null, we generate a 32-byte random plaintext, bcrypt it for the
// password field, and encrypt the plaintext for retrievable storage in
// qualities.auth.credentialPlain.
//
// Single source of truth for being credential birth. Used by createBeing
// and by genesis (ensureIAm). Do NOT auto-generate plaintexts anywhere
// else; route through here.
export async function mintCredentialSpec(plaintext) {
  const autoGenerated = !plaintext;
  const pt = autoGenerated
    ? crypto.randomBytes(32).toString("hex")
    : plaintext;
  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(pt, salt);
  return {
    hash,
    plain: autoGenerated ? encryptCredential(pt) : null,
    autoGenerated,
  };
}

// ─────────────────────────────────────────────────────────────────────
// PASSWORD VERIFICATION
// ─────────────────────────────────────────────────────────────────────

/**
 * Verify a password against a being's stored hash.
 * bcrypt is intentionally slow. Timeout prevents extreme cost factors
 * from blocking the event loop for extended periods.
 */
const BCRYPT_TIMEOUT_MS = 5000;

export async function verifyPassword(being, password) {
  if (!being?.password || !password) return false;
  let timer;
  try {
    return await Promise.race([
      bcrypt.compare(password, being.password),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Password verification timed out")),
          BCRYPT_TIMEOUT_MS,
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
 * identity (login / register / token re-claim); shipped to the client
 * as the session token (cookie or bearer header).
 *
 * Carries a unique `jti` so individual tokens can be revoked. Expiry
 * is configurable via place config (default 30 days).
 */
export function generateToken(being) {
  const expiresIn = getRealityConfigValue("jwtExpiryDays")
    ? `${Math.max(1, Math.min(Number(getRealityConfigValue("jwtExpiryDays")), 365))}d`
    : "30d";

  return signJwtHS256(
    {
      beingId: being._id,
      name: being.name,
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn },
  );
}

/**
 * Sign an internal server-to-server JWT. Used by the conversation
 * runtime to authorize tool calls against the local MCP server — the
 * token forwards the originating being's identity so the MCP layer
 * knows who the call is for.
 *
 * Distinct from `generateToken` (which issues session credentials to
 * clients): internal tokens are short-lived (24h default), have no
 * `jti`, and never leave the server. The MCP middleware
 * ([transports/http/middleware/authenticate.js]) decodes them with
 * `decodeToken` and reads beingId + name.
 *
 * @param {object} args
 * @param {string} args.beingId
 * @param {string} args.name
 * @param {string} [args.clientSessionId]  optional correlation tag
 * @param {string} [args.expiresIn]        default "24h"
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
 * Cheap JWT decode. Returns `{ beingId, name, iat, jti }` on success,
 * `null` for missing or invalid tokens. Never throws.
 *
 * Use this when you only need to extract identity from a token (WS
 * connect, IBP HTTP adapter, MCP middleware). It does NOT verify the
 * being still exists or check token revocation — those are concerns
 * of `verifyTokenStrict` and the HTTP auth pipeline.
 */
export function decodeToken(token) {
  if (typeof token !== "string" || !token) return null;
  try {
    const decoded = verifyJwtHS256(token, JWT_SECRET);
    return {
      beingId: decoded.beingId,
      name: decoded.name,
      iat: decoded.iat,
      jti: decoded.jti,
    };
  } catch {
    return null;
  }
}

/**
 * Strict JWT verification. Decodes the token, looks up the Being to
 * confirm it still exists, and checks `qualities.auth.tokensInvalidBefore`
 * to reject tokens issued before the being's last revoke (e.g. after a
 * password change).
 *
 * Returns `{ beingId, name, jwt, being }` on success or `null` on any
 * failure (missing/invalid token, being deleted, token revoked). The
 * returned `being` is a lean Mongoose doc for callers that need it
 * (avoids a second lookup); pass `{ loadBeing: false }` to skip the
 * extra fetch (only the existence/revocation check still happens).
 */
export async function verifyTokenStrict(token, { loadBeing = true } = {}) {
  const decoded = decodeToken(token);
  if (!decoded) return null;

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
    jwt: token,
    being: loadBeing ? being : null,
  };
}
