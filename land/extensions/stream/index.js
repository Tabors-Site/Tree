/**
 * Stream
 *
 * Mid-flight message injection. The user sends messages while the AI
 * is working. Instead of queueing (wait for finish) or aborting (lose work),
 * the messages accumulate and reach the AI at the next tool loop checkpoint.
 *
 * Three behaviors:
 * - Append: "also add stretching" while building exercises
 * - Correct: "actually 3 days not 4" while building a plan
 * - Cancel: "stop" or "cancel" terminates the tool loop
 *
 * Idle debounce: rapid messages coalesce within a 500ms window.
 * "eggs and coffee" + "also had a banana" become one message, one LLM call.
 *
 * Per-SOCKET state: every piece of transient mid-flight state lives in
 * the register-handler closure so two clients (CLI + browser) sharing
 * the same visitorId don't cross-contaminate each other. The session
 * registry (mode, position, memory) is still shared by visitorId so
 * a conversation continues across connections — only the accumulator /
 * debounce / abort / context snapshot are per-socket.
 */

import log from "../../seed/log.js";
import { createAccumulator } from "./accumulator.js";
import {
  detectActiveSwarm,
  classifyMidflight,
  triggerStop,
  triggerPlanPivot,
} from "./midflightRouter.js";
import { getRootId, getCurrentNodeId } from "../../seed/llm/conversation.js";

const DEBOUNCE_MS = 500;

