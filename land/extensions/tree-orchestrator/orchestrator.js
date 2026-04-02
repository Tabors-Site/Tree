// orchestrators/tree.js
// Position determines reality.
// Extension at this position? Route to its mode.
// No extension? tree:converse. The AI reads what's here and talks.

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
  getClientForUser,
  resolveRootLlmForMode,
} from "../../seed/llm/conversation.js";
import { classify } from "./translator.js";
import { getLandConfigValue } from "../../seed/landConfig.js";

/**
 * Local intent classification. Zero LLM calls.
 *
 * Two jobs:
 * 1. Extension routing: if a mode override is set at the current node AND
 *    the message matches that extension's classifierHints, route directly
 *    to the extension mode. One LLM call. No librarian.
 * 2. Intent classification: greetings/questions → query, destructive → destructive,
 *    action commands → place, everything else → place (librarian decides).
 */
async function localClassify(message, currentNodeId, rootId) {
  const lower = message.toLowerCase().trim();
  const base = { summary: message.slice(0, 100), responseHint: "" };

  // ── Routing index (fast path) ──
  // One Map scan. No DB queries. Catches deep extensions that Level 1-3 miss.
  if (rootId && currentNodeId) {
    try {
      const { queryIndex } = await import("./routingIndex.js");
      const currentPath = await _buildCurrentPath(currentNodeId);
      const match = queryIndex(rootId, message, currentPath);
      if (match) {
        return { intent: "extension", mode: match.mode, targetNodeId: match.targetNodeId, confidence: match.confidence, ...base };
      }
    } catch {}
  }

  // ── Extension routing (Path 2, fallback) ──
  // Level-by-level DB walk. Kept as backup for unindexed trees.
  if (currentNodeId) {
    try {
      const { getClassifierHintsForMode } = await import("../loader.js");
      const currentNode = await Node.findById(currentNodeId).select("metadata children").lean();

      // Level 1: current node has a mode override.
      // If hints match, route with high confidence. If not, still route to the
      // extension but the mode must handle generic messages (status, review, etc).
      const modes = currentNode?.metadata instanceof Map
        ? currentNode.metadata.get("modes")
        : currentNode?.metadata?.modes;
      if (modes?.respond) {
        const hints = getClassifierHintsForMode(modes.respond);
        if (!hints || hints.some(re => re.test(message))) {
          return { intent: "extension", mode: modes.respond, confidence: 0.95, ...base };
        }
        // No hint match but we're at an extension node. Still route here
        // because the librarian doesn't understand extension data models.
        return { intent: "extension", mode: modes.respond, confidence: 0.8, ...base };
      }

      // Level 2: direct children (do any of my children claim this message?)
      if (currentNode?.children?.length > 0) {
        const children = await Node.find({ _id: { $in: currentNode.children } })
          .select("_id name metadata").lean();
        for (const child of children) {
          const childModes = child.metadata instanceof Map
            ? child.metadata.get("modes")
            : child.metadata?.modes;
          if (!childModes?.respond) continue;
          const hints = getClassifierHintsForMode(childModes.respond);
          if (hints?.some(re => re.test(message))) {
            return {
              intent: "extension",
              mode: childModes.respond,
              targetNodeId: String(child._id),
              confidence: 0.85,
              ...base,
            };
          }
        }
      }

      // Level 3: siblings (does a sibling of the current node claim this message?)
      if (currentNode?.parent) {
        const parentNode = await Node.findById(currentNode.parent).select("children").lean();
        if (parentNode?.children?.length > 1) {
          const siblingIds = parentNode.children
            .map(id => String(id))
            .filter(id => id !== String(currentNodeId));
          if (siblingIds.length > 0) {
            const siblings = await Node.find({ _id: { $in: siblingIds } })
              .select("_id name metadata").lean();
            for (const sib of siblings) {
              const sibModes = sib.metadata instanceof Map
                ? sib.metadata.get("modes")
                : sib.metadata?.modes;
              if (!sibModes?.respond) continue;
              const hints = getClassifierHintsForMode(sibModes.respond);
              if (hints?.some(re => re.test(message))) {
                return {
                  intent: "extension",
                  mode: sibModes.respond,
                  targetNodeId: String(sib._id),
                  confidence: 0.8,
                  ...base,
                };
              }
            }
          }
        }
      }
    } catch {}
  }

  // ── No extension claimed this message ──
  // Position determines reality. The AI at this position has all the tools
  // it needs (read, write, navigate, delete). Let it decide what to do.
  // No regex. No guessing. Just converse.
  return { intent: "converse", confidence: 0.8, ...base };
}

/**
 * Extract the behavioral constraint from the source type.
 * Four commands constrain what happens at any position.
 *
 *   query  →  tools: read-only    response: full       writes: blocked
 *   place  →  tools: all          response: minimal    writes: allowed
 *   chat   →  tools: all          response: full       writes: allowed
 *   be     →  tools: all          response: guided     writes: allowed
 */
