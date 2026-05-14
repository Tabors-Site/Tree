// Governance dashboard data assembler.
//
// The dashboard page renders the full rulership tree on one surface.
// This module orchestrates the per-Ruler reads that the page needs:
// walkRulers → for each Ruler entry, fetch its snapshot + full
// emissions (plan/contracts/runs) + ledgers + pending flags.
//
// One module, one purpose: assemble. The page renderer (pages/
// dashboard.js) takes the output and shapes HTML; this file does no
// rendering. Keeps the data shape testable in isolation and the
// renderer focused on layout.
//
// The snapshot already carries a sub-Ruler summary. The dashboard
// uses walkRulers to enumerate ALL Rulers in the tree (the snapshot
// is single-level; the dashboard wants the recursive tree on one
// page).

import log from "../../../seed/log.js";
import Node from "../../../seed/models/node.js";
import { walkRulers, readRole } from "./role.js";
import { buildRulerSnapshot } from "./rulerSnapshot.js";
import {
  readActivePlanEmission,
  readPlanApprovalsAtRuler,
} from "./planApprovals.js";
import {
  readActiveContractsEmission,
  readApprovalsAtRuler,
  readContracts,
} from "./contracts.js";
import {
  readActiveExecutionRecord,
  readExecutionApprovalsAtRuler,
} from "./foreman.js";
import { readPendingIssues, summarizeFlags } from "./flagQueue.js";

/**
 * Build the full dashboard data structure for a tree root.
 *
 * Returns:
 *   {
 *     root: { rootId, treeName },
 *     rulers: [
 *       {
 *         depth, rulerNodeId, rulerName,
 *         snapshot,                  // buildRulerSnapshot output
 *         planEmission,              // full active plan (reasoning + steps[])
 *         contractsEmission,         // full active contracts (reasoning + contracts[])
 *         executionRecord,           // full active run (stepStatuses[])
 *         flagsSummary,              // summarizeFlags output
 *         flagsAll,                  // full pending list (for the expand view)
 *         ledgers: { plan, contracts, execution },  // approval histories
 *       },
 *       ...
 *     ],
 *     truncated: boolean,            // walkRulers hit MAX_RULERS
 *   }
 *
 * Sub-Rulers are NOT nested in the data; they appear as separate
 * entries with depth+1. The renderer composes the tree visually
 * via depth-indexed indentation. Flat shape keeps the data simple
 * and lets the renderer decide whether to nest or flatten.
 */
export async function buildDashboardData(rootId) {
  if (!rootId) return null;

  // Tree root metadata. Best-effort: a 404 here means the rootId is
  // bogus; return a minimal shape so the page renders a friendly
  // empty state rather than crashing.
  let treeName = null;
  try {
    const rootNode = await Node.findById(rootId).select("_id name").lean();
    treeName = rootNode?.name || null;
  } catch (err) {
    log.debug("Governing/Dashboard", `root read skipped: ${err.message}`);
  }

  // Enumerate every Ruler in the subtree.
  const rulerList = await walkRulers(rootId);

  // For each Ruler, fetch its full data in parallel. Per-Ruler
  // reads are independent — no need to serialize. With ~10 Rulers
  // and ~6 reads each, that's 60 mongo reads; parallelizing keeps
  // page-load latency tight.
  const rulers = await Promise.all(
    rulerList.map(async (entry) => {
      const { depth, rulerNodeId, name } = entry;
      // Each read is wrapped in try/catch so one failure doesn't
      // sink the whole page. Missing data renders as "absent" in
      // the card; the page stays usable.
      let snapshot = null;
      let planEmission = null;
      let contractsEmission = null;
      let contractsInForce = [];
      let executionRecord = null;
      let flagsAll = [];
      let flagsSummary = null;
      let planApprovals = [];
      let contractApprovals = [];
      let executionApprovals = [];

      try { snapshot = await buildRulerSnapshot(rulerNodeId); } catch (err) {
        log.debug("Governing/Dashboard", `snapshot ${rulerNodeId.slice(0, 8)}: ${err.message}`);
      }
      try { planEmission = await readActivePlanEmission(rulerNodeId); } catch {}
      try { contractsEmission = await readActiveContractsEmission(rulerNodeId); } catch {}
      // Effective vocabulary at this scope: every in-force contract,
      // walking ancestors. Distinct from contractsEmission, which is
      // only what THIS scope's Contractor most recently ratified.
      // A scope that inherits has an empty emission but a populated
      // in-force list.
      try { contractsInForce = await readContracts(rulerNodeId); } catch {}
      try { executionRecord = await readActiveExecutionRecord(rulerNodeId); } catch {}
      try {
        flagsAll = await readPendingIssues(rulerNodeId);
        if (flagsAll.length > 0) {
          flagsSummary = summarizeFlags(flagsAll, { lastN: 5 });
        }
      } catch {}
      try { planApprovals = await readPlanApprovalsAtRuler(rulerNodeId); } catch {}
      try { contractApprovals = await readApprovalsAtRuler(rulerNodeId); } catch {}
      try { executionApprovals = await readExecutionApprovalsAtRuler(rulerNodeId); } catch {}

      return {
        depth,
        rulerNodeId,
        rulerName: name,
        snapshot,
        planEmission,
        contractsEmission,
        contractsInForce,
        executionRecord,
        flagsAll,
        flagsSummary,
        ledgers: {
          plan: planApprovals || [],
          contracts: contractApprovals || [],
          execution: executionApprovals || [],
        },
      };
    }),
  );

  return {
    root: {
      rootId: String(rootId),
      treeName,
    },
    rulers,
    truncated: rulerList.length >= 256,
  };
}

/**
 * Convenience: derive the "is this tree governed?" predicate for the
 * page's empty-state rendering. Returns true if the root or any
 * descendant has been promoted to Ruler.
 *
 * Cheap probe — reads only the root's role metadata. If the root is
 * a Ruler, the tree is governed. If not, we conservatively return
 * false; walkRulers will surface any sub-Ruler subtrees during the
 * full data assembly.
 */
export async function isTreeGoverned(rootId) {
  if (!rootId) return false;
  const role = await readRole(rootId);
  return role?.role === "ruler";
}
