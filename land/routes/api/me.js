import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import Being from "../../seed/models/being.js";
import { getBeingMeta } from "../../seed/tree/beingMetadata.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";

const router = express.Router();

router.get("/me", authenticate, async (req, res) => {
  const user = await Being.findById(req.beingId)
    .select("username isAdmin metadata");

  if (!user)
    return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

  const energy = getBeingMeta(user, "energy");
  const available = energy.available?.amount ?? 0;
  const additional = energy.additional?.amount ?? 0;

  sendOk(res, {
    beingId: req.beingId,
    username: req.username,
    isAdmin: user.isAdmin || false,
    plan: getBeingMeta(user, "billing").plan || "basic",
    planExpiresAt: getBeingMeta(user, "billing").planExpiresAt || null,
    email: getBeingMeta(user, "auth")?.email || null,
    shareToken: getBeingMeta(user, "html")?.shareToken || null,
    storageUsageKB: getBeingMeta(user, "storage").usageKB ?? 0,
    energy: {
      available,
      additional,
      total: available + additional,
    },
  });
});

export default router;