function extractBehavioral(sourceType) {
  if (sourceType === "query" || sourceType.endsWith("-query")) return "query";
  if (sourceType === "place" || sourceType.endsWith("-place")) return "place";
  if (sourceType === "be" || sourceType.endsWith("-be")) return "be";
  return "chat"; // default
}
import { setChatContext } from "../../seed/llm/chatTracker.js";
import { isActiveNavigator } from "../../seed/ws/sessionRegistry.js";

import {
  getContextForAi,
  getNavigationContext,
  buildDeepTreeSummary,
} from "../../seed/tree/treeFetch.js";
import mongoose from "mongoose";
import Node from "../../seed/models/node.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import { resolveMode } from "../../seed/modes/registry.js";

// ─────────────────────────────────────────────────────────────────────────
// PATH RESOLUTION (for routing index scope check)
// ─────────────────────────────────────────────────────────────────────────

const _pathCache = new Map(); // nodeId -> { path, ts }
const PATH_TTL = 30000;

async function _buildCurrentPath(nodeId) {
  const cached = _pathCache.get(String(nodeId));
  if (cached && Date.now() - cached.ts < PATH_TTL) return cached.path;

  const parts = [];
  let current = await Node.findById(nodeId).select("name parent rootOwner").lean();
  let depth = 0;
  while (current && depth < 20) {
    parts.unshift(current.name || String(current._id));
    if (current.rootOwner || !current.parent) break;
    current = await Node.findById(current.parent).select("name parent rootOwner").lean();
    depth++;
  }
  const path = "/" + parts.join("/");

  _pathCache.set(String(nodeId), { path, ts: Date.now() });
  // Cap cache
  if (_pathCache.size > 500) {
    const oldest = [..._pathCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) _pathCache.delete(oldest[i][0]);
  }
  return path;
}

// ─────────────────────────────────────────────────────────────────────────
// INTELLIGENCE BRIEF (cached per tree, 60s TTL)
// Collects signals from installed extensions so the librarian sees the
// tree's living state, not just its skeleton.
// ─────────────────────────────────────────────────────────────────────────

const briefCache = new Map(); // rootId -> { brief, timestamp }
const BRIEF_TTL = 60000;
const BRIEF_CACHE_MAX = 100;

async function getIntelligenceBrief(rootId, userId) {
  const cached = briefCache.get(rootId);
  if (cached && Date.now() - cached.timestamp < BRIEF_TTL) return cached.brief;

  const brief = await buildIntelligenceBrief(rootId, userId);

  // Evict oldest if at capacity
  if (briefCache.size >= BRIEF_CACHE_MAX && !briefCache.has(rootId)) {
    const oldest = briefCache.keys().next().value;
    briefCache.delete(oldest);
  }
  briefCache.set(rootId, { brief, timestamp: Date.now() });
  return brief;
}

