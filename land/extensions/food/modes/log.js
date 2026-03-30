// food/modes/log.js
// The receiver. One job: parse food input into structured metrics.
// No tools. Returns JSON. One LLM call.
// Prompt is async: discovers what metrics the tree tracks (protein, carbs, fats, sugar, fiber, etc.)

import { findFoodNodes } from "../core.js";

const STRUCTURAL_ROLES = ["log", "daily", "meals", "profile", "history"];

export default {
  name: "tree:food-log",
  emoji: "📝",
  label: "Food Log",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 2,
  preserveContextOnLoop: false,

  toolNames: [],

  async buildSystemPrompt({ rootId }) {
    // Discover what metrics this tree tracks
    const nodes = rootId ? await findFoodNodes(rootId) : null;
    const metrics = [];
    if (nodes) {
      for (const [role, info] of Object.entries(nodes)) {
        if (role === "mealSlots" || !info?.id || STRUCTURAL_ROLES.includes(role)) continue;
        metrics.push(role);
      }
    }
    // Fallback to core macros if nothing found
    if (metrics.length === 0) metrics.push("protein", "carbs", "fats");

    const itemFields = metrics.map(m => `"${m}": grams`).join(", ");
    const totalsFields = metrics.map(m => `"${m}": grams`).join(", ");

    return `You are a food intake parser. Parse the user's food input into structured metrics.

This tree tracks: ${metrics.join(", ")}, calories

Return ONLY JSON:
{
  "meal": "short description of what was eaten",
  "when": "breakfast" | "lunch" | "dinner" | "snack",
  "items": [
    { "name": "food name", ${itemFields}, "calories": number }
  ],
  "totals": { ${totalsFields}, "calories": number }
}

Rules:
- Estimate nutritional values for common foods. Use typical serving sizes unless the user specifies.
- If the user gives a quantity (2 eggs, 1 cup rice, 4oz chicken), use that.
- Round to whole numbers.
- "when" defaults to the most likely meal based on context. If unclear, use "snack".
- Keep item names short. "Chicken breast" not "Grilled boneless skinless chicken breast fillet".
- Common estimates: egg = 70cal/6p/0c/5f, chicken breast 4oz = 185cal/35p/0c/4f, rice 1cup = 200cal/4p/45c/0f, bread 1slice = 80cal/3p/15c/1f, banana = 105cal/1p/27c/0f.
- Return ONLY the JSON object. No explanation. No markdown fences.
- Include ALL tracked metrics (${metrics.join(", ")}) for every item, even if 0.`.trim();
  },
};
