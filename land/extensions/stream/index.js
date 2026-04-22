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
 */

import log from "../../seed/log.js";
import { pushMessage, checkInterrupt } from "./accumulator.js";
import {
  detectActiveSwarm,
  classifyMidflight,
  triggerStop,
  triggerPlanPivot,
} from "./midflightRouter.js";
import { getRootId, getCurrentNodeId } from "../../seed/llm/conversation.js";

const DEBOUNCE_MS = 500;

export async function init(core) {
  const debounceTimers = new Map(); // visitorId -> timer

  core.websocket.registerSocketHandler("register", async ({ socket }) => {
    const visitorId = socket.visitorId;
    if (!visitorId) return;

    // ── In-flight interception ──
    // Called by the kernel when a message arrives while processing.
    // Accumulates instead of queueing or aborting.
    socket._onStreamMessage = (message, _chatMode, generation) => {
      pushMessage(visitorId, message);
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
    let _debounceBypass = false; // prevent re-entry on debounce fire

    // Snapshot of the first message's payload context (rootId /
    // currentNodeId / zone / sessionHandle) so the debounced replay
    // below can re-supply them. Without this, the replay fires with
    // bare args and the server-side `_pvId` derivation collapses back
    // to the default socket visitor, dropping tree mode.
    let _ctxSnapshot = null;

    socket._onStreamIdle = (message, chatMode, generation, ctx = {}) => {
      // When the debounce timer fires, it re-enters the chat handler.
      // Skip debounce on re-entry so the combined message processes normally.
      if (_debounceBypass) {
        _debounceBypass = false;
        return false; // fall through to normal processing
      }

      pushMessage(visitorId, message);

      // Keep the most recent non-empty context. CLI sends it every
      // message; browser may not, so we don't overwrite with nulls.
      if (ctx && (ctx.rootId || ctx.zone || ctx.currentNodeId || ctx.sessionHandle)) {
        _ctxSnapshot = ctx;
      }

      const existing = debounceTimers.get(visitorId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        debounceTimers.delete(visitorId);
        const pending = checkInterrupt(visitorId);
        if (!pending || pending.length === 0) return;

        const combined = pending.map(m => m.content).join("\n");

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

      debounceTimers.set(visitorId, timer);
      log.debug("Stream", `Debouncing for ${visitorId} (${DEBOUNCE_MS}ms): "${message.slice(0, 60)}"`);
      return true; // swallow, waiting for debounce window
    };

    // ── Tool loop checkpoint ──
    // Called by the kernel between tool iterations. Reads accumulated
    // messages, classifies them, and either injects them into the
    // current branch's turn (today's default), aborts the loop and
    // archives the plan (stop), or aborts the loop and re-invokes the
    // architect for a plan-level pivot (plan).
    socket._streamCheckpoint = async () => {
      const pending = checkInterrupt(visitorId);
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
        // Fire-and-forget: bookkeeping continues while the loop
        // aborts. Kernel handles the break via { abort: true }.
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

      // Default: absorb into the currently running step. Matches the
      // pre-classifier behavior — correction / tweak for the current
      // branch. The classifier only escalates when it has grounds.
      log.debug("Stream", `Injecting ${pending.length} message(s) for ${visitorId} (scope=${scope})`);
      return {
        inject: `[User update while you were working: "${combined}". ` +
                `Adjust your remaining work accordingly. ` +
                `Do not restart. Continue from where you are.]`,
      };
    };
  });

  log.info("Stream", "Loaded. Messages reach the AI mid-flight.");
  return {};
}
