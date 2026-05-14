// Governing contracts API. Symmetric with plan emissions and
// execution records: each Contractor invocation produces a
// `contracts-emission-N` child node under the contracts trio
// member, immutable, with the contracts the Ruler ratified at that
// emission. The Ruler's metadata.governing.contractApprovals ledger
// holds ONE entry per emission (matching planApprovals /
// executionApprovals shape) with a supersedes chain for re-emission.
//
// Trio shape per Ruler scope:
//
//   ruler-node
//   ├── plan-node
//   │   └── plan-emission-N        (Planner's ring records)
//   ├── contracts-node
//   │   └── contracts-emission-N   (Contractor's ring records)
//   └── execution-node
//       └── execution-record-N     (Foreman's ring records)
//
// Each emission is immutable bark; the Ruler's per-role approval
// ledger picks the active version. Pass 2 courts read the audit
// chain — emission contents + approval supersedes ref — without
// having to reason about a mutable map.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { validateScopeAuthority } from "./lca.js";
import { ensureContractsNode } from "./contractsNode.js";

const NS = "governing";

// ─────────────────────────────────────────────────────────────────────
// FINGERPRINT (idempotency)
// ─────────────────────────────────────────────────────────────────────

/**
 * Structural fingerprint of a single contract. Excludes derived /
 * timestamp fields so re-emissions of the same vocabulary land as
 * a no-op.
 */
