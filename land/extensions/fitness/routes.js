import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import {
  isInitialized,
  findFitnessNodes,
  parseWorkout,
  deliverToExerciseNodes,
  recordWorkoutHistory,
  buildWorkoutSummary,
} from "./core.js";
import { scaffoldFitness } from "./setup.js";

let Node = NodeModel;
export function setServices({ Node: N }) { if (N) Node = N; }

const router = express.Router();

/**
 * POST /root/:rootId/fitness
 *
 * Three paths:
 * 1. First use: scaffold tree, run coach mode for setup conversation
 * 2. Workout input: parse, route to exercise nodes, record history
 * 3. Questions/guided workout: route to coach or review mode
 */
router.post("/root/:rootId/fitness", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    if (!message) return sendError(res, 400, ERR.INVALID_INPUT, "message required");

    const root = await Node.findById(rootId).select("rootOwner contributors name").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) {
      return sendError(res, 403, ERR.FORBIDDEN, "No access to this tree");
    }

    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("fitness", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Fitness is blocked on this branch.");
    }

    const user = await UserModel.findById(userId).select("username").lean();
    const username = user?.username || "user";
    const { runChat } = await import("../../seed/ws/conversation.js");

    // ── PATH 1: First use. Scaffold and run setup conversation. ──
    const initialized = await isInitialized(rootId);
    if (!initialized) {
      // Scaffold with defaults (coach will adjust)
      await scaffoldFitness(rootId, userId, { goal: "hypertrophy", daysPerWeek: 4 });

      const { answer, chatId } = await runChat({
        userId,
        username,
        message: `First time setup. The user said: "${message}". The tree is already scaffolded with a default hypertrophy program (4 days). Ask them: What are you training for? (strength, hypertrophy, general fitness, or they have their own program). How many days per week? Then adjust the program accordingly.`,
        mode: "tree:fitness-coach",
        rootId,
        res,
      });

      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-coach", setup: true });
      return;
    }

    const fitnessNodes = await findFitnessNodes(rootId);

    // ── PATH 3: Guided workout, questions, progress review ──
    const isGuided = /\b(go|workout|start session|let's go|ready|begin|next set)\b/i.test(message);
    const isReview = /\b(progress|how am i|how's my|show.*history|review|stats|pr|personal record|missed)\b/i.test(message);
    const isQuestion = /\b(what should|plan|program|adjust|change|swap|replace|schedule)\b/i.test(message);

    if (isGuided || isQuestion) {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:fitness-coach",
        rootId, res,
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-coach" });
      return;
    }

    if (isReview) {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:fitness-review",
        rootId, res,
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-review" });
      return;
    }

    // ── PATH 2: Workout logging. Parse, route, record. ──

    const parsed = await parseWorkout(message, userId, username, rootId);
    if (!parsed) {
      return sendOk(res, {
        answer: "Could not parse that as a workout. Try: 'bench 135x10,10,8' or 'squat 225 5x5'",
        mode: "tree:fitness-log",
      });
    }

    // Route exercise data to nodes (direct updates + cascade)
    await deliverToExerciseNodes(fitnessNodes, parsed);

    // Record full workout to History node
    if (fitnessNodes?.history) {
      await recordWorkoutHistory(fitnessNodes.history.id, parsed, userId);
    }

    // Write raw input to Log node
    if (fitnessNodes?.log) {
      try {
        await createNote({
          nodeId: fitnessNodes.log.id,
          content: message,
          contentType: "text",
          userId,
        });
      } catch {}
    }

    // Build response
    const summary = buildWorkoutSummary(parsed, fitnessNodes);
    sendOk(res, { answer: summary.summary, parsed, mode: "tree:fitness-log" });
  } catch (err) {
    log.error("Fitness", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
