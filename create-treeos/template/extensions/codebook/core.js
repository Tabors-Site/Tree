/**
 * Codebook Core
 *
 * Tracks note accumulation per user-node pair. When enough new material
 * has accumulated, runs a compression pass via runChat to extract a
 * dictionary of recurring concepts, shorthand, and compressed references.
 *
 * The dictionary lives in metadata.codebook on the node, namespaced by userId.
 * enrichContext injects it so the AI picks up the compressed language.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, CONTENT_TYPE } from "../../seed/protocol.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

// Held from init
let _runChat = null;
export function setRunChat(fn) { _runChat = fn; }

// ─────────────────────────────────────────────────────────────────────────
// CONFIG (stored on .config metadata.codebook)
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  compressionThreshold: 20,   // notes before triggering compression
  maxNotesForPrompt: 40,      // recent notes fed to the compression prompt
  minInteractions: 5,         // minimum long-memory interactions before codebook activates
  maxDictionaryEntries: 30,   // cap entries in the dictionary
};

export async function getCodebookConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };

  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("codebook") || {}
    : configNode.metadata?.codebook || {};

  return {
    compressionThreshold: meta.compressionThreshold ?? DEFAULTS.compressionThreshold,
    maxNotesForPrompt: meta.maxNotesForPrompt ?? DEFAULTS.maxNotesForPrompt,
    minInteractions: meta.minInteractions ?? DEFAULTS.minInteractions,
    maxDictionaryEntries: meta.maxDictionaryEntries ?? DEFAULTS.maxDictionaryEntries,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ACCUMULATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Increment the note counter for a user-node pair.
 * Returns the new count.
 */
export async function incrementNoteCount(nodeId, userId) {
  const key = `metadata.codebook.${userId}.notesSinceCompression`;

  const result = await Node.findByIdAndUpdate(
    nodeId,
    { $inc: { [key]: 1 } },
    { new: true, select: `metadata` },
  ).lean();

  if (!result) return 0;

  const meta = result.metadata instanceof Map
    ? result.metadata.get("codebook") || {}
    : result.metadata?.codebook || {};

  return meta[userId]?.notesSinceCompression || 0;
}

/**
 * Reset the note counter after compression.
 */
async function resetNoteCount(nodeId, userId) {
  const key = `metadata.codebook.${userId}.notesSinceCompression`;
  await Node.findByIdAndUpdate(nodeId, { $set: { [key]: 0 } });
}

// ─────────────────────────────────────────────────────────────────────────
// LONG MEMORY CHECK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if a node has enough interaction history to justify compression.
 * Uses long-memory's metadata.memory if available.
 */
async function hasEnoughHistory(nodeId, minInteractions) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return false;

  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  const memory = meta.memory;
  if (!memory) return true; // No long-memory installed, skip the check

  return (memory.totalInteractions || 0) >= minInteractions;
}

// ─────────────────────────────────────────────────────────────────────────
// COMPRESSION
// ─────────────────────────────────────────────────────────────────────────

// In-flight compression guard: don't run two compressions on the same pair
const _inFlight = new Set();

/**
 * Run a compression pass for a user-node pair.
 * Loads recent notes, builds a prompt, calls runChat, parses the result,
 * and writes the dictionary to metadata.codebook.{userId}.dictionary.
 */
