import log from "../../seed/log.js";
import { setServices, startIntentJob, stopIntentJob } from "./intentJob.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";

export async function init(core) {
  setServices({
    models: core.models,
    contributions: core.contributions,
    energy: core.energy || null,
  });

  // enrichContext: surface intent data so the AI knows what the tree did autonomously
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const intentMeta = meta?.intent;
    if (!intentMeta) return;

    const injected = {};

    // Show recent executions so the AI knows what the tree did autonomously
    if (intentMeta.recentExecutions?.length > 0) {
      injected.recentIntents = intentMeta.recentExecutions.slice(0, 5).map(e => ({
        action: e.action,
        reason: e.reason,
        result: e.result,
        executedAt: e.executedAt,
      }));
    }

    // Show pending queue so the AI knows what's coming
    if (intentMeta.queue?.length > 0) {
      injected.pendingIntents = intentMeta.queue.length;
    }

    // Show rejected intents so the AI doesn't suggest what the user already rejected
    if (intentMeta.rejected?.length > 0) {
      injected.rejectedIntents = intentMeta.rejected.map(r => r.action || r.pattern || r.description).filter(Boolean);
    }

    if (Object.keys(injected).length > 0) {
      context.intent = injected;
    }
  }, "intent");

  const { default: router, setModels } = await import("./routes.js");
  setModels(core.models);

  log.info("Intent", "Autonomous intent engine loaded");

  return {
    router,
    jobs: [
      {
        name: "intent-cycle",
        start: () => startIntentJob(),
        stop: () => stopIntentJob(),
      },
    ],
  };
}
