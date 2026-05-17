import tools from "./tools.js";
import { setRunChat, initLearnState, getLearnState, processQueue, pauseLearn, resumeLearn, stopLearn } from "./core.js";

export async function init(core) {
  const INT = core.llm.LLM_PRIORITY.INTERACTIVE;

  core.llm.registerRootLlmSlot?.("learn");

  setRunChat(async (opts) => {
    if (opts.beingId && opts.beingId !== "SYSTEM" && !await core.llm.userHasLlm(opts.beingId)) return { answer: null };
    return core.llm.runChat({ ...opts, llmPriority: INT });
  });

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      initLearnState,
      getLearnState,
      processQueue,
      pauseLearn,
      resumeLearn,
      stopLearn,
    },
  };
}
