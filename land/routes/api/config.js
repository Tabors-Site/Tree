import express from "express";
import authenticate, { authenticateOrPublic } from "../../middleware/authenticate.js";
import User from "../../db/models/user.js";
import Node from "../../db/models/node.js";
import { getLandRoot } from "../../core/landRoot.js";
import {
  getAllLandConfig,
  getLandConfigValue,
  setLandConfigValue,
} from "../../core/landConfig.js";
import {
  getLoadedExtensionNames,
  getLoadedManifests,
  hasExtension,
  getExtensionManifest,
} from "../../extensions/loader.js";

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

// ─────────────────────────────────────────────────────────────────────────
// Extension management (god tier only)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/land/extensions
 * List all loaded extensions with manifest info.
 */
router.get("/land/extensions", authenticate, async (req, res) => {
  try {
    const manifests = getLoadedManifests();
    const disabled = getLandConfigValue("disabledExtensions") || [];

    res.json({
      loaded: manifests.map((m) => ({
        name: m.name,
        version: m.version,
        description: m.description,
        status: "active",
        needs: m.needs || {},
        optional: m.optional || {},
        provides: {
          routes: !!m.provides?.routes,
          tools: !!m.provides?.tools,
          jobs: !!m.provides?.jobs,
          models: Object.keys(m.provides?.models || {}),
          energyActions: Object.keys(m.provides?.energyActions || {}),
          sessionTypes: Object.keys(m.provides?.sessionTypes || {}),
        },
      })),
      disabled: disabled.map((name) => ({ name, status: "disabled" })),
      count: manifests.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/land/extensions/:name
 * Get details for a specific extension.
 */
router.get("/land/extensions/:name", authenticate, async (req, res) => {
  try {
    const { name } = req.params;
    const disabled = getLandConfigValue("disabledExtensions") || [];

    // Check loaded extensions first
    if (hasExtension(name)) {
      const manifest = getExtensionManifest(name);
      return res.json({ name, manifest, status: "active" });
    }

    // Check if it's disabled (exists on disk but not loaded)
    if (disabled.includes(name)) {
      // Try to read manifest from disk
      const { readExtensionFiles } = await import("../../extensions/loader.js");
      try {
        const { manifest } = await readExtensionFiles(name);
        if (manifest) {
          return res.json({ name, manifest, status: "disabled" });
        }
      } catch {}
      return res.json({ name, manifest: { name, version: "?" }, status: "disabled" });
    }

    return res.status(404).json({ error: `Extension "${name}" not found` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/land/extensions/:name/disable
 * Disable an extension. Adds to DISABLED_EXTENSIONS config.
 * Requires restart to take effect.
 */
router.post("/land/extensions/:name/disable", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { name } = req.params;
    const current = getLandConfigValue("disabledExtensions") || [];
    if (!current.includes(name)) {
      current.push(name);
      await setLandConfigValue("disabledExtensions", current);
    }

    // Also write to local file so loader can read at boot (before DB connects)
    const { syncDisabledFile } = await import("../../extensions/loader.js");
    syncDisabledFile(current);

    res.json({
      disabled: true,
      name,
      note: "Extension will be disabled on next restart.",
      disabledExtensions: current,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/land/extensions/:name/enable
 * Re-enable a disabled extension. Removes from disabled list.
 * Requires restart to take effect.
 */
router.post("/land/extensions/:name/enable", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { name } = req.params;
    const current = getLandConfigValue("disabledExtensions") || [];
    const updated = current.filter((n) => n !== name);
    await setLandConfigValue("disabledExtensions", updated);

    const { syncDisabledFile } = await import("../../extensions/loader.js");
    syncDisabledFile(updated);

    res.json({
      enabled: true,
      name,
      note: "Extension will be enabled on next restart.",
      disabledExtensions: updated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/land/extensions/:name/uninstall
 * Remove an extension directory. Data in DB is untouched.
 * Requires restart to take effect.
 */
router.post("/land/extensions/:name/uninstall", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { name } = req.params;

    // Safety: only allow alphanumeric and hyphens in extension names
    if (!/^[a-z0-9-]+$/i.test(name)) {
      return res.status(400).json({ error: "Invalid extension name" });
    }

    const { uninstallExtension } = await import("../../extensions/loader.js");
    const result = await uninstallExtension(name);

    if (!result.found) {
      return res.status(404).json({ error: `Extension "${name}" not found` });
    }

    res.json({
      uninstalled: true,
      name,
      note: "Extension directory removed. Data in database is untouched. Restart to apply.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/land/extensions/install
 * Install an extension from registry data. Writes files to extensions directory.
 * Body: { name, version, manifest, files: [{ path, content }] }
 */
router.post("/land/extensions/install", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { name, version, manifest, files } = req.body;

    if (!name || !files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "name and files are required" });
    }

    // Safety: only allow alphanumeric and hyphens
    if (!/^[a-z0-9-]+$/i.test(name)) {
      return res.status(400).json({ error: "Invalid extension name" });
    }

    const { installExtensionFiles } = await import("../../extensions/loader.js");
    const result = await installExtensionFiles(name, files);

    res.json({
      installed: true,
      name,
      version: version || manifest?.version || "unknown",
      filesWritten: result.filesWritten,
      note: "Restart the land to load the extension.",
    });
  } catch (err) {
    console.error("Extension install error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/land/extensions/:name/publish
 * Publish a local extension to the registry.
 * Reads the extension files and sends them to the directory service.
 */
router.post("/land/extensions/:name/publish", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { name } = req.params;
    if (!/^[a-z0-9-]+$/i.test(name)) {
      return res.status(400).json({ error: "Invalid extension name" });
    }

    const { readExtensionFiles } = await import("../../extensions/loader.js");
    const { manifest, files } = await readExtensionFiles(name);

    if (!manifest) {
      return res.status(404).json({ error: `Extension "${name}" not found locally` });
    }

    // Send to directory service
    const directoryUrl = getLandConfigValue("DIRECTORY_URL");
    if (!directoryUrl) {
      return res.status(400).json({ error: "No DIRECTORY_URL configured" });
    }

    const { getLandIdentity, signCanopyToken } = await import("../../canopy/identity.js");
    const identity = getLandIdentity();
    const token = await signCanopyToken("extension-publish", "directory");

    const dirRes = await fetch(`${directoryUrl}/extensions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `CanopyToken ${token}`,
      },
      body: JSON.stringify({
        manifest,
        files,
        tags: req.body.tags || [],
        readme: req.body.readme || "",
        repoUrl: req.body.repoUrl || null,
      }),
    });

    const dirData = await dirRes.json();
    if (!dirRes.ok) {
      return res.status(dirRes.status).json({ error: dirData.error || "Registry publish failed" });
    }

    res.json({
      published: true,
      name: manifest.name,
      version: manifest.version,
      registry: dirData,
    });
  } catch (err) {
    console.error("Extension publish error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Land root
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/land/root
 * Returns the Land root node with children visible to the requesting user:
 *   - System nodes (.identity, .config, .peers)
 *   - Trees the user owns
 *   - Trees the user contributes to
 *   - Public trees on this land
 */
router.get("/land/root", authenticateOrPublic, async (req, res) => {
  try {
    const landRootCached = await getLandRoot();
    if (!landRootCached) {
      return res.status(404).json({ error: "Land root not found" });
    }

    // Fetch fresh from DB so we see newly created trees (cache may be stale)
    const landRoot = await Node.findById(landRootCached._id).select("_id name children").lean();

    const userId = req.userId;
    const isAnon = !userId;

    // Fetch all Land root children with the fields we need to filter
    const children = await Node.find({ _id: { $in: landRoot.children } })
      .select("_id name isSystem systemRole rootOwner contributors visibility llmDefault metadata")
      .lean();

    // Filter: anonymous sees only public trees, authenticated sees system + owned + contributing + public
    const visible = children.filter((c) => {
      if (isAnon) return c.visibility === "public";
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
        isSystem: isAnon ? false : (c.isSystem || false),
        systemRole: isAnon ? null : (c.systemRole || null),
        rootOwner: c.rootOwner || null,
        isOwned: !isAnon && c.rootOwner && String(c.rootOwner) === String(userId),
        isPublic: c.visibility === "public" || false,
        queryAvailable: c.visibility === "public" && !!(c.llmDefault && c.llmDefault !== "none"),
        metadata: c.metadata || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
