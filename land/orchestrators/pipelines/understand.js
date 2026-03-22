// orchestrators/pipelines/understand.js
// Autonomous understanding: creates/resumes a run, loops through all nodes,
// uses LLM for summarization only (no tool calling), commits results.

import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

import {
  switchMode,
  processMessage,
  getClientForUser,
  resolveRootLlmForMode,
  clearSession,
} from "../../ws/conversation.js";
import {
  trackChainStep,
  startAIChat,
  finalizeAIChat,
  setAiContributionContext,
  clearAiContributionContext,
} from "../../ws/aiChatTracker.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../../ws/mcp.js";
import { emitNavigate, emitToUser } from "../../ws/websocket.js";
import {
  createSession,
  endSession,
  setActiveNavigator,
  getSession,
  updateSessionMeta,
  setSessionAbort,
  clearSessionAbort,
  SESSION_TYPES,
} from "../../ws/sessionRegistry.js";
import {
  getNextCompressionPayloadForLLM,
  commitCompressionResult,
  prepareIncrementalRun,
} from "../../core/tree/understanding.js";
import UnderstandingRun from "../../extensions/understanding/understandingRun.js";
import UnderstandingNode from "../../extensions/understanding/understandingNode.js";
import Node from "../../db/models/node.js";

import { acquireLock, releaseLock } from "../locks.js";

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
  console.log(`Incremental prep: ${dirtyCount}/${totalNodes} nodes dirty`);

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
  let sessionId;
  const abort = new AbortController();

  if (isChainStep) {
    sessionId = externalSessionId;
  } else {
    ({ sessionId } = createSession({
      userId,
      type: SESSION_TYPES.UNDERSTANDING_ORCHESTRATE,
      description: `Understanding: ${runPerspective}`,
      meta: { rootId, runId: understandingRunId, visitorId },
    }));
    setSessionAbort(sessionId, abort);
  }

  if (isSite) {
    setActiveNavigator(userId, sessionId);
    const sess = getSession(sessionId);
    emitToUser(userId, "navigatorSession", {
      sessionId,
      type: sess?.type || SESSION_TYPES.UNDERSTANDING_ORCHESTRATE,
      description: sess?.description || `Understanding: ${runPerspective}`,
    });
  }

  let chainIndex = startingChainIndex || 1;
  let nodesProcessed = 0;
  let finalizeArgs = { content: null, stopped: true, modeKey: "tree:understand" };
  let mainChatId = externalRootChatId || null;

  // Resolve LLM provider
  let llmProvider;
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, "tree:understand");
    const clientInfo = await getClientForUser(userId, "understand", modeConnectionId);
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    llmProvider = undefined;
  }

  // MCP connection
  const internalJwt = jwt.sign({ userId, username, visitorId }, JWT_SECRET, { expiresIn: "1h" });
  await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);

  // Start AIChat record (standalone only)
  if (!isChainStep) {
    const mainChat = await startAIChat({
      userId,
      sessionId,
      message: `Understanding tree ${rootId} (${runPerspective})`,
      source,
      modeKey: "tree:understand",
      llmProvider,
    });
    mainChatId = mainChat._id;
  }
  if (mainChatId) {
    setAiContributionContext(visitorId, sessionId, mainChatId);
  }

  console.log(`Understand orchestrator started for run ${understandingRunId} (${runPerspective}, ${nodeCount} nodes)`);

  try {
    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:understand",
      source,
      input: `Run ${understandingRunId} (${runPerspective})`,
      output: { understandingRunId, perspective: runPerspective, nodeCount },
      llmProvider,
    });

    // Compression loop
    let emptyRetries = 0;
    const MAX_EMPTY_RETRIES = 3;
    let lastEmptyNodeId = null;

    while (true) {
      if (abort.signal.aborted) throw new Error("Session stopped");

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
        signal: abort.signal,
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

        console.warn(`Empty summary for node ${nodeId}, attempt ${emptyRetries}/${MAX_EMPTY_RETRIES}`);

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
            aiChatId: mainChatId,
            sessionId,
          });
          nodesProcessed++;
          console.warn(`Committed placeholder for stuck node ${nodeId}, moving on`);
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
        aiChatId: mainChatId,
        sessionId,
      });

      nodesProcessed++;
      updateSessionMeta(sessionId, { nodeId: payload.target.realNodeId || rootId });

      if (isSite) {
        emitNavigate({
          userId,
          url: `/api/v1/root/${rootId}/understandings/run/${understandingRunId}/${payload.target.understandingNodeId}?html`,
          sessionId,
        });
      }

      trackChainStep({
        userId,
        sessionId,
        rootChatId: mainChatId,
        chainIndex: chainIndex++,
        modeKey: "tree:understand-summarize",
        source,
        input: `${payload.mode}: ${payload.inputs[0]?.nodeName || "unknown"}`,
        output: {
          mode: payload.mode,
          understandingNodeId: payload.target.understandingNodeId,
          summaryLength: summary.length,
        },
        startTime: stepStart,
        endTime: stepEnd,
        llmProvider: result?.llmProvider || llmProvider,
      });

      console.log(`  ${payload.mode} node ${payload.inputs[0]?.nodeName} (${nodesProcessed}/${nodeCount})`);
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

    finalizeArgs = {
      content: rootEncoding || `Processed ${nodesProcessed} nodes`,
      stopped: false,
      modeKey: "tree:understand",
    };

    if (isSite) {
      emitNavigate({
        userId,
        url: `/api/v1/root/${rootId}/understandings/run/${understandingRunId}?html`,
        sessionId,
      });
    }

    console.log(`Understanding complete for root ${rootId} (${nodesProcessed} nodes processed)`);

    return {
      success: true,
      understandingRunId,
      perspective: runPerspective,
      nodeCount,
      nodesProcessed,
      rootEncoding,
    };
  } catch (err) {
    console.error(`Understanding orchestration error for root ${rootId}:`, err.message);
    finalizeArgs = { content: err.message, stopped: abort.signal.aborted, modeKey: "tree:understand" };

    trackChainStep({
      userId,
      sessionId,
      rootChatId: mainChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:understand",
      source,
      input: "error",
      output: { error: err.message },
      llmProvider,
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
    if (!isChainStep && mainChatId) {
      finalizeAIChat({ chatId: mainChatId, ...finalizeArgs }).catch((e) =>
        console.error(`Failed to finalize understand session chat:`, e.message),
      );
    }
    clearAiContributionContext(visitorId);
    if (!isChainStep) {
      clearSessionAbort(sessionId);
      endSession(sessionId);
    }
    closeMCPClient(visitorId);
    clearSession(visitorId);
  }
}
