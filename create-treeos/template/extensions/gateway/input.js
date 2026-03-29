// core/gatewayInput.js
// Central processor for incoming gateway messages (Telegram, Discord).
// Mirrors the tree.js API endpoint pattern but with per-channel queue + cancel.

import log from "../../seed/log.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import GatewayChannel from "./model.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import { getOrchestrator } from "../../seed/orchestrators/registry.js";
import {
  userHasLlm,
  LLM_PRIORITY,
} from "../../seed/ws/conversation.js";
import { enqueue, getQueueDepth } from "../../seed/ws/requestQueue.js";
import {
  setSessionAbort,
  clearSessionAbort,
  endSession,
  abortSessionsByScope,
  SESSION_TYPES,
} from "../../seed/ws/sessionRegistry.js";
import { resolveTreeAccess } from "../../seed/tree/treeAccess.js";
import { nullSocket } from "../../seed/orchestrators/helpers.js";

const BUSY_MESSAGE =
  "I'm already processing your last 2 messages. Please send again later.";
const MAX_CONCURRENT = 2;

// Per-channel abort controllers: channelId -> Set<AbortController>
// Needed because maxConcurrent=2 means multiple messages share a session,
// but each needs its own abort controller for cancel to work on all.
const channelAborts = new Map();

/**
 * Process an incoming message from a gateway channel.
 *
 * @param {string} channelId
 * @param {object} opts
 * @param {string} opts.senderName - display name of the sender
 * @param {string} opts.senderPlatformId - platform-specific user ID
 * @param {string} opts.messageText - the message content
 * @returns {Promise<object>} { queued, cancelled, reply, result }
 */
