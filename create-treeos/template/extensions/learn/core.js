/**
 * Learn Core
 *
 * Two phases of decomposition:
 *
 * 1. Structural scan (no AI). For text too long for a single AI call,
 *    splits at natural boundaries: markdown headings, numbered sections,
 *    double newlines, paragraph breaks. Creates rough chunks.
 *
 * 2. AI decomposition. For each chunk that fits in context, asks the AI
 *    to identify logical sections with titles. Creates child nodes.
 *    Children that are still too large go back to the queue.
 *
 * State lives in metadata.learn on the root node of the operation.
 * Queue-based BFS. One node at a time. Can pause and resume.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { createNode } from "../../seed/tree/treeManagement.js";
import { createNote } from "../../seed/tree/notes.js";
import { CONTENT_TYPE } from "../../seed/protocol.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

// Held from init
let _runChat = null;
export function setRunChat(fn) { _runChat = fn; }

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_TARGET_SIZE = 3000;     // chars per leaf note (roughly 500 words)
const AI_CONTEXT_LIMIT = 12000;       // max chars to send to AI in one call
const MIN_SECTION_SIZE = 200;         // don't create nodes for tiny fragments
const MAX_SECTIONS_PER_PASS = 15;     // cap sections AI can return per call
const MAX_QUEUE_ITERATIONS = 500;     // safety cap on total processing steps

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Initialize learn state on a node.
 */
export async function initLearnState(nodeId, targetSize) {
  await Node.findByIdAndUpdate(nodeId, {
    $set: {
      "metadata.learn": {
        status: "processing",
        queue: [nodeId],
        targetNoteSize: targetSize || DEFAULT_TARGET_SIZE,
        nodesCreated: 0,
        nodesProcessed: 0,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
    },
  });
}

export async function getLearnState(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get("learn") || null
    : node.metadata?.learn || null;
  return meta;
}

async function updateLearnState(rootId, updates) {
  const setFields = {};
  for (const [key, value] of Object.entries(updates)) {
    setFields[`metadata.learn.${key}`] = value;
  }
  setFields["metadata.learn.lastActivityAt"] = new Date().toISOString();
  await Node.findByIdAndUpdate(rootId, { $set: setFields });
}

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURAL SCAN (no AI, for very long text)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Split long text at natural boundaries without AI.
 * Returns array of { title, content } sections.
 */
export function structuralScan(text, targetSize) {
  const sections = [];

  // Try markdown headings first
  const headingPattern = /^(#{1,3})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingPattern.exec(text)) !== null) {
    headings.push({ level: match[1].length, title: match[2].trim(), index: match.index });
  }

  if (headings.length >= 2) {
    // Split at headings
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].index;
      const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      if (content.length >= MIN_SECTION_SIZE) {
        // Strip the heading line from content (it becomes the node name)
        const firstNewline = content.indexOf("\n");
        const body = firstNewline >= 0 ? content.slice(firstNewline).trim() : content;
        sections.push({ title: headings[i].title, content: body });
      }
    }

    // Handle text before the first heading
    const preamble = text.slice(0, headings[0].index).trim();
    if (preamble.length >= MIN_SECTION_SIZE) {
      sections.unshift({ title: "Preamble", content: preamble });
    }

    if (sections.length >= 2) return sections;
  }

  // Try numbered sections (1. Title, 2. Title, etc.)
  const numberedPattern = /^(\d+)[.)]\s+(.+)$/gm;
  const numbered = [];
  while ((match = numberedPattern.exec(text)) !== null) {
    numbered.push({ num: match[1], title: match[2].trim(), index: match.index });
  }

  if (numbered.length >= 2) {
    for (let i = 0; i < numbered.length; i++) {
      const start = numbered[i].index;
      const end = i + 1 < numbered.length ? numbered[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      if (content.length >= MIN_SECTION_SIZE) {
        const firstNewline = content.indexOf("\n");
        const body = firstNewline >= 0 ? content.slice(firstNewline).trim() : content;
        sections.push({ title: numbered[i].title, content: body });
      }
    }
    if (sections.length >= 2) return sections;
  }

  // Fallback: split at double newlines into roughly targetSize chunks
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  let current = { title: null, content: "" };
  let sectionNum = 1;

  for (const para of paragraphs) {
    if (current.content.length + para.length > targetSize && current.content.length >= MIN_SECTION_SIZE) {
      current.title = current.title || `Part ${sectionNum}`;
      sections.push(current);
      sectionNum++;
      current = { title: null, content: "" };
    }
    current.content += (current.content ? "\n\n" : "") + para.trim();
  }

  if (current.content.length >= MIN_SECTION_SIZE) {
    current.title = current.title || `Part ${sectionNum}`;
    sections.push(current);
  }

  return sections;
}

// ─────────────────────────────────────────────────────────────────────────
// AI DECOMPOSITION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ask AI to identify logical sections in the text.
 * Returns array of { title, content } or null on failure.
 */
