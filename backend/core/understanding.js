import UnderstandingRun from "../db/models/understandingRun.js";
import UnderstandingNode from "../db/models/understandingNode.js";
import Node from "../db/models/node.js";
import { getNotes } from "./notes.js";

/**
 * Creates the shadow understanding tree and computes merge rules.
 * Runs ONCE per UnderstandingRun.
 */
export async function createUnderstandingRun(
  rootNodeId,
  perspective = "general"
) {
  const nodes = await Node.find({}).lean();
  const nodeById = new Map(nodes.map((n) => [n._id, n]));

  const rootNode = nodeById.get(rootNodeId);
  if (!rootNode) throw new Error("Root node not found");

  const understandingRun = await UnderstandingRun.create({
    rootNodeId,
    perspective,
    nodeMap: {},
  });

  const nodeMap = {};

  const rootUNode = await buildTree({
    realNode: rootNode,
    nodeById,
    nodeMap,
  });

  const maxDepth = await computeSubtreeHeight(rootUNode._id);
  await computeMergeLayer(rootUNode._id);

  understandingRun.nodeMap = nodeMap;
  understandingRun.maxDepth = maxDepth;
  await understandingRun.save();

  return {
    understandingRunId: understandingRun._id,
    perspective,
    nodeCount: Object.keys(nodeMap).length,
    maxDepth,
  };
}
async function buildTree({
  realNode,
  nodeById,
  nodeMap,
  parentUNodeId = null,
  depth = 0,
}) {
  let uNode = await UnderstandingNode.findOne({
    realNodeId: realNode._id,
  });

  if (!uNode) {
    uNode = await UnderstandingNode.create({
      realNodeId: realNode._id,
      parent: parentUNodeId,
      children: [],
      depthFromRoot: depth,
      subtreeHeight: 0,
      mergeLayer: 0,
    });
  }

  nodeMap[realNode._id] = uNode._id;

  for (const childId of realNode.children || []) {
    const childRealNode = nodeById.get(childId);
    if (!childRealNode) continue;

    const childUNode = await buildTree({
      realNode: childRealNode,
      nodeById,
      nodeMap,
      parentUNodeId: uNode._id,
      depth: depth + 1,
    });

    uNode.children.push(childUNode._id);
  }

  await uNode.save();
  return uNode;
}

async function computeMergeLayer(uNodeId) {
  const uNode = await UnderstandingNode.findById(uNodeId);

  if (uNode.children.length === 0) {
    uNode.mergeLayer = 0;
    await uNode.save();
    return 0;
  }

  let minChildMerge = Infinity;
  for (const childId of uNode.children) {
    minChildMerge = Math.min(minChildMerge, await computeMergeLayer(childId));
  }

  uNode.mergeLayer = minChildMerge + 1;
  await uNode.save();
  return uNode.mergeLayer;
}

async function computeSubtreeHeight(uNodeId) {
  const uNode = await UnderstandingNode.findById(uNodeId);

  if (uNode.children.length === 0) {
    uNode.subtreeHeight = 0;
    await uNode.save();
    return 0;
  }

  let max = 0;
  for (const childId of uNode.children) {
    max = Math.max(max, await computeSubtreeHeight(childId));
  }

  uNode.subtreeHeight = max + 1;
  await uNode.save();
  return uNode.subtreeHeight;
}