async function buildIntelligenceBrief(rootId, userId) {
  let getExtension;
  try {
    ({ getExtension } = await import("../loader.js"));
  } catch { return null; }

  const sections = [];

  // Competence: what the tree knows and doesn't know
  try {
    const comp = getExtension("competence");
    if (comp?.exports?.getCompetence) {
      const data = await comp.exports.getCompetence(rootId);
      if (data?.totalQueries >= 10) {
        const strong = (data.strongTopics || []).slice(0, 5).join(", ");
        const weak = (data.weakTopics || []).slice(0, 5).join(", ");
        if (strong || weak) {
          sections.push(`Competence: answers well on [${strong || "unknown"}]. Weak on [${weak || "unknown"}]. Answer rate: ${Math.round((data.answerRate || 0) * 100)}%.`);
        }
      }
    }
  } catch {}

  // Explore: last exploration map at root
  try {
    const exp = getExtension("explore");
    if (exp?.exports?.getExploreMap) {
      const map = await exp.exports.getExploreMap(rootId);
      if (map && map.confidence > 0) {
        const findings = (map.map || []).slice(0, 3).map(f => f.nodeName || f.nodeId).join(", ");
        const gaps = (map.gaps || []).slice(0, 2).join("; ");
        sections.push(`Explored: ${map.coverage} coverage, ${map.nodesExplored} nodes checked. Key areas: ${findings || "none"}.${gaps ? " Gaps: " + gaps : ""}`);
      }
    }
  } catch {}

  // Contradiction: unresolved conflicts
  try {
    const con = getExtension("contradiction");
    if (con?.exports?.getUnresolved) {
      const unresolved = await con.exports.getUnresolved(rootId);
      if (Array.isArray(unresolved) && unresolved.length > 0) {
        const top = unresolved.slice(0, 2).map(c => `"${c.claim}" vs "${c.conflictsWith}"`).join("; ");
        sections.push(`Contradictions: ${unresolved.length} unresolved. ${top}`);
      }
    }
  } catch {}

  // Purpose: thesis and coherence
  try {
    const pur = getExtension("purpose");
    if (pur) {
      const root = await Node.findById(rootId).select("metadata").lean();
      const meta = root?.metadata instanceof Map ? root.metadata.get("purpose") : root?.metadata?.purpose;
      if (meta?.thesis) {
        const coherence = meta.recentCoherence != null ? ` Coherence: ${Math.round(meta.recentCoherence * 100)}%.` : "";
        sections.push(`Purpose: "${meta.thesis}"${coherence}`);
      }
    }
  } catch {}

  // Evolution: dormant branches
  try {
    const evo = getExtension("evolution");
    if (evo?.exports?.getDormant) {
      const dormant = await evo.exports.getDormant(rootId);
      if (Array.isArray(dormant) && dormant.length > 0) {
        const names = dormant.slice(0, 3).map(d => d.name || d.nodeName).join(", ");
        sections.push(`Dormant: ${dormant.length} branch${dormant.length > 1 ? "es" : ""}. ${names}.`);
      }
    }
  } catch {}

  // Remember: recent departures
  try {
    const rem = getExtension("remember");
    if (rem) {
      const root = await Node.findById(rootId).select("metadata").lean();
      const meta = root?.metadata instanceof Map ? root.metadata.get("remember") : root?.metadata?.remember;
      if (meta?.departed?.length > 0) {
        const recent = meta.departed.slice(-3).map(d => `${d.name} (${d.note})`).join("; ");
        sections.push(`Departed: ${recent}`);
      }
    }
  } catch {}

  if (sections.length === 0) return null;
  return "Intelligence:\n" + sections.map(s => "  " + s).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// MODE RESOLUTION HELPER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve mode key for an intent at a node. Checks per-node overrides.
 * Falls back to default tree:{intent} mode.
 */
async function resolveModeForNode(intent, nodeId) {
  if (!nodeId) return `tree:${intent}`;
  try {
    const node = await Node.findById(nodeId).select("metadata").lean();
    return resolveMode(intent, "tree", node?.metadata);
  } catch {
    return `tree:${intent}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PENDING OPERATIONS (confirmation flow)
// ─────────────────────────────────────────────────────────────────────────
// CONVERSATION MEMORY (survives mode switches)
// ─────────────────────────────────────────────────────────────────────────

// visitorId → [{ role: "user"|"assistant", content }]
const orchestratorMemory = new Map();
const MAX_MEMORY_TURNS = 10; // 5 exchanges (user + assistant each)

function getMemory(visitorId) {
  return orchestratorMemory.get(visitorId) || [];
}

function pushMemory(visitorId, userMessage, assistantResponse) {
  const mem = getMemory(visitorId);
  mem.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse },
  );
  // Keep only the last N turns
  while (mem.length > MAX_MEMORY_TURNS) mem.shift();
  orchestratorMemory.set(visitorId, mem);
}

function clearMemory(visitorId) {
  orchestratorMemory.delete(visitorId);
}

export { clearMemory };

/**
 * Format memory as context string for injection into mode messages.
 */
function formatMemoryContext(visitorId) {
  const mem = getMemory(visitorId);
  if (mem.length === 0) return "";
  const lines = mem.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
  );
  return `\n\nRecent conversation:\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a status event to the frontend.
 */
function emitStatus(socket, phase, text) {
  socket.emit("executionStatus", { phase, text });
}

/**
 * Emit an internal mode result to the chat so the user can see what's happening.
 */
function emitModeResult(socket, modeKey, result) {
  // Strip internal tracking fields before sending to client
  let sanitized = result;
  if (result && typeof result === "object") {
    const { _llmProvider, _raw, ...rest } = result;
    sanitized = rest;
  }
  socket.emit("orchestratorStep", {
    modeKey,
    result:
      typeof sanitized === "string"
        ? sanitized
        : JSON.stringify(sanitized, null, 2),
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SHARED: RESOLVE LLM PROVIDER
// ─────────────────────────────────────────────────────────────────────────

async function resolveLlmProvider(userId, rootId, modeKey, slot) {
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, modeKey);
    const clientInfo = await getClientForUser(userId, slot, modeConnectionId);
    return {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    return { isCustom: false, model: null, connectionId: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATE TREE REQUEST
// ─────────────────────────────────────────────────────────────────────────

// NOTE: respondToCompletion, executePlanSteps, runQueryFlow, runLibrarianFlow,
// executePendingOperation, scoutExistingStructure, fetchMoveCounterparts
// were removed. The orchestrator now routes to tree:converse for all
// non-extension messages. The AI has all tools at its position.

export async function orchestrateTreeRequest({
  visitorId,
  message,
  socket,
  username,
  userId,
  signal,
  sessionId,
  rootId: rootIdParam,
  skipRespond = false,
  forceQueryOnly = false,
  slot,
  rootChatId = null,
  sourceType = null,
  sourceId = null,
  onToolLoopCheckpoint = null,
}) {
  if (signal?.aborted) return null;

  const rootId = rootIdParam ?? getRootId(visitorId);

  // Create an attached runtime (reuses the websocket's session, MCP, Chat)
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username,
    visitorId,
    sessionType: "tree-chat",
    description: message,
    modeKeyForLlm: "tree:librarian",
    slot,
  });

  const llmProvider = await resolveLlmProvider(userId, rootId, "tree:librarian", slot);

  // Attach to the existing websocket session
  rt.attach({ sessionId, mainChatId: rootChatId, llmProvider, signal, chainIndex: 1 });

  // Ensure AI contribution context is set so MCP tool calls get chatId/sessionId
  if (rootChatId) {
    setChatContext(visitorId, sessionId, rootChatId);
  }

  const meta = { username, userId, rootId, slot, llmProvider };
  const modesUsed = []; // Track full chain for Chat

  // ────────────────────────────────────────────────────────
  // QUERY FAST PATH — converse in read-only mode
  // ────────────────────────────────────────────────────────

  if (forceQueryOnly) {
    modesUsed.push("tree:converse");
    emitStatus(socket, "intent", "");

    await switchMode(visitorId, "tree:converse", {
      username, userId, rootId,
      conversationMemory: formatMemoryContext(visitorId),
      clearHistory: true,
    });

    const result = await processMessage(visitorId, message, {
      username, userId, rootId, signal, slot,
      readOnly: true,
      onToolLoopCheckpoint,
      onToolResults(results) {
        if (signal?.aborted) return;
        for (const r of results) socket.emit(WS.TOOL_RESULT, r);
      },
    });

    emitStatus(socket, "done", "");
    const answer = result?.content || result?.answer || null;
    if (answer) pushMemory(visitorId, message, answer);
    return { success: true, answer, modeKey: "tree:converse", modesUsed, rootId };
  }

  // ────────────────────────────────────────────────────────
  // STEP 1: CLASSIFY (lightweight intent detection)
  // ────────────────────────────────────────────────────────

  emitStatus(socket, "intent", "Understanding request…");

  // Pre-fetch full tree shape so classifier and librarian can see what exists
  let treeSummary = null;
  if (rootId) {
    try {
      let encodingMap = null;
      try {
        const { getExtension } = await import("../loader.js");
        const uExt = getExtension("understanding");
        if (uExt?.exports?.getEncodingMap) encodingMap = await uExt.exports.getEncodingMap(rootId);
      } catch {}
      treeSummary = await buildDeepTreeSummary(rootId, { encodingMap });

      // Append live intelligence signals from installed extensions
      const brief = await getIntelligenceBrief(rootId, userId);
      if (brief) treeSummary += "\n\n" + brief;

      log.verbose("Tree Orchestrator", " treeSummary for librarian:\n", treeSummary);
    } catch (err) {
      log.error("Tree Orchestrator", " Pre-fetch tree summary failed:", err.message);
    }
  }

  let classification;
  const classifyStart = new Date();
  const classificationMode = getLandConfigValue("classificationMode") || "local";

  if (classificationMode === "llm") {
    // Opt-in LLM classification (old behavior)
    try {
      classification = await classify({
        message,
        userId,
        conversationMemory: formatMemoryContext(visitorId),
        treeSummary,
        signal,
        slot,
        rootId,
      });
    } catch (err) {
      if (signal?.aborted) return null;
      if (err.message === "NO_LLM") {
        throw new Error(
          "No LLM connection configured. Set one up at /setup or assign one to this tree.",
        );
      }
      log.error("Tree Orchestrator", " Classification failed:", err.message);
      classification = await localClassify(message, getCurrentNodeId(visitorId) || rootId, rootId);
    }
  } else {
    // Default: local classification. Zero LLM calls.
    classification = await localClassify(message, getCurrentNodeId(visitorId) || rootId);
  }
  const classifyEnd = new Date();

  if (signal?.aborted) return null;

  const confidence = classification.confidence ?? 0.5;

 log.verbose("Tree Orchestrator", 
    `🎯 Classified: ${classification.intent} | confidence: ${confidence} | "${classification.summary}"`,
  );
  emitModeResult(socket, "intent", {
    intent: classification.intent,
    responseHint: classification.responseHint,
    summary: classification.summary,
    confidence,
  });

  // Track classification step (after override so logs reflect actual intent used)
  modesUsed.push("classifier");
  rt.trackStep("classifier", {
    input: message,
    output: (({ llmProvider: _, ...rest }) => rest)(classification),
    startTime: classifyStart,
    endTime: classifyEnd,
    llmProvider: classification.llmProvider || llmProvider,
  });

  // ────────────────────────────────────────────────────────
  // NO_FIT CHECK — tree rejects this idea
  // ────────────────────────────────────────────────────────

  if (classification.intent === "no_fit") {
    let reason = classification.summary || "Idea does not fit this tree.";

    // Suggest go if the message might match an extension in another tree
    try {
      const { getExtension } = await import("../loader.js");
      const goExt = getExtension("go");
      if (goExt?.exports?.findDestination) {
        const goResult = await goExt.exports.findDestination(message, userId);
        if (goResult?.found && !goResult.ambiguous && goResult.destination) {
          reason += ` Try: go ${goResult.destination.name || goResult.destination.path}`;
        }
      }
    } catch {}

    log.verbose("Tree Orchestrator", ` No fit: ${reason}`);

    emitStatus(socket, "done", "");

    return {
      success: false,
      noFit: true,
      confidence,
      reason,
      summary: classification.summary,
      modeKey: "classifier",
      rootId,
      modesUsed,
    };
  }

  // ────────────────────────────────────────────────────────
  // SHORT-MEMORY CHECK — explicit defer or vague placements
  // ────────────────────────────────────────────────────────

  // Only explicit "defer" intent triggers deferral (user said "hold this"/"park this").
  // Normal "place" intents always flow to the librarian.
  let deferDecision = { defer: false };
  if (classification.intent === "defer") {
    deferDecision = { defer: true, reason: "User explicitly requested deferral" };
    classification.intent = "place"; // treat as place for the defer path
  }
  if (deferDecision.defer) {
 log.verbose("Tree Orchestrator", ` Deferred to short memory: ${deferDecision.reason}`);

    const ShortMemory = mongoose.models.ShortMemory;
    if (!ShortMemory) throw new Error("Dreams extension required for short memory deferral");
    const memoryItem = await ShortMemory.create({
      rootId,
      userId,
      content: message,
      deferReason: deferDecision.reason,
      classificationAxes: classification.placementAxes,
      sourceType: sourceType || "tree-chat",
      sourceId: sourceId || null,
      sessionId,
    });

    rt.trackStep("short-memory:defer", {
      input: message,
      output: {
        deferReason: deferDecision.reason,
        memoryItemId: memoryItem._id,
      },
      llmProvider,
    });

    if (!skipRespond) {
      const response = await runRespond({
        visitorId,
        socket,
        signal,
        username,
        userId,
        rootId,
        originalMessage: message,
        responseHint:
          classification.responseHint ||
          "Acknowledge the idea naturally. Do not mention deferral, memory, or holding.",
        stepSummaries: [],
        slot,
      });

      return {
        ...response,
        success: true,
        deferred: true,
        memoryItemId: memoryItem._id,
        modeKey: "short-memory:defer",
        modesUsed: [...modesUsed, "short-memory"],
      };
    }

    return {
      success: true,
      deferred: true,
      memoryItemId: memoryItem._id,
      modeKey: "short-memory:defer",
      modesUsed,
      rootId,
    };
  }

  // ────────────────────────────────────────────────────────
  // BEHAVIORAL CONSTRAINT (chat/place/query)
  // ────────────────────────────────────────────────────────

  const behavioral = extractBehavioral(sourceType);

  // ────────────────────────────────────────────────────────
  // BE: GUIDED MODE — the tree leads, the user follows
  // Skip classification. Find the guided mode at this position.
  // ────────────────────────────────────────────────────────

  if (behavioral === "be") {
    const currentNodeId = getCurrentNodeId(visitorId) || rootId;

    // If the extension at this position exports handleMessage, delegate.
    // The extension knows how to handle "be" (food logs food, study teaches, etc).
    try {
      const { getExtensionManifest, getLoadedExtensionNames, getExtension } = await import("../loader.js");
      const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const nodeDoc = currentNodeId ? await Node.findById(currentNodeId).select("metadata").lean() : null;
      if (nodeDoc) {
        const meta = nodeDoc.metadata instanceof Map ? Object.fromEntries(nodeDoc.metadata) : (nodeDoc.metadata || {});
        for (const extName of getLoadedExtensionNames()) {
          if (meta[extName]?.role || meta[extName]?.initialized) {
            const ext = getExtension(extName);

            // Tier 1: handleMessage override
            if (ext?.exports?.handleMessage) {
              log.verbose("Tree Orchestrator", `  BE mode: delegating to ${extName}.handleMessage`);
              emitStatus(socket, "intent", "");
              try {
                const result = await ext.exports.handleMessage(message, {
                  userId, username, rootId, signal, res: null,
                });
                emitStatus(socket, "done", "");
                const answer = result?.answer || null;
                const mode = result?.mode || `tree:${extName}-coach`;
                if (answer) pushMemory(visitorId, message, answer);
                modesUsed.push(mode);
                return { success: true, answer, modeKey: mode, modesUsed, rootId };
              } catch (err) {
                log.error("Tree Orchestrator", `BE handleMessage failed: ${err.message}`);
              }
            }

            // Tier 2: manifest guidedMode or :coach suffix
            const manifest = getExtensionManifest(extName);
            let guidedMode = manifest?.provides?.guidedMode || null;
            if (!guidedMode) {
              const extModes = getModesOwnedBy(extName);
              guidedMode = extModes.find(m => m.endsWith("-coach")) || null;
            }
            if (guidedMode) {
              log.verbose("Tree Orchestrator", `  BE mode: switching to ${guidedMode}`);
              await switchMode(visitorId, guidedMode, {
                username, userId, rootId,
                conversationMemory: formatMemoryContext(visitorId),
                clearHistory: true,
              });
              const result = await processMessage(visitorId, message, {
                username, userId, rootId, signal, socket, sessionId,
              });
              modesUsed.push(guidedMode);
              return { success: true, answer: result?.content || "", modeKey: guidedMode, modesUsed, rootId };
            }
            break;
          }
        }
      }
    } catch {}

    // Tier 3: generic tree:be fallback
    log.verbose("Tree Orchestrator", `  BE mode: switching to tree:be`);
    await switchMode(visitorId, "tree:be", {
      username, userId, rootId,
      conversationMemory: formatMemoryContext(visitorId),
      clearHistory: true,
    });
    const result = await processMessage(visitorId, message, {
      username, userId, rootId, signal, socket, sessionId,
    });
    modesUsed.push("tree:be");
    return { success: true, answer: result?.content || "", modeKey: "tree:be", modesUsed, rootId };
  }

  // ────────────────────────────────────────────────────────
  // PATH 2: EXTENSION DETECTED — hand off to the extension
  //
  // Three tiers:
  // 1. handleMessage override: extension exports a full handler. It decides everything.
  // 2. Suffix convention: orchestrator resolves mode by naming convention.
  //    :coach (be), :review (questions), :plan (building), :log (default).
  // 3. modes.respond fallback: whatever the node declared.
  // ────────────────────────────────────────────────────────

  if (classification.intent === "extension" && classification.mode) {
    const { getModeOwner, getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
    const { getExtension, getExtensionManifest } = await import("../loader.js");

    // ── Check for multi-extension chain before single routing ──
    // If the message also matches other extensions, chain them instead.
    try {
      const currentNodeId = getCurrentNodeId(visitorId) || rootId;
      const primaryExt = getModeOwner(classification.mode);
      const otherMatches = [];

      // Find earliest match position in the message for the primary extension
      let primaryPos = 0;
      const primaryManifest = getExtensionManifest(primaryExt);
      if (Array.isArray(primaryManifest?.classifierHints)) {
        for (const re of primaryManifest.classifierHints) {
          const m = re.exec(message);
          if (m) { primaryPos = m.index; break; }
        }
      }

      // Two sources of chain candidates, both position-based:
      // 1. Routing index: extensions with scaffolded nodes in this tree
      // 2. Confined extensions ext-allowed at this position (e.g. browser-bridge)
      const { queryAllMatches } = await import("./routingIndex.js");
      const allTreeMatches = queryAllMatches(rootId, message, null);
      const seenExts = new Set([primaryExt]);

      for (const match of allTreeMatches) {
        if (seenExts.has(match.extName)) continue;
        seenExts.add(match.extName);

        const manifest = getExtensionManifest(match.extName);
        let matchPos = -1;
        if (Array.isArray(manifest?.classifierHints)) {
          for (const re of manifest.classifierHints) {
            const m = re.exec(message);
            if (m) { matchPos = matchPos === -1 ? m.index : Math.min(matchPos, m.index); }
          }
        }
        if (matchPos === -1) matchPos = message.length;
        otherMatches.push({ mode: match.mode, targetNodeId: match.targetNodeId, extName: match.extName, pos: matchPos });
      }

      log.verbose("Tree Orchestrator", `  Chain: ${otherMatches.length} other matches: ${otherMatches.map(m => m.extName).join(", ") || "none"}`);

      if (otherMatches.length > 0) {
        // Build chain ordered by position in the user's message
        const allSteps = [
          { mode: classification.mode, targetNodeId: classification.targetNodeId || currentNodeId, extName: primaryExt, pos: primaryPos },
          ...otherMatches,
        ];
        const chain = allSteps.sort((a, b) => a.pos - b.pos);
        log.verbose("Tree Orchestrator", `  Chain detected: ${chain.map(m => m.extName).join(" -> ")}`);
        emitStatus(socket, "intent", "Chaining extensions...");

        let context = message;
        const chainModes = [];

        for (let i = 0; i < chain.length; i++) {
          const step = chain[i];
          const isLast = i === chain.length - 1;

          // Navigate to the extension's node for this step
          const stepNodeId = step.targetNodeId || getCurrentNodeId(visitorId) || rootId;
          await switchMode(visitorId, step.mode, {
            username, userId, rootId,
            currentNodeId: stepNodeId,
            conversationMemory: context,
            clearHistory: true,
          });

          const stepResult = await processMessage(visitorId, isLast ? context : `${context}\n\nDo this step and return what you produced.`, {
            username, userId, rootId, signal, slot,
            onToolLoopCheckpoint,
            onToolResults(results) {
              if (signal?.aborted) return;
              for (const r of results) socket.emit(WS.TOOL_RESULT, r);
            },
          });

          if (signal?.aborted) return null;

          const stepAnswer = stepResult?.content || stepResult?.answer || "";
          chainModes.push(step.mode);

          if (!isLast) {
            context = `Original request: ${message}\n\nPrevious step (${step.extName}) result:\n${stepAnswer}`;
          } else {
            context = stepAnswer;
          }
        }

        emitStatus(socket, "done", "");
        if (context) pushMemory(visitorId, message, context);
        return { success: true, answer: context, modeKey: chainModes[chainModes.length - 1], modesUsed: [...modesUsed, ...chainModes], rootId };
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Chain check failed: ${err.message}`);
    }
    const extName = getModeOwner(classification.mode);
    const ext = extName ? getExtension(extName) : null;

    log.verbose("Tree Orchestrator",
      `  Extension route: ${classification.mode} (ext: ${extName || "?"}, behavioral: ${behavioral})`);

    // ── Tier 1: handleMessage override ──
    if (ext?.exports?.handleMessage) {
      emitStatus(socket, "intent", "");
      try {
        const result = await ext.exports.handleMessage(message, {
          userId, username, rootId, targetNodeId: classification.targetNodeId, signal, res: null,
        });
        emitStatus(socket, "done", "");
        const answer = result?.answer || null;
        const mode = result?.mode || classification.mode;
        if (answer) pushMemory(visitorId, message, answer);
        modesUsed.push(mode);
        return { success: true, answer, modeKey: mode, modesUsed, rootId };
      } catch (err) {
        log.error("Tree Orchestrator", `Extension handleMessage failed: ${err.message}`);
        emitStatus(socket, "done", "");
        return { success: false, answer: "Extension request failed.", modeKey: classification.mode, modesUsed, rootId };
      }
    }

    // ── Tier 2: suffix convention routing ──
    // Match against real registered modes, not constructed guesses.
    // :coach = guided (be), :review/:ask = analysis, :plan = building, :log/:tell = default
    let resolvedMode = classification.mode;
    if (extName) {
      const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const extModes = getModesOwnedBy(extName);
      const find = (...suffixes) => {
        for (const s of suffixes) {
          const match = extModes.find(m => m.endsWith(`-${s}`));
          if (match) return match;
        }
        return null;
      };
      const lower = message.toLowerCase().trim();

      if (behavioral === "be" || lower === "be") {
        resolvedMode = find("coach") || resolvedMode;
      } else if (/\b(how am i|progress|status|review|daily|stats|streak|history|so far|pattern|doing)\b/.test(lower)) {
        resolvedMode = find("review", "ask") || resolvedMode;
      } else if (/\b(plan|build|create|structure|organize|add|modify|remove|restructure|program|taper|schedule|adjust|set.*goal|change|curriculum)\b/.test(lower)) {
        resolvedMode = find("plan") || resolvedMode;
      }
      // else: stays on classification.mode (modes.respond, usually :log or :tell)
    }

    modesUsed.push(resolvedMode);
    emitStatus(socket, "intent", "");

    await switchMode(visitorId, resolvedMode, {
      username, userId, rootId,
      currentNodeId: classification.targetNodeId || rootId,
      conversationMemory: formatMemoryContext(visitorId),
      clearHistory: true,
    });

    const result = await processMessage(visitorId, message, {
      username, userId, rootId, signal, slot,
      readOnly: behavioral === "query",
      onToolLoopCheckpoint,
      meta: { internal: false },
      onToolResults(results) {
        if (signal?.aborted) return;
        for (const r of results) socket.emit(WS.TOOL_RESULT, r);
      },
    });

    emitStatus(socket, "done", "");
    const answer = result?.content || result?.answer || null;
    if (answer) pushMemory(visitorId, message, answer);
    return { success: true, answer, modeKey: resolvedMode, modesUsed, rootId };
  }


  // ────────────────────────────────────────────────────────
  // MULTI-EXTENSION CHAIN — message matches 2+ extensions
  // Each extension runs as a focused agent with its own tools.
  // Results pass from one step to the next.
  // ────────────────────────────────────────────────────────

  if (rootId && classification.intent === "converse") {
    try {
      const currentNodeId = getCurrentNodeId(visitorId) || rootId;
      const currentPath = await _buildCurrentPath(currentNodeId);

      // Routing index now includes both scaffolded and confined ext-allowed extensions.
      // One path, one query.
      const { queryAllMatches } = await import("./routingIndex.js");
      const indexMatches = queryAllMatches(rootId, message, null);

      log.verbose("Tree Orchestrator", `  Converse chain check: ${indexMatches.length} matches: ${indexMatches.map(m => m.extName).join(", ") || "none"}`);

      // Single match from converse path: route to that extension instead of converse
      if (indexMatches.length === 1) {
        const single = indexMatches[0];
        log.verbose("Tree Orchestrator", `  Single extension in converse: routing to ${single.extName}`);
        modesUsed.push(single.mode);
        emitStatus(socket, "intent", "");

        await switchMode(visitorId, single.mode, {
          username, userId, rootId,
          currentNodeId: single.targetNodeId,
          conversationMemory: formatMemoryContext(visitorId),
          clearHistory: true,
        });

        const singleResult = await processMessage(visitorId, message, {
          username, userId, rootId, signal, slot,
          onToolLoopCheckpoint,
          onToolResults(results) {
            if (signal?.aborted) return;
            for (const r of results) socket.emit(WS.TOOL_RESULT, r);
          },
        });

        emitStatus(socket, "done", "");
        const singleAnswer = singleResult?.content || singleResult?.answer || null;
        if (singleAnswer) pushMemory(visitorId, message, singleAnswer);
        return { success: true, answer: singleAnswer, modeKey: single.mode, modesUsed, rootId };
      }

      if (indexMatches.length > 1) {
        log.verbose("Tree Orchestrator", `  Chain detected: ${indexMatches.map(m => m.extName).join(" -> ")}`);
        emitStatus(socket, "intent", "Chaining extensions...");

        let context = message;
        const chainModes = [];

        for (let i = 0; i < indexMatches.length; i++) {
          const step = indexMatches[i];
          const isLast = i === indexMatches.length - 1;

          // Navigate to the extension's node for this step
          const stepNodeId = step.targetNodeId || getCurrentNodeId(visitorId) || rootId;
          await switchMode(visitorId, step.mode, {
            username, userId, rootId,
            currentNodeId: stepNodeId,
            conversationMemory: context,
            clearHistory: true,
          });

          const stepResult = await processMessage(visitorId, isLast ? context : `${context}\n\nDo this step and return what you produced.`, {
            username, userId, rootId, signal, slot,
            onToolLoopCheckpoint,
            onToolResults(results) {
              if (signal?.aborted) return;
              for (const r of results) socket.emit(WS.TOOL_RESULT, r);
            },
          });

          if (signal?.aborted) return null;

          const stepAnswer = stepResult?.content || stepResult?.answer || "";
          chainModes.push(step.mode);

          // Pass result to next step as context
          if (!isLast) {
            context = `Original request: ${message}\n\nPrevious step (${step.extName}) result:\n${stepAnswer}`;
          } else {
            context = stepAnswer;
          }
        }

        emitStatus(socket, "done", "");
        if (context) pushMemory(visitorId, message, context);
        return { success: true, answer: context, modeKey: chainModes[chainModes.length - 1], modesUsed: [...modesUsed, ...chainModes], rootId };
      }
    } catch (err) {
      log.debug("Tree Orchestrator", `Chain detection failed: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────
  // FALLBACK — anything not caught above goes to converse
  // ────────────────────────────────────────────────────────

  modesUsed.push("tree:converse");
  emitStatus(socket, "intent", "");

  await switchMode(visitorId, "tree:converse", {
    username, userId, rootId,
    conversationMemory: formatMemoryContext(visitorId),
    clearHistory: true,
  });

  const fallbackResult = await processMessage(visitorId, message, {
    username, userId, rootId, signal, slot,
    onToolLoopCheckpoint,
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) socket.emit(WS.TOOL_RESULT, r);
    },
  });

  emitStatus(socket, "done", "");
  const fallbackAnswer = fallbackResult?.content || fallbackResult?.answer || null;
  if (fallbackAnswer) pushMemory(visitorId, message, fallbackAnswer);
  return { success: true, answer: fallbackAnswer, modeKey: "tree:converse", modesUsed, rootId };
}
// ─────────────────────────────────────────────────────────────────────────
// RESPOND (final user-facing output)
// ─────────────────────────────────────────────────────────────────────────

async function runRespond({
  visitorId,
  socket,
  signal,
  username,
  userId,
  rootId,
  nodeContext,
  operationContext,
  confirmNeeded = false,
  originalMessage = null,
  responseHint = "",
  stepSummaries = [],
  librarianContext = null,
  slot,
}) {
  emitStatus(socket, "respond", "");

  // Include conversation memory so respond can reference prior exchanges
  const memCtx = formatMemoryContext(visitorId);

  // Build a combined context: memory + step summaries + operation details
  const summaryCtx = formatStepSummaries(stepSummaries);

  // Strip librarianContext to only the fields respond needs (skip plan array, nodeIds, etc.)
  let strippedLibCtx = null;
  if (librarianContext) {
    strippedLibCtx = {
      summary: librarianContext.summary || null,
      responseHint: librarianContext.responseHint || null,
      confidence: librarianContext.confidence ?? null,
    };
  }

  const respondMode = await resolveModeForNode("respond", getCurrentNodeId(visitorId) || rootId);
  await switchMode(visitorId, respondMode, {
    username,
    userId,
    rootId,
    nodeContext: nodeContext || null,
    operationContext: operationContext || null,
    conversationMemory: memCtx || null,
    stepSummaries: !operationContext ? summaryCtx || null : null,
    responseHint: responseHint || null,
    confirmNeeded,
    librarianContext: strippedLibCtx,
    clearHistory: true,
  });

  // Build trigger with responseHint for tone/content guidance
  let trigger;
  if (confirmNeeded) {
    trigger = "Present the pending operation and ask for confirmation.";
  } else if (librarianContext) {
    trigger = responseHint
      ? `Respond naturally based on what you know. Guidance: ${responseHint}`
      : "Respond naturally based on the context provided.";
  } else if (operationContext) {
    trigger = responseHint
      ? `Summarize what was done. Tone guidance: ${responseHint}`
      : "Summarize what was done.";
  } else {
    trigger = responseHint
      ? `Respond to the user. Guidance: ${responseHint}`
      : "Respond to the user based on the provided context.";
  }

  const response = await processMessage(visitorId, trigger, {
    username,
    userId,
    rootId,
    slot,
    signal,
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) {
        socket.emit(WS.TOOL_RESULT, r);
      }
    },
  });

  emitStatus(socket, "done", "");

  // Save this exchange to memory for future turns
  if (originalMessage && response?.answer) {
    pushMemory(visitorId, originalMessage, response.answer);
  }

  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// SHORT-MEMORY DECISION
// ─────────────────────────────────────────────────────────────────────────

/**
 * CURRENTLY UNUSED. No classifier (local or LLM) provides placementAxes.
 * The defer decision is handled inline: only explicit "defer" intent triggers
 * deferral. This function is preserved for a future classifier that returns
 * { placementAxes: { pathConfidence, domainNovelty, relationalComplexity } }.
 * Until then, it always returns { defer: false } and should not be wired in.
 *
 * @returns {{ defer: boolean, reason?: string }}
 */
