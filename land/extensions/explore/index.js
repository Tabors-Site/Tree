import log from "../../seed/log.js";
import tools from "./tools.js";
import { setRunChat, runExplore, getExploreMap, getExploreGaps } from "./core.js";

export async function init(core) {
  const INT = core.llm.LLM_PRIORITY.INTERACTIVE;
  setRunChat((opts) => core.llm.runChat({ ...opts, llmPriority: INT }));

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
