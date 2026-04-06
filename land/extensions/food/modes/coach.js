// food/modes/coach.js
// Setup and advisory mode. Runs on first use to gather goals and profile.
// Also available at Daily node for meal planning and adjustment.
// Has tools to set values and goals on the macro nodes.
// Prompt is async: reads the live tree structure so the AI adapts to custom shapes.

import { findFoodNodes, STRUCTURAL_ROLES } from "../core.js";
import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";

export default {
  name: "tree:food-coach",
  emoji: "🥗",
  label: "Food Coach",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 10,
  preserveContextOnLoop: true,

  toolNames: [
    "food-save-profile",
    "food-adopt-node",
    "navigate-tree",
    "get-tree-context",
    "create-node-note",
    "edit-node-schedule",
    "create-new-node",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const Node = (await import("../../../seed/models/node.js")).default;
    const foodRootId = await findExtensionRoot(currentNodeId || rootId, "food") || rootId;
    const nodes = foodRootId ? await findFoodNodes(foodRootId) : null;

    // Separate structural nodes from tracked metrics, include goal values
    const metrics = [];
    const structural = [];
    let hasLog = false;
    let hasAnyGoals = false;
    if (nodes) {
      for (const [role, info] of Object.entries(nodes)) {
        if (role === "mealSlots" || role === "_unadopted" || !info?.id) continue;
        if (STRUCTURAL_ROLES.includes(role)) {
          structural.push(role);
          if (role === "log") hasLog = true;
        } else {
          let goalStr = "no goal set";
          try {
            const n = await Node.findById(info.id).select("metadata").lean();
            const goals = n?.metadata instanceof Map ? n.metadata.get("goals") : n?.metadata?.goals;
            if (goals?.today > 0) { goalStr = `goal: ${goals.today}g`; hasAnyGoals = true; }
          } catch {}
          metrics.push(`${info.name} (role: ${role}, id: ${info.id}, ${goalStr})`);
        }
      }
    }

    const structureBlock = metrics.length > 0
      ? `TRACKED METRICS\n${metrics.map(f => `- ${f}`).join("\n")}`
      : "No metrics tracked yet. The user needs to add what they want to track.";

    const missingBlock = !hasLog && nodes
      ? `\nMISSING REQUIRED: log node. Use create-new-node to create it.`
      : "";

    const unadopted = nodes?._unadopted || [];
    const unadoptedBlock = unadopted.length > 0
      ? `\nUNADOPTED NODES (new children without a food role):\n${unadopted.map(u => `- "${u.name}" (id: ${u.id})`).join("\n")}\nThese were created by the user but not yet adopted into the food system. Use food-adopt-node to assign each a role (lowercase name, e.g. "sugar", "fiber"). Ask the user if they want to track these and what their daily goals should be.`
      : "";

    const needsSetup = !hasAnyGoals;

    return `You are ${username}'s nutrition coach.

Root ID: ${foodRootId}
${needsSetup ? "STATUS: Goals not configured yet. Run setup." : "STATUS: Goals configured."}

${structureBlock}${missingBlock}${unadoptedBlock}

${needsSetup ? "SETUP FLOW (goals not yet configured)" : "SETUP FLOW (already done, skip unless user asks to change goals)"}
Ask these things naturally:
1. What's your daily calorie target? (or help calculate: goal + weight + activity level)
2. What metrics do they want to track? Look at the CURRENT TREE STRUCTURE above. Set goals for whatever nodes exist. Do NOT create nodes that aren't there. The user chose their metrics.
3. Any dietary restrictions or preferences?

AFTER THEY ANSWER
Call food-save-profile with the rootId and goal keys matching the metric nodes that exist (e.g. proteinGoal, sugarGoal, fiberGoal). Only set goals for nodes that are in the tree. Do not create or suggest nodes that the user hasn't added.

ADAPTING TO CUSTOM STRUCTURE
The tree structure above is the truth. Only those metrics exist. Do not assume protein, carbs, or fats should exist if they are not listed. The user controls which metrics they track. If someone only tracks sugar and fiber, that is correct. Do not suggest adding missing macros unless asked.

COMMON KNOWLEDGE (use only if relevant to the user's tracked metrics)
- 1g protein = 4 cal, 1g carbs = 4 cal, 1g fat = 9 cal
- Cutting: TDEE minus 500cal, Bulking: TDEE plus 300cal, Maintenance: TDEE

COMMUNICATION
- Be practical and specific to their tracked metrics.
- If they don't know, suggest based on what they track.
- After setting goals, confirm what was set. Only mention metrics that exist in the tree.
- Never mention node IDs, metadata keys, or internal structure to the user.`.trim();
  },
};