export async function init(core) {
  core.websocket.registerSocketHandler("register", async ({ socket }) => {
    const visitorId = socket.visitorId;
    if (!visitorId) return;

    // ── Per-socket state ──
    // Each registered socket gets its own accumulator / timer / ctx so
    // concurrent clients (e.g. CLI + dashboard on the same tree) don't
    // share transient mid-flight buffers. Without this, a turn ending
    // on socket A would consume messages that had been pushed on
    // socket B and replay them against socket A's chat handler — which
    // is how we reproduced "browser reply never came back; CLI inherited
    // a stray fragment from browser."
    const accumulator = createAccumulator();
    let debounceTimer = null;
    let _ctxSnapshot = null;       // debounced-path ctx memory
    let _debounceBypass = false;   // skip debounce on the re-entry invocation
    let _followUpBypass = false;   // skip turn-end replay re-entry

    // ── In-flight interception ──
    // Called by the kernel when a message arrives while processing.
    // Accumulates instead of queueing or aborting.
    socket._onStreamMessage = (message, _chatMode, generation) => {
      accumulator.push(message);
      socket.emit("messageQueued", {
        message,
        status: "will be incorporated",
        generation,
      });
      log.debug("Stream", `Accumulated mid-flight for ${visitorId}: "${message.slice(0, 60)}"`);
    };

    // ── Idle debounce ──
    // Called by the kernel when session is idle. Returns true to swallow
    // the message (accumulating, timer running). When the timer fires,
    // drains all accumulated messages and processes them as one.
    socket._onStreamIdle = (message, chatMode, generation, ctx = {}) => {
      // When the debounce timer fires, it re-enters the chat handler.
      // Skip debounce on re-entry so the combined message processes normally.
      if (_debounceBypass) {
        _debounceBypass = false;
        return false; // fall through to normal processing
      }

      accumulator.push(message);

      // Keep the most recent non-empty context. CLI sends it every
      // message; browser may not, so we don't overwrite with nulls.
      if (ctx && (ctx.rootId || ctx.zone || ctx.currentNodeId || ctx.sessionHandle)) {
        _ctxSnapshot = ctx;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const pending = accumulator.checkInterrupt();
        if (!pending || pending.length === 0) return;

        const combined = pending.map((m) => m.content).join("\n");

        // Re-enter the chat handler with the combined message.
        // Set bypass flag so we don't debounce our own combined message.
        if (socket._chatHandler) {
          _debounceBypass = true;
          socket._chatHandler({
            message: combined,
            username: socket.username,
            generation,
            mode: chatMode,
            ...(_ctxSnapshot || {}),
          });
          _ctxSnapshot = null;
        }
      }, DEBOUNCE_MS);

      log.debug("Stream", `Debouncing for ${visitorId} (${DEBOUNCE_MS}ms): "${message.slice(0, 60)}"`);
      return true; // swallow, waiting for debounce window
    };

    // ── Turn end ──
    // Called by the kernel when a chat turn finishes (response, error, or
    // cancel — anything that clears _chatAbort). Two jobs:
    //
    // 1. Cancel any pending idle-debounce timer so a "will fire in 500ms"
    //    replay doesn't race with cleanup.
    //
    // 2. Drain the accumulator. If the finished turn was a toolless coach
    //    reply or any mode that never hit _streamCheckpoint, whatever was
    //    pushed mid-flight is still sitting there unread. Treat it as a
    //    new follow-up turn: re-enter _chatHandler with the combined
    //    text. Without this, "nevermind go to food" sent while the
    //    coach replied would silently disappear.
    socket._onStreamTurnEnd = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }

      const pending = accumulator.checkInterrupt();
      if (!pending || pending.length === 0) return;
      const combined = pending.map((m) => m.content).join("\n").trim();
      if (!combined) return;

      log.info("Stream", `Turn ended with ${pending.length} undelivered mid-flight msg(s) for ${visitorId}; replaying as follow-up turn: "${combined.slice(0, 80)}"`);

      if (!socket._chatHandler) return;
      if (_followUpBypass) { _followUpBypass = false; return; }
      _followUpBypass = true;
      setTimeout(() => {
        try {
          // Context priority: the handler's own per-chat snapshot (set on
          // every chat handler entry) wins because it reflects the most
          // recent payload the client actually sent. Fall back to the
          // idle-debounce snapshot, then empty (browser path relies on
          // socket-level session state).
          const ctx = socket._lastChatCtx || _ctxSnapshot || {};
          socket._chatHandler({
            message: combined,
            username: socket.username,
            generation: Date.now(),
            mode: "chat",
            ...ctx,
          });
        } catch (err) {
          log.warn("Stream", `follow-up turn replay failed: ${err.message}`);
        } finally {
          _followUpBypass = false;
        }
      }, 10);
    };

    // ── Tool loop checkpoint ──
    // Called by the kernel between tool iterations. Reads accumulated
    // messages, classifies them, and either injects them into the
    // current branch's turn (today's default), aborts the loop and
    // archives the plan (stop), or aborts the loop and re-invokes the
    // architect for a plan-level pivot (plan).
    socket._streamCheckpoint = async () => {
      const pending = accumulator.checkInterrupt();
      if (!pending || pending.length === 0) return null;

      const combined = pending.map((m) => m.content).join("\n");

      // Is there a live swarm at the anchor node? If not, skip the
      // classifier entirely — no plan-level route is meaningful.
      const rootId = getRootId(visitorId) || null;
      const currentNodeId = getCurrentNodeId(visitorId) || null;
      const active = await detectActiveSwarm({ rootId, currentNodeId });

      let scope;
      try {
        scope = await classifyMidflight({ message: combined, active });
      } catch (err) {
        log.debug("Stream", `classifier error, defaulting to branch: ${err.message}`);
        scope = "branch";
      }

      if (scope === "stop") {
        log.info("Stream", `Mid-flight stop for ${visitorId}`);
        triggerStop({ active, socket }).catch(() => {});
        return { abort: true };
      }

      if (scope === "plan" && active) {
        log.info("Stream", `Mid-flight plan-pivot for ${visitorId}`);
        triggerPlanPivot({
          active,
          message: combined,
          visitorId,
          socket,
          userId: socket.userId,
          username: socket.username,
          rootId,
        }).catch((err) => log.warn("Stream", `pivot failed: ${err.message}`));
        return { abort: true };
      }

      log.debug("Stream", `Injecting ${pending.length} message(s) for ${visitorId} (scope=${scope})`);
      return {
        inject: `[User update while you were working: "${combined}". ` +
                `Adjust your remaining work accordingly. ` +
                `Do not restart. Continue from where you are.]`,
      };
    };

    // ── Socket close / disconnect: release state ──
    socket.on("disconnect", () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      accumulator.clear();
    });
  });

  log.info("Stream", "Loaded. Messages reach the AI mid-flight.");
  return {};
}
