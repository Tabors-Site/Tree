// coder:governing-coder seed.
//
// Plants a governing rulership at the target space. The four typed
// coder beings (coder-build, coder-refine, coder-review,
// coder-integrate) are created lazily by the Foreman's
// ensureWorkerBeing when first dispatched. We do not pre-materialize
// them — fresh work patterns may only need one or two types, and the
// Foreman's lazy creation matches what governing's base workers do.
//
// Workspace binding lives in extensions/coders/index.js
// (registerWorkspaceWorkerTypes). The seed's only job is to bring the
// governance quartet into existence at the target space. Once the
// rulership is in place, any subsequent Planner emission picks
// workerTypes and the Foreman finds the coder role names through the
// workspace registry — beings materialize as needed.
//
// Active-workspace tagging: the seed stamps metadata.governing.workspace
// = "coders" on the target space so governing's enrichContext hook can
// surface the active workspace block to the Planner, and so
// lookupWorkerRole's preferWorkspace argument resolves correctly when
// multiple workspaces are registered.

import log from "../../../seed/system/log.js";

export default {
  description:
    "Bootstrap a code-project rulership: plants Ruler/Planner/Contractor/Foreman " +
    "at the target space and binds the coders workspace so the Foreman's leaf " +
    "dispatches summon the typed coder beings (build/refine/review/integrate).",

  /**
   * @param {object} ctx
   * @param {string} ctx.rootSpaceId   target space where the rulership plants
   * @param {string} ctx.plantedSeedId
   * @param {object} ctx.identity     planter
   * @param {object} ctx.place         place services bundle
   * @param {object} ctx.params       plant-time configuration:
   *                                   - projectPath: absolute path on disk
   *                                     where the code project lives. Stamped
   *                                     onto metadata.coders.projectPath so
   *                                     coder tools (read/list/write file)
   *                                     can resolve relative paths against it.
   *                                     Required for the coder tools to work;
   *                                     optional at plant time so the operator
   *                                     can stamp it later if not known yet.
   */
  async scaffold({ rootSpaceId, plantedSeedId, identity, place, params = {} }) {
    // 1. Promote the target space to Ruler via governing's exported API.
    const { getExtension } = await import("../../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.promoteToRuler) {
      throw new Error("governing:promoteToRuler not available — is the governing extension loaded?");
    }
    const promoted = await governing.promoteToRuler({
      spaceId:       rootSpaceId,
      reason:        `planted by coder:governing-coder seed ${plantedSeedId.slice(0, 8)}`,
      promotedFrom:  governing.PROMOTED_FROM?.ROOT || "root",
      parentBeingId: null,
      identity,
    });
    if (!promoted) {
      throw new Error(`Failed to promote space ${String(rootSpaceId).slice(0, 8)} to Ruler`);
    }

    // 2. Tag this scope as a coders-workspace rulership and stamp the
    //    projectPath (if provided). The coder tools resolve paths
    //    relative to projectPath; without it, the operator must stamp
    //    metadata.coders.projectPath manually after plant.
    const Space = (await import("../../../seed/models/space.js")).default;
    const space = await Space.findById(rootSpaceId);
    if (space) {
      await place.do(space, "set", {
        field: "qualities.governing",
        value: { workspace: "coders" },
        merge: true,
      }, { identity });

      if (typeof params.projectPath === "string" && params.projectPath.length > 0) {
        await place.do(space, "set", {
          field: "qualities.coders",
          value: { projectPath: params.projectPath },
          merge: true,
        }, { identity });
      }
    }

    // Read the materialized governance beings for the return payload.
    const spaceLean = await Space.findById(rootSpaceId).select("metadata").lean();
    const beingsMeta = spaceLean?.qualities instanceof Map
      ? spaceLean.qualities.get("beings")
      : spaceLean?.qualities?.beings;

    log.info("Coders",
      `📜 governing-coder rulership at ${String(rootSpaceId).slice(0, 8)} ` +
      `(coder beings materialize lazily on first dispatch)`);

    return {
      kind: "governing-coder",
      spaceId: String(rootSpaceId),
      beings: {
        ruler:      beingsMeta?.ruler?.beingId      || null,
        planner:    beingsMeta?.planner?.beingId    || null,
        contractor: beingsMeta?.contractor?.beingId || null,
        foreman:    beingsMeta?.foreman?.beingId    || null,
      },
      workspace: "coders",
    };
  },
};
