// Boundary Core
//
// Structural cohesion analysis. Five stages:
// 1. Build branch profiles: extract topic + keywords per branch via LLM
// 2. Build similarity matrix: pairwise branch comparison (embed vectors or LLM fallback)
// 3. Detect patterns: blurred boundaries, fragmented concepts, orphaned nodes
// 4. Analyze: full tree analysis, write report to metadata
// 5. AnalyzeBranch: subtree variant, scoped and cheaper
//
// Orphan detection degrades gracefully:
// - Embed installed: per-node cosine math, any branch size
// - No embed, branch <= 20 nodes: LLM batch query
// - No embed, branch > 20 nodes: skipped, report notes the gap

import log from "../../seed/log.js";
import { getExtMeta, setExtMeta, mergeExtMeta } from "../../seed/tree/extensionMetadata.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import { getExtension } from "../loader.js";

let Node = null;
let Note = null;
let logContribution = null;
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
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const MAX_BRANCHES = 15;
const MAX_NOTE_CHARS_PER_BRANCH = 4000;
const MAX_NOTES_PER_NODE = 5;
const BLURRED_THRESHOLD = 0.70;
const BLURRED_HIGH_THRESHOLD = 0.85;
const ORPHAN_THRESHOLD = 0.35;
const FRAGMENTED_MIN_BRANCHES = 3;
const MAX_FINDINGS = 50;
const ORPHAN_LLM_NODE_LIMIT = 20;
const MAX_ORPHAN_NODES_PER_BRANCH = 50;

// ─────────────────────────────────────────────────────────────────────────
// COSINE SIMILARITY (local, no dependency on embed)
// ─────────────────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─────────────────────────────────────────────────────────────────────────
// STAGE 1: BUILD BRANCH PROFILES
// ─────────────────────────────────────────────────────────────────────────

const TOPIC_PROMPT = `You are analyzing a branch of a tree to determine what it is about.

Branch root: "{branchName}"
Node names in this branch: {nodeNames}

Content samples from notes in this branch:
{contentSamples}

What is this branch about? Respond with JSON only:
{
  "topic": "one sentence description of the branch's subject",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`;

/**
 * For each direct child of the analysis root, collect node names and note
 * content, then ask the LLM to produce a topic summary and keywords.
 */
async function buildBranchProfiles(rootId, userId, username) {
  // Get all non-system, non-trimmed nodes in this tree
  const allNodes = await Node.find({
    rootOwner: rootId,
    status: { $ne: "trimmed" },
    systemRole: { $eq: null },
  })
    .select("_id name parent children metadata")
    .lean();

  if (allNodes.length === 0) return { profiles: new Map(), allNodes: [] };

  const nodeMap = new Map();
  for (const n of allNodes) nodeMap.set(n._id.toString(), n);

  // The root's direct children are the branches
  const root = await Node.findById(rootId).select("children").lean();
  if (!root || !root.children) return { profiles: new Map(), allNodes };

  let branchRoots = root.children
    .map(id => nodeMap.get(id.toString()))
    .filter(n => n && !n.systemRole);

  // If more than MAX_BRANCHES, take the largest by descendant count
  if (branchRoots.length > MAX_BRANCHES) {
    const withCounts = branchRoots.map(br => ({
      node: br,
      count: countDescendants(br._id.toString(), nodeMap),
    }));
    withCounts.sort((a, b) => b.count - a.count);
    branchRoots = withCounts.slice(0, MAX_BRANCHES).map(w => w.node);
  }

  // For each branch, collect names + content
  const profiles = new Map();

  for (const br of branchRoots) {
    const brId = br._id.toString();
    const descendants = collectDescendants(brId, nodeMap);
    const nodeNames = descendants.map(id => nodeMap.get(id)?.name).filter(Boolean);
    const nodeIds = descendants;

    // Get recent note content
    const notes = await Note.find({
      nodeId: { $in: nodeIds },
      contentType: "text",
    })
      .sort({ dateCreated: -1 })
      .select("content nodeId")
      .limit(nodeIds.length * MAX_NOTES_PER_NODE)
      .lean();

    let contentChars = 0;
    const samples = [];
    for (const note of notes) {
      if (contentChars >= MAX_NOTE_CHARS_PER_BRANCH) break;
      const snippet = (note.content || "").slice(0, 500);
      samples.push(snippet);
      contentChars += snippet.length;
    }

    // Check for compress essences
    const compressExt = getExtension("tree-compress");
    if (compressExt) {
      for (const nodeId of nodeIds.slice(0, 10)) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        const compressMeta = node.metadata instanceof Map
          ? node.metadata.get("compress")
          : node.metadata?.compress;
        if (compressMeta?.essence) {
          const essenceText = typeof compressMeta.essence === "string"
            ? compressMeta.essence
            : JSON.stringify(compressMeta.essence);
          samples.push(`[Compressed essence] ${essenceText.slice(0, 300)}`);
        }
      }
    }

    // Ask LLM for topic extraction
    const prompt = TOPIC_PROMPT
      .replace("{branchName}", br.name)
      .replace("{nodeNames}", nodeNames.join(", "))
      .replace("{contentSamples}", samples.join("\n---\n") || "(no notes yet)");

    try {
      const result = await runChat({
        userId,
        username,
        message: prompt,
        mode: "tree:respond",
        rootId,
      });

      const parsed = parseJsonSafe(result?.answer);
      if (parsed && parsed.topic) {
        profiles.set(brId, {
          branchName: br.name,
          topic: parsed.topic,
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [],
          nodeCount: descendants.length,
          nodeIds: descendants,
        });
      } else {
        // Fallback: use branch name as topic
        profiles.set(brId, {
          branchName: br.name,
          topic: br.name,
          keywords: [br.name.toLowerCase()],
          nodeCount: descendants.length,
          nodeIds: descendants,
        });
      }
    } catch (err) {
      log.debug("Boundary", `Topic extraction failed for branch ${br.name}: ${err.message}`);
      profiles.set(brId, {
        branchName: br.name,
        topic: br.name,
        keywords: [br.name.toLowerCase()],
        nodeCount: descendants.length,
        nodeIds: descendants,
      });
    }
  }

  return { profiles, allNodes };
}

