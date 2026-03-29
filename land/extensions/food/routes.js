import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import {
  scaffold,
  isInitialized,
  findFoodNodes,
  parseFood,
  deliverMacros,
  getDailyPicture,
  detectMealSlot,
  writeMealNote,
} from "./core.js";

let Node = NodeModel;
export function setServices({ Node: N }) { if (N) Node = N; }

const router = express.Router();

/**
 * POST /root/:rootId/food
 *
 * Three paths:
 * 1. First use (not initialized): scaffold tree, run coach mode for setup conversation
 * 2. Food input (has food words): parse, cascade, respond with totals
 * 3. Questions/advice: route to coach mode at the Daily node
 */
router.post("/root/:rootId/food", authenticate, async (req, res) => {
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

    // Check spatial scope
    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("food", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Food tracking is blocked on this branch.");
    }

    const user = await UserModel.findById(userId).select("username").lean();
    const username = user?.username || "user";
    const { runChat } = await import("../../seed/llm/conversation.js");

    // ── PATH 1: First use. Scaffold and run setup conversation. ──
    const initialized = await isInitialized(rootId);
    if (!initialized) {
      await scaffold(rootId, userId);

      const { answer, chatId } = await runChat({
        userId,
        username,
        message: `First time setup. The user said: "${message}". Ask them about their calorie target, macro goals, and dietary restrictions. If they already provided info in their message, use it.`,
        mode: "tree:food-coach",
        rootId,
        res,
        slot: "food",
      });

      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:food-coach", setup: true });
      return;
    }

    // ── PATH 1b: Setup incomplete (scaffold done, profile not yet saved). ──
    const { getSetupPhase } = await import("./core.js");
    const phase = await getSetupPhase(rootId);
    if (phase === "base") {
      const { answer, chatId } = await runChat({
        userId,
        username,
        message,
        mode: "tree:food-coach",
        rootId,
        res,
        slot: "food",
      });

      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:food-coach", setup: true });
      return;
    }

    const foodNodes = await findFoodNodes(rootId);
    if (!foodNodes?.log) {
      return sendError(res, 500, ERR.INTERNAL, "Food tree structure not found.");
    }

    // ── PATH 3: Questions, advice, planning. Route to coach/daily mode. ──
    const isQuestion = /\b(what should|how am i|how's my|suggest|recommend|plan|advice|help|adjust|change.*goal|set.*goal|update.*goal)\b/i.test(message);
    if (isQuestion) {
      const { answer, chatId } = await runChat({
        userId,
        username,
        message,
        mode: "tree:food-review",
        rootId,
        res,
        slot: "food",
      });

      if (!res.headersSent) sendOk(res, { answer, chatId, mode: "tree:food-review" });
      return;
    }

    // ── PATH 2: Food input. Parse, cascade, respond. ──

    // One LLM call: parse food into structured macros
    const parsed = await parseFood(message, userId, username, rootId);
    if (!parsed) {
      return sendOk(res, {
        answer: "Could not parse that as food. Try something like: 'chicken breast and rice for lunch'.",
        mode: "tree:food-log",
      });
    }

    // Write note to Log node with raw input
    try {
      await createNote({
        nodeId: foodNodes.log.id,
        content: `${parsed.when || "meal"}: ${parsed.meal} (P:${parsed.totals.protein}g C:${parsed.totals.carbs}g F:${parsed.totals.fats}g ${parsed.totals.calories}cal)`,
        contentType: "text",
        userId,
      });
    } catch (err) {
      log.warn("Food", `Note creation failed: ${err.message}`);
    }

    // Write to appropriate Meals slot (Breakfast/Lunch/Dinner/Snacks)
    const mealSlot = detectMealSlot(message, parsed.when);
    writeMealNote(foodNodes, mealSlot, `${parsed.meal} (${parsed.totals.calories}cal)`, userId).catch(() => {});

    // Fire cascade signals to macro nodes
    await deliverMacros(foodNodes.log.id, foodNodes, parsed);

    // Small delay for $inc to settle, then read fresh totals
    await new Promise(r => setTimeout(r, 50));
    const picture = await getDailyPicture(rootId);

    // Build natural language response
    const itemList = parsed.items.map(i =>
      `${i.name} (${i.calories}cal, ${i.protein}p/${i.carbs}c/${i.fats}f)`
    ).join(", ");
    let response = `Logged: ${itemList}`;

    if (picture) {
      const lines = [];
      for (const macro of ["protein", "carbs", "fats"]) {
        const m = picture[macro];
        if (m) {
          const pct = m.goal > 0 ? Math.round((m.today / m.goal) * 100) : 0;
          const goalStr = m.goal > 0 ? `/${m.goal}g (${pct}%)` : "g";
          lines.push(`${macro}: ${m.today}${goalStr}`);
        }
      }
      if (picture.calories) {
        const c = picture.calories;
        const pct = c.goal > 0 ? Math.round((c.today / c.goal) * 100) : 0;
        const goalStr = c.goal > 0 ? `/${c.goal} (${pct}%)` : "";
        lines.push(`calories: ${c.today}${goalStr}`);
      }
      if (lines.length > 0) {
        response += `\nToday: ${lines.join(", ")}`;
      }
    }

    sendOk(res, { answer: response, parsed, mode: "tree:food-log" });
  } catch (err) {
    log.error("Food", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/food/daily
 * Today's nutrition dashboard.
 */
router.get("/root/:rootId/food/daily", authenticate, async (req, res) => {
  try {
    const picture = await getDailyPicture(req.params.rootId);
    if (!picture) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not found or not initialized");
    sendOk(res, picture);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/food/week
 * Weekly nutrition review (last 7 days from History node).
 */
router.get("/root/:rootId/food/week", authenticate, async (req, res) => {
  try {
    const foodNodes = await findFoodNodes(req.params.rootId);
    if (!foodNodes?.history) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not found");

    const Note = (await import("../../seed/models/note.js")).default;
    const notes = await Note.find({ nodeId: foodNodes.history.id })
      .sort({ createdAt: -1 })
      .limit(7)
      .select("content createdAt")
      .lean();

    const days = notes
      .map(n => { try { return JSON.parse(n.content); } catch { return null; } })
      .filter(Boolean);

    sendOk(res, { days, count: days.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/food/profile
 * Dietary profile and goals.
 */
router.get("/root/:rootId/food/profile", authenticate, async (req, res) => {
  try {
    const picture = await getDailyPicture(req.params.rootId);
    if (!picture) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not found");
    sendOk(res, { profile: picture.profile || null, macros: { protein: picture.protein, carbs: picture.carbs, fats: picture.fats } });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
