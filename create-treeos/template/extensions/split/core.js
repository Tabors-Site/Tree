// Split Core
//
// Detect when a branch has outgrown its tree and execute mitosis.
// Analysis reads signals from every installed intelligence extension.
// Execution moves the branch into a new root tree with all metadata intact.

import log from "../../seed/log.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { updateParentRelationship } from "../../seed/tree/treeManagement.js";
import { invalidateAll } from "../../seed/tree/ancestorCache.js";
import { getExtension } from "../loader.js";
import { v4 as uuidv4 } from "uuid";

let Node = null;
let Note = null;
let logContribution = async () => {};
let runChat = null;
let useEnergy = async () => ({ energyUsed: 0 });

export function setServices({ models, contributions, llm, energy }) {
  Node = models.Node;
  Note = models.Note;
  logContribution = contributions.logContribution;
  runChat = llm.runChat;
  if (energy?.useEnergy) useEnergy = energy.useEnergy;
}

// ─────────────────────────────────────────────────────────────────────────
// DIMENSION SCORERS
// Each scorer reads one intelligence extension's data and returns
// { score: 0-1, detail: string, available: true } or { available: false }
// Score = how strongly this dimension suggests the branch should split.
// 1.0 = definitely should split. 0.0 = no reason to split.
// ─────────────────────────────────────────────────────────────────────────

async function scoreActivity(branchId, rootId, branchNodeIds) {
  const ext = getExtension("evolution");
  if (!ext?.exports?.getEvolutionReport) return { available: false };

  try {
    const report = await ext.exports.getEvolutionReport(rootId);
    if (!report?.fitness) return { available: false };

    // Count activity in branch vs rest of tree
    const branchSet = new Set(branchNodeIds);
    let branchActivity = 0;
    let totalActivity = 0;
    for (const [nodeId, fitness] of Object.entries(report.fitness)) {
      const activity = fitness.activity || fitness.score || 0;
      totalActivity += activity;
      if (branchSet.has(nodeId)) branchActivity += activity;
    }

    if (totalActivity === 0) return { available: false };
    const ratio = branchActivity / totalActivity;
    return {
      available: true,
      score: Math.min(1, ratio * 1.2), // > 83% activity = score 1.0
      detail: `${Math.round(ratio * 100)}% of tree activity is in this branch`,
    };
  } catch { return { available: false }; }
}

async function scoreBoundary(branchId, rootId) {
  const ext = getExtension("boundary");
  if (!ext?.exports?.getBoundaryReport) return { available: false };

  try {
    const report = await ext.exports.getBoundaryReport(rootId);
    if (!report?.branches?.[branchId]) return { available: false };

    const branchData = report.branches[branchId];
    // Low similarity to siblings = high split score
    // Find this branch's average similarity to all other branches
    const blurred = (report.findings || []).filter(
      f => f.type === "blurred" && f.branches?.includes(branchId),
    );
    const avgSimilarity = blurred.length > 0
      ? blurred.reduce((s, f) => s + (f.similarity || 0), 0) / blurred.length
      : 0;

    // Invert: low similarity to siblings = high split score
    const score = 1 - avgSimilarity;
    return {
      available: true,
      score: Math.max(0, Math.min(1, score)),
      detail: `${(avgSimilarity * 100).toFixed(0)}% average similarity to sibling branches`,
    };
  } catch { return { available: false }; }
}

async function scoreCoherence(branchId, rootId) {
  const ext = getExtension("purpose");
  if (!ext?.exports?.getThesis) return { available: false };

  try {
    const thesis = await ext.exports.getThesis(rootId);
    if (!thesis?.coherence) return { available: false };

    // Check if the branch has its own purpose that diverges from root
    const branchNode = await Node.findById(branchId).select("metadata").lean();
    if (!branchNode) return { available: false };
    const branchPurpose = getExtMeta(branchNode, "purpose");

    if (branchPurpose?.coherence != null) {
      // Low coherence against root thesis = high split score
      const score = 1 - branchPurpose.coherence;
      return {
        available: true,
        score: Math.max(0, Math.min(1, score)),
        detail: `Coherence against root thesis: ${(branchPurpose.coherence * 100).toFixed(0)}%`,
      };
    }

    return { available: false };
  } catch { return { available: false }; }
}

async function scorePersona(branchId, rootId) {
  const branchNode = await Node.findById(branchId).select("metadata").lean();
  const rootNode = await Node.findById(rootId).select("metadata").lean();
  if (!branchNode || !rootNode) return { available: false };

  const branchPersona = getExtMeta(branchNode, "persona");
  const rootPersona = getExtMeta(rootNode, "persona");

  if (!branchPersona?.name) return { available: false };

  // Has its own persona different from root
  const diverged = !rootPersona?.name || branchPersona.name !== rootPersona.name;
  return {
    available: true,
    score: diverged ? 0.8 : 0.2,
    detail: diverged
      ? `Has its own persona ("${branchPersona.name}") different from root ("${rootPersona?.name || "none"}")`
      : `Same persona as root ("${branchPersona.name}")`,
  };
}