function countDescendants(nodeId, nodeMap) {
  let count = 0;
  const stack = [nodeId];
  const visited = new Set();
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    count++;
    const node = nodeMap.get(id);
    if (node?.children) {
      for (const child of node.children) {
        stack.push(child.toString());
      }
    }
  }
  return count;
}

function collectDescendants(nodeId, nodeMap) {
  const ids = [];
  const stack = [nodeId];
  const visited = new Set();
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    ids.push(id);
    const node = nodeMap.get(id);
    if (node?.children) {
      for (const child of node.children) {
        stack.push(child.toString());
      }
    }
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────
// STAGE 2: BUILD SIMILARITY MATRIX
// ─────────────────────────────────────────────────────────────────────────

const SIMILARITY_PROMPT = `Rate the semantic similarity between each pair of branch topics on a scale from 0.0 to 1.0.
0.0 means completely unrelated. 1.0 means identical topics.

Branches:
{branchList}

Return a JSON array of objects, one per pair:
[
  { "a": "branch_id_1", "b": "branch_id_2", "similarity": 0.75 }
]

Only include pairs. Do not include self-comparisons.`;

async function buildSimilarityMatrix(profiles, userId, username, rootId) {
  const branchIds = [...profiles.keys()];
  const n = branchIds.length;

  if (n < 2) {
    return { matrix: [], branchIds, embeddings: null };
  }

  // Check if embed extension is available with sufficient coverage
  const embedExt = getExtension("embed");
  let useEmbeddings = false;
  let embeddings = null;

  if (embedExt?.exports?.generateEmbedding) {
    try {
      const status = await embedExt.exports.getEmbedStatus?.();
      const coverage = status?.coverage ?? 0;
      if (coverage >= 0.5) {
        useEmbeddings = true;
      }
    } catch (err) {
      log.debug("Boundary", "Embed status check failed:", err.message);
    }
  }

  // Initialize NxN matrix
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) matrix[i][i] = 1.0;

  if (useEmbeddings) {
    // Vector path: generate embedding per branch profile
    embeddings = new Map();
    for (const [brId, profile] of profiles) {
      const text = `${profile.topic}. Keywords: ${profile.keywords.join(", ")}`;
      try {
        const vector = await embedExt.exports.generateEmbedding(text, userId);
        if (vector) embeddings.set(brId, vector);
      } catch (err) {
        log.debug("Boundary", `Embedding failed for branch ${profile.branchName}: ${err.message}`);
      }
    }

    // Pairwise cosine similarity
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const vecA = embeddings.get(branchIds[i]);
        const vecB = embeddings.get(branchIds[j]);
        if (vecA && vecB) {
          const sim = cosineSimilarity(vecA, vecB);
          matrix[i][j] = sim;
          matrix[j][i] = sim;
        }
      }
    }
  } else {
    // LLM fallback: batch comparison
    const branchList = branchIds.map(id => {
      const p = profiles.get(id);
      return `${id}: "${p.branchName}" -- ${p.topic}`;
    }).join("\n");

    const prompt = SIMILARITY_PROMPT.replace("{branchList}", branchList);

    try {
      const result = await runChat({
        userId,
        username,
        message: prompt,
        mode: "tree:respond",
        rootId,
      });

      const parsed = parseJsonSafe(result?.answer);
      if (Array.isArray(parsed)) {
        const indexMap = new Map();
        for (let i = 0; i < n; i++) indexMap.set(branchIds[i], i);

        for (const pair of parsed) {
          const iA = indexMap.get(pair.a);
          const iB = indexMap.get(pair.b);
          const sim = Number(pair.similarity);
          if (iA != null && iB != null && !isNaN(sim)) {
            matrix[iA][iB] = Math.max(0, Math.min(1, sim));
            matrix[iB][iA] = Math.max(0, Math.min(1, sim));
          }
        }
      }
    } catch (err) {
      log.warn("Boundary", `Similarity matrix LLM call failed: ${err.message}`);
    }
  }

  return { matrix, branchIds, embeddings };
}

