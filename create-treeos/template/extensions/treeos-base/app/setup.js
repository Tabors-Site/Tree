// routesURL/setup.js
// First-time onboarding: connect LLM, then go to chat.
// Sprout handles tree creation from conversation. No domain picker.

import log from "../../../seed/log.js";
import { sendError, ERR } from "../../../seed/protocol.js";
import express from "express";
import authenticateLite from "../../html-rendering/authenticateLite.js";
import User from "../../../seed/models/user.js";
import LlmConnection from "../../../seed/models/llmConnection.js";
import { renderSetup } from "./setupPage.js";
import { isHtmlEnabled } from "../../html-rendering/config.js";

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

    const connCount = await LlmConnection.countDocuments({ userId: req.userId });
    const hasMainLlm = !!(user.llmDefault);
    const needsLlm = !hasMainLlm && connCount === 0;

    // LLM connected, go to chat. Sprout handles everything from there.
    if (!needsLlm) {
      return res.redirect("/chat");
    }

    return res.send(renderSetup({ userId: req.userId, username: user.username }));
  } catch (err) {
    log.error("HTML", "Setup page error:", err.message);
    return res.status(500).send("Something went wrong");
  }
});

export default router;
