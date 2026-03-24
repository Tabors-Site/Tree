import router from "./routes.js";
import coachMode from "./modes/coach.js";
import logMode from "./modes/log.js";

export async function init(core) {
  // Register fitness modes
  core.modes.registerMode("tree:fitness-coach", coachMode, "fitness");
  core.modes.registerMode("tree:fitness-log", logMode, "fitness");

  // LLM slot assignments: users can assign a specific model to fitness
  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:fitness-coach", "fitnessCoach");
    core.llm.registerModeAssignment("tree:fitness-log", "fitnessLog");
  }

  // Enrich AI context with fitness-relevant data on exercise nodes
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const nodeType = node?.type;
    if (nodeType && ["exercise", "workout-day", "program", "muscle-group"].includes(nodeType)) {
      context.fitnessNodeType = nodeType;
    }

    // Surface recent prestige history as prior workout sessions
    const prestige = meta.prestige;
    const values = meta.values || {};
    if (prestige?.history?.length > 0 && Object.keys(values).length > 0) {
      context.fitnessSessionCount = prestige.history.length;
      context.fitnessPriorSessions = prestige.history.slice(-3).map((h, i) => ({
        session: prestige.history.length - 2 + i,
        values: h.values,
      }));
    }
  }, "fitness");

  return { router };
}
