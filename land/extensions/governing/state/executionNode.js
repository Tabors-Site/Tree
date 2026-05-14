// Execution-node management. The execution-node is the Foreman's
// emission surface at a Ruler scope: parallel to the plan-node
// (Planner's surface) and the contracts-node (Contractor's surface).
// It holds the Ruler scope's execution-records — one per dispatched
// run of an approved plan-emission, mutable while running and frozen
// to immutable archive on completion or supersession.
//
// The trio becomes a quartet: every Ruler scope materializes a
// plan-node, a contracts-node, and an execution-node. The Ruler
// holds three approval ledgers (planApprovals, contractApprovals,
// executionApprovals) tracking which emissions / records are
// currently in force.
//
// Phase A scope: lazy creation + role/mode stamping. Subsequent
// phases wire swarm to write step status updates onto
// execution-record nodes via the Foreman API.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const NS = "governing";

/**
 * Find or create the execution-type child of a Ruler scope. Idempotent:
 * returns the existing node if found, creates lazily otherwise.
 *
 * Stamps the execution-node with governing role "execution" so the
 * kernel's beforeNodeDelete guard refuses casual deletion (the
 * execution-record audit chain lives under here). Also assigns
 * tree:governing-foreman as the per-node plan-intent mode so visits
 * route to the Foreman mode once its reasoning surface lands.
 */
export async function ensureExecutionNode({ scopeNodeId, userId, core }) {
  if (!scopeNodeId) return null;

  // Idempotent probe.
  const existing = await Node.findOne({
    parent: scopeNodeId,
    type: "execution",
  }).select("_id name parent type metadata").lean();
  if (existing) return existing;

  // Create lazily. core.tree.createNode fires kernel hooks; fall back
  // to direct insert when the scoped core is absent.
  //
  // Visible name is "runs" (parallel collection holding execution
  // records). The structural type stays "execution" because every
  // query in the codebase filters on type, not name. Renaming type
  // would be a destructive migration; renaming name is cosmetic and
  // reads more naturally to anyone walking the tree. Sam's framing
  // (avoid "execution" overloading with phase-4 structural remedies)
  // is satisfied by the visible label change.
  let created = null;
  try {
    if (core?.tree?.createNode) {
      created = await core.tree.createNode({
        parentId: String(scopeNodeId),
        name: "runs",
        type: "execution",
        userId,
        wasAi: true,
      });
    }
  } catch (err) {
    log.debug("Governing", `core.tree.createNode failed for execution node: ${err.message}; falling back to direct insert`);
  }

  if (!created) {
    const { default: NodeModel } = await import("../../../seed/models/node.js");
    const { v4: uuid } = await import("uuid");
    created = await NodeModel.create({
      _id: uuid(),
      name: "runs",
      type: "execution",
      parent: scopeNodeId,
      children: [],
      contributors: [],
      status: "active",
    });
    await NodeModel.updateOne({ _id: scopeNodeId }, { $addToSet: { children: created._id } });
  }

  // Stamp role + mode. role marker makes the node structural for the
  // kernel's beforeNodeDelete guard. mode assignment routes visits to
  // Foreman; the actual Foreman reasoning surface lands in Pass 2.
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
        role: "execution",
        scopeRulerId: String(scopeNodeId),
        createdAt: existingMeta?.createdAt || new Date().toISOString(),
      });
      if (existingModes?.plan !== "tree:governing-foreman") {
        await kernelSetExtMeta(node, "modes", {
          ...(existingModes || {}),
          plan: "tree:governing-foreman",
        });
      }
    }
  } catch (err) {
    log.warn("Governing", `failed to stamp execution-node role marker: ${err.message}`);
  }

  return created;
}

/**
 * Find the execution-node child of a Ruler scope. Returns null when
 * absent (caller should call ensureExecutionNode first).
 */
export async function findExecutionNode(scopeNodeId) {
  if (!scopeNodeId) return null;
  return Node.findOne({
    parent: scopeNodeId,
    type: "execution",
  }).select("_id name parent type children metadata").lean();
}
