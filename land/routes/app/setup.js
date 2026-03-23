// routesURL/setup.js
// First-time onboarding: connect LLM + create first tree.
// Skips steps already completed, redirects to /chat when done.

import express from "express";
import authenticateLite from "../../middleware/authenticateLite.js";
import User from "../../db/models/user.js";
import CustomLlmConnection from "../../db/models/customLlmConnection.js";
import { renderSetup } from "./html/setup.js";

const router = express.Router();

router.get("/setup", authenticateLite, async (req, res) => {
  try {
    if (process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
    }

    if (!req.userId) {
      return res.redirect("/login?redirect=/setup");
    }

    const user = await User.findById(req.userId)
      .select("username roots metadata")
      .lean();
    if (!user) {
      return res.redirect("/login?redirect=/setup");
    }

    const connCount = await CustomLlmConnection.countDocuments({ userId: req.userId });
    const hasMainLlm = !!(user.llmAssignments?.main);
    const needsLlm = !hasMainLlm && connCount === 0;
    const needsTree = !user.roots || user.roots.length === 0;

    // Both done, go to chat
    if (!needsLlm && !needsTree) {
      return res.redirect("/chat");
    }

    const userId = req.userId;
    const username = user.username;

    return res.send(renderSetup({ userId, username, needsLlm, needsTree }));
  } catch (err) {
    console.error("Setup page error:", err);
    return res.status(500).send("Something went wrong");
  }
});

export default router;
