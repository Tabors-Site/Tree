import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
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

let Node = NodeModel;
export function setServices({ Node: N }) { if (N) Node = N; }

const router = express.Router();

// ── HTML Dashboard (GET with ?html) ──
router.get("/root/:rootId/fitness", async (req, res, next) => {
  if (!("html" in req.query)) return next();
  try {
    const { isHtmlEnabled } = await import("../html-rendering/config.js");
    if (!isHtmlEnabled()) return next();
    const urlAuth = (await import("../html-rendering/urlAuth.js")).default;
    urlAuth(req, res, async () => {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Not found");
      const meta = root.metadata instanceof Map ? root.metadata.get("fitness") : root.metadata?.fitness;
      let state = null, weekly = null, profile = null;
      if (meta?.initialized) {
        const core = await import("./core.js");
        [state, weekly, profile] = await Promise.all([core.getExerciseState(rootId), core.getWeeklyStats(rootId), core.getProfile(rootId)]);
      }
      const { renderFitnessDashboard } = await import("./pages/dashboard.js");
      res.send(renderFitnessDashboard({ rootId, rootName: root.name, state, weekly, profile, token: req.query.token || null }));
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

// ── Intent detection ──

function detectIntent(message) {
  const lower = message.toLowerCase();
  if (/\b(go|workout|start session|let's go|ready|begin|next set)\b/.test(lower)) return "coach";
  if (/\b(how am i|progress|show.*history|review|stats|prs?|personal record|missed)\b/.test(lower)) return "review";
  if (/\b(plan|program|build|create.*plan|restructure|add.*exercise|remove|modify|change.*program)\b/.test(lower)) return "plan";
  return "log";
}

/**
 * POST /root/:rootId/fitness
 *
 * Four paths:
 * 1. First use: scaffold base, enter plan mode for conversational setup
 * 2. Setup incomplete: continue plan mode
 * 3. Workout input: parse, route to exercise nodes, record history
 * 4. Intent-based: route to coach, review, or plan mode
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
          rootId, res, slot: "fitness",
        });
        if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-plan", setup: true });
      } catch (llmErr) {
        if (!res.headersSent) sendOk(res, { answer: "Tree created. Set up an LLM connection to start the conversation.", mode: "tree:fitness-plan", setup: true });
      }
      return;
    }

    // ── PATH 2: Setup incomplete. Continue plan mode. ──
    const phase = await getSetupPhase(rootId);
    if (phase === "base") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:fitness-plan",
        rootId, res, slot: "fitness",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-plan", setup: true });
      return;
    }

    // ── PATH 3: Intent-based routing. ──
    const intent = detectIntent(message);

    if (intent === "coach") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:fitness-coach",
        rootId, res, slot: "fitness",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-coach" });
      return;
    }

    if (intent === "review") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:fitness-review",
        rootId, res, slot: "fitness",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-review" });
      return;
    }

    if (intent === "plan") {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:fitness-plan",
        rootId, res, slot: "fitness",
      });
      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:fitness-plan" });
      return;
    }

    // ── PATH 4: Workout logging. Parse, route, record. ──
    const fitnessNodes = await findFitnessNodes(rootId);

    const parsed = await parseWorkout(message, userId, username, rootId);
    if (!parsed) {
      return sendOk(res, {
        answer: "Could not parse that as a workout. Try: 'bench 135x10,10,8' or 'ran 3 miles in 24 min' or '50 pushups'",
        mode: "tree:fitness-log",
      });
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
    sendOk(res, { answer: summary.summary, parsed, delivered: delivered.length, mode: "tree:fitness-log" });
  } catch (err) {
    log.error("Fitness", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, "Fitness request failed");
  }
});

export default router;
