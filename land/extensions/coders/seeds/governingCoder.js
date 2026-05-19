// coder:governing-coder seed.
//
// Plants a governing rulership at the target node AND materializes a
// coder-worker being there. Operators plant this on a fresh tree root
// to bootstrap a working code-project domain in one step: Ruler +
// Planner + Contractor + Foreman + Coder all live at the node, ready
// to receive SUMMONs.
//
// Idempotent: `promoteToRuler` no-ops on already-promoted nodes; the
// coder-worker creation checks for an existing entry before spawning.

import log from "../../../seed/core/log.js";

export default {
  description:
    "Bootstrap a code-project rulership: plants the Ruler/Planner/Contractor/" +
    "Foreman governance structure plus a coder-worker being at the target " +
    "node. The coder responds to leaf build steps the Foreman dispatches.",

  /**
   * @param {object} ctx
   * @param {string} ctx.rootNodeId   target node where the rulership plants
   * @param {string} ctx.plantedSeedId
   * @param {object} ctx.identity     planter
   * @param {object} ctx.core         core services bundle
   */
  async scaffold({ rootNodeId, plantedSeedId, identity, core }) {
    // 1. Promote the target node to Ruler via governing's exported API.
    // governing.exports.promoteToRuler is pre-bound to core.
    const { getExtension } = await import("../../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.promoteToRuler) {
      throw new Error("governing:promoteToRuler not available — is the governing extension loaded?");
    }
    const promoted = await governing.promoteToRuler({
      nodeId: rootNodeId,
      reason: `planted by coder:governing-coder seed ${plantedSeedId.slice(0, 8)}`,
      promotedFrom: governing.PROMOTED_FROM?.ROOT || "root",
      parentBeingId: null,
      identity,
    });
    if (!promoted) {
      throw new Error(`Failed to promote node ${String(rootNodeId).slice(0, 8)} to Ruler`);
    }

    // Read the materialized governance beings.
    const Node = (await import("../../../seed/models/node.js")).default;
    const node = await Node.findById(rootNodeId).select("metadata").lean();
    const beingsMeta = node?.metadata instanceof Map
      ? node.metadata.get("beings")
      : node?.metadata?.beings;
    const rulerBeingId = beingsMeta?.ruler?.beingId || null;
    if (!rulerBeingId) {
      throw new Error("promoteToRuler completed but no ruler being recorded");
    }

    // 2. Materialize a coder-worker being at the same node, parented
    //    under the Ruler (sub-Ruler dispatch + Foreman summons it for
    //    leaf build steps). Idempotent: skip if a coder is already
    //    registered in metadata.beings.
    let coderBeingId = beingsMeta?.coder?.beingId || null;
    if (!coderBeingId) {
      const { createBeingWithHome } = await import("../../../seed/core/auth.js");
      const { being: coder } = await createBeingWithHome({
        operatingMode: "ai",
        role:          "coder",
        homeNodeId:    String(rootNodeId),
        parentBeingId: rulerBeingId,
      });
      coderBeingId = String(coder._id);
      // Stamp metadata.beings.coder so future dispatches find this
      // instance instead of creating duplicates.
      const fresh = await Node.findById(rootNodeId);
      if (fresh) {
        await core.do(fresh, "set-meta", {
          namespace: "beings",
          data: {
            coder: {
              beingId:     coderBeingId,
              installedBy: "coder:governing-coder seed",
              installedAt: new Date().toISOString(),
            },
          },
          merge: true,
        });
      }
      log.info("Coders",
        `✨ materialized coder being ${coderBeingId.slice(0, 8)} ` +
        `at ${String(rootNodeId).slice(0, 8)}`);
    } else {
      log.info("Coders",
        `coder being ${String(coderBeingId).slice(0, 8)} already present at ` +
        `${String(rootNodeId).slice(0, 8)} — skipping create`);
    }

    return {
      kind: "governing-coder",
      nodeId: String(rootNodeId),
      beings: {
        ruler:      rulerBeingId,
        planner:    beingsMeta?.planner?.beingId    || null,
        contractor: beingsMeta?.contractor?.beingId || null,
        foreman:    beingsMeta?.foreman?.beingId    || null,
        coder:      coderBeingId,
      },
    };
  },
};
