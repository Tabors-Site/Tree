import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import User from "../db/models/user.js";
import { resolveTreeAccess } from "../core/authenticate.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

export default async function authenticate(req, res, next) {
  try {
    /* ===========================
        1️⃣ JWT AUTH (preferred)
    ============================ */
    let token = null;

    const authHeader = req.headers.authorization;
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
      (req.headers.authorization?.startsWith("ApiKey ")
        ? req.headers.authorization.slice(7).trim()
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
