import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { getUserTier, setUserTier } from "./core.js";

export default function (core) {
  const router = express.Router();
  const { sendOk, sendError, ERR } = core.protocol;
  const User = core.models.User;

  // GET /user/:userId/tier
  router.get("/user/:userId/tier", authenticate, async (req, res) => {
    try {
      const tier = await getUserTier(req.params.userId);
      sendOk(res, { userId: req.params.userId, tier });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT /user/:userId/tier - admin only
  router.put("/user/:userId/tier", authenticate, async (req, res) => {
    try {
      const admin = await User.findById(req.userId).select("isAdmin").lean();
      if (!admin?.isAdmin) {
        return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
      }

      const { tier } = req.body;
      if (!tier || typeof tier !== "string") {
        return sendError(res, 400, ERR.INVALID_INPUT, "Tier is required");
      }

      const result = await setUserTier(req.params.userId, tier);
      sendOk(res, { userId: req.params.userId, tier: result });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
