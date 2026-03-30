/**
 * Food Handler
 *
 * Extracted POST logic. Returns result objects instead of sending HTTP responses.
 * Used by both the route (HTTP) and index.js (programmatic/gateway).
 */

import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";
import NodeModel from "../../seed/models/node.js";
import {
  scaffold,
  isInitialized,
  findFoodNodes,
  parseFood,
  deliverMacros,
  getDailyPicture,
  detectMealSlot,
  writeMealNote,
  getSetupPhase,
  saveProfile,
} from "./core.js";

/**
 * Handle a food message for a given tree.
 *
 * @param {string} message - User input (already validated non-empty by caller)
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.username
 * @param {string} opts.rootId
 * @param {object|null} opts.res - Express response for auto-abort, or null
 * @returns {Promise<{answer: string, mode: string, chatId?: string, setup?: boolean, parsed?: object}>}
 */
export async function handleMessage(message, { userId, username, rootId, res }) {
  const { runChat } = await import("../../seed/llm/conversation.js");

  // ── PATH 1: First use. Scaffold and run setup conversation. ──
  const initialized = await isInitialized(rootId);
  if (!initialized) {
    await scaffold(rootId, userId);

    try {
      const { answer, chatId } = await runChat({
        userId, username,
        message: `First time setup. The user said: "${message}". Ask them about their calorie target, macro goals, and dietary restrictions. If they already provided info in their message, use it.`,
        mode: "tree:food-coach",
        rootId, res: res || undefined, slot: "food",
      });
      return { answer, chatId, mode: "tree:food-coach", setup: true };
    } catch (llmErr) {
      return { answer: "Tree created. Set up an LLM connection to start the conversation.", mode: "tree:food-coach", setup: true };
    }
  }

  // ── PATH 1b: Setup incomplete (scaffold done, profile not yet saved). ──
  const phase = await getSetupPhase(rootId);
  if (phase === "base") {
    // Check if AI already set goals (even if it forgot to call complete)
    const foodNodes = await findFoodNodes(rootId);
    let hasGoals = false;
    if (foodNodes?.protein) {
      const pNode = await NodeModel.findById(foodNodes.protein.id).select("metadata").lean();
      const goals = pNode?.metadata instanceof Map ? pNode.metadata.get("goals") : pNode?.metadata?.goals;
      hasGoals = goals?.today > 0;
    }

    if (hasGoals) {
      // Goals set but complete not called. Auto-complete.
      await saveProfile(rootId, {}, foodNodes);
    } else {
      // No goals yet. Continue setup.
      try {
        const { answer, chatId } = await runChat({
          userId, username, message,
          mode: "tree:food-coach",
          rootId, res: res || undefined, slot: "food",
        });
        return { answer, chatId, mode: "tree:food-coach", setup: true };
      } catch (llmErr) {
        return { answer: "Tell me your calorie target and macro goals.", mode: "tree:food-coach", setup: true };
      }
    }
  }

  const foodNodes = await findFoodNodes(rootId);
  if (!foodNodes?.log) {
    throw new Error("Food tree structure not found.");
  }

  // ── PATH: "be" command: guided log mode ──
  if (message.trim().toLowerCase() === "be") {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message: "The user said 'be'. Guide them through logging their current meal or snack. Ask what they're eating.",
        mode: "tree:food-log", rootId, res: res || undefined, slot: "food",
      });
      return { answer, chatId, mode: "tree:food-log" };
    } catch (llmErr) {
      return { answer: "What did you eat?", mode: "tree:food-log" };
    }
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
      res: res || undefined,
      slot: "food",
    });
    return { answer, chatId, mode: "tree:food-review" };
  }

  // ── PATH 2: Food input. Parse, cascade, respond. ──

  // One LLM call: parse food into structured macros
  const parsed = await parseFood(message, userId, username, rootId);
  if (!parsed) {
    return {
      answer: "Could not parse that as food. Try something like: 'chicken breast and rice for lunch'.",
      mode: "tree:food-log",
    };
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

  return { answer: response, parsed, mode: "tree:food-log" };
}
