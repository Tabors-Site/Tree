import log from "../../core/log.js";
import express from "express";
import User from "../../db/models/user.js";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";
import { getConnectionsForUser } from "../../core/llms/customLLM.js";
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }
import { getEnergy, getUserMeta } from "../../core/tree/userMetadata.js";

const router = express.Router();

function buildQueryString(req) {
  const allowedParams = ["token", "html"];
  const filtered = Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) =>
      val === "" ? key : `${key}=${encodeURIComponent(val)}`,
    )
    .join("&");
  return filtered ? `?${filtered}` : "";
}

router.get("/user/:userId/energy", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const qs = buildQueryString(req);
    let user = await User.findById(userId).exec();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const energy = getEnergy(user);
    const energyAmount = energy.available?.amount ?? 0;
    const additionalEnergy = energy.additional?.amount ?? 0;
    const profileType = (user.profileType || "basic").toLowerCase();
    const billing = getUserMeta(user, "billing");
    const planExpiresAt = billing.planExpiresAt || null;

    const llmConnections = await getConnectionsForUser(userId);
    const mainAssignment = user.llmDefault || null;
    const userLlmSlots = getUserMeta(user, "userLlm")?.slots || {};
    const rawIdeaAssignment = userLlmSlots.rawIdea || null;
    const activeConn = mainAssignment
      ? llmConnections.find((c) => c._id === mainAssignment)
      : null;
    const hasLlm = !!activeConn;
    const connectionCount = llmConnections.length;
    const isBasic = profileType === "basic";

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        userId: user._id,
        profileType,
        energy: energy.available,
        additionalEnergy: energy.additional,
        hasCustomLlm: hasLlm,
      });
    }

    return res.send(
      html().renderEnergy({
        userId,
        user,
        energyAmount,
        additionalEnergy,
        profileType,
        planExpiresAt,
        llmConnections,
        mainAssignment,
        rawIdeaAssignment,
        activeConn,
        hasLlm,
        connectionCount,
        isBasic,
        qs,
      }),
    );
  } catch (err) {
 log.error("Energy", "Energy page error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
