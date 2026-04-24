import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  configure, setRunChat, recordSignal, detectAndStorePatterns, generateProposals,
  getPatterns, getProposals,
} from "./core.js";

let _jobTimer = null;

export async function init(core) {
  configure({ metadata: core.metadata });
  core.llm.registerRootLlmSlot("evolve");
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setRunChat(async (opts) => {
    if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
    return core.llm.runChat({ ...opts, llmPriority: BG });
  });

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

  // afterLLMCall: record interaction patterns. hadAnswer is derived from
  // responseText (truthy + non-whitespace = answered). Without this the
  // knowledge-gap pattern detector in core.js (checking s.hadAnswer===false)
  // never fires because nothing in the recordSignal payload carried an
  // answer flag. Using responseText instead of passing a separate field
  // avoids a kernel-side hook-data change.
  core.hooks.register("afterLLMCall", async ({ userId, rootId, mode, hasToolCalls, responseText }) => {
    if (!userId || userId === "SYSTEM") return;

    const hadAnswer = !!(responseText && String(responseText).trim());

    recordSignal({
      type: "llm-response",
      hadAnswer,
      hadToolCalls: !!hasToolCalls,
      mode: mode || "unknown",
      rootId,
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
