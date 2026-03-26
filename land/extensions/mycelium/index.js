import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setRunChat,
  getMyceliumConfig,
  getThisLandId,
  bufferSignal,
  drainBuffer,
  routeBatch,
  logDecisions,
  getMyceliumStatus,
} from "./core.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setRunChat((opts) => core.llm.runChat({ ...opts, llmPriority: BG }));

  const config = await getMyceliumConfig();
  const thisLandId = getThisLandId();

  // ── onCascade: buffer incoming signals for batch routing ───────────
  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, signalId, payload, source, depth } = hookData;
    if (!payload || !signalId) return;

    // Loop prevention: if this land already routed this signal, skip
    if (Array.isArray(payload._myceliumRouted) && payload._myceliumRouted.includes(thisLandId)) return;

    // Hop limit: if too many hops, stop
    if ((payload._myceliumHops || 0) >= config.maxHopsPerSignal) return;

    // Buffer for batch routing
    bufferSignal({ nodeId, signalId, payload, source, depth: depth || 0 });
  }, "mycelium");

  // ── Background job: batch routing every interval ───────────────────
  let routingTimer = null;

  async function routingCycle() {
    try {
      const signals = drainBuffer(config.maxSignalsPerCycle);
      if (signals.length === 0) return;

      const decisions = await routeBatch(signals, config);
      await logDecisions(decisions);

      const routed = decisions.filter(d => d.delivered).length;
      if (routed > 0) {
        log.verbose("Mycelium", `Routing cycle: ${routed}/${decisions.length} delivered from ${signals.length} signals`);
      }
    } catch (err) {
      log.error("Mycelium", `Routing cycle failed: ${err.message}`);
    }
  }

  // ── enrichContext: inject mycelium status at land root ──────────────
  core.hooks.register("enrichContext", async ({ context, node }) => {
    if (!node.systemRole) return; // only at land root
    try {
      const status = await getMyceliumStatus();
      if (status.totalRouted > 0 || status.peers > 0) {
        context.mycelium = {
          peers: status.peers,
          totalRouted: status.totalRouted,
          mode: status.routingMode,
          buffered: status.signalsBuffered,
        };
      }
    } catch {}
  }, "mycelium");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    jobs: [
      {
        name: "mycelium-routing",
        start: () => {
          routingTimer = setInterval(routingCycle, config.routingInterval);
          log.info("Mycelium", `Routing started (interval: ${config.routingInterval / 1000}s, mode: ${config.routingMode}, threshold: ${config.routingThreshold})`);
        },
        stop: () => {
          if (routingTimer) clearInterval(routingTimer);
          log.info("Mycelium", "Routing stopped");
        },
      },
    ],
    exports: {
      getMyceliumStatus,
    },
  };
}
