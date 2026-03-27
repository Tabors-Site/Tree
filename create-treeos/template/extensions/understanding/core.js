import UnderstandingRun from "./understandingRun.js";
import UnderstandingNode from "./understandingNode.js";
import { getNotes } from "../../seed/tree/notes.js";

// Services wired from init() via setServices()
let Node = null;
let Contribution = null;
let logContribution = async () => {};
let useEnergy = async () => ({ energyUsed: 0 });

export function setServices({ models, contributions }) {
  Node = models.Node;
  Contribution = models.Contribution;
  if (contributions?.logContribution) logContribution = contributions.logContribution;
}
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }
function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}
/**
 * Creates the shadow understanding tree and computes merge rules.
 * Runs ONCE per UnderstandingRun.
 */
export async function createUnderstandingRun(
  rootNodeId,
  userId,
  perspective = "general",
  wasAi = false,
  chatId = null,
  sessionId = null,
) {
  const nodes = await Node.find({}).lean();
  const nodeById = new Map(nodes.map((n) => [String(n._id), n]));

  const rootNode = nodeById.get(String(rootNodeId));
  if (!rootNode) throw new Error("Root node not found");
  const MAX_PERSPECTIVE_LENGTH = 400; // adjust as you want

  perspective = (perspective || "").trim();
  if (containsHtml(perspective)) {
    throw new Error("Perspective cannot contain HTML tags");
  }
  if (!perspective) {
    perspective = "semantically compress while maintaining meaning";
  }

  // hard clamp
  if (perspective.length > MAX_PERSPECTIVE_LENGTH) {
    perspective = perspective.slice(0, MAX_PERSPECTIVE_LENGTH);
  }
  const run = await UnderstandingRun.create({
    userId,
    rootNodeId,
    perspective,
    nodeMap: {},
    topology: {},
  });

  const nodeMap = new Map();
  const topology = new Map();

  const createdUNodes = new Set(); // 👈 track new ones

  const rootUNodeId = await buildRunTree({
    realNode: rootNode,
    nodeById,
    nodeMap,
    topology,
    parentUNodeId: null,
    depth: 0,
    createdUNodes,
  });

  const maxDepth = computeDerivedTopology(rootUNodeId, topology);
  const { energyUsed } = await useEnergy({
    userId,
    action: "understanding",
    payload: createdUNodes.size, // 2 energy per node
  });
  run.nodeMap = Object.fromEntries(nodeMap);
  run.topology = Object.fromEntries(topology);
  run.maxDepth = maxDepth;
  await run.save();
  await logContribution({
    userId: userId,
    nodeId: rootNodeId,
    wasAi,
    chatId,
    sessionId,
    energyUsed,

    action: "understanding",
    nodeVersion: "0",
    understandingMeta: {
      stage: "createRun",
      understandingRunId: run._id,
      rootNodeId,
      nodeCount: nodeMap.size,
      perspective,
    },
  });
  return {
    understandingRunId: run._id,
    perspective,
    nodeCount: nodeMap.size,
    maxDepth,
    realRootNode: rootNodeId,
  };
}

/**
 * Find an existing completed run with the same perspective, or create a new one.
 * Used by auto-jobs and dream pipeline for incremental re-runs.
 */
export async function findOrCreateUnderstandingRun(
  rootNodeId,
  userId,
  perspective = "general",
  wasAi = false,
  chatId = null,
  sessionId = null,
) {
  const existing = await UnderstandingRun.findOne({
    rootNodeId: String(rootNodeId),
    perspective,
    status: "completed",
  })
    .sort({ lastCompletedAt: -1 })
    .lean();

  if (existing) {
    return {
      understandingRunId: existing._id,
      perspective: existing.perspective,
      nodeCount: existing.nodeMap
        ? existing.nodeMap instanceof Map
          ? existing.nodeMap.size
          : Object.keys(existing.nodeMap).length
        : 0,
      maxDepth: existing.maxDepth,
      realRootNode: rootNodeId,
      reused: true,
    };
  }

  return createUnderstandingRun(
    rootNodeId,
    userId,
    perspective,
    wasAi,
    chatId,
    sessionId,
  );
}

