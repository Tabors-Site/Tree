/**
 * Contradiction Core
 *
 * Detects conflicting truths across tree branches.
 * Writes contradiction records to both involved nodes.
 * Fires cascade signals so the tree propagates awareness.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, CONTENT_TYPE } from "../../seed/protocol.js";
import { getContextForAi } from "../../seed/tree/treeFetch.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";
import { v4 as uuidv4 } from "uuid";

let _runChat = null;
let _checkCascade = null;
let _metadata = null;
export function setServices(services) {
  _runChat = services.runChat;
  _checkCascade = services.checkCascade;
  _metadata = services.metadata;
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  maxContextChars: 8000,
  maxContradictionsPerNode: 50,
  cascadeOnDetection: true,
  minNotesBetweenScans: 5,
};

export async function getContradictionConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };
  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("contradiction") || {}
    : configNode.metadata?.contradiction || {};
  return { ...DEFAULTS, ...meta };
}

// ─────────────────────────────────────────────────────────────────────────
// THROTTLE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Increment the note counter for a node. Returns the new count.
 * Same pattern as codebook's compressionThreshold.
 */
export async function incrementNoteCount(nodeId) {
  await _metadata.incExtMeta(nodeId, "contradiction", "notesSinceLastScan", 1);
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return 0;
  const meta = node.metadata instanceof Map
    ? node.metadata.get("contradiction") || {}
    : node.metadata?.contradiction || {};
  return meta.notesSinceLastScan || 0;
}

/**
 * Reset the note counter after a scan.
 */
export async function resetNoteCount(nodeId) {
  await _metadata.batchSetExtMeta(nodeId, "contradiction", { notesSinceLastScan: 0 });
}

// ─────────────────────────────────────────────────────────────────────────
// DETECTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check a new note against its node's context for contradictions.
 * Returns array of contradiction objects or empty array.
 */
