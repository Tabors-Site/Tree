/**
 * Tree Compress Core
 *
 * Walks from leaves to root. Compresses content at each level.
 * Carries essential meaning upward. Trims what's been absorbed.
 *
 * Two modes:
 * - Full: compress everything up to compressionCeiling
 * - Budget: compress until tree fits under targetSizeBytes
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, NODE_STATUS, CONTENT_TYPE } from "../../seed/protocol.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
let _editStatus = null;
export function setServices(services) {
  _runChat = services.runChat;
  _editStatus = services.editStatus;
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  compressionCeiling: 2,
  targetSizeBytes: null,
  maxNotesPerCompression: 100,
  maxEssenceBytes: 4096,
  autoReviveOnTrip: false,
  compressionModel: null,
};

export async function getCompressConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };
  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("tree-compress") || {}
    : configNode.metadata?.["tree-compress"] || {};
  return { ...DEFAULTS, ...meta };
}

// ─────────────────────────────────────────────────────────────────────────
// TREE ANALYSIS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a depth map of all nodes in a tree. Returns Map<nodeId, { depth, node }>.
 * Walks BFS from the root.
 */
async function buildDepthMap(rootId) {
  const map = new Map();
  const queue = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (map.has(id)) continue;

    const node = await Node.findById(id)
      .select("_id name type status children metadata")
      .lean();
    if (!node) continue;

    map.set(id, { depth, node });

    if (node.children) {
      for (const childId of node.children) {
        if (!map.has(childId.toString())) {
          queue.push({ id: childId.toString(), depth: depth + 1 });
        }
      }
    }
  }

  return map;
}

/**
 * Get nodes grouped by depth, deepest first.
 * Excludes nodes above the ceiling (they stay uncompressed).
 */
function getCompressionOrder(depthMap, ceiling) {
  const byDepth = new Map();
  let maxDepth = 0;

  for (const [nodeId, { depth }] of depthMap) {
    if (depth < ceiling) continue; // above ceiling, skip
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(nodeId);
    if (depth > maxDepth) maxDepth = depth;
  }

  // Return levels deepest first
  const levels = [];
  for (let d = maxDepth; d >= ceiling; d--) {
    if (byDepth.has(d)) levels.push({ depth: d, nodeIds: byDepth.get(d) });
  }
  return levels;
}

/**
 * Estimate metadata size for a tree.
 */
async function estimateTreeSize(rootId) {
  const ids = await getDescendantIds(rootId);
  let totalBytes = 0;
  for (const id of ids) {
    const node = await Node.findById(id).select("metadata").lean();
    if (!node) continue;
    try {
      totalBytes += Buffer.byteLength(JSON.stringify(node.metadata || {}), "utf8");
    } catch { /* non-serializable, skip */ }
  }
  return totalBytes;
}

// ─────────────────────────────────────────────────────────────────────────
// COMPRESSION PROMPTS
// ─────────────────────────────────────────────────────────────────────────

function buildLeafPrompt(node, notes, codebookDict) {
  const codebookSection = codebookDict
    ? `\nCodebook (known shorthand, do not expand these):\n${JSON.stringify(codebookDict)}\n`
    : "";

  return (
    `You are compressing a tree node's content for long-term storage.\n` +
    `Node: "${node.name}"${node.type ? ` (type: ${node.type})` : ""}\n` +
    codebookSection +
    `Notes (${notes.length}):\n${notes.map((n, i) => `[${i + 1}] ${n.content}`).join("\n\n")}\n\n` +
    `Produce JSON:\n` +
    `{\n` +
    `  "summary": "max 500 chars, preserves all actionable meaning",\n` +
    `  "facts": { "key": "value" pairs of extracted structured data },\n` +
    `  "tags": ["topic tags for perspective filtering"]\n` +
    `}\n\n` +
    `Discard opinions, timestamps, conversational filler.\n` +
    `Keep decisions, outcomes, measurements, references.`
  );
}

