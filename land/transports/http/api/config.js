import log from "../../../seed/core/log.js";
import express from "express";
import authenticate, { authenticateOptional } from "../middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../../seed/core/protocol.js";
import Being from "../../../seed/models/being.js";
import Node from "../../../seed/models/node.js";
import { getLandRoot } from "../../../seed/landRoot.js";
import { getLandConfigValue } from "../../../seed/landConfig.js";

const router = express.Router();

// Land config endpoints retired 2026-05-18. Reachable as substrate
// operations on the `<land>/.config` meta-position
// ([[project_meta_positions]]):
//
//   GET /ibp/see/<land>/.config              (full config snapshot)
//   GET /ibp/see/<land>/.config?key=<key>    (single value; future)
//   POST /ibp/do/<land>  { payload: { action: "set-config",    args: { key, value } } }
//   POST /ibp/do/<land>  { payload: { action: "delete-config", args: { key } } }
//
// The SEE side requires the meta-position resolver
// ([[project_meta_positions]]); land config will be one of its
// first concrete implementations. Writes are already callable via the
// DO ops registered in seed/coreOperations.js.

// Extension introspection + lifecycle endpoints retired 2026-05-19.
// Extensions are substrate ([[project_everything_is_substrate]]):
// installed-state lives at `<land>/.extensions/<name>` as a child Node
// of the .extensions system node. Manifest fields are mirrored into
// the child's metadata.extension namespace by syncExtensionsToTree in
// seed/landRoot.js. Reads + writes:
//
//   GET  /ibp/see/<land>/.extensions                  (list)
//   GET  /ibp/see/<land>/.extensions/<name>           (one)
//   POST /ibp/do/<land>  { action: "install-extension",   args: { name, files, ... } }
//   POST /ibp/do/<land>  { action: "uninstall-extension", args: { name } }
//   POST /ibp/do/<land>  { action: "enable-extension",    args: { name } }
//   POST /ibp/do/<land>  { action: "disable-extension",   args: { name } }
//
// Horizon proxy endpoints below (publish/comment/react) target a
// REMOTE land (the Horizon directory). They stay until federation
// transport lands; then they become cross-land ibp:do calls.

/**
 * POST /api/v1/land/extensions/:name/publish
 * Publish a local extension to the registry.
 * Reads the extension files and sends them to the Horizon service.
 */