async function scoreCodebook(branchId, rootId, branchNodeIds) {
  const ext = getExtension("codebook");
  if (!ext?.exports?.getCodebookStats) return { available: false };

  try {
    const stats = await ext.exports.getCodebookStats(rootId);
    if (!stats?.entries) return { available: false };

    const branchSet = new Set(branchNodeIds);
    let branchEntries = 0;
    let sharedEntries = 0;
    let totalEntries = stats.totalEntries || 0;

    if (stats.byNode) {
      for (const [nodeId, count] of Object.entries(stats.byNode)) {
        if (branchSet.has(nodeId)) branchEntries += count;
      }
    }
    // Estimate shared as entries referenced both inside and outside branch
    sharedEntries = Math.max(0, totalEntries - branchEntries);

    if (totalEntries === 0) return { available: false };

    // High isolation (few shared terms) = high split score
    const isolation = branchEntries > 0 ? 1 - (sharedEntries / (branchEntries + sharedEntries)) : 0;
    return {
      available: true,
      score: Math.max(0, Math.min(1, isolation)),
      detail: `${branchEntries} unique entries, ${sharedEntries} shared with parent`,
    };
  } catch { return { available: false }; }
}

async function scoreCascade(branchId, branchNodeIds) {
  // Check what % of cascade signals originate or terminate in this branch
  const branchSet = new Set(branchNodeIds);
  let branchSignals = 0;
  let totalSignals = 0;

  // Read cascade config from branch nodes
  for (const nodeId of branchNodeIds.slice(0, 100)) {
    const node = await Node.findById(nodeId).select("metadata").lean();
    if (!node) continue;
    const cascadeMeta = getExtMeta(node, "cascade");
    if (cascadeMeta?.enabled) branchSignals++;
    totalSignals++;
  }

  if (totalSignals === 0) return { available: false };

  const containment = branchSignals / totalSignals;
  return {
    available: true,
    score: Math.max(0, Math.min(1, containment)),
    detail: `${Math.round(containment * 100)}% of branch nodes are cascade-enabled`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ANALYZE
// ─────────────────────────────────────────────────────────────────────────

export async function analyze(rootId, userId) {
  await useEnergy({ userId, action: "splitAnalyze" });

  const root = await Node.findById(rootId).select("_id name children rootOwner").lean();
  if (!root) throw new Error("Tree root not found");
  if (!root.rootOwner) throw new Error("Node is not a tree root");

  // Get direct children (branches to analyze)
  const branches = [];
  for (const childId of root.children || []) {
    const child = await Node.findById(childId).select("_id name systemRole").lean();
    if (!child || child.systemRole) continue;

    const descendantIds = await getDescendantIds(childId.toString(), { maxResults: 10000 });

    const dimensions = {};
    dimensions.activity = await scoreActivity(childId.toString(), rootId, descendantIds);
    dimensions.boundary = await scoreBoundary(childId.toString(), rootId);
    dimensions.coherence = await scoreCoherence(childId.toString(), rootId);
    dimensions.persona = await scorePersona(childId.toString(), rootId);
    dimensions.codebook = await scoreCodebook(childId.toString(), rootId, descendantIds);
    dimensions.cascade = await scoreCascade(childId.toString(), descendantIds);

    const available = Object.values(dimensions).filter(d => d.available);
    const avgScore = available.length > 0
      ? available.reduce((s, d) => s + d.score, 0) / available.length
      : 0;

    branches.push({
      branchId: childId.toString(),
      branchName: child.name,
      nodeCount: descendantIds.length,
      dimensions,
      availableDimensions: available.length,
      averageScore: Math.round(avgScore * 100) / 100,
      recommendation: avgScore >= 0.7 ? "strong candidate for split"
        : avgScore >= 0.5 ? "possible candidate"
        : "no split recommended",
    });
  }

  // Sort by score descending
  branches.sort((a, b) => b.averageScore - a.averageScore);

  log.verbose("Split", `Analyzed ${branches.length} branches of ${root.name}`);

  return {
    rootId,
    rootName: root.name,
    branches,
    topCandidate: branches.length > 0 && branches[0].averageScore >= 0.5
      ? branches[0] : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PREVIEW
// ─────────────────────────────────────────────────────────────────────────

export async function preview(branchId, userId) {
  const branch = await Node.findById(branchId).select("_id name parent rootOwner").lean();
  if (!branch) throw new Error("Branch not found");
  if (branch.rootOwner) throw new Error("This node is already a tree root");

  const descendantIds = await getDescendantIds(branchId, { maxResults: 10000 });

  // Count metadata namespaces that will travel with the branch
  const metadataNamespaces = new Set();
  const sampleNodes = descendantIds.slice(0, 50);
  for (const nodeId of sampleNodes) {
    const node = await Node.findById(nodeId).select("metadata").lean();
    if (!node) continue;
    const meta = node.metadata instanceof Map
      ? [...node.metadata.keys()]
      : Object.keys(node.metadata || {});
    for (const ns of meta) metadataNamespaces.add(ns);
  }

  return {
    branchId,
    branchName: branch.name,
    parentId: branch.parent?.toString(),
    nodeCount: descendantIds.length,
    metadataCarried: [...metadataNamespaces].sort(),
    willCreate: `New root tree "${branch.name}"`,
    willMove: `${descendantIds.length} nodes preserving hierarchy`,
    willLeave: `Split note on parent node`,
    willConnect: `Channel between parent and new root`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTE
// ─────────────────────────────────────────────────────────────────────────

export async function execute(branchId, userId, username) {
  await useEnergy({ userId, action: "splitExecute" });

  const branch = await Node.findById(branchId).select("_id name parent rootOwner").lean();
  if (!branch) throw new Error("Branch not found");
  if (branch.rootOwner) throw new Error("This node is already a tree root");

  const parentId = branch.parent?.toString();
  if (!parentId) throw new Error("Branch has no parent");

  // Find the current tree root
  let currentRootId = null;
  let cursor = await Node.findById(parentId).select("_id parent rootOwner").lean();
  while (cursor) {
    if (cursor.rootOwner) { currentRootId = cursor._id.toString(); break; }
    if (!cursor.parent) break;
    cursor = await Node.findById(cursor.parent).select("_id parent rootOwner").lean();
  }

  // Detach from parent and promote to root
  // 1. Remove from parent's children
  await Node.updateOne({ _id: parentId }, { $pull: { children: branchId } });

  // 2. Set branch as root (rootOwner = userId, parent = null)
  await Node.updateOne({ _id: branchId }, {
    $set: { rootOwner: userId, parent: null },
  });

  // 3. Update all descendants: rootOwner stays as-is for delegated branches,
  //    but non-delegated nodes need rootOwner cleared (they inherit from the new root).
  //    Actually: rootOwner on descendants that pointed to the OLD tree root
  //    should now point to the NEW root (the branch itself).
  const descendantIds = await getDescendantIds(branchId, { maxResults: 10000 });
  // Only update descendants that had rootOwner = old tree root
  if (currentRootId) {
    await Node.updateMany(
      { _id: { $in: descendantIds }, rootOwner: currentRootId },
      { $set: { rootOwner: branchId } },
    );
  }

  // Invalidate cache since we changed the tree topology
  invalidateAll();

  // 4. Leave a note on the old parent
  try {
    const { createNote } = await import("../../seed/tree/notes.js");
    await createNote({
      contentType: "text",
      content: `${branch.name} split into its own tree on ${new Date().toISOString().slice(0, 10)}. ` +
        `${descendantIds.length} nodes moved.`,
      userId,
      nodeId: parentId,
    });
  } catch (err) {
    log.debug("Split", `Failed to leave split note on parent: ${err.message}`);
  }

  // 5. Create a channel between old parent and new root (if channels extension installed)
  let channelCreated = false;
  const channelsExt = getExtension("channels");
  if (channelsExt?.exports?.createChannel) {
    try {
      await channelsExt.exports.createChannel({
        sourceNodeId: parentId,
        targetNodeId: branchId,
        channelName: `split-${branch.name.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 30)}`,
        direction: "bidirectional",
        userId,
      });
      channelCreated = true;
    } catch (err) {
      log.debug("Split", `Failed to create post-split channel: ${err.message}`);
    }
  }

  // 6. Record split in history on the old tree root
  if (currentRootId) {
    try {
      const oldRoot = await Node.findById(currentRootId);
      if (oldRoot) {
        const splitMeta = getExtMeta(oldRoot, "split");
        if (!splitMeta.history) splitMeta.history = [];
        splitMeta.history.push({
          branchId,
          branchName: branch.name,
          nodeCount: descendantIds.length,
          splitAt: new Date().toISOString(),
          splitBy: userId,
          newRootId: branchId,
        });
        await setExtMeta(oldRoot, "split", splitMeta);
      }
    } catch (err) {
      log.debug("Split", `Failed to record split history: ${err.message}`);
    }
  }

  // 7. Add user's roots list (navigation extension)
  const navExt = getExtension("navigation");
  if (navExt?.exports?.addRoot) {
    try {
      await navExt.exports.addRoot(userId, branchId);
    } catch (err) {
      log.debug("Split", `Failed to add new root to navigation: ${err.message}`);
    }
  }

  // Log contribution
  await logContribution({
    userId,
    nodeId: branchId,
    wasAi: false,
    action: "split:executed",
    extensionData: {
      split: {
        fromTreeId: currentRootId,
        branchName: branch.name,
        nodeCount: descendantIds.length,
        channelCreated,
      },
    },
  });

  log.info("Split", `Branch "${branch.name}" split from tree ${currentRootId} into new root (${descendantIds.length} nodes)`);

  return {
    newRootId: branchId,
    newRootName: branch.name,
    nodeCount: descendantIds.length,
    fromTreeId: currentRootId,
    channelCreated,
    splitAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────────

export async function getHistory(rootId) {
  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) throw new Error("Tree root not found");
  const meta = getExtMeta(root, "split");
  return { history: meta.history || [] };
}
