import log from "../../seed/log.js";
import express from "express";
import Being from "../../seed/models/being.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  createApiKey,
  generateApiKey,
  deleteApiKey,
} from "./core.js";
import { getBeingMeta, setBeingMeta } from "../../seed/tree/beingMetadata.js";

function getKeys(user) {
  const raw = getBeingMeta(user, "apiKeys");
  return Array.isArray(raw) ? raw : [];
}
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }
import { renderApiKeyCreated, renderApiKeysList } from "./pages/apiKeys.js";

const router = express.Router();

router.post("/user/:beingId/api-keys", authenticate, async (req, res) => {
  if (req.beingId.toString() !== req.params.beingId.toString()) {
    return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
  }

  const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
  if (!wantHtml || !getExtension("html-rendering")) {
    return createApiKey(req, res);
  }

  try {
    const beingId = req.beingId;
    const { name, revokeOld = false } = req.body;
    const safeName = (name?.trim().slice(0, 64) || "API Key").replace(
      /<[^>]*>/g,
      "",
    );

    const user = await Being.findById(beingId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    let keys = getKeys(user);

    if (keys.filter((k) => !k.revoked).length >= 10) {
      const token = req.query.token ?? "";
      const qs = token ? `?token=${token}&html` : `?html`;
      return res.redirect(`/api/v1/user/${beingId}/api-keys${qs}&error=limit`);
    }

    if (revokeOld) {
      keys = keys.map((k) => ({ ...k, revoked: true }));
    }

    const { rawKey, keyHash, keyPrefix } = await generateApiKey();
    const crypto = await import("crypto");
    keys = [...keys, { _id: crypto.randomUUID(), keyHash, keyPrefix, name: safeName, createdAt: new Date() }];
    await setBeingMeta(user, "apiKeys", keys);

    const token = req.query.token ?? "";

    return res
      .status(201)
      .send(renderApiKeyCreated({ beingId, safeName, rawKey, token }));
  } catch (err) {
 log.error("Api Keys", "API key create (html) error:", err);
    return res.status(500).send("Failed to create API key");
  }
});

router.get("/user/:beingId/api-keys", authenticate, async (req, res) => {
  try {
    if (req.beingId.toString() !== req.params.beingId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const beingId = req.params.beingId;

    const user = await Being.findById(req.beingId)
      .select("username metadata");
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    const apiKeys = getKeys(user);

    if (!wantHtml || !getExtension("html-rendering")) {
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
      renderApiKeysList({ beingId, user, apiKeys, token, errorParam }),
    );
  } catch (err) {
 log.error("Api Keys", "api keys page error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete(
  "/user/:beingId/api-keys/:keyId",
  authenticate,
  async (req, res) => {
    if (req.beingId.toString() !== req.params.beingId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }
    return deleteApiKey(req, res);
  },
);

export default router;
