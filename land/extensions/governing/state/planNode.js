// Governing's wrapper around plan.ensurePlanAtScope. The plan
// extension owns the plan-type node primitive and metadata.plan
// schema; governing owns the role-taxonomy meaning ("the Ruler hires
// a Planner; the Planner produces a plan node alongside the contracts
// node"). This wrapper bridges them: it asks plan to materialize the
// plan-type child, then stamps governing's role marker AND assigns
// the governing-planner mode so that anyone visiting the plan node
// chats with Planner mode by default. Phase 1 of the trio migration
// records the mode-assignment on the node; phase 2 will route
// emission of proposed-worker children through that assignment.
//
// See planApprovals.js for the approval-side ledger this trio
// member feeds, and contractsNode.js for the parallel contracts-node
// shape.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const NS = "governing";

/**
 * Resolve the plan extension lazily. The plan extension is a hard
 * dep in governing's manifest, so this always returns when the loader
 * has finished initializing; the lazy import is purely for
 * circular-import safety (governing → planAccess → plan → ...).
 */
async function planExt() {
  try {
    const { getExtension } = await import("../../loader.js");
    return getExtension("plan")?.exports || null;
  } catch {
    return null;
  }
}

/**
 * Find or create the plan-type child of a Ruler scope, then stamp
 * governing's role marker and Planner mode assignment. Idempotent:
 * the underlying plan helper handles race conditions; the metadata
 * stamps merge-update so re-entering an already-stamped node is safe.
 *
 * Required: scopeNodeId, userId. Optional: name, systemSpec, budget,
 * core (for kernel hook firing on first creation).
 *
 * Returns the plan-type node (with the governing role marker present).
 */
export async function ensurePlanAtScope({
  scopeNodeId,
  userId,
  name = null,
  systemSpec = null,
  budget = null,
  core = null,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (!scopeNodeId) return null;

  const p = await planExt();
  if (!p?.ensurePlanAtScope) {
    log.warn("Governing", "ensurePlanAtScope: plan extension unavailable; skipping trio plan-side creation");
    return null;
  }

  let planNode = null;
  try {
    planNode = await p.ensurePlanAtScope(
      scopeNodeId,
      { userId, name, systemSpec, budget, wasAi, chatId, sessionId },
      core,
    );
  } catch (err) {
    log.warn("Governing", `ensurePlanAtScope: plan-extension call failed at scope ${String(scopeNodeId).slice(0, 8)}: ${err.message}`);
    return null;
  }
  if (!planNode) return null;

  // If the scope IS itself a plan-type node (the architect-entry case
  // where a user dropped chat at a plan node directly), don't try to
  // restamp governing role or modes — that node carries no Ruler
  // semantics in the trio model. Plan extension's ensurePlanAtScope
  // returns the same node when scopeNodeId is plan-type.
  if (String(planNode._id) === String(scopeNodeId)) return planNode;

  // Stamp governing role marker and per-node Planner mode assignment.
  // The role marker is the kernel's beforeNodeDelete guard: any node
  // carrying an extension role is structural and refuses delete-without-
  // force. The mode assignment makes "cd plan; chat" hit Planner.
  try {
    const node = await Node.findById(planNode._id);
    if (!node) return planNode;

    const existingMeta = node.metadata instanceof Map
      ? node.metadata.get(NS)
      : node.metadata?.[NS];
    const existingModes = node.metadata instanceof Map
      ? node.metadata.get("modes")
      : node.metadata?.modes;

    const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");

    // Governing namespace: role + scope ruler reference (parallel to
    // contracts node's role: "contracts" stamp).
    await kernelSetExtMeta(node, NS, {
      ...(existingMeta || {}),
      role: "plan",
      scopeRulerId: String(scopeNodeId),
      createdAt: existingMeta?.createdAt || new Date().toISOString(),
    });

    // Modes namespace: plan intent → governing-planner. Phase 1 just
    // sets the field. Phase 2 will route on it.
    if (existingModes?.plan !== "tree:governing-planner") {
      await kernelSetExtMeta(node, "modes", {
        ...(existingModes || {}),
        plan: "tree:governing-planner",
      });
    }
  } catch (err) {
    log.warn("Governing", `failed to stamp plan-node role/mode: ${err.message}`);
  }

  return planNode;
}
