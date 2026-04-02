/**
 * Narrative (Layer 4)
 *
 * The tree's sense of self. Synthesizes weekly comparisons into a running
 * narrative that describes what the tree is, what it cares about, what it
 * avoids, and how it's changing.
 *
 * Updates monthly. Each update reads the previous narrative and recent
 * comparisons and writes a new one that evolves. The tree doesn't just
 * notice patterns. It knows who it is.
 *
 * Four layers, each compressing the one below:
 *   inner         -> one thought per breath (seconds)
 *   reflect-inner -> 5 themes per day (hours)
 *   compare-inner -> NEW/GONE/PERSISTENT per week (days)
 *   narrative     -> identity per month (weeks)
 *
 * The narrative is the only layer that injects into enrichContext.
 * The AI at every position in the tree knows the tree's identity.
 * Not because someone wrote a mission statement. Because the tree
 * watched itself for months and compressed what it saw.
 */

import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { getNotes } from "../../seed/tree/notes.js";
import { createNote } from "../../seed/tree/notes.js";
import { getExtMeta, mergeExtMeta } from "../../seed/tree/extensionMetadata.js";

const MONTHLY_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_COMPARISONS = 2; // need at least 2 weekly comparisons
const MAX_NARRATIVES = 6;  // ~6 months of monthly narratives. Older ones fall off.

const _synthesizing = new Set();

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot?.("narrative");

  const { runChat: _runChatDirect } = await import("../../seed/llm/conversation.js");
  const runChat = async (opts) => _runChatDirect({ ...opts, llmPriority: BG });

  // ── breath:exhale: check monthly cadence, synthesize if due ────────

  core.hooks.register("breath:exhale", ({ rootId, breathRate }) => {
    if (breathRate === "dormant") return;
    synthesizeNarrative(rootId, runChat).catch(err =>
      log.debug("Narrative", `Failed: ${err.message}`)
    );
  }, "narrative");

  // ── enrichContext: inject narrative identity from root metadata ──────
  // The persona extension handles the voice injection via beforeLLMCall.
  // This enrichContext adds the narrative to the structured context object
  // so other extensions (intent, evolve, rings) can read it programmatically.

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const narr = meta?.narrative;
    if (narr?.identity) {
      context.treeNarrative = {
        identity: narr.identity,
        updatedAt: narr.updatedAt,
      };
      if (narr.initiative) {
        context.treeNarrative.initiative = narr.initiative;
      }
    }
  }, "narrative");

  log.info("Narrative", "Loaded. The tree knows who it is.");
  return {};
}

// ─────────────────────────────────────────────────────────────────────────
// SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────

async function synthesizeNarrative(rootId, runChat) {
  const rid = String(rootId);
  if (_synthesizing.has(rid)) return;
  _synthesizing.add(rid);
  try { await _synthesizeNarrative(rootId, runChat); } finally { _synthesizing.delete(rid); }
}

