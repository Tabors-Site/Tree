import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";
import { v4 as uuidv4 } from "uuid";

const ALGORITHM = "Ed25519";
const TOKEN_EXPIRY = "5m";

let landIdentity = null;
let cachedLandUrl = null;

/**
 * Strip protocol, port, and trailing slashes from a domain string.
 * "https://treeos.ai/" -> "treeos.ai", "localhost:3000" -> "localhost"
 */
function cleanDomain(raw) {
  let d = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  d = d.replace(/:\d+$/, "");
  return d;
}

/**
 * Get the full base URL for this land (e.g. "http://localhost:3000" or "https://treeos.ai").
 * Derived from LAND_DOMAIN + PORT. Falls back to TREE_FRONTEND_DOMAIN for backward compat.
 */
export function getLandUrl() {
  if (cachedLandUrl) return cachedLandUrl;
  // Backward compat: if TREE_FRONTEND_DOMAIN is set explicitly, use it
  if (process.env.TREE_FRONTEND_DOMAIN) {
    cachedLandUrl = process.env.TREE_FRONTEND_DOMAIN.replace(/\/+$/, "");
    return cachedLandUrl;
  }
  const domain = cleanDomain(process.env.LAND_DOMAIN || "localhost");
  const port = process.env.PORT || 80;
  const isLocal = domain === "localhost" || domain.startsWith("localhost") || domain.startsWith("127.") || domain.startsWith("192.168.") || domain.startsWith("10.") || domain.endsWith(".lan") || domain.endsWith(".local") || !domain.includes(".");
  const protocol = isLocal ? "http" : "https";
  // Only append port for local domains. Public domains are behind reverse proxies.
  const portSuffix = isLocal && port != 80 && port != 443 ? `:${port}` : "";
  cachedLandUrl = `${protocol}://${domain}${portSuffix}`;
  return cachedLandUrl;
}

/**
 * Get or create the land identity (keypair + metadata).
 * On first boot, generates a new Ed25519 keypair and writes it to disk.
 * On subsequent boots, reads the existing keypair.
 */
export function getLandIdentity() {
  if (landIdentity) return landIdentity;

  const domain = cleanDomain(process.env.LAND_DOMAIN || "localhost");
  const name = process.env.LAND_NAME || "My Land";
  const keyDir = process.env.LAND_KEY_DIR || path.join(process.cwd(), ".land");
  const privateKeyPath = path.join(keyDir, "land.key");
  const publicKeyPath = path.join(keyDir, "land.key.pub");
  const idPath = path.join(keyDir, "land.id");

  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }

  let privateKey, publicKey, landId;

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    privateKey = fs.readFileSync(privateKeyPath, "utf8");
    publicKey = fs.readFileSync(publicKeyPath, "utf8");
    landId = fs.existsSync(idPath)
      ? fs.readFileSync(idPath, "utf8").trim()
      : uuidv4();
  } else {
    const keypair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    privateKey = keypair.privateKey;
    publicKey = keypair.publicKey;
    landId = uuidv4();

    fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
    fs.writeFileSync(idPath, landId, { mode: 0o644 });

    console.log("[Land] Generated new keypair for this land node");
  }

  landIdentity = {
    landId,
    domain,
    name,
    publicKey,
    privateKey,
    protocolVersion: 1,
  };

  return landIdentity;
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

export function getLandInfoPayload() {
  const identity = getLandIdentity();
  const baseUrl = process.env.LAND_BASE_URL || getLandUrl();

  return {
    landId: identity.landId,
    domain: identity.domain,
    name: identity.name,
    publicKey: identity.publicKey,
    protocolVersion: identity.protocolVersion,
    baseUrl,
    siteUrl: process.env.LAND_SITE_URL || null,
    capabilities: ["invite", "proxy", "notify", "public-trees", "llm-proxy"],
    extensions: _getExtNames ? _getExtNames() : [],
  };
}

/**
 * Sign a CanopyToken JWT for authenticating requests to a remote land.
 * Used when proxying a local user's request to a remote land.
 */
export async function signCanopyToken(userId, targetDomain) {
  const identity = getLandIdentity();
  const privateKey = await importPKCS8(identity.privateKey, "EdDSA");

  const token = await new SignJWT({
    sub: userId,
    iss: identity.domain,
    aud: targetDomain,
    landId: identity.landId,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(privateKey);

  return token;
}

/**
 * Verify a CanopyToken JWT from a remote land.
 * Requires the remote land's public key (from LandPeer record).
 */
export async function verifyCanopyToken(token, remoteLandPublicKey) {
  try {
    const publicKey = await importSPKI(remoteLandPublicKey, "EdDSA");
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
    });
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Sign arbitrary data with this land's private key.
 */
export function signData(data) {
  const identity = getLandIdentity();
  const sign = crypto.createSign(undefined);
  sign.update(typeof data === "string" ? data : JSON.stringify(data));
  return sign.sign(identity.privateKey, "base64");
}

/**
 * Verify signed data from a remote land.
 */
export function verifySignedData(data, signature, remoteLandPublicKey) {
  try {
    const verify = crypto.createVerify(undefined);
    verify.update(typeof data === "string" ? data : JSON.stringify(data));
    return verify.verify(remoteLandPublicKey, signature, "base64");
  } catch {
    return false;
  }
}
