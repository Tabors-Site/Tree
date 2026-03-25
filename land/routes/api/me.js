import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import User from "../../seed/models/user.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";

const router = express.Router();

router.get("/me", authenticate, async (req, res) => {
  const user = await User.findById(req.userId)
    .select("username isAdmin metadata");

  if (!user)
    return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

  const energy = getUserMeta(user, "energy");
  const available = energy.available?.amount ?? 0;
  const additional = energy.additional?.amount ?? 0;

  sendOk(res, {
    userId: req.userId,
    username: req.username,
    isAdmin: user.isAdmin || false,
    plan: getUserMeta(user, "billing").plan || "basic",
    planExpiresAt: getUserMeta(user, "billing").planExpiresAt || null,
    email: getUserMeta(user, "auth")?.email || null,
    shareToken: getUserMeta(user, "html")?.shareToken || null,
    storageUsageKB: getUserMeta(user, "storage").usageKB ?? 0,
    energy: {
      available,
      additional,
      total: available + additional,
    },
  });
});

export default router;
