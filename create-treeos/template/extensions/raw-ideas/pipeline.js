// orchestrators/pipelines/rawIdea.js
// Automates raw idea placement: chooseRoot -> delegate to treeOrchestrator -> record result.

import log from "../../seed/log.js";
import { DELETED } from "../../seed/protocol.js";
import { OrchestratorRuntime, parseJsonSafe } from "../../seed/orchestrators/runtime.js";
import { SESSION_TYPES, updateSessionMeta } from "../../seed/ws/sessionRegistry.js";
import { setRootId, getClientForUser, LLM_PRIORITY } from "../../seed/ws/conversation.js";

import { getOrchestrator } from "../../seed/orchestrators/registry.js";
import {
  buildDeepTreeSummary,
} from "../../seed/tree/treeFetch.js";
import { getExtension } from "../loader.js";
import { logContribution } from "../../seed/tree/contributions.js";
import RawIdea from "./model.js";
import Node from "../../seed/models/node.js";

import { nullSocket } from "../../seed/orchestrators/helpers.js";

/**
 * Extract the best targetNodeId from a tree result's step summaries.
 */
function extractTargetNodeId(treeResult) {
  if (!treeResult) return null;
  const summaries = treeResult.stepSummaries || [];
  for (let i = summaries.length - 1; i >= 0; i--) {
    const s = summaries[i];
    if (s.target && !s.skipped && !s.failed) {
      const nodeId = s.targetNodeId || null;
      if (nodeId) return nodeId;
    }
  }
  return treeResult.rootId || null;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

export async function orchestrateRawIdeaPlacement({
  rawIdeaId,
  userId,
  username,
  withResponse = false,
  source = "orchestrator",
}) {
  // Load and validate raw idea before creating runtime
  const rawIdea = await RawIdea.findById(rawIdeaId);
  if (!rawIdea || rawIdea.userId === DELETED) {
 log.warn("Raw Ideas", `Raw idea ${rawIdeaId} not found or already placed`);
    return withResponse ? { success: false, reason: "Raw idea not found" } : undefined;
  }
  if (rawIdea.userId !== userId) {
 log.warn("Raw Ideas", `Raw idea ${rawIdeaId} ownership mismatch`);
    return withResponse ? { success: false, reason: "Not authorized" } : undefined;
  }
  if (rawIdea.status && rawIdea.status !== "pending") {
 log.warn("Raw Ideas", `Raw idea ${rawIdeaId} already ${rawIdea.status}`);
    return withResponse ? { success: false, reason: `Already ${rawIdea.status}` } : undefined;
  }

  // Determine session type
  const sessionType = source === "background"
    ? SESSION_TYPES.SCHEDULED_RAW_IDEA
    : withResponse
      ? SESSION_TYPES.RAW_IDEA_CHAT
      : SESSION_TYPES.RAW_IDEA_ORCHESTRATE;

  // Resolve LLM provider for the slot
  let llmProvider;
  try {
    const clientInfo = await getClientForUser(userId, "rawIdea");
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    llmProvider = undefined;
  }

  const rt = new OrchestratorRuntime({
    rootId: "pending", // will be set after root selection
    userId,
    username,
    visitorId: `rawIdea:${rawIdeaId}`,
    sessionType,
    description: `Raw idea placement: ${rawIdeaId}`,
    modeKeyForLlm: "tree:librarian", // fallback, chooseRoot is tool-less
    source,
    slot: "rawIdea",
    llmPriority: source === "background" ? (LLM_PRIORITY?.BACKGROUND || 4) : undefined,
  });

  // Mark as processing
  rawIdea.status = "processing";
  rawIdea.aiSessionId = null; // will be set after init
  await rawIdea.save();

  await rt.init(rawIdea.content);
  rawIdea.aiSessionId = rt.sessionId;
  await rawIdea.save();

  // Log contribution: AI started processing
  await logContribution({
    userId,
    nodeId: DELETED,
    wasAi: true,
    sessionId: rt.sessionId,
    action: "rawIdea",
    nodeVersion: "0",
    rawIdeaAction: { action: "aiStarted", rawIdeaId: rawIdeaId.toString() },
  });


 log.verbose("Raw Ideas", `Raw-idea orchestrator started for ${rawIdeaId} (session: ${rt.sessionId})`);

  const markStuck = async (reason) => {
 log.verbose("Raw Ideas", `Raw idea ${rawIdeaId} stuck: ${reason}`);
    rawIdea.status = "stuck";
    await rawIdea.save();
    rt.setResult(reason, "rawIdea:stuck");
    rt.trackStep("rawIdea:complete", {
      input: reason,
      output: { status: "stuck", reason },
    });
    logContribution({
      userId,
      nodeId: DELETED,
      wasAi: true,
      chatId: rt.mainChatId,
      sessionId: rt.sessionId,
      action: "rawIdea",
      nodeVersion: "0",
      rawIdeaAction: { action: "aiFailed", rawIdeaId: rawIdeaId.toString() },
 }).catch((e) => log.error("Raw Ideas", `Failed to log aiFailed contribution:`, e.message));
  };

  try {
    // PHASE 1: Choose best-fit root
    const nav = getExtension("navigation")?.exports;
    const roots = nav ? await nav.getUserRootsWithNames(userId) : [];
    if (!roots || roots.length === 0) {
      await markStuck("No trees available for this user");
      return withResponse ? { success: false, reason: "No trees available for this user" } : undefined;
    }

    const rootSummaries = await Promise.all(
      roots.map(async (r) => {
        let encodingMap = null;
        try {
          const uExt = getExtension("understanding");
          if (uExt?.exports?.getEncodingMap) encodingMap = await uExt.exports.getEncodingMap(r._id);
        } catch {}
        const summary = await buildDeepTreeSummary(r._id, { encodingMap }).catch(() => "(summary unavailable)");
        return { rootId: r._id, name: r.name, summary };
      }),
    );

    const { parsed, raw: chooseResult } = await rt.runStep("home:raw-idea-choose-root", {
      prompt: rawIdea.content,
      modeCtx: { content: rawIdea.content, rootSummaries },
      input: rawIdea.content,
    });

    const chosenRootId = parsed?.rootId;
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0;

    if (!chosenRootId || confidence < 0.35) {
      const stuckReason = parsed?.reasoning || `No tree fit (confidence: ${confidence.toFixed(2)})`;
      await markStuck(stuckReason);
      return withResponse ? { success: false, reason: stuckReason } : undefined;
    }

 log.debug("Raw Ideas", `Chosen root: ${parsed.rootName} (${chosenRootId}) confidence=${confidence.toFixed(2)}`);

    // PHASE 2: Delegate to tree orchestrator
    setRootId(rt.visitorId, chosenRootId);
    updateSessionMeta(rt.sessionId, { rootId: chosenRootId });

    const treeOrch = getOrchestrator("tree");
    if (!treeOrch) throw new Error("No tree orchestrator installed");
    const treeResult = await treeOrch.handle({
      visitorId: rt.visitorId,
      message: rawIdea.content,
      socket: nullSocket,
      username,
      userId,
      signal: rt.signal,
      sessionId: rt.sessionId,
      rootId: chosenRootId,
      skipRespond: !withResponse,
      slot: "rawIdea",
      rootChatId: rt.mainChatId,
      sourceType: withResponse ? "raw-idea-chat" : "raw-idea-place",
      sourceId: rawIdeaId.toString(),
    });

    // Deferred to short-term memory
    if (treeResult?.deferred) {
      rawIdea.status = "deferred";
      rawIdea.aiSessionId = rt.sessionId;
      await rawIdea.save();

      rt.trackStep("rawIdea:deferred", {
        input: rawIdea.content,
        output: { status: "deferred", memoryItemId: treeResult.memoryItemId },
      });

      rt.setResult(
        withResponse
          ? treeResult.answer || "Noted, collecting more context before placing."
          : "Deferred to short-term memory",
        "rawIdea:deferred",
      );

 log.debug("Raw Ideas", `Raw idea deferred to short memory`);

      if (withResponse) {
        return {
          success: true,
          deferred: true,
          answer: treeResult.answer || "Noted, collecting more context before placing.",
          rootId: chosenRootId,
          rootName: parsed.rootName,
        };
      }
      return undefined;
    }

    if (!treeResult || treeResult.noFit || !treeResult.success) {
      const stuckReason = treeResult?.reason
        || (treeResult?.noFit ? "Tree rejected the idea (no_fit)" : "Tree orchestration failed");
      await markStuck(stuckReason);
      return withResponse ? { success: false, reason: stuckReason } : undefined;
    }

    // PHASE 3: Record successful placement
    const targetNodeId = extractTargetNodeId(treeResult) || chosenRootId;

    rawIdea.status = "succeeded";
    rawIdea.placedAt = new Date();
    await rawIdea.save();

    const targetNode = await Node.findById(targetNodeId).select("metadata name parent").lean();
    const pMeta = targetNode?.metadata instanceof Map ? targetNode.metadata.get("prestige") : targetNode?.metadata?.prestige;
    const nodeVersion = String(pMeta?.current || 0);

    // Build full path from root to target node
    const targetNodePath = [];
    let cursor = targetNode;
    while (cursor) {
      if (cursor.systemRole) break;
      targetNodePath.unshift({ _id: cursor._id, name: cursor.name });
      if (!cursor.parent || cursor.parent === DELETED) break;
      cursor = await Node.findById(cursor.parent).select("_id name parent systemRole").lean();
    }

    await logContribution({
      userId,
      nodeId: targetNodeId,
      wasAi: true,
      chatId: rt.mainChatId,
      sessionId: rt.sessionId,
      action: "rawIdea",
      nodeVersion,
      rawIdeaAction: { action: "placed", rawIdeaId: rawIdeaId.toString(), targetNodeId },
    });

    rt.trackStep("rawIdea:complete", {
      input: rawIdea.content,
      output: { status: "succeeded", targetNodeId },
    });

    rt.setResult(
      withResponse ? treeResult.answer || `Placed on node ${targetNodeId}` : `Placed on node ${targetNodeId}`,
      "rawIdea:complete",
    );

 log.debug("Raw Ideas", `Raw idea placed on node ${targetNodeId}`);

    if (withResponse) {
      return {
        success: true,
        answer: treeResult.answer || null,
        rootId: chosenRootId,
        rootName: parsed.rootName || null,
        targetNodeId,
        targetNodePath,
      };
    }
  } catch (err) {
 log.error("Raw Ideas", `Raw-idea orchestration error for ${rawIdeaId}:`, err.message);
    try {
      rawIdea.status = "stuck";
      await rawIdea.save();
      rt.trackStep("rawIdea:complete", {
        input: rawIdea.content,
        output: { status: "stuck", reason: err.message },
      });
      logContribution({
        userId,
        nodeId: DELETED,
        wasAi: true,
        chatId: rt.mainChatId,
        sessionId: rt.sessionId,
        action: "rawIdea",
        nodeVersion: "0",
        rawIdeaAction: { action: "aiFailed", rawIdeaId: rawIdeaId.toString() },
 }).catch((e) => log.error("Raw Ideas", `Failed to log aiFailed contribution:`, e.message));
    } catch (saveErr) {
 log.error("Raw Ideas", `Failed to mark raw idea as stuck:`, saveErr.message);
    }
    rt.setError(err.message, "rawIdea:complete");
    if (withResponse) {
      return { success: false, reason: err.message };
    }
  } finally {
    await rt.cleanup();
  }
}