// ─────────────────────────────────────────────────────────────────────────
// STAGE 3: DETECT PATTERNS
// ─────────────────────────────────────────────────────────────────────────

const ORPHAN_PROMPT = `You are analyzing nodes in a branch about: "{branchTopic}"

Which of these nodes do NOT belong in this branch? A node doesn't belong if its content is about a completely different subject.

Nodes:
{nodeList}

Return a JSON array of objects for nodes that don't belong:
[
  { "nodeId": "...", "reason": "why it doesn't belong" }
]

If all nodes belong, return: []`;

async function detectPatterns(profiles, matrix, branchIds, allNodes, userId, username, rootId, embeddings) {
  const findings = [];
  const degraded = [];
  const branchSummaries = {};
  const nodeMap = new Map();
  for (const n of allNodes) nodeMap.set(n._id.toString(), n);

  const embedExt = getExtension("embed");
  const hasEmbed = !!(embedExt?.exports?.generateEmbedding);

  // ── Blurred boundaries ──────────────────────────────────────────────
  const n = branchIds.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = matrix[i][j];
      if (sim >= BLURRED_THRESHOLD) {
        const profileA = profiles.get(branchIds[i]);
        const profileB = profiles.get(branchIds[j]);
        findings.push({
          type: "blurred",
          severity: sim >= BLURRED_HIGH_THRESHOLD ? "high" : "moderate",
          description:
            `"${profileA.branchName}" and "${profileB.branchName}" overlap significantly. ` +
            `Both cover: ${profileA.topic}`,
          nodes: [],
          branches: [branchIds[i], branchIds[j]],
          similarity: Math.round(sim * 100) / 100,
          suggestion:
            `Consider consolidating overlapping content between "${profileA.branchName}" and "${profileB.branchName}"`,
        });
      }
    }
  }

  // ── Fragmented concepts ─────────────────────────────────────────────
  const keywordToBranches = new Map();
  for (const [brId, profile] of profiles) {
    for (const kw of profile.keywords) {
      const normalized = kw.toLowerCase().trim();
      if (!normalized) continue;
      if (!keywordToBranches.has(normalized)) keywordToBranches.set(normalized, []);
      keywordToBranches.get(normalized).push(brId);
    }
  }

  for (const [keyword, branches] of keywordToBranches) {
    if (branches.length >= FRAGMENTED_MIN_BRANCHES) {
      const branchNames = branches.map(id => `"${profiles.get(id)?.branchName}"`).join(", ");
      findings.push({
        type: "fragmented",
        severity: branches.length >= 5 ? "high" : "moderate",
        description:
          `The concept "${keyword}" appears across ${branches.length} branches: ${branchNames}`,
        nodes: [],
        branches,
        similarity: null,
        suggestion:
          `Consider consolidating "${keyword}" content into a single branch`,
      });
    }
  }

  // ── Orphaned nodes ──────────────────────────────────────────────────
  for (const [brId, profile] of profiles) {
    const nodeIds = profile.nodeIds || [];
    branchSummaries[brId] = {
      topic: profile.topic,
      coherence: 1.0, // default, refined below
      nodeCount: profile.nodeCount,
      keywords: profile.keywords,
      orphanSkipped: false,
    };

    // Skip the branch root itself
    const childNodeIds = nodeIds.filter(id => id !== brId);
    if (childNodeIds.length === 0) continue;

    if (hasEmbed) {
      // Embed path: per-node cosine similarity
      const cappedIds = childNodeIds.slice(0, MAX_ORPHAN_NODES_PER_BRANCH);
      const branchVector = embeddings?.get(brId);

      if (!branchVector) continue;

      const similarities = [];
      for (const nodeId of cappedIds) {
        // Get the node's most recent note embedding
        try {
          const note = await Note.findOne({
            nodeId,
            contentType: "text",
            "metadata.embed.vector": { $exists: true },
          })
            .sort({ dateCreated: -1 })
            .select("metadata")
            .lean();

          if (!note) continue;

          const vector = note.metadata instanceof Map
            ? note.metadata.get("embed")?.vector
            : note.metadata?.embed?.vector;

          if (!vector) continue;

          const sim = cosineSimilarity(vector, branchVector);
          similarities.push(sim);

          if (sim < ORPHAN_THRESHOLD) {
            const nodeName = nodeMap.get(nodeId)?.name || nodeId;
            findings.push({
              type: "orphaned",
              severity: sim < 0.20 ? "high" : "moderate",
              description:
                `"${nodeName}" in branch "${profile.branchName}" has low semantic similarity ` +
                `(${Math.round(sim * 100) / 100}) to the branch topic: ${profile.topic}`,
              nodes: [nodeId],
              branches: [brId],
              similarity: Math.round(sim * 100) / 100,
              suggestion:
                `Consider moving "${nodeName}" to a more relevant branch`,
            });
          }
        } catch (err) {
          log.debug("Boundary", "Orphan embed lookup failed for node:", err.message);
        }
      }

      // Branch coherence: average similarity
      if (similarities.length > 0) {
        const avg = similarities.reduce((a, b) => a + b, 0) / similarities.length;
        branchSummaries[brId].coherence = Math.round(avg * 100) / 100;
      }

    } else if (childNodeIds.length <= ORPHAN_LLM_NODE_LIMIT) {
      // LLM path for small branches
      const nodeList = [];
      for (const nodeId of childNodeIds) {
        const nodeName = nodeMap.get(nodeId)?.name || nodeId;
        const note = await Note.findOne({ nodeId, contentType: "text" })
          .sort({ dateCreated: -1 })
          .select("content")
          .lean();
        const preview = note?.content?.slice(0, 200) || "(no content)";
        nodeList.push(`${nodeId}: "${nodeName}" -- ${preview}`);
      }

      const prompt = ORPHAN_PROMPT
        .replace("{branchTopic}", profile.topic)
        .replace("{nodeList}", nodeList.join("\n"));

      try {
        const result = await runChat({
          userId,
          username,
          message: prompt,
          mode: "tree:respond",
          rootId,
        });

        const parsed = parseJsonSafe(result?.answer);
        if (Array.isArray(parsed)) {
          for (const orphan of parsed) {
            if (!orphan.nodeId) continue;
            const nodeName = nodeMap.get(orphan.nodeId)?.name || orphan.nodeId;
            findings.push({
              type: "orphaned",
              severity: "moderate",
              description:
                `"${nodeName}" in branch "${profile.branchName}" may not belong. ` +
                `${orphan.reason || "Content does not match branch topic."}`,
              nodes: [orphan.nodeId],
              branches: [brId],
              similarity: null,
              suggestion:
                `Consider moving "${nodeName}" to a more relevant branch`,
            });
          }

          // Rough coherence: proportion of non-orphaned nodes
          const orphanCount = parsed.length;
          const totalNodes = childNodeIds.length;
          branchSummaries[brId].coherence =
            totalNodes > 0
              ? Math.round(((totalNodes - orphanCount) / totalNodes) * 100) / 100
              : 1.0;
        }
      } catch (err) {
        log.debug("Boundary", `Orphan detection failed for branch ${profile.branchName}: ${err.message}`);
      }

    } else {
      // Large branch without embed: skip orphan detection
      branchSummaries[brId].orphanSkipped = true;
      degraded.push(
        `Orphan detection skipped for "${profile.branchName}" (${childNodeIds.length} nodes, no embed extension)`
      );

      // Branch coherence from similarity matrix only (less precise)
      // Use average similarity of this branch to all others as an inverse proxy:
      // a branch very similar to others is less coherent (doing multiple things)
      const brIndex = branchIds.indexOf(brId);
      if (brIndex >= 0) {
        let simSum = 0;
        let simCount = 0;
        for (let j = 0; j < branchIds.length; j++) {
          if (j === brIndex) continue;
          simSum += matrix[brIndex][j];
          simCount++;
        }
        // High avg similarity to other branches = low coherence (branch is too broad)
        const avgSim = simCount > 0 ? simSum / simCount : 0;
        branchSummaries[brId].coherence = Math.round((1 - avgSim) * 100) / 100;
      }
    }
  }

  // Overall coherence: weighted average by node count
  let weightedSum = 0;
  let totalWeight = 0;
  for (const summary of Object.values(branchSummaries)) {
    weightedSum += summary.coherence * summary.nodeCount;
    totalWeight += summary.nodeCount;
  }
  const overallCoherence = totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 100) / 100
    : 1.0;

  // Sort findings by severity (high first), cap at MAX_FINDINGS
  const severityOrder = { high: 0, moderate: 1, low: 2 };
  findings.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

  return {
    findings: findings.slice(0, MAX_FINDINGS),
    branches: branchSummaries,
    overallCoherence,
    degraded,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// STAGE 4: ANALYZE (full tree)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run structural cohesion analysis on an entire tree.
 * Writes the report to metadata.boundary on the root node.
 */
export async function analyze(rootId, userId, username) {
  await useEnergy({ userId, action: "boundaryAnalyze" });

  const root = await Node.findById(rootId).select("_id name rootOwner").lean();
  if (!root) throw new Error("Tree root not found");
  if (!root.rootOwner) throw new Error("Node is not a tree root");

  // Stage 1: build branch profiles
  log.verbose("Boundary", `Analyzing tree ${root.name} (${rootId})`);
  const { profiles, allNodes } = await buildBranchProfiles(rootId, userId, username);

  if (profiles.size === 0) {
    throw new Error("Tree has no branches to analyze");
  }

  // Stage 2: build similarity matrix
  const { matrix, branchIds, embeddings } = await buildSimilarityMatrix(
    profiles, userId, username, rootId
  );

  // Stage 3: detect patterns
  const { findings, branches, overallCoherence, degraded } = await detectPatterns(
    profiles, matrix, branchIds, allNodes, userId, username, rootId, embeddings
  );

  // Build the report
  const report = {
    lastAnalysis: new Date().toISOString(),
    stale: false,
    branches,
    findings,
    overallCoherence,
    analyzedBy: userId,
    branchCount: profiles.size,
    nodeCount: allNodes.length,
    usedEmbeddings: !!embeddings,
    degraded: degraded.length > 0 ? degraded : undefined,
  };

  // Write to root metadata
  const rootDoc = await Node.findById(rootId);
  if (rootDoc) {
    await setExtMeta(rootDoc, "boundary", report);
  }

  // Log contribution
  await logContribution({
    userId,
    nodeId: rootId,
    wasAi: true,
    action: "boundary:analyzed",
    extensionData: {
      boundary: {
        overallCoherence,
        findingsCount: findings.length,
        branchCount: profiles.size,
      },
    },
  });

  log.info(
    "Boundary",
    `Analysis complete for ${root.name}: coherence ${overallCoherence}, ` +
    `${findings.length} finding(s) across ${profiles.size} branch(es)`
  );

  return report;
}

// ─────────────────────────────────────────────────────────────────────────
// STAGE 5: ANALYZE BRANCH (subtree variant)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run cohesion analysis scoped to a subtree.
 * Treats the given node as the analysis root, its children as branches.
 * Writes the report to metadata.boundary on the given node.
 */
export async function analyzeBranch(nodeId, userId, username) {
  await useEnergy({ userId, action: "boundaryBranchScan" });

  const node = await Node.findById(nodeId).select("_id name rootOwner children").lean();
  if (!node) throw new Error("Node not found");

  // Resolve the tree root for context
  let rootId;
  if (node.rootOwner) {
    rootId = nodeId;
  } else {
    const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
    const root = await resolveRootNode(nodeId);
    rootId = root?._id?.toString();
  }
  if (!rootId) throw new Error("Could not resolve tree root");

  // Build profiles scoped to this subtree
  log.verbose("Boundary", `Analyzing subtree from ${node.name} (${nodeId})`);

  // Get all descendants of this node
  const allNodes = await Node.find({
    rootOwner: rootId,
    status: { $ne: "trimmed" },
    systemRole: { $eq: null },
  })
    .select("_id name parent children metadata")
    .lean();

  const nodeMap = new Map();
  for (const n of allNodes) nodeMap.set(n._id.toString(), n);

  // Filter to only descendants of the analysis node
  const descendantIds = new Set(collectDescendants(nodeId, nodeMap));
  const subtreeNodes = allNodes.filter(n => descendantIds.has(n._id.toString()));

  if (subtreeNodes.length === 0) {
    throw new Error("Subtree has no nodes to analyze");
  }

  // Use the analysis node as root, its children as branches
  const { profiles } = await buildBranchProfiles(nodeId, userId, username);

  if (profiles.size === 0) {
    throw new Error("Subtree has no branches to analyze");
  }

  const { matrix, branchIds, embeddings } = await buildSimilarityMatrix(
    profiles, userId, username, rootId
  );

  const { findings, branches, overallCoherence, degraded } = await detectPatterns(
    profiles, matrix, branchIds, subtreeNodes, userId, username, rootId, embeddings
  );

  const report = {
    lastAnalysis: new Date().toISOString(),
    stale: false,
    branches,
    findings,
    overallCoherence,
    analyzedBy: userId,
    branchCount: profiles.size,
    nodeCount: subtreeNodes.length,
    usedEmbeddings: !!embeddings,
    degraded: degraded.length > 0 ? degraded : undefined,
    subtreeOf: nodeId,
  };

  // Write to this node's metadata (not the tree root)
  const nodeDoc = await Node.findById(nodeId);
  if (nodeDoc) {
    await setExtMeta(nodeDoc, "boundary", report);
  }

  await logContribution({
    userId,
    nodeId,
    wasAi: true,
    action: "boundary:branch-analyzed",
    extensionData: {
      boundary: {
        overallCoherence,
        findingsCount: findings.length,
        branchCount: profiles.size,
      },
    },
  });

  log.verbose(
    "Boundary",
    `Branch analysis complete for ${node.name}: coherence ${overallCoherence}, ` +
    `${findings.length} finding(s)`
  );

  return report;
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS (exported for other extensions)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read the last boundary analysis report from a tree root's metadata.
 */
export async function getBoundaryReport(rootId) {
  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  return getExtMeta(root, "boundary") || null;
}

/**
 * Mark the boundary analysis as stale without clearing the report.
 * Called by afterNote hook when content changes.
 */
export async function markStale(rootId) {
  const root = await Node.findById(rootId);
  if (!root) return;

  const meta = getExtMeta(root, "boundary");
  if (!meta || !meta.lastAnalysis) return; // nothing to mark stale
  if (meta.stale) return; // already stale

  await mergeExtMeta(root, "boundary", { stale: true });
}

/**
 * Extract orphaned findings formatted for reroot consumption.
 * Returns: [{ nodeId, nodeName, currentBranch, reason }]
 */
export async function getOrphanedNodes(rootId) {
  const report = await getBoundaryReport(rootId);
  if (!report || !report.findings) return [];

  return report.findings
    .filter(f => f.type === "orphaned" && f.nodes?.length > 0)
    .map(f => ({
      nodeId: f.nodes[0],
      description: f.description,
      currentBranch: f.branches?.[0] || null,
      suggestion: f.suggestion,
    }));
}