export async function detectContradictions(nodeId, noteContent, userId, username) {
  if (!_runChat || !noteContent || noteContent.trim().length === 0) return [];

  const config = await getContradictionConfig();

  // Build context snapshot for this node
  let contextSummary;
  try {
    const ctx = await getContextForAi(nodeId, {
      includeNotes: true,
      includeChildren: true,
      includeParentChain: true,
      userId,
    });
    contextSummary = JSON.stringify(ctx, null, 0);
    if (contextSummary.length > config.maxContextChars) {
      contextSummary = contextSummary.slice(0, config.maxContextChars);
    }
  } catch (err) {
    log.debug("Contradiction", `Failed to build context for ${nodeId}: ${err.message}`);
    return [];
  }

  // Find the root for runChat
  let rootId = null;
  try {
    const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
    const root = await resolveRootNode(nodeId);
    rootId = root?._id;
  } catch (err) {
    log.debug("Contradiction", "resolveRootNode failed:", err.message);
  }

  const prompt =
    `You are a contradiction detector for a knowledge tree.\n\n` +
    `EXISTING CONTEXT at this position:\n${contextSummary}\n\n` +
    `NEW NOTE just written:\n${noteContent}\n\n` +
    `Does this new note contradict anything in the existing context?\n` +
    `Only report confirmed contradictions, not differences in scope or perspective.\n\n` +
    `If contradictions found, return JSON array:\n` +
    `[\n` +
    `  {\n` +
    `    "claim": "what the new note says",\n` +
    `    "conflictsWith": "what it contradicts in the context",\n` +
    `    "sourceNodeName": "name of the node containing the conflicting info (if identifiable)",\n` +
    `    "severity": "factual" | "intentional" | "temporal",\n` +
    `    "explanation": "brief explanation of the conflict"\n` +
    `  }\n` +
    `]\n\n` +
    `Severity types:\n` +
    `- factual: wrong data, cannot both be true\n` +
    `- intentional: a deliberate change that has not been propagated to related nodes\n` +
    `- temporal: something that was true before but is not now\n\n` +
    `If no contradictions found, return an empty array: []`;

  try {
    const { answer } = await _runChat({
      userId,
      username: username || "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
      nodeId,
      slot: "contradiction",
      // Isolate this background LLM call from the user's active chat
      // session. Without a distinct visitorId, runChat falls back to
      // `{rootId}:{userId}` and our prompt+response get appended to the
      // user-visible session.messages[], leaking the JSON output into the
      // next user turn.
      visitorId: `contradiction:${nodeId}:${Date.now()}`,
      ephemeral: true,
    });

    if (!answer) return [];

    const parsed = parseJsonSafe(answer);
    if (!Array.isArray(parsed)) return [];

    // Validate and clean
    return parsed
      .filter((c) => c && typeof c.claim === "string" && typeof c.conflictsWith === "string")
      .map((c) => ({
        id: uuidv4(),
        claim: c.claim,
        conflictsWith: c.conflictsWith,
        sourceNodeName: c.sourceNodeName || null,
        severity: ["factual", "intentional", "temporal"].includes(c.severity) ? c.severity : "factual",
        explanation: c.explanation || null,
        detectedAt: new Date().toISOString(),
        nodeId,
        status: "active",
      }));
  } catch (err) {
    log.warn("Contradiction", `Detection failed at ${nodeId}: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RECORD WRITING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Write contradiction records to a node's metadata.contradictions.
 * Caps at maxContradictionsPerNode, dropping oldest resolved first.
 */
export async function writeContradictions(nodeId, contradictions) {
  if (!contradictions || contradictions.length === 0) return;

  const config = await getContradictionConfig();
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return;

  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  const existing = Array.isArray(meta.contradictions) ? meta.contradictions : [];

  // Merge new contradictions
  const all = [...existing, ...contradictions];

  // Cap: drop oldest resolved first, then oldest active
  if (all.length > config.maxContradictionsPerNode) {
    const resolved = all.filter((c) => c.status === "resolved");
    const active = all.filter((c) => c.status !== "resolved");
    const trimmed = [
      ...active,
      ...resolved.slice(-(config.maxContradictionsPerNode - active.length)),
    ].slice(-config.maxContradictionsPerNode);
    await _metadata.setExtMeta(await Node.findById(nodeId), "contradictions", trimmed);
  } else {
    await _metadata.setExtMeta(await Node.findById(nodeId), "contradictions", all);
  }
}

/**
 * Fire cascade signal for detected contradictions so related nodes become aware.
 */
export async function cascadeContradictions(nodeId, contradictions) {
  if (!_checkCascade || contradictions.length === 0) return;

  const config = await getContradictionConfig();
  if (!config.cascadeOnDetection) return;

  try {
    await _checkCascade(nodeId, {
      action: "contradiction:detected",
      tags: ["contradiction"],
      contradictions: contradictions.map((c) => ({
        claim: c.claim,
        conflictsWith: c.conflictsWith,
        severity: c.severity,
        sourceNodeName: c.sourceNodeName,
      })),
    });
  } catch (err) {
    log.debug("Contradiction", `Cascade failed for contradictions at ${nodeId}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve a contradiction by ID. Marks it as resolved with a timestamp.
 */
export async function resolveContradiction(nodeId, contradictionId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) throw new Error("Node not found");

  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  const contradictions = Array.isArray(meta.contradictions) ? meta.contradictions : [];
  const entry = contradictions.find((c) => c.id === contradictionId);
  if (!entry) throw new Error("Contradiction not found");

  entry.status = "resolved";
  entry.resolvedAt = new Date().toISOString();

  await _metadata.setExtMeta(await Node.findById(nodeId), "contradictions", contradictions);

  return entry;
}

// ─────────────────────────────────────────────────────────────────────────
// READING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get contradictions for a node.
 */
export async function getContradictions(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return [];
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});
  return Array.isArray(meta.contradictions) ? meta.contradictions : [];
}

// ─────────────────────────────────────────────────────────────────────────
// FULL SCAN
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scan all notes in a tree for contradictions.
 * Processes each node with notes, checking each note against context.
 * Returns total contradictions found.
 */
export async function scanTree(rootId, userId, username) {
  const { getDescendantIds } = await import("../../seed/tree/treeFetch.js");
  const nodeIds = await getDescendantIds(rootId);
  let totalFound = 0;

  for (const nodeId of nodeIds) {
    const node = await Node.findById(nodeId).select("systemRole status").lean();
    if (!node || node.systemRole) continue;
    if (node.status === "trimmed") continue;

    const notes = await Note.find({ nodeId, contentType: CONTENT_TYPE.TEXT })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("content")
      .lean();

    if (notes.length === 0) continue;

    // Check the most recent note against context
    const contradictions = await detectContradictions(nodeId, notes[0].content, userId, username);
    if (contradictions.length > 0) {
      await writeContradictions(nodeId, contradictions);
      await cascadeContradictions(nodeId, contradictions);
      totalFound += contradictions.length;
    }
  }

  return { nodesScanned: nodeIds.length, contradictionsFound: totalFound };
}