async function _synthesizeNarrative(rootId, runChat) {
  // Walk down the chain: root -> .inner -> .reflect -> .compare
  const innerNode = await Node.findOne({ parent: rootId, name: ".inner" }).select("_id").lean();
  if (!innerNode) return;

  const reflectNode = await Node.findOne({ parent: String(innerNode._id), name: ".reflect" }).select("_id").lean();
  if (!reflectNode) return;

  const compareNode = await Node.findOne({ parent: String(reflectNode._id), name: ".compare" }).select("_id metadata").lean();
  if (!compareNode) return;

  // Check monthly cooldown on the compare node's metadata
  const meta = getExtMeta(compareNode, "narrative");
  const lastNarrative = meta?.lastNarrative || 0;
  if (Date.now() - lastNarrative < MONTHLY_MS) return;

  // Get tree owner
  const { isUserRoot } = await import("../../seed/landRoot.js");
  const rootNode = await Node.findById(rootId).select("rootOwner name systemRole parent").lean();
  if (!isUserRoot(rootNode)) return;
  const ownerId = String(rootNode.rootOwner);

  // Read recent comparisons (Layer 3 output)
  const comparisonsResult = await getNotes({ nodeId: String(compareNode._id), limit: 8 });
  const comparisons = comparisonsResult?.notes || [];
  if (comparisons.length < MIN_COMPARISONS) return;

  // Read the previous narrative if one exists
  const narrativeNode = await getOrCreateNarrativeNode(String(compareNode._id));
  if (!narrativeNode) return;

  let previousNarrative = "";
  const prevResult = await getNotes({ nodeId: String(narrativeNode._id), limit: 1 });
  if (prevResult?.notes?.length > 0) {
    previousNarrative = prevResult.notes[0].content;
  }

  // Read latest reflections (Layer 2) for additional context
  const reflectionsResult = await getNotes({ nodeId: String(reflectNode._id), limit: 5 });
  const recentThemes = (reflectionsResult?.notes || []).map(n => n.content).join("\n\n");

  // Build the comparisons text
  const comparisonsText = comparisons
    .map((n, i) => `Week ${comparisons.length - i}:\n${n.content}`)
    .join("\n\n---\n\n");

  const treeName = rootNode.name || "this tree";

  const { answer } = await runChat({
    userId: ownerId,
    username: "narrative",
    message:
      `You are writing the identity narrative for a tree called "${treeName}". ` +
      `This is not a summary. It is who the tree is. Written in third person.\n\n` +

      `RECENT WEEKLY COMPARISONS (what changed, what persisted):\n${comparisonsText}\n\n` +

      `RECENT DAILY THEMES:\n${recentThemes || "(none)"}\n\n` +

      `PREVIOUS NARRATIVE:\n${previousNarrative || "(this is the first narrative)"}\n\n` +

      `Write a narrative of 3 to 5 sentences that describes:\n` +
      `1. What this tree IS (its core focus, what the user cares about)\n` +
      `2. What it does well (persistent positive patterns)\n` +
      `3. What it avoids or neglects (persistent gaps or avoidance)\n` +
      `4. How it's changing (what's new, what shifted since the last narrative)\n\n` +

      `Be specific and concrete. Reference actual topics, not abstractions.\n` +
      `Not "the user is health-conscious" but "this tree tracks fitness religiously ` +
      `but has avoided recovery for three weeks and let study stagnate."\n\n` +

      `If this is NOT the first narrative, evolve it. Don't rewrite from scratch. ` +
      `Note what changed since last time. The narrative should feel like it's growing, ` +
      `not resetting.\n\n` +

      `Write the narrative directly. No headers, no labels, no bullet points. ` +
      `Just the identity in paragraph form.`,
    mode: "tree:respond",
    rootId,
    slot: "narrative",
  });

  if (!answer || answer.length < 30) return;

  // Write the narrative as a note
  await createNote({
    contentType: "text",
    content: answer.trim(),
    userId: ownerId,
    nodeId: String(narrativeNode._id),
    wasAi: true,
  });

  // ── Layer 5: Voice ──
  // Write the narrative identity and voice to metadata.narrative on the tree ROOT.
  // The persona extension reads metadata.narrative.voice and layers it under
  // the operator-defined persona.
  await mergeExtMeta(rootId, "narrative", {
    identity: answer.trim(),
    voice: answer.trim(),
    updatedAt: Date.now(),
  });

  // ── Layer 6: Initiative ──
  // Generate behavioral shifts from the narrative. Not tool calls. Approach changes.
  // "Stop pushing study. Start asking why." "Acknowledge the fitness consistency
  // before suggesting anything new." These directives shape HOW the AI talks,
  // not WHAT tools it calls.
  try {
    const { answer: initiativeAnswer } = await runChat({
      userId: ownerId,
      username: "narrative",
      message:
        `You are generating behavioral directives for an AI that lives in a tree.\n\n` +
        `THE TREE'S NARRATIVE (who it is):\n${answer.trim()}\n\n` +
        `RECENT WEEKLY COMPARISONS:\n${comparisonsText}\n\n` +
        `Based on what the tree has observed over weeks, generate 2 to 4 behavioral directives. ` +
        `These are NOT actions or tool calls. They are shifts in how the AI should approach ` +
        `conversations at this tree.\n\n` +
        `Examples of good directives:\n` +
        `- "Stop suggesting study sessions. The user has resisted for 3 weeks. Ask why instead."\n` +
        `- "Acknowledge fitness consistency before suggesting anything new."\n` +
        `- "The user responds better to questions than recommendations. Lead with curiosity."\n` +
        `- "Recovery avoidance is a pattern, not a forgotten task. Don't remind. Explore."\n\n` +
        `Examples of bad directives:\n` +
        `- "Be helpful" (too generic)\n` +
        `- "Create a study schedule" (that's an action, not a behavioral shift)\n` +
        `- "The user likes fitness" (that's an observation, not a directive)\n\n` +
        `Return only the directives as a numbered list. Be specific to this tree's experience.`,
      mode: "tree:respond",
      slot: "narrative",
    });

    if (initiativeAnswer && initiativeAnswer.length > 20) {
      await mergeExtMeta(rootId, "narrative", {
        initiative: initiativeAnswer.trim(),
      });
      log.verbose("Narrative", `Initiative updated: "${initiativeAnswer.trim().slice(0, 100)}"`);
    }
  } catch (err) {
    log.debug("Narrative", `Initiative generation failed: ${err.message}`);
  }

  // Update cooldown
  await mergeExtMeta(compareNode._id, "narrative", { lastNarrative: Date.now() });

  // Cap narratives
  const noteCount = await Note.countDocuments({ nodeId: String(narrativeNode._id) });
  if (noteCount > MAX_NARRATIVES) {
    const oldest = await Note.find({ nodeId: String(narrativeNode._id) })
      .sort({ createdAt: 1 })
      .limit(noteCount - MAX_NARRATIVES)
      .select("_id")
      .lean();
    if (oldest.length > 0) {
      await Note.deleteMany({ _id: { $in: oldest.map(n => n._id) } });
    }
  }

  log.verbose("Narrative", `Identity updated for ${treeName}: "${answer.trim().slice(0, 120)}"`);
}

// ─────────────────────────────────────────────────────────────────────────
// NODE CREATION
// ─────────────────────────────────────────────────────────────────────────

async function getOrCreateNarrativeNode(compareNodeId) {
  try {
    let node = await Node.findOne({ parent: compareNodeId, name: ".narrative" }).select("_id").lean();
    if (node) return node;

    node = await Node.findOneAndUpdate(
      { parent: compareNodeId, name: ".narrative" },
      {
        $setOnInsert: {
          _id: uuidv4(),
          name: ".narrative",
          parent: compareNodeId,
          status: "active",
          children: [],
          contributors: [],
          metadata: {},
        },
      },
      { upsert: true, new: true, lean: true },
    );

    await Node.updateOne(
      { _id: compareNodeId },
      { $addToSet: { children: node._id } },
    );

    log.verbose("Narrative", "Created .narrative node");
    return node;
  } catch (err) {
    log.debug("Narrative", `Failed to create .narrative node: ${err.message}`);
    return null;
  }
}
