import log from "../../core/log.js";
import express from "express";
import User from "../../db/models/user.js";
import authenticate from "../../middleware/authenticate.js";
import {
  createApiKey,
  generateApiKey,
  deleteApiKey,
} from "./core.js";
import { getApiKeys, setApiKeys } from "../../core/tree/userMetadata.js";
import {
  renderApiKeyCreated,
  renderApiKeysList,
} from "../../routes/api/html/user.js";

const router = express.Router();

router.post("/user/:userId/api-keys", authenticate, async (req, res) => {
  if (req.userId.toString() !== req.params.userId.toString()) {
    return res.status(403).json({ message: "Not authorized" });
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
    if (!user) return res.status(404).send("User not found");

    let keys = getApiKeys(user);

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
    setApiKeys(user, keys);
    await user.save();

    const token = req.query.token ?? "";

    return res
      .status(201)
      .send(renderApiKeyCreated({ userId, safeName, rawKey, token }));
  } catch (err) {
 log.error("Api Keys", "API key create (html) error:", err);
    return res.status(500).send("Failed to create API key");
  }
});

router.get("/user/:userId/api-keys", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const userId = req.params.userId;

    const user = await User.findById(req.userId)
      .select("username metadata");
    if (!user) return res.status(404).json({ message: "User not found" });
    const apiKeys = getApiKeys(user);

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json(
        apiKeys.map((k) => ({
          id: k._id,
          name: k.name,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          usageCount: k.usageCount,
          revoked: k.revoked,
        })),
      );
    }

    const token = req.query.token ?? "";
    const errorParam = req.query.error || null;

    return res.send(
      renderApiKeysList({ userId, user, apiKeys, token, errorParam }),
    );
  } catch (err) {
 log.error("Api Keys", "api keys page error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete(
  "/user/:userId/api-keys/:keyId",
  authenticate,
  async (req, res) => {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }
    return deleteApiKey(req, res);
  },
);

export default router;
