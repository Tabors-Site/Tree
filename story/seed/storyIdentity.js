import log from "./seedStory/log.js";
import { getStoryConfigValue } from "./storyConfig.js";
import { SEED_VERSION } from "./seedStory/version.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";
import { keyIdFromPublicKeyPem } from "./materials/name/keys.js";

const ALGORITHM = "Ed25519";
const TOKEN_EXPIRY = "5m";

let storyIdentity = null;

/**
 * Strip protocol, port, and trailing slashes from a domain string.
 * "https://treeos.ai/" -> "treeos.ai", "localhost:3000" -> "localhost"
 */
function cleanDomain(raw) {
  let d = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  d = d.replace(/:\d+$/, "");
  return d;
}

// getStoryUrl moved to seed/storyConfig.js (it's a seed-level fact about
// this place, not a canopy concern). Re-exported here so existing callers
// continue to import it from this module.
export { getStoryUrl } from "./storyConfig.js";

/**
 * Get or create the place identity (keypair + metadata).
 * On first boot, generates a new Ed25519 keypair and writes it to disk.
 * On subsequent boots, reads the existing keypair.
 */
export function getStoryIdentity() {
  if (storyIdentity) return storyIdentity;

  const domain = cleanDomain(process.env.STORY_DOMAIN || "localhost");
  const name = process.env.STORY_NAME || "My Place";
  const keyDir = process.env.STORY_KEY_DIR || path.join(process.cwd(), ".story");
  const privateKeyPath = path.join(keyDir, "story.key");
  const publicKeyPath = path.join(keyDir, "story.key.pub");

  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }

  let privateKey, publicKey;

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    privateKey = fs.readFileSync(privateKeyPath, "utf8");
    publicKey = fs.readFileSync(publicKeyPath, "utf8");
  } else {
    const keypair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    privateKey = keypair.privateKey;
    publicKey = keypair.publicKey;

    fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

    log.verbose("Story", "Generated new keypair for this story");
  }

  // The story is a wallet: its id IS its public key, encoded the same
  // z... way as a being id (this story's I_AM shares this exact key,
  // so storyId === I_AM's key id). Derived from the keypair every boot,
  // never stored — story.key.pub is the only source of truth. Both the
  // old random-uuid story.id token AND its derived on-disk cache are
  // retired: identity is the key, not a file. (The whole-place CAS tie
  // lives separately in storyRoot()/signedStoryRoot() — content, signed
  // BY this key, not conflated with the key's id.)
  const storyId = keyIdFromPublicKeyPem(publicKey);

  storyIdentity = {
    storyId,
    domain,
    name,
    publicKey,
    privateKey,
    protocolVersion: 1,
  };

  return storyIdentity;
}

/**
 * The public info payload other realities and clients can read about
 * this place: name, domain, public key, protocol version, loaded
 * extensions. Does not include the private key. Surfaced today by
 * IBP discovery (the `.identity` heaven space) and the
 * `/.well-known/treeos-portal` bootstrap route.
 */
// Lazy reference to avoid circular import at module load time.
// The loader populates this after extensions are loaded.
let _getExtNames = null;

export function setExtensionNamesProvider(fn) {
  _getExtNames = fn;
}

export function getStoryInfoPayload() {
  const identity = getStoryIdentity();
  const baseUrl = process.env.STORY_BASE_URL || getStoryUrl();
  const timezone = getStoryConfigValue("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    storyId: identity.storyId,
    domain: identity.domain,
    name: identity.name,
    publicKey: identity.publicKey,
    protocolVersion: identity.protocolVersion,
    seedVersion: SEED_VERSION,
    baseUrl,
    siteUrl: process.env.STORY_SITE_URL || null,
    timezone,
    capabilities: [
      ...(_getExtNames && _getExtNames().includes("team") ? ["invite"] : []),
      "proxy", "notify", "public-trees", "llm-proxy",
    ],
    extensions: _getExtNames ? _getExtNames() : [],
  };
}

/**
 * Sign a CanopyToken JWT for authenticating requests to a remote place.
 * Used when proxying a local user's request to a remote place.
 */
export async function signCanopyToken(beingId, targetDomain) {
  const identity = getStoryIdentity();
  const privateKey = await importPKCS8(identity.privateKey, "EdDSA");

  const token = await new SignJWT({
    sub: beingId,
    iss: identity.domain,
    aud: targetDomain,
    storyId: identity.storyId,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(privateKey);

  return token;
}

/**
 * Verify a CanopyToken JWT from a remote place.
 * Requires the remote place's public key (from StoryPeer record).
 */
export async function verifyCanopyToken(token, remoteStoryPublicKey) {
  try {
    const publicKey = await importSPKI(remoteStoryPublicKey, "EdDSA");
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
    });
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Sign arbitrary data with this story's private key.
 *
 * Ed25519 uses the one-shot crypto.sign() with algorithm=null, not
 * the streaming createSign API. Node 24+ throws "algorithm argument
 * must be of type string" when createSign() is called with undefined,
 * and ed25519 has no algorithm string to pass anyway — the curve IS
 * the algorithm. This matches the supported Node API for the ed25519
 * keys generated in this same file.
 */
export function signData(data) {
  const identity = getStoryIdentity();
  const buf = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
  return crypto.sign(null, buf, identity.privateKey).toString("base64");
}

/**
 * Verify signed data from a remote place. Same ed25519 one-shot path
 * as signData.
 */
export function verifySignedData(data, signature, remoteStoryPublicKey) {
  try {
    const buf = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
    const sigBuf = Buffer.from(signature, "base64");
    return crypto.verify(null, buf, remoteStoryPublicKey, sigBuf);
  } catch {
    return false;
  }
}
