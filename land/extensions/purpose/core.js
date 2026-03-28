/**
 * Purpose Core
 *
 * One thing. It holds the root purpose of the tree
 * and measures everything against it.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, CONTENT_TYPE } from "../../seed/protocol.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
let _metadata = null;
export function setRunChat(fn) { _runChat = fn; }
export function setMetadata(m) { _metadata = m; }

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  rederiveInterval: 100,
  minNotesBetweenChecks: 3,
  coherenceThreshold: {
    high: 0.8,
    medium: 0.4,
  },
};

export async function getPurposeConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };
  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("purpose") || {}
    : configNode.metadata?.purpose || {};
  return { ...DEFAULTS, ...meta };
}

// ─────────────────────────────────────────────────────────────────────────
// THESIS DERIVATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Derive the thesis for a tree from its root node and early notes.
 * The thesis is one sentence. The core purpose everything should serve.
 */
export async function deriveThesis(rootId, userId) {
  if (!_runChat) return null;

  const root = await Node.findById(rootId).select("name type metadata").lean();
  if (!root) return null;

  const rootNotes = await Note.find({
    nodeId: rootId,
    contentType: CONTENT_TYPE.TEXT,
  })
    .sort({ createdAt: 1 })
    .limit(10)
    .select("content")
    .lean();

  const children = await Node.find({ parent: rootId })
    .select("name type")
    .limit(20)
    .lean();

  const childNames = children.map(c => `${c.name}${c.type ? ` (${c.type})` : ""}`).join(", ");

  const existingMeta = root.metadata instanceof Map
    ? root.metadata.get("purpose") || {}
    : root.metadata?.purpose || {};
  const previousThesis = existingMeta.thesis || null;

  const notesText = rootNotes.length > 0
    ? rootNotes.map((n, i) => `[${i + 1}] ${n.content.slice(0, 300)}`).join("\n")
    : "(no notes yet)";

  const previousSection = previousThesis
    ? `\n\nPrevious thesis (refine, do not discard unless the tree has genuinely changed purpose):\n"${previousThesis}"`
    : "";

  const prompt =
    `You are deriving the core purpose of a tree.\n\n` +
    `Tree name: "${root.name}"${root.type ? ` (type: ${root.type})` : ""}\n` +
    `Branches: ${childNames || "(none yet)"}\n` +
    `Root notes:\n${notesText}` +
    previousSection +
    `\n\nWhat is this tree's core purpose? State it in one sentence. ` +
    `This is the thesis everything in this tree should serve. ` +
    `Be specific. Not "organize information." What specific domain, goal, or intention ` +
    `does this tree exist to hold? The thesis should expand as the tree grows but never scatter.\n\n` +
    `Return ONLY the thesis sentence. No explanation. No quotes.`;

  try {
    const { answer } = await _runChat({
      userId,
      username: "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
    });

    if (!answer) return null;

    let thesis = answer.trim().replace(/^["']|["']$/g, "");
    const firstPeriod = thesis.indexOf(".");
    if (firstPeriod > 0 && firstPeriod < thesis.length - 1) {
      thesis = thesis.slice(0, firstPeriod + 1);
    }

    await Node.findByIdAndUpdate(rootId, {
      $set: {
        "metadata.purpose.thesis": thesis,
        "metadata.purpose.derivedAt": new Date().toISOString(),
        "metadata.purpose.notesSinceDerivation": 0,
      },
    });

    log.verbose("Purpose", `Thesis derived for "${root.name}": ${thesis}`);
    return thesis;
  } catch (err) {
    log.warn("Purpose", `Thesis derivation failed for ${rootId}: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// COHERENCE CHECK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check how well a note serves the tree's thesis.
 * Lightweight AI call. Returns a score 0 to 1.
 */
export async function checkCoherence(noteContent, rootId, userId) {
  if (!_runChat || !noteContent) return null;

  const root = await Node.findById(rootId).select("name metadata").lean();
  if (!root) return null;

  const meta = root.metadata instanceof Map
    ? root.metadata.get("purpose") || {}
    : root.metadata?.purpose || {};

  const thesis = meta.thesis;
  if (!thesis) return null;

  const prompt =
    `Tree thesis: "${thesis}"\n\n` +
    `New note: "${noteContent.slice(0, 500)}"\n\n` +
    `Does this note serve the thesis? Score 0.0 to 1.0.\n` +
    `1.0 = directly advances the core purpose.\n` +
    `0.5 = adjacent, related but not central.\n` +
    `0.0 = completely unrelated tangent.\n\n` +
    `Return ONLY a JSON object: { "score": 0.0, "reason": "brief explanation" }`;

  try {
    const { answer } = await _runChat({
      userId,
      username: "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
    });

    if (!answer) return null;

    const result = parseJsonSafe(answer);
    if (!result || typeof result.score !== "number") return null;

    return {
      score: Math.max(0, Math.min(1, result.score)),
      reason: result.reason || null,
    };
  } catch (err) {
    log.debug("Purpose", `Coherence check failed: ${err.message}`);
    return null;
  }
}

/**
 * Batch coherence check. Scores multiple notes in one LLM call.
 * Returns array of { noteId, score, reason }.
 */
export async function checkCoherenceBatch(notes, rootId, userId) {
  if (!_runChat || notes.length === 0) return [];

  const root = await Node.findById(rootId).select("name metadata").lean();
  if (!root) return [];

  const meta = root.metadata instanceof Map
    ? root.metadata.get("purpose") || {}
    : root.metadata?.purpose || {};

  const thesis = meta.thesis;
  if (!thesis) return [];

  const notesList = notes
    .map((n, i) => `[${i + 1}] (id: ${n.noteId}) "${(n.content || "").slice(0, 300)}"`)
    .join("\n");

  const prompt =
    `Tree thesis: "${thesis}"\n\n` +
    `Score each note against the thesis. 1.0 = directly serves it. 0.0 = unrelated tangent.\n\n` +
    `Notes:\n${notesList}\n\n` +
    `Return ONLY a JSON array: [{ "noteId": "...", "score": 0.0, "reason": "brief" }]`;

  try {
    const { answer } = await _runChat({
      userId,
      username: "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
    });

    if (!answer) return [];

    const results = parseJsonSafe(answer);
    if (!Array.isArray(results)) return [];

    return results
      .filter(r => r && typeof r.score === "number")
      .map(r => ({
        noteId: r.noteId || null,
        score: Math.max(0, Math.min(1, r.score)),
        reason: r.reason || null,
      }));
  } catch (err) {
    log.debug("Purpose", `Batch coherence check failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THESIS ACCESS
// ─────────────────────────────────────────────────────────────────────────

export async function getThesis(rootId) {
  const root = await Node.findById(rootId).select("name metadata").lean();
  if (!root) return null;

  const meta = root.metadata instanceof Map
    ? root.metadata.get("purpose") || {}
    : root.metadata?.purpose || {};

  return {
    treeName: root.name,
    thesis: meta.thesis || null,
    derivedAt: meta.derivedAt || null,
    notesSinceDerivation: meta.notesSinceDerivation || 0,
  };
}

export async function incrementNoteCount(rootId) {
  await _metadata.incExtMeta(rootId, "purpose", "notesSinceDerivation", 1);
  // Read back the new count
  const node = await Node.findById(rootId).select("metadata").lean();
  if (!node) return 0;
  const meta = _metadata.getExtMeta(node, "purpose");
  return meta.notesSinceDerivation || 0;
}
