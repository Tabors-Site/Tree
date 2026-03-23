// core/gatewayInput.js
// Central processor for incoming gateway messages (Telegram, Discord).
// Mirrors the tree.js API endpoint pattern but with per-channel queue + cancel.

import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

import GatewayChannel from "./model.js";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import { orchestrateTreeRequest } from "../../orchestrators/tree.js";
import {
  setRootId,
  getClientForUser,
  clearSession,
  userHasLlm,
} from "../../ws/conversation.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../../ws/mcp.js";
import {
  startAIChat,
  finalizeAIChat,
  setAiContributionContext,
  clearAiContributionContext,
} from "../../ws/aiChatTracker.js";
import { enqueue, getQueueDepth } from "../../ws/requestQueue.js";
import {
  createSession,
  endSession,
  setSessionAbort,
  clearSessionAbort,
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

    console.log(
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
      console.error(
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
  var hasRootLlm = !!(rootCheck?.llmAssignments?.default && rootCheck.llmAssignments.default !== "none");
  if (!hasUserLlm && !hasRootLlm) {
    return { error: "No LLM connection configured" };
  }

  // 7. Determine orchestrator flags based on channel mode
  var skipRespond = channel.mode === "write";
  var forceQueryOnly = channel.mode === "read";
  var sourceType = "gateway-" + channel.type;

  // 8. Label message with sender identity
  var labeledMessage = senderName ? `${senderName}: "${trimmed}"` : trimmed;

  // 9. Create session + enqueue
  var visitorId = `gateway:${channel.type}:${channelId}:${Date.now()}`;
  var scopeKey = "gw:" + channelId;

  var { sessionId } = createSession({
    userId: channel.userId,
    type: SESSION_TYPES.GATEWAY_INPUT,
    scopeKey,
    description: `Gateway ${channel.type} input on root ${channel.rootId}`,
    meta: { rootId: channel.rootId, channelId, visitorId, senderName },
  });

  var abort = new AbortController();
  setSessionAbort(sessionId, abort);

  // Track this abort controller for the channel (supports concurrent cancellation)
  if (!channelAborts.has(channelId)) channelAborts.set(channelId, new Set());
  channelAborts.get(channelId).add(abort);

  // AIChat tracking
  var aiChat = null;
  try {
    var clientInfo = await getClientForUser(channel.userId);
    aiChat = await startAIChat({
      userId: channel.userId,
      sessionId,
      message: trimmed.slice(0, 5000),
      source: "gateway",
      modeKey:
        "tree:" +
        (channel.mode === "write"
          ? "place"
          : channel.mode === "read"
            ? "query"
            : "chat"),
      llmProvider: {
        isCustom: clientInfo.isCustom,
        model: clientInfo.model,
        connectionId: clientInfo.connectionId || null,
      },
      treeContext: { targetNodeId: channel.rootId },
    });
    if (aiChat) setAiContributionContext(visitorId, sessionId, aiChat._id);
  } catch (err) {
    console.error("Gateway: failed to create AIChat:", err.message);
  }

  // 10. Enqueue with max concurrent 2
  var result = await enqueue(
    queueKey,
    async () => {
      var timedOut = false;
      var TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for gateway
      var timer = setTimeout(() => {
        timedOut = true;
        closeMCPClient(visitorId);
        clearAiContributionContext(visitorId);
        if (aiChat) {
          finalizeAIChat({
            chatId: aiChat._id,
            content: "Error: Request timed out",
            stopped: false,
          }).catch(() => {});
        }
      }, TIMEOUT_MS);

      try {
        var internalJwt = jwt.sign(
          {
            userId: channel.userId.toString(),
            username: user.username,
            visitorId,
          },
          JWT_SECRET,
          { expiresIn: "1h" },
        );
        await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);
        setRootId(visitorId, channel.rootId);

        var orchResult = await orchestrateTreeRequest({
          visitorId,
          message: labeledMessage,
          socket: nullSocket,
          username: user.username,
          userId: channel.userId,
          signal: abort.signal,
          sessionId,
          rootId: channel.rootId,
          skipRespond,
          forceQueryOnly,
          rootChatId: aiChat?._id || null,
          sourceType,
        });

        clearTimeout(timer);
        if (timedOut) return { success: false, answer: "Request timed out." };

        if (aiChat) {
          var wasAborted = abort.signal.aborted;
          var answer = wasAborted
            ? "Cancelled by user"
            : orchResult?.answer || orchResult?.reason || null;
          finalizeAIChat({
            chatId: aiChat._id,
            content: answer,
            stopped: wasAborted,
            modeKey: orchResult?.modeKey || "tree:orchestrator",
          }).catch((err) =>
            console.error("Gateway: AIChat finalize failed:", err.message),
          );
        }

        return (
          orchResult || {
            success: false,
            answer: "Could not process your message.",
          }
        );
      } catch (err) {
        clearTimeout(timer);
        if (timedOut) return { success: false, answer: "Request timed out." };
        console.error("Gateway: orchestration error:", err.message);

        if (aiChat) {
          finalizeAIChat({
            chatId: aiChat._id,
            content: abort.signal.aborted
              ? "Cancelled by user"
              : "Error: " + err.message,
            stopped: abort.signal.aborted,
          }).catch(() => {});
        }

        return { success: false, answer: "Something went wrong." };
      } finally {
        clearTimeout(timer);
        clearAiContributionContext(visitorId);
        clearSessionAbort(sessionId);
        endSession(sessionId);
        if (!timedOut) closeMCPClient(visitorId);
        clearSession(visitorId);
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
