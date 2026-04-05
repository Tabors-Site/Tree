/**
 * Food Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 *   - mode: which mode the orchestrator should switch to
 *   - message: override message for the AI (optional)
 *   - answer: direct response, skip AI call (optional, for parsed food)
 *   - setup: true if this is a first-time scaffold
 */

import log from "../../seed/log.js";
import { createNote } from "../../seed/tree/notes.js";

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

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const foodRoot = targetNodeId || rootId;

  // ── First use: scaffold if this is the extension's own node (not tree root) ──
  const initialized = await isInitialized(foodRoot);
  if (!initialized) {
    if (String(foodRoot) !== String(rootId)) {
      await scaffold(foodRoot, userId);
    }
    return { mode: "tree:food-coach", setup: true };
  }

  // ── Auto-complete setup if structural nodes exist ──
  const phase = await getSetupPhase(foodRoot);
  if (phase === "base") {
    const foodNodes = await findFoodNodes(foodRoot);
    if (foodNodes && Object.keys(foodNodes).length > 0) {
      await saveProfile(foodRoot, {}, foodNodes, userId);
    }
  }

  // ── "be" command ──
  if (message.trim().toLowerCase() === "be" || message.trim().toLowerCase() === "begin") {
    return { mode: "tree:food-coach" };
  }

  // ── Questions, advice, planning, general conversation ──
  if (/\b(what should|how am i|how's my|suggest|recommend|plan|advice|help|adjust|change.*goal|set.*goal|update.*goal|week|daily|review|progress)\b/i.test(message)) {
    return { mode: "tree:food-review" };
  }
  // Questions that aren't food input
  if (/\b(do you know|tell me about|who is|what is|have you heard)\b/i.test(message) || /\?$/.test(message.trim())) {
    return { mode: "tree:food-coach" };
  }

  // ── Food input: parse, write data, return response directly ──
  const foodNodes = await findFoodNodes(foodRoot);
  const parsed = await parseFood(message, userId, username, foodRoot);
  if (!parsed) {
    // Not food input. Let the coach handle conversationally.
    return { mode: "tree:food-coach" };
  }

  // Write note to Log node
  try {
    const logEntry = {
      meal: parsed.meal,
      when: parsed.when || "snack",
      totals: parsed.totals,
      items: parsed.items,
    };
    await createNote({
      nodeId: foodNodes.log.id,
      content: JSON.stringify(logEntry),
      contentType: "text",
      userId,
    });
  } catch (err) {
    log.warn("Food", `Note creation failed: ${err.message}`);
  }

  // Write to meal slot
  const mealSlot = detectMealSlot(message, parsed.when);
  if (foodNodes[mealSlot] || foodNodes.meals) {
    const mealDisplay = JSON.stringify({
      text: `${parsed.meal} (${parsed.totals.calories || 0}cal)`,
      totals: parsed.totals,
    });
    writeMealNote(foodNodes, mealSlot, mealDisplay, userId).catch(() => {});
  }

  // Deliver macros to metric nodes
  await deliverMacros(foodNodes.log.id, foodNodes, parsed);

  // Build response
  await new Promise(r => setTimeout(r, 50));
  const picture = await getDailyPicture(foodRoot);

  const itemList = parsed.items.map(i => {
    const parts = Object.entries(i)
      .filter(([k, v]) => k !== "name" && k !== "calories" && typeof v === "number")
      .map(([k, v]) => `${v}${k.charAt(0)}`);
    if (i.calories) parts.push(`${i.calories}cal`);
    return `${i.name} (${parts.join("/")})`;
  }).join(", ");
  let response = `Logged: ${itemList}`;

  if (picture) {
    const lines = [];
    for (const role of (picture._valueRoles || [])) {
      const m = picture[role];
      if (m) {
        const label = m.name || role;
        const pct = m.goal > 0 ? Math.round((m.today / m.goal) * 100) : 0;
        const goalStr = m.goal > 0 ? `/${m.goal}g (${pct}%)` : "g";
        lines.push(`${label}: ${m.today}${goalStr}`);
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

  // Direct answer. Orchestrator skips AI call, delivers this response.
  return { answer: response, parsed, mode: "tree:food-log" };
}
