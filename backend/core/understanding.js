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
  // Load full real-node graph
  const nodes = await Node.find({}).lean();
  const nodeById = new Map(nodes.map((n) => [n._id, n]));

  const rootNode = nodeById.get(rootNodeId);
  if (!rootNode) throw new Error("Root node not found");
  if (perspective.trim() == "") {
    perspective = "semantically compress while maintaining meaning";
  }
  // Create run early so we have its ID
  const run = await UnderstandingRun.create({
    rootNodeId,
    perspective,
    nodeMap: {},
    topology: {},
  });

  const nodeMap = new Map(); // realNodeId -> uNodeId
  const topology = new Map(); // uNodeId -> topology object

  // Build tree + topology
  const rootUNodeId = await buildRunTree({
    realNode: rootNode,
    nodeById,
    nodeMap,
    topology,
    parentUNodeId: null,
    depth: 0,
  });

  // Compute subtreeHeight + mergeLayer in one pass
  const maxDepth = computeDerivedTopology(rootUNodeId, topology);

  // Persist results
  run.nodeMap = Object.fromEntries(nodeMap);
  run.topology = Object.fromEntries(topology);
  run.maxDepth = maxDepth;
  await run.save();

  return {
    understandingRunId: run._id,
    perspective,
    nodeCount: nodeMap.size,
    maxDepth,
    realRootNode: rootNodeId,
  };
}

async function buildRunTree({
  realNode,
  nodeById,
  nodeMap,
  topology,
  parentUNodeId,
  depth,
}) {
  // Get or create semantic node (SAFE)
  let uNode = await UnderstandingNode.findOne({
    realNodeId: realNode._id,
  });

  if (!uNode) {
    uNode = await UnderstandingNode.create({
      realNodeId: realNode._id,
    });
  }

  const uNodeId = uNode._id;
  nodeMap.set(realNode._id, uNodeId);

  // Initialize topology entry
  topology.set(uNodeId, {
    parent: parentUNodeId,
    children: [],
    depthFromRoot: depth,
    subtreeHeight: 0, // computed later
    mergeLayer: 0, // computed later
  });

  // Recurse
  for (const childId of realNode.children || []) {
    const childRealNode = nodeById.get(childId);
    if (!childRealNode) continue;

    const childUNodeId = await buildRunTree({
      realNode: childRealNode,
      nodeById,
      nodeMap,
      topology,
      parentUNodeId: uNodeId,
      depth: depth + 1,
    });

    topology.get(uNodeId).children.push(childUNodeId);
  }

  return uNodeId;
}
function computeDerivedTopology(uNodeId, topology) {
  const node = topology.get(uNodeId);

  // Leaf
  if (!node.children.length) {
    node.subtreeHeight = 0;
    node.mergeLayer = 0;
    return node.depthFromRoot;
  }

  let maxDepth = node.depthFromRoot;
  let maxChildHeight = 0;

  for (const childId of node.children) {
    const childDepth = computeDerivedTopology(childId, topology);
    const child = topology.get(childId);

    maxDepth = Math.max(maxDepth, childDepth);
    maxChildHeight = Math.max(maxChildHeight, child.subtreeHeight);
  }

  // Height = longest path below this node
  node.subtreeHeight = maxChildHeight + 1;

  // 🔑 THIS IS THE KEY RULE
  node.mergeLayer = node.subtreeHeight;

  return maxDepth;
}

