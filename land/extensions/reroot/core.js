// Reroot Core
//
// Three phases:
// 1. Analyze: build a semantic snapshot of every node, ask the AI to find misplacements
// 2. Preview: the proposal lives on metadata.reroot.proposal until accepted or rejected
// 3. Apply: execute each move via updateParentRelationship (kernel function)

import log from "../../seed/log.js";
import { updateParentRelationship } from "../../seed/tree/treeManagement.js";
import { invalidateAll } from "../../seed/tree/ancestorCache.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import { getExtension } from "../loader.js";

let Node = null;
let Note = null;
let logContribution = null;
let runChat = null;
let useEnergy = async () => ({ energyUsed: 0 });
let _metadata = null;

export function setServices({ models, contributions, llm, energy, metadata }) {
  Node = models.Node;
  Note = models.Note;
  logContribution = contributions.logContribution;
  runChat = llm.runChat;
  if (energy?.useEnergy) useEnergy = energy.useEnergy;
  if (metadata) _metadata = metadata;
}

// ─────────────────────────────────────────────────────────────────────────
// ANALYZE
// ─────────────────────────────────────────────────────────────────────────

const ANALYSIS_PROMPT = `You are analyzing a tree's structure to find nodes that are in the wrong place. The tree grew organically. Some nodes ended up far from where they semantically belong.

Below is a snapshot of every node: its ID, name, current parent, depth, and a content summary. Some nodes also have codebook relationships, cascade connections, or evolution data.

Rules:
- Only propose moves that are clearly justified by semantic similarity
- Never move nodes with rootOwner set (they own their subtree)
- Never move system nodes (names starting with .)
- Preserve cascade configurations (don't break cascade.enabled chains)
- Each move must name: nodeId, nodeName, currentParentId, proposedParentId, proposedParentName, reason
- Maximum 10 moves per proposal
- If the tree is well-organized, return an empty array

Return a JSON array of proposed moves:
[
  {
    "nodeId": "...",
    "nodeName": "...",
    "currentParentId": "...",
    "proposedParentId": "...",
    "proposedParentName": "...",
    "reason": "why this node belongs under the proposed parent"
  }
]

If no reorganization is needed, return: []

Tree snapshot:
{snapshot}`;

/**
 * Analyze a tree and generate a reorganization proposal.
 */
