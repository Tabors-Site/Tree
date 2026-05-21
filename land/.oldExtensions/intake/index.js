import log from "../../seed/log.js";
import getIntakeTools from "./tools.js";
import intakeMode from "./modes/intake.js";
import { needsIntake, extractUrls, LONG_MESSAGE_THRESHOLD } from "./needsIntake.js";
import { parsePremise } from "./parse.js";

export async function init(core) {
  try { core.llm?.registerRootLlmSlot?.("intake"); } catch {}
  core.modes.registerMode("tree:intake", intakeMode, "intake");
  try { core.llm?.registerModeAssignment?.("tree:intake", "intake"); } catch {}

  const tools = getIntakeTools();
  log.info("Intake", `Registered tree:intake + ${tools.length} tool(s). Confined — run 'ext-allow intake' at a tree root (or install alongside a domain workspace).`);

  return {
    tools,
    exports: {
      needsIntake,
      extractUrls,
      parsePremise,
      LONG_MESSAGE_THRESHOLD,
    },
  };
}

export { needsIntake, extractUrls, parsePremise };
