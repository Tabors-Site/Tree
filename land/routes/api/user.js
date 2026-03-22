import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";

import User from "../../db/models/user.js";

// Energy: dynamic import, no-op if extension not installed
let maybeResetEnergy = () => false;
try { ({ maybeResetEnergy } = await import("../../extensions/energy/core.js")); } catch {}

import { createNewNode } from "../../core/tree/treeManagement.js";

import {
  getPendingInvitesForUser,
  respondToInvite,
} from "../../core/tree/invites.js";

import {
  renderUserProfile,
  renderResetPasswordExpired,
  renderResetPasswordForm,
  renderResetPasswordMismatch,
  renderResetPasswordInvalid,
  renderResetPasswordSuccess,
  renderInvites,
} from "./html/user.js";

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

router.get("/user/:userId", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const user = await User.findById(userId)
      .populate("roots", "name _id visibility")
      .lean()
      .exec();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    maybeResetEnergy(user);

    const roots = user.roots || [];
    const profileType = user.profileType || "basic";
    const energy = user.availableEnergy;
    const extraEnergy = user.additionalEnergy;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        userId: user._id,
        username: user.username,
        roots,
        remoteRoots: user.remoteRoots || [],
        profileType,
        energy,
      });
    }

    const ENERGY_RESET_MS = 24 * 60 * 60 * 1000;
    const storageUsedKB = user.storageUsage || 0;

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
      renderUserProfile({
        userId,
        user,
        roots,
        profileType,
        energy,
        extraEnergy: user.additionalEnergy,
        queryString,
        resetTimeLabel,
        storageUsedKB,
      }),
    );
  } catch (err) {
    console.error("Error in /user/:userId:", err);
    res.status(500).json({ error: err.message });
  }
});

// Notes, tags routes moved to extensions/user-queries

// Contributions, chats, notifications routes moved to extensions/user-queries

router.get("/user/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.send(renderResetPasswordExpired());
    }

    return res.send(renderResetPasswordForm({ token }));
  } catch (err) {
    console.error("Error loading reset password page:", err);
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
      return res.send(renderResetPasswordMismatch({ token }));
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.send(renderResetPasswordInvalid());
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;

    await user.save();

    return res.send(renderResetPasswordSuccess());
  } catch (err) {
    console.error("Error resetting password:", err);
    res.status(500).send("Server error");
  }
});

router.post("/user/:userId/createRoot", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, type } = req.body;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    const rootNode = await createNewNode(
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
      null, // aiChatId
      null, // sessionId
      type || null,
    );

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${rootNode._id}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.status(201).json({
      success: true,
      rootId: rootNode._id,
      root: rootNode,
    });
  } catch (err) {
    console.error("createRoot error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Raw idea routes moved to extensions/raw-ideas

router.get("/user/:userId/invites", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // 🔐 user can only see their own invites
    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const invites = await getPendingInvitesForUser(userId);

    const wantHtml = "html" in req.query;
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ success: true, invites });
    }

    // ---------- HTML ----------
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(renderInvites({ userId, invites, token }));
  } catch (err) {
    console.error("invites page error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/user/:userId/invites/:inviteId",
  authenticate,

  async (req, res) => {
    try {
      const { userId, inviteId } = req.params;
      const { accept } = req.body;

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const acceptInvite = accept === true || accept === "true";

      await respondToInvite({
        inviteId,
        userId: req.userId,
        acceptInvite,
      });

      // 🌐 HTML redirect support
      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${userId}/invites?token=${req.query.token ?? ""}&html`,
        );
      }

      // 📦 JSON response
      return res.json({
        success: true,
        accepted: acceptInvite,
      });
    } catch (err) {
      console.error("respond invite error:", err);
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  },
);

// Deleted/revive routes moved to extensions/deleted-revive

// API key routes moved to extensions/api-keys
// Share token routes moved to extensions/visibility
// Energy routes moved to extensions/energy
// Purchase route moved to extensions/billing

// Chats and notifications routes moved to extensions/user-queries

router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ success: false, error: "File exceeds maximum size of 4 GB" });
  }
  next(err);
});

export default router;
