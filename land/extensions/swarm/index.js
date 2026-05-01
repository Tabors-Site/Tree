// swarm extension entry point.
//
// Swarm is the EXECUTION engine over the unified plan primitive owned
// by the `plan` extension. It reads branch kind steps, dispatches each
// as its own session at the corresponding tree node, and writes status
// updates back through the plan api as branches finish.
//
// Lifecycle hooks (subscribers declare them in their manifest.listens):
//
//   swarm:afterProjectInit       a project root was initialized
//   swarm:beforeBranchRun        about to dispatch a branch
//   swarm:afterBranchComplete    a branch finished (done / failed / paused)
//   swarm:afterAllBranchesComplete every branch terminated, pre summary
//   swarm:branchRetryNeeded      handlers flipped statuses, re running retry
//   swarm:runScouts              scout phase cycle (scout extensions hook here)

import {
  validateBranches,
  runBranchSwarm,
} from "./swarm.js";
// Resumption decision moved to governing.resumeAtRuler. swarm exposes
// runBranchSwarm as the dispatch primitive; the decision of WHAT to
// dispatch on resume is the Ruler's, owned by governing.
import {
  findBranchContext,
  findBranchSiblings,
  promoteDoneAncestors,
  detectResumableSwarm,
} from "./project.js";
import { reconcileProject } from "./reconcile.js";
import { readSiblingBranches, readSiblingNode } from "./siblingRead.js";
import {
  appendSignal,
  readSignals,
  pruneSignalsForFile,
  pruneSignalsByKind,
} from "./state/signalInbox.js";
// Contracts and validators APIs moved to the governing extension. Swarm
// re-exports them transitionally so callers using getExtension("swarm")
// keep working while consumers migrate to getExtension("governing"). The
// module-level imports below are the only places swarm itself reaches
// into governing.
import { setContracts, readContracts, readScopedContracts } from "../governing/state/contracts.js";
import {
  registerValidator,
  unregisterValidatorsForExt,
  runValidators,
  listValidators,
} from "../governing/state/validators.js";
import { setSummary } from "./state/meta.js";
import { rollUpDetail, readAggregatedDetail } from "./state/aggregation.js";
import { recordEvent, readEvents } from "./state/events.js";
import { plan } from "./state/planAccess.js";
import log from "../../seed/log.js";

let _core = null;

