import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { getUserTier, setUserTier } from "./core.js";

export default function (core) {
  const router = express.Router();
  const { sendOk, sendError, ERR } = core.protocol;
  const User = core.models.User;

  // GET /user/:beingId/tier
  router.get("/user/:beingId/tier", authenticate, async (req, res) => {
    try {
      const tier = await getUserTier(req.params.beingId);
      sendOk(res, { beingId: req.params.beingId, tier });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT /user/:beingId/tier - admin only
  router.put("/user/:beingId/tier", authenticate, async (req, res) => {
    try {
      const admin = await Being.findById(req.beingId).select("isAdmin").lean();
      if (!admin?.isAdmin) {
        return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
      }

      const { tier } = req.body;
      if (!tier || typeof tier !== "string") {
        return sendError(res, 400, ERR.INVALID_INPUT, "Tier is required");
      }

      const result = await setUserTier(req.params.beingId, tier);
      sendOk(res, { beingId: req.params.beingId, tier: result });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
