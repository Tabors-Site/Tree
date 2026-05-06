// Contracts trio member management. The contracts node is the
// Contractor's emission surface at a Ruler scope — symmetric with the
// plan node (Planner's surface) and the execution node (Foreman's
// surface). Each Contractor invocation creates a `contracts-emission-N`
// child node under this node carrying the structured contract set;
// the Ruler scope holds metadata.governing.contractApprovals as the
// approval ledger pointing at the active emission.
//
// This file owns the trio-member node primitive (find/create with
// role + mode stamping). The ring-record machinery — emission
// creation, approval ledger, idempotency, readActive, readContracts —
// lives in contracts.js.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const NS = "governing";

/**
 * Find or create the contracts-type child of a Ruler scope. Idempotent:
 * returns the existing node if found, creates lazily otherwise.
 *
 * Scope MUST be the Ruler scope (the parent of the trio, not the trio
 * member itself). Caller is responsible for ensuring scopeNodeId is a
 * Ruler — typically governing.findRulerScope or runRulerCycle's
 * currentNodeId after promotion.
 */
export async function ensureContractsNode({ scopeNodeId, userId, core }) {
  if (!scopeNodeId) return null;

  // Direct probe for an existing contracts-type child.
  const existing = await Node.findOne({
    parent: scopeNodeId,
    type: "contracts",
  }).select("_id name parent type metadata").lean();
  if (existing) return existing;

  // Create lazily. Use core.tree.createNode if available so the kernel's
  // hooks (afterNodeCreate, contribution log) fire; fall back to a
  // direct insert otherwise (e.g. background contexts without core).
  let created = null;
  try {
    if (core?.tree?.createNode) {
      created = await core.tree.createNode({
        parentId: String(scopeNodeId),
        name: "contracts",
        type: "contracts",
        userId,
        wasAi: true,
      });
    }
  } catch (err) {
    log.debug("Governing", `core.tree.createNode failed for contracts node: ${err.message}; falling back to direct insert`);
  }

  if (!created) {
    // Fallback: direct insert. Mirrors plan extension's createPlanNode
    // pattern when the scoped core is absent.
    const { default: NodeModel } = await import("../../../seed/models/node.js");
    const { v4: uuid } = await import("uuid");
    created = await NodeModel.create({
      _id: uuid(),
      name: "contracts",
      type: "contracts",
      parent: scopeNodeId,
      children: [],
      contributors: [],
      status: "active",
    });
    await NodeModel.updateOne({ _id: scopeNodeId }, { $addToSet: { children: created._id } });
  }

  // Mark the contracts node as structural for governing. The kernel's
  // beforeNodeDelete guard refuses deletion of any node carrying an
  // extension role marker — without this, a casual cd-and-delete would
  // wipe the audit chain. See CLAUDE.md "role field marks structural
  // nodes."
  //
  // Also assign the per-node Contractor mode so anyone visiting the
  // contracts node chats with Contractor by default. Phase 1 sets the
  // field; phase 2 will route emission through it.
  try {
    const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
    const node = await Node.findById(created._id);
    if (node) {
      const existingMeta = node.metadata instanceof Map
        ? node.metadata.get(NS)
        : node.metadata?.[NS];
      const existingModes = node.metadata instanceof Map
        ? node.metadata.get("modes")
        : node.metadata?.modes;
      await kernelSetExtMeta(node, NS, {
        ...(existingMeta || {}),
        role: "contracts",
        scopeRulerId: String(scopeNodeId),
        createdAt: existingMeta?.createdAt || new Date().toISOString(),
      });
      if (existingModes?.plan !== "tree:governing-contractor") {
        await kernelSetExtMeta(node, "modes", {
          ...(existingModes || {}),
          plan: "tree:governing-contractor",
        });
      }
    }
  } catch (err) {
    log.warn("Governing", `failed to stamp contracts-node role marker: ${err.message}`);
  }

  return created;
}

// readContractsMap, readApprovalLedger, parseContractRef,
// buildContractRef removed in the contracts ring refactor. Each
// Contractor invocation now creates a contracts-emission-N child node
// (same shape as plan-emission-N and execution-record-N); the
// approval ledger uses single-emission entries with `contractsRef:
// <emissionNodeId>`. Read paths live in contracts.js as
// readActiveContractsEmission + readContracts + readScopedContracts.
