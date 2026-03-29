/**
 * High-level multi-step pipeline for extensions.
 * Handles: lock, session, MCP, Chat chain, step execution, cleanup.
 *
 * Usage:
 *   const result = await runPipeline({
 *     userId, username, rootId,
 *     description: "Dream cycle for MyTree",
 *     sessionType: "dream-orchestrate",
 *     modeKeyForLlm: "tree:respond",
 *     lockNamespace: "dream",
 *     steps: async (pipeline) => {
 *       const { parsed } = await pipeline.step("tree:cleanup-analyze", {
 *         prompt: "Analyze this tree for cleanup opportunities",
 *       });
 *       return { summary: "Done" };
 *     },
 *   });
 */

import { OrchestratorRuntime } from "./runtime.js";

export async function runPipeline({
  userId, username, rootId, description,
  sessionType = "orchestration",
  modeKeyForLlm = "tree:respond",
  source = "orchestrator",
  lockNamespace = null,
  lockKey = null,
  steps,
  slot = null,
  llmPriority = null,
}) {
  if (!userId || !steps) throw new Error("runPipeline requires userId and steps function");

  const visitorId = `pipeline-${lockNamespace || "run"}-${rootId || userId}-${Date.now()}`;

  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username: username || "system",
    visitorId,
    sessionType,
    description: description || "Pipeline run",
    modeKeyForLlm,
    source,
    lockNamespace,
    lockKey: lockKey || rootId,
    slot,
    llmPriority,
  });

  const initialized = await rt.init(description);
  if (!initialized) {
    return { success: false, reason: "Could not acquire lock", locked: true };
  }

  const pipeline = {
    async step(modeKey, { prompt, modeCtx, input, treeContext } = {}) {
      if (rt.aborted) throw new Error("Pipeline aborted");
      return rt.runStep(modeKey, { prompt, modeCtx, input, treeContext });
    },
    get aborted() { return rt.aborted; },
    get signal() { return rt.signal; },
    get sessionId() { return rt.sessionId; },
    get chatId() { return rt.mainChatId; },
    get chainIndex() { return rt.chainIndex; },
    get llmProvider() { return rt.llmProvider; },
  };

  try {
    const result = await steps(pipeline);
    rt.setResult(
      typeof result === "string" ? result : JSON.stringify(result),
      `${lockNamespace || "pipeline"}:complete`
    );
    return { success: true, ...result };
  } catch (err) {
    rt.setError(err.message, `${lockNamespace || "pipeline"}:error`);
    return { success: false, error: err.message };
  } finally {
    await rt.cleanup();
  }
}
