import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setRunChat, recordSignal, detectAndStorePatterns, generateProposals,
  getPatterns, getProposals,
} from "./core.js";

let _jobTimer = null;

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setRunChat((opts) => core.llm.runChat({ ...opts, llmPriority: BG }));

  // afterNote: record note content patterns
  core.hooks.register("afterNote", async ({ note, nodeId, userId, contentType, action }) => {
    if (contentType !== "text" || action !== "create") return;
    if (!userId || userId === "SYSTEM") return;

    recordSignal({
      type: "note",
      content: (note?.content || "").slice(0, 200),
      nodeId,
      userId,
    });
  }, "evolve");

  // afterLLMCall: record interaction patterns
  core.hooks.register("afterLLMCall", async ({ userId, nodeId, message, answer }) => {
    if (!userId || userId === "SYSTEM") return;

    const text = (answer || "").toLowerCase();
    const silence = /i don't (have|see|find)|no (information|data|notes?)|i('m| am) not (sure|finding)|can't find/i.test(text);

    recordSignal({
      type: "llm-response",
      hadAnswer: !silence,
      query: (message || "").slice(0, 200),
      nodeId,
      userId,
    });
  }, "evolve");

  const { default: router } = await import("./routes.js");

  log.verbose("Evolve", "Evolve loaded");

  return {
    router,
    tools,
    jobs: [
      {
        name: "evolve-cycle",
        start: () => {
          _jobTimer = setInterval(async () => {
            try {
              await detectAndStorePatterns();
              await generateProposals();
            } catch (err) {
              log.debug("Evolve", `Cycle failed: ${err.message}`);
            }
          }, 6 * 60 * 60 * 1000);
          if (_jobTimer.unref) _jobTimer.unref();
        },
        stop: () => {
          if (_jobTimer) { clearInterval(_jobTimer); _jobTimer = null; }
        },
      },
    ],
    exports: {
      getPatterns,
      getProposals,
      generateProposals,
    },
  };
}
