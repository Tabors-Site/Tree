import log from "../../seed/log.js";
import tools from "./tools.js";
import { configure, generateSuggestions, getNearbySuggestions } from "./core.js";

let _jobTimer = null;

export async function init(core) {
  configure({ metadata: core.metadata });
  // enrichContext: surface delegate suggestions when the suggested user is nearby
  core.hooks.register("enrichContext", async ({ context, node, meta, userId }) => {
    if (!userId) return;
    if (node.systemRole) return; // skip system nodes

    // Need a rootId to look up suggestions
    let rootId = null;
    if (node.rootOwner) {
      rootId = String(node._id);
    } else {
      try {
        const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
        const root = await resolveRootNode(String(node._id));
        rootId = root?._id ? String(root._id) : null;
      } catch { return; }
    }
    if (!rootId) return;

    try {
      const nearby = await getNearbySuggestions(String(node._id), userId, rootId);
      if (nearby.length === 0) return;

      context.delegateSuggestions = nearby.map(s => ({
        id: s.id,
        nodeName: s.nodeName,
        daysSilent: s.daysSilent,
        reasons: s.reasons,
      }));
    } catch (err) {
      log.debug("Delegate", `enrichContext failed: ${err.message}`);
    }
  }, "delegate");

  const { default: router } = await import("./routes.js");

  log.verbose("Delegate", "Delegate loaded");

  return {
    router,
    tools,
    jobs: [
      {
        name: "delegate-cycle",
        start: () => {
          const interval = 6 * 60 * 60 * 1000; // every 6 hours
          _jobTimer = setInterval(async () => {
            try {
              const Node = core.models.Node;
              const roots = await Node.find({
                rootOwner: { $nin: [null, "SYSTEM"] },
                contributors: { $exists: true, $not: { $size: 0 } },
              }).select("_id").lean();

              for (const root of roots) {
                try {
                  await generateSuggestions(String(root._id));
                } catch (err) {
                  log.debug("Delegate", `Suggestion generation failed for ${root._id}: ${err.message}`);
                }
              }
            } catch (err) {
              log.error("Delegate", `Delegate cycle failed: ${err.message}`);
            }
          }, interval);
          if (_jobTimer.unref) _jobTimer.unref();
        },
        stop: () => {
          if (_jobTimer) {
            clearInterval(_jobTimer);
            _jobTimer = null;
          }
        },
      },
    ],
    exports: {
      generateSuggestions,
      getNearbySuggestions,
    },
  };
}
