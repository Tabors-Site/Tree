// Plan trio member primitive. governing owns the plan-type node
// directly — Phase F absorbed the standalone plan extension into
// governing, restoring symmetry with contracts-type and execution-type
// nodes (which governing already created directly).
//
// Trio shape per Ruler scope:
//
//   ruler-node
//   ├── plan-node         (THIS file owns creation + role + mode)
//   │   └── plan-emission-N      (Planner ring; planApprovals.js)
//   ├── contracts-node
//   │   └── contracts-emission-N
//   └── execution-node
//       └── execution-record-N
//
// metadata.plan namespace on plan-type nodes:
//   { createdAt, updatedAt, _writeSeq, systemSpec, ledger: [...] }
//
// _writeSeq is a CAS token — every successful mutate stamps a fresh
// UUID and conditional updates require it to still match what was
// read. ledger is an append-only journal of plan-creation/dispatch
// events; capped at LEDGER_CAP.
//
// All writes serialize via mutatePlan (read-modify-write with CAS
// retry). Other extensions read via readPlan(nodeId) and never
// touch metadata.plan directly.

import crypto from "crypto";
import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { readNs } from "../../../seed/tree/extensionMetadata.js";

const NS = "plan";
const LEDGER_CAP = 500;

export const DEFAULT_BUDGET = Object.freeze({
  turnsPerStep: 20,
  retriesPerBranch: 1,
  depthAllocation: 1,
});

export { NS };

// ─────────────────────────────────────────────────────────────────────
// LOW-LEVEL HELPERS
// ─────────────────────────────────────────────────────────────────────

function readMeta(node) {
  return readNs(node, NS);
}

function emptyPlan() {
  const nowIso = new Date().toISOString();
  return {
    createdAt: nowIso,
    updatedAt: nowIso,
    systemSpec: null,
    ledger: [],
  };
}

/**
 * Read-modify-write the plan namespace atomically. CAS retry on
 * concurrent writes via the _writeSeq token.
 */
async function mutatePlan(nodeId, mutator) {
  if (!nodeId || typeof mutator !== "function") return null;
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const node = await Node.findById(nodeId).lean();
      if (!node) return null;
      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      const current = meta[NS] || null;
      const expectedSeq = current?._writeSeq || null;
      const baseDraft = current ? JSON.parse(JSON.stringify(current)) : emptyPlan();
      const out = mutator(baseDraft) || baseDraft;
      out.updatedAt = new Date().toISOString();
      out._writeSeq = crypto.randomUUID();

      const filter = expectedSeq
        ? { _id: nodeId, [`metadata.${NS}._writeSeq`]: expectedSeq }
        : { _id: nodeId, [`metadata.${NS}._writeSeq`]: { $in: [null] } };
      const result = await Node.updateOne(
        filter,
        { $set: { [`metadata.${NS}`]: out } },
      );
      if (result.matchedCount > 0) {
        try {
          const { invalidateNode } = await import("../../../seed/tree/ancestorCache.js");
          invalidateNode(String(nodeId));
        } catch {}
        try {
          const { hooks } = await import("../../../seed/hooks.js");
          hooks.run("afterMetadataWrite", { nodeId, extName: NS, data: out }).catch(() => {});
        } catch {}
        return out;
      }
      log.debug("Governing", `mutatePlan ${nodeId} CAS retry ${attempt + 1}/${MAX_RETRIES}`);
    } catch (err) {
      log.warn("Governing", `mutatePlan ${nodeId} failed: ${err.message}`);
      return null;
    }
  }
  log.warn("Governing", `mutatePlan ${nodeId} gave up after ${MAX_RETRIES} retries (high contention)`);
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the plan-type node's metadata. Walks up via findGoverningPlan,
 * then returns metadata.plan or null.
 */
export async function readPlan(nodeId) {
  if (!nodeId) return null;
  try {
    const planNode = await findGoverningPlan(nodeId);
    return planNode ? readMeta(planNode) : null;
  } catch {
    return null;
  }
}

