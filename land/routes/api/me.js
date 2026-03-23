import express from "express";
import authenticate from "../../middleware/authenticate.js";
import User from "../../db/models/user.js";
import { getUserMeta } from "../../core/tree/userMetadata.js";

const router = express.Router();

router.get("/me", authenticate, async (req, res) => {
  const user = await User.findById(req.userId)
    .select("username profileType metadata");

  if (!user)
    return res.status(404).json({ success: false, error: "User not found" });

  const energy = getUserMeta(user, "energy");
  const available = energy.available?.amount ?? 0;
  const additional = energy.additional?.amount ?? 0;

  res.json({
    success: true,
    userId: req.userId,
    username: req.username,
    profileType: user.profileType,
    planExpiresAt: getUserMeta(user, "billing").planExpiresAt || null,
    email: getUserMeta(user, "auth")?.email || null,
    shareToken: getUserMeta(user, "html")?.shareToken || null,
    storageUsageMb: energy.storageUsage ?? 0,
    energy: {
      available,
      additional,
      total: available + additional,
    },
  });
});

export default router;
