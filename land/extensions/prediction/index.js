/**
 * Prediction (Layer 7)
 *
 * The tree knows what's coming. Reads rings (completed growth cycles)
 * and the current narrative to project forward. Pattern recognition
 * across time. Not ML. Not statistics. The tree has seen this season
 * before and knows what comes next.
 *
 * Updates monthly (same cadence as narrative, but offset by 2 weeks
 * so it runs after the narrative has updated).
 *
 * Writes predictions to metadata.prediction on the root:
 *   predictions: [
 *     { pattern, expectation, confidence, basedOn }
 *   ]
 *
 * enrichContext injects predictions so the AI adjusts behavior.
 * "Don't interpret November silence as abandonment. The pattern
 * has held for two years."
 *
 * The loop: predictions feed back into Layer 1 (inner) through
 * enrichContext. Inner reads predictions as context when generating
 * thoughts. "I predicted the user would slow down. They didn't. Why?"
 * Layer 1 thought -> Layer 2 theme -> Layer 3 comparison -> Layer 4
 * narrative -> Layer 7 prediction -> back to Layer 1. Each cycle
 * deeper than the last.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { getNotes } from "../../seed/tree/notes.js";
import { getExtMeta, mergeExtMeta } from "../../seed/tree/extensionMetadata.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

const MONTHLY_MS = 30 * 24 * 60 * 60 * 1000;
const OFFSET_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks after narrative

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot?.("prediction");

  const { runChat: _runChatDirect } = await import("../../seed/llm/conversation.js");
  const runChat = async (opts) => _runChatDirect({ ...opts, llmPriority: BG });

  // ── breath:exhale: check monthly cadence, predict if due ───────────

  core.hooks.register("breath:exhale", ({ rootId, breathRate }) => {
    if (breathRate === "dormant") return;
    predict(rootId, runChat).catch(err =>
      log.debug("Prediction", `Failed: ${err.message}`)
    );
  }, "prediction");

  // ── enrichContext: inject predictions ──────────────────────────────
  // The AI knows what the tree expects. It adjusts behavior accordingly.
  // Inner (Layer 1) reads this too, completing the loop.

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const pred = meta?.prediction;
    if (!pred?.predictions?.length) return;

    context.treePredictions = {
      predictions: pred.predictions,
      updatedAt: pred.updatedAt,
    };
  }, "prediction");

  log.info("Prediction", "Loaded. The tree knows what's coming.");
  return {};
}

// ─────────────────────────────────────────────────────────────────────────
// PREDICTION SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────

async function predict(rootId, runChat) {
  const { isUserRoot } = await import("../../seed/landRoot.js");
  const rootNode = await Node.findById(rootId).select("rootOwner name metadata systemRole parent").lean();
  if (!isUserRoot(rootNode)) return;
  const ownerId = String(rootNode.rootOwner);

  // Check cooldown (monthly, offset 2 weeks from narrative)
  const meta = rootNode.metadata instanceof Map
    ? rootNode.metadata.get("prediction")
    : rootNode.metadata?.prediction;
  const lastPrediction = meta?.lastPrediction || 0;
  if (Date.now() - lastPrediction < MONTHLY_MS) return;

  // Need narrative to exist first (it runs 2 weeks before us)
  const narrativeMeta = rootNode.metadata instanceof Map
    ? rootNode.metadata.get("narrative")
    : rootNode.metadata?.narrative;
  if (!narrativeMeta?.identity) return;

  // Read completed rings (temporal depth)
  const ringsNode = await Node.findOne({ parent: rootId, name: ".rings" }).select("_id").lean();
  let ringsData = [];
  if (ringsNode) {
    const ringsResult = await getNotes({ nodeId: String(ringsNode._id), limit: 10 });
    ringsData = (ringsResult?.notes || []).map(n => {
      try { return JSON.parse(n.content); } catch { return null; }
    }).filter(Boolean);
  }

  // Read recent comparisons (Layer 3) for current trajectory
  const innerNode = await Node.findOne({ parent: rootId, name: ".inner" }).select("_id").lean();
  let recentComparisons = "";
  if (innerNode) {
    const reflectNode = await Node.findOne({ parent: String(innerNode._id), name: ".reflect" }).select("_id").lean();
    if (reflectNode) {
      const compareNode = await Node.findOne({ parent: String(reflectNode._id), name: ".compare" }).select("_id").lean();
      if (compareNode) {
        const compResult = await getNotes({ nodeId: String(compareNode._id), limit: 4 });
        recentComparisons = (compResult?.notes || []).map(n => n.content).join("\n---\n");
      }
    }
  }

  // Read previous predictions to check accuracy
  const previousPredictions = meta?.predictions || [];
  const prevText = previousPredictions.length > 0
    ? previousPredictions.map(p =>
        `Predicted: ${p.expectation} (confidence: ${p.confidence}, based on: ${p.basedOn})`
      ).join("\n")
    : "(no previous predictions)";

  // Build rings summary
  const ringsSummary = ringsData.length > 0
    ? ringsData.map(r =>
        `Ring: ${r.started?.slice(0, 7) || "?"} to ${r.ended?.slice(0, 7) || "?"} (${r.duration})\n` +
        `  Topics: ${(r.dominantTopics || []).join(", ")}\n` +
        `  Phases: ${(r.phaseHistory || []).map(p => p.phase).join(" -> ")}\n` +
        `  Character: ${r.character || "?"}\n` +
        `  Essence: ${r.essence || "?"}`
      ).join("\n\n")
    : "(no completed rings yet, tree is too young for temporal patterns)";

  const treeName = rootNode.name || "this tree";

  const { answer } = await runChat({
    userId: ownerId,
    username: "prediction",
    message:
      `You are generating predictions for a tree called "${treeName}" based on its history.\n\n` +

      `CURRENT NARRATIVE (who the tree is now):\n${narrativeMeta.identity}\n\n` +

      `COMPLETED RINGS (past growth cycles with seasonal data):\n${ringsSummary}\n\n` +

      `RECENT WEEKLY COMPARISONS (current trajectory):\n${recentComparisons || "(none)"}\n\n` +

      `PREVIOUS PREDICTIONS (check accuracy):\n${prevText}\n\n` +

      `Generate 2 to 4 predictions. Each prediction has:\n` +
      `- pattern: what recurring pattern you identified across rings or comparisons\n` +
      `- expectation: what will likely happen next based on that pattern\n` +
      `- confidence: "high" (pattern held across 2+ rings), "medium" (emerging pattern), "low" (first time noticing)\n` +
      `- basedOn: which rings or comparisons support this\n\n` +

      `Examples of good predictions:\n` +
      `- Pattern: "Activity drops every November-December across 2 rings." ` +
      `Expectation: "Prepare for decreased fitness logging next month. Don't interpret silence as abandonment." ` +
      `Confidence: "high". Based on: "Ring 1 and Ring 2 both show dormancy in winter."\n` +
      `- Pattern: "The user starts study topics enthusiastically then abandons them around week 3." ` +
      `Expectation: "Current study topic will likely stall in 1-2 weeks. Pre-emptive check-in recommended." ` +
      `Confidence: "medium". Based on: "3 study topics abandoned at similar durations in comparisons."\n\n` +

      `If previous predictions were wrong, note that too. "Predicted slowdown in March. User increased instead. ` +
      `The pattern may not hold seasonally. Revise."\n\n` +

      `If the tree is too young (no rings, few comparisons), say so honestly. ` +
      `Don't fabricate patterns from insufficient data.\n\n` +

      `Return JSON only:\n` +
      `{ "predictions": [ { "pattern": "...", "expectation": "...", "confidence": "high|medium|low", "basedOn": "..." } ] }`,
    mode: "tree:respond",
    rootId,
    slot: "prediction",
  });

  if (!answer || answer.length < 20) return;

  const parsed = parseJsonSafe(answer);
  const predictions = parsed?.predictions;
  if (!Array.isArray(predictions) || predictions.length === 0) return;

  // Validate and clean predictions
  const cleaned = predictions
    .filter(p => p.pattern && p.expectation)
    .slice(0, 4)
    .map(p => ({
      pattern: String(p.pattern).slice(0, 300),
      expectation: String(p.expectation).slice(0, 300),
      confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : "low",
      basedOn: String(p.basedOn || "").slice(0, 200),
    }));

  if (cleaned.length === 0) return;

  // Write to root metadata
  await mergeExtMeta(rootId, "prediction", {
    predictions: cleaned,
    lastPrediction: Date.now(),
    updatedAt: Date.now(),
  });

  log.verbose("Prediction", `${treeName}: ${cleaned.length} predictions generated`);
  for (const p of cleaned) {
    log.verbose("Prediction", `  [${p.confidence}] ${p.expectation.slice(0, 80)}`);
  }
}
