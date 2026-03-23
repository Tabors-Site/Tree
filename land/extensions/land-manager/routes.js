import express from "express";
import authenticate from "../../middleware/authenticate.js";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import log from "../../core/log.js";

const router = express.Router();

// GET /land/status - land overview (god only)
router.get("/land/status", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (user?.profileType !== "god") {
      return res.status(403).json({ error: "Requires god-tier." });
    }

    const { getLoadedManifests, getLoadedExtensionNames } = await import("../../extensions/loader.js");
    const { getLandIdentity, getLandUrl } = await import("../../canopy/identity.js");

    const land = getLandIdentity();
    const loaded = getLoadedExtensionNames();
    const manifests = getLoadedManifests();
    const userCount = await User.countDocuments({ isRemote: { $ne: true } });
    const treeCount = await Node.countDocuments({ rootOwner: { $ne: null }, parent: { $ne: "deleted" } });

    let peerCount = 0;
    try {
      const LandPeer = (await import("../../db/models/landPeer.js")).default;
      peerCount = await LandPeer.countDocuments();
    } catch {}

    res.json({
      land: { name: land.name, domain: land.domain, url: getLandUrl() },
      extensions: { count: loaded.length, list: manifests.map(m => ({ name: m.name, version: m.version })) },
      stats: { users: userCount, trees: treeCount, peers: peerCount },
    });
  } catch (err) {
    log.error("LandManager", "Status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /land/users - list users (god only)
router.get("/land/users", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (user?.profileType !== "god") {
      return res.status(403).json({ error: "Requires god-tier." });
    }

    const users = await User.find({ isRemote: { $ne: true } })
      .select("username profileType roots")
      .lean();

    res.json({
      users: users.map(u => ({
        username: u.username,
        profileType: u.profileType,
        trees: u.roots?.length || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /land/chat - land management chat (god only)
// Uses processMessage with land-manager mode
router.post("/land/chat", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType username").lean();
    if (user?.profileType !== "god") {
      return res.status(403).json({ error: "Requires god-tier." });
    }

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const visitorId = `land-manager-${req.userId}`;

    // Import conversation utilities
    const { processMessage, switchMode, getCurrentMode } = await import("../../ws/conversation.js");
    const { connectToMCP, closeMCPClient, MCP_SERVER_URL } = await import("../../ws/mcp.js");
    const jwt = (await import("jsonwebtoken")).default;

    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET not configured" });
    }
    const internalJwt = jwt.sign(
      { userId: req.userId.toString(), username: user.username, visitorId },
      JWT_SECRET,
      { expiresIn: "5m" }
    );

    // Connect MCP if needed
    try {
      await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);
    } catch {}

    // Switch to land-manager mode if not already
    const currentMode = getCurrentMode(visitorId);
    if (currentMode !== "home:land-manager") {
      try {
        switchMode(visitorId, "home:land-manager", { username: user.username, userId: req.userId });
      } catch {}
    }

    // Run the message through processMessage with land-manager tools
    const result = await processMessage(visitorId, message, {
      username: user.username,
      userId: req.userId,
    });

    const answer = result?.content || result?.choices?.[0]?.message?.content || JSON.stringify(result);

    // Cleanup
    try { closeMCPClient(visitorId); } catch {}

    res.json({ success: true, answer });
  } catch (err) {
    log.error("LandManager", "Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
