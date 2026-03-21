import crypto from "node:crypto";
import Land from "./db/models/land.js";

/**
 * Decode a CanopyToken without verifying it.
 * Token format: base64url(header).base64url(payload).base64url(signature)
 * Header: { alg: "EdDSA", typ: "JWT" }
 * Payload: { sub, iss, aud, landId, iat, exp }
 */
function decodeToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const signature = Buffer.from(parts[2], "base64url");

    return { header, payload, signature, signedContent: parts[0] + "." + parts[1] };
  } catch {
    return null;
  }
}

/**
 * Verify an Ed25519 JWT signature against a PEM public key.
 */
function verifySignature(signedContent, signature, publicKeyPem) {
  try {
    const keyObject = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, Buffer.from(signedContent), keyObject, signature);
  } catch {
    return false;
  }
}

/**
 * Verify a CanopyToken from the Authorization header.
 * Returns { valid, payload, error }.
 *
 * For new registrations (when requestPublicKey is provided), the token
 * is verified against the key in the request body.
 * For existing lands, the token is verified against the stored public key.
 */
export async function verifyDirectoryToken(authHeader, requestPublicKey = null) {
  if (!authHeader || !authHeader.startsWith("CanopyToken ")) {
    return { valid: false, error: "Missing CanopyToken authorization header" };
  }

  const token = authHeader.slice("CanopyToken ".length);
  const decoded = decodeToken(token);

  if (!decoded) {
    return { valid: false, error: "Malformed CanopyToken" };
  }

  const { header, payload, signature, signedContent } = decoded;

  if (header.alg !== "EdDSA") {
    return { valid: false, error: "Unsupported algorithm. Expected EdDSA." };
  }

  // Check expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: "Token expired" };
  }

  // Determine which public key to use for verification
  let publicKey = null;

  // Try stored key first (existing land)
  if (payload.iss) {
    const existingLand = await Land.findOne({ domain: payload.iss });
    if (existingLand) {
      publicKey = existingLand.publicKey;
    }
  }

  // Fall back to request body key (new registration)
  if (!publicKey && requestPublicKey) {
    publicKey = requestPublicKey;
  }

  if (!publicKey) {
    return { valid: false, error: "No public key available for verification" };
  }

  const isValid = verifySignature(signedContent, signature, publicKey);
  if (!isValid) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true, payload };
}

/**
 * Express middleware for directory authentication.
 * Attaches req.canopyAuth = { payload } on success.
 * Pass { allowNewRegistration: true } to accept keys from the request body.
 */
export function verifyDirectoryAuth({ allowNewRegistration = false } = {}) {
  return async (req, res, next) => {
    const requestPublicKey = allowNewRegistration ? req.body?.publicKey : null;

    const result = await verifyDirectoryToken(
      req.headers.authorization,
      requestPublicKey
    );

    if (!result.valid) {
      return res.status(401).json({ success: false, error: result.error });
    }

    req.canopyAuth = { payload: result.payload };
    next();
  };
}
