// Seed Export Core
//
// Three operations:
// 1. exportTreeSeed: walk a tree, extract structural metadata, produce a seed file
// 2. plantTreeSeed: read a seed file, create the node hierarchy, apply metadata
// 3. analyzeSeed: read a seed file without planting, report requirements

import log from "../../seed/log.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { createNode } from "../../seed/tree/treeManagement.js";
import { getExtension } from "../loader.js";

let Node = null;
let logContribution = async () => {};
let useEnergy = async () => ({ energyUsed: 0 });
let _metadata = null;

export function setServices({ models, contributions, energy, metadata }) {
  Node = models.Node;
  logContribution = contributions.logContribution;
  if (energy?.useEnergy) useEnergy = energy.useEnergy;
  if (metadata) _metadata = metadata;
}

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURAL METADATA WHITELIST
// ─────────────────────────────────────────────────────────────────────────

// These namespaces define behavior. They get exported.
// Everything else is accumulated data generated through use. Excluded.
const STRUCTURAL_NAMESPACES = new Set([
  "cascade",
  "extensions",
  "tools",
  "modes",
  "persona",
  "perspective",
  "purpose",
]);

function extractStructuralMetadata(node) {
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  const structural = {};
  for (const ns of STRUCTURAL_NAMESPACES) {
    if (meta[ns] && Object.keys(meta[ns]).length > 0) {
      structural[ns] = meta[ns];
    }
  }
  return structural;
}

