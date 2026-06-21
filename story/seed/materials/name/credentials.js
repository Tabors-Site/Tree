// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// credentials.js (name/) — the credential CRYPTO and minting.
//
// All minting is the Name's. A being is a being a Name owns; a being
// password is OPTIONAL (the Name's identity is the authority). The at-rest
// encryption (AES-256-GCM), the password KDF (scrypt), and the credential
// mint live here, where the keys live. The session/token layer (password
// verify, JWT issuance + verification) stays in being/identity/credentials.js
// and imports these — it is cross-cutting (a Name auths through a Being).
//
// Moved up from being/identity/credentials.js as part of the Name/Being
// split: keys and credentials belong to the identity, and the identity is the
// Name. name.js + name/passwordKey.js already call encryptCredential for the
// Name's private key; this is its proper home.

import crypto from "crypto";

if (!process.env.JWT_SECRET)
  throw new Error(
    "JWT_SECRET is required. Run the setup wizard or add it to .env",
  );
const JWT_SECRET = process.env.JWT_SECRET;

// AES key derived from JWT_SECRET via HKDF. The label binds the key to the
// credential use case so a JWT signed with the same secret cannot be mistaken
// for a credential blob and vice versa. hkdfSync returns an ArrayBuffer; wrap
// it so cipher APIs accept it.
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
// CREDENTIAL ENCRYPTION — wire format: base64( iv(12) || tag(16) || ct ).
// Used for any at-rest secret: the Name's encrypted private key, and the
// auto-generated being password stored in qualities.auth.credentialPlain.
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
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const dec = crypto.createDecipheriv("aes-256-gcm", CREDENTIAL_KEY, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// PASSWORD HASHING (scrypt, node:crypto). Self-describing storage format
// embeds the parameters so they can be tuned later without breaking hashes:
//   scrypt$<N>$<r>$<p>$<saltBase64>$<keyBase64>
// N=16384 (2^14), r=8, p=1 is a standard interactive-login cost (~60ms).
// ─────────────────────────────────────────────────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptDerive(password, salt, keylen, { N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(plaintext) {
  const salt = crypto.randomBytes(16);
  const key = await scryptDerive(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

// Re-derives with the stored parameters and timing-safe compares.
// Returns false (never throws) for a missing or malformed hash.
export async function comparePassword(plaintext, stored) {
  if (typeof stored !== "string" || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  const key = await scryptDerive(plaintext, salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return (
    key.length === expected.length && crypto.timingSafeEqual(key, expected)
  );
}

// Mint a credential pair from an optional plaintext. When the caller passes
// plaintext, `plain` stays null and only the hash is stored. When null, we
// generate a 32-byte random plaintext, hash it, and encrypt the plaintext for
// retrievable storage in qualities.auth.credentialPlain. A being password is
// OPTIONAL — the Name owns the being — so route any auto-generation here.
export async function mintCredentialSpec(plaintext) {
  const autoGenerated = !plaintext;
  const pt = autoGenerated ? crypto.randomBytes(32).toString("hex") : plaintext;
  const hash = await hashPassword(pt);
  return {
    hash,
    plain: autoGenerated ? encryptCredential(pt) : null,
    autoGenerated,
  };
}
