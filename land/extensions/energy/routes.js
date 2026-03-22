import express from "express";
import User from "../../db/models/user.js";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";
import { getConnectionsForUser } from "../../core/llms/customLLM.js";
import { renderEnergy } from "../../routes/api/html/user.js";

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
    let user = await User.findById(userId).lean().exec();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const energyAmount = user.availableEnergy?.amount ?? 0;
    const additionalEnergy = user.additionalEnergy?.amount ?? 0;
    const profileType = (user.profileType || "basic").toLowerCase();
    const planExpiresAt = user.planExpiresAt || null;

    const llmConnections = await getConnectionsForUser(userId);
    const mainAssignment = user.llmAssignments?.main || null;
    const rawIdeaAssignment = user.llmAssignments?.rawIdea || null;
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
        energy: user.availableEnergy,
        additionalEnergy: user.additionalEnergy,
        hasCustomLlm: hasLlm,
      });
    }

    return res.send(
      renderEnergy({
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
    console.error("Energy page error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
