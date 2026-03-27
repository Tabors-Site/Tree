import log from "../../seed/log.js";
import tools from "./tools.js";
import { setRunChat } from "./core.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setRunChat((opts) => core.llm.runChat({ ...opts, llmPriority: BG }));

  const { default: router } = await import("./routes.js");

  log.verbose("Changelog", "Changelog loaded");

  return {
    router,
    tools,
  };
}