export async function getNextCompressionPayloadForLLM(understandingRunId) {
  const run = await UnderstandingRun.findById(understandingRunId).lean();
  if (!run) throw new Error("UnderstandingRun not found");

  const perspective = run.perspective;
  const topology = new Map(Object.entries(run.topology || {}));

  const uNodeIds = Object.values(run.nodeMap || {});
  const uNodes = await UnderstandingNode.find({
    _id: { $in: uNodeIds },
  }).lean();
  const byId = new Map(uNodes.map((n) => [String(n._id), n]));

  /* ============================================================
   * 0) If a merge batch is already pending, return it again
   *    (keeps LLM + commit in sync / retry-safe)
   * ============================================================ */
  if (
    run.pendingMerge &&
    Array.isArray(run.pendingMerge.targetNodeIds) &&
    typeof run.pendingMerge.layer === "number"
  ) {
    const layer = run.pendingMerge.layer;
    const targetNodeIds = run.pendingMerge.targetNodeIds;

    const inputs = [];

    for (const uNodeId of targetNodeIds) {
      const node = byId.get(String(uNodeId));
      if (!node) continue;

      const topo = topology.get(String(node._id));
      if (!topo) continue;

      const realNode = await Node.findById(node.realNodeId).lean();
      if (!realNode) continue;

      const childSummaries = topo.children.map((cid) => {
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
        nextLayer: layer,
        childSummaries,
      });
    }

    return {
      understandingRunId,
      rootNodeId: run.rootNodeId,
      mode: "merge",
      target: {
        perspective,
        nextLayer: layer,
      },
      inputs,
    };
  }

  /* ============================================================
   * 1) LEAF PHASE — pick an uncompressed leaf (run-topology leaf)
   * ============================================================ */
  const nextLeaf = uNodes.find((n) => {
    const topo = topology.get(String(n._id));
    if (!topo) return false;
    if (topo.children.length !== 0) return false; // leaf in THIS run
    const state = n.perspectiveStates?.[understandingRunId];
    return !state;
  });

  if (nextLeaf) {
    const realNode = await Node.findById(nextLeaf.realNodeId).lean();
    if (!realNode) return null;

    const notesResult = await getNotes({
      nodeId: realNode._id,
      version: realNode.prestige,
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
   * 2) MERGE PHASE — find parents ready to merge at next layer
   * ============================================================ */
  const readyParents = [];

  for (const node of uNodes) {
    const topo = topology.get(String(node._id));
    if (!topo || topo.children.length === 0) continue;

    const childStates = topo.children
      .map(
        (cid) => byId.get(String(cid))?.perspectiveStates?.[understandingRunId]
      )
      .filter(Boolean);

    if (childStates.length !== topo.children.length) continue;

    // Allow layer skew: parent advances based on the slowest child
    const childLayers = childStates.map((s) => s.currentLayer ?? -1);
    const minChildLayer = Math.min(...childLayers);

    if (minChildLayer < 0) continue; // safety guard

    const nextLayer = minChildLayer + 1;

    const parentState = node.perspectiveStates?.[understandingRunId];
    const parentCurrent = parentState ? parentState.currentLayer : -1;

    if (parentCurrent >= nextLayer) continue;
    if (nextLayer > topo.mergeLayer) continue;

    readyParents.push({ node, nextLayer });
  }

  if (readyParents.length === 0) return null;

  const minNextLayer = Math.min(...readyParents.map((r) => r.nextLayer));
  const batch = readyParents.filter((r) => r.nextLayer === minNextLayer);

  // ✅ Persist pending merge so commit is deterministic
  await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
    $set: {
      pendingMerge: {
        layer: minNextLayer,
        targetNodeIds: batch.map((b) => b.node._id),
      },
    },
  });

  const inputs = [];

  for (const { node, nextLayer } of batch) {
    const realNode = await Node.findById(node.realNodeId).lean();
    if (!realNode) continue;

    const topo = topology.get(String(node._id));

    const childSummaries = topo.children.map((cid) => {
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
      nextLayer,
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
  understandingRunId,
  encoding,

  // leaf
  understandingNodeId,

  // merge
  currentLayer,
}) {
  const run = await UnderstandingRun.findById(understandingRunId).lean();
  if (!run) {
    throw new Error("UnderstandingRun not found");
  }

  const perspective = run.perspective;
  const topology = run.topology || {};

  /* =====================
     LEAF COMMIT
     ===================== */
  if (mode === "leaf") {
    if (!understandingNodeId) {
      throw new Error("understandingNodeId required for leaf commit");
    }

    const node = await UnderstandingNode.findById(understandingNodeId);
    if (!node) {
      throw new Error("UnderstandingNode not found");
    }

    const existing = node.perspectiveStates?.get(understandingRunId);
    if (existing) {
      // idempotent: already committed
      return;
    }

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

  /* =====================
     MERGE COMMIT
     ===================== */
  if (mode === "merge") {
    const pending = run.pendingMerge;

    if (
      !pending ||
      pending.layer !== currentLayer ||
      !Array.isArray(pending.targetNodeIds)
    ) {
      throw new Error("No pending merge for this layer");
    }

    for (const uNodeId of pending.targetNodeIds) {
      const node = await UnderstandingNode.findById(uNodeId);
      if (!node) continue;

      const existing = node.perspectiveStates?.get(understandingRunId);
      if (existing && existing.currentLayer >= currentLayer) continue;

      node.perspectiveStates.set(understandingRunId, {
        understandingRunId,
        perspective,
        encoding,
        currentLayer,
        updatedAt: new Date(),
      });

      await node.save();
    }

    // clear pending merge
    await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
      $unset: { pendingMerge: "" },
    });

    return;
  }

  throw new Error(`Unknown commit mode: ${mode}`);
}
