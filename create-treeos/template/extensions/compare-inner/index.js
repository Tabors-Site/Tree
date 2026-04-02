/**
 * Compare-Inner (Layer 3)
 *
 * Compares this week's reflection themes to last week's.
 * Identifies: new (just appeared), gone (resolved), persistent (recurring).
 * Persistent themes across 3+ weeks become character traits.
 * Writes comparisons to .inner.reflect.compare node.
 *
 * Runs weekly. Checks on every breath:exhale but only fires
 * when 7 days have passed since the last comparison.
 *
 * Requires at least 2 reflection notes from reflect-inner (Layer 2)
 * to have material to compare.
 */

import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { getNotes } from "../../seed/tree/notes.js";
import { createNote } from "../../seed/tree/notes.js";
import { getExtMeta, mergeExtMeta } from "../../seed/tree/extensionMetadata.js";

const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REFLECTIONS = 2;
const MAX_COMPARISONS = 12;
const _comparing = new Set();

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot?.("compareInner");

  const { runChat: _runChatDirect } = await import("../../seed/llm/conversation.js");
  const runChat = async (opts) => _runChatDirect({ ...opts, llmPriority: BG });

  core.hooks.register("breath:exhale", ({ rootId, breathRate }) => {
    if (breathRate === "dormant") return;
    compare(rootId, runChat).catch(err => log.debug("CompareInner", `Failed: ${err.message}`));
  }, "compare-inner");

  log.info("CompareInner", "Loaded. The tree watches what it keeps noticing.");
  return {};
}

async function compare(rootId, runChat) {
  const rid = String(rootId);
  if (_comparing.has(rid)) return;
  _comparing.add(rid);
  try { await _compare(rootId, runChat); } finally { _comparing.delete(rid); }
}

async function _compare(rootId, runChat) {
  // Walk the node tree: root -> .inner -> .reflect
  const innerNode = await Node.findOne({ parent: rootId, name: ".inner" }).select("_id").lean();
  if (!innerNode) return;

  const reflectNode = await Node.findOne({ parent: String(innerNode._id), name: ".reflect" }).select("_id metadata").lean();
  if (!reflectNode) return;

  // Check weekly cooldown
  const meta = getExtMeta(reflectNode, "compare-inner");
  const lastComparison = meta?.lastComparison || 0;
  if (Date.now() - lastComparison < WEEKLY_MS) return;

  // Get tree owner for LLM access
  const { isUserRoot } = await import("../../seed/landRoot.js");
  const rootNode = await Node.findById(rootId).select("rootOwner systemRole parent").lean();
  if (!isUserRoot(rootNode)) return;
  const ownerId = String(rootNode.rootOwner);

  // Read reflection notes (themes from Layer 2)
  const result = await getNotes({ nodeId: String(reflectNode._id), limit: 30 });
  const reflections = result?.notes || [];
  if (reflections.length < MIN_REFLECTIONS) return;

  // Split into this week and previous weeks
  const oneWeekAgo = Date.now() - WEEKLY_MS;
  const twoWeeksAgo = Date.now() - (2 * WEEKLY_MS);

  const thisWeek = reflections.filter(n => new Date(n.createdAt).getTime() > oneWeekAgo);
  const lastWeek = reflections.filter(n => {
    const t = new Date(n.createdAt).getTime();
    return t > twoWeeksAgo && t <= oneWeekAgo;
  });
  const older = reflections.filter(n => new Date(n.createdAt).getTime() <= twoWeeksAgo);

  // Need at least this week's themes
  if (thisWeek.length === 0) return;

  // Build the comparison prompt
  const thisWeekThemes = thisWeek.map(n => n.content).join("\n\n");
  const lastWeekThemes = lastWeek.length > 0
    ? lastWeek.map(n => n.content).join("\n\n")
    : "(no themes from last week)";
  const olderThemes = older.length > 0
    ? older.slice(0, 5).map(n => n.content).join("\n\n")
    : "(no older themes)";

  // Read previous comparisons for persistence tracking
  const compareNode = await getOrCreateCompareNode(String(reflectNode._id));
  if (!compareNode) return;

  const prevComparisons = await getNotes({ nodeId: String(compareNode._id), limit: 4 });
  const prevContent = (prevComparisons?.notes || []).map(n => n.content).join("\n---\n");

  const { answer } = await runChat({
    userId: ownerId,
    username: "compare-inner",
    message:
      `You are analyzing how a tree's themes have changed over time.\n\n` +
      `THIS WEEK'S THEMES:\n${thisWeekThemes}\n\n` +
      `LAST WEEK'S THEMES:\n${lastWeekThemes}\n\n` +
      `OLDER THEMES (2+ weeks ago):\n${olderThemes}\n\n` +
      `PREVIOUS COMPARISONS:\n${prevContent || "(none yet)"}\n\n` +
      `Produce a comparison with three sections:\n\n` +
      `NEW: themes that appeared this week but weren't present before. What just started?\n` +
      `GONE: themes from last week that disappeared this week. What resolved or was abandoned?\n` +
      `PERSISTENT: themes that appear in both this week AND last week (or longer). ` +
      `Note how many weeks each has persisted. Three weeks means pattern, not blip.\n\n` +
      `Be specific. Not "user is consistent" but "fitness logging persists (4 weeks), ` +
      `recovery avoidance persists (3 weeks), study stagnation is new this week."\n\n` +
      `Format:\nNEW: [items]\nGONE: [items]\nPERSISTENT: [items with duration]`,
    mode: "tree:respond",
    rootId,
    slot: "compareInner",
  });

  if (!answer || answer.length < 20) return;

  // Write comparison
  await createNote({
    contentType: "text",
    content: answer.trim(),
    userId: ownerId,
    nodeId: String(compareNode._id),
    wasAi: true,
  });

  // Update last comparison time
  await mergeExtMeta(reflectNode._id, "compare-inner", { lastComparison: Date.now() });

  // Cap comparisons
  const noteCount = await Note.countDocuments({ nodeId: String(compareNode._id) });
  if (noteCount > MAX_COMPARISONS) {
    const oldest = await Note.find({ nodeId: String(compareNode._id) })
      .sort({ createdAt: 1 })
      .limit(noteCount - MAX_COMPARISONS)
      .select("_id")
      .lean();
    if (oldest.length > 0) {
      await Note.deleteMany({ _id: { $in: oldest.map(n => n._id) } });
    }
  }

  log.verbose("CompareInner", `Weekly comparison: "${answer.trim().slice(0, 100)}"`);
}

async function getOrCreateCompareNode(reflectNodeId) {
  try {
    let node = await Node.findOne({ parent: reflectNodeId, name: ".compare" }).select("_id").lean();
    if (node) return node;

    node = await Node.findOneAndUpdate(
      { parent: reflectNodeId, name: ".compare" },
      {
        $setOnInsert: {
          _id: uuidv4(),
          name: ".compare",
          parent: reflectNodeId,
          status: "active",
          children: [],
          contributors: [],
          metadata: {},
        },
      },
      { upsert: true, new: true, lean: true },
    );

    await Node.updateOne(
      { _id: reflectNodeId },
      { $addToSet: { children: node._id } },
    );

    log.verbose("CompareInner", "Created .compare node under .reflect");
    return node;
  } catch (err) {
    log.debug("CompareInner", `Failed to create .compare node: ${err.message}`);
    return null;
  }
}
