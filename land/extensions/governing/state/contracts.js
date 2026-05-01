// Governing contracts API. Implements the Ruler/Plan/Contracts trio:
// the Contractor's emission lives on a contracts-type CHILD NODE of
// the Ruler scope (sibling of the plan-type node, both work-shaped
// emissions); the Ruler scope itself holds an approval ledger that
// references contracts by `<nodeId>:<contractId>`. Updates produce
// new contract ids with a `supersedes` chain; the Ruler's approval
// log records each ratification with a status and optional reason.
//
// See project_contracts_node_architecture.md for the model. This
// replaces the previous shape (metadata.plan.contracts on the plan
// node) which conflated emission with approval and could not express
// versioning or rejection history.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { validateScopeAuthority } from "./lca.js";
import {
  ensureContractsNode,
  readContractsMap,
  readApprovalLedger,
  parseContractRef,
  buildContractRef,
} from "./contractsNode.js";

const NS = "governing";

/**
 * Resolve the plan extension lazily for ancestor-chain walking.
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
 * Generate a stable id for a contract entry. Uses the existing id if
 * present; otherwise constructs `<kind>:<name>` (legacy format) plus a
 * version suffix when a previous entry with the same root id exists.
 */
function deriveContractId(entry, existingMap) {
  if (entry.id) return String(entry.id);
  const root = `${entry.namespace || entry.kind || "contract"}:${entry.name || "unnamed"}`;
  if (!existingMap[root]) return root;
  // Bump version suffix until unique.
  let v = 2;
  while (existingMap[`${root}:v${v}`]) v++;
  return `${root}:v${v}`;
}

/**
 * Structural fingerprint of a contract (for idempotency checks). Two
 * contracts with the same kind/name/scope/details represent the same
 * vocabulary; re-emitting them should NOT bump the version chain. The
 * fingerprint excludes derived/timestamp fields that change every call
 * (`emittedAt`, `emittedBy`, `id`, `supersedes`).
 */
function structuralFingerprint(entry) {
  const scope = entry.scope === "global" || typeof entry.scope === "string"
    ? entry.scope
    : (entry.scope ? JSON.stringify(entry.scope) : null);
  const details = entry.details == null
    ? null
    : (typeof entry.details === "string" ? entry.details : JSON.stringify(entry.details));
  return JSON.stringify({
    kind: entry.kind || entry.namespace || null,
    name: entry.name || null,
    scope,
    details,
  });
}

/**
 * Find the active version of a contract by structural fingerprint.
 * Returns the matching contract entry from existingMap (if any), where
 * "active" means the contract is not superseded by a later entry with
 * the same root id. Used to short-circuit idempotent re-emissions:
 * setContracts called twice with the same input should be a no-op on
 * the second call rather than producing a v2 entry.
 */
function findActiveByFingerprint(entry, existingMap) {
  const target = structuralFingerprint(entry);
  for (const existing of Object.values(existingMap)) {
    if (structuralFingerprint(existing) === target) return existing;
  }
  return null;
}

/**
 * Atomic write of metadata.governing.contracts on the contracts node.
 * Merges the incoming entries with whatever's already there. Each entry
 * is preserved by id; newer versions appear alongside older ones (no
 * overwrite of prior versions).
 */
async function writeContractsToNode(contractsNodeId, additions) {
  const node = await Node.findById(contractsNodeId);
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  const existing = (meta?.contracts && typeof meta.contracts === "object") ? meta.contracts : {};
  const merged = { ...existing, ...additions };

  const next = {
    ...(meta || {}),
    contracts: merged,
    updatedAt: new Date().toISOString(),
  };

  const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
  await kernelSetExtMeta(node, NS, next);
  return next;
}

/**
 * Atomic append of approval entries to metadata.governing.contractApprovals
 * on the Ruler scope node. Read-modify-write (no atomic $push for nested
 * fields without losing the rest of the namespace) — short window of
 * contention is acceptable since each Ruler scope has one Contractor
 * emission per cycle.
 */
async function appendApprovalsAtRuler(rulerNodeId, approvals) {
  if (!Array.isArray(approvals) || approvals.length === 0) return null;
  const node = await Node.findById(rulerNodeId);
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  const existing = Array.isArray(meta?.contractApprovals) ? meta.contractApprovals : [];
  const next = {
    ...(meta || {}),
    contractApprovals: [...existing, ...approvals],
  };

  const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
  await kernelSetExtMeta(node, NS, next);
  return next;
}

/**
 * Persist contracts emitted by a Contractor at a Ruler scope.
 *
 * Effect:
 *   1. Find or create the contracts-type child of scopeNodeId.
 *   2. For each incoming contract: derive an id (or use the entry's id),
 *      validate scope authority via LCA when consumerNodeIds are present,
 *      and merge into the contracts node's metadata.governing.contracts.
 *   3. Append approval entries to scopeNodeId's metadata.governing
 *      .contractApprovals — one per accepted contract, with status
 *      "approved" and a supersedes ref if the entry replaces a prior
 *      contract.
 *   4. Fire governing:contractRatified.
 *
 * Returns:
 *   { contractsNode, accepted, rejected }
 *
 * `accepted` carries each entry as it was written (with derived id and
 * supersedes ref). `rejected` carries entries that failed LCA validation
 * with a `_rejectionReason` field; rejected entries are NOT persisted
 * and DO NOT receive an approval entry.
 *
 * Caller resolves scope names to consumerNodeIds before calling. Without
 * consumerNodeIds, LCA validation is skipped (back-compat; older callers
 * just trust the scope text). LCA validation runs when consumerNodeIds
 * has 2+ entries.
 */
