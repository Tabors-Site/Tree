// plan extension entry point.
//
// Exports the plan primitive api (state/plan.js) and registers the
// afterMetadataWrite hook that keeps parent rollups in sync when a
// child's plan changes. The slot renderer for node detail pages is
// registered in pages/planPanel.js via treeos-base's slot registry.

import log from "../../seed/log.js";
import {
  readPlan,
  readRollup,
  readArchivedPlans,
  setSteps,
  addStep,
  updateStep,
  deleteStep,
  initPlan,
  archivePlan,
  setBranchStepStatus,
  upsertBranchStep,
  findBranchStep,
  recomputeRollup,
  rollupUpward,
  branchSteps,
  stepsByKind,
  pendingSteps,
  NS,
} from "./state/plan.js";

export async function init(core) {
  // Register the plan panel slot on node detail pages. The slot
  // emits a placeholder div + a tiny script that fetches the
  // rendered HTML fragment from /api/v1/plan/node/:nodeId/panel.html
  // (mounted by routes.js) and swaps it in. Quick skip when the node
  // has no plan data so we don't render "Loading plan..." on every
  // node in the tree. Only loads when treeos-base is present.
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    if (treeos?.exports?.registerSlot) {
      treeos.exports.registerSlot(
        "node-detail-sections",
        "plan",
        ({ node, nodeId, qs }) => {
          try {
            const meta = node?.metadata instanceof Map
              ? node.metadata.get("plan")
              : node?.metadata?.plan;
            if (!meta?.steps?.length) return "";
          } catch { return ""; }
          const id = `plan-panel-${String(nodeId).slice(0, 8)}`;
          return `
            <div id="${id}" data-slot="node-detail-sections" data-ext="plan">
              <div style="padding:12px;color:rgba(255,255,255,0.4);font-size:11px;">Loading plan…</div>
            </div>
            <script>
              (async function() {
                try {
                  var res = await fetch("/api/v1/plan/node/${nodeId}/panel.html${qs || ""}", { credentials: "include" });
                  if (res.ok) {
                    var html = await res.text();
                    var el = document.getElementById("${id}");
                    if (el) el.outerHTML = html;
                  }
                } catch (e) {}
              })();
            </script>`;
        },
        { priority: 40 },
      );
    }
  } catch (err) {
    log.debug("Plan", `slot registration skipped: ${err.message}`);
  }

  // Mount edit/add/delete routes under /api/v1/plan/*.
  const { default: router } = await import("./routes.js");

  // afterMetadataWrite propagation hook. When a child's plan changes,
  // walk up the tree one level and recompute the parent's rollup so
  // the parent's cached rollup (and any branch step status derived
  // from it) reflects the child's new state.
  //
  // Loop guard: the plan's own recomputeRollup writes with
  // _propagated: true. The hook short circuits on that flag so we
  // don't pingpong between a rollup write triggering another rollup
  // write.
  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName, data }) => {
    if (extName !== NS || !nodeId || !data) return;
    if (data._propagated) return;
    try {
      const Node = (await import("../../seed/models/node.js")).default;
      const node = await Node.findById(nodeId).select("_id parent").lean();
      if (!node?.parent) return;
      // Parent may or may not have its own plan. recomputeRollup is
      // safe either way: it no-ops on nodes without a plan, otherwise
      // recomputes from own steps + branch children's cached rollups.
      await recomputeRollup(String(node.parent), null);
    } catch (err) {
      log.debug("Plan", `upward rollup skipped: ${err.message}`);
    }
  }, "plan");

  return {
    router,
    exports: {
      // Reads
      readPlan,
      readRollup,
      readArchivedPlans,
      findBranchStep,
      branchSteps,
      stepsByKind,
      pendingSteps,
      // Writes (all route through per node mutex in state/plan.js)
      setSteps,
      addStep,
      updateStep,
      deleteStep,
      initPlan,
      archivePlan,
      setBranchStepStatus,
      upsertBranchStep,
      // Rollup
      recomputeRollup,
      rollupUpward,
      // Namespace constant for reference
      NS,
    },
  };
}

export {
  readPlan,
  readRollup,
  readArchivedPlans,
  setSteps,
  addStep,
  updateStep,
  deleteStep,
  initPlan,
  archivePlan,
  setBranchStepStatus,
  upsertBranchStep,
  findBranchStep,
  recomputeRollup,
  rollupUpward,
  branchSteps,
  stepsByKind,
  pendingSteps,
  NS,
};