async function buildRunTree({
  realNode,
  nodeById,
  nodeMap,
  topology,
  parentUNodeId,
  depth,
  createdUNodes,
}) {
  let uNode = await UnderstandingNode.findOne({
    realNodeId: String(realNode._id),
  });

  let isNew = false;

  if (!uNode) {
    uNode = await UnderstandingNode.create({
      realNodeId: String(realNode._id),
    });
    isNew = true;
  }

  if (isNew) {
    createdUNodes.add(String(uNode._id));
  }

  const uNodeId = String(uNode._id);
  nodeMap.set(String(realNode._id), uNodeId);

  topology.set(uNodeId, {
    parent: parentUNodeId,
    children: [],
    depthFromRoot: depth,
    subtreeHeight: 0,
    mergeLayer: 0,
  });

  for (const childId of realNode.children || []) {
    const childRealNode = nodeById.get(String(childId));
    if (!childRealNode) continue;

    const childUNodeId = await buildRunTree({
      realNode: childRealNode,
      nodeById,
      nodeMap,
      topology,
      parentUNodeId: uNodeId,
      depth: depth + 1,
      createdUNodes,
    });

    topology.get(uNodeId).children.push(childUNodeId);
  }

  return uNodeId;
}

function computeDerivedTopology(uNodeId, topology) {
  const node = topology.get(uNodeId);

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

  node.subtreeHeight = maxChildHeight + 1;
  // mergeLayer = subtreeHeight = the single layer at which this node merges
  node.mergeLayer = node.subtreeHeight;

  return maxDepth;
}

/* ================================================================
 * Safe accessor for perspectiveStates — after .lean() Mongoose
 * Maps may be plain objects OR Map instances depending on version.
 * ================================================================ */
function getPS(node, runId) {
  const ps = node?.perspectiveStates;
  if (!ps) return null;
  if (ps instanceof Map) return ps.get(runId) || ps.get(String(runId));
  return ps[runId] || ps[String(runId)] || null;
}

/* ================================================================
 * getNextCompressionPayloadForLLM
 *
 * KEY FIX: Merge readiness now checks that ALL children are
 * COMPLETE (at their own mergeLayer), not just min child layer.
 * Each non-leaf node merges exactly ONCE, at its own mergeLayer.
 * ================================================================ */