export async function setContracts({ scopeNodeId, contracts, userId, systemSpec = null, core }) {
  if (!scopeNodeId) return null;

  const incoming = Array.isArray(contracts) ? contracts : [];
  if (incoming.length === 0) {
    return { contractsNode: null, accepted: [], rejected: [] };
  }

  // Find or create the contracts-type child of the Ruler scope.
  let contractsNode = null;
  try {
    contractsNode = await ensureContractsNode({ scopeNodeId, userId, core });
  } catch (err) {
    log.warn("Governing", `setContracts: ensureContractsNode failed at scope ${String(scopeNodeId).slice(0, 8)}: ${err.message}`);
    return null;
  }
  if (!contractsNode) {
    log.warn("Governing", `setContracts: no contracts node resolvable at scope ${String(scopeNodeId).slice(0, 8)}`);
    return null;
  }

  // Read existing contracts map so derived ids don't collide and we
  // can detect supersedes relationships when callers pass an entry
  // that updates a prior id.
  const existingMap = readContractsMap(contractsNode);

  const additions = {};
  const accepted = [];
  const rejected = [];
  const approvals = [];
  const ratifiedAt = new Date().toISOString();

  const skipped = [];
  for (const entry of incoming) {
    if (!entry || typeof entry !== "object") continue;

    // Idempotency: if an active contract with identical structural
    // shape already exists, skip without bumping the version chain.
    // This protects against double-write when (a) a tool persists and
    // (b) a synthesized [[CONTRACTS]] block downstream re-parses the
    // same data. Without this, every Contractor cycle that emits the
    // same vocabulary twice would produce :v2/:v3 entries with no
    // semantic change.
    const existingMatch = findActiveByFingerprint(entry, { ...existingMap, ...additions });
    if (existingMatch) {
      skipped.push({ ...entry, _existingId: existingMatch.id });
      continue;
    }

    // LCA validation when consumerNodeIds are present and scope is shared.
    const scopeShape = entry.scope;
    const consumers = Array.isArray(entry.consumerNodeIds) ? entry.consumerNodeIds : [];
    if (consumers.length >= 2 && scopeShape && typeof scopeShape === "object") {
      const result = await validateScopeAuthority({
        emitterNodeId: scopeNodeId,
        consumerNodeIds: consumers,
      });
      if (!result.valid) {
        rejected.push({ ...entry, _rejectionReason: result.reason });
        continue;
      }
    }

    const id = deriveContractId(entry, { ...existingMap, ...additions });
    const supersedesRef = entry.supersedes || null;

    const stored = {
      id,
      kind: entry.kind || entry.namespace || "contract",
      namespace: entry.namespace || entry.kind || "contract",
      name: entry.name || id,
      scope: entry.scope || "global",
      details: entry.details || entry.raw || null,
      values: entry.values || {},
      fields: entry.fields || [],
      consumerNodeIds: consumers,
      emittedBy: systemSpec ? String(systemSpec).slice(0, 200) : null,
      emittedAt: ratifiedAt,
      supersedes: supersedesRef,
    };
    additions[id] = stored;
    accepted.push(stored);

    approvals.push({
      contractRef: buildContractRef(contractsNode._id, id),
      approvedAt: ratifiedAt,
      status: "approved",
      supersedes: supersedesRef
        ? buildContractRef(contractsNode._id, supersedesRef)
        : null,
    });
  }

  if (Object.keys(additions).length > 0) {
    await writeContractsToNode(contractsNode._id, additions);
  }
  if (approvals.length > 0) {
    await appendApprovalsAtRuler(scopeNodeId, approvals);
  }

  if (rejected.length > 0 || skipped.length > 0) {
    log.verbose(
      "Governing",
      `setContracts at ${String(scopeNodeId).slice(0, 8)}: ${accepted.length} accepted, ` +
      `${rejected.length} rejected, ${skipped.length} skipped (idempotent)` +
      (rejected.length ? ` ${rejected.map((r) => `${r.namespace || "?"}/${r.name || "?"}: ${r._rejectionReason}`).join("; ")}` : ""),
    );
  }

  // Fire ratification hook for consumers (Pass 2 courts, workspace
  // hooks, etc.). Includes the resolved contracts node id so
  // downstream readers can fetch the canonical contract data.
  try {
    const { hooks } = await import("../../../seed/hooks.js");
    hooks.run("governing:contractRatified", {
      rulerNodeId: String(scopeNodeId),
      contractsNodeId: String(contractsNode._id),
      accepted,
      rejected,
      approvals,
    }).catch(() => {});
  } catch (err) {
    log.debug("Governing", `governing:contractRatified hook fire failed: ${err.message}`);
  }

  return { contractsNode, accepted, rejected, skipped };
}