/**
 * Initialize (or reinitialize) the plan namespace on a node. Stamps
 * createdAt + systemSpec if absent. Does not touch ledger.
 */
export async function initPlan(nodeId, { systemSpec = null } = {}) {
  if (!nodeId) return null;
  return mutatePlan(nodeId, (draft) => {
    if (!draft.createdAt) draft.createdAt = new Date().toISOString();
    if (systemSpec) draft.systemSpec = systemSpec;
    if (!Array.isArray(draft.ledger)) draft.ledger = [];
    return draft;
  });
}

/**
 * Append an entry to the plan node's ledger. Free-form append-only
 * journal of plan-level events (plan-created, plan-dispatched, etc.).
 * Capped at LEDGER_CAP; oldest entries drop.
 */
export async function appendLedger(nodeId, entry) {
  if (!nodeId || !entry?.event) return null;
  return mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.ledger)) draft.ledger = [];
    draft.ledger.push({
      at: new Date().toISOString(),
      event: String(entry.event),
      detail: entry.detail || null,
    });
    if (draft.ledger.length > LEDGER_CAP) {
      draft.ledger.splice(0, draft.ledger.length - LEDGER_CAP);
    }
    return draft;
  });
}

/**
 * Create a plan-type node as a child of the given parent.
 * Initializes metadata.plan and stamps the plan-created ledger entry.
 *
 * Structural invariant: a plan-type node cannot be a direct child of
 * another plan-type node.
 */
export async function createPlanNode({
  parentNodeId,
  userId,
  name,
  systemSpec = null,
  wasAi = false,
  chatId = null,
  sessionId = null,
} = {}) {
  if (!parentNodeId) throw new Error("createPlanNode requires parentNodeId");
  if (!userId) throw new Error("createPlanNode requires userId");
  if (!name || !String(name).trim()) throw new Error("createPlanNode requires name");

  const parentDoc = await Node.findById(parentNodeId).select("_id type").lean();
  if (!parentDoc) throw new Error(`createPlanNode: parent ${parentNodeId} not found`);
  if (parentDoc.type === "plan") {
    throw new Error(
      `createPlanNode: cannot nest plan-type nodes — a scope node must sit between two plans (${parentNodeId})`,
    );
  }

  const { createNode } = await import("../../../seed/tree/treeManagement.js");
  const planNode = await createNode({
    name: String(name).trim(),
    parentId: String(parentNodeId),
    type: "plan",
    userId,
    wasAi,
    chatId,
    sessionId,
  });

  await initPlan(planNode._id, { systemSpec });
  await appendLedger(planNode._id, {
    event: "plan-created",
    detail: {
      parentNodeId: String(parentNodeId),
      systemSpec: systemSpec ? String(systemSpec).slice(0, 200) : null,
    },
  });

  // Orphan plan diagnostic.
  try {
    const siblingPlans = await Node.find({
      parent: parentNodeId,
      type: "plan",
      _id: { $ne: planNode._id },
    }).select("_id name").lean();
    if (siblingPlans.length > 0) {
      log.warn("Governing",
        `🪦 Orphan plan(s) detected: ${siblingPlans.length} prior plan-type sibling(s) under parent ` +
        `${String(parentNodeId).slice(0, 8)}: ${siblingPlans.map((p) => `"${p.name}"`).join(", ")}. ` +
        `Operator should archive or merge orphans.`);
    }
  } catch {}

  return planNode;
}

/**
 * Find or create the plan-type child of a Ruler scope, then stamp
 * governing's role marker and Planner mode assignment on it.
 *
 * Idempotent: re-entering a scope with an existing plan node returns
 * it; the role + mode stamps merge-update so re-stamping is safe.
 *
 * Scope MUST be the Ruler scope (not the plan-type node itself).
 * Caller resolves Ruler via governing.findRulerScope or runRulerCycle's
 * promote+ensure flow.
 */
