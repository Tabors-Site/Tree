// swarm extension entry point.
//
// Exposes branch-orchestration primitives that any domain extension can
// drive. Registers no modes; swarm is pure mechanism. Fires these
// lifecycle hooks (subscribers declare them in their manifest.listens):
//
//   swarm:afterProjectInit       — a project root was initialized
//   swarm:beforeBranchRun        — about to dispatch a branch
//   swarm:afterBranchComplete    — a branch finished (done / failed / paused)
//   swarm:afterAllBranchesComplete — every branch terminated, pre-summary
//   swarm:branchRetryNeeded      — handlers flipped statuses, re-running retry

import {
  parseBranches,
  parseContracts,
  validateBranches,
  runBranchSwarm,
} from "./swarm.js";
import { tryResumeSwarm } from "./resumeSwarm.js";
import {
  findProjectForNode,
  findBranchContext,
  findBranchSiblings,
  promoteDoneAncestors,
  detectResumableSwarm,
  ensureProject as _ensureProject,
} from "./project.js";
import { reconcileProject } from "./reconcile.js";
import { readSiblingBranches, readSiblingNode } from "./siblingRead.js";
import {
  readSubPlan,
  upsertSubPlanEntry,
  initProjectPlan,
  initBranchNode,
  setBranchStatus,
} from "./state/subPlan.js";
import {
  appendSignal,
  readSignals,
  pruneSignalsForFile,
  pruneSignalsByKind,
} from "./state/signalInbox.js";
import { setContracts, readContracts } from "./state/contracts.js";
import { rollUpDetail, readAggregatedDetail } from "./state/aggregation.js";
import { recordEvent, readEvents } from "./state/events.js";

let _core = null;

export async function init(core) {
  _core = core;
  // Loader requires init() to return an object. Swarm has no router,
  // no tools, no jobs — just exported primitives consumed via
  // getExtension("swarm").exports. The return value wires those up.
  return {
    exports: {
      parseBranches,
      parseContracts,
      validateBranches,
      runBranchSwarm,
      tryResumeSwarm,
      findProjectForNode,
      findBranchContext,
      findBranchSiblings,
      promoteDoneAncestors,
      detectResumableSwarm,
      ensureProject,
      reconcileProject,
      readSiblingBranches,
      readSiblingNode,
      readSubPlan,
      upsertSubPlanEntry,
      initProjectPlan,
      initBranchNode,
      setBranchStatus,
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
    },
  };
}

/**
 * ensureProject wraps the core-aware version so callers don't have to
 * thread `core` + `fireHook` every time.
 */
async function ensureProject({ rootId, systemSpec, owner }) {
  return _ensureProject({
    rootId,
    systemSpec,
    owner,
    core: _core,
    fireHook: (name, payload) => _core?.hooks?.fire?.(name, payload),
  });
}

export {
  // Parsing + dispatch
  parseBranches,
  parseContracts,
  validateBranches,
  runBranchSwarm,
  tryResumeSwarm,
  // Project / tree walks
  findProjectForNode,
  findBranchContext,
  findBranchSiblings,
  promoteDoneAncestors,
  detectResumableSwarm,
  ensureProject,
  // Reconciliation (tree is authoritative)
  reconcileProject,
  // Sibling read-only access
  readSiblingBranches,
  readSiblingNode,
  // State primitives
  readSubPlan,
  upsertSubPlanEntry,
  initProjectPlan,
  initBranchNode,
  setBranchStatus,
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