export async function getNextCompressionPayloadForLLM(
  understandingRunId,
  userId,
) {
  const run = await UnderstandingRun.findById(understandingRunId).lean();
  if (!run) throw new Error("UnderstandingRun not found");

  const runId = String(run._id);
  const perspective = run.perspective;
  const topology = new Map(
    Object.entries(run.topology || {}).map(([k, v]) => [String(k), v]),
  );
  const uNodeIds = Object.values(run.nodeMap || {}).map(String);

  /* ============================================================
   * 0) COMPLETION CHECK — is the root already fully summarized?
   * ============================================================ */
  const rootUNodeId = findRootUNodeId(topology);

  if (rootUNodeId) {
    const rootNode = await UnderstandingNode.findById(rootUNodeId).lean();
    const rootTopo = topology.get(rootUNodeId);
    const rootState = getPS(rootNode, runId);

    if (
      rootState &&
      rootTopo &&
      rootState.currentLayer >= rootTopo.mergeLayer
    ) {
      return null; // COMPLETE
    }
  }

  /* ============================================================
   * 0b) Retry pending merge if exists
   * ============================================================ */
  if (
    run.pendingMerge &&
    run.pendingMerge.targetNodeId &&
    typeof run.pendingMerge.layer === "number"
  ) {
    const uNodeId = String(run.pendingMerge.targetNodeId);
    const layer = run.pendingMerge.layer;

    const node = await UnderstandingNode.findById(uNodeId).lean();
    if (node) {
      const existingState = getPS(node, runId);
      if (existingState && existingState.currentLayer >= layer) {
        // Already committed — clear and fall through
        await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
          $unset: { pendingMerge: "" },
        });
      } else {
        const topo = topology.get(uNodeId);
        const realNode = await Node.findById(node.realNodeId).lean();

        if (topo && realNode) {
          const freshUNodes = await UnderstandingNode.find({
            _id: { $in: uNodeIds },
          }).lean();
          const freshById = new Map(freshUNodes.map((n) => [String(n._id), n]));

          return buildMergePayload({
            understandingRunId: runId,
            rootNodeId: run.rootNodeId,
            perspective,
            node,
            realNode,
            topo,
            nextLayer: layer,
            byId: freshById,
          });
        }
      }
    }

    // Stale — clear
    await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
      $unset: { pendingMerge: "" },
    });
  }

  /* ============================================================
   * 1) LEAF PHASE — auto-commit empty leaves, return first with content
   * ============================================================ */
  let autoCommittedAny = false;
  const uNodes = await UnderstandingNode.find({
    _id: { $in: uNodeIds },
  }).lean();

  for (const n of uNodes) {
    const topo = topology.get(String(n._id));
    if (!topo) continue;
    if (topo.children.length !== 0) continue;

    const state = getPS(n, runId);
    if (state) continue;

    const realNode = await Node.findById(n.realNodeId).lean();
    if (!realNode) {
      await autoCommitLeaf(
        n._id,
        runId,
        perspective,
        "(node deleted)",
        userId,
        true,
      );
      autoCommittedAny = true;
      continue;
    }

    const notesResult = await getNotes({
      nodeId: realNode._id,
      version: realNode.prestige,
    });
    const notes = notesResult.notes || [];

    if (notes.length === 0) {
      await autoCommitLeaf(
        n._id,
        runId,
        perspective,
        "(no notes)",
        userId,
        true,
      );
      autoCommittedAny = true;
      continue;
    }

    // Leaf with content — send to LLM
    return {
      understandingRunId: runId,
      rootNodeId: run.rootNodeId,
      mode: "leaf",
      target: {
        understandingNodeId: String(n._id),
        realNodeId: String(n.realNodeId),
        perspective,
        targetLayer: 0,
      },
      inputs: [
        {
          realNodeId: realNode._id,
          nodeName: realNode.name,
          nodeType: realNode.type || null,
          notes: notes.map((note) => ({
            content: note.content,
            username: note.username,
            createdAt: note.createdAt,
          })),
        },
      ],
    };
  }

  /* ============================================================
   * 2) MERGE PHASE
   *
   * KEY FIX: A parent is ready when ALL its children are COMPLETE
   * (each child's currentLayer >= its own mergeLayer).
   *
   * The parent then merges at its OWN mergeLayer (exactly once).
   * This is what was broken — the old code used minChildLayer+1,
   * which got stuck when children had different merge layers.
   * ============================================================ */
  const mergeUNodes = autoCommittedAny
    ? await UnderstandingNode.find({ _id: { $in: uNodeIds } }).lean()
    : uNodes;
  const mergeById = new Map(mergeUNodes.map((n) => [String(n._id), n]));

  const readyParents = [];

  for (const node of mergeUNodes) {
    const nid = String(node._id);
    const topo = topology.get(nid);
    if (!topo || topo.children.length === 0) continue;

    // Check: is this parent already complete?
    const parentState = getPS(node, runId);
    if (parentState && parentState.currentLayer >= topo.mergeLayer) continue;

    // Check: are ALL children COMPLETE (at their own merge layers)?
    let allChildrenComplete = true;
    for (const cid of topo.children) {
      const child = mergeById.get(String(cid));
      const childTopo = topology.get(String(cid));
      const childState = getPS(child, runId);

      if (
        !childState ||
        !childTopo ||
        childState.currentLayer < childTopo.mergeLayer
      ) {
        allChildrenComplete = false;
        break;
      }
    }

    if (!allChildrenComplete) continue;

    // This parent is ready — it merges at its own mergeLayer
    readyParents.push({
      node,
      nextLayer: topo.mergeLayer,
      depthFromRoot: topo.depthFromRoot,
    });
  }

  if (readyParents.length === 0) return null;

  // Deepest first (bottom-up), then lowest layer as tiebreak
  readyParents.sort((a, b) => {
    if (a.nextLayer !== b.nextLayer) return a.nextLayer - b.nextLayer;
    return b.depthFromRoot - a.depthFromRoot;
  });

  const pick = readyParents[0];

  // Persist pending merge (single node)
  await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
    $set: {
      pendingMerge: {
        layer: pick.nextLayer,
        targetNodeId: String(pick.node._id),
      },
    },
  });

  const realNode = await Node.findById(pick.node.realNodeId).lean();
  if (!realNode) return null;

  const topo = topology.get(String(pick.node._id));

  return buildMergePayload({
    understandingRunId: runId,
    rootNodeId: run.rootNodeId,
    perspective,
    node: pick.node,
    realNode,
    topo,
    nextLayer: pick.nextLayer,
    byId: mergeById,
  });
}

