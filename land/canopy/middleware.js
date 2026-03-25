import log from "../seed/log.js";
import { sendError, ERR } from "../seed/protocol.js";
import { verifyCanopyToken, getLandIdentity } from "./identity.js";
import { getPeerByDomain, registerPeer } from "./peers.js";
import { lookupLandByDomain } from "./horizon.js";
import { canopyResponseHeaders } from "./protocol.js";

/**
 * Rate limit tracking for canopy requests.
 * In-memory for now. Could move to Redis for multi-instance.
 */
const rateLimitWindows = new Map();
const WINDOW_MS = 60 * 1000;

export function checkRateLimit(key, maxRequests) {
  const now = Date.now();
  const window = rateLimitWindows.get(key);

  if (!window || now - window.start > WINDOW_MS) {
    rateLimitWindows.set(key, { start: now, count: 1 });
    return true;
  }

  window.count += 1;
  return window.count <= maxRequests;
}

// Clean up old windows periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateLimitWindows) {
    if (now - window.start > WINDOW_MS * 2) {
      rateLimitWindows.delete(key);
    }
  }
}, WINDOW_MS * 5);

/**
 * Middleware: Add canopy response headers to all /canopy/ responses.
 */
export function addCanopyHeaders(req, res, next) {
  const headers = canopyResponseHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  next();
}

/**
 * Middleware: Authenticate a canopy request from a remote land.
 * Extracts the CanopyToken, verifies it against the peer's public key,
 * and attaches the decoded payload to req.canopy.
 */
export async function authenticateCanopy(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("CanopyToken ")) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "Missing CanopyToken authorization header");
    }

    const token = authHeader.slice("CanopyToken ".length);

    // Decode without verification first to get the issuer
    let unverified;
    try {
      const parts = token.split(".");
      unverified = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    } catch {
      return sendError(res, 401, ERR.UNAUTHORIZED, "Malformed CanopyToken");
    }

    const issuerDomain = unverified.iss;
    if (!issuerDomain) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "CanopyToken missing issuer (iss)");
    }

    let peer = await getPeerByDomain(issuerDomain);
    if (!peer) {
      // Rate limit auto-discovery to prevent spam lookups
      const discoverKey = `discover:${issuerDomain}`;
      if (checkRateLimit(discoverKey, 3)) {
        try {
          const horizonLand = await lookupLandByDomain(issuerDomain);
          if (horizonLand?.baseUrl) {
            // Verify the Horizon domain matches the token issuer
            // to prevent a Horizon entry from impersonating another domain
            const infoRes = await fetch(
              `${horizonLand.baseUrl.replace(/\/+$/, "")}/canopy/info`,
              { signal: AbortSignal.timeout(5000) }
            );
            if (infoRes.ok) {
              const info = await infoRes.json();
              if (info.domain === issuerDomain) {
                peer = await registerPeer(horizonLand.baseUrl);
              }
            }
          }
        } catch (_) {}
      }

      if (!peer) {
        return sendError(res, 403, ERR.FORBIDDEN, `Unknown land: ${issuerDomain}. Not registered as a peer and not found on the Horizon.`);
      }
    }

    if (peer.status === "blocked") {
      return sendError(res, 403, ERR.FORBIDDEN, `Land ${issuerDomain} is blocked`);
    }

    // Check per-land rate limit
    const landKey = `land:${issuerDomain}`;
    if (!checkRateLimit(landKey, peer.rateLimits?.requestsPerMinute || 1000)) {
      return sendError(res, 429, ERR.RATE_LIMITED, "Land rate limit exceeded");
    }

    // Verify the token with the peer's public key
    const { valid, payload, error } = await verifyCanopyToken(token, peer.publicKey);

    if (!valid) {
      return sendError(res, 401, ERR.UNAUTHORIZED, `Invalid CanopyToken: ${error}`);
    }

    // Verify token was intended for this land
    const myDomain = getLandIdentity().domain;
    if (payload.aud && payload.aud !== myDomain) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "CanopyToken audience mismatch");
    }

    // Verify the verified issuer matches the unverified one we used for peer lookup
    if (payload.iss && payload.iss !== issuerDomain) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "CanopyToken issuer mismatch after verification");
    }

    // Check per-user rate limit
    const userKey = `user:${issuerDomain}:${payload.sub}`;
    if (!checkRateLimit(userKey, peer.rateLimits?.requestsPerUserPerMinute || 60)) {
      return sendError(res, 429, ERR.RATE_LIMITED, "Per-user rate limit exceeded");
    }

    // Attach canopy context to request
    req.canopy = {
      userId: payload.sub,
      sourceLandDomain: issuerDomain,
      sourceLandId: payload.landId,
      peer,
    };

    next();
  } catch (err) {
    log.error("Canopy", "Auth error:", err.message);
    return sendError(res, 500, ERR.INTERNAL, "Internal canopy authentication error");
  }
}

/**
 * Middleware: Optional canopy auth. Does not fail if no token present.
 * Used for endpoints that work for both local and remote users.
 */
export function optionalCanopyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("CanopyToken ")) {
    req.canopy = null;
    return next();
  }
  return authenticateCanopy(req, res, next);
}
