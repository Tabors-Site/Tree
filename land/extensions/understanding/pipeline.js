// Understanding pipeline.
// Autonomous understanding: creates/resumes a run, loops through all nodes,
// uses LLM for summarization only (no tool calling), commits results.
// Uses OrchestratorRuntime for session lifecycle, lock management, and LLM calls.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import { emitNavigate, emitToUser } from "../../seed/ws/websocket.js";
import {
  setActiveNavigator,
  getSession,
  updateSessionMeta,
  SESSION_TYPES,
} from "../../seed/ws/sessionRegistry.js";
import {
  getNextCompressionPayloadForLLM,
  commitCompressionResult,
  prepareIncrementalRun,
} from "./core.js";
import UnderstandingRun from "./understandingRun.js";
import UnderstandingNode from "./understandingNode.js";

// LLM_PRIORITY accessed via core.llm.LLM_PRIORITY in the caller,
// but the pipeline constructs its own runtime so we import directly.
let LLM_PRIORITY;
try {
  ({ LLM_PRIORITY } = await import("../../seed/llm/conversation.js"));
} catch {
  LLM_PRIORITY = { BACKGROUND: 4 };
}

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

  // OrchestratorRuntime handles: session, MCP, chat, lock, cleanup.
  // Lock namespace "understand" with the run ID as key prevents concurrent runs.
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    visitorId,
    sessionType: SESSION_TYPES.UNDERSTANDING_ORCHESTRATE,
    description: `Understanding: ${runPerspective}`,
    modeKeyForLlm: "tree:understand",
    source,
    slot: "understanding",
    llmPriority: LLM_PRIORITY?.BACKGROUND || 4,
    lockNamespace: "understand",
    lockKey: understandingRunId,
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
    const ok = await rt.init(`Understanding tree ${rootId} (${runPerspective})`);
    if (!ok) {
      return { success: false, error: "This understanding run is already being processed" };
    }
  }

  // Store runId in session meta so the stop route can find it
  updateSessionMeta(rt.sessionId, { runId: understandingRunId });

  if (isSite) {
    setActiveNavigator(userId, rt.sessionId);
    const sess = getSession(rt.sessionId);
    emitToUser(userId, WS.NAVIGATOR_SESSION, {
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

      // rt.runStep handles: switchMode, processMessage, lock renewal,
      // abort check, chain tracking. Returns { parsed, raw, llmProvider }.
      const { parsed: summary, raw: result } = await rt.runStep("tree:understand-summarize", {
        prompt,
        modeCtx: {
          perspective: runPerspective,
          nodeType: payload.inputs?.[0]?.nodeType || null,
          clearHistory: true,
        },
        input: `${payload.mode}: ${payload.inputs[0]?.nodeName || "unknown"}`,
      });

      // rt.runStep returns parsed via parseJsonSafe. For plain text summaries,
      // parseJsonSafe returns the string as-is. Extract the text.
      const summaryText = typeof summary === "string"
        ? summary.trim()
        : (result?.answer || result?.content || "").trim();

      if (!summaryText) {
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
            chatId: rt.mainChatId,
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
        encoding: summaryText,
        understandingNodeId: payload.target.understandingNodeId,
        currentLayer: payload.mode === "leaf" ? 0 : payload.target.nextLayer,
        userId,
        wasAi: true,
        chatId: rt.mainChatId,
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
    const isAbort = rt.aborted || err.name === "AbortError" || err.message?.includes("aborted");
    if (isAbort) {
      log.info("Understanding", `Run ${understandingRunId} stopped by user (${nodesProcessed} nodes processed)`);
    } else {
      log.error("Understanding", `Understanding orchestration error for root ${rootId}:`, err.message);
      rt.setError(err.message, "tree:understand");
    }
    return { success: isAbort, stopped: isAbort, error: isAbort ? null : err.message };
  } finally {
    try {
      const currentRun = await UnderstandingRun.findById(understandingRunId).select("status").lean();
      if (currentRun?.status === "running") {
        await UnderstandingRun.findByIdAndUpdate(understandingRunId, { status: "completed" });
      }
    } catch (err) { log.debug("Understanding", "Failed to finalize run status:", err.message); }
    // rt.cleanup() releases the lock, finalizes chat, closes MCP, ends session.
    await rt.cleanup();
  }
}
