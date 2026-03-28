import tools from "./tools.js";
import { setRunChat } from "./core.js";

export async function init(core) {
  const INT = core.llm.LLM_PRIORITY.INTERACTIVE;

  core.llm.registerRootLlmSlot?.("learn");

  setRunChat(async (opts) => {
    if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
    return core.llm.runChat({ ...opts, llmPriority: INT });
  });

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
  };
}
