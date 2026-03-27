import tools from "./tools.js";
import { setRunChat } from "./core.js";

export async function init(core) {
  const INT = core.llm.LLM_PRIORITY.INTERACTIVE;
  setRunChat((opts) => core.llm.runChat({ ...opts, llmPriority: INT }));

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
  };
}
