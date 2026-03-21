import express from "express";
import authenticate from "../../middleware/authenticate.js";
import User from "../../db/models/user.js";
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

export default router;
