import log from "../../seed/system/log.js";
import { getPlaceConfigValue } from "../../seed/placeConfig.js";
import { SEED_VERSION } from "../../seed/system/version.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";
import { v4 as uuidv4 } from "uuid";

const ALGORITHM = "Ed25519";
const TOKEN_EXPIRY = "5m";

let placeIdentity = null;

/**
 * Strip protocol, port, and trailing slashes from a domain string.
 * "https://treeos.ai/" -> "treeos.ai", "localhost:3000" -> "localhost"
 */
function cleanDomain(raw) {
  let d = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  d = d.replace(/:\d+$/, "");
  return d;
}

// getPlaceUrl moved to seed/placeConfig.js (it's a seed-level fact about
// this place, not a canopy concern). Re-exported here so existing callers
// continue to import it from this module.
export { getPlaceUrl } from "../../seed/placeConfig.js";

/**
 * Get or create the place identity (keypair + metadata).
 * On first boot, generates a new Ed25519 keypair and writes it to disk.
 * On subsequent boots, reads the existing keypair.
 */
export function getPlaceIdentity() {
  if (placeIdentity) return placeIdentity;

  const domain = cleanDomain(process.env.PLACE_DOMAIN || "localhost");
  const name = process.env.PLACE_NAME || "My Place";
  const keyDir = process.env.PLACE_KEY_DIR || path.join(process.cwd(), ".place");
  const privateKeyPath = path.join(keyDir, "place.key");
  const publicKeyPath = path.join(keyDir, "place.key.pub");
  const idPath = path.join(keyDir, "place.id");

  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }

  let privateKey, publicKey, placeId;

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    privateKey = fs.readFileSync(privateKeyPath, "utf8");
    publicKey = fs.readFileSync(publicKeyPath, "utf8");
    placeId = fs.existsSync(idPath)
      ? fs.readFileSync(idPath, "utf8").trim()
      : uuidv4();
  } else {
    const keypair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    privateKey = keypair.privateKey;
    publicKey = keypair.publicKey;
    placeId = uuidv4();

    fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
    fs.writeFileSync(idPath, placeId, { mode: 0o644 });

    log.verbose("Place", "Generated new keypair for this place space");
  }

  placeIdentity = {
    placeId,
    domain,
    name,
    publicKey,
    privateKey,
    protocolVersion: 1,
  };

  return placeIdentity;
}

/**
 * Get the public info payload for GET /canopy/info.
 * Does not include the private key.
 */
// Lazy reference to avoid circular import at module load time.
// The loader populates this after extensions are loaded.
let _getExtNames = null;

export function setExtensionNamesProvider(fn) {
  _getExtNames = fn;
}

export function getPlaceInfoPayload() {
  const identity = getPlaceIdentity();
  const baseUrl = process.env.PLACE_BASE_URL || getPlaceUrl();
  const timezone = getPlaceConfigValue("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    placeId: identity.placeId,
    domain: identity.domain,
    name: identity.name,
    publicKey: identity.publicKey,
    protocolVersion: identity.protocolVersion,
    seedVersion: SEED_VERSION,
    baseUrl,
    siteUrl: process.env.PLACE_SITE_URL || null,
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
  const identity = getPlaceIdentity();
  const privateKey = await importPKCS8(identity.privateKey, "EdDSA");

  const token = await new SignJWT({
    sub: beingId,
    iss: identity.domain,
    aud: targetDomain,
    placeId: identity.placeId,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(privateKey);

  return token;
}

/**
 * Verify a CanopyToken JWT from a remote place.
 * Requires the remote place's public key (from PlacePeer record).
 */
export async function verifyCanopyToken(token, remotePlacePublicKey) {
  try {
    const publicKey = await importSPKI(remotePlacePublicKey, "EdDSA");
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
    });
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Sign arbitrary data with this place's private key.
 */
export function signData(data) {
  const identity = getPlaceIdentity();
  const sign = crypto.createSign(undefined);
  sign.update(typeof data === "string" ? data : JSON.stringify(data));
  return sign.sign(identity.privateKey, "base64");
}

/**
 * Verify signed data from a remote place.
 */
export function verifySignedData(data, signature, remotePlacePublicKey) {
  try {
    const verify = crypto.createVerify(undefined);
    verify.update(typeof data === "string" ? data : JSON.stringify(data));
    return verify.verify(remotePlacePublicKey, signature, "base64");
  } catch {
    return false;
  }
}
