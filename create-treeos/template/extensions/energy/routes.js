import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }

import { getUserMeta } from "../../seed/tree/userMetadata.js";

// Models wired from init via setModels
let _User = null;
export function setModels(models) { _User = models.User; }

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

router.get("/user/:userId/energy", authenticateOptional, async (req, res) => {
  try {
    const { userId } = req.params;
    const qs = buildQueryString(req);
    let user = await _User.findById(userId).exec();
    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    }

    const energy = getUserMeta(user, "energy");
    const energyAmount = energy.available?.amount ?? 0;
    const additionalEnergy = energy.additional?.amount ?? 0;
    const plan = (getUserMeta(user, "tiers").plan || "basic").toLowerCase();
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
    const isBasic = plan === "basic";

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const htmlExt = getExtension("html-rendering");
    if (!wantHtml || !htmlExt) {
      return sendOk(res, {
        userId: user._id,
        plan,
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
        plan,
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
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
