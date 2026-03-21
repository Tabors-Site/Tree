import express from "express";
import authenticate from "../../middleware/authenticate.js";
import User from "../../db/models/user.js";
import Node from "../../db/models/node.js";
import { getLandRoot } from "../../core/landRoot.js";
import {
  getAllLandConfig,
  getLandConfigValue,
  setLandConfigValue,
} from "../../core/landConfig.js";

const router = express.Router();

/**
 * GET /api/v1/land/config
 * Returns all runtime config values from the .config node.
 */
router.get("/land/config", authenticate, async (req, res) => {
  try {
    const config = getAllLandConfig();
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/land/config/:key
 * Returns a single config value.
 */
router.get("/land/config/:key", authenticate, async (req, res) => {
  try {
    const value = getLandConfigValue(req.params.key);
    res.json({ key: req.params.key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/v1/land/config/:key
 * Set a config value. Requires admin (profileType === "god").
 */
router.put("/land/config/:key", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: "value is required" });
    }

    await setLandConfigValue(req.params.key, value);
    res.json({ key: req.params.key, value, updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/land/root
 * Returns the Land root node with children visible to the requesting user:
 *   - System nodes (.identity, .config, .peers)
 *   - Trees the user owns
 *   - Trees the user contributes to
 *   - Public trees on this land
 */
router.get("/land/root", authenticate, async (req, res) => {
  try {
    const landRoot = await getLandRoot();
    if (!landRoot) {
      return res.status(404).json({ error: "Land root not found" });
    }

    const userId = req.userId;

    // Fetch all Land root children with the fields we need to filter
    const children = await Node.find({ _id: { $in: landRoot.children } })
      .select("_id name isSystem systemRole rootOwner contributors visibility metadata")
      .lean();

    // Filter: system nodes + owned + contributing + public
    const visible = children.filter((c) => {
      if (c.isSystem) return true;
      if (c.rootOwner && String(c.rootOwner) === String(userId)) return true;
      if (c.contributors && c.contributors.map(String).includes(String(userId))) return true;
      if (c.visibility === "public") return true;
      return false;
    });

    res.json({
      _id: landRoot._id,
      name: landRoot.name,
      children: visible.map((c) => ({
        _id: c._id,
        name: c.name,
        isSystem: c.isSystem || false,
        systemRole: c.systemRole || null,
        rootOwner: c.rootOwner || null,
        isOwned: c.rootOwner && String(c.rootOwner) === String(userId),
        isPublic: c.visibility === "public" || false,
        metadata: c.metadata || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
