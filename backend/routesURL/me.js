import express from "express";
import authenticate from "../middleware/authenticate.js";
import User from "../db/models/user.js";

const router = express.Router();

router.get("/me", authenticate, async (req, res) => {
  const user = await User.findById(req.userId)
    .select(
      "username email profileType planExpiresAt availableEnergy additionalEnergy htmlShareToken storageUsage",
    )
    .lean();

  if (!user)
    return res.status(404).json({ success: false, error: "User not found" });

  const available = user.availableEnergy?.amount ?? 0;
  const additional = user.additionalEnergy?.amount ?? 0;

  res.json({
    success: true,
    userId: req.userId,
    username: req.username,
    profileType: user.profileType,
    planExpiresAt: user.planExpiresAt,
    email: user.email,
    shareToken: user.htmlShareToken || null,
    storageUsageMb: user.storageUsage ?? 0,
    energy: {
      available,
      additional,
      total: available + additional,
    },
  });
});

export default router;