export async function analyze(rootId, userId, username) {
  await useEnergy({ userId, action: "rerootAnalyze" });

  // Build the tree snapshot
  const snapshot = await buildTreeSnapshot(rootId);
  if (!snapshot || snapshot.nodes.length === 0) {
    throw new Error("Tree has no nodes to analyze");
  }

  // Format for the prompt
  const snapshotText = formatSnapshot(snapshot);

  // Ask the AI
  const prompt = ANALYSIS_PROMPT.replace("{snapshot}", snapshotText);

  const result = await runChat({
    userId,
    username,
    message: prompt,
    mode: "tree:respond",
    rootId,
    slot: "reroot",
  });

  if (!result?.answer) {
    throw new Error("Analysis produced no result");
  }

  // Parse the proposed moves
  const parsed = parseJsonSafe(result.answer);
  if (!Array.isArray(parsed)) {
    throw new Error("Analysis did not return a valid move list");
  }

  const moves = parsed
    .filter(m => m && m.nodeId && m.proposedParentId && m.reason)
    .slice(0, 10);

  // Validate each move
  const validMoves = [];
  for (const move of moves) {
    const node = await Node.findById(move.nodeId).select("_id name rootOwner systemRole parent").lean();
    if (!node) continue;
    if (node.rootOwner && node.rootOwner !== "SYSTEM") continue; // can't move roots
    if (node.systemRole) continue; // can't move system nodes
    if (node.parent?.toString() === move.proposedParentId) continue; // already there

    const newParent = await Node.findById(move.proposedParentId).select("_id name").lean();
    if (!newParent) continue;

    validMoves.push({
      nodeId: move.nodeId,
      nodeName: node.name,
      currentParentId: node.parent?.toString(),
      proposedParentId: move.proposedParentId,
      proposedParentName: newParent.name,
      reason: move.reason,
    });
  }

  // Write proposal to root metadata
  const root = await Node.findById(rootId);
  if (!root) throw new Error("Tree root not found");

  const rerootMeta = _metadata.getExtMeta(root, "reroot");
  rerootMeta.proposal = {
    moves: validMoves,
    generatedAt: new Date().toISOString(),
    generatedBy: userId,
    status: "pending",
  };
  await _metadata.setExtMeta(root, "reroot", rerootMeta);

  log.verbose("Reroot", `Analysis complete for tree ${rootId}: ${validMoves.length} move(s) proposed`);

  return {
    moves: validMoves,
    count: validMoves.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PREVIEW
// ─────────────────────────────────────────────────────────────────────────

export async function getProposal(rootId) {
  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) throw new Error("Tree not found");

  const rerootMeta = _metadata.getExtMeta(root, "reroot");
  return rerootMeta.proposal || null;
}

// ─────────────────────────────────────────────────────────────────────────
// APPLY
// ─────────────────────────────────────────────────────────────────────────

export async function applyProposal(rootId, userId) {
  const root = await Node.findById(rootId);
  if (!root) throw new Error("Tree not found");

  const rerootMeta = _metadata.getExtMeta(root, "reroot");
  const proposal = rerootMeta.proposal;
  if (!proposal || proposal.status !== "pending") {
    throw new Error("No pending proposal to apply");
  }

  const moves = proposal.moves || [];
  let applied = 0;
  let failed = 0;
  const results = [];

  // Skip cache invalidation on each move. Intermediate cache states between
  // moves don't matter because no other operation reads during the batch.
  // One invalidateAll() after the batch is sufficient and avoids ten full clears.
  for (const move of moves) {
    try {
      await updateParentRelationship(
        move.nodeId,
        move.proposedParentId,
        userId,
        true, // wasAi
        null, null,
        { skipCacheInvalidation: true },
      );

      results.push({ nodeId: move.nodeId, nodeName: move.nodeName, status: "moved", to: move.proposedParentName });
      applied++;
    } catch (err) {
      results.push({ nodeId: move.nodeId, nodeName: move.nodeName, status: "failed", error: err.message });
      failed++;
      log.debug("Reroot", `Move failed for ${move.nodeName}: ${err.message}`);
    }
  }

  // Single cache clear after all moves complete
  if (applied > 0) {
    invalidateAll();
  }

  // Update proposal status
  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  proposal.appliedBy = userId;
  proposal.results = results;

  // Add to history
  if (!rerootMeta.history) rerootMeta.history = [];
  rerootMeta.history.push({
    date: proposal.appliedAt,
    moves: applied,
    failed,
  });
  if (rerootMeta.history.length > 20) {
    rerootMeta.history = rerootMeta.history.slice(-20);
  }

  await _metadata.setExtMeta(root, "reroot", rerootMeta);

  // Log contribution
  await logContribution({
    userId,
    nodeId: rootId,
    wasAi: true,
    action: "reroot:applied",
    extensionData: {
      reroot: { applied, failed, moves: results },
    },
  });

  log.info("Reroot", `Applied reorganization to tree ${rootId}: ${applied} moved, ${failed} failed`);

  return { applied, failed, results };
}

// ─────────────────────────────────────────────────────────────────────────
// REJECT
// ─────────────────────────────────────────────────────────────────────────

export async function rejectProposal(rootId, userId) {
  const root = await Node.findById(rootId);
  if (!root) throw new Error("Tree not found");

  const rerootMeta = _metadata.getExtMeta(root, "reroot");
  if (!rerootMeta.proposal || rerootMeta.proposal.status !== "pending") {
    throw new Error("No pending proposal to reject");
  }

  rerootMeta.proposal.status = "rejected";
  rerootMeta.proposal.rejectedAt = new Date().toISOString();
  rerootMeta.proposal.rejectedBy = userId;
  await _metadata.setExtMeta(root, "reroot", rerootMeta);

  log.verbose("Reroot", `Proposal rejected for tree ${rootId}`);
  return { rejected: true };
}

// ─────────────────────────────────────────────────────────────────────────
// SNAPSHOT BUILDER
// ─────────────────────────────────────────────────────────────────────────

async function buildTreeSnapshot(rootId) {
  const nodes = await Node.find({
    rootOwner: rootId,
    status: { $ne: "trimmed" },
  })
    .select("_id name parent children systemRole rootOwner metadata type")
    .lean();

  if (nodes.length === 0) return { nodes: [] };

  const nodeMap = new Map();
  for (const n of nodes) nodeMap.set(n._id.toString(), n);

  // Calculate depth for each node
  function getDepth(nodeId, visited = new Set()) {
    if (!nodeId || visited.has(nodeId)) return 0;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node || !node.parent) return 0;
    return 1 + getDepth(node.parent.toString(), visited);
  }

  // Get content summary for each node (first note, truncated)
  const nodeIds = nodes.map(n => n._id.toString());
  const recentNotes = await Note.find({ nodeId: { $in: nodeIds } })
    .sort({ dateCreated: -1 })
    .select("nodeId content")
    .lean();

  const notesByNode = new Map();
  for (const note of recentNotes) {
    const id = note.nodeId.toString();
    if (!notesByNode.has(id)) {
      notesByNode.set(id, note.content?.slice(0, 200) || "");
    }
  }

  // Get codebook relationships if available
  let codebookRelations = null;
  const codebookExt = getExtension("codebook");
  if (codebookExt?.exports?.getRelationships) {
    try {
      codebookRelations = await codebookExt.exports.getRelationships(rootId);
    } catch (err) {
      log.debug("Reroot", "Codebook relationships unavailable:", err.message);
    }
  }

  // Build snapshot entries
  const snapshotNodes = nodes
    .filter(n => !n.systemRole)
    .map(n => {
      const id = n._id.toString();
      return {
        id,
        name: n.name,
        type: n.type || null,
        parentId: n.parent?.toString() || null,
        parentName: n.parent ? nodeMap.get(n.parent.toString())?.name || null : null,
        depth: getDepth(id),
        childCount: (n.children || []).length,
        hasRootOwner: !!(n.rootOwner && n.rootOwner !== "SYSTEM"),
        contentPreview: notesByNode.get(id) || null,
      };
    });

  return {
    nodes: snapshotNodes,
    codebookRelations,
  };
}

function formatSnapshot(snapshot) {
  const lines = snapshot.nodes.map(n => {
    let line = `${n.id} | "${n.name}"`;
    if (n.type) line += ` [${n.type}]`;
    line += ` | parent: "${n.parentName || "root"}" (${n.parentId || "root"})`;
    line += ` | depth: ${n.depth} | children: ${n.childCount}`;
    if (n.hasRootOwner) line += " | HAS_OWNER (do not move)";
    if (n.contentPreview) line += ` | content: "${n.contentPreview}"`;
    return line;
  });

  let text = lines.join("\n");

  if (snapshot.codebookRelations) {
    text += "\n\nCodebook relationships:\n" + JSON.stringify(snapshot.codebookRelations);
  }

  return text;
}
