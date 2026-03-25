import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";

import { getExtension } from "../../extensions/loader.js";

// readAuth: delegates to html-rendering's urlAuth if installed, otherwise requires hard auth
function readAuth(req, res, next) {
  const handler = getExtension("html-rendering")?.exports?.urlAuth;
  if (handler) return handler(req, res, next);
  return authenticate(req, res, next);
}

import User from "../../seed/models/user.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";

// Energy: dynamic import, no-op if extension not installed
function html() { return getExtension("html-rendering")?.exports || {}; }

import { createNode } from "../../seed/tree/treeManagement.js";

const router = express.Router();

const allowedParams = ["token", "html", "limit", "startTime", "endTime", "q"];

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

router.get("/user/:userId", readAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const user = await User.findById(userId)
      .populate("roots", "name _id visibility")
      .exec();

    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    }
    (getExtension("energy")?.exports?.maybeResetEnergy || (() => false))(user);

    const roots = user.roots || [];
    const billingMeta = getUserMeta(user, "billing");
    const plan = billingMeta.plan || "basic";
    const energyData = getUserMeta(user, "energy");
    const energy = energyData.available;
    const extraEnergy = energyData.additional;
    const canopyMeta = getUserMeta(user, "canopy");

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return sendOk(res, {
        userId: user._id,
        username: user.username,
        roots,
        remoteRoots: canopyMeta.remoteRoots || [],
        isAdmin: user.isAdmin || false,
        plan,
        energy,
      });
    }

    const ENERGY_RESET_MS = 24 * 60 * 60 * 1000;
    const storageUsedKB = getUserMeta(user, "storage").usageKB || 0;

    const lastResetAt = energy?.lastResetAt
      ? new Date(energy.lastResetAt)
      : null;

    const nextResetAt = lastResetAt
      ? new Date(lastResetAt.getTime() + ENERGY_RESET_MS)
      : null;

    const resetTimeLabel = nextResetAt
      ? nextResetAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

    return res.send(
      html().renderUserProfile({
        userId,
        user,
        roots,
        plan,
        energy,
        extraEnergy,
        queryString,
        resetTimeLabel,
        storageUsedKB,
      }),
    );
  } catch (err) {
    log.error("API", "Error in /user/:userId:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// Notes, tags routes moved to extensions/user-queries

// Contributions, chats, notifications routes moved to extensions/user-queries

router.get("/user/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      "metadata.auth.resetPasswordToken": token,
      "metadata.auth.resetPasswordExpiry": { $gt: Date.now() },
    });

    if (!user) {
      return res.send(html().renderResetPasswordExpired());
    }

    return res.send(html().renderResetPasswordForm({ token }));
  } catch (err) {
    log.error("API", "Error loading reset password page:", err);
    res.status(500).send("Server error");
  }
});

/* -----------------------------------------------------------
   HANDLE RESET PASSWORD FORM POST
----------------------------------------------------------- */
router.post("/user/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirm } = req.body;

    if (password !== confirm) {
      return res.send(html().renderResetPasswordMismatch({ token }));
    }

    const user = await User.findOne({
      "metadata.auth.resetPasswordToken": token,
      "metadata.auth.resetPasswordExpiry": { $gt: Date.now() },
    });

    if (!user) {
      return res.send(html().renderResetPasswordInvalid());
    }

    user.password = password;
    const { setUserMeta, getUserMeta } = await import("../../seed/tree/userMetadata.js");
    const auth = getUserMeta(user, "auth");
    delete auth.resetPasswordToken;
    delete auth.resetPasswordExpiry;
    auth.tokensInvalidBefore = new Date().toISOString();
    setUserMeta(user, "auth", auth);

    await user.save();

    return res.send(html().renderResetPasswordSuccess());
  } catch (err) {
    log.error("API", "Error resetting password:", err);
    res.status(500).send("Server error");
  }
});

router.post("/user/:userId/createRoot", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, type } = req.body;

    if (req.userId.toString() !== userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }

    if (!name || typeof name !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "Name is required");
    }

    const rootNode = await createNode(
      name,
      null,
      0,
      null,
      true, // isRoot
      userId,
      {},
      {},
      null,
      req.user,
      false, // wasAi
      null, // chatId
      null, // sessionId
      type || null,
    );

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${rootNode._id}?token=${req.query.token ?? ""}&html`,
      );
    }

    sendOk(res, {
      rootId: rootNode._id,
      root: rootNode,
    }, 201);
  } catch (err) {
    log.error("API", "createRoot error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// Raw idea routes moved to extensions/raw-ideas

// Invite routes moved to extensions/team

// Deleted/revive routes moved to extensions/deleted-revive

// API key routes moved to extensions/api-keys
// Share token routes moved to extensions/visibility
// Energy routes moved to extensions/energy
// Purchase route moved to extensions/billing

// Chats and notifications routes moved to extensions/user-queries

router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return sendError(res, 413, ERR.INVALID_INPUT, "File exceeds maximum size of 4 GB");
  }
  next(err);
});

export default router;
