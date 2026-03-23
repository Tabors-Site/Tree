// orchestrators/pipelines/understand.js
// Autonomous understanding: creates/resumes a run, loops through all nodes,
// uses LLM for summarization only (no tool calling), commits results.

import log from "../../core/log.js";
import { switchMode, processMessage } from "../../ws/conversation.js";
import { OrchestratorRuntime } from "../../orchestrators/runtime.js";
import { emitNavigate, emitToUser } from "../../ws/websocket.js";
import {
  setActiveNavigator,
  getSession,
  updateSessionMeta,
  SESSION_TYPES,
} from "../../ws/sessionRegistry.js";
import {
  getNextCompressionPayloadForLLM,
  commitCompressionResult,
  prepareIncrementalRun,
} from "./core.js";
import UnderstandingRun from "./understandingRun.js";
import UnderstandingNode from "./understandingNode.js";

import { acquireLock, releaseLock } from "../../orchestrators/locks.js";

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function buildSummarizationPrompt(payload) {
  const input = payload.inputs[0];

  if (payload.mode === "leaf") {
    const notesText = input.notes
      .map((n) => `[${n.username}] ${n.content}`)
      .join("\n");
    const typeLabel = input.nodeType ? ` (type: ${input.nodeType})` : "";
    return `Summarize the notes for node "${input.nodeName}"${typeLabel}:\n\n${notesText}`;
  }

  if (payload.mode === "merge") {
    const nonEmpty = input.childSummaries.filter(
      (cs) => cs.summary && cs.summary.trim(),
    );
    if (nonEmpty.length === 0) {
      return `Node "${input.nodeName}" has ${input.childSummaries.length} empty children. Write a one-sentence summary of what this section likely covers based on its name alone.`;
    }
    const childText = nonEmpty
      .map((cs, i) => `[Child ${i + 1}] ${cs.summary}`)
      .join("\n\n");
    const typeLabel = input.nodeType ? ` (type: ${input.nodeType})` : "";
    return `Merge these child summaries into one cohesive summary for "${input.nodeName}"${typeLabel}:\n\n${childText}`;
  }

  throw new Error(`Unknown payload mode: ${payload.mode}`);
}

/**
 * Load the root understanding node's final encoding for a completed run.
 */
