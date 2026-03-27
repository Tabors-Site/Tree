import log from "../../seed/log.js";
import tools from "./tools.js";
import exploreMode from "./modes/explore.js";
import { runExplore, getExploreMap, getExploreGaps } from "./core.js";

export async function init(core) {
  // Register the explore mode. Hidden from mode bar. Used internally by the
  // OrchestratorRuntime during the evaluation step of the exploration pipeline.
  core.modes.registerMode("tree:explore", exploreMode, "explore");

  // Inject last explore map into AI context at positions that have been explored.
  // The AI sees not just the tree summary but also "last time someone explored
  // this branch, here's what they found."
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const explore = meta.explore;
    if (!explore?.lastMap) return;

    // Only inject if the map is reasonably fresh (last 7 days)
    if (explore.lastExplored) {
      const age = Date.now() - new Date(explore.lastExplored).getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) return;
    }

    const map = explore.lastMap;
    context.exploreMap = {
      query: map.query,
      coverage: map.coverage,
      confidence: map.confidence,
      findings: (map.map || []).slice(0, 5).map(f => ({
        nodeName: f.nodeName,
        relevance: f.relevance,
        summary: f.summary,
      })),
      gaps: (map.gaps || []).slice(0, 3),
    };
  }, "explore");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      runExplore,
      getExploreMap,
      getExploreGaps,
    },
  };
}