function contractFingerprint(entry) {
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
 * Structural fingerprint of an entire emission's contract SET. Two
 * emissions with the same contract set (in any order) produce the
 * same fingerprint; setContracts skips creating a new emission when
 * the active emission already carries the identical set.
 */
function emissionFingerprint(contracts) {
  const fps = (Array.isArray(contracts) ? contracts : [])
    .map(contractFingerprint)
    .sort();
  return JSON.stringify(fps);
}

// ─────────────────────────────────────────────────────────────────────
// EMISSION NODE CREATION
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the next emission ordinal under a contracts trio member.
 */
async function nextEmissionOrdinal(contractsNodeId) {
  const count = await Node.countDocuments({
    parent: contractsNodeId,
    type: "contracts-emission",
  });
  return count + 1;
}

/**
 * Create a contracts-emission-N child node under the contracts trio
 * member. Stamps role + the structured emission payload.
 */
async function createContractsEmission({ contractsNodeId, ordinal, payload, userId, core }) {
  // Slug derived from the Contractor's reasoning headline. Same
  // approach as plan-emission naming: descriptive at-a-glance, with
  // the numeric ordinal preserved in metadata for ordering.
  const { slugifyEmission } = await import("./slugifyEmission.js");
  const name = slugifyEmission(payload?.reasoning, ordinal);

  let created = null;
  try {
    if (core?.tree?.createNode) {
      created = await core.tree.createNode({
        parentId: String(contractsNodeId),
        name,
        type: "contracts-emission",
        userId,
        wasAi: true,
      });
    }
  } catch (err) {
    log.debug("Governing", `core.tree.createNode failed for contracts-emission: ${err.message}; falling back`);
  }

  if (!created) {
    const { default: NodeModel } = await import("../../../seed/models/node.js");
    const { v4: uuid } = await import("uuid");
    created = await NodeModel.create({
      _id: uuid(),
      name,
      type: "contracts-emission",
      parent: contractsNodeId,
      children: [],
      contributors: [],
      status: "active",
    });
    await NodeModel.updateOne({ _id: contractsNodeId }, { $addToSet: { children: created._id } });
  }

  try {
    const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
    const node = await Node.findById(created._id);
    if (node) {
      const existingMeta = node.metadata instanceof Map
        ? node.metadata.get(NS)
        : node.metadata?.[NS];
      await kernelSetExtMeta(node, NS, {
        ...(existingMeta || {}),
        role: "contracts-emission",
        emission: payload,
        ordinal: payload.ordinal,
        emittedAt: payload.emittedAt,
      });
    }
  } catch (err) {
    log.warn("Governing", `failed to stamp contracts-emission metadata: ${err.message}`);
  }

  return created;
}

// ─────────────────────────────────────────────────────────────────────
// APPROVAL LEDGER
// ─────────────────────────────────────────────────────────────────────

/**
 * Append ONE approval entry to metadata.governing.contractApprovals on
 * the Ruler scope. Symmetric with planApprovals/executionApprovals:
 * one entry per emission, references the emission node id.
 */
async function appendApproval({
  rulerNodeId,
  contractsEmissionNodeId,
  supersedes,
  // Inheritance ratification fields. Set when the approval is for an
  // inheritance declaration (child scope ratified that parent contracts
  // cover its plan). Same audit-trail shape as a full contract
  // emission ratification; Pass 2 courts read both the same way.
  inheritedFrom = null,
  parentContractsApplied = [],
}) {
  if (!rulerNodeId || !contractsEmissionNodeId) return null;
  const node = await Node.findById(rulerNodeId);
  if (!node) return null;

  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  const existing = Array.isArray(meta?.contractApprovals) ? meta.contractApprovals : [];

  const { v4: uuid } = await import("uuid");
  const approvalId = uuid();
  const entry = {
    id: approvalId,
    approvedAt: new Date().toISOString(),
    contractsRef: String(contractsEmissionNodeId),
    status: "approved",
    supersedes: supersedes || null,
    ...(inheritedFrom ? {
      inheritedFrom: String(inheritedFrom),
      parentContractsApplied: Array.isArray(parentContractsApplied)
        ? parentContractsApplied.map((s) => String(s)).slice(0, 50)
        : [],
    } : {}),
  };

  const next = {
    ...(meta || {}),
    contractApprovals: [...existing, entry],
  };

  const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
  await kernelSetExtMeta(node, NS, next);
  return entry;
}

/**
 * Read the executionApprovals-style ledger from a Ruler scope.
 */
function readApprovalLedger(rulerNode) {
  if (!rulerNode) return [];
  const meta = rulerNode.metadata instanceof Map
    ? rulerNode.metadata.get(NS)
    : rulerNode.metadata?.[NS];
  return Array.isArray(meta?.contractApprovals) ? meta.contractApprovals : [];
}

/**
 * Find the most recent active (non-superseded, approved) contract
 * approval at a Ruler scope. Returns the entry or null.
 */
async function readActiveContractApproval(rulerNodeId) {
  const node = await Node.findById(rulerNodeId).select("_id metadata").lean();
  if (!node) return null;
  const ledger = readApprovalLedger(node);
  if (!ledger.length) return null;
  const supersededSet = new Set();
  for (const entry of ledger) {
    if (entry?.status === "approved" && entry.supersedes) {
      supersededSet.add(String(entry.supersedes));
    }
  }
  for (let i = ledger.length - 1; i >= 0; i--) {
    const entry = ledger[i];
    if (entry?.status !== "approved") continue;
    if (supersededSet.has(String(entry.id))) continue;
    return entry;
  }
  return null;
}

/**
 * Read the active contracts emission at a Ruler scope. Walks the
 * approval ledger to find the active contractsRef, resolves to the
 * emission node, returns the emission payload (with `_emissionNodeId`
 * + `_approvalId` for callers that need the refs).
 */
export async function readActiveContractsEmission(rulerNodeId) {
  const active = await readActiveContractApproval(rulerNodeId);
  if (!active?.contractsRef) return null;
  const node = await Node.findById(active.contractsRef).select("_id metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  if (meta?.role !== "contracts-emission" || !meta?.emission) return null;
  return {
    ...meta.emission,
    _emissionNodeId: String(node._id),
    _approvalId: active.id || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API: setContracts
// ─────────────────────────────────────────────────────────────────────

/**
 * Persist contracts emitted by a Contractor at a Ruler scope.
 *
 * Flow:
 *   1. Find or create the contracts trio member.
 *   2. Validate each contract via LCA when consumerNodeIds are present.
 *   3. Compute the contract set's structural fingerprint. If it
 *      matches the active emission's, skip — idempotent re-emission.
 *   4. Create a contracts-emission-N child node with the accepted
 *      contracts in metadata.governing.emission.
 *   5. Append a single contractApproval entry to the Ruler scope,
 *      referencing the emission node id, with supersedes chain to
 *      the prior active approval.
 *   6. Fire governing:contractRatified.
 *
 * Returns:
 *   { contractsNode, emissionNode, accepted, rejected, skipped }
 *
 * `skipped` is non-empty when the entire emission was idempotent;
 * `emissionNode` is null in that case.
 */
export async function setContracts({
  scopeNodeId,
  contracts,
  userId,
  systemSpec = null,
  core,
  reasoning = null,
  // Inheritance declaration form. When inheritsFrom is set, the
  // emission represents "this child scope's contracts are the parent's"
  // rather than a list of new commitments. contracts may be empty.
  // The emission still materializes a node + approval ledger entry so
  // dispatch-execution sees a ratified state and Pass 2 courts have a
  // signed record of the inheritance decision.
  inheritsFrom = null,
  parentContractsApplied = [],
}) {
  if (!scopeNodeId) return null;

  const incoming = Array.isArray(contracts) ? contracts : [];
  const isInheritance = !!inheritsFrom;
  if (incoming.length === 0 && !isInheritance) {
    return { contractsNode: null, emissionNode: null, accepted: [], rejected: [], skipped: [] };
  }

  // Find or create the contracts trio member.
  let contractsNode = null;
  try {
    contractsNode = await ensureContractsNode({ scopeNodeId, userId, core });
  } catch (err) {
    log.warn("Governing", `setContracts: ensureContractsNode failed at scope ${String(scopeNodeId).slice(0, 8)}: ${err.message}`);
    return null;
  }
  if (!contractsNode) return null;

  // LCA validation pass.
  const accepted = [];
  const rejected = [];
  const ratifiedAt = new Date().toISOString();
  for (const entry of incoming) {
    if (!entry || typeof entry !== "object") continue;
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
    const id = entry.id || `${entry.kind || entry.namespace || "contract"}:${entry.name || "unnamed"}`;
    accepted.push({
      id,
      kind: entry.kind || entry.namespace || "contract",
      namespace: entry.namespace || entry.kind || "contract",
      name: entry.name || id,
      scope: entry.scope || "global",
      details: entry.details || entry.raw || null,
      rationale: entry.rationale || null,
      values: entry.values || {},
      fields: entry.fields || [],
      consumerNodeIds: consumers,
    });
  }

  if (accepted.length === 0 && !isInheritance) {
    return { contractsNode, emissionNode: null, accepted: [], rejected, skipped: [] };
  }

  // Idempotency: if the active emission's contract set matches this
  // one structurally, no new emission. The Ruler's existing approval
  // already covers this set. Inheritance declarations skip this check
  // — re-declaring inheritance is always a fresh decision.
  const priorActive = await readActiveContractsEmission(scopeNodeId);
  if (!isInheritance && accepted.length > 0) {
    const newFingerprint = emissionFingerprint(accepted);
    if (priorActive?.contracts && emissionFingerprint(priorActive.contracts) === newFingerprint) {
      log.verbose("Governing",
        `setContracts at ${String(scopeNodeId).slice(0, 8)}: ${accepted.length} contract(s) match active ` +
        `emission-${priorActive.ordinal}; skipping idempotent re-emission`);
      return {
        contractsNode,
        emissionNode: null,
        accepted: [],
        rejected,
        skipped: accepted.map((c) => ({ ...c, _existingEmissionOrdinal: priorActive.ordinal })),
      };
    }
  }

  // Materialize the new emission. Inheritance declarations carry an
  // empty contracts array plus inheritsFrom/parentContractsApplied
  // metadata so the emission node is self-describing.
  const ordinal = await nextEmissionOrdinal(contractsNode._id);
  const payload = {
    ordinal,
    emittedAt: ratifiedAt,
    reasoning: reasoning ? String(reasoning).slice(0, 800) : null,
    emittedBy: systemSpec ? String(systemSpec).slice(0, 200) : null,
    contracts: accepted,
    ...(isInheritance ? {
      inheritsFrom: String(inheritsFrom),
      parentContractsApplied: Array.isArray(parentContractsApplied)
        ? parentContractsApplied.map((s) => String(s)).slice(0, 50)
        : [],
    } : {}),
  };
  const emissionNode = await createContractsEmission({
    contractsNodeId: contractsNode._id,
    ordinal,
    payload,
    userId,
    core,
  });

  // Append the approval ledger entry. Supersedes the prior active.
  // Inheritance declarations get the inheritedFrom/parentContractsApplied
  // fields stamped on the approval entry too, so Pass 2 courts can read
  // the inheritance commitment without dereferencing the emission node.
  const approvalEntry = await appendApproval({
    rulerNodeId: scopeNodeId,
    contractsEmissionNodeId: emissionNode._id,
    supersedes: priorActive?._approvalId || null,
    inheritedFrom: isInheritance ? inheritsFrom : null,
    parentContractsApplied: isInheritance ? parentContractsApplied : [],
  });

  log.info("Governing",
    `📜 contracts-emission-${ordinal} ratified at ruler ${String(scopeNodeId).slice(0, 8)} ` +
    `(${accepted.length} contract(s); ${rejected.length} rejected)` +
    (priorActive ? ` [supersedes emission-${priorActive.ordinal}]` : ""));

  if (rejected.length > 0) {
    log.verbose("Governing",
      `setContracts rejections: ${rejected.map((r) => `${r.namespace || r.kind || "?"}/${r.name || "?"}: ${r._rejectionReason}`).join("; ")}`);
  }

  // Fire ratification hook.
  try {
    const { hooks } = await import("../../../seed/hooks.js");
    hooks.run("governing:contractRatified", {
      rulerNodeId: String(scopeNodeId),
      contractsNodeId: String(contractsNode._id),
      emissionNodeId: String(emissionNode._id),
      ordinal,
      accepted,
      rejected,
      approvalId: approvalEntry?.id || null,
    }).catch(() => {});
  } catch (err) {
    log.debug("Governing", `governing:contractRatified hook fire failed: ${err.message}`);
  }

  return { contractsNode, emissionNode, accepted, rejected, skipped: [] };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API: readContracts
// ─────────────────────────────────────────────────────────────────────

/**
 * Read all contracts in force at a node's position. Walks up Ruler
 * scopes; for each Ruler, reads the active contracts emission;
 * returns the union of contract entries.
 *
 * Order: contracts from the nearest Ruler first, root-most last.
 * Duplicate contract ids across different Rulers keep the nearest.
 */
export async function readContracts(nodeId) {
  if (!nodeId) return [];

  const out = [];
  const seenIds = new Set();
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
      const emission = await readActiveContractsEmission(cursor);
      if (emission?.contracts) {
        for (const c of emission.contracts) {
          const id = String(c.id || `${c.kind}:${c.name}`);
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          out.push(c);
        }
      }
    }
    if (!node.parent) break;
    cursor = String(node.parent);
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
 */
export async function readScopedContracts({ nodeId, branchName }) {
  const all = await readContracts(nodeId);
  if (!branchName) return all;
  const lower = String(branchName).trim().toLowerCase();
  return all.filter((c) => {
    const scope = c.scope || "global";
    if (scope === "global") return true;
    if (typeof scope !== "object") return true;
    if (Array.isArray(scope.shared)) {
      return scope.shared.some((b) => String(b).trim().toLowerCase() === lower);
    }
    if (scope.local) {
      const locals = Array.isArray(scope.local) ? scope.local : [scope.local];
      return locals.some((b) => String(b).trim().toLowerCase() === lower);
    }
    return true;
  });
}

/**
 * Read the full approval ledger at a Ruler scope. Includes superseded
 * and rejected entries — Pass 2 courts read this for the audit chain.
 */
export async function readApprovalsAtRuler(rulerNodeId) {
  if (!rulerNodeId) return [];
  const node = await Node.findById(rulerNodeId).select("_id metadata").lean();
  if (!node) return [];
  return readApprovalLedger(node);
}
