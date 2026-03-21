import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import User from "../db/models/user.js";
import { resolveTreeAccess } from "../core/authenticate.js";
import { verifyCanopyToken } from "../canopy/identity.js";
import { getPeerByDomain } from "../canopy/peers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

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

      const { valid, payload, error } = verifyCanopyToken(canopyToken, peer.publicKey);
      if (!valid) {
        return res.status(401).json({ message: "Invalid CanopyToken: " + error });
      }

      // The sub is the remote user's ID. They should exist as a ghost user (isRemote: true)
      const ghostUser = await User.findById(payload.sub);
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
        : null) ||
      req.body?.apiKey;

    if (!apiKey) {
      return res.status(401).json({
        message: "Missing credentials",
      });
    }
    // Find users with active keys only
    const users = await User.find({ "apiKeys.revoked": false });

    for (const user of users) {
      for (const key of user.apiKeys) {
        if (key.revoked) continue;

        const match = await bcrypt.compare(apiKey, key.keyHash);
        if (!match) continue;

        // 🔓 API key authenticated
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
