// core/gatewayInput.js
// Central processor for incoming gateway messages (Telegram, Discord).
// Mirrors the tree.js API endpoint pattern but with per-channel queue + cancel.

import log from "../../core/log.js";
import { OrchestratorRuntime } from "../../orchestrators/runtime.js";
import GatewayChannel from "./model.js";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import { getOrchestrator } from "../../core/orchestratorRegistry.js";
let orchestrateTreeRequest;
try { ({ orchestrateTreeRequest } = await import("../tree-orchestrator/orchestrator.js")); } catch { orchestrateTreeRequest = async () => { throw new Error("No tree orchestrator installed"); }; }
import {
  userHasLlm,
} from "../../ws/conversation.js";
import { enqueue, getQueueDepth } from "../../ws/requestQueue.js";
import {
  setSessionAbort,
  clearSessionAbort,
  endSession,
  abortSessionsByScope,
  SESSION_TYPES,
} from "../../ws/sessionRegistry.js";
import { resolveTreeAccess } from "../../core/authenticate.js";
import { nullSocket } from "../../orchestrators/helpers.js";

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
  var channel = await GatewayChannel.findById(channelId).lean();
  if (!channel) return { error: "Channel not found" };
  if (!channel.enabled) return { error: "Channel is disabled" };

  var hasInput =
    channel.direction === "input" || channel.direction === "input-output";
  if (!hasInput) return { error: "Channel does not accept input" };

  if (!messageText || typeof messageText !== "string" || !messageText.trim()) {
    return { error: "Empty message" };
  }
  var trimmed = messageText.trim();
  if (trimmed.length > 5000) {
    return { error: "Message too long (max 5000 characters)" };
  }

  // 2. Loop prevention: ignore exact busy message echo
  if (trimmed === BUSY_MESSAGE) {
    return { ignored: true };
  }

  // 3. Cancel/stop command
  var lowerTrimmed = trimmed.toLowerCase();
  if (lowerTrimmed === "cancel" || lowerTrimmed === "stop") {
    // Abort ALL in-flight abort controllers for this channel
    var aborts = channelAborts.get(channelId);
    var abortCount = 0;
    if (aborts) {
      for (var ac of aborts) {
        ac.abort();
        abortCount++;
      }
      aborts.clear();
    }

    // Also abort the session itself
    var scopeKey = "gw:" + channelId;
    abortSessionsByScope(scopeKey);

 log.verbose("Gateway",
      `Gateway: ${lowerTrimmed} command for channel ${channelId}, aborted ${abortCount} in-flight message(s)`,
    );

    // Finalize any open AIChats that were in-flight
    try {
      var AIChat = (await import("../../db/models/aiChat.js")).default;
      await AIChat.updateMany(
        {
          userId: channel.userId,
          "endMessage.time": null,
          "aiContext.path": { $regex: /^tree:|^classifier|^gateway/ },
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
        "Gateway: failed to finalize AIChats on cancel:",
        err.message,
      );
    }

    return { cancelled: true, reply: "All active tasks cancelled." };
  }

  // 3. Queue depth check
  var queueKey = "gw:" + channelId;
  var depth = getQueueDepth(queueKey);
  if (depth >= MAX_CONCURRENT) {
    if (channel.queueBehavior === "silent") {
      return { queued: false, reply: null };
    }
    return { queued: false, reply: BUSY_MESSAGE };
  }

  // 4. Resolve channel creator's user
  var user = await User.findById(channel.userId).select("_id username").lean();
  if (!user) return { error: "Channel owner not found" };

  // 5. Check tree access
  var access = await resolveTreeAccess(channel.rootId, channel.userId);
  if (!access.isOwner && !access.isContributor) {
    return { error: "Channel owner no longer has tree access" };
  }

  // 6. Check LLM access
  var rootCheck = await Node.findById(channel.rootId)
    .select("rootOwner llmAssignments")
    .lean();
  var hasUserLlm = await userHasLlm(channel.userId);
  var hasRootLlm = !!(rootCheck?.llmDefault && rootCheck.llmDefault !== "none");
  if (!hasUserLlm && !hasRootLlm) {
    return { error: "No LLM connection configured" };
  }

  // 7. Determine orchestrator flags based on channel mode
  var skipRespond = channel.mode === "write";
  var forceQueryOnly = channel.mode === "read";
  var sourceType = "gateway-" + channel.type;

  // 8. Label message with sender identity
  var labeledMessage = senderName ? `${senderName}: "${trimmed}"` : trimmed;

  // 9. Pre-queue abort tracking (must exist before enqueue for cancel to work)
  var abort = new AbortController();
  if (!channelAborts.has(channelId)) channelAborts.set(channelId, new Set());
  channelAborts.get(channelId).add(abort);

  var modeKey = "tree:" +
    (channel.mode === "write"
      ? "place"
      : channel.mode === "read"
        ? "query"
        : "chat");

  // 10. Enqueue with max concurrent 2
  var visitorId = `gateway:${channel.type}:${channelId}:${Date.now()}`;

  var result = await enqueue(
    queueKey,
    async () => {
      // Create runtime for session + MCP + AIChat lifecycle
      var rt = new OrchestratorRuntime({
        rootId: channel.rootId,
        userId: channel.userId,
        username: user.username,
        visitorId,
        sessionType: SESSION_TYPES.GATEWAY_INPUT,
        description: `Gateway ${channel.type} input on root ${channel.rootId}`,
        modeKeyForLlm: modeKey,
        source: "gateway",
      });

      await rt.init(trimmed.slice(0, 5000));
      setSessionAbort(rt.sessionId, abort);

      var timedOut = false;
      var TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for gateway
      var timer = setTimeout(async () => {
        timedOut = true;
        rt.setError("Request timed out", "gateway:timeout");
        await rt.cleanup().catch(() => {});
      }, TIMEOUT_MS);

      try {
        var orchResult = await orchestrateTreeRequest({
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

        var wasAborted = abort.signal.aborted;
        var answer = wasAborted
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
        var abortSet = channelAborts.get(channelId);
        if (abortSet) {
          abortSet.delete(abort);
          if (abortSet.size === 0) channelAborts.delete(channelId);
        }
      }
    },
    { maxConcurrent: MAX_CONCURRENT },
  );

  // 11. Build reply based on mode
  var reply = null;
  var hasOutput = channel.direction === "input-output";

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
