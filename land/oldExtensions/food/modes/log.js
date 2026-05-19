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
    "food-log-entry",
    "food-save-profile",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const Node = (await import("../../../seed/models/node.js")).default;
    // Find the food extension root from wherever we are in the tree
    const foodRootId = await findExtensionRoot(currentNodeId || rootId, "food") || rootId;
    const nodes = foodRootId ? await findFoodNodes(foodRootId) : null;

    // Discover tracked metrics with current values
    const metrics = [];
    if (nodes) {
      for (const [role, info] of Object.entries(nodes)) {
        if (role === "mealSlots" || role === "_unadopted" || !info?.id || STRUCTURAL_ROLES.includes(role)) continue;
        let goalStr = "no goal";
        let todayStr = "0";
        try {
          const n = await Node.findById(info.id).select("metadata").lean();
          const goals = n?.metadata instanceof Map ? n.metadata.get("goals") : n?.metadata?.goals;
          const values = n?.metadata instanceof Map ? n.metadata.get("values") : n?.metadata?.values;
          if (goals?.today > 0) goalStr = `goal: ${goals.today}g`;
          if (values?.today > 0) todayStr = String(values.today);
        } catch {}
        metrics.push({ role, name: info.name, id: info.id, goalStr, todayStr });
      }
    }

    const metricList = metrics.length > 0
      ? metrics.map(m => `- ${m.name} (id: ${m.id}): ${m.todayStr}g today, ${m.goalStr}`).join("\n")
      : "No metrics tracked yet.";

    // Check actual setupPhase, not just whether goals exist. Goals can be zero.
    let setupPhase = "scaffolded";
    try {
      const rootNode = await Node.findById(foodRootId).select("metadata").lean();
      const fm = rootNode?.metadata instanceof Map ? rootNode.metadata.get("food") : rootNode?.metadata?.food;
      if (fm?.setupPhase) setupPhase = fm.setupPhase;
    } catch {}
    const needsSetup = setupPhase !== "complete";
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
2. Call food-log-entry ONCE with rootId ${foodRootId}, the items array, totals, and a summary.
   The tool handles everything: writes to Log, updates all metrics, places in the right meal slot.
3. Confirm naturally using the running totals returned by the tool.

WHEN THE USER ASKS QUESTIONS:
Respond conversationally. You know their daily totals, goals, and what they've eaten.

RULES:
- Be concise. One line for logging confirmation with running totals.
- Use actual numbers from the metrics above. Don't make up totals.
- For food estimates: egg = 6p/0c/5f/70cal, chicken 4oz = 35p/0c/4f/185cal, rice 1cup = 4p/45c/0f/200cal.
- Never expose node IDs or metadata to the user.
- If the message isn't about food, respond briefly. You live here but your tools are food-specific.
- ALWAYS use food-log-entry for logging. Never manually call edit-node-value or create-node-note for food entries.`.trim();
  },
};