export async function aiDecompose(text, userId, username, rootId) {
  if (!_runChat) return null;

  const prompt =
    `You are organizing text into logical sections for a knowledge tree.\n\n` +
    `TEXT TO ORGANIZE:\n${text}\n\n` +
    `Divide this text into logical sections. Each section should be a coherent topic or concept.\n` +
    `Return ONLY a JSON array. Each element: { "title": "Section Title", "content": "The full text of that section" }.\n` +
    `Rules:\n` +
    `- Every word of the original text must appear in exactly one section. Do not summarize or compress.\n` +
    `- Section titles should be descriptive and concise.\n` +
    `- Aim for 2 to ${MAX_SECTIONS_PER_PASS} sections.\n` +
    `- If the text is already focused on a single topic, return a single-element array.\n` +
    `- Preserve the original text exactly. This is organization, not rewriting.`;

  try {
    const { answer } = await _runChat({
      userId,
      username: username || "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
    });

    if (!answer) return null;

    const parsed = parseJsonSafe(answer);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Validate structure
    const valid = parsed.filter(
      (s) => s && typeof s.title === "string" && typeof s.content === "string" && s.content.length > 0,
    );

    return valid.length > 0 ? valid.slice(0, MAX_SECTIONS_PER_PASS) : null;
  } catch (err) {
    log.warn("Learn", `AI decomposition failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// NODE PROCESSING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get all text content from a node's notes, concatenated.
 */
async function getNodeText(nodeId) {
  const notes = await Note.find({ nodeId, contentType: CONTENT_TYPE.TEXT })
    .sort({ createdAt: 1 })
    .select("content")
    .lean();
  return notes.map((n) => n.content).join("\n\n");
}

/**
 * Process a single node in the learn queue.
 * Returns { created: number, addedToQueue: string[] }.
 */
export async function processNode(nodeId, rootId, userId, username, targetSize) {
  const text = await getNodeText(nodeId);

  // If text is under target, this node is done
  if (text.length <= targetSize) {
    return { created: 0, addedToQueue: [] };
  }

  let sections;

  // If text is too long for AI context, structural scan first
  if (text.length > AI_CONTEXT_LIMIT) {
    sections = structuralScan(text, targetSize);
  } else {
    // AI decomposition
    let aiRootId = rootId;
    if (!aiRootId) {
      try {
        const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
        const root = await resolveRootNode(nodeId);
        aiRootId = root?._id || null;
      } catch (err) {
        log.debug("Learn", "Root node resolution failed:", err.message);
      }
    }

    sections = await aiDecompose(text, userId, username, aiRootId);

    // Fall back to structural scan if AI fails or returns single section
    if (!sections || sections.length <= 1) {
      sections = structuralScan(text, targetSize);
    }
  }

  // If still single section or no sections, this node can't be decomposed further
  if (!sections || sections.length <= 1) {
    return { created: 0, addedToQueue: [] };
  }

  // Create child nodes for each section
  const addedToQueue = [];
  let created = 0;

  for (const section of sections) {
    if (section.content.length < MIN_SECTION_SIZE) continue;

    try {
      const result = await createNode(
        section.title,
        null, null,
        nodeId,
        false,
        userId,
        {}, {},
        section.content,
        null,
        true,
        null, null,
        null,
      );

      if (result?.node?._id) {
        created++;

        // If child is still too large, add to queue
        if (section.content.length > targetSize) {
          addedToQueue.push(result.node._id.toString());
        }
      }
    } catch (err) {
      log.warn("Learn", `Failed to create node "${section.title}": ${err.message}`);
    }
  }

  return { created, addedToQueue };
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Process the next batch of nodes in the learn queue.
 * Processes up to maxSteps nodes, then pauses.
 * Returns the updated state.
 */
export async function processQueue(rootId, userId, username, maxSteps = 10) {
  const state = await getLearnState(rootId);
  if (!state || state.status !== "processing") return state;

  const queue = [...(state.queue || [])];
  const targetSize = state.targetNoteSize || DEFAULT_TARGET_SIZE;
  let nodesCreated = state.nodesCreated || 0;
  let nodesProcessed = state.nodesProcessed || 0;
  let steps = 0;

  while (queue.length > 0 && steps < maxSteps && nodesProcessed < MAX_QUEUE_ITERATIONS) {
    const nodeId = queue.shift();
    steps++;

    try {
      const { created, addedToQueue } = await processNode(nodeId, rootId, userId, username, targetSize);
      nodesCreated += created;
      nodesProcessed++;

      for (const childId of addedToQueue) {
        queue.push(childId);
      }

      log.debug("Learn", `Processed node ${nodeId}: ${created} children, ${addedToQueue.length} queued`);
    } catch (err) {
      log.error("Learn", `Failed to process node ${nodeId}: ${err.message}`);
      nodesProcessed++;
    }
  }

  // Determine new status
  const newStatus = queue.length === 0 ? "complete" : "processing";

  await updateLearnState(rootId, {
    status: newStatus,
    queue,
    nodesCreated,
    nodesProcessed,
  });

  return await getLearnState(rootId);
}

/**
 * Pause a learn operation.
 */
export async function pauseLearn(rootId) {
  const state = await getLearnState(rootId);
  if (!state || state.status !== "processing") return state;
  await updateLearnState(rootId, { status: "paused" });
  return await getLearnState(rootId);
}

/**
 * Resume a paused learn operation.
 */
export async function resumeLearn(rootId) {
  const state = await getLearnState(rootId);
  if (!state) return null;
  if (state.status === "complete") return state;
  await updateLearnState(rootId, { status: "processing" });
  return state;
}

/**
 * Stop a learn operation entirely. Clears the queue.
 * Nodes already created stay. Only future processing is cancelled.
 */
export async function stopLearn(rootId) {
  const state = await getLearnState(rootId);
  if (!state) return null;
  await updateLearnState(rootId, { status: "complete", queue: [] });
  return await getLearnState(rootId);
}