export async function processGatewayMessage(
  channelId,
  { senderName, senderPlatformId, messageText },
) {
  // 1. Load and validate channel
  const channel = await GatewayChannel.findById(channelId).lean();
  if (!channel) return { error: "Channel not found" };
  if (!channel.enabled) return { error: "Channel is disabled" };

  const hasInput =
    channel.direction === "input" || channel.direction === "input-output";
  if (!hasInput) return { error: "Channel does not accept input" };

  if (!messageText || typeof messageText !== "string" || !messageText.trim()) {
    return { error: "Empty message" };
  }
  const trimmed = messageText.trim();
  if (trimmed.length > 5000) {
    return { error: "Message too long (max 5000 characters)" };
  }

  // 2. Loop prevention: ignore exact busy message echo
  if (trimmed === BUSY_MESSAGE) {
    return { ignored: true };
  }

  // 3. Cancel/stop command
  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerTrimmed === "cancel" || lowerTrimmed === "stop") {
    // Abort ALL in-flight abort controllers for this channel
    const aborts = channelAborts.get(channelId);
    let abortCount = 0;
    if (aborts) {
      for (const ac of aborts) {
        ac.abort();
        abortCount++;
      }
      aborts.clear();
    }

    // Also abort the session itself
    const scopeKey = "gw:" + channelId;
    abortSessionsByScope(scopeKey);

 log.verbose("Gateway",
      `Gateway: ${lowerTrimmed} command for channel ${channelId}, aborted ${abortCount} in-flight message(s)`,
    );

    // Finalize any open chats that were in-flight
    try {
      const Chat = (await import("../../seed/models/chat.js")).default;
      await Chat.updateMany(
        {
          userId: channel.userId,
          "endMessage.time": null,
          "aiContext.zone": { $in: ["tree", "classifier", "gateway"] },
        },
        {
          $set: {
            "endMessage.content": "Cancelled by user",
            "endMessage.time": new Date(),
            "endMessage.stopped": true,
          },
        },
      );
    } catch (err) {
 log.error("Gateway",
        "Gateway: failed to finalize chats on cancel:",
        err.message,
      );
    }

    return { cancelled: true, reply: "All active tasks cancelled." };
  }

  // 3. Queue depth check
  const queueKey = "gw:" + channelId;
  const depth = getQueueDepth(queueKey);
  if (depth >= MAX_CONCURRENT) {
    if (channel.queueBehavior === "silent") {
      return { queued: false, reply: null };
    }
    return { queued: false, reply: BUSY_MESSAGE };
  }

  // 4. Resolve channel creator's user
  const user = await User.findById(channel.userId).select("_id username").lean();
  if (!user) return { error: "Channel owner not found" };

  // 5. Check tree access
  const access = await resolveTreeAccess(channel.rootId, channel.userId);
  if (!access.isOwner && !access.isContributor) {
    return { error: "Channel owner no longer has tree access" };
  }

  // 6. Check LLM access
  const rootCheck = await Node.findById(channel.rootId)
    .select("rootOwner llmAssignments")
    .lean();
  const hasUserLlm = await userHasLlm(channel.userId);
  const hasRootLlm = !!(rootCheck?.llmDefault && rootCheck.llmDefault !== "none");
  if (!hasUserLlm && !hasRootLlm) {
    return { error: "No LLM connection configured" };
  }

  // 7. Determine orchestrator flags based on channel mode
  const skipRespond = channel.mode === "write";
  const forceQueryOnly = channel.mode === "read";
  const sourceType = "gateway-" + channel.type;

  // 8. Label message with sender identity
  const labeledMessage = senderName ? `${senderName}: "${trimmed}"` : trimmed;

  // 9. Pre-queue abort tracking (must exist before enqueue for cancel to work)
  const abort = new AbortController();
  if (!channelAborts.has(channelId)) channelAborts.set(channelId, new Set());
  channelAborts.get(channelId).add(abort);

  const modeKey = "tree:" +
    (channel.mode === "write"
      ? "place"
      : channel.mode === "read"
        ? "query"
        : "chat");

  // 10. Enqueue with max concurrent 2
  const visitorId = `gateway:${channel.type}:${channelId}:${Date.now()}`;

  const result = await enqueue(
    queueKey,
    async () => {
      // Create runtime for session + MCP + Chat lifecycle
      const rt = new OrchestratorRuntime({
        rootId: channel.rootId,
        userId: channel.userId,
        username: user.username,
        visitorId,
        sessionType: SESSION_TYPES.GATEWAY_INPUT,
        description: `Gateway ${channel.type} input on root ${channel.rootId}`,
        modeKeyForLlm: modeKey,
        source: "gateway",
        llmPriority: LLM_PRIORITY.GATEWAY,
      });

      await rt.init(trimmed.slice(0, 5000));
      setSessionAbort(rt.sessionId, abort);

      let timedOut = false;
      const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for gateway
      const timer = setTimeout(async () => {
        timedOut = true;
        rt.setError("Request timed out", "gateway:timeout");
        await rt.cleanup().catch(() => {});
      }, TIMEOUT_MS);

      try {
        const treeOrch = getOrchestrator("tree");
        if (!treeOrch) throw new Error("No tree orchestrator installed");
        const orchResult = await treeOrch.handle({
          visitorId,
          message: labeledMessage,
          socket: nullSocket,
          username: user.username,
          userId: channel.userId,
          signal: abort.signal,
          sessionId: rt.sessionId,
          rootId: channel.rootId,
          skipRespond,
          forceQueryOnly,
          rootChatId: rt.mainChatId || null,
          sourceType,
        });

        clearTimeout(timer);
        if (timedOut) return { success: false, answer: "Request timed out." };

        const wasAborted = abort.signal.aborted;
        const answer = wasAborted
          ? "Cancelled by user"
          : orchResult?.answer || orchResult?.reason || null;
        rt.setResult(answer, orchResult?.modeKey || "tree:orchestrator");

        return (
          orchResult || {
            success: false,
            answer: "Could not process your message.",
          }
        );
      } catch (err) {
        clearTimeout(timer);
        if (timedOut) return { success: false, answer: "Request timed out." };
 log.error("Gateway", "Gateway: orchestration error:", err.message);

        rt.setError(
          abort.signal.aborted ? "Cancelled by user" : "Error: " + err.message,
          modeKey,
        );

        return { success: false, answer: "Something went wrong." };
      } finally {
        clearTimeout(timer);
        if (!timedOut) {
          await rt.cleanup();
        }
        // Remove this abort controller from the channel tracking
        const abortSet = channelAborts.get(channelId);
        if (abortSet) {
          abortSet.delete(abort);
          if (abortSet.size === 0) channelAborts.delete(channelId);
        }
      }
    },
    { maxConcurrent: MAX_CONCURRENT },
  );

  // 11. Build reply based on mode
  let reply = null;
  const hasOutput = channel.direction === "input-output";

  if (hasOutput && result.success) {
    if (skipRespond) {
      // Place mode: brief confirmation
      reply = result.stepSummaries?.length
        ? "Placed: " + result.stepSummaries.join(", ")
        : "Content placed on tree.";
    } else {
      reply = result.answer || null;
    }
  }

  return { queued: true, result, reply };
}
