// Prune Core
//
// Identifies dead nodes, absorbs their essence, trims them.
//
// A node is a prune candidate when ALL of these are true:
// - No visits in dormancyThresholdDays (default 90)
// - No cascade signals received or originated
// - No codebook entries referencing it
// - No contradictions referencing it
// - No other nodes linking to it in metadata
// - Not a system node
// - Not the tree root
// - Status is "active" (already trimmed/completed nodes are not candidates)
//
// The scan writes candidates to metadata.prune.candidates on the tree root.
// Confirmation trims each one after an optional AI absorption pass.

import log from "../../seed/log.js";
import { getExtension } from "../loader.js";

let Node = null;
let Contribution = null;
let Note = null;
let logContribution = null;
let runChat = null;
let useEnergy = async () => ({ energyUsed: 0 });
let _metadata = null;

export function setServices({ models, contributions, llm, energy, metadata }) {
  Node = models.Node;
  Contribution = models.Contribution;
  Note = models.Note;
  logContribution = contributions.logContribution;
  runChat = llm.runChat;
  if (energy?.useEnergy) useEnergy = energy.useEnergy;
  if (metadata) _metadata = metadata;
}

function getDormancyDays() {
  try {
    const { getLandConfigValue } = require("../../seed/landConfig.js");
    return Number(getLandConfigValue("pruneDormancyDays")) || 90;
  } catch {
    return 90;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SCAN: identify dead nodes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scan a tree for prune candidates.
 * Returns the list and writes it to metadata.prune.candidates on the root.
 */
export async function scanForCandidates(rootId, userId) {
  await useEnergy({ userId, action: "pruneScan" });

  const dormancyMs = getDormancyDays() * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - dormancyMs);

  // Get all nodes in this tree
  const nodes = await Node.find({ rootOwner: rootId, status: "active" })
    .select("_id name parent children systemRole metadata dateCreated")
    .lean();

  if (nodes.length === 0) return [];

  // Get recent contributions for all nodes in this tree
  const nodeIds = nodes.map(n => n._id.toString());
  const recentContribs = await Contribution.find({
    nodeId: { $in: nodeIds },
    date: { $gte: cutoff },
  }).select("nodeId").lean();

  const activeNodeIds = new Set(recentContribs.map(c => c.nodeId.toString()));

  // Get recent notes
  const recentNotes = await Note.find({
    nodeId: { $in: nodeIds },
    dateCreated: { $gte: cutoff },
  }).select("nodeId").lean();

  for (const n of recentNotes) activeNodeIds.add(n.nodeId.toString());

  // Check optional signal sources
  const cascadeActivity = await getCascadeActivity(rootId, nodeIds, cutoff);
  const codebookRefs = await getCodebookReferences(rootId, nodeIds);
  const contradictionRefs = await getContradictionReferences(rootId, nodeIds);

  // Build candidates list
  const candidates = [];

  for (const node of nodes) {
    const id = node._id.toString();

    // Skip root, system nodes
    if (id === rootId) continue;
    if (node.systemRole) continue;

    // Skip nodes with recent activity
    if (activeNodeIds.has(id)) continue;

    // Skip nodes with cascade activity
    if (cascadeActivity.has(id)) continue;

    // Skip nodes referenced by codebook
    if (codebookRefs.has(id)) continue;

    // Skip nodes referenced by contradictions
    if (contradictionRefs.has(id)) continue;

    // Skip nodes with children that are still active
    const hasActiveChild = (node.children || []).some(childId =>
      activeNodeIds.has(childId.toString())
    );
    if (hasActiveChild) continue;

    candidates.push({
      nodeId: id,
      name: node.name,
      parentId: node.parent?.toString() || null,
      createdAt: node.dateCreated,
      childCount: (node.children || []).length,
    });
  }

  // Write candidates to root metadata
  const root = await Node.findById(rootId);
  if (root) {
    const pruneMeta = _metadata.getExtMeta(root, "prune");
    pruneMeta.candidates = candidates;
    pruneMeta.lastScanAt = new Date().toISOString();
    pruneMeta.dormancyDays = getDormancyDays();
    await _metadata.setExtMeta(root, "prune", pruneMeta);
  }

  log.verbose("Prune", `Scanned tree ${rootId}: ${candidates.length} candidate(s) from ${nodes.length} nodes`);
  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIRM: absorb and trim
// ─────────────────────────────────────────────────────────────────────────

/**
 * Execute pruning on all candidates. For each:
 * 1. Ask the AI if anything is worth preserving
 * 2. If yes, absorb the fact into parent's metadata
 * 3. Set status to "trimmed"
 * 4. Log as contribution
 */
export async function confirmPrune(rootId, userId, username) {
  const root = await Node.findById(rootId);
  if (!root) throw new Error("Tree not found");

  const pruneMeta = _metadata.getExtMeta(root, "prune");
  const candidates = pruneMeta.candidates || [];
  if (candidates.length === 0) return { pruned: 0, absorbed: 0 };

  let pruned = 0;
  let absorbed = 0;

  for (const candidate of candidates) {
    try {
      const result = await pruneNode(candidate, rootId, userId, username);
      pruned++;
      if (result.absorbed) absorbed++;
    } catch (err) {
      log.warn("Prune", `Failed to prune ${candidate.name} (${candidate.nodeId}): ${err.message}`);
    }
  }

  // Clear candidates
  pruneMeta.candidates = [];
  pruneMeta.lastPruneAt = new Date().toISOString();
  if (!pruneMeta.history) pruneMeta.history = [];
  pruneMeta.history.push({
    date: new Date().toISOString(),
    pruned,
    absorbed,
    userId,
  });
  // Cap history
  if (pruneMeta.history.length > 50) {
    pruneMeta.history = pruneMeta.history.slice(-50);
  }
  await _metadata.setExtMeta(root, "prune", pruneMeta);

  log.info("Prune", `Pruned ${pruned} node(s) from tree ${rootId} (${absorbed} absorbed)`);
  return { pruned, absorbed };
}

async function pruneNode(candidate, rootId, userId, username) {
  const node = await Node.findById(candidate.nodeId)
    .select("_id name parent status metadata")
    .lean();

  if (!node || node.status === "trimmed") return { absorbed: false };

  // Energy for absorption check
  try {
    await useEnergy({ userId, action: "pruneAbsorb" });
  } catch {
    // No energy, skip absorption, just trim
    await trimNode(candidate.nodeId, userId);
    return { absorbed: false };
  }

  // Get the node's content for the AI to evaluate
  const notes = await Note.find({ nodeId: candidate.nodeId })
    .select("content")
    .sort({ dateCreated: -1 })
    .limit(5)
    .lean();

  const contentSummary = notes.map(n => n.content?.slice(0, 500)).filter(Boolean).join("\n---\n");
  let didAbsorb = false;

  if (contentSummary) {
    // Ask the AI: is anything here worth preserving?
    try {
      const result = await runChat({
        userId,
        username,
        message:
          `This node "${node.name}" is being pruned (no activity in ${getDormancyDays()} days). ` +
          `Here is its content:\n\n${contentSummary.slice(0, 2000)}\n\n` +
          `Is there one essential fact or insight worth preserving? ` +
          `If yes, respond with just that fact in one sentence. If no, respond with "nothing".`,
        mode: "tree:respond",
        rootId,
      });

      const answer = result?.answer?.trim();
      if (answer && answer.toLowerCase() !== "nothing" && answer.length < 500) {
        // Absorb into parent
        const parent = await Node.findById(node.parent);
        if (parent) {
          const parentPrune = _metadata.getExtMeta(parent, "prune");
          if (!parentPrune.absorbed) parentPrune.absorbed = {};
          parentPrune.absorbed[node.name || candidate.nodeId] = {
            fact: answer,
            absorbedAt: new Date().toISOString(),
            originalNodeId: candidate.nodeId,
          };
          await _metadata.setExtMeta(parent, "prune", parentPrune);
          didAbsorb = true;
        }
      }
    } catch (err) {
      log.debug("Prune", `Absorption check failed for ${node.name}: ${err.message}`);
    }
  }

  // Trim the node
  await trimNode(candidate.nodeId, userId);

  // Log contribution
  await logContribution({
    userId,
    nodeId: candidate.nodeId,
    wasAi: true,
    action: "prune:trimmed",
    extensionData: {
      prune: {
        nodeName: node.name,
        absorbed: didAbsorb,
        dormancyDays: getDormancyDays(),
      },
    },
  });

  return { absorbed: didAbsorb };
}

async function trimNode(nodeId, userId) {
  await Node.updateOne({ _id: nodeId }, { $set: { status: "trimmed" } });
}

// ─────────────────────────────────────────────────────────────────────────
// UNDO: restore a pruned node
// ─────────────────────────────────────────────────────────────────────────

export async function undoPrune(nodeId, userId) {
  const node = await Node.findById(nodeId).select("status name").lean();
  if (!node) throw new Error("Node not found");
  if (node.status !== "trimmed") throw new Error("Node is not trimmed");

  await Node.updateOne({ _id: nodeId }, { $set: { status: "active" } });

  await logContribution({
    userId,
    nodeId,
    wasAi: false,
    action: "prune:restored",
  });

  log.verbose("Prune", `Restored pruned node ${node.name} (${nodeId})`);
  return { restored: true, name: node.name };
}

// ─────────────────────────────────────────────────────────────────────────
// PURGE: permanent removal of long-trimmed nodes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Purge nodes that have been trimmed past the grace period.
 * This is permanent. The data is deleted from the database.
 * Only runs if purgeGraceDays is set in land config (default: off).
 */
export async function purge(rootId, userId) {
  let graceDays;
  try {
    const { getLandConfigValue } = await import("../../seed/landConfig.js");
    graceDays = Number(getLandConfigValue("purgeGraceDays"));
  } catch (err) {
    log.debug("Prune", "Failed to read purgeGraceDays config:", err.message);
  }

  if (!graceDays || graceDays <= 0) {
    throw new Error("Purge is disabled. Set purgeGraceDays in land config to enable.");
  }

  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs);

  // Find trimmed nodes in this tree older than the grace period
  const trimmed = await Node.find({
    rootOwner: rootId,
    status: "trimmed",
    dateCreated: { $lt: cutoff },
  }).select("_id name").lean();

  if (trimmed.length === 0) return { purged: 0 };

  // Delete notes, contributions, then nodes
  const ids = trimmed.map(n => n._id);
  await Note.deleteMany({ nodeId: { $in: ids } });
  await Contribution.deleteMany({ nodeId: { $in: ids } });
  await Node.deleteMany({ _id: { $in: ids } });

  // Remove from parent children arrays
  for (const t of trimmed) {
    await Node.updateMany(
      { children: t._id },
      { $pull: { children: t._id } },
    );
  }

  log.info("Prune", `Purged ${trimmed.length} node(s) from tree ${rootId} (past ${graceDays}-day grace period)`);

  return { purged: trimmed.length, names: trimmed.map(n => n.name) };
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL SOURCE HELPERS (optional extensions)
// ─────────────────────────────────────────────────────────────────────────

async function getCascadeActivity(rootId, nodeIds, cutoff) {
  const active = new Set();
  try {
    // Check .flow for recent cascade results involving these nodes
    const flowNode = await Node.findOne({ systemRole: "flow" }).select("_id").lean();
    if (!flowNode) return active;

    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const partitions = await Node.find({
      parent: flowNode._id,
      name: { $gte: cutoffDate },
    }).select("metadata").lean();

    for (const p of partitions) {
      const results = p.metadata instanceof Map
        ? p.metadata.get("results") || {}
        : p.metadata?.results || {};
      for (const entries of Object.values(results)) {
        const arr = Array.isArray(entries) ? entries : [entries];
        for (const r of arr) {
          if (r.source && nodeIds.includes(r.source)) active.add(r.source);
        }
      }
    }
  } catch (err) {
    log.debug("Prune", "Cascade activity check failed:", err.message);
  }
  return active;
}

async function getCodebookReferences(rootId, nodeIds) {
  const refs = new Set();
  const codebookExt = getExtension("codebook");
  if (!codebookExt?.exports?.getReferencedNodes) return refs;
  try {
    const referenced = await codebookExt.exports.getReferencedNodes(rootId);
    for (const id of referenced) {
      if (nodeIds.includes(id)) refs.add(id);
    }
  } catch (err) {
    log.debug("Prune", "Codebook reference check failed:", err.message);
  }
  return refs;
}

async function getContradictionReferences(rootId, nodeIds) {
  const refs = new Set();
  const contradictionExt = getExtension("contradiction");
  if (!contradictionExt?.exports?.getReferencedNodes) return refs;
  try {
    const referenced = await contradictionExt.exports.getReferencedNodes(rootId);
    for (const id of referenced) {
      if (nodeIds.includes(id)) refs.add(id);
    }
  } catch (err) {
    log.debug("Prune", "Contradiction reference check failed:", err.message);
  }
  return refs;
}
