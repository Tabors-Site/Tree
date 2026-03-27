import log from "../../seed/log.js";
import express from "express";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR, NODE_STATUS } from "../../seed/protocol.js";
import User from "../../seed/models/user.js";
import Node from "../../seed/models/node.js";
import { getLandRoot } from "../../seed/landRoot.js";
import {
  getAllLandConfig,
  getLandConfigValue,
  setLandConfigValue,
} from "../../seed/landConfig.js";
import {
  getLoadedExtensionNames,
  getLoadedManifests,
  hasExtension,
  getExtensionManifest,
  getExtension,
} from "../../extensions/loader.js";
import { listOrchestrators } from "../../seed/orchestratorRegistry.js";

const router = express.Router();

/**
 * GET /api/v1/land/config
 * Returns all runtime config values from the .config node.
 */
router.get("/land/config", authenticate, async (req, res) => {
  try {
    const config = getAllLandConfig();
    sendOk(res, { config });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /api/v1/land/config/:key
 * Returns a single config value.
 */
router.get("/land/config/:key", authenticate, async (req, res) => {
  try {
    const value = getLandConfigValue(req.params.key);
    sendOk(res, { key: req.params.key, value });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * PUT /api/v1/land/config/:key
 * Set a config value. Requires admin (isAdmin === true).
 */
router.put("/land/config/:key", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
    }

    const { value } = req.body;
    if (value === undefined) {
      return sendError(res, 400, ERR.INVALID_INPUT, "value is required");
    }

    await setLandConfigValue(req.params.key, value);
    sendOk(res, { key: req.params.key, value, updated: true });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
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

    sendOk(res, {
      loaded: manifests.map((m) => ({
        name: m.name,
        version: m.version,
        description: m.description,
        status: NODE_STATUS.ACTIVE,
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
    sendError(res, 500, ERR.INTERNAL, err.message);
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
      return sendOk(res, { name, manifest, status: NODE_STATUS.ACTIVE });
    }

    // Check if it's disabled (exists on disk but not loaded)
    if (disabled.includes(name)) {
      // Try to read manifest from disk
      const { readExtensionFiles } = await import("../../extensions/loader.js");
      try {
        const { manifest } = await readExtensionFiles(name);
        if (manifest) {
          return sendOk(res, { name, manifest, status: "disabled" });
        }
      } catch {}
      return sendOk(res, { name, manifest: { name, version: "?" }, status: "disabled" });
    }

    return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, `Extension "${name}" not found`);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /api/v1/land/extensions/:name/disable
 * Disable an extension. Adds to DISABLED_EXTENSIONS config.
 * Requires restart to take effect.
 */
router.post("/land/extensions/:name/disable", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
    }

    const { name } = req.params;
    const current = getLandConfigValue("disabledExtensions") || [];
    if (!current.includes(name)) {
      current.push(name);

      // Write file FIRST, then DB. If process crashes between, the file
      // (read at boot before DB) is the more critical source of truth.
      // A stale DB entry is fixed on next successful disable/enable.
      const { syncDisabledFile } = await import("../../extensions/loader.js");
      syncDisabledFile(current);
      await setLandConfigValue("disabledExtensions", current);
    }

    sendOk(res, {
      disabled: true,
      name,
      note: "Extension will be disabled on next restart.",
      disabledExtensions: current,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /api/v1/land/extensions/:name/enable
 * Re-enable a disabled extension. Removes from disabled list.
 * Requires restart to take effect.
 */
router.post("/land/extensions/:name/enable", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
    }

    const { name } = req.params;
    const current = getLandConfigValue("disabledExtensions") || [];
    const updated = current.filter((n) => n !== name);
    await setLandConfigValue("disabledExtensions", updated);

    const { syncDisabledFile } = await import("../../extensions/loader.js");
    syncDisabledFile(updated);

    sendOk(res, {
      enabled: true,
      name,
      note: "Extension will be enabled on next restart.",
      disabledExtensions: updated,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /api/v1/land/extensions/:name/uninstall
 * Remove an extension directory. Data in DB is untouched.
 * Requires restart to take effect.
 */
router.post("/land/extensions/:name/uninstall", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
    }

    const { name } = req.params;

    // Safety: only allow alphanumeric and hyphens in extension names
    if (!/^[a-z0-9-]+$/i.test(name)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid extension name");
    }

    // Check if other extensions depend on this one
    const { uninstallExtension, getLoadedManifests } = await import("../../extensions/loader.js");
    const dependents = getLoadedManifests()
      .filter(m => m.needs?.extensions?.includes(name))
      .map(m => m.name);
    if (dependents.length > 0 && !req.body?.force) {
      return sendError(res, 409, ERR.RESOURCE_CONFLICT,
        `Cannot uninstall "${name}": ${dependents.join(", ")} depend on it. Pass { "force": true } to override.`,
        { dependents });
    }

    const result = await uninstallExtension(name);

    if (!result.found) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, `Extension "${name}" not found`);
    }

    sendOk(res, {
      uninstalled: true,
      name,
      note: "Extension directory removed. Data in database is untouched. Restart to apply.",
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /api/v1/land/extensions/install
 * Install an extension from registry data. Writes files to extensions directory.
 * Body: { name, version, manifest, files: [{ path, content }] }
 */
router.post("/land/extensions/install", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
    }

    const { name, version, manifest, files } = req.body;

    if (!name || !files || !Array.isArray(files) || files.length === 0) {
      return sendError(res, 400, ERR.INVALID_INPUT, "name and files are required");
    }

    // Safety: only allow alphanumeric and hyphens
    if (!/^[a-z0-9-]+$/i.test(name)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid extension name");
    }

    const { installExtensionFiles } = await import("../../extensions/loader.js");
    const result = await installExtensionFiles(name, files);

    sendOk(res, {
      installed: true,
      name,
      version: version || manifest?.version || "unknown",
      filesWritten: result.filesWritten,
      note: "Restart the land to load the extension.",
    });
  } catch (err) {
    log.error("API", "Extension install error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /api/v1/land/extensions/:name/publish
 * Publish a local extension to the registry.
 * Reads the extension files and sends them to the Horizon service.
 */
router.post("/land/extensions/:name/publish", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Admin access required");
    }

    const { name } = req.params;
    if (!/^[a-z0-9-]+$/i.test(name)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid extension name");
    }

    const { readExtensionFiles } = await import("../../extensions/loader.js");
    const { manifest, files } = await readExtensionFiles(name);

    if (!manifest) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, `Extension "${name}" not found locally`);
    }

    // Send to Horizon service
    const horizonUrl = getLandConfigValue("HORIZON_URL");
    if (!horizonUrl) {
      return sendError(res, 400, ERR.INVALID_INPUT, "No HORIZON_URL configured");
    }

    const { getLandIdentity, signCanopyToken } = await import("../../canopy/identity.js");
    const identity = getLandIdentity();
    const token = await signCanopyToken("extension-publish", "horizon");

    const dirRes = await fetch(`${horizonUrl}/extensions`, {
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
        maintainers: req.body.maintainers || [],
      }),
    });

    const dirData = await dirRes.json();
    if (!dirRes.ok) {
      return sendError(res, dirRes.status, ERR.INTERNAL, dirData.error || "Registry publish failed");
    }

    sendOk(res, {
      published: true,
      name: manifest.name,
      version: manifest.version,
      registry: dirData,
    });
  } catch (err) {
    log.error("API", "Extension publish error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
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
router.get("/land/root", authenticateOptional, async (req, res) => {
  try {
    const landRootCached = await getLandRoot();
    if (!landRootCached) {
      return sendError(res, 404, ERR.NODE_NOT_FOUND, "Land root not found");
    }

    // Fetch fresh from DB so we see newly created trees (cache may be stale)
    const landRoot = await Node.findById(landRootCached._id).select("_id name children").lean();

    const userId = req.userId;
    const isAnon = !userId;

    // Fetch all Land root children with the fields we need to filter
    const children = await Node.find({ _id: { $in: landRoot.children } })
      .select("_id name systemRole systemRole rootOwner contributors visibility llmDefault metadata")
      .lean();

    // Filter: anonymous sees only public trees, authenticated sees system + owned + contributing + public
    const visible = children.filter((c) => {
      if (isAnon) return c.visibility === "public";
      if (c.systemRole) return true;
      if (c.rootOwner && String(c.rootOwner) === String(userId)) return true;
      if (c.contributors && c.contributors.map(String).includes(String(userId))) return true;
      if (c.visibility === "public") return true;
      return false;
    });

    sendOk(res, {
      _id: landRoot._id,
      name: landRoot.name,
      children: visible.map((c) => ({
        _id: c._id,
        name: c.name,
        systemRole: isAnon ? null : (c.systemRole || null),
        rootOwner: c.rootOwner || null,
        isOwned: !isAnon && c.rootOwner && String(c.rootOwner) === String(userId),
        isPublic: c.visibility === "public" || false,
        queryAvailable: c.visibility === "public" && !!(c.llmDefault && c.llmDefault !== "none"),
        metadata: c.metadata || null,
      })),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /api/v1/land/orchestrators
 * Shows which extension owns each conversation zone.
 */
router.get("/land/orchestrators", (req, res) => {
  const active = listOrchestrators();
  sendOk(res, {
    tree: active.tree || null,
    home: active.home || null,
    land: active.land || null,
  });
});

/**
 * GET /api/v1/land/tools
 * Lists all MCP tools available in tree mode, with source info.
 */
router.get("/land/tools", async (req, res) => {
  try {
    const { getAllToolNamesForBigMode, getSubModes } = await import("../../seed/ws/modes/registry.js");
    const allTools = getAllToolNamesForBigMode("tree");

    // Build tool-to-mode mapping
    const modes = getSubModes("tree");
    const toolSources = {};
    for (const t of allTools) toolSources[t] = [];
    for (const m of modes) {
      if (!m.toolNames) continue;
      for (const t of m.toolNames) {
        if (toolSources[t]) toolSources[t].push(m.key);
      }
    }

    sendOk(res, {
      count: allTools.length,
      tools: allTools.sort().map(name => ({
        name,
        modes: toolSources[name] || [],
      })),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /api/v1/land/modes
 * Lists all registered AI modes with their tools and metadata.
 */
router.get("/land/modes", async (req, res) => {
  try {
    const { getSubModes } = await import("../../seed/ws/modes/registry.js");
    const bigModes = ["tree", "home", "land"];
    const result = {};

    for (const bm of bigModes) {
      const modes = getSubModes(bm);
      result[bm] = modes.map(m => ({
        key: m.key,
        label: m.label || m.key,
        emoji: m.emoji || null,
        tools: m.toolNames || [],
        assignmentSlot: m.assignmentSlot || null,
      }));
    }

    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