export async function runCompression(nodeId, userId, username) {
  const pairKey = `${nodeId}:${userId}`;
  if (_inFlight.has(pairKey)) return null;
  _inFlight.add(pairKey);

  try {
    if (!_runChat) {
      log.warn("Codebook", "runChat not available, skipping compression");
      return null;
    }

    const config = await getCodebookConfig();

    // Check long-memory interaction threshold
    const enough = await hasEnoughHistory(nodeId, config.minInteractions);
    if (!enough) {
      log.debug("Codebook", `Node ${nodeId} below interaction threshold, skipping compression`);
      await resetNoteCount(nodeId, userId);
      return null;
    }

    // Load recent notes at this node from this user
    const notes = await Note.find({
      nodeId,
      userId,
      contentType: CONTENT_TYPE.TEXT,
    })
      .sort({ createdAt: -1 })
      .limit(config.maxNotesForPrompt)
      .select("content createdAt")
      .lean();

    if (notes.length < 3) {
      await resetNoteCount(nodeId, userId);
      return null;
    }

    // Load existing dictionary if any
    const node = await Node.findById(nodeId).select("name metadata").lean();
    const meta = node?.metadata instanceof Map
      ? node.metadata.get("codebook") || {}
      : node?.metadata?.codebook || {};
    const existingDict = meta[userId]?.dictionary || null;

    // Build compression prompt
    const noteTexts = notes
      .reverse()
      .map((n, i) => `[${i + 1}] ${n.content}`)
      .join("\n\n");

    const existingSection = existingDict
      ? `\n\nExisting codebook dictionary (update and expand, do not discard valid entries):\n${JSON.stringify(existingDict, null, 2)}`
      : "";

    const prompt =
      `You are analyzing the conversation history between a user and this node to extract a codebook dictionary.\n\n` +
      `Node: "${node?.name || nodeId}"\n` +
      `Recent notes (${notes.length}):\n${noteTexts}` +
      existingSection +
      `\n\nExtract recurring concepts, shorthand, compressed references, and frequently used terms ` +
      `into a dictionary. Each entry should have a short key and a description of what it means ` +
      `in the context of this relationship. Keep entries dense and useful. Maximum ${config.maxDictionaryEntries} entries.\n\n` +
      `Respond with ONLY a JSON object. Keys are the shorthand/concept. Values are brief descriptions.\n` +
      `Example: { "standup": "daily morning sync meeting with the design team", "the refactor": "ongoing migration from REST to GraphQL in the payments service" }`;

    // Find the root for this node (needed for runChat)
    let rootId = null;
    try {
      const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
      const root = await resolveRootNode(nodeId);
      rootId = root?._id || null;
    } catch (err) {
      log.debug("Codebook", "Root node resolution failed:", err.message);
    }

    const { answer } = await _runChat({
      userId,
      username: username || "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
      nodeId,
      slot: "codebook",
    });

    if (!answer) {
      log.debug("Codebook", `Compression returned empty for ${pairKey}`);
      await resetNoteCount(nodeId, userId);
      return null;
    }

    // Parse the dictionary from the AI response
    const dictionary = parseJsonSafe(answer);
    if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
      log.warn("Codebook", `Compression produced invalid dictionary for ${pairKey}`);
      await resetNoteCount(nodeId, userId);
      return null;
    }

    // Cap entries
    const entries = Object.entries(dictionary).slice(0, config.maxDictionaryEntries);
    const capped = Object.fromEntries(entries);

    // Write to metadata
    const dictKey = `metadata.codebook.${userId}.dictionary`;
    const tsKey = `metadata.codebook.${userId}.lastCompressed`;
    const countKey = `metadata.codebook.${userId}.notesSinceCompression`;

    await Node.findByIdAndUpdate(nodeId, {
      $set: {
        [dictKey]: capped,
        [tsKey]: new Date().toISOString(),
        [countKey]: 0,
      },
    });

    log.verbose("Codebook", `Compressed ${notes.length} notes into ${entries.length} entries for ${pairKey}`);
    return capped;
  } catch (err) {
    log.error("Codebook", `Compression failed for ${pairKey}: ${err.message}`);
    return null;
  } finally {
    _inFlight.delete(pairKey);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// READER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the codebook dictionary for a user at a node.
 */
export async function getCodebook(nodeId, userId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;

  const meta = node.metadata instanceof Map
    ? node.metadata.get("codebook") || {}
    : node.metadata?.codebook || {};

  return meta[userId] || null;
}

/**
 * Clear the codebook for a user at a node.
 */
export async function clearCodebook(nodeId, userId) {
  const key = `metadata.codebook.${userId}`;
  await Node.findByIdAndUpdate(nodeId, { $unset: { [key]: 1 } });
}
