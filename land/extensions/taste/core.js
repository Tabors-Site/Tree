/**
 * Taste Core
 *
 * Learns user preferences from behavior. Signals accumulate on nodes.
 * Breath cycles compress signals into a one-sentence learned preference.
 * enrichContext injects it. The AI adapts.
 */

import log from "../../seed/log.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _metadata, _runChat, _Contribution, _Node;

export function configure({ metadata, runChat, Contribution, Node }) {
  _metadata = metadata;
  _runChat = runChat;
  _Contribution = Contribution;
  _Node = Node;
}

// ─────────────────────────────────────────────────────────────────────────
// AI DETECTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if a note was created by AI. The Note model has no wasAi field.
 * The Contribution model does.
 */
async function checkAiGenerated(noteId) {
  try {
    const c = await _Contribution.findOne({
      "noteAction.noteId": noteId,
      "noteAction.action": "add",
      wasAi: true,
    }).select("_id").lean();
    return !!c;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL RECORDING
// ─────────────────────────────────────────────────────────────────────────

/**
 * AI created a note and the user kept it. Positive signal.
 */
export async function recordCreateSignal(nodeId, noteId) {
  if (!await checkAiGenerated(noteId)) return;
  try {
    await _metadata.pushExtMeta(nodeId, "taste", "signals", {
      type: "created",
      source: "ai-generated",
      date: new Date(),
      weight: 1.0,
    }, 50);
  } catch (err) {
    log.debug("Taste", `recordCreateSignal failed: ${err.message}`);
  }
}

/**
 * User edited an AI-generated note. Mild negative: close but not right.
 */
export async function recordEditSignal(nodeId, noteId) {
  if (!await checkAiGenerated(noteId)) return;
  try {
    await _metadata.pushExtMeta(nodeId, "taste", "signals", {
      type: "edit",
      source: "ai-corrected",
      date: new Date(),
      weight: -0.3,
    }, 50);
  } catch (err) {
    log.debug("Taste", `recordEditSignal failed: ${err.message}`);
  }
}

/**
 * User is deleting a node. If it had AI-generated content, that is a
 * strong negative signal. Write to the PARENT since this node is dying.
 */
export async function recordDeleteSignal(node) {
  if (!node.parent) return;

  const taste = node.metadata instanceof Map
    ? node.metadata.get("taste")
    : node.metadata?.taste;

  if (!taste?.signals?.length) return;

  const hadAiContent = taste.signals.some(s => s.source === "ai-generated");
  if (!hadAiContent) return;

  try {
    await _metadata.pushExtMeta(node.parent, "taste", "signals", {
      type: "deleted",
      source: "child-rejected",
      date: new Date(),
      weight: -1.0,
    }, 50);
  } catch (err) {
    log.debug("Taste", `recordDeleteSignal failed: ${err.message}`);
  }
}

/**
 * Explicit feedback from a rating tool.
 */
export async function recordFeedbackSignal(nodeId, positive) {
  try {
    await _metadata.pushExtMeta(nodeId, "taste", "signals", {
      type: "feedback",
      source: "explicit",
      date: new Date(),
      weight: positive ? 0.8 : -0.8,
    }, 50);
  } catch (err) {
    log.debug("Taste", `recordFeedbackSignal failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SYNTHESIS (breath:exhale only)
// ─────────────────────────────────────────────────────────────────────────

const _synthesizing = new Set();
const SYNTHESIS_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const SIGNAL_DECAY_DAYS = 30;
const MIN_SIGNALS = 5;

/**
 * Called on breath:exhale. Finds nodes with enough signals in this tree,
 * runs one LLM call per node to produce a learned preference sentence.
 */
export async function synthesize(rootId) {
  if (_synthesizing.has(rootId)) return;
  _synthesizing.add(rootId);

  try {
    if (!_runChat) return;

    // Find nodes in this tree with at least MIN_SIGNALS signals
    const nodes = await _Node.find({
      $or: [
        { _id: rootId },
        { parent: rootId },
      ],
      [`metadata.taste.signals.${MIN_SIGNALS - 1}`]: { $exists: true },
    }).select("_id name parent metadata.taste").lean();

    if (!nodes.length) return;

    const now = Date.now();
    const decayCutoff = now - SIGNAL_DECAY_DAYS * 86400000;

    for (const node of nodes) {
      const taste = node.metadata instanceof Map
        ? node.metadata.get("taste") || {}
        : node.metadata?.taste || {};

      // Cooldown: skip if synthesized recently
      if (taste.lastSynthesis && now - new Date(taste.lastSynthesis).getTime() < SYNTHESIS_COOLDOWN_MS) {
        continue;
      }

      const signals = taste.signals || [];
      if (signals.length < MIN_SIGNALS) continue;

      // Score: weighted rolling average
      const totalWeight = signals.reduce((sum, s) => sum + (s.weight || 0), 0);
      const score = Math.round((totalWeight / signals.length) * 100) / 100;

      // Children's learned fields for upward propagation
      let childPrefs = [];
      try {
        const children = await _Node.find({ parent: node._id })
          .select("metadata.taste.learned")
          .lean();
        childPrefs = children
          .map(c => {
            const ct = c.metadata instanceof Map
              ? c.metadata.get("taste")
              : c.metadata?.taste;
            return ct?.learned;
          })
          .filter(Boolean);
      } catch {}

      // LLM synthesis
      const prompt = buildSynthesisPrompt(node.name, signals, childPrefs);
      try {
        const { answer } = await _runChat({
          userId: "SYSTEM",
          username: "taste",
          message: prompt,
          mode: "home:default",
          slot: "taste",
        });

        if (!answer) continue;

        const parsed = parseJsonSafe(answer);
        const learned = parsed?.learned || answer.trim();

        // Collect tags from signals
        const tags = [...new Set(signals.flatMap(s => s.tags || []))].slice(0, 20);

        // Write back
        await _metadata.batchSetExtMeta(node._id, "taste", {
          score,
          tags,
          learned,
          lastSynthesis: new Date(),
        });

        // Decay old signals
        const fresh = signals.filter(s => new Date(s.date).getTime() > decayCutoff);
        if (fresh.length < signals.length) {
          await _metadata.mergeExtMeta(node, "taste", { signals: fresh });
        }

        log.verbose("Taste", `Synthesized for ${node.name || node._id}: "${learned.slice(0, 80)}"`);
      } catch (err) {
        log.debug("Taste", `Synthesis LLM failed for ${node._id}: ${err.message}`);
      }
    }
  } catch (err) {
    log.error("Taste", `synthesize failed for ${rootId}: ${err.message}`);
  } finally {
    _synthesizing.delete(rootId);
  }
}

function buildSynthesisPrompt(nodeName, signals, childPrefs) {
  const positive = signals.filter(s => (s.weight || 0) > 0);
  const negative = signals.filter(s => (s.weight || 0) < 0);
  const neutral = signals.filter(s => (s.weight || 0) === 0);

  const childSection = childPrefs.length > 0
    ? `\n\nChild node preferences (propagate upward):\n${childPrefs.map(p => `- ${p}`).join("\n")}`
    : "";

  return (
    `You are analyzing preference signals for the node "${nodeName || "unknown"}".\n\n` +
    `Positive signals (${positive.length}): ${positive.map(s => s.source).join(", ") || "none"}\n` +
    `Negative signals (${negative.length}): ${negative.map(s => s.source).join(", ") || "none"}\n` +
    `Neutral signals (${neutral.length}): ${neutral.length}\n` +
    `Total interactions: ${signals.length}` +
    childSection +
    `\n\nWrite one specific sentence describing this user's preference at this position. ` +
    `Not "likes healthy food" but "prefers simple chicken-and-rice meals over complex recipes." ` +
    `Be concrete. If there is not enough signal to say something specific, say "no clear preference yet."\n\n` +
    `Return JSON only: { "learned": "..." }`
  );
}
