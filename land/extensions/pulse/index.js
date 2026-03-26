import log from "../../seed/log.js";
import { ensurePulseNode, getLatestSnapshot, getPulseNodeId } from "./core.js";
import { startPulseJob, stopPulseJob } from "./job.js";

export async function init(core) {
  // Create .pulse node under land root if it doesn't exist
  await ensurePulseNode();

  // Inject health data into AI context when at or near land root
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    // Only inject at land root level (when the AI is in land management context)
    const pulseNodeId = getPulseNodeId();
    if (!pulseNodeId) return;

    const snapshot = await getLatestSnapshot();
    if (snapshot) {
      context.landHealth = {
        failureRate: snapshot.failureRate,
        elevated: snapshot.elevated,
        signals: snapshot.signals,
        results: snapshot.results,
        lastUpdated: snapshot.timestamp,
      };
    }
  }, "pulse");

  const { default: router } = await import("./routes.js");

  return {
    router,
    jobs: [
      {
        name: "pulse-health-check",
        start: () => { startPulseJob(); },
        stop: () => { stopPulseJob(); },
      },
    ],
    exports: {
      getLatestSnapshot,
      getPulseNodeId,
    },
  };
}
