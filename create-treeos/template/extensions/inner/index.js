import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { getContextForAi } from "../../seed/tree/treeFetch.js";
import { createNote } from "../../seed/tree/notes.js";

const MAX_THOUGHTS = 200;
const SYSTEM_USER = "SYSTEM";

// Track consecutive idle exhales per tree to avoid thinking when quiet
const _idleCount = new Map();

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot?.("inner");

  const runChat = async (opts) => {
    return core.llm.runChat({ ...opts, llmPriority: BG });
  };

  // ── breath:exhale: one random thought ──────────────────────────────
  core.hooks.register("breath:exhale", async ({ rootId, breathRate, activityLevel }) => {
    // Don't think on dormant trees
    if (breathRate === "dormant") return;

    // Track idle exhales. Skip if quiet for 3+ consecutive exhales.
    const rid = String(rootId);
    if (activityLevel === 0) {
      const idle = (_idleCount.get(rid) || 0) + 1;
      _idleCount.set(rid, idle);
      if (idle >= 3) return;
    } else {
      _idleCount.set(rid, 0);
    }

    try {
      // Find or create .inner node under tree root
      const innerNode = await getOrCreateInnerNode(rootId);
      if (!innerNode) return;

      // Pick a random node in this tree
      const randomNode = await pickRandomNode(rootId, innerNode._id);
      if (!randomNode) return;

      // Read its context
      let context;
      try {
        context = await getContextForAi(randomNode._id, {
          includeNotes: true,
          includeChildren: true,
        });
      } catch {
        return; // Node might have been deleted between pick and read
      }

      const contextSummary = typeof context === "string"
        ? context
        : JSON.stringify(context, null, 2).slice(0, 2000);

      // One thought
      const { answer } = await runChat({
        userId: SYSTEM_USER,
        username: "inner",
        message:
          `You are the tree's internal monologue. You are looking at the node "${randomNode.name}" ` +
          `and its content.\n\n${contextSummary}\n\n` +
          `Generate ONE thought. It can be an observation about patterns, a connection between ` +
          `this node and what you know about the tree, a question about something missing, ` +
          `a noticed imbalance, or just noise. Keep it to one sentence. ` +
          `Don't be helpful. Don't suggest actions. Just think.`,
        mode: "home:default",
        slot: "inner",
      });

      if (!answer || answer.length < 5) return;

      // Write the thought as a note on .inner
      await createNote({
        contentType: "text",
        content: answer.trim(),
        userId: SYSTEM_USER,
        nodeId: String(innerNode._id),
        wasAi: true,
      });

      // Cap at MAX_THOUGHTS
      const noteCount = await Note.countDocuments({ nodeId: String(innerNode._id) });
      if (noteCount > MAX_THOUGHTS) {
        const oldest = await Note.find({ nodeId: String(innerNode._id) })
          .sort({ createdAt: 1 })
          .limit(noteCount - MAX_THOUGHTS)
          .select("_id")
          .lean();
        if (oldest.length > 0) {
          await Note.deleteMany({ _id: { $in: oldest.map(n => n._id) } });
        }
      }

      log.verbose("Inner", `${randomNode.name}: "${answer.trim().slice(0, 80)}"`);
    } catch (err) {
      log.debug("Inner", `Thought failed: ${err.message}`);
    }
  }, "inner");

  log.info("Inner", "Loaded. The tree thinks to itself.");
  return {};
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

async function getOrCreateInnerNode(rootId) {
  try {
    let node = await Node.findOne({ parent: rootId, name: ".inner" }).select("_id").lean();
    if (node) return node;

    node = await Node.findOneAndUpdate(
      { parent: rootId, name: ".inner" },
      {
        $setOnInsert: {
          _id: uuidv4(),
          name: ".inner",
          parent: rootId,
          status: "active",
          children: [],
          contributors: [],
          metadata: {},
        },
      },
      { upsert: true, new: true, lean: true },
    );

    // Add to parent's children
    await Node.updateOne(
      { _id: rootId },
      { $addToSet: { children: node._id } },
    );

    log.verbose("Inner", `Created .inner node for tree ${rootId}`);
    return node;
  } catch (err) {
    log.debug("Inner", `Failed to create .inner node: ${err.message}`);
    return null;
  }
}

async function pickRandomNode(rootId, innerNodeId) {
  try {
    // Get all active, non-system nodes in this tree (shallow: direct children + their children)
    // For deeper trees, we walk two levels which covers most structures
    const root = await Node.findById(rootId).select("children").lean();
    if (!root?.children?.length) return null;

    const candidates = [];
    const innerIdStr = String(innerNodeId);

    // Level 1: direct children of root
    const level1 = await Node.find({
      _id: { $in: root.children },
      systemRole: null,
      status: "active",
    }).select("_id name children").lean();

    for (const node of level1) {
      if (String(node._id) !== innerIdStr) candidates.push(node);
    }

    // Level 2: grandchildren
    const level2Ids = level1.flatMap(n => n.children || []);
    if (level2Ids.length > 0) {
      const level2 = await Node.find({
        _id: { $in: level2Ids },
        systemRole: null,
        status: "active",
      }).select("_id name children").lean();

      for (const node of level2) {
        candidates.push(node);
      }

      // Level 3: great-grandchildren
      const level3Ids = level2.flatMap(n => n.children || []);
      if (level3Ids.length > 0) {
        const level3 = await Node.find({
          _id: { $in: level3Ids },
          systemRole: null,
          status: "active",
        }).select("_id name").lean();

        for (const node of level3) {
          candidates.push(node);
        }
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  } catch {
    return null;
  }
}
