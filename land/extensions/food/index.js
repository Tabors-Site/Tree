import router from "./routes.js";
import coachMode from "./modes/coach.js";
import logMode from "./modes/log.js";

export async function init(core) {
  core.modes.registerMode("tree:food-coach", coachMode, "food");
  core.modes.registerMode("tree:food-log", logMode, "food");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:food-coach", "foodCoach");
    core.llm.registerModeAssignment("tree:food-log", "foodLog");
  }

  // Enrich AI context with nutrition data on food-typed nodes
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const nodeType = node?.type;
    if (nodeType && ["meal", "food-item", "macro-group", "day-log"].includes(nodeType)) {
      context.foodNodeType = nodeType;
    }

    // Surface recent prestige history as prior day logs
    const prestige = meta.prestige;
    const values = meta.values || {};
    if (prestige?.history?.length > 0 && Object.keys(values).length > 0) {
      context.foodDayCount = prestige.history.length;
      context.foodRecentDays = prestige.history.slice(-5).map((h, i) => ({
        day: prestige.history.length - 4 + i,
        values: h.values,
      }));
    }
  }, "food");

  return { router };
}
