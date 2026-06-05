// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Deferred HTTP endpoint(s). What's left here is the one shim
// that hasn't moved onto the IBP surface yet (`GET /reality/root`),
// kept so the legacy clients keep working. Every other place-level
// surface is reachable through `ibp:see <reality>/./config`,
// `ibp:see <reality>/./extensions`, `ibp:do <place>` with set-config /
// install-extension / etc. The protocol is the API; this file
// stays small.

import express from "express";
import { authenticateOptional } from "../middleware/authenticate.js";
import { sendOk, sendError, IBP_ERR } from "../../../seed/ibp/protocol.js";
import Space from "../../../seed/materials/space/space.js";
import { getSpaceRoot } from "../../../seed/sprout.js";

const router = express.Router();

/**
 * GET /api/v1/place/root
 *
 * Returns the place root space with children visible to the asker:
 *   - Place heaven spaces (.identity, .config, .peers, ...)
 *   - Space-trees the being owns
 *   - Space-trees the being contributes to
 *   - Public space-trees on this reality
 *
 * Folds into `ibp:see <place>` once stance authorization gates
 * visibility per-stance uniformly.
 */
router.get("/reality/root", authenticateOptional, async (req, res) => {
  try {
    const spaceRootCached = await getSpaceRoot();
    if (!spaceRootCached) {
      return sendError(res, 404, IBP_ERR.SPACE_NOT_FOUND, "Reality root not found");
    }

    // Fetch fresh from DB so we see newly created trees (cache may be stale)
    const spaceRoot = await Space.findById(spaceRootCached._id).select("_id name children").lean();

    const beingId = req.beingId;
    const isAnon = !beingId;

    // Fetch all place-root children with the fields needed to filter.
    const children = await Space.find({ _id: { $in: spaceRoot.children } })
      .select("_id name heavenSpace rootOwner contributors llmDefault qualities")
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
    // heaven spaces + owned + contributing + public.
    const visible = children.filter((c) => {
      const pub = isPublicSpace(c);
      if (isAnon) return pub;
      if (c.heavenSpace) return true;
      if (c.rootOwner && String(c.rootOwner) === String(beingId)) return true;
      if (c.contributors && c.contributors.map(String).includes(String(beingId))) return true;
      return pub;
    });

    sendOk(res, {
      _id: spaceRoot._id,
      name: spaceRoot.name,
      children: visible.map((c) => {
        const pub = isPublicSpace(c);
        return {
          _id: c._id,
          name: c.name,
          heavenSpace: isAnon ? null : (c.heavenSpace || null),
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
