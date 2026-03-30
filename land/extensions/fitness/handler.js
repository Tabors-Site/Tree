/**
 * Fitness Handler
 *
 * Extracted POST logic. Returns result objects instead of sending HTTP responses.
 * Used by both the route (HTTP) and index.js (programmatic/gateway).
 */

import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import {
  isInitialized,
  getSetupPhase,
  getExerciseState,
  findFitnessNodes,
  parseWorkout,
  deliverToExerciseNodes,
  recordSessionHistory,
  buildWorkoutSummary,
} from "./core.js";
import { scaffoldFitnessBase } from "./setup.js";

// ── Intent detection ──

function detectIntent(message) {
  const lower = message.toLowerCase().trim();
  if (lower === "be") return "coach";
  if (/\b(go|workout|start session|let's go|ready|begin|next set)\b/.test(lower)) return "coach";
  if (/\b(how am i|progress|show.*history|review|stats|prs?|personal record|missed)\b/.test(lower)) return "review";
  if (/\b(plan|program|build|create.*plan|restructure|add.*exercise|remove|modify|change.*program)\b/.test(lower)) return "plan";
  return "log";
}

/**
 * Handle a fitness message for a given tree.
 *
 * @param {string} message - User input (already validated non-empty by caller)
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.username
 * @param {string} opts.rootId
 * @param {object|null} opts.res - Express response for auto-abort, or null
 * @returns {Promise<{answer: string, mode: string, chatId?: string, setup?: boolean, parsed?: object, delivered?: number}>}
 */
export async function handleMessage(message, { userId, username, rootId, res }) {
  const { runChat } = await import("../../seed/llm/conversation.js");

  // ── PATH 1: First use. Scaffold base, enter plan mode. ──
  const initialized = await isInitialized(rootId);
  if (!initialized) {
    await scaffoldFitnessBase(rootId, userId);

    try {
      const { answer, chatId } = await runChat({
        userId, username,
        message: `New fitness tree. The user said: "${message}". Help them set up their training program. Ask what modalities they train (gym, running, bodyweight, or mix) and build the tree with tools.`,
        mode: "tree:fitness-plan",
        rootId, res: res || undefined, slot: "fitness",
      });
      return { answer, chatId, mode: "tree:fitness-plan", setup: true };
    } catch (llmErr) {
      return { answer: "Tree created. Set up an LLM connection to start the conversation.", mode: "tree:fitness-plan", setup: true };
    }
  }

  // ── PATH 2: Setup incomplete. Auto-complete if exercises exist. ──
  const phase = await getSetupPhase(rootId);
  if (phase === "base") {
    // Check if AI already created exercises (even if it forgot to call complete)
    const state = await getExerciseState(rootId);
    const hasExercises = state && Object.values(state.groups || {}).some(g => g.exercises?.length > 0);

    if (hasExercises) {
      // AI built the tree but forgot to complete. Auto-complete.
      const { completeSetup } = await import("./setup.js");
      await completeSetup(rootId);
      // Fall through to normal intent routing
    } else {
      // No exercises yet. Continue setup conversation.
      try {
        const { answer, chatId } = await runChat({
          userId, username, message,
          mode: "tree:fitness-plan",
          rootId, res: res || undefined, slot: "fitness",
        });
        return { answer, chatId, mode: "tree:fitness-plan", setup: true };
      } catch (llmErr) {
        return { answer: "Setup in progress. Tell me what you train.", mode: "tree:fitness-plan", setup: true };
      }
    }
  }

  // ── PATH 3: Intent-based routing. ──
  const intent = detectIntent(message);

  if (intent === "coach") {
    const { answer, chatId } = await runChat({
      userId, username, message,
      mode: "tree:fitness-coach",
      rootId, res: res || undefined, slot: "fitness",
    });
    return { answer, chatId, mode: "tree:fitness-coach" };
  }

  if (intent === "review") {
    const { answer, chatId } = await runChat({
      userId, username, message,
      mode: "tree:fitness-review",
      rootId, res: res || undefined, slot: "fitness",
    });
    return { answer, chatId, mode: "tree:fitness-review" };
  }

  if (intent === "plan") {
    const { answer, chatId } = await runChat({
      userId, username, message,
      mode: "tree:fitness-plan",
      rootId, res: res || undefined, slot: "fitness",
    });
    return { answer, chatId, mode: "tree:fitness-plan" };
  }

  // ── PATH 4: Workout logging. Parse, route, record. ──
  const fitnessNodes = await findFitnessNodes(rootId);

  const parsed = await parseWorkout(message, userId, username, rootId);
  if (!parsed) {
    return {
      answer: "Could not parse that as a workout. Try: 'bench 135x10,10,8' or 'ran 3 miles in 24 min' or '50 pushups'",
      mode: "tree:fitness-log",
    };
  }

  // Route parsed data to exercise nodes
  const delivered = await deliverToExerciseNodes(fitnessNodes, parsed);

  // Record full session to History node
  if (fitnessNodes?.history) {
    await recordSessionHistory(fitnessNodes.history.id, parsed, delivered, userId);
  }

  // Write raw input to Log node
  if (fitnessNodes?.log) {
    try {
      await createNote({ nodeId: fitnessNodes.log.id, content: message, contentType: "text", userId });
    } catch {}
  }

  // Build response
  const summary = buildWorkoutSummary(parsed, delivered);
  return { answer: summary.summary, parsed, delivered: delivered.length, mode: "tree:fitness-log" };
}