export async function ensurePlanAtScope({
  scopeNodeId,
  userId,
  name = "plans",
  systemSpec = null,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (!scopeNodeId) return null;

  const scopeNode = await Node.findById(scopeNodeId).select("_id name type").lean();
  if (!scopeNode) return null;
  if (scopeNode.type === "plan") return scopeNode;

  // Find existing.
  let planNode = await Node.findOne({
    parent: scopeNodeId,
    type: "plan",
  }).select("_id name parent type metadata").lean();

  if (!planNode) {
    if (!userId) {
      throw new Error("ensurePlanAtScope requires userId to create a plan-type child");
    }
    try {
      planNode = await createPlanNode({
        parentNodeId: String(scopeNodeId),
        userId,
        name,
        systemSpec,
        wasAi, chatId, sessionId,
      });
    } catch (err) {
      // Race protection: unique partial index on (parent, type='plan')
      // makes parallel creates fail E11000; the loser re-reads.
      if (err?.code === 11000 || /E11000|duplicate key/i.test(err?.message || "")) {
        planNode = await Node.findOne({
          parent: scopeNodeId,
          type: "plan",
        }).select("_id name parent type metadata").lean();
        if (!planNode) throw err;
      } else {
        throw err;
      }
    }
  }

  // Stamp governing role marker and per-node Planner mode assignment.
  // Role marker triggers the kernel's beforeNodeDelete guard. Mode
  // assignment routes "cd plan; chat" to Planner.
  try {
    const node = await Node.findById(planNode._id);
    if (!node) return planNode;

    const existingMeta = node.metadata instanceof Map
      ? node.metadata.get("governing")
      : node.metadata?.governing;
    const existingModes = node.metadata instanceof Map
      ? node.metadata.get("modes")
      : node.metadata?.modes;

    const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");

    await kernelSetExtMeta(node, "governing", {
      ...(existingMeta || {}),
      role: "plan",
      scopeRulerId: String(scopeNodeId),
      createdAt: existingMeta?.createdAt || new Date().toISOString(),
    });

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

// ─────────────────────────────────────────────────────────────────────
// WALK-UP HELPERS
// ─────────────────────────────────────────────────────────────────────

/**
 * Find the plan-type node that governs the given node's work.
 *
 * Walk semantics (nearest-first):
 *   1. Self IS a plan-type node → return it.
 *   2. Self has a plan-type child → return it.
 *   3. Walk up; nearest ancestor's plan-type child wins.
 *
 * Returns a lean node `{ _id, type, name, parent, metadata }` or null.
 */
export async function findGoverningPlan(nodeId) {
  if (!nodeId) return null;
  const id = String(nodeId);

  try {
    const self = await Node.findById(id).select("_id type name parent metadata").lean();
    if (!self) return null;
    if (self.type === "plan") return self;

    const { getAncestorChain } = await import("../../../seed/tree/ancestorCache.js");
    const chain = await getAncestorChain(id);
    if (!chain || chain.length === 0) return null;
    const scopeIds = chain.map((n) => n._id);

    const plans = await Node.find({
      parent: { $in: scopeIds },
      type: "plan",
    })
      .select("_id type name parent metadata")
      .lean();

    if (plans.length === 0) return null;

    for (let i = 0; i < chain.length; i++) {
      const scopeId = String(chain[i]._id);
      const match = plans.find((p) => String(p.parent) === scopeId);
      if (match) return match;
    }
    return null;
  } catch (err) {
    log.debug("Governing", `findGoverningPlan(${id}) failed: ${err.message}`);
    return null;
  }
}

/**
 * Return the chain of plan-type nodes from the starting node's scope
 * up to the outermost plan. Nearest-first ordering.
 */
export async function findGoverningPlanChain(nodeId) {
  const chain = [];
  const visited = new Set();
  let current = nodeId;
  for (let hop = 0; hop < 32; hop++) {
    const plan = await findGoverningPlan(current);
    if (!plan) break;
    const planId = String(plan._id);
    if (visited.has(planId)) break;
    visited.add(planId);
    chain.push(plan);
    if (!plan.parent) break;
    const scopeParent = await Node.findById(plan.parent).select("parent").lean();
    if (!scopeParent?.parent) break;
    current = String(scopeParent.parent);
  }
  return chain;
}
