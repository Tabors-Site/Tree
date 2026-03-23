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

export default router;
