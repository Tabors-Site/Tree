import log from "../../seed/log.js";
import express from "express";
import User from "../../seed/models/user.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  createApiKey,
  generateApiKey,
  deleteApiKey,
} from "./core.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }

const router = express.Router();

router.post("/user/:userId/api-keys", authenticate, async (req, res) => {
  if (req.userId.toString() !== req.params.userId.toString()) {
    return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
  }

  const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
  if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
    return createApiKey(req, res);
  }

  try {
    const userId = req.userId;
    const { name, revokeOld = false } = req.body;
    const safeName = (name?.trim().slice(0, 64) || "API Key").replace(
      /<[^>]*>/g,
      "",
    );

    const user = await User.findById(userId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    let keys = getUserMeta(user, "apiKeys") || [];

    if (keys.filter((k) => !k.revoked).length >= 10) {
      const token = req.query.token ?? "";
      const qs = token ? `?token=${token}&html` : `?html`;
      return res.redirect(`/api/v1/user/${userId}/api-keys${qs}&error=limit`);
    }

    if (revokeOld) {
      keys = keys.map((k) => ({ ...k, revoked: true }));
    }

    const { rawKey, keyHash, keyPrefix } = await generateApiKey();
    const crypto = await import("crypto");
    keys = [...keys, { _id: crypto.randomUUID(), keyHash, keyPrefix, name: safeName, createdAt: new Date() }];
    setUserMeta(user, "apiKeys", keys);
    await user.save();

    const token = req.query.token ?? "";

    return res
      .status(201)
      .send(html().renderApiKeyCreated({ userId, safeName, rawKey, token }));
  } catch (err) {
 log.error("Api Keys", "API key create (html) error:", err);
    return res.status(500).send("Failed to create API key");
  }
});

router.get("/user/:userId/api-keys", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const userId = req.params.userId;

    const user = await User.findById(req.userId)
      .select("username metadata");
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    const apiKeys = getUserMeta(user, "apiKeys") || [];

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return sendOk(res, {
        keys: apiKeys.map((k) => ({
          id: k._id,
          name: k.name,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          usageCount: k.usageCount,
          revoked: k.revoked,
        })),
      });
    }

    const token = req.query.token ?? "";
    const errorParam = req.query.error || null;

    return res.send(
      html().renderApiKeysList({ userId, user, apiKeys, token, errorParam }),
    );
  } catch (err) {
 log.error("Api Keys", "api keys page error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete(
  "/user/:userId/api-keys/:keyId",
  authenticate,
  async (req, res) => {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }
    return deleteApiKey(req, res);
  },
);

export default router;
