// TreeOS Tree Orchestrator . beMode.js
//
// "Be" mode handler. The tree leads, the user follows.
//
// Three tiers, tried in order:
//   1. Current node has an extension with handleMessage or a coach mode.
//      Delegate directly; the extension decides what guidance to offer.
//   2. Not at an extension node. Find the closest one via routing index
//      (prefer hint matches). Move to it and delegate.
//   3. No extensions in this tree. Fall back to generic tree:be mode.
//
// Returns the standard orchestrator result shape. Never returns null:
// Tier 3 always runs if the prior tiers don't claim the message.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import {
  switchMode,
  processMessage,
  setCurrentNodeId,
} from "../../seed/llm/conversation.js";
import { formatMemoryContext, pushMemory } from "./state.js";
import { emitStatus, buildSocketBridge } from "./dispatch.js";

export async function runBeMode(message, {
  visitorId, socket, username, userId, rootId,
  signal, slot, sessionId, onToolLoopCheckpoint,
  currentNodeId, modesUsed,
}) {
  // ── Tier 1: Current node has an extension. Delegate. ──
  try {
    const { getLoadedExtensionNames, getExtension } = await import("../loader.js");
    const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
    const nodeDoc = currentNodeId ? await Node.findById(currentNodeId).select("metadata").lean() : null;
    if (nodeDoc) {
      const meta = nodeDoc.metadata instanceof Map ? Object.fromEntries(nodeDoc.metadata) : (nodeDoc.metadata || {});
      for (const extName of getLoadedExtensionNames()) {
        if (meta[extName]?.role || meta[extName]?.initialized) {
          const ext = getExtension(extName);
          if (ext?.exports?.handleMessage) {
            log.verbose("Tree Orchestrator", `  BE mode: delegating to ${extName}.handleMessage`);
            emitStatus(socket, "intent", "");
            const decision = await ext.exports.handleMessage("be", {
              userId, username, rootId, targetNodeId: String(currentNodeId),
            });
            // Resolve coach mode via registry, NOT string concatenation.
            // Extension name and mode prefix don't always match
            // (code-workspace owns tree:code-coach, not tree:code-workspace-coach).
            const extCoachModes = getModesOwnedBy(extName).filter((m) => m.endsWith("-coach"));
            const resolvedMode = decision?.mode || extCoachModes[0] || null;
            if (!resolvedMode) {
              log.warn("Tree Orchestrator", `BE mode: ${extName} has no coach mode registered, skipping`);
              continue;
            }
            modesUsed.push(resolvedMode);

            if (decision?.answer) {
              emitStatus(socket, "done", "");
              pushMemory(visitorId, message, decision.answer);
              return { success: true, answer: decision.answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: String(currentNodeId) };
            }

            await switchMode(visitorId, resolvedMode, {
              username, userId, rootId,
              currentNodeId: String(currentNodeId),
              conversationMemory: formatMemoryContext(visitorId),
              clearHistory: decision?.setup || false,
            });
            const result = await processMessage(visitorId, decision?.message || message, {
              username, userId, rootId, signal, slot, onToolLoopCheckpoint,
              ...buildSocketBridge(socket, signal),
            });
            emitStatus(socket, "done", "");
            const answer = result?.content || result?.answer || null;
            if (answer) pushMemory(visitorId, message, answer);
            return { success: true, answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: String(currentNodeId) };
          }
          const extModes = getModesOwnedBy(extName);
          const coachMode = extModes.find(m => m.endsWith("-coach")) || null;
          if (coachMode) {
            log.verbose("Tree Orchestrator", `  BE mode: switching to ${coachMode}`);
            await switchMode(visitorId, coachMode, {
              username, userId, rootId,
              conversationMemory: formatMemoryContext(visitorId),
              clearHistory: true,
            });
            const result = await processMessage(visitorId, message, { username, userId, rootId, signal, socket, sessionId });
            modesUsed.push(coachMode);
            return { success: true, answer: result?.content || "", modeKey: coachMode, modesUsed, rootId };
          }
          break;
        }
      }
    }
  } catch (err) {
    log.debug("Tree Orchestrator", `BE Tier 1 failed: ${err.message}`);
  }

  // ── Tier 2: Not at an extension node. Find closest via routing index. ──
  if (rootId) {
    try {
      const { getExtension } = await import("../loader.js");
      const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const { queryAllMatches, getIndexForRoot } = await import("./routingIndex.js");
      const index = getIndexForRoot(rootId);
      if (index && index.size > 0) {
        // Use hint match if found, otherwise fall through to first extension
        const hintMatches = queryAllMatches(rootId, message, null);
        const entries = hintMatches.length > 0
          ? hintMatches.map(m => [m.extName, index.get(m.extName)]).filter(([, e]) => e)
          : [...index.entries()];

        for (const [extName, entry] of entries) {
          const ext = getExtension(extName);
          if (!ext?.exports?.handleMessage) continue;
          const extModes = getModesOwnedBy(extName);
          const extCoachModes = extModes.filter((m) => m.endsWith("-coach"));
          if (extCoachModes.length === 0) continue;

          const targetId = entry.nodeId || entry.nodes?.[0]?.nodeId;
          log.verbose("Tree Orchestrator", `  BE mode: routing to closest extension ${extName} at ${targetId}`);
          setCurrentNodeId(visitorId, targetId);
          emitStatus(socket, "intent", "");
          try {
            const decision = await ext.exports.handleMessage("be", {
              userId, username, rootId, targetNodeId: targetId,
            });
            // Use the first registered -coach mode for this extension.
            // Extension name ≠ mode prefix in general (code-workspace
            // owns tree:code-coach), so we look up via the registry.
            const resolvedMode = decision?.mode || extCoachModes[0];
            modesUsed.push(resolvedMode);

            if (decision?.answer) {
              emitStatus(socket, "done", "");
              pushMemory(visitorId, message, decision.answer);
              return { success: true, answer: decision.answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: targetId };
            }

            await switchMode(visitorId, resolvedMode, {
              username, userId, rootId,
              currentNodeId: targetId,
              conversationMemory: formatMemoryContext(visitorId),
              clearHistory: decision?.setup || false,
            });
            const result = await processMessage(visitorId, decision?.message || message, {
              username, userId, rootId, signal, slot, onToolLoopCheckpoint,
              ...buildSocketBridge(socket, signal),
            });
            emitStatus(socket, "done", "");
            const answer = result?.content || result?.answer || null;
            if (answer) pushMemory(visitorId, message, answer);
            return { success: true, answer, modeKey: resolvedMode, modesUsed, rootId, targetNodeId: targetId };
          } catch (err) {
            log.error("Tree Orchestrator", `BE routing failed for ${extName}: ${err.message}`);
          }
        }
      }
    } catch {}
  }

  // ── Tier 3: No extensions found. Generic tree:be. ──
  log.verbose("Tree Orchestrator", `  BE mode: switching to tree:be`);
  await switchMode(visitorId, "tree:be", {
    username, userId, rootId,
    conversationMemory: formatMemoryContext(visitorId),
    clearHistory: true,
  });
  const result = await processMessage(visitorId, message, { username, userId, rootId, signal, socket, sessionId });
  modesUsed.push("tree:be");
  return { success: true, answer: result?.content || "", modeKey: "tree:be", modesUsed, rootId };
}