router.post("/land/extensions/:name/publish", authenticate, async (req, res) => {
  try {
    // Admin gate retired 2026-05-18. Stance authorization
    // ([[project_stance_authorization]]) replaces this with per-stance
    // grant rules. Until that lands, this endpoint is unprotected.

    const { name } = req.params;
    if (!/^[a-z0-9-]+$/i.test(name)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid extension name");
    }

    const { readExtensionFiles } = await import("../../../extensions/loader.js");
    const { manifest, files } = await readExtensionFiles(name);

    if (!manifest) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, `Extension "${name}" not found locally`);
    }

    // Bundles on disk use needs.extensions; Horizon validates includes
    if (manifest.type === "bundle" && !manifest.includes && manifest.needs?.extensions) {
      manifest.includes = manifest.needs.extensions;
    }

    // Send to Horizon service
    const horizonUrl = getLandConfigValue("HORIZON_URL");
    if (!horizonUrl) {
      return sendError(res, 400, ERR.INVALID_INPUT, "No HORIZON_URL configured");
    }

    const { getLandIdentity, signCanopyToken } = await import("../../../protocols/canopy/identity.js");
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
        releaseNotes: req.body.releaseNotes || "",
      }),
    });

    const dirData = await dirRes.json();
    if (!dirRes.ok) {
      const detail = dirData.details ? dirData.details.join("; ") : undefined;
      return sendError(res, dirRes.status, ERR.INTERNAL, dirData.error || "Registry publish failed", detail);
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

/**
 * POST /api/v1/land/extensions/:name/comment
 * Proxy a comment to Horizon. Signs a CanopyToken so the user's land
 * identity is verified. The land is the proxy. The browser never talks
 * to Horizon directly for writes.
 */
router.post("/land/extensions/:name/comment", authenticate, async (req, res) => {
  try {
    const { name } = req.params;
    const { text, version } = req.body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Comment text is required");
    }
    if (text.length > 2000) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Comment must be 2000 characters or fewer");
    }

    const horizonUrl = getLandConfigValue("HORIZON_URL");
    if (!horizonUrl) {
      return sendError(res, 400, ERR.INVALID_INPUT, "No HORIZON_URL configured");
    }

    const { signCanopyToken } = await import("../../../protocols/canopy/identity.js");
    const token = await signCanopyToken("extension-comment", "horizon");

    const user = await Being.findById(req.beingId).select("name").lean();

    const dirRes = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `CanopyToken ${token}`,
      },
      body: JSON.stringify({
        text: text.trim(),
        version: version || null,
        name: user?.name || "",
      }),
    });

    const dirData = await dirRes.json();
    if (!dirRes.ok) {
      return sendError(res, dirRes.status, ERR.INTERNAL, dirData.error || "Comment failed");
    }

    sendOk(res, { commented: true, name });
  } catch (err) {
    log.error("API", "Extension comment error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /api/v1/land/extensions/:name/react
 * Proxy a star/flag reaction to Horizon.
 */
router.post("/land/extensions/:name/react", authenticate, async (req, res) => {
  try {
    const { name } = req.params;
    const { type } = req.body;

    if (!["star", "flag"].includes(type)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "type must be 'star' or 'flag'");
    }

    const horizonUrl = getLandConfigValue("HORIZON_URL");
    if (!horizonUrl) {
      return sendError(res, 400, ERR.INVALID_INPUT, "No HORIZON_URL configured");
    }

    const { signCanopyToken } = await import("../../../protocols/canopy/identity.js");
    const token = await signCanopyToken("extension-react", "horizon");

    const user = await Being.findById(req.beingId).select("name").lean();

    const dirRes = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}/react`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `CanopyToken ${token}`,
      },
      body: JSON.stringify({ type, username: user?.name || "" }),
    });

    const dirData = await dirRes.json();
    if (!dirRes.ok) {
      return sendError(res, dirRes.status, ERR.INTERNAL, dirData.error || "Reaction failed");
    }

    sendOk(res, dirData);
  } catch (err) {
    log.error("API", "Extension react error:", err);
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

    const beingId = req.beingId;
    const isAnon = !beingId;

    // Fetch all Land root children with the fields we need to filter
    const children = await Node.find({ _id: { $in: landRoot.children } })
      .select("_id name systemRole systemRole rootOwner contributors visibility llmDefault metadata")
      .lean();

    // Filter: anonymous sees only public trees, authenticated sees system + owned + contributing + public
    const visible = children.filter((c) => {
      if (isAnon) return c.visibility === "public";
      if (c.systemRole) return true;
      if (c.rootOwner && String(c.rootOwner) === String(beingId)) return true;
      if (c.contributors && c.contributors.map(String).includes(String(beingId))) return true;
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
        isOwned: !isAnon && c.rootOwner && String(c.rootOwner) === String(beingId),
        isPublic: c.visibility === "public" || false,
        queryAvailable: c.visibility === "public" && !!(c.llmDefault && c.llmDefault !== "none"),
        metadata: c.metadata || null,
      })),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// /land/orchestrators retired 2026-05-19: the orchestrator concept
// retired with the state-based-LLM era ([[project_tree_orchestrator_deleted]]);
// the substrate IS the orchestrator distributedly.
//
// /land/tools and /land/roles retired 2026-05-19: these registries
// now mirror into substrate at <land>/.tools and <land>/.roles
// ([[project_meta_positions]]). Reachable via:
//
//   GET /ibp/see/<land>/.tools
//   GET /ibp/see/<land>/.roles
//   GET /ibp/see/<land>/.operations
//
// The standard descriptor builder returns the children + metadata —
// no special handler.

export default router;
