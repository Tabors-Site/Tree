// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// passwordKey — encrypt a Name's private key with a key DERIVED FROM ITS
// PASSWORD, so the server cannot auto-decrypt it. This is the OPTIONAL
// easier-access layer: with a password set, the Name's privateKeyEnc is
// only decryptable on login (real-name + password), and the decrypted key
// lives only in the session (materials/name/signingSession.js). Without a
// password the key is system-encrypted (credentials.encryptCredential) and
// the server signs automatically. Either way the holder can also act with
// the raw private key directly — name + password are never required.
//
// scrypt(password, salt) -> 32-byte key; AES-256-GCM over the PEM. The
// blob is self-identifying: it starts with "pw:" so loadSigningKey knows
// to route a password-locked Name through the session instead of the
// system decrypt. Changing the password re-encrypts the same keypair (a
// new salt + a new derivation); the identity (the keypair) never changes.

import crypto from "crypto";

// scrypt cost params. N=16384 (2^14) is the interactive default — strong
// enough for a login KDF while staying ~tens of ms per derivation.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const PREFIX = "pw:";

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    // scrypt's default maxmem (32MB) is too small for N=16384,r=8 (needs
    // 128*N*r ≈ 16MB but the lib double-counts); raise the ceiling.
    maxmem: 64 * 1024 * 1024,
  });
}

/**
 * Encrypt a private-key PEM with a key derived from `password`.
 * Returns `pw:<saltHex>:<ivHex>:<tagHex>:<ctHex>` — self-identifying as
 * password-locked.
 */
export function encryptWithPassword(plainPem, password) {
  if (typeof plainPem !== "string" || !plainPem) throw new Error("encryptWithPassword: plainPem required");
  if (typeof password !== "string" || !password) throw new Error("encryptWithPassword: password required");
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plainPem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${salt.toString("hex")}:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/**
 * Decrypt a `pw:`-prefixed blob with `password`. Returns the PEM string, or
 * null on a wrong password / malformed blob (never throws — a wrong
 * password is an ordinary login failure).
 */
export function decryptWithPassword(blob, password) {
  try {
    if (!isPasswordLocked(blob) || typeof password !== "string" || !password) return null;
    const [, saltHex, ivHex, tagHex, ctHex] = blob.split(":");
    const key = deriveKey(password, Buffer.from(saltHex, "hex"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/** True if a privateKeyEnc blob is password-locked (vs system-encrypted). */
export function isPasswordLocked(blob) {
  return typeof blob === "string" && blob.startsWith(PREFIX);
}