export async function getNextCompressionPayloadForLLM(
  understandingRunId,
  perspective,
  noteVersion
) {
  const run = await UnderstandingRun.findById(understandingRunId);
  if (!run) throw new Error("UnderstandingRun not found");

  const uNodes = await UnderstandingNode.find({
    _id: { $in: Array.from(run.nodeMap.values()) },
  }).lean();

  const byId = new Map(uNodes.map((n) => [String(n._id), n]));

  /* ============================================================
   * 1️⃣ LEAF PHASE — one node at a time (raw notes → layer 0)
   * ============================================================ */
  const nextLeaf = uNodes.find((n) => {
    if (n.children?.length) return false; // leaf only
    const state = n.perspectiveStates?.[understandingRunId];
    return !state;
  });

  if (nextLeaf) {
    const realNode = await Node.findById(nextLeaf.realNodeId).lean();
    if (!realNode) return null;

    const notesResult = await getNotes({
      nodeId: realNode._id,
      version: noteVersion ?? realNode.prestige,
    });

    return {
      understandingRunId,
      rootNodeId: run.rootNodeId,
      mode: "leaf",
      target: {
        understandingNodeId: nextLeaf._id,
        realNodeId: nextLeaf.realNodeId,
        perspective,
        targetLayer: 0,
      },
      inputs: [
        {
          realNodeId: realNode._id,
          nodeName: realNode.name,
          notes: (notesResult.notes || []).map((n) => ({
            content: n.content,
            username: n.username,
            createdAt: n.createdAt,
          })),
        },
      ],
    };
  }

  /* ============================================================
   * 2️⃣ MERGE PHASE — equalized children → parent at next layer
   * ============================================================ */

  // Find all parents that are "ready" right now
  // Ready means:
  // - has children
  // - every child has a state for this perspective
  // - all children have SAME currentLayer
  // - parent has not yet reached mergeLayer
  // - and nextLayer (= childLayer+1) does not exceed parent.mergeLayer
  const readyParents = [];

  for (const node of uNodes) {
    if (!node.children?.length) continue; // skip leaves

    const childStates = node.children
      .map(
        (cid) => byId.get(String(cid))?.perspectiveStates?.[understandingRunId]
      )
      .filter(Boolean);

    if (childStates.length !== node.children.length) continue; // some child missing state

    const childLayer = childStates[0].currentLayer;
    if (!childStates.every((s) => s.currentLayer === childLayer)) continue; // not equalized

    const nextLayer = childLayer + 1;

    // parent progress
    const parentState = node.perspectiveStates?.[understandingRunId];
    const parentCurrent = parentState ? parentState.currentLayer : -1;

    // already at/above nextLayer or already maxed
    if (parentCurrent >= nextLayer) continue;
    if (nextLayer > node.mergeLayer) continue;

    readyParents.push({
      node,
      nextLayer,
    });
  }

  if (readyParents.length === 0) {
    return null; // nothing ready (you can treat this as "waiting" state)
  }

  // Choose the lowest nextLayer first (bottom-up leveling)
  const minNextLayer = Math.min(...readyParents.map((r) => r.nextLayer));

  // Batch all parents that can merge into this same nextLayer
  const batch = readyParents.filter((r) => r.nextLayer === minNextLayer);

  const inputs = [];

  for (const { node, nextLayer } of batch) {
    const realNode = await Node.findById(node.realNodeId).lean();
    if (!realNode) continue;

    const childSummaries = node.children.map((cid) => {
      const child = byId.get(String(cid));
      const childState = child?.perspectiveStates?.[understandingRunId];
      return {
        understandingNodeId: child?._id,
        realNodeId: child?.realNodeId,
        summary: childState?.encoding ?? "",
        currentLayer: childState?.currentLayer,
      };
    });

    inputs.push({
      understandingNodeId: node._id,
      realNodeId: realNode._id,
      nodeName: realNode.name,
      nextLayer, // where THIS parent will be committed
      childSummaries,
    });
  }

  return {
    understandingRunId,
    rootNodeId: run.rootNodeId,

    mode: "merge",
    target: {
      perspective,
      nextLayer: minNextLayer,
    },
    inputs,
  };

}

export async function commitCompressionResult({
  mode,
  understandingNodeId, // required for leaf
  currentLayer, // required for merge
  perspective,
  encoding,
  understandingRunId,
}) {
  if (mode === "leaf") {
    // 🔹 LEAF: commit to ONE understanding node
    const node = await UnderstandingNode.findById(understandingNodeId);
    if (!node) throw new Error("UnderstandingNode not found");

    node.perspectiveStates.set(understandingRunId, {
      understandingRunId,
      perspective,
      encoding,
      currentLayer: 0,
      updatedAt: new Date(),
    });

    await node.save();
    return;
  }

  if (mode === "merge") {
    const nodes = await UnderstandingNode.find({
      mergeLayer: { $gte: currentLayer }, // allowed structurally
      [`perspectiveStates.${understandingRunId}`]: { $exists: false },
    });

    for (const node of nodes) {
      node.perspectiveStates.set(understandingRunId, {
        understandingRunId,
        perspective,
        encoding,
        currentLayer, // ✅ THIS IS THE VALUE YOU COMPUTED
        updatedAt: new Date(),
      });

      await node.save();
    }
    return;
  }

  throw new Error(`Unknown commit mode: ${mode}`);
}