function buildParentPrompt(node, notes, childEssences, codebookDict) {
  const codebookSection = codebookDict
    ? `\nCodebook (known shorthand, do not expand these):\n${JSON.stringify(codebookDict)}\n`
    : "";

  const childSection = childEssences
    .map((c) => `  "${c.name}": ${JSON.stringify(c.essence)}`)
    .join("\n");

  return (
    `You are merging a node's own content with compressed summaries from its children.\n` +
    `Node: "${node.name}"${node.type ? ` (type: ${node.type})` : ""}\n` +
    codebookSection +
    (notes.length > 0
      ? `\nOwn notes (${notes.length}):\n${notes.map((n, i) => `[${i + 1}] ${n.content}`).join("\n\n")}\n`
      : "\nNo own notes.\n") +
    `\nChild summaries:\n${childSection}\n\n` +
    `Produce JSON:\n` +
    `{\n` +
    `  "summary": "max 800 chars, unified view of this branch",\n` +
    `  "facts": { merged key-value pairs, deduplicated },\n` +
    `  "tags": ["union of relevant tags"],\n` +
    `  "absorbed": ["child node names whose content is fully represented here"]\n` +
    `}\n\n` +
    `If a child's facts are redundant with your own content, absorb them.\n` +
    `If a child's facts add new information, preserve them.\n` +
    `The goal is one coherent summary of this entire branch.`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SINGLE NODE COMPRESSION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compress a single node. Returns the essence or null on failure.
 */
async function compressNode(nodeId, depthMap, userId, username, rootId, config) {
  const entry = depthMap.get(nodeId);
  if (!entry) return null;
  const { node } = entry;

  // Already compressed?
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});
  if (meta.compress?.status === "compressed" || meta.compress?.status === "absorbed") return meta.compress?.essence;

  // Load notes
  const notes = await Note.find({ nodeId, contentType: CONTENT_TYPE.TEXT })
    .sort({ createdAt: 1 })
    .limit(config.maxNotesPerCompression)
    .select("content")
    .lean();

  // Check codebook
  let codebookDict = null;
  try {
    const { getExtension } = await import("../loader.js");
    const codebookExt = getExtension("codebook");
    if (codebookExt?.exports?.getCodebook) {
      // Get any codebook on this node (take first available)
      const cb = meta.codebook;
      if (cb) {
        for (const [uid, data] of Object.entries(cb)) {
          if (data?.dictionary && Object.keys(data.dictionary).length > 0) {
            codebookDict = data.dictionary;
            break;
          }
        }
      }
    }
  } catch {}

  // Determine if leaf or parent
  const hasChildren = node.children && node.children.length > 0;
  const childEssences = [];

  if (hasChildren) {
    for (const childId of node.children) {
      const cid = childId.toString();
      const childEntry = depthMap.get(cid);
      if (!childEntry) continue;
      const childMeta = childEntry.node.metadata instanceof Map
        ? Object.fromEntries(childEntry.node.metadata)
        : (childEntry.node.metadata || {});
      if (childMeta.compress?.essence) {
        childEssences.push({ name: childEntry.node.name, essence: childMeta.compress.essence });
      }
    }
  }

  // Build prompt
  let prompt;
  if (!hasChildren || childEssences.length === 0) {
    if (notes.length === 0) return null; // nothing to compress
    prompt = buildLeafPrompt(node, notes, codebookDict);
  } else {
    prompt = buildParentPrompt(node, notes, childEssences, codebookDict);
  }

  // Call AI
  if (!_runChat) {
    log.warn("TreeCompress", "runChat not available");
    return null;
  }

  try {
    const { answer } = await _runChat({
      userId,
      username: username || "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
    });

    if (!answer) return null;

    const essence = parseJsonSafe(answer);
    if (!essence || typeof essence !== "object") return null;

    // Validate and cap
    if (typeof essence.summary !== "string") essence.summary = "";
    if (essence.summary.length > 800) essence.summary = essence.summary.slice(0, 800);
    if (typeof essence.facts !== "object" || Array.isArray(essence.facts)) essence.facts = {};
    if (!Array.isArray(essence.tags)) essence.tags = [];
    if (!Array.isArray(essence.absorbed)) essence.absorbed = [];

    // Cap total essence size
    const essenceStr = JSON.stringify(essence);
    if (Buffer.byteLength(essenceStr, "utf8") > config.maxEssenceBytes) {
      // Trim facts to fit
      const keys = Object.keys(essence.facts);
      while (keys.length > 0 && Buffer.byteLength(JSON.stringify(essence), "utf8") > config.maxEssenceBytes) {
        delete essence.facts[keys.pop()];
      }
    }

    // Calculate sizes for history
    const noteBytes = notes.reduce((sum, n) => sum + Buffer.byteLength(n.content || "", "utf8"), 0);
    const essenceBytes = Buffer.byteLength(JSON.stringify(essence), "utf8");

    // Write to metadata
    await Node.findByIdAndUpdate(nodeId, {
      $set: {
        "metadata.compress.essence": essence,
        "metadata.compress.status": "compressed",
      },
      $push: {
        "metadata.compress.history": {
          $each: [{
            timestamp: new Date().toISOString(),
            notesBefore: notes.length,
            sizeBeforeBytes: noteBytes,
            sizeAfterBytes: essenceBytes,
            level: entry.depth,
          }],
          $slice: -20,
        },
      },
    });

    // Mark node as trimmed
    if (_editStatus) {
      try {
        await _editStatus({
          nodeId,
          status: NODE_STATUS.TRIMMED,
          userId,
          wasAi: true,
          isInherited: false,
        });
      } catch (err) {
        log.debug("TreeCompress", `Failed to set trimmed status on ${nodeId}: ${err.message}`);
      }
    }

    // Update in-memory depth map
    if (entry.node.metadata instanceof Map) {
      entry.node.metadata.set("compress", { essence, status: "compressed" });
    }

    return essence;
  } catch (err) {
    log.error("TreeCompress", `Compression failed for "${node.name}": ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// COMPRESSION RUNS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Full compression: compress everything from leaves to ceiling.
 */
export async function compressTree(rootId, userId, username) {
  const config = await getCompressConfig();
  const depthMap = await buildDepthMap(rootId);
  const levels = getCompressionOrder(depthMap, config.compressionCeiling);

  let nodesCompressed = 0;

  for (const level of levels) {
    for (const nodeId of level.nodeIds) {
      const result = await compressNode(nodeId, depthMap, userId, username, rootId, config);
      if (result) nodesCompressed++;
    }
  }

  log.verbose("TreeCompress", `Compressed ${nodesCompressed} nodes in tree ${rootId}`);
  return { nodesCompressed, levels: levels.length };
}

/**
 * Branch compression: compress from a specific node downward.
 */
export async function compressBranch(nodeId, userId, username) {
  // Find root for this node
  let rootId;
  try {
    const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
    const root = await resolveRootNode(nodeId);
    rootId = root?._id;
  } catch {
    rootId = nodeId;
  }

  const config = await getCompressConfig();
  const depthMap = await buildDepthMap(nodeId);

  // For branch compression, ceiling is 0 (compress the starting node too)
  const levels = getCompressionOrder(depthMap, 0);
  let nodesCompressed = 0;

  for (const level of levels) {
    for (const nid of level.nodeIds) {
      const result = await compressNode(nid, depthMap, userId, username, rootId, config);
      if (result) nodesCompressed++;
    }
  }

  log.verbose("TreeCompress", `Compressed ${nodesCompressed} nodes in branch ${nodeId}`);
  return { nodesCompressed, levels: levels.length };
}

/**
 * Size-budget compression: compress until tree is under targetSizeBytes.
 */
export async function compressToBudget(rootId, userId, username, targetSizeBytes) {
  const config = await getCompressConfig();
  const target = targetSizeBytes || config.targetSizeBytes;
  if (!target) return { nodesCompressed: 0, message: "No target size configured" };

  let currentSize = await estimateTreeSize(rootId);
  if (currentSize <= target) {
    return { nodesCompressed: 0, currentSize, message: "Already under budget" };
  }

  const depthMap = await buildDepthMap(rootId);
  const levels = getCompressionOrder(depthMap, config.compressionCeiling);
  let nodesCompressed = 0;

  for (const level of levels) {
    if (currentSize <= target) break;

    for (const nodeId of level.nodeIds) {
      if (currentSize <= target) break;
      const result = await compressNode(nodeId, depthMap, userId, username, rootId, config);
      if (result) {
        nodesCompressed++;
        currentSize = await estimateTreeSize(rootId);
      }
    }
  }

  log.verbose("TreeCompress", `Budget compression: ${nodesCompressed} nodes, ${currentSize} bytes (target: ${target})`);
  return { nodesCompressed, currentSize, targetSize: target, underBudget: currentSize <= target };
}

// ─────────────────────────────────────────────────────────────────────────
// DECOMPRESSION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Decompress a node: restore to active. Notes become visible again.
 * Essence stays as a bonus.
 */
export async function decompressNode(nodeId, userId) {
  const node = await Node.findById(nodeId).select("status metadata").lean();
  if (!node) throw new Error("Node not found");

  if (node.status !== NODE_STATUS.TRIMMED) {
    return { message: "Node is not compressed" };
  }

  // Restore status to active
  if (_editStatus) {
    await _editStatus({
      nodeId,
      status: NODE_STATUS.ACTIVE,
      userId,
      wasAi: false,
      isInherited: false,
    });
  }

  // Update compress status but keep essence
  await Node.findByIdAndUpdate(nodeId, {
    $set: { "metadata.compress.status": "decompressed" },
  });

  return { message: "Node decompressed. Notes visible again. Essence preserved." };
}

// ─────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get compression status for a tree.
 */
export async function getCompressStatus(rootId) {
  const depthMap = await buildDepthMap(rootId);

  let compressed = 0;
  let absorbed = 0;
  let uncompressed = 0;
  let totalNodes = 0;
  let totalEssenceBytes = 0;
  const history = [];

  for (const [nodeId, { node }] of depthMap) {
    totalNodes++;
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    const status = meta.compress?.status || "uncompressed";
    if (status === "compressed") compressed++;
    else if (status === "absorbed") absorbed++;
    else uncompressed++;

    if (meta.compress?.essence) {
      try {
        totalEssenceBytes += Buffer.byteLength(JSON.stringify(meta.compress.essence), "utf8");
      } catch {}
    }

    if (meta.compress?.history) {
      for (const h of meta.compress.history) {
        history.push({ nodeId, nodeName: node.name, ...h });
      }
    }
  }

  // Sort history newest first
  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    totalNodes,
    compressed,
    absorbed,
    uncompressed,
    totalEssenceBytes,
    recentHistory: history.slice(0, 20),
  };
}
