// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Deferred HTTP endpoint(s). What's left here is the one shim
// that hasn't moved onto the IBP surface yet (`GET /land/root`),
// kept so the legacy clients keep working. Every other land-level
// surface is reachable through `ibp:see <land>/.config`,
// `ibp:see <land>/.extensions`, `ibp:do <land>` with set-config /
// install-extension / etc. The protocol is the API; this file
// stays small.

import express from "express";
import { authenticateOptional } from "../middleware/authenticate.js";
import { sendOk, sendError, IBP_ERR } from "../../../seed/ibp/protocol.js";
import Space from "../../../seed/models/space.js";
import { getLandRoot } from "../../../seed/landRoot.js";

const router = express.Router();

/**
 * GET /api/v1/land/root
 *
 * Returns the land root space with children visible to the asker:
 *   - Land seed spaces (.identity, .config, .peers, ...)
 *   - Space-trees the being owns
 *   - Space-trees the being contributes to
 *   - Public space-trees on this land
 *
 * Folds into `ibp:see <land>` once stance authorization gates
 * visibility per-stance uniformly.
 */
router.get("/land/root", authenticateOptional, async (req, res) => {
  try {
    const landRootCached = await getLandRoot();
    if (!landRootCached) {
      return sendError(res, 404, IBP_ERR.SPACE_NOT_FOUND, "Land root not found");
    }

    // Fetch fresh from DB so we see newly created trees (cache may be stale)
    const landRoot = await Space.findById(landRootCached._id).select("_id name children").lean();

    const beingId = req.beingId;
    const isAnon = !beingId;

    // Fetch all land-root children with the fields needed to filter.
    const children = await Space.find({ _id: { $in: landRoot.children } })
      .select("_id name seedSpace rootOwner contributors llmDefault qualities")
      .lean();

    // A child is public if it carries a wildcard SEE permission rule
    // with empty requires — stance auth admits anyone.
    const isPublicSpace = (c) => {
      const quals = c.qualities instanceof Map ? Object.fromEntries(c.qualities) : (c.qualities || {});
      const rule = quals.permissions?.see?.["*"];
      if (!rule) return false;
      return !rule.requires || Object.keys(rule.requires).length === 0;
    };

    // Filter: anonymous sees only public trees; authenticated sees
    // seed spaces + owned + contributing + public.
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
          qualities: c.qualities || null,
        };
      }),
    });
  } catch (err) {
    sendError(res, 500, IBP_ERR.INTERNAL, err.message);
  }
});

export default router;
