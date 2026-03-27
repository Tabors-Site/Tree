// routesURL/setup.js
// First-time onboarding: connect LLM + create first tree.
// Skips steps already completed, redirects to /chat when done.

import log from "../../../seed/log.js";
import { sendError, ERR } from "../../../seed/protocol.js";
import express from "express";
import authenticateLite from "../authenticateLite.js";
import User from "../../../seed/models/user.js";
import LlmConnection from "../../../seed/models/llmConnection.js";
import { renderSetup } from "./setupPage.js";
import { isHtmlEnabled } from "../config.js";

const router = express.Router();

router.get("/setup", authenticateLite, async (req, res) => {
  try {
    if (!isHtmlEnabled()) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Server-rendered HTML is disabled. Use the SPA frontend.");
    }

    if (!req.userId) {
      return res.redirect("/login?redirect=/setup");
    }

    const user = await User.findById(req.userId)
      .select("username metadata llmDefault")
      .lean();
    if (!user) {
      return res.redirect("/login?redirect=/setup");
    }

    const { getUserMeta } = await import("../../../seed/tree/userMetadata.js");
    const nav = getUserMeta(user, "nav");
    const userRoots = Array.isArray(nav.roots) ? nav.roots : [];

    const connCount = await LlmConnection.countDocuments({ userId: req.userId });
    const hasMainLlm = !!(user.llmDefault);
    const needsLlm = !hasMainLlm && connCount === 0;
    const needsTree = userRoots.length === 0;

    // Both done, go to chat
    if (!needsLlm && !needsTree) {
      return res.redirect("/chat");
    }

    const userId = req.userId;
    const username = user.username;

    return res.send(renderSetup({ userId, username, needsLlm, needsTree }));
  } catch (err) {
    log.error("HTML", "Setup page error:", err.message);
    return res.status(500).send("Something went wrong");
  }
});

export default router;
