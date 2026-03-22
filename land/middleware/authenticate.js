import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import User from "../db/models/user.js";
import { resolveTreeAccess } from "../core/authenticate.js";
import { verifyCanopyToken, getLandIdentity } from "../canopy/identity.js";
import { getPeerByDomain } from "../canopy/peers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

/* ===========================
    API KEY BRUTE-FORCE PROTECTION
============================ */
const failedAttempts = new Map();
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 10;

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function checkApiKeyRateLimit(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return true;
  if (Date.now() - entry.start > FAIL_WINDOW_MS) {
    failedAttempts.delete(ip);
    return true;
  }
  return entry.count < MAX_FAILURES;
}

function recordApiKeyFailure(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry || Date.now() - entry.start > FAIL_WINDOW_MS) {
    failedAttempts.set(ip, { start: Date.now(), count: 1 });
  } else {
    entry.count += 1;
  }
}

function clearApiKeyFailures(ip) {
  failedAttempts.delete(ip);
}

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (now - entry.start > FAIL_WINDOW_MS * 2) failedAttempts.delete(ip);
  }
}, 10 * 60 * 1000);

export default async function authenticate(req, res, next) {
  try {
    /* ===========================
        0. CANOPY TOKEN AUTH (remote land users)
    ============================ */
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("CanopyToken ")) {
      const canopyToken = authHeader.slice("CanopyToken ".length);

      // Decode to get issuer
      let unverified;
      try {
        const parts = canopyToken.split(".");
        unverified = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      } catch {
        return res.status(401).json({ message: "Malformed CanopyToken" });
      }

      const peer = await getPeerByDomain(unverified.iss);
      if (!peer) {
        return res.status(403).json({ message: "Unknown land: " + unverified.iss });
      }
      if (peer.status === "blocked") {
        return res.status(403).json({ message: "Land " + unverified.iss + " is blocked" });
      }

      const { valid, payload, error } = await verifyCanopyToken(canopyToken, peer.publicKey);
      if (!valid) {
        return res.status(401).json({ message: "Invalid CanopyToken: " + error });
      }

      // Verify token was intended for this land (prevent replay across lands)
      const myDomain = getLandIdentity().domain;
      if (payload.aud && payload.aud !== myDomain) {
        return res.status(401).json({ message: "CanopyToken audience mismatch" });
      }

      // Verify the verified issuer matches what we used for peer lookup
      if (payload.iss && payload.iss !== unverified.iss) {
        return res.status(401).json({ message: "CanopyToken issuer mismatch" });
      }

      // The sub is the remote user's ID. Must be a ghost user from the claiming land.
      // SECURITY: Verify isRemote and homeLand match to prevent UUID collision attacks.
      const ghostUser = await User.findOne({
        _id: payload.sub,
        isRemote: true,
        homeLand: payload.iss,
      });
      if (!ghostUser) {
        return res.status(403).json({ message: "Remote user not registered on this land" });
      }

      req.userId = ghostUser._id;
      req.username = ghostUser.username;
      req.authType = "canopy";
      req.canopy = {
        sourceLandDomain: unverified.iss,
        sourceLandId: payload.landId,
        peer,
      };

      await attachTreeAccess(req);
      return next();
    }

    /* ===========================
        1. JWT AUTH (preferred)
    ============================ */
    let token = null;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }

    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);

      req.userId = decoded.userId;
      req.username = decoded.username;
      req.authType = "jwt";

      await attachTreeAccess(req);
      return next();
    }

    const apiKey =
      req.headers["x-api-key"] ||
      (authHeader?.startsWith("ApiKey ")
        ? authHeader.slice(7).trim()
        : null);

    if (!apiKey) {
      return res.status(401).json({
        message: "Missing credentials",
      });
    }

    // Brute-force protection
    const clientIp = getClientIp(req);
    if (!checkApiKeyRateLimit(clientIp)) {
      return res.status(429).json({
        message: "Too many failed attempts. Try again later.",
      });
    }

    // Use key prefix for indexed lookup instead of scanning all users
    const prefix = apiKey.slice(0, 8);
    const candidates = await User.find({
      "apiKeys.keyPrefix": prefix,
      "apiKeys.revoked": false,
    });

    for (const user of candidates) {
      for (const key of user.apiKeys) {
        if (key.revoked) continue;
        if (key.keyPrefix && key.keyPrefix !== prefix) continue;

        const match = await bcrypt.compare(apiKey, key.keyHash);
        if (!match) continue;

        clearApiKeyFailures(clientIp);
        req.userId = user._id;
        req.username = user.username;
        req.authType = "apiKey";
        req.apiKeyId = key._id;

        // usage tracking (atomic)
        await User.updateOne(
          { _id: user._id, "apiKeys._id": key._id },
          {
            $inc: { "apiKeys.$.usageCount": 1 },
            $set: { "apiKeys.$.lastUsedAt": new Date() },
          }
        );

        await attachTreeAccess(req);
        return next();
      }
    }

    recordApiKeyFailure(clientIp);
    return res.status(401).json({
      message: "Invalid API key",
    });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({
      message: "Invalid or expired credentials",
    });
  }
}

/* ===========================
    TREE ACCESS HELPER
=========================== */
async function attachTreeAccess(req) {
  const nodeId = req.body?.nodeId || req.params?.nodeId || req.query?.nodeId;

  if (!nodeId) return;

  const access = await resolveTreeAccess(nodeId, req.userId);

  if (!access.canWrite && !access.isOwner && !access.isContributor) {
    throw new Error("TREE_ACCESS_DENIED");
  }

  req.rootId = access.rootId;
  req.treeAccess = access;
}