/* ================================================================
 * Helpers
 * ================================================================ */

function findRootUNodeId(topology) {
  for (const [uid, topo] of topology) {
    if (topo.parent === null || topo.parent === undefined) {
      return uid;
    }
  }
  return null;
}

function buildMergePayload({
  understandingRunId,
  rootNodeId,
  perspective,
  node,
  realNode,
  topo,
  nextLayer,
  byId,
}) {
  const childSummaries = topo.children.map((cid) => {
    const child = byId.get(String(cid));
    const childState = getPS(child, understandingRunId);
    return {
      understandingNodeId: child?._id,
      realNodeId: child?.realNodeId,
      summary: childState?.encoding ?? "",
      currentLayer: childState?.currentLayer,
    };
  });

  return {
    understandingRunId,
    rootNodeId,
    mode: "merge",
    target: {
      perspective,
      understandingNodeId: String(node._id),
      nextLayer,
    },
    inputs: [
      {
        understandingNodeId: node._id,
        realNodeId: realNode._id,
        nodeName: realNode.name,
        nodeType: realNode.type || null,
        nextLayer,
        childSummaries,
      },
    ],
  };
}

async function autoCommitLeaf(
  understandingNodeId,
  understandingRunId,
  perspective,
  encoding,
  userId,
  wasAi,
) {
  const node = await UnderstandingNode.findById(understandingNodeId);
  if (!node) return;

  const existing = node.perspectiveStates?.get(understandingRunId);
  if (existing) return;

  const contribCount = await Contribution.countDocuments({
    nodeId: node.realNodeId,
    action: { $ne: "understanding" },
  });

  node.perspectiveStates.set(understandingRunId, {
    understandingRunId,
    perspective,
    encoding,
    currentLayer: 0,
    updatedAt: new Date(),
    contributionSnapshot: contribCount,
  });
  /*
  await logContribution({
    userId,
    nodeId: node.realNodeId,
    wasAi: true,
    action: "understanding",
    nodeVersion: "0",
    understandingMeta: {
      stage: "processStep",
      understandingRunId,
      understandingNodeId,
      layer: 0,
      mode: "leaf",
    },
  });*/ //dont log since these are auto-commits for empty nodes, not real contributions

  await node.save();
}

/* ================================================================
 * commitCompressionResult
 * ================================================================ */
export async function commitCompressionResult({
  mode,
  understandingRunId,
  encoding,
  understandingNodeId,
  currentLayer,
  userId,
  wasAi = true,
  chatId = null,
  sessionId = null,
}) {
  const run = await UnderstandingRun.findById(understandingRunId).lean();
  if (!run) throw new Error("UnderstandingRun not found");

  const perspective = run.perspective;

  /* ---- LEAF ---- */
  if (mode === "leaf") {
    if (!understandingNodeId) {
      throw new Error("understandingNodeId required for leaf commit");
    }

    const node = await UnderstandingNode.findById(understandingNodeId);
    if (!node) throw new Error("UnderstandingNode not found");

    const existing = node.perspectiveStates?.get(understandingRunId);
    if (existing) return; // idempotent

    const contribCount = await Contribution.countDocuments({
      nodeId: node.realNodeId,
      action: { $ne: "understanding" },
    });

    node.perspectiveStates.set(understandingRunId, {
      understandingRunId,
      perspective,
      encoding,
      currentLayer: 0,
      updatedAt: new Date(),
      contributionSnapshot: contribCount,
    });
    const { energyUsed } = await useEnergy({
      userId,
      action: "understanding",
      payload: 1,
    });

    await logContribution({
      userId,
      nodeId: node.realNodeId,
      wasAi,
      chatId,
      sessionId,
      energyUsed,
      action: "understanding",
      nodeVersion: "0",
      understandingMeta: {
        stage: "processStep",
        understandingRunId,
        understandingNodeId,
        layer: currentLayer,
        mode: "leaf",
      },
    });

    await node.save();
    return;
  }

  /* ---- MERGE ---- */
  if (mode === "merge") {
    const pending = run.pendingMerge;

    if (!pending || typeof pending.layer !== "number") {
      throw new Error("No pending merge found on this run");
    }

    if (pending.layer !== currentLayer) {
      throw new Error(
        `Layer mismatch: pending=${pending.layer}, got=${currentLayer}`,
      );
    }

    const targetId = understandingNodeId || pending.targetNodeId;
    if (!targetId) {
      throw new Error("No target node for merge commit");
    }

    if (
      understandingNodeId &&
      pending.targetNodeId &&
      String(understandingNodeId) !== String(pending.targetNodeId)
    ) {
      throw new Error(
        `Target mismatch: pending=${pending.targetNodeId}, got=${understandingNodeId}`,
      );
    }

    const node = await UnderstandingNode.findById(targetId);
    if (!node) throw new Error("Target UnderstandingNode not found");

    const existing = node.perspectiveStates?.get(understandingRunId);
    if (existing && existing.currentLayer >= currentLayer) {
      // idempotent
    } else {
      const contribCount = await Contribution.countDocuments({
        nodeId: node.realNodeId,
        action: { $ne: "understanding" },
      });

      node.perspectiveStates.set(understandingRunId, {
        understandingRunId,
        perspective,
        encoding,
        currentLayer,
        updatedAt: new Date(),
        contributionSnapshot: contribCount,
      });
      const { energyUsed } = await useEnergy({
        userId,
        action: "understanding",
        payload: 1,
      });

      await logContribution({
        userId,
        nodeId: node.realNodeId,
        wasAi,
        chatId,
        sessionId,
        energyUsed,
        action: "understanding",
        nodeVersion: "0",
        understandingMeta: {
          stage: "processStep",
          understandingRunId,
          understandingNodeId,
          layer: currentLayer,
          mode: "merge",
        },
      });

      await node.save();
    }

    await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
      $unset: { pendingMerge: "" },
    });

    return;
  }

  throw new Error(`Unknown commit mode: ${mode}`);
}

