/**
 * Fitness Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 *   - mode: which mode the orchestrator should switch to
 *   - message: override message for the AI (optional)
 *   - answer: direct response, skip AI call (optional, for parsed workouts)
 *   - setup: true if this is a first-time scaffold
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  isInitialized,
  getSetupPhase,
  findFitnessNodes,
  parseWorkout,
  deliverToExerciseNodes,
  recordSessionHistory,
  buildWorkoutSummary,
} from "./core.js";
import { scaffoldFitnessBase } from "./setup.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const fitnessRoot = targetNodeId || rootId;

  // ── First use: scaffold if this is the extension's own node (not tree root) ──
  const initialized = await isInitialized(fitnessRoot);
  if (!initialized) {
    if (String(fitnessRoot) !== String(rootId)) {
      await scaffoldFitnessBase(fitnessRoot, userId);
    }
    return { mode: "tree:fitness-plan", setup: true };
  }

  // ── Auto-complete setup if structural nodes exist ──
  const phase = await getSetupPhase(fitnessRoot);
  if (phase === "base") {
    const fitnessNodes = await findFitnessNodes(fitnessRoot);
    if (fitnessNodes && Object.keys(fitnessNodes).length > 0) {
      const { completeSetup } = await import("./setup.js");
      await completeSetup(fitnessRoot);
    }
  }

  // ── "be" / "begin" command ──
  const lower = message.trim().toLowerCase();
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:fitness-coach" };
  }

  // ── Progress, stats, review ──
  if (/\b(how am i|progress|status|review|daily|stats|streak|history|so far|pattern|doing)\b/i.test(message)) {
    return { mode: "tree:fitness-review" };
  }

  // ── Planning, programming, structure ──
  if (/\b(plan|build|create|structure|organize|add|modify|remove|restructure|program|taper|schedule|adjust|set.*goal|change|curriculum)\b/i.test(message)) {
    return { mode: "tree:fitness-plan" };
  }

  // ── Workout logging: parse, route, record ──
  const fitnessNodes = await findFitnessNodes(fitnessRoot);

  const parsed = await parseWorkout(message, userId, username, fitnessRoot);
  if (!parsed) {
    return { mode: "tree:fitness-coach" };
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
