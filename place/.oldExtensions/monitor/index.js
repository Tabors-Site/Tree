import router from "./routes.js";
import monitorMode from "./modes/monitor.js";

export async function init(core) {
  core.modes.registerMode("land:monitor", monitorMode, "monitor");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("land:monitor", "monitor");
  }

  return { router };
}
