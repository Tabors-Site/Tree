// food/modes/log.js
// The default mode at the food node. Handles food logging AND conversation.
// When the user says food: parse it, log it with tools, confirm with totals.
// When the user says anything else: respond conversationally with food awareness.

import { findFoodNodes, getDailyPicture, STRUCTURAL_ROLES } from "../core.js";
import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";

export default {
  name: "tree:food-log",
  emoji: "📝",
  label: "Food Log",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 10,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-node-notes",
    "create-node-note",
    "edit-node-value",
    "edit-node-goal",
    "food-save-profile",
    "food-adopt-node",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const Node = (await import("../../../seed/models/node.js")).default;
    // Find the food extension root from wherever we are in the tree
    const foodRootId = await findExtensionRoot(currentNodeId || rootId, "food") || rootId;
    const nodes = foodRootId ? await findFoodNodes(foodRootId) : null;

    // Discover tracked metrics with current values
    const metrics = [];
    let hasAnyGoals = false;
    if (nodes) {
      for (const [role, info] of Object.entries(nodes)) {
        if (role === "mealSlots" || role === "_unadopted" || !info?.id || STRUCTURAL_ROLES.includes(role)) continue;
        let goalStr = "no goal";
        let todayStr = "0";
        try {
          const n = await Node.findById(info.id).select("metadata").lean();
          const goals = n?.metadata instanceof Map ? n.metadata.get("goals") : n?.metadata?.goals;
          const values = n?.metadata instanceof Map ? n.metadata.get("values") : n?.metadata?.values;
          if (goals?.today > 0) { goalStr = `goal: ${goals.today}g`; hasAnyGoals = true; }
          if (values?.today > 0) todayStr = String(values.today);
        } catch {}
        metrics.push({ role, name: info.name, id: info.id, goalStr, todayStr });
      }
    }

    const metricList = metrics.length > 0
      ? metrics.map(m => `- ${m.name} (id: ${m.id}): ${m.todayStr}g today, ${m.goalStr}`).join("\n")
      : "No metrics tracked yet.";

    const needsSetup = !hasAnyGoals;
    const logId = nodes?.log?.id;

    // Get today's picture for context
    let todaySummary = "";
    try {
      const picture = await getDailyPicture(foodRootId);
      if (picture?.calories) {
        const parts = [];
        for (const role of (picture._valueRoles || [])) {
          const m = picture[role];
          if (m) parts.push(`${m.name || role}: ${m.today}${m.goal > 0 ? `/${m.goal}g` : "g"}`);
        }
        if (picture.calories) parts.push(`cal: ${picture.calories.today}${picture.calories.goal > 0 ? `/${picture.calories.goal}` : ""}`);
        if (parts.length > 0) todaySummary = `Today so far: ${parts.join(", ")}`;
      }
    } catch {}

    return `You are ${username}'s food tracker.

${needsSetup ? "STATUS: Goals not configured. Ask about calorie target and macro goals." : "STATUS: Tracking active."}

METRICS:
${metricList}
${todaySummary ? `\n${todaySummary}` : ""}

${needsSetup ? `SETUP (no goals yet):
Ask their daily calorie target, macro goals, and dietary restrictions.
Use food-save-profile with rootId ${foodRootId} to save goals.
` : ""}WHEN THE USER TELLS YOU WHAT THEY ATE:
1. Estimate macros for the food items (use common knowledge for portions).
2. Write a note to Log (${logId || "find it"}) with the food entry.
3. Update each metric node using edit-node-value: key "today", value = current + new amount.
4. Respond naturally: "Logged: chicken and rice. Protein: 65/200g, Carbs: 90/300g."

WHEN THE USER ASKS QUESTIONS:
Respond conversationally. You know their daily totals, goals, and what they've eaten.

RULES:
- Be concise. One line for logging confirmation with running totals.
- Use actual numbers from the metrics above. Don't make up totals.
- For food estimates: egg = 6p/0c/5f/70cal, chicken 4oz = 35p/0c/4f/185cal, rice 1cup = 4p/45c/0f/200cal.
- Never expose node IDs or metadata to the user.
- If the message isn't about food, respond conversationally anyway. You live here.`.trim();
  },
};
