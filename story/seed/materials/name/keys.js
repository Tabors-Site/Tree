// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Name keys — a name is a wallet.
//
// A Name's id IS its ed25519 public key, encoded as the colon-free
// multibase multicodec form `z<base58btc(0xed01 || rawpub)>` (the
// did:key value for ed25519, renderable as `did:key:z...` for external
// display). Colon-free on purpose: ids flow through projection keys
// (`<history>:<type>:<id>`), reel keys, and act-head keys, all
// colon-delimited, so a `did:tree:` prefix with colons would corrupt
// key parsing. The `z` is multibase base58btc; the `0xed01` is the
// multicodec varint for ed25519-pub, so the id is self-describing and
// algorithm-agile. (A being's _id is now a content hash, not a key —
// the key lives here, on the Name the being expresses; "names are
// wallets, beings are presences".)
//
// Because the id IS the verification key, signatures are SELF
// CERTIFYING: verifyNameSig decodes the key straight from the id, no
// directory. Mirrors the ed25519 path the story already uses in
// seed/storyIdentity.js (Node native crypto, no new dependency).

import crypto from "crypto";
import { canonicalize } from "../../past/fact/hash.js";

// ── base58btc (Bitcoin / IPFS alphabet) ──
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58encode(buf) {
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < buf.length; i++) {
    let carry = buf[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

function b58decode(str) {
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  const bytes = [0];
  for (let i = zeros; i < str.length; i++) {
    const val = B58.indexOf(str[i]);
    if (val < 0) throw new Error(`invalid base58 character: ${str[i]}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry = carry >> 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry = carry >> 8; }
  }
  const out = Buffer.alloc(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
  return out;
}

const MULTICODEC_ED25519_PUB = Buffer.from([0xed, 0x01]); // varint of 0xed
const ID_PREFIX = "z"; // multibase base58btc

function rawPubFromPem(publicKeyPem) {
  const jwk = crypto.createPublicKey(publicKeyPem).export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url"); // raw 32-byte ed25519 public key
}

/** Encode a raw 32-byte ed25519 public key as a name/story id. */
export function encodeKeyId(rawPub) {
  return ID_PREFIX + b58encode(Buffer.concat([MULTICODEC_ED25519_PUB, rawPub]));
}

/** True when a string is one of our ed25519 key ids. */
export function isKeyId(s) {
  return typeof s === "string" && s.length > 1 && s[0] === ID_PREFIX;
}

// A valid id is "z" + base58btc(2-byte multicodec + 32-byte key) ~= 48
// chars. Cap before decoding: b58decode is O(n^2), and isKeyId only
// checks the leading "z", so an oversized sig.by on an act row would
// otherwise force quadratic CPU per verification (a cheap DoS).
const MAX_KEY_ID_LEN = 64;

/** Recover a public KeyObject from a key id. Self-certifying. */
export function keyIdToPublicKey(keyId) {
  if (!isKeyId(keyId)) throw new Error(`keyIdToPublicKey: not a key id: ${keyId}`);
  if (keyId.length > MAX_KEY_ID_LEN) throw new Error("keyIdToPublicKey: id too long");
  const decoded = b58decode(keyId.slice(1));
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("keyIdToPublicKey: not an ed25519 multicodec key");
  }
  const raw = decoded.subarray(2);
  return crypto.createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
    format: "jwk",
  });
}

/**
 * Generate a fresh name keypair. The public key IS the name id.
 * @returns {{ publicKeyPem: string, privateKeyPem: string, nameId: string }}
 */
export function generateNameKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    nameId: encodeKeyId(rawPubFromPem(publicKey)),
  };
}

/**
 * Sign a payload object with a name's private key (PEM). The payload
 * is serialized with the SAME canonicalizer facts use, so signer and
 * verifier produce byte-identical input. (A being never signs — the
 * Name it expresses does.)
 * @returns {string} base64 signature
 */
export function signAsName(privateKeyPem, payloadObj) {
  const msg = Buffer.from(canonicalize(payloadObj), "utf8");
  return crypto.sign(null, msg, privateKeyPem).toString("base64");
}

/**
 * Verify a signature against a name id (the public key). Self
 * certifying: the key is decoded from the id, no directory. Returns
 * false on any decode/verify failure rather than throwing.
 */
export function verifyNameSig(nameId, payloadObj, sigB64) {
  try {
    const pub = keyIdToPublicKey(nameId);
    const msg = Buffer.from(canonicalize(payloadObj), "utf8");
    return crypto.verify(null, msg, pub, Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Verify a signature against a raw SPKI public-key PEM, not a key id.
 * Used where the signer's id is NOT its public key: I_AM, whose id is
 * the literal "i-am" and whose key is the story key (storyIdentity).
 * Same canonicalizer as signAsName, so the two are symmetric.
 */
export function verifyWithPublicKeyPem(publicKeyPem, payloadObj, sigB64) {
  try {
    const msg = Buffer.from(canonicalize(payloadObj), "utf8");
    return crypto.verify(null, msg, publicKeyPem, Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
}

/** Encode a name/story id from its SPKI public-key PEM. */
export function keyIdFromPublicKeyPem(publicKeyPem) {
  return encodeKeyId(rawPubFromPem(publicKeyPem));
}

// ── seed-form keys (export/import) ──
//
// An ed25519 private key IS a 32-byte seed; PKCS8 wraps it in a fixed
// 16-byte DER prefix. The seed form is what BIP39 puts on paper
// (mnemonic.js) and what key-import rebuilds a keypair from. Same key,
// three skins: PEM (wire/export), seed (paper), keypair (live).
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** The raw 32-byte seed of an ed25519 private-key PEM. */
export function seedFromPrivateKeyPem(privateKeyPem) {
  const jwk = crypto.createPrivateKey(privateKeyPem).export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || !jwk.d) {
    throw new Error("seedFromPrivateKeyPem: not an ed25519 private key");
  }
  const seed = Buffer.from(jwk.d, "base64url");
  if (seed.length !== 32) throw new Error("seedFromPrivateKeyPem: bad seed length");
  return seed;
}

/**
 * Rebuild the full keypair from a 32-byte seed. The inverse of
 * seedFromPrivateKeyPem: same seed → same key → same nameId,
 * deterministically, on any host.
 * @returns {{ publicKeyPem: string, privateKeyPem: string, nameId: string }}
 */
export function keypairFromSeed(seed) {
  const buf = Buffer.from(seed);
  if (buf.length !== 32) throw new Error("keypairFromSeed: seed must be 32 bytes");
  const priv = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, buf]),
    format: "der",
    type: "pkcs8",
  });
  const pub = crypto.createPublicKey(priv);
  const publicKeyPem = pub.export({ type: "spki", format: "pem" });
  return {
    publicKeyPem,
    privateKeyPem: priv.export({ type: "pkcs8", format: "pem" }),
    nameId: encodeKeyId(rawPubFromPem(publicKeyPem)),
  };
}

/** Rebuild the full keypair (incl. nameId) from a private-key PEM. */
export function keypairFromPrivateKeyPem(privateKeyPem) {
  return keypairFromSeed(seedFromPrivateKeyPem(privateKeyPem));
}