async function getRootEncoding(run) {
  const topology =
    run.topology instanceof Map
      ? run.topology
      : new Map(Object.entries(run.topology || {}));

  let rootUNodeId = null;
  for (const [uid, topo] of topology) {
    if (topo.parent === null || topo.parent === undefined) {
      rootUNodeId = uid;
      break;
    }
  }
  if (!rootUNodeId) return null;

  const rootNode = await UnderstandingNode.findById(rootUNodeId).lean();
  if (!rootNode) return null;

  const ps = rootNode.perspectiveStates;
  if (!ps) return null;

  const runId = String(run._id);
  const state =
    ps instanceof Map
      ? ps.get(runId) || ps.get(String(runId))
      : ps[runId] || ps[String(runId)];

  return state?.encoding || null;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

export async function orchestrateUnderstanding({
  rootId,
  userId,
  username,
  runId,
  source = "orchestrator",
  fromSite = false,
  sessionId: externalSessionId,
  rootChatId: externalRootChatId,
  startingChainIndex,
}) {
  // Load and validate run
  const existingRun = await UnderstandingRun.findById(runId).lean();
  if (!existingRun) {
    return { success: false, error: "Understanding run not found" };
  }
  if (String(existingRun.rootNodeId) !== String(rootId)) {
    return { success: false, error: "Run does not belong to this root" };
  }

  const understandingRunId = String(existingRun._id);

  // Concurrent-run guard
  if (!acquireLock("understand", understandingRunId)) {
    return { success: false, error: "This understanding run is already being processed" };
  }

  const runPerspective = existingRun.perspective;
  const nodeCount = existingRun.nodeMap
    ? existingRun.nodeMap instanceof Map
      ? existingRun.nodeMap.size
      : Object.keys(existingRun.nodeMap).length
    : 0;

  // Prepare incremental run
  const { dirtyCount, totalNodes } = await prepareIncrementalRun(understandingRunId, userId);
 log.debug("Understanding", `Incremental prep: ${dirtyCount}/${totalNodes} nodes dirty`);

  await UnderstandingRun.findByIdAndUpdate(understandingRunId, { status: "running" });

  // Check if already complete before spinning up resources
  const firstPayload = await getNextCompressionPayloadForLLM(understandingRunId, userId);
  if (!firstPayload) {
    releaseLock("understand", understandingRunId);
    await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
      status: "completed",
      lastCompletedAt: new Date(),
    });
    const rootEncoding = await getRootEncoding(existingRun);
    return {
      success: true,
      alreadyComplete: true,
      understandingRunId,
      perspective: runPerspective,
      nodeCount,
      nodesProcessed: 0,
      rootEncoding,
    };
  }

  const isChainStep = !!externalSessionId;
  const isSite = fromSite && !isChainStep;
  const visitorId = `understand:${rootId}:${Date.now()}`;

  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    visitorId,
    sessionType: SESSION_TYPES.UNDERSTANDING_ORCHESTRATE,
    description: `Understanding: ${runPerspective}`,
    modeKeyForLlm: "tree:understand",
    source,
    slot: "understand",
  });

  if (isChainStep) {
    await rt.attach({
      sessionId: externalSessionId,
      mainChatId: externalRootChatId || null,
      llmProvider: undefined,
      chainIndex: startingChainIndex || 1,
      connectMcp: true,
    });
  } else {
    await rt.init(`Understanding tree ${rootId} (${runPerspective})`);
  }

  if (isSite) {
    setActiveNavigator(userId, rt.sessionId);
    const sess = getSession(rt.sessionId);
    emitToUser(userId, "navigatorSession", {
      sessionId: rt.sessionId,
      type: sess?.type || SESSION_TYPES.UNDERSTANDING_ORCHESTRATE,
      description: sess?.description || `Understanding: ${runPerspective}`,
    });
  }

  let nodesProcessed = 0;

 log.verbose("Understanding", `Understand orchestrator started for run ${understandingRunId} (${runPerspective}, ${nodeCount} nodes)`);

  try {
    rt.trackStep("tree:understand", {
      input: `Run ${understandingRunId} (${runPerspective})`,
      output: { understandingRunId, perspective: runPerspective, nodeCount },
    });

    // Compression loop
    let emptyRetries = 0;
    const MAX_EMPTY_RETRIES = 3;
    let lastEmptyNodeId = null;

    while (true) {
      if (rt.aborted) throw new Error("Session stopped");

      const payload = await getNextCompressionPayloadForLLM(understandingRunId, userId);
      if (!payload) break;

      const prompt = buildSummarizationPrompt(payload);
      const stepStart = new Date();

      switchMode(visitorId, "tree:understand-summarize", {
        username,
        userId,
        perspective: runPerspective,
        nodeType: payload.inputs?.[0]?.nodeType || null,
        clearHistory: true,
      });

      const result = await processMessage(visitorId, prompt, {
        username,
        userId,
        rootId,
        slot: "understand",
        signal: rt.signal,
      });

      if (result && !result.success && result.content && !result.answer) {
        throw new Error(`No LLM available for understand slot: ${result.content}`);
      }

      const summary =
        typeof result === "string"
          ? result
          : (result?.answer || result?.content || "").trim();
      const stepEnd = new Date();

      if (!summary) {
        const nodeId = payload.target.understandingNodeId;
        if (nodeId === lastEmptyNodeId) {
          emptyRetries++;
        } else {
          emptyRetries = 1;
          lastEmptyNodeId = nodeId;
        }

 log.warn("Understanding", `Empty summary for node ${nodeId}, attempt ${emptyRetries}/${MAX_EMPTY_RETRIES}`);

        if (emptyRetries >= MAX_EMPTY_RETRIES) {
          await UnderstandingRun.findByIdAndUpdate(understandingRunId, {
            $unset: { pendingMerge: "" },
          });
          await commitCompressionResult({
            mode: payload.mode,
            understandingRunId,
            encoding: "(empty)",
            understandingNodeId: nodeId,
            currentLayer: payload.mode === "leaf" ? 0 : payload.target.nextLayer,
            userId,
            wasAi: true,
            aiChatId: rt.mainChatId,
            sessionId: rt.sessionId,
          });
          nodesProcessed++;
 log.warn("Understanding", `Committed placeholder for stuck node ${nodeId}, moving on`);
          emptyRetries = 0;
          lastEmptyNodeId = null;
        }
        continue;
      }

      emptyRetries = 0;
      lastEmptyNodeId = null;

      await commitCompressionResult({
        mode: payload.mode,
        understandingRunId,
        encoding: summary,
        understandingNodeId: payload.target.understandingNodeId,
        currentLayer: payload.mode === "leaf" ? 0 : payload.target.nextLayer,
        userId,
        wasAi: true,
        aiChatId: rt.mainChatId,
        sessionId: rt.sessionId,
      });

      nodesProcessed++;
      updateSessionMeta(rt.sessionId, { nodeId: payload.target.realNodeId || rootId });

      if (isSite) {
        emitNavigate({
          userId,
          url: `/api/v1/root/${rootId}/understandings/run/${understandingRunId}/${payload.target.understandingNodeId}?html`,
          sessionId: rt.sessionId,
        });
      }

      rt.trackStep("tree:understand-summarize", {
        input: `${payload.mode}: ${payload.inputs[0]?.nodeName || "unknown"}`,
        output: {
          mode: payload.mode,
          understandingNodeId: payload.target.understandingNodeId,
          summaryLength: summary.length,
        },
        startTime: stepStart,
        endTime: stepEnd,
        llmProvider: result?.llmProvider || rt.llmProvider,
      });

 log.debug("Understanding", `  ${payload.mode} node ${payload.inputs[0]?.nodeName} (${nodesProcessed}/${nodeCount})`);
    }

    // Finalize
    const finalRun = await UnderstandingRun.findById(understandingRunId).lean();
    const rootEncoding = await getRootEncoding(finalRun);

    const completedAt = new Date();
    await UnderstandingRun.findByIdAndUpdate(
      understandingRunId,
      rootEncoding
        ? {
            status: "completed",
            lastCompletedAt: completedAt,
            $push: { encodingHistory: { encoding: rootEncoding, completedAt } },
          }
        : { status: "completed", lastCompletedAt: completedAt },
    );

    rt.setResult(
      rootEncoding || `Processed ${nodesProcessed} nodes`,
      "tree:understand",
    );

    if (isSite) {
      emitNavigate({
        userId,
        url: `/api/v1/root/${rootId}/understandings/run/${understandingRunId}?html`,
        sessionId: rt.sessionId,
      });
    }

 log.verbose("Understanding", `Understanding complete for root ${rootId} (${nodesProcessed} nodes processed)`);

    return {
      success: true,
      understandingRunId,
      perspective: runPerspective,
      nodeCount,
      nodesProcessed,
      rootEncoding,
    };
  } catch (err) {
 log.error("Understanding", `Understanding orchestration error for root ${rootId}:`, err.message);
    rt.setError(err.message, "tree:understand");

    rt.trackStep("tree:understand", {
      input: "error",
      output: { error: err.message },
    });

    return { success: false, error: err.message };
  } finally {
    try {
      const currentRun = await UnderstandingRun.findById(understandingRunId).select("status").lean();
      if (currentRun?.status === "running") {
        await UnderstandingRun.findByIdAndUpdate(understandingRunId, { status: "completed" });
      }
    } catch (_) {}
    releaseLock("understand", understandingRunId);
    await rt.cleanup();
  }
}