function getReferencedExtensions(structural) {
  const refs = new Set();

  // Namespaces themselves reference their extension
  for (const ns of Object.keys(structural)) {
    if (ns !== "extensions" && ns !== "tools" && ns !== "modes" && ns !== "cascade") {
      refs.add(ns);
    }
  }

  // extensions.blocked[] and extensions.allowed[] reference extension names
  if (structural.extensions) {
    for (const name of structural.extensions.blocked || []) refs.add(name);
    for (const name of structural.extensions.allowed || []) refs.add(name);
  }

  // modes values reference extension-registered modes (e.g. "tree:fitness")
  if (structural.modes) {
    for (const modeKey of Object.values(structural.modes)) {
      const parts = String(modeKey).split(":");
      if (parts.length >= 2 && parts[0] !== "tree" && parts[0] !== "home" && parts[0] !== "land") {
        refs.add(parts[0]);
      }
    }
  }

  return refs;
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────

const SEED_EXPORT_VERSION = "1.0.0";

export async function exportTreeSeed(rootId, userId, opts = {}) {
  await useEnergy({ userId, action: "seedExport" });

  const maxNodes = opts.maxExportNodes || 5000;
  const maxDepth = opts.maxExportDepth || 20;

  // Get all node IDs in this tree via children[] walk
  const descendantIds = await getDescendantIds(rootId, { maxResults: maxNodes });

  // Fetch all nodes
  const nodes = await Node.find({
    _id: { $in: descendantIds },
    systemRole: { $eq: null },
  })
    .select("_id name type status parent children metadata rootOwner contributors")
    .lean();

  if (nodes.length === 0) throw new Error("Tree has no nodes to export");

  const nodeMap = new Map();
  for (const n of nodes) nodeMap.set(n._id.toString(), n);

  const root = nodeMap.get(rootId.toString());
  if (!root) throw new Error("Root node not found");

  // Collect all referenced extensions across the tree
  const allExtRefs = new Set();

  // Recursive tree builder
  function buildNode(nodeId, depth) {
    const node = nodeMap.get(nodeId.toString());
    if (!node || depth > maxDepth) return null;

    const structural = extractStructuralMetadata(node);
    for (const ext of getReferencedExtensions(structural)) allExtRefs.add(ext);

    // Delegation boundary detection
    const isRoot = nodeId.toString() === rootId.toString();
    const hasDelegation = !isRoot && !!node.rootOwner;
    const hasContributors = (node.contributors || []).length > 0;

    const children = (node.children || [])
      .map(childId => buildNode(childId.toString(), depth + 1))
      .filter(Boolean);

    const exported = {
      name: node.name,
      type: node.type || null,
      status: node.status || "active",
      children,
    };

    if (Object.keys(structural).length > 0) {
      exported.metadata = structural;
    }

    if (hasDelegation) {
      exported.delegated = true;
    }

    if (hasContributors) {
      exported.contributorCount = node.contributors.length;
    }

    return exported;
  }

  const tree = buildNode(rootId.toString(), 0);
  if (!tree) throw new Error("Failed to build tree skeleton");

  // Calculate stats
  let nodeCount = 0;
  let maxTreeDepth = 0;
  let cascadeNodeCount = 0;
  let personaCount = 0;

  function countStats(node, depth) {
    nodeCount++;
    if (depth > maxTreeDepth) maxTreeDepth = depth;
    if (node.metadata?.cascade?.enabled) cascadeNodeCount++;
    if (node.metadata?.persona?.name) personaCount++;
    for (const child of node.children || []) {
      countStats(child, depth + 1);
    }
  }
  countStats(tree, 0);

  // Build cascade topology if requested
  let cascadeTopology = undefined;
  if (opts.cascade) {
    cascadeTopology = buildCascadeTopology(nodes, nodeMap);
  }

  // Determine which extensions are structurally required vs optional
  const installedExts = new Set();
  try {
    const { getLoadedExtensionNames } = await import("../loader.js");
    for (const name of getLoadedExtensionNames()) installedExts.add(name);
  } catch {}

  const requiredExtensions = [...allExtRefs].sort();
  const optionalExtensions = requiredExtensions.filter(e => !installedExts.has(e));

  // Look up username and land info
  let exportedBy = "unknown";
  let sourceLand = "unknown";
  try {
    const user = await (await import("../../seed/models/user.js")).default
      .findById(userId).select("username").lean();
    if (user) exportedBy = user.username;
  } catch {}
  try {
    const { getLandIdentity } = await import("../../canopy/identity.js");
    const identity = getLandIdentity();
    if (identity?.domain) sourceLand = identity.domain;
  } catch {}

  const seedData = {
    seedExportVersion: SEED_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceLand,
    sourceTreeName: root.name,
    sourceTreeId: rootId.toString(),
    exportedBy,
    tree,
    requiredExtensions,
    optionalExtensions,
    stats: {
      nodeCount,
      maxDepth: maxTreeDepth,
      extensionsReferenced: allExtRefs.size,
      personasIncluded: personaCount,
      cascadeNodesEnabled: cascadeNodeCount,
    },
  };

  if (cascadeTopology) {
    seedData.cascadeTopology = cascadeTopology;
  }

  // Log contribution
  await logContribution({
    userId,
    nodeId: rootId.toString(),
    wasAi: false,
    action: "seed-export:exported",
    extensionData: {
      "seed-export": {
        nodeCount,
        maxDepth: maxTreeDepth,
        requiredExtensions,
      },
    },
  });

  log.info("SeedExport", `Exported tree "${root.name}" (${nodeCount} nodes, depth ${maxTreeDepth})`);

  return seedData;
}

function buildCascadeTopology(nodes, nodeMap) {
  const topology = [];
  const cascadeNodes = nodes.filter(n => {
    const meta = n.metadata instanceof Map
      ? n.metadata.get("cascade")
      : n.metadata?.cascade;
    return meta?.enabled;
  });

  for (const node of cascadeNodes) {
    const nodeName = node.name;
    for (const childId of node.children || []) {
      const child = nodeMap.get(childId.toString());
      if (!child) continue;
      const childMeta = child.metadata instanceof Map
        ? child.metadata.get("cascade")
        : child.metadata?.cascade;
      if (childMeta?.enabled) {
        topology.push({
          from: nodeName,
          to: child.name,
          direction: "outbound",
        });
      }
    }
  }

  return topology;
}

// ─────────────────────────────────────────────────────────────────────────
// PLANT
// ─────────────────────────────────────────────────────────────────────────

export async function plantTreeSeed(seedData, userId, username) {
  if (!seedData?.seedExportVersion) {
    throw new Error("Invalid seed file: missing seedExportVersion");
  }
  if (!seedData.tree) {
    throw new Error("Invalid seed file: missing tree data");
  }

  await useEnergy({ userId, action: "seedPlant" });

  const warnings = [];

  // Check which required extensions are installed
  let installedExts = new Set();
  try {
    const { getLoadedExtensionNames } = await import("../loader.js");
    for (const name of getLoadedExtensionNames()) installedExts.add(name);
  } catch {}

  for (const ext of seedData.requiredExtensions || []) {
    if (!installedExts.has(ext)) {
      warnings.push(`Extension "${ext}" is not installed. Related metadata preserved but inactive.`);
    }
  }

  let nodeCount = 0;
  const maxPlantNodes = 5000;

  async function plantNode(nodeData, parentId, isRoot) {
    if (nodeCount >= maxPlantNodes) {
      warnings.push(`Node cap reached (${maxPlantNodes}). Some branches were not planted.`);
      return null;
    }

    // Create the node
    const newNode = await createNode(
      nodeData.name,
      null,         // schedule
      null,         // reeffectTime
      parentId,
      isRoot,
      userId,
      {},           // values
      {},           // goals
      null,         // note
      null,         // validatedUser
      false,        // wasAi
      null,         // chatId
      null,         // sessionId
      nodeData.type || null,
    );

    nodeCount++;

    // Set status if not active (prestige trimmed branches, completed nodes)
    if (nodeData.status && nodeData.status !== "active") {
      await Node.updateOne({ _id: newNode._id }, { $set: { status: nodeData.status } });
    }

    // Write structural metadata
    if (nodeData.metadata) {
      const nodeDoc = await Node.findById(newNode._id);
      if (nodeDoc) {
        for (const [ns, data] of Object.entries(nodeData.metadata)) {
          try {
            await _metadata.setExtMeta(nodeDoc, ns, data);
          } catch (err) {
            log.debug("SeedExport", `Failed to write metadata namespace "${ns}": ${err.message}`);
          }
        }
      }
    }

    // Recurse for children
    for (const childData of nodeData.children || []) {
      await plantNode(childData, newNode._id.toString(), false);
    }

    return newNode;
  }

  const rootNode = await plantNode(seedData.tree, null, true);
  if (!rootNode) throw new Error("Failed to create root node from seed");

  // Log contribution
  await logContribution({
    userId,
    nodeId: rootNode._id.toString(),
    wasAi: false,
    action: "seed-export:planted",
    extensionData: {
      "seed-export": {
        source: seedData.sourceLand,
        sourceTree: seedData.sourceTreeName,
        nodeCount,
        warnings: warnings.length,
      },
    },
  });

  log.info("SeedExport", `Planted seed "${seedData.sourceTreeName}" from ${seedData.sourceLand} (${nodeCount} nodes, ${warnings.length} warnings)`);

  return {
    rootId: rootNode._id.toString(),
    rootName: rootNode.name,
    nodeCount,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ANALYZE
// ─────────────────────────────────────────────────────────────────────────

export async function analyzeSeed(seedData) {
  if (!seedData?.seedExportVersion) {
    throw new Error("Invalid seed file: missing seedExportVersion");
  }
  if (!seedData.tree) {
    throw new Error("Invalid seed file: missing tree data");
  }

  // Check installed extensions
  let installedExts = new Set();
  try {
    const { getLoadedExtensionNames } = await import("../loader.js");
    for (const name of getLoadedExtensionNames()) installedExts.add(name);
  } catch {}

  const required = seedData.requiredExtensions || [];
  const missing = required.filter(e => !installedExts.has(e));
  const installed = required.filter(e => installedExts.has(e));

  // Count tree stats from seed data
  let nodeCount = 0;
  let maxDepth = 0;
  let delegatedBranches = 0;

  function walk(node, depth) {
    nodeCount++;
    if (depth > maxDepth) maxDepth = depth;
    if (node.delegated) delegatedBranches++;
    for (const child of node.children || []) {
      walk(child, depth + 1);
    }
  }
  walk(seedData.tree, 0);

  return {
    seedExportVersion: seedData.seedExportVersion,
    sourceLand: seedData.sourceLand,
    sourceTreeName: seedData.sourceTreeName,
    exportedAt: seedData.exportedAt,
    exportedBy: seedData.exportedBy,
    nodeCount,
    maxDepth,
    delegatedBranches,
    extensions: {
      required,
      installed,
      missing,
    },
    ready: missing.length === 0,
    cascadeTopology: seedData.cascadeTopology ? seedData.cascadeTopology.length + " connections" : "not included",
    stats: seedData.stats || {},
  };
}
