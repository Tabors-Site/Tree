// Contracts-type node management. The contracts-type node is the
// Contractor's emission at a Ruler scope, parallel to how plan-type
// nodes are the Planner's emission. The contracts node holds the
// emitted contracts in metadata.governing.contracts (keyed by id with
// version chain via supersedes); the Ruler scope itself holds the
// approval ledger as metadata.governing.contractApprovals.
//
// This shape replaces the legacy metadata.plan.contracts blob from
// the swarm-to-governing migration. See
// project_contracts_node_architecture.md for the full model.

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

/**
 * Read the contracts map from a contracts-type node. Returns
 * {[id]: contractEntry} or empty object if the node has no contracts.
 */
export function readContractsMap(contractsNode) {
  if (!contractsNode) return {};
  const meta = contractsNode.metadata instanceof Map
    ? contractsNode.metadata.get(NS)
    : contractsNode.metadata?.[NS];
  return (meta?.contracts && typeof meta.contracts === "object") ? meta.contracts : {};
}

/**
 * Read the approval ledger from a Ruler scope. Returns the array of
 * approval entries or empty array.
 *
 * Each entry shape:
 *   { contractRef: "<nodeId>:<contractId>", approvedAt, status, supersedes?, reason? }
 */
export function readApprovalLedger(rulerNode) {
  if (!rulerNode) return [];
  const meta = rulerNode.metadata instanceof Map
    ? rulerNode.metadata.get(NS)
    : rulerNode.metadata?.[NS];
  return Array.isArray(meta?.contractApprovals) ? meta.contractApprovals : [];
}

/**
 * Parse a contractRef into { nodeId, contractId }. Returns null on bad
 * shape. The ref format is "<nodeId>:<contractId>" where contractId
 * may itself contain colons (everything after the FIRST colon is the
 * contract id).
 */
export function parseContractRef(ref) {
  if (typeof ref !== "string" || !ref) return null;
  const idx = ref.indexOf(":");
  if (idx <= 0) return null;
  const nodeId = ref.slice(0, idx);
  const contractId = ref.slice(idx + 1);
  if (!nodeId || !contractId) return null;
  return { nodeId, contractId };
}

/**
 * Build a contractRef string. Inverse of parseContractRef.
 */
export function buildContractRef(nodeId, contractId) {
  return `${String(nodeId)}:${String(contractId)}`;
}
