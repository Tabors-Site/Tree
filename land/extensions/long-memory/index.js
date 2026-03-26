import log from "../../seed/log.js";
import tools from "./tools.js";
import { writeTrace, getMemory, getLongMemoryConfig } from "./core.js";

export async function init(core) {
  const config = await getLongMemoryConfig();

  // Listen to every cascade event and write a trace to the receiving node.
  // onCascade fires at each node that receives a signal. hookData contains
  // nodeId (target), source (sender), signalId, depth.
  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, source, signalId } = hookData;
    if (!nodeId || !source) return;

    // Don't trace self-origination (depth 0 is the node that wrote the content)
    if (hookData.depth === 0) return;

    const status = hookData._resultStatus || "succeeded";

    try {
      await writeTrace(nodeId, source, status, config.maxConnections);
    } catch (err) {
      log.debug("LongMemory", `Trace write failed at ${nodeId}: ${err.message}`);
    }
  }, "long-memory");

  // Inject memory into AI context so the AI knows this node's relationship history
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const memory = meta.memory;
    if (memory && memory.totalInteractions > 0) {
      context.memory = {
        lastSeen: memory.lastSeen,
        lastStatus: memory.lastStatus,
        totalInteractions: memory.totalInteractions,
        recentSources: (memory.connections || []).slice(-5).map((c) => c.sourceId),
      };
    }
  }, "long-memory");

  return {
    tools,
    exports: {
      getMemory,
      writeTrace,
    },
  };
}