/**
 * Resolve a single approval entry to its contract data. Reads the
 * contracts node referenced by the entry and pulls out the entry by
 * id. Returns null if the contract was deleted or the node is missing.
 */
async function resolveApproval(entry) {
  const parsed = parseContractRef(entry?.contractRef);
  if (!parsed) return null;
  const node = await Node.findById(parsed.nodeId).select("_id metadata").lean();
  if (!node) return null;
  const map = readContractsMap(node);
  const contract = map[parsed.contractId];
  if (!contract) return null;
  return contract;
}

/**
 * Read all contracts in force at a node's position. Walks up to find
 * Ruler scopes; for each Ruler, walks the approval ledger; resolves
 * each approved (non-superseded) ref to its contract data.
 *
 * "In force" means status === "approved" and not superseded by a later
 * approved entry in the same ledger. Rejected entries and superseded
 * versions are NOT returned by readContracts (Pass 2 courts will have
 * their own readers for the full audit chain).
 *
 * Order: contracts from the nearest Ruler first, root-most last.
 * Duplicate contract ids across different Rulers keep the nearest.
 *
 * Backward-compat: also reads the legacy metadata.plan.contracts shape
 * if present in the plan chain. Old data still surfaces while the
 * migration to the trio settles.
 */
export async function readContracts(nodeId) {
  if (!nodeId) return [];

  const out = [];
  const seenIds = new Set();

  // Walk up Ruler scopes, gathering approvals.
  const visited = new Set();
  let cursor = String(nodeId);
  for (let depth = 0; depth < 64; depth++) {
    if (!cursor || visited.has(cursor)) break;
    visited.add(cursor);
    const node = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!node) break;
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});
    const isRuler = meta[NS]?.role === "ruler";
    if (isRuler) {
      const ledger = readApprovalLedger(node);
      // Build a "superseded by" set so we skip ratified-but-superseded
      // entries. Each entry with `supersedes: <oldRef>` adds <oldRef>
      // to the superseded set.
      const superseded = new Set();
      for (const entry of ledger) {
        if (entry?.status === "approved" && entry.supersedes) {
          superseded.add(String(entry.supersedes));
        }
      }
      for (const entry of ledger) {
        if (entry?.status !== "approved") continue;
        if (superseded.has(String(entry.contractRef))) continue;
        const contract = await resolveApproval(entry);
        if (!contract) continue;
        const dedupeKey = String(contract.id || `${contract.kind}:${contract.name}`);
        if (seenIds.has(dedupeKey)) continue;
        seenIds.add(dedupeKey);
        out.push(contract);
      }
    }
    if (!node.parent) break;
    cursor = String(node.parent);
  }

  // Backward-compat: also surface legacy metadata.plan.contracts entries
  // from the plan chain. Pre-trio data still in production land trees
  // shows up alongside new-shape contracts. Once those trees migrate
  // (or the operator wipes), this branch becomes a no-op.
  try {
    const p = await planExt();
    if (p?.findGoverningPlanChain) {
      const chain = await p.findGoverningPlanChain(nodeId);
      for (const planNode of (chain || [])) {
        const planMeta = (planNode.metadata instanceof Map
          ? planNode.metadata.get("plan")
          : planNode.metadata?.plan) || {};
        const list = Array.isArray(planMeta.contracts) ? planMeta.contracts : [];
        for (const c of list) {
          const id = c.id || `${c.kind || c.namespace || "contract"}:${c.name || ""}`;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          out.push(c);
        }
      }
    }
  } catch (err) {
    log.debug("Governing", `legacy plan.contracts read skipped: ${err.message}`);
  }

  return out;
}

/**
 * Read the scoped slice of contracts visible to a specific consumer.
 * Walks via readContracts, then filters by scope:
 *
 *   scope === "global"                       → include
 *   scope.shared includes branchName         → include
 *   scope.local === branchName               → include
 *   anything else                            → exclude
 *
 * Result is what enrichContext renders into the Worker's prompt:
 * "your contracts, scoped to you."
 */
export async function readScopedContracts({ nodeId, branchName }) {
  const all = await readContracts(nodeId);
  if (!branchName) return all; // no consumer context → return everything
  const lower = String(branchName).trim().toLowerCase();
  return all.filter((c) => {
    const scope = c.scope || "global";
    if (scope === "global") return true;
    if (typeof scope !== "object") return true; // unrecognized → safe-default include
    if (Array.isArray(scope.shared)) {
      return scope.shared.some((b) => String(b).trim().toLowerCase() === lower);
    }
    if (scope.local) {
      return String(scope.local).trim().toLowerCase() === lower;
    }
    return true;
  });
}

/**
 * Read the full approval ledger at a Ruler scope, including superseded
 * and rejected entries. For Pass 2 courts that need the audit chain.
 */
export async function readApprovalsAtRuler(rulerNodeId) {
  if (!rulerNodeId) return [];
  const node = await Node.findById(rulerNodeId).select("_id metadata").lean();
  if (!node) return [];
  return readApprovalLedger(node);
}