/* ================================================================
 * INCREMENTAL RUN SUPPORT
 * ================================================================ */

/**
 * Rebuild the run's topology from the current real tree.
 * Detects added/removed/moved nodes. Returns the set of structurally dirty uNodeIds.
 */
async function refreshRunTopology(run) {
  const runId = String(run._id);
  const nodes = await Node.find({}).lean();
  const nodeById = new Map(nodes.map((n) => [String(n._id), n]));

  const rootNode = nodeById.get(String(run.rootNodeId));
  if (!rootNode) throw new Error("Root node not found during topology refresh");

  const newNodeMap = new Map();
  const newTopology = new Map();
  const createdUNodes = new Set();

  await buildRunTree({
    realNode: rootNode,
    nodeById,
    nodeMap: newNodeMap,
    topology: newTopology,
    parentUNodeId: null,
    depth: 0,
    createdUNodes,
  });

  const rootUNodeId = newNodeMap.get(String(rootNode._id));
  computeDerivedTopology(rootUNodeId, newTopology);

  // Build old topology map for comparison
  const oldTopology = new Map(
    Object.entries(
      run.topology instanceof Map
        ? Object.fromEntries(run.topology)
        : run.topology || {},
    ).map(([k, v]) => [String(k), v]),
  );
  const oldNodeMap = new Map(
    Object.entries(
      run.nodeMap instanceof Map
        ? Object.fromEntries(run.nodeMap)
        : run.nodeMap || {},
    ).map(([k, v]) => [String(k), String(v)]),
  );

  const structurallyDirty = new Set();

  // Detect removed nodes — clear their perspectiveState for this run
  for (const [, oldUNodeId] of oldNodeMap) {
    if (!newTopology.has(oldUNodeId)) {
      const uNode = await UnderstandingNode.findById(oldUNodeId);
      if (uNode && uNode.perspectiveStates?.has(runId)) {
        uNode.perspectiveStates.delete(runId);
        await uNode.save();
      }
    }
  }

  // Detect moved nodes (parent changed)
  for (const [uNodeId, newTopo] of newTopology) {
    const oldTopo = oldTopology.get(uNodeId);
    if (
      oldTopo &&
      String(oldTopo.parent || "") !== String(newTopo.parent || "")
    ) {
      structurallyDirty.add(uNodeId);
    }
  }

  // Save updated topology
  await UnderstandingRun.findByIdAndUpdate(runId, {
    nodeMap: Object.fromEntries(newNodeMap),
    topology: Object.fromEntries(newTopology),
    maxDepth: computeDerivedTopology(rootUNodeId, newTopology),
  });

  return { newTopology, structurallyDirty };
}

