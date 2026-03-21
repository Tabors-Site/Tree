import { Router } from "express";
import Land from "../db/models/land.js";
import PublicTree from "../db/models/publicTree.js";
import { verifyDirectoryAuth } from "../auth.js";

const router = Router();

/**
 * POST /directory/register
 * Register or update a land and its public trees.
 */
router.post(
  "/register",
  verifyDirectoryAuth({ allowNewRegistration: true }),
  async (req, res) => {
    try {
      const {
        landId,
        domain,
        name,
        baseUrl,
        publicKey,
        protocolVersion,
        publicTrees,
        siteUrl,
      } = req.body;

      if (!landId || !domain || !baseUrl || !publicKey) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: landId, domain, baseUrl, publicKey",
        });
      }

      // SECURITY: The claimed domain must match the token issuer.
      // Prevents a rogue land from registering someone else's domain.
      if (domain !== req.canopyAuth.payload.iss) {
        return res.status(403).json({
          success: false,
          error: "Domain does not match token issuer. You can only register your own domain.",
        });
      }

      // SECURITY: Validate aud claim if present
      if (req.canopyAuth.payload.aud && req.canopyAuth.payload.aud !== "directory") {
        return res.status(401).json({
          success: false,
          error: "Token audience must be 'directory'",
        });
      }

      // SECURITY: Block private IPs in baseUrl (both new and existing registrations)
      try {
        const parsed = new URL(baseUrl);
        if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost)/i.test(parsed.hostname)) {
          return res.status(400).json({
            success: false,
            error: "baseUrl cannot use private or localhost addresses",
          });
        }
      } catch {
        return res.status(400).json({ success: false, error: "Invalid baseUrl" });
      }

      // SECURITY: Validate siteUrl if provided (prevent javascript: and other dangerous protocols)
      if (siteUrl) {
        try {
          const parsedSite = new URL(siteUrl);
          if (!["http:", "https:"].includes(parsedSite.protocol)) {
            return res.status(400).json({
              success: false,
              error: "siteUrl must use http or https protocol",
            });
          }
        } catch {
          return res.status(400).json({ success: false, error: "Invalid siteUrl" });
        }
      }

      // SECURITY: Check directory capacity for new registrations
      const existingLand = await Land.findOne({ domain });
      if (!existingLand) {
        const totalLands = await Land.countDocuments();
        if (totalLands >= 50000) {
          return res.status(503).json({
            success: false,
            error: "Directory capacity reached",
          });
        }
      }

      // Upsert the land record
      const land = await Land.findOneAndUpdate(
        { domain },
        {
          $set: {
            _id: landId,
            domain,
            name: name || "",
            baseUrl,
            publicKey,
            protocolVersion: protocolVersion || 1,
            siteUrl: siteUrl || null,
            status: "active",
            lastSeenAt: new Date(),
            failedChecks: 0,
          },
          $setOnInsert: { registeredAt: new Date() },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Replace all public trees for this land (capped at 500)
      if (Array.isArray(publicTrees)) {
        await PublicTree.deleteMany({ landId: land._id });

        const cappedTrees = publicTrees.slice(0, 500);
        if (cappedTrees.length > 0) {
          const treeDocs = cappedTrees.map((t) => ({
            rootId: t.rootId,
            landId: land._id,
            landDomain: domain,
            name: t.name || "",
            description: t.description || "",
            ownerUsername: t.ownerUsername || "",
            tags: t.tags || [],
            nodeCount: t.nodeCount || 0,
            lastUpdated: new Date(),
            indexedAt: new Date(),
          }));

          await PublicTree.insertMany(treeDocs, { ordered: false });
        }
      }

      return res.json({
        success: true,
        message: "Land registered successfully",
        landId: land._id,
      });
    } catch (err) {
      console.error("[Directory] Register error:", err.message);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

/**
 * GET /directory/lands
 * List registered lands with optional search and filtering.
 */
router.get("/lands", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status;
    } else {
      // Exclude dead lands by default
      filter.status = { $ne: "dead" };
    }

    if (req.query.q) {
      const q = req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { domain: { $regex: q, $options: "i" } },
      ];
    }

    const [lands, total] = await Promise.all([
      Land.find(filter)
        .select("_id domain name protocolVersion status lastSeenAt metadata siteUrl")
        .sort({ lastSeenAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Land.countDocuments(filter),
    ]);

    const mapped = lands.map((l) => ({
      landId: l._id,
      domain: l.domain,
      name: l.name,
      protocolVersion: l.protocolVersion,
      status: l.status,
      lastSeenAt: l.lastSeenAt,
      siteUrl: l.siteUrl,
      metadata: l.metadata,
    }));

    return res.json({ success: true, lands: mapped, total, page });
  } catch (err) {
    console.error("[Directory] List lands error:", err.message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /directory/land/:domain
 * Get full details for a single land.
 */
router.get("/land/:domain", async (req, res) => {
  try {
    const land = await Land.findOne({ domain: req.params.domain })
      .select("_id domain name baseUrl publicKey protocolVersion siteUrl")
      .lean();

    if (!land) {
      return res.status(404).json({ success: false, error: "Land not found" });
    }

    return res.json({
      success: true,
      land: {
        landId: land._id,
        domain: land.domain,
        name: land.name,
        baseUrl: land.baseUrl,
        publicKey: land.publicKey,
        protocolVersion: land.protocolVersion,
        siteUrl: land.siteUrl,
      },
    });
  } catch (err) {
    console.error("[Directory] Get land error:", err.message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /directory/search/trees
 * Search public trees across all lands.
 */
router.get("/search/trees", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.q) {
      const q = req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { tags: { $regex: q, $options: "i" } },
      ];
    }

    if (req.query.land) {
      filter.landDomain = req.query.land;
    }

    const [trees, total] = await Promise.all([
      PublicTree.find(filter)
        .select("rootId name description ownerUsername landDomain tags nodeCount")
        .sort({ lastUpdated: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PublicTree.countDocuments(filter),
    ]);

    return res.json({ success: true, trees, total, page });
  } catch (err) {
    console.error("[Directory] Search trees error:", err.message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * DELETE /directory/land/:domain
 * Remove a land and all its public trees. Requires valid CanopyToken from the land.
 */
router.delete(
  "/land/:domain",
  verifyDirectoryAuth(),
  async (req, res) => {
    try {
      const domain = req.params.domain;

      // Verify the token issuer matches the domain being deleted
      if (req.canopyAuth.payload.iss !== domain) {
        return res.status(403).json({
          success: false,
          error: "You can only remove your own land registration",
        });
      }

      const land = await Land.findOne({ domain });
      if (!land) {
        return res.status(404).json({ success: false, error: "Land not found" });
      }

      await PublicTree.deleteMany({ landId: land._id });
      await Land.deleteOne({ _id: land._id });

      return res.json({
        success: true,
        message: `Land ${domain} and its public trees have been removed`,
      });
    } catch (err) {
      console.error("[Directory] Delete land error:", err.message);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
);

/**
 * GET /directory/health
 * Health check endpoint.
 */
router.get("/health", async (req, res) => {
  try {
    const [landCount, treeCount] = await Promise.all([
      Land.countDocuments({ status: { $ne: "dead" } }),
      PublicTree.countDocuments(),
    ]);

    return res.json({
      status: "ok",
      landCount,
      treeCount,
      uptime: process.uptime(),
    });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});

export default router;
