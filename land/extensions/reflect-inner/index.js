/**
 * Reflect-Inner (Layer 2)
 *
 * Compresses raw inner thoughts into themes every 24 hours.
 * 200 scattered observations become 5 specific themes.
 */

import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { getNotes } from "../../seed/tree/notes.js";
import { createNote } from "../../seed/tree/notes.js";
import { getExtMeta, mergeExtMeta } from "../../seed/tree/extensionMetadata.js";

const DAILY_MS = 24 * 60 * 60 * 1000;
const MIN_THOUGHTS = 10;
const MAX_REFLECTIONS = 30;
const _reflecting = new Set();

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot?.("reflectInner");

  const { runChat: _runChatDirect } = await import("../../seed/llm/conversation.js");
  const runChat = async (opts) => _runChatDirect({ ...opts, llmPriority: BG });

  core.hooks.register("breath:exhale", ({ rootId, breathRate }) => {
    if (breathRate === "dormant") return;
    reflect(rootId, runChat).catch(err => log.debug("ReflectInner", `Failed: ${err.message}`));
  }, "reflect-inner");

  log.info("ReflectInner", "Loaded. The tree reflects on its own thoughts.");
  return {};
}

async function reflect(rootId, runChat) {
  const rid = String(rootId);
  if (_reflecting.has(rid)) return;
  _reflecting.add(rid);
  try { await _reflect(rootId, runChat); } finally { _reflecting.delete(rid); }
}

async function _reflect(rootId, runChat) {
  // Find .inner node
  const innerNode = await Node.findOne({ parent: rootId, name: ".inner" }).select("_id metadata").lean();
  if (!innerNode) return;

  // Check cooldown
  const meta = getExtMeta(innerNode, "reflect-inner");
  const lastReflection = meta?.lastReflection || 0;
  if (Date.now() - lastReflection < DAILY_MS) return;

  // Get tree owner for LLM access
  const { isUserRoot } = await import("../../seed/landRoot.js");
  const rootNode = await Node.findById(rootId).select("rootOwner systemRole parent").lean();
  if (!isUserRoot(rootNode)) return;
  const ownerId = String(rootNode.rootOwner);

  // Read thoughts
  const result = await getNotes({ nodeId: String(innerNode._id), limit: 200 });
  const thoughts = result?.notes || [];
  if (thoughts.length < MIN_THOUGHTS) return;

  // Build prompt
  const thoughtList = thoughts
    .map(n => n.content)
    .filter(Boolean)
    .join("\n");

  const { answer } = await runChat({
    userId: ownerId,
    username: "reflect-inner",
    message:
      `You are summarizing a tree's internal observations from the past 24 hours.\n\n` +
      `Here are the raw thoughts:\n${thoughtList}\n\n` +
      `Compress into exactly 5 themes. Each theme is one specific sentence.\n` +
      `Not "the user is active" but "the user logs chicken 3x more than any other protein source."\n` +
      `Not "the tree has gaps" but "the study queue has 4 items untouched for 2 weeks."\n\n` +
      `Return as a numbered list. Nothing else.`,
    mode: "tree:respond",
    rootId,
    slot: "reflectInner",
    // Named tree-scoped lane. Chats chain across nightly runs so later
    // reflections see prior-reflection history; stays isolated from the
    // user's active chat under the `tree-internal:${rootId}:reflect` key.
    scope: "tree",
    purpose: "reflect",
  });

  if (!answer || answer.length < 10) return;

  // Find or create .inner.reflect node
  const reflectNode = await getOrCreateReflectNode(String(innerNode._id));
  if (!reflectNode) return;

  // Write themes as a note
  await createNote({
    contentType: "text",
    content: answer.trim(),
    userId: ownerId,
    nodeId: String(reflectNode._id),
    wasAi: true,
  });

  // Update last reflection time. Re-fetch node document for mergeExtMeta (needs full doc, not ID).
  const innerNodeFull = await Node.findById(innerNode._id).select("_id metadata").lean();
  if (innerNodeFull) await mergeExtMeta(innerNodeFull, "reflect-inner", { lastReflection: Date.now() });

  // Cap reflections
  const noteCount = await Note.countDocuments({ nodeId: String(reflectNode._id) });
  if (noteCount > MAX_REFLECTIONS) {
    const oldest = await Note.find({ nodeId: String(reflectNode._id) })
      .sort({ createdAt: 1 })
      .limit(noteCount - MAX_REFLECTIONS)
      .select("_id")
      .lean();
    if (oldest.length > 0) {
      await Note.deleteMany({ _id: { $in: oldest.map(n => n._id) } });
    }
  }

  log.verbose("ReflectInner", `Reflected on ${thoughts.length} thoughts: "${answer.trim().slice(0, 80)}"`);
}

async function getOrCreateReflectNode(innerNodeId) {
  try {
    let node = await Node.findOne({ parent: innerNodeId, name: ".reflect" }).select("_id").lean();
    if (node) return node;

    node = await Node.findOneAndUpdate(
      { parent: innerNodeId, name: ".reflect" },
      {
        $setOnInsert: {
          _id: uuidv4(),
          name: ".reflect",
          parent: innerNodeId,
          status: "active",
          children: [],
          contributors: [],
          metadata: {},
        },
      },
      { upsert: true, new: true, lean: true },
    );

    await Node.updateOne(
      { _id: innerNodeId },
      { $addToSet: { children: node._id } },
    );

    log.verbose("ReflectInner", `Created .reflect node under .inner`);
    return node;
  } catch (err) {
    log.debug("ReflectInner", `Failed to create .reflect node: ${err.message}`);
    return null;
  }
}
