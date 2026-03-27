import log from "../../seed/log.js";
import tools from "./tools.js";
import { processLLMCall, getCompetence } from "./core.js";

export async function init(core) {
  // afterLLMCall: detect whether the AI answered or found silence
  core.hooks.register("afterLLMCall", async ({ userId, rootId, nodeId, message, answer }) => {
    if (!nodeId || !userId || userId === "SYSTEM") return;

    try {
      processLLMCall({ nodeId, userId, message, answer });
    } catch (err) {
      log.debug("Competence", `afterLLMCall processing failed: ${err.message}`);
    }
  }, "competence");

  // enrichContext: tell the AI what it can and can't help with
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const comp = meta?.competence;
    if (!comp?.queries?.length || comp.queries.length < 10) return; // need enough data

    const strong = comp.strongTopics?.slice(0, 5) || [];
    const weak = comp.weakTopics?.slice(0, 5) || [];

    if (strong.length > 0 || weak.length > 0) {
      context.competence = {
        canHelpWith: strong,
        noDataOn: weak,
        answerRate: comp.answerRate,
      };
    }
  }, "competence");

  const { default: router } = await import("./routes.js");

  log.verbose("Competence", "Competence loaded");

  return {
    router,
    tools,
    exports: {
      getCompetence,
    },
  };
}
