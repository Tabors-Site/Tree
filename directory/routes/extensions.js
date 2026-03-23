import { Router } from "express";
import Extension from "../db/models/extension.js";
import Land from "../db/models/land.js";
import { verifyDirectoryAuth } from "../auth.js";

/**
 * Middleware to extract land identity from verified canopy auth payload
 * and attach req.landId, req.landDomain, req.landName for route handlers.
 */
function attachLandIdentity() {
  return async (req, res, next) => {
    const payload = req.canopyAuth?.payload;
    if (!payload) {
      return res.status(401).json({ error: "No auth payload" });
    }
    req.landId = payload.landId;
    req.landDomain = payload.iss || "";

    // Look up the land name from the registry
    if (req.landDomain) {
      const land = await Land.findOne({ domain: req.landDomain }).select("name").lean();
      req.landName = land?.name || "";
    } else {
      req.landName = "";
    }
    next();
  };
}

const router = Router();

/**
 * GET /extensions
 * List available extensions. Supports search via ?q=
 */
router.get("/", async (req, res) => {
  try {
    const { q, tag, author, limit = 50, offset = 0 } = req.query;

    let query = {};

    if (q) {
      query.$text = { $search: q };
    }

    if (tag) {
      query.tags = tag;
    }

    if (author) {
      query.authorDomain = author;
    }

    // Get latest version of each extension
    const pipeline = [
      { $match: query },
      { $sort: { name: 1, publishedAt: -1 } },
      {
        $group: {
          _id: "$name",
          latest: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$latest" } },
      { $sort: { downloads: -1, name: 1 } },
      { $skip: Number(offset) },
      { $limit: Math.min(Number(limit), 100) },
      {
        $project: {
          name: 1,
          version: 1,
          description: 1,
          authorDomain: 1,
          authorName: 1,
          tags: 1,
          downloads: 1,
          publishedAt: 1,
          "manifest.needs": 1,
          "manifest.optional": 1,
          "manifest.provides": 1,
        },
      },
    ];

    const extensions = await Extension.aggregate(pipeline);
    const total = await Extension.distinct("name", query).then((r) => r.length);

    res.json({ extensions, total });
  } catch (err) {
    console.error("Extension list error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/routes/check?path=/root/:rootId/calendar
 * Check if a route path is claimed by any published extension.
 * Returns the extension name if claimed, null if available.
 */
router.get("/routes/check", async (req, res) => {
  try {
    const { path: routePath } = req.query;
    if (!routePath) {
      return res.status(400).json({ error: "path query parameter required" });
    }

    // Search all extensions for this route in their manifest cli declarations or provides.routes
    const extensions = await Extension.find({}).lean();

    const claims = [];
    for (const ext of extensions) {
      const cliRoutes = ext.manifest?.provides?.cli || [];
      for (const cmd of cliRoutes) {
        if (cmd.endpoint === routePath) {
          claims.push({ extension: ext.name, version: ext.version, command: cmd.command });
        }
        // Check subcommand endpoints too
        if (cmd.subcommands) {
          for (const [action, sub] of Object.entries(cmd.subcommands)) {
            if (sub.endpoint === routePath) {
              claims.push({ extension: ext.name, version: ext.version, command: `${cmd.command.split(" ")[0]} ${action}` });
            }
          }
        }
      }
    }

    res.json({
      path: routePath,
      available: claims.length === 0,
      claims,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/:name
 * Get all versions of an extension.
 */
router.get("/:name", async (req, res) => {
  try {
    const { name } = req.params;

    const versions = await Extension.find({ name })
      .sort({ publishedAt: -1 })
      .select("name version description authorDomain authorName tags downloads publishedAt manifest readme")
      .lean();

    if (!versions.length) {
      return res.status(404).json({ error: "Extension not found" });
    }

    res.json({
      name,
      latest: versions[0],
      versions: versions.map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt,
        downloads: v.downloads,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/:name/:version
 * Get a specific version with full file contents for installation.
 */
router.get("/:name/:version", async (req, res) => {
  try {
    const { name, version } = req.params;

    const ext = await Extension.findOne({ name, version }).lean();
    if (!ext) {
      return res.status(404).json({ error: "Extension version not found" });
    }

    // Increment download count
    await Extension.updateOne({ _id: ext._id }, { $inc: { downloads: 1 } });

    res.json({
      name: ext.name,
      version: ext.version,
      description: ext.description,
      manifest: ext.manifest,
      files: ext.files,
      repoUrl: ext.repoUrl,
      tarballUrl: ext.tarballUrl,
      readme: ext.readme,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /extensions
 * Publish an extension. Requires land authentication.
 * Body: { manifest, files, readme, tags, repoUrl }
 */
router.post("/", verifyDirectoryAuth(), attachLandIdentity(), async (req, res) => {
  try {
    const { manifest, files, readme, tags, repoUrl } = req.body;

    if (!manifest || !manifest.name || !manifest.version) {
      return res.status(400).json({ error: "manifest with name and version is required" });
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files array is required (at least manifest.js and index.js)" });
    }

    // Validate required files
    const filePaths = new Set(files.map((f) => f.path));
    if (!filePaths.has("manifest.js")) {
      return res.status(400).json({ error: "manifest.js is required in files" });
    }
    if (!filePaths.has("index.js")) {
      return res.status(400).json({ error: "index.js is required in files" });
    }

    // Size limit: 500KB total
    const totalSize = files.reduce((sum, f) => sum + (f.content?.length || 0), 0);
    if (totalSize > 500000) {
      return res.status(400).json({ error: "Total file size exceeds 500KB limit" });
    }

    // Check if this version already exists
    const existing = await Extension.findOne({
      name: manifest.name,
      version: manifest.version,
    });

    if (existing) {
      // Update existing version (only author can update)
      if (existing.authorLandId !== req.landId) {
        return res.status(403).json({ error: "Only the original author can update this extension" });
      }

      existing.manifest = manifest;
      existing.files = files;
      existing.description = manifest.description || existing.description;
      existing.readme = readme || existing.readme;
      existing.tags = tags || existing.tags;
      existing.repoUrl = repoUrl || existing.repoUrl;
      existing.updatedAt = new Date();
      await existing.save();

      return res.json({ published: true, updated: true, name: manifest.name, version: manifest.version });
    }

    // Create new
    const ext = new Extension({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || "",
      authorLandId: req.landId,
      authorDomain: req.landDomain || "",
      authorName: req.landName || "",
      manifest,
      files,
      readme: readme || "",
      tags: tags || [],
      repoUrl: repoUrl || null,
    });

    await ext.save();

    res.status(201).json({
      published: true,
      name: manifest.name,
      version: manifest.version,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "This version already exists" });
    }
    console.error("Extension publish error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /extensions/:name/:version
 * Unpublish a version. Requires land authentication (author only).
 */
router.delete("/:name/:version", verifyDirectoryAuth(), attachLandIdentity(), async (req, res) => {
  try {
    const { name, version } = req.params;

    const ext = await Extension.findOne({ name, version });
    if (!ext) {
      return res.status(404).json({ error: "Extension version not found" });
    }

    if (ext.authorLandId !== req.landId) {
      return res.status(403).json({ error: "Only the author can unpublish" });
    }

    await ext.deleteOne();
    res.json({ unpublished: true, name, version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
