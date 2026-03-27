import log from "../../seed/log.js";
import tools from "./tools.js";
import traceMode from "./modes/trace.js";
import { runTrace, getTraceMap } from "./core.js";

export async function init(core) {
  core.modes.registerMode("tree:trace", traceMode, "trace");

  // enrichContext: inject last trace summary if fresh
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const traceMeta = meta?.trace;
    if (!traceMeta?.lastTrace) return;

    // Only inject if trace is fresh (last 7 days)
    if (traceMeta.lastTrace.tracedAt) {
      const age = Date.now() - new Date(traceMeta.lastTrace.tracedAt).getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) return;
    }

    context.recentTrace = {
      query: traceMeta.lastTrace.query,
      matches: traceMeta.lastTrace.matches,
      currentState: traceMeta.lastTrace.currentState,
      crossBranch: traceMeta.lastTrace.crossBranch,
    };
  }, "trace");

  const { default: router } = await import("./routes.js");

  log.verbose("Trace", "Trace loaded");

  return {
    router,
    tools,
    exports: {
      runTrace,
      getTraceMap,
    },
  };
}