export async function init(core) {
  _core = core;

  // Mount the swarm-specific generate-sub-plan route. The branch step
  // edit endpoints live in the plan extension; swarm only owns dispatch
  // actions that need their own endpoint.
  const { default: router } = await import("./routes.js");

  // Register the read only "swarm plans" HTML view at
  // /api/v1/root/:rootId/swarm-plans (current plan + archived ring).
  // Skips gracefully if html-rendering isn't loaded.
  try {
    const { getExtension } = await import("../loader.js");
    const html = getExtension("html-rendering")?.exports;
    if (html?.registerPage) {
      const authenticate = (await import("../../seed/middleware/authenticate.js")).default;
      const { renderSwarmPlansPage } = await import("./pages/swarmPlans.js");
      html.registerPage("get", "/root/:rootId/swarm-plans", authenticate, async (req, res) => {
        try { res.send(await renderSwarmPlansPage({ rootId: req.params.rootId })); }
        catch (err) { res.status(500).send(`Swarm plans error: ${err.message}`); }
      });
    }
  } catch {}

  // Sideways signal propagation. When a USER edits a branch step's
  // spec or files via the plan panel's inline edit form, the plan
  // extension stamps `_userEdit: true` on the plan namespace. This
  // hook detects that flag, walks the parent's children, and drops
  // PEER_SPEC_CHANGED signals into every sibling branch's inbox so
  // their next session sees the updated peer shape.
  //
  // Loop guard: the hook only acts on plan writes flagged with
  // _userEdit. Non user writes (status updates from execution,
  // rollup propagation) skip without inspection.
  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName, data }) => {
    if (extName !== "plan" || !nodeId || !data) return;
    if (!data._userEdit) return;

    try {
      const Node = (await import("../../seed/models/node.js")).default;
      const parent = await Node.findById(nodeId).select("_id children").lean();
      if (!parent?.children?.length) return;
      const kids = await Node.find({ _id: { $in: parent.children } })
        .select("_id name metadata.swarm")
        .lean();
      const branchSteps = (data.steps || []).filter((s) => s.kind === "branch");
      for (const step of branchSteps) {
        // Find the sibling each branch corresponds to.
        const stepKid = kids.find((k) =>
          (step.childNodeId && String(k._id) === String(step.childNodeId)) ||
          k.name === step.title,
        );
        if (!stepKid) continue;
        for (const sibling of kids) {
          if (sibling._id.equals(stepKid._id)) continue;
          await appendSignal({
            nodeId: sibling._id,
            signal: {
              kind: "PEER_SPEC_CHANGED",
              fromBranch: step.title,
              newSpec: step.spec || null,
              newFiles: Array.isArray(step.files) ? step.files.slice(0, 20) : [],
              at: new Date().toISOString(),
            },
            core: { metadata: { setExtMeta: async (n, ns, d) => {
              const NodeModel = (await import("../../seed/models/node.js")).default;
              await NodeModel.updateOne({ _id: n._id }, { $set: { [`metadata.${ns}`]: d } });
            }}},
          });
        }
      }
      // Clear the user edit flag so subsequent writes don't re fire.
      // The plan extension's own writes do not stamp this flag.
      const NodeModel = (await import("../../seed/models/node.js")).default;
      await NodeModel.updateOne(
        { _id: nodeId },
        { $unset: { "metadata.plan._userEdit": "" } },
      );
    } catch (err) {
      log.debug("Swarm", `sideways propagate skipped: ${err.message}`);
    }
  }, "swarm");

  return {
    router,
    exports: {
      validateBranches,
      runBranchSwarm,
      findBranchContext,
      findBranchSiblings,
      promoteDoneAncestors,
      detectResumableSwarm,
      reconcileProject,
      readSiblingBranches,
      readSiblingNode,
      appendSignal,
      readSignals,
      pruneSignalsForFile,
      pruneSignalsByKind,
      setContracts,
      readContracts,
      readScopedContracts,
      // Declarative validator registry (Pass 1 strengthening). Lets
      // extensions declare validator phase + order explicitly instead
      // of relying on kernel-hook registration order. Pass 2's court
      // system uses this to guarantee pre-court / court / post-court
      // firing semantics. See state/validators.js for full docs.
      registerValidator,
      unregisterValidatorsForExt,
      runValidators,
      listValidators,
      setSummary,
      rollUpDetail,
      readAggregatedDetail,
      recordEvent,
      readEvents,
      // Convenience: expose the plan extension's read api so callers
      // that already do getExtension("swarm") can read a project's
      // current plan without a second extension lookup. Writes still
      // go through getExtension("plan") to keep ownership clear.
      readPlan: async (nodeId) => {
        try {
          const p = await plan();
          return p.readPlan(nodeId);
        } catch { return null; }
      },
    },
  };
}

// ensureProject removed. The work it did splits cleanly: governing's
// promoteToRuler owns role assignment, swarm's ensureScopeBookkeeping
// owns mechanism-state init at dispatch time, plan.ensurePlanAtScope
// owns plan-namespace setup. Callers reach for those primitives
// directly instead of asking swarm to "ensure a project."

export {
  validateBranches,
  runBranchSwarm,
  findBranchContext,
  findBranchSiblings,
  promoteDoneAncestors,
  detectResumableSwarm,
  reconcileProject,
  readSiblingBranches,
  readSiblingNode,
  appendSignal,
  readSignals,
  pruneSignalsForFile,
  pruneSignalsByKind,
  setContracts,
  readContracts,
  rollUpDetail,
  readAggregatedDetail,
  recordEvent,
  readEvents,
};
