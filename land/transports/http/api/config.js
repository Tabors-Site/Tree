import express from "express";
import { authenticateOptional } from "../middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../../seed/core/protocol.js";
import Node from "../../../seed/models/node.js";
import { getLandRoot } from "../../../seed/landRoot.js";

const router = express.Router();

// Land config endpoints retired 2026-05-18. Reachable as substrate
// operations on the `<land>/.config` meta-position
// ([[project_meta_positions]]):
//
//   GET /ibp/see/<land>/.config              (full config snapshot)
//   POST /ibp/do/<land>  { payload: { action: "set-config",    args: { key, value } } }
//   POST /ibp/do/<land>  { payload: { action: "delete-config", args: { key } } }
//
// Extension introspection + lifecycle endpoints retired 2026-05-19
// ([[project_everything_is_substrate]]):
//
//   GET  /ibp/see/<land>/.extensions                  (list)
//   GET  /ibp/see/<land>/.extensions/<name>           (one)
//   POST /ibp/do/<land>  { action: "install-extension",   args: { name, files, ... } }
//   POST /ibp/do/<land>  { action: "uninstall-extension", args: { name } }
//   POST /ibp/do/<land>  { action: "enable-extension",    args: { name } }
//   POST /ibp/do/<land>  { action: "disable-extension",   args: { name } }
//
// Horizon proxy endpoints (publish/comment/react) retired 2026-05-19
// with the parallel Canopy federation protocol
// ([[project_canopy_folds_into_ibp]]). When wire-protocol federation
// lands they become cross-land DO ops:
//
//   ibp:do horizon.treeos.ai/<land>/.extensions/<name>  { action: "horizon:publish", ... }
//   ibp:do horizon.treeos.ai/<land>/.extensions/<name>  { action: "horizon:comment", ... }
//   ibp:do horizon.treeos.ai/<land>/.extensions/<name>  { action: "horizon:react",   ... }
//
// Authenticated with canopy-signed envelopes; no per-route shims needed.

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
 *
 * Deferred retirement: this folds into `ibp:see <land>` once stance
 * authorization gates visibility per-stance ([[project_stance_authorization]]).
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
      .select("_id name systemRole rootOwner contributors visibility llmDefault metadata")
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

export default router;
