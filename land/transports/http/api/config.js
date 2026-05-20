import express from "express";
import { authenticateOptional } from "../middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../../seed/ibp/protocol.js";
import Space from "../../../seed/models/space.js";
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
      return sendError(res, 404, ERR.SPACE_NOT_FOUND, "Land root not found");
    }

    // Fetch fresh from DB so we see newly created trees (cache may be stale)
    const landRoot = await Space.findById(landRootCached._id).select("_id name children").lean();

    const beingId = req.beingId;
    const isAnon = !beingId;

    // Fetch all Land root children with the fields we need to filter
    const children = await Space.find({ _id: { $in: landRoot.children } })
      .select("_id name seedSpace rootOwner contributors llmDefault metadata")
      .lean();

    // A child is public if it carries a wildcard SEE permission rule
    // with empty requires — i.e. stance auth admits anyone.
    const isPublicSpace = (c) => {
      const meta = c.metadata instanceof Map ? Object.fromEntries(c.metadata) : (c.metadata || {});
      const rule = meta.permissions?.see?.["*"];
      if (!rule) return false;
      return !rule.requires || Object.keys(rule.requires).length === 0;
    };

    // Filter: anonymous sees only public trees, authenticated sees system + owned + contributing + public
    const visible = children.filter((c) => {
      const pub = isPublicSpace(c);
      if (isAnon) return pub;
      if (c.seedSpace) return true;
      if (c.rootOwner && String(c.rootOwner) === String(beingId)) return true;
      if (c.contributors && c.contributors.map(String).includes(String(beingId))) return true;
      return pub;
    });

    sendOk(res, {
      _id: landRoot._id,
      name: landRoot.name,
      children: visible.map((c) => {
        const pub = isPublicSpace(c);
        return {
          _id: c._id,
          name: c.name,
          seedSpace: isAnon ? null : (c.seedSpace || null),
          rootOwner: c.rootOwner || null,
          isOwned: !isAnon && c.rootOwner && String(c.rootOwner) === String(beingId),
          isPublic: pub,
          queryAvailable: pub && !!(c.llmDefault && c.llmDefault !== "none"),
          metadata: c.metadata || null,
        };
      }),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
