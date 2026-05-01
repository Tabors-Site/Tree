// governing extension entry point.
//
// Registers the four coordination modes (Planner, Contractor, Worker,
// Foreman) and exposes the role lifecycle API for callers that need
// to promote a node to Ruler at any depth. Workspaces (code-workspace,
// book-workspace, etc.) consume governing for coordination and may
// specialize the Worker base mode by registering their own
// domain-specific Worker variant.
//
// The trio is now a quartet at every Ruler scope: plan-node
// (Planner's emission surface), contracts-node (Contractor's surface),
// execution-node (Foreman's surface), all under the Ruler. The
// Foreman role's reasoning surface is structurally registered in
// Pass 1; the LLM-driven retry-vs-escalate / court-convening logic
// lands in Pass 2.

import log from "../../seed/log.js";
import plannerMode from "./modes/planner.js";
import contractorMode from "./modes/contractor.js";
import workerMode from "./modes/worker.js";
import foremanMode from "./modes/foreman.js";
import { promoteToRuler, readRole, isRuler, findRulerScope, PROMOTED_FROM, NS } from "./state/role.js";
import { findLCA, ancestorChain, isAncestorOrSelf, validateScopeAuthority } from "./state/lca.js";
import { setContracts, readContracts, readScopedContracts, readApprovalsAtRuler } from "./state/contracts.js";
import { ensureContractsNode, readContractsMap, readApprovalLedger, parseContractRef, buildContractRef } from "./state/contractsNode.js";
import { ensurePlanAtScope } from "./state/planNode.js";
import {
  appendPlanApproval,
  readPlanApprovalsAtRuler,
  readPlanApprovalLedger,
  readActivePlanApproval,
  readActivePlanEmission,
  buildPlanRef,
  parsePlanRef,
} from "./state/planApprovals.js";
import {
  writeLineage,
  readLineage,
  inferLineageFromParent,
} from "./state/lineage.js";
import {
  ensureExecutionNode,
  findExecutionNode,
} from "./state/executionNode.js";
import {
  appendExecutionRecord,
  appendExecutionApproval,
  readExecutionApprovalsAtRuler,
  readActiveExecutionApproval,
  readActiveExecutionRecord,
  updateStepStatus,
  freezeExecutionRecord,
  buildExecutionRef,
  parseExecutionRef,
} from "./state/foreman.js";
import { resumeAtRuler } from "./state/resume.js";
import {
  registerValidator,
  unregisterValidatorsForExt,
  runValidators,
  listValidators,
} from "./state/validators.js";

export {
  promoteToRuler,
  readRole,
  isRuler,
  PROMOTED_FROM,
  NS,
  findLCA,
  ancestorChain,
  isAncestorOrSelf,
  validateScopeAuthority,
  setContracts,
  readContracts,
  readScopedContracts,
  registerValidator,
  unregisterValidatorsForExt,
  runValidators,
  listValidators,
};

export async function init(core) {
  // Register the three coordination modes. The kernel's mode registry
  // wants direct registerMode calls with the mode OBJECT (not a path);
  // manifest.provides.modes is informational/declarative and does not
  // self-register. Pattern matches code-workspace's init().
  if (core?.modes?.registerMode) {
    core.modes.registerMode("tree:governing-planner", plannerMode, "governing");
    core.modes.registerMode("tree:governing-contractor", contractorMode, "governing");
    core.modes.registerMode("tree:governing-worker", workerMode, "governing");
    core.modes.registerMode("tree:governing-foreman", foremanMode, "governing");
    log.verbose("Governing", "Registered modes: tree:governing-{planner, contractor, worker, foreman}");
  } else {
    log.warn("Governing", "core.modes.registerMode not available; modes NOT registered");
  }

  // Phase 2 prototype: governing-emit-plan. Single tool, structured
  // args, replaces the [[BRANCHES]] text emission for plans. Dispatch
  // still reads metadata.plan.steps[] this round; only the emission
  // half is swapped while we verify the local model can hit the shape.
  const { default: getGoverningTools } = await import("./tools.js");
  const tools = getGoverningTools(core);

  return {
    // Mode handlers (also exposed for cross-extension reuse, e.g.
    // workspaces extending the Worker base prompt).
    modes: [plannerMode, contractorMode, workerMode, foremanMode],
    tools,

    // The .exports object is what callers see at getExtension("governing")
    // .exports. Module-level named exports do NOT flow through; only the
    // returned `exports` field does. Callers (swarm.ensureBranchNode,
    // dispatch.runRulerCycle, future Pass 2 court hooks) reach for these.
    exports: {
      // Role lifecycle
      promoteToRuler, readRole, isRuler, findRulerScope, PROMOTED_FROM, NS,
      // LCA / scope authority
      findLCA, ancestorChain, isAncestorOrSelf, validateScopeAuthority,
      // Contracts (trio: contracts-type node holds emissions, Ruler holds
      // approval ledger). See project_contracts_node_architecture.
      setContracts, readContracts, readScopedContracts, readApprovalsAtRuler,
      ensureContractsNode, readContractsMap, readApprovalLedger,
      parseContractRef, buildContractRef,
      // Plan trio member. ensurePlanAtScope wraps plan.ensurePlanAtScope
      // and stamps governing's role marker + Planner mode assignment, so
      // every Ruler scope materializes its plan-type child the same way
      // it materializes its contracts-type child. Phase 1 of the trio
      // migration: structural shape only — dispatch still reads
      // metadata.plan.steps[]. Phase 2 will swap the dispatch source.
      ensurePlanAtScope,
      // Plan approval ledger, parallel to contractApprovals. The Ruler
      // appends a planApproval entry when it accepts the Planner's
      // emission, before invoking the Contractor.
      appendPlanApproval,
      readPlanApprovalsAtRuler,
      readPlanApprovalLedger,
      readActivePlanApproval,
      readActivePlanEmission,
      buildPlanRef, parsePlanRef,
      // Sub-Ruler lineage. writeLineage is called at dispatch time
      // (sub-Ruler promotion); readLineage walks the upstream chain.
      // inferLineageFromParent reconstructs lineage details from the
      // parent's active plan emission when explicit dispatch params
      // weren't threaded (current branch-swarm path).
      writeLineage, readLineage, inferLineageFromParent,
      // Foreman quartet member. ensureExecutionNode materializes the
      // execution-node child of a Ruler; appendExecutionRecord creates
      // a new execution-record tied to a plan emission (with optional
      // contracts emission ref) and writes the executionApproval
      // ledger entry. updateStepStatus / freezeExecutionRecord are
      // called by swarm (Phase B+) as branches transition through
      // pending → running → done / failed. The Foreman LLM reasoning
      // surface lands in Pass 2; Pass 1 establishes the data home.
      ensureExecutionNode, findExecutionNode,
      appendExecutionRecord, appendExecutionApproval,
      readExecutionApprovalsAtRuler, readActiveExecutionApproval,
      readActiveExecutionRecord,
      updateStepStatus, freezeExecutionRecord,
      buildExecutionRef, parseExecutionRef,
      // Validator registry
      registerValidator, unregisterValidatorsForExt, runValidators, listValidators,
      // Ruler resumption decision (replaces swarm.tryResumeSwarm).
      // The Ruler examines plan/contracts/branches and decides; swarm
      // executes the dispatch when the decision is "redispatch pending."
      resumeAtRuler,
    },
  };
}
