import log from "../../seed/log.js";
import tools from "./tools.js";
import { extractNamespaces, findGaps, writeGaps, getGaps, clearGaps } from "./core.js";

export async function init(core) {
  // After each cascade delivery, inspect the signal for extension namespaces
  // that don't match any loaded extension. Write gap records to the receiving node.
  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, payload, depth } = hookData;

    // Only check on actual deliveries (depth > 0), not the originating write
    if (!depth || depth === 0) return;
    if (!payload || typeof payload !== "object") return;

    const namespaces = extractNamespaces(payload);
    if (namespaces.length === 0) return;

    const gaps = findGaps(namespaces);
    if (gaps.length === 0) return;

    try {
      await writeGaps(nodeId, gaps);
      log.debug("GapDetection", `Detected ${gaps.length} gap(s) at node ${nodeId}: ${gaps.join(", ")}`);
    } catch (err) {
      log.debug("GapDetection", `Failed to write gaps at ${nodeId}: ${err.message}`);
    }
  }, "gap-detection");

  // Inject gap info into AI context so the AI can recommend missing extensions
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const gaps = meta.gaps;
    if (Array.isArray(gaps) && gaps.length > 0) {
      context.extensionGaps = gaps.map((g) => ({
        namespace: g.namespace,
        count: g.count,
        lastSeen: g.lastSeen,
      }));
    }
  }, "gap-detection");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      getGaps,
      clearGaps,
      extractNamespaces,
      findGaps,
    },
  };
}