/**
 * Detect dirty nodes by comparing contribution counts, then propagate
 * dirtiness upward and clear stale perspectiveStates.
 */
async function markDirtyNodes(run, topology, structurallyDirty = new Set()) {
  const runId = String(run._id);

  // Get all realNodeIds in this run
  const nodeMapEntries = Object.entries(
    run.nodeMap instanceof Map
      ? Object.fromEntries(run.nodeMap)
      : run.nodeMap || {},
  );
  const realNodeIds = nodeMapEntries.map(([realId]) => realId);
  const realToUNode = new Map(
    nodeMapEntries.map(([realId, uId]) => [realId, String(uId)]),
  );

  // Batch query current contribution counts (excluding understanding contributions)
  const contribCounts = await Contribution.aggregate([
    {
      $match: {
        nodeId: { $in: realNodeIds },
        action: { $ne: "understanding" },
      },
    },
    { $group: { _id: "$nodeId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(contribCounts.map((c) => [c._id, c.count]));

  // Load all understanding nodes for this run
  const uNodeIds = [...new Set(nodeMapEntries.map(([, uId]) => String(uId)))];
  const uNodes = await UnderstandingNode.find({ _id: { $in: uNodeIds } });
  const uNodeById = new Map(uNodes.map((n) => [String(n._id), n]));

  const dirtySet = new Set(structurallyDirty);

  // Check each node for content changes
  for (const [realId, uId] of realToUNode) {
    const uNode = uNodeById.get(uId);
    if (!uNode) continue;

    const state = uNode.perspectiveStates?.get(runId);
    if (!state) {
      // No perspectiveState = new node or never processed — already dirty
      dirtySet.add(uId);
      continue;
    }

    const currentCount = countMap.get(realId) || 0;
    const storedCount = state.contributionSnapshot;

    if (
      storedCount === null ||
      storedCount === undefined ||
      storedCount !== currentCount
    ) {
      dirtySet.add(uId);
    }
  }

  // Propagate dirtiness upward to root
  const propagated = new Set(dirtySet);
  for (const uId of dirtySet) {
    let current = uId;
    while (current) {
      const topo = topology.get(current);
      if (!topo || !topo.parent) break;
      const parentId = String(topo.parent);
      if (propagated.has(parentId)) break; // already propagated
      propagated.add(parentId);
      current = parentId;
    }
  }

  // Clear perspectiveStates for all dirty nodes (so compression loop picks them up)
  const bulkOps = [];
  for (const uId of propagated) {
    const uNode = uNodeById.get(uId);
    if (!uNode) continue;

    if (uNode.perspectiveStates?.has(runId)) {
      uNode.perspectiveStates.delete(runId);
      bulkOps.push(uNode.save());
    }
  }
  if (bulkOps.length > 0) await Promise.all(bulkOps);

  // Clear pendingMerge if it's in the dirty set
  if (
    run.pendingMerge?.targetNodeId &&
    propagated.has(String(run.pendingMerge.targetNodeId))
  ) {
    await UnderstandingRun.findByIdAndUpdate(runId, {
      $unset: { pendingMerge: "" },
    });
  }

  return { dirtyCount: propagated.size, totalNodes: uNodeIds.length };
}

/**
 * Prepare an existing run for incremental re-processing.
 * Rebuilds topology from current tree and marks dirty nodes.
 */
export async function prepareIncrementalRun(understandingRunId, userId) {
  const run = await UnderstandingRun.findById(understandingRunId).lean();
  if (!run) throw new Error("UnderstandingRun not found");

  const { newTopology, structurallyDirty } = await refreshRunTopology(run);
  const { dirtyCount, totalNodes } = await markDirtyNodes(
    run,
    newTopology,
    structurallyDirty,
  );

  return { dirtyCount, totalNodes };
}

/**
 * Fetch all understanding runs for a given root node.
 */
export async function listUnderstandingRuns(rootNodeId) {
  const root = await Node.findById(rootNodeId).select("_id name userId").lean();

  if (!root) throw new Error("Root not found");

  const runs = await UnderstandingRun.find({ rootNodeId })
    .sort({ createdAt: -1 })
    .lean();

  return {
    rootNodeId: root._id,
    rootName: root.name,
    understandings: runs.map((r) => ({
      understandingRunId: r._id,
      perspective: r.perspective,
      createdAt: r.createdAt,
    })),
  };
}
