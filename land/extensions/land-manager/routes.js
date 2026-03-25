import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";

const router = express.Router();

// GET /land/status - land overview (god only)
router.get("/land/status", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Requires god-tier.");
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
      const LandPeer = (await import("../../canopy/models/landPeer.js")).default;
      peerCount = await LandPeer.countDocuments();
    } catch {}

    sendOk(res, {
      land: { name: land.name, domain: land.domain, url: getLandUrl() },
      extensions: { count: loaded.length, list: manifests.map(m => ({ name: m.name, version: m.version })) },
      stats: { users: userCount, trees: treeCount, peers: peerCount },
    });
  } catch (err) {
    log.error("LandManager", "Status error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /land/users - list users (god only)
router.get("/land/users", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Requires god-tier.");
    }

    const users = await User.find({ isRemote: { $ne: true } })
      .select("username isAdmin roots")
      .lean();

    sendOk(res, {
      users: users.map(u => ({
        username: u.username,
        isAdmin: u.isAdmin || false,
        trees: u.roots?.length || 0,
      })),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /land/chat - land management chat (god only)
// POST /land/chat - land management chat (god only)
router.post("/land/chat", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin username").lean();
    if (!user?.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Requires god-tier.");
    }

    const { message } = req.body;
    if (!message) return sendError(res, 400, ERR.INVALID_INPUT, "message required");

    const { runChat } = await import("../../seed/ws/conversation.js");

    const { answer, chatId } = await runChat({
      userId: req.userId,
      username: user.username,
      message,
      mode: "land:manager",
      res,
    });

    sendOk(res, { answer, chatId });
  } catch (err) {
    log.error("LandManager", "Chat error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
