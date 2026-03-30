// orchestrators/tree.js
// Orchestrates tree requests: classify → librarian (place/query) or destructive flow
// Librarian: navigates, reads, places — behind the scenes
// Destructive: translate → navigate → confirm → execute (existing flow)

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
  resetConversation,
  getClientForUser,
  resolveRootLlmForMode,
} from "../../seed/llm/conversation.js";
import { classify, translateDestructive } from "./translator.js";
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
async function localClassify(message, currentNodeId) {
  const lower = message.toLowerCase().trim();
  const base = { summary: message.slice(0, 100), responseHint: "" };

  // ── Extension routing (Path 2) ──
  // Check if an extension mode claims this message. Two levels:
  // 1. Current node's mode override (user is AT the extension node)
  // 2. Direct children's mode overrides (user is one level above)
  // Never walk ancestors. Modes resolve downward.
  if (currentNodeId) {
    try {
      const { getClassifierHintsForMode } = await import("../loader.js");
      const currentNode = await Node.findById(currentNodeId).select("metadata children").lean();

      // Level 1: current node has a mode override — extension owns all messages here.
      // No hint matching needed. The user navigated to this node; the extension handles it.
      const modes = currentNode?.metadata instanceof Map
        ? currentNode.metadata.get("modes")
        : currentNode?.metadata?.modes;
      if (modes?.respond) {
        return { intent: "extension", mode: modes.respond, confidence: 0.95, ...base };
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

  // ── Standard classification ──

  // Conversational: skip librarian, go straight to respond
  if (/^(hey|hi|hello|thanks|ok|sure|yep|yeah|what's up|sup|yo|nice|cool|got it|good)\b/i.test(lower))
    return { intent: "query", confidence: 0.9, ...base };

  // Questions: read-only query flow
  if (/^(what|how|why|when|where|who|is |are |does |do |can |show |tell |list )/.test(lower))
    return { intent: "query", confidence: 0.8, ...base };

  // Destructive: needs LLM translation for safety
  if (/\b(delete|remove|move|merge|reorganize|clean up|mark .* completed?)\b/.test(lower))
    return { intent: "destructive", confidence: 0.7, ...base };

  // Explicit action commands: high-confidence placement
  if (/^(start|build|create|add|give me|set up|make|write|plan|draft|outline|design|launch|begin)\b/.test(lower))
    return { intent: "place", confidence: 0.8, ...base };

  // Personal/reflective statements: conversational query
  if (/^(i did|i was|it was|that was|we did|we were|he |she |they |it's been|i've been|i think|i feel|i guess|so |exactly|sounds good|makes sense)\b/.test(lower))
    return { intent: "query", confidence: 0.7, ...base };

  // Everything else: placement (librarian decides)
  return { intent: "place", confidence: 0.6, ...base };
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

// visitorId → { action, targetNodeId, targetPath, nodeContext, originalMessage }
const pendingOperations = new Map();

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
// STEP SUMMARY HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a compact summary string for a completed plan step.
 * This is the ONLY thing carried between steps — full conversation is dropped.
 */
function buildStepSummary({
  stepNum,
  intent,
  targetPath,
  targetNodeId,
  navResult,
  execResult,
  nodeContext,
  skipped,
  skipReason,
}) {
  if (skipped) {
    return { step: stepNum, intent, skipped: true, reason: skipReason };
  }

  const summary = {
    step: stepNum,
    intent,
    target: targetPath || targetNodeId || "root",
  };

  // Pull key info from execution result
  if (execResult) {
    summary.action = execResult.action || intent;
    summary.operations = execResult.operations || undefined;
    summary.detail = execResult.summary || execResult.reason || undefined;

    // Detect failed execution
    const ops = execResult.operations;
    const hasFailed =
      (Array.isArray(ops) && ops.length === 0) ||
      execResult.action === "error" ||
      /\b(fail|error|not found|not available|unable|could not)\b/i.test(
        execResult.summary || "",
      );
    if (hasFailed) {
      summary.failed = true;
    }
  }

  // For query/reflect — note what context was available
  if (intent === "query" || intent === "reflect") {
    if (nodeContext) {
      try {
        const ctx =
          typeof nodeContext === "string"
            ? JSON.parse(nodeContext)
            : nodeContext;
        summary.contextKeys = Object.keys(ctx);
        // Include a brief snapshot — node name, child count, etc.
        if (ctx.name) summary.nodeName = ctx.name;
        if (ctx.children) summary.childCount = ctx.children.length;
      } catch (err) { log.debug("TreeOrch", "Could not parse nodeContext for step summary:", err.message); }
    }
  }

  return summary;
}

/**
 * Map an execution result to a treeContext stepResult enum value.
 * Mirrors the failure-detection logic in buildStepSummary.
 */
function execResultToStepResult(execResult) {
  if (!execResult) return "failed";
  const ops = execResult.operations;
  const hasFailed =
    (Array.isArray(ops) && ops.length === 0) ||
    execResult.action === "error" ||
    /\b(fail|error|not found|not available|unable|could not)\b/i.test(
      execResult.summary || "",
    );
  return hasFailed ? "failed" : "success";
}

/**
 * Format accumulated step summaries as context string for injection
 * into subsequent steps and the responder.
 */
function formatStepSummaries(stepSummaries) {
  if (stepSummaries.length === 0) return "";
  const lines = stepSummaries.map((s) => {
    if (s.skipped)
      return `- Step ${s.step} (${s.intent}): SKIPPED — ${s.reason}`;
    if (s.failed)
      return `- Step ${s.step} (${s.intent}): FAILED — ${s.detail || "Operation did not complete"}`;
    const target = s.target ? ` on ${s.target}` : "";
    const detail = s.detail ? ` — ${s.detail}` : "";
    return `- Step ${s.step} (${s.intent}${target}): ${s.action || "done"}${detail}`;
  });
  return `\nCompleted steps:\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIRMATION CHECK
// ─────────────────────────────────────────────────────────────────────────

const CONFIRM_WORDS =
  /^(yes|yeah|yep|y|confirm|proceed|do it|go ahead|ok|sure|approved?)\s*[.!]?$/i;
const DENY_WORDS =
  /^(no|nah|nope|n|cancel|stop|don'?t|abort|never\s*mind)\s*[.!]?$/i;

function isConfirmation(message) {
  return CONFIRM_WORDS.test(message.trim());
}

function isDenial(message) {
  return DENY_WORDS.test(message.trim());
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
// SHARED: RESPOND TO PLAN COMPLETION
// Takes a completed plan result and generates the final user-facing response.
// Used by destructive path, librarian flow, and pending operation resume.
// ─────────────────────────────────────────────────────────────────────────

async function respondToCompletion({
  planResult,
  visitorId,
  socket,
  signal,
  meta,
  message,
  responseHint,
  modesUsed,
  confidence,
  skipRespond,
  rt,
  librarianContext,
}) {
  if (!planResult) return null;

  // Early exits: confirm or respond (ambiguity/not found)
  if (planResult.type === "confirm" || planResult.type === "respond") {
    const r = planResult.response;
    if (r) {
      r.modesUsed = modesUsed;
      r.confidence = confidence;
    }
    return r;
  }

  if (planResult.navigateOnly) return planResult.navigateOnly;

  const { stepSummaries, lastTargetNodeId, lastTargetPath } = planResult;
  const anyFailed = stepSummaries.some((s) => s.failed || s.skipped);

  if (skipRespond) {
    return {
      success: !anyFailed,
      answer: null,
      modeKey: "tree:orchestrator",
      modesUsed,
      confidence,
      stepSummaries,
      lastTargetNodeId,
      lastTargetPath,
    };
  }

  const operationContext =
    stepSummaries.length > 0 ? formatStepSummaries(stepSummaries) : null;
  const structuredResults =
    stepSummaries.length > 0 ? JSON.stringify(stepSummaries, null, 2) : null;

  const finalResponseHint = anyFailed
    ? `${responseHint ? responseHint + " " : ""}IMPORTANT: Some operations failed. Report what succeeded and what failed honestly.`
    : responseHint;

  modesUsed.push("tree:respond");
  const respondStart = new Date();

  const response = await runRespond({
    visitorId,
    socket,
    signal,
    ...meta,
    nodeContext: null,
    operationContext: structuredResults || operationContext,
    originalMessage: message,
    responseHint: finalResponseHint,
    librarianContext: librarianContext || null,
    stepSummaries,
  });

  const respondEnd = new Date();
  rt.trackStep("tree:respond", {
    input: responseHint || "Respond to the user",
    output: response?.answer || null,
    startTime: respondStart,
    endTime: respondEnd,
    llmProvider: response?.llmProvider || rt.llmProvider,
    treeContext: {
      targetNodeId: lastTargetNodeId,
      targetPath: lastTargetPath,
      directive: responseHint || "Respond to the user",
      stepResult: anyFailed ? "failed" : "success",
    },
  });

  if (response) {
    response.modesUsed = modesUsed;
    response.confidence = confidence;
    response.stepSummaries = stepSummaries;
  }
  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// SHARED PLAN EXECUTION LOOP
// Used by both destructive path and librarian flow.
// Each step: navigate → context/scout → destructive check → execute → summarize
// ─────────────────────────────────────────────────────────────────────────

/**
 * Execute a plan (array of steps) produced by either the translator or librarian.
 *
 * Returns:
 *   { type: "completed", stepSummaries, lastTargetNodeId, lastTargetPath }
 *   { type: "confirm", response }  — destructive step paused for confirmation
 *   { type: "respond", response }   — early exit (ambiguity, not found)
 *   null — signal aborted
 */
async function executePlanSteps({
  plan,
  visitorId,
  message,
  socket,
  signal,
  username,
  userId,
  rootId,
  modesUsed,
  initialTargetNodeId,
  initialTargetPath,
  stepSummaries,
  responseHint,
  includeMemoryOnFirstStep,
  rt,
}) {
  const meta = { username, userId, rootId };
  let lastTargetNodeId = initialTargetNodeId || rootId;
  let lastTargetPath = initialTargetPath || null;

  for (let i = 0; i < plan.length; i++) {
    if (signal?.aborted) {
      if (stepSummaries.length > 0) {
        pushMemory(
          visitorId,
          message,
          `[Stopped mid-plan. ${formatStepSummaries(stepSummaries)}]`,
        );
      }
      return null;
    }

    const op = plan[i];
    const stepNum = stepSummaries.length + 1;
    const totalSteps = stepSummaries.length + plan.length - i;
    const isOnlyStep = plan.length === 1 && stepSummaries.length === 0;

    // Emit plan step marker
    rt.trackStep(`tree:orchestrator:plan:${stepNum}`, {
      input: `Step ${stepNum}: ${op.intent}${op.targetHint ? ` → ${op.targetHint}` : ""}\n${op.directive}`,
      llmProvider: rt.llmProvider,
      treeContext: {
        targetNodeId: op.targetNodeId || lastTargetNodeId,
        targetPath: lastTargetPath,
        planStepIndex: stepNum,
        planTotalSteps: plan.length,
        directive: op.directive,
        stepResult: "pending",
      },
    });

    // Map plan op to intent shape
    const intent = {
      intent: op.intent,
      needsNavigation: op.needsNavigation,
      needsContext: !["navigate"].includes(op.intent),
      isDestructive: op.isDestructive,
      targetHint: op.targetHint,
      directive: op.directive,
      summary: op.directive,
    };

 log.verbose("Tree Orchestrator", 
      `  📋 Step ${stepNum}: ${intent.intent} → ${intent.targetHint || "(current)"}`,
    );

    // ══════════════════════════════════════════════════════
    // A) NAVIGATE — establish position
    // ══════════════════════════════════════════════════════

    let targetNodeId = op.targetNodeId || lastTargetNodeId;
    let targetPath = lastTargetPath;

    // If librarian already provided a targetNodeId, skip navigation
    if (op.targetNodeId && !op.needsNavigation) {
 log.verbose("Tree Orchestrator", ` Librarian provided ID: ${op.targetNodeId}`);
      targetNodeId = op.targetNodeId;
    } else if (intent.targetHint) {
      // ── LLM NAVIGATION — search for a specific node ──
      emitStatus(
        socket,
        "navigate",
        isOnlyStep ? "Finding node…" : `Step ${stepNum}: Finding node…`,
      );

      const navMode = await resolveModeForNode("navigate", lastTargetNodeId);
      await switchMode(visitorId, navMode, {
        ...meta,
        currentNodeId: getCurrentNodeId(visitorId) || rootId,
        clearHistory: true,
      });

      const priorStepsCtx = formatStepSummaries(stepSummaries);
      const memCtx =
        i === 0 && includeMemoryOnFirstStep
          ? formatMemoryContext(visitorId)
          : "";
      const navDirective = intent.directive || message;

      let navMessage = navDirective;
      if (priorStepsCtx || memCtx) {
        navMessage = `${memCtx}${priorStepsCtx}\n\nCurrent request: ${navDirective}`;
      }

      const navStart = new Date();
      const navResult = await processMessage(visitorId, navMessage, {
        ...meta,
        signal,
        meta: { internal: true },
      });
      const navEnd = new Date();

      if (signal?.aborted) return null;
      emitModeResult(socket, "tree:navigate", navResult);

      modesUsed.push("tree:navigate");
      rt.trackStep("tree:navigate", {
        input: navDirective,
        output: navResult,
        startTime: navStart,
        endTime: navEnd,
        llmProvider: navResult?._llmProvider || rt.llmProvider,
        treeContext: {
          targetNodeId: navResult?.action === "found" ? navResult.targetNodeId : lastTargetNodeId,
          targetPath: navResult?.action === "found" ? navResult.targetPath : lastTargetPath,
          planStepIndex: stepNum,
          planTotalSteps: plan.length,
          directive: navDirective,
          stepResult: navResult?.action === "found" ? "success" : navResult?.action === "ambiguous" ? "pending" : "failed",
          resultDetail: navResult?.reason || navResult?.summary || null,
        },
      });

      if (navResult?.action === "found") {
        targetNodeId = navResult.targetNodeId;
        targetPath = navResult.targetPath;
      } else if (navResult?.action === "ambiguous") {
        // For merge/dedup/duplicate operations, ambiguity is EXPECTED.
        const isBatchOp =
          /\b(merge|dedup|duplicat|redundan|consolidat|delet|remov|clean\s*up|all|both|every|each)\b/i.test(
            intent.directive || message,
          );

        if (isBatchOp && navResult.candidates?.length > 0) {
 log.verbose("Tree Orchestrator", 
            `  🔀 Merge operation — collecting ${navResult.candidates.length} ambiguous candidates`,
          );

          const candidateContexts = [];
          for (const candidate of navResult.candidates) {
            try {
              const ctx = await getContextForAi(candidate.nodeId, {
                includeChildren: true,
                includeParentChain: true,
                includeValues: false,
                includeNotes: false,
                userId,
              });
              candidateContexts.push(ctx);
            } catch (err) {
 log.error("Tree Orchestrator", 
                `⚠️ Failed to fetch candidate ${candidate.nodeId}:`,
                err.message,
              );
            }
          }

          const firstCandidate = candidateContexts[0];
          if (firstCandidate?.parent?.id) {
            targetNodeId = firstCandidate.parent.id;
            targetPath =
              firstCandidate.path?.split(" > ").slice(0, -1).join(" > ") ||
              null;
          } else {
            targetNodeId = rootId;
            targetPath = null;
          }

          intent._mergeContext = {
            mergeTarget: targetNodeId,
            candidates: candidateContexts,
          };

 log.verbose("Tree Orchestrator", 
            `  📍 Merge target: ${targetPath || targetNodeId} with ${candidateContexts.length} candidates`,
          );
        } else {
          // Normal ambiguity — ask user
          const response = await runRespond({
            visitorId,
            socket,
            signal,
            ...meta,
            nodeContext: JSON.stringify(navResult, null, 2),
            operationContext:
              stepSummaries.length > 0
                ? `${formatStepSummaries(stepSummaries)}\n\nThen hit ambiguity — need user to disambiguate.`
                : "Navigation found multiple matches. Need user to disambiguate.",
            originalMessage: message,
            responseHint:
              "Ask the user to clarify which node they mean. List the options clearly.",
            stepSummaries,
          });
          return { type: "respond", response };
        }
      } else if (navResult?.action === "not_found") {
        if (i === 0 && stepSummaries.length === 0) {
          const response = await runRespond({
            visitorId,
            socket,
            signal,
            ...meta,
            nodeContext: null,
            operationContext: `Could not find a node matching: "${intent.targetHint || message}"`,
            originalMessage: message,
            responseHint:
              "Let the user know the node wasn't found. Suggest alternatives if possible.",
            stepSummaries,
          });
          return { type: "respond", response };
        } else {
          stepSummaries.push(
            buildStepSummary({
              stepNum,
              intent: intent.intent,
              targetNodeId,
              targetPath,
              skipped: true,
              skipReason: "Node not found",
            }),
          );
          await resetConversation(visitorId, { username, userId });
          continue;
        }
      }
    } else {
      // ── NO TARGET — operate on current position (root or last step's target) ──
      targetNodeId = lastTargetNodeId || getCurrentNodeId(visitorId) || rootId;
      targetPath = lastTargetPath || null;
 log.verbose("Tree Orchestrator", ` Using current position: ${targetPath || targetNodeId}`);
    }

    // ══════════════════════════════════════════════════════
    // B) PURE NAVIGATION — if that's all this step does
    // ══════════════════════════════════════════════════════

    if (intent.intent === "navigate" && targetNodeId) {
      if (isOnlyStep) {
        // Pure navigation: user asked to go somewhere. Move the iframe.
        if (isActiveNavigator(userId, rt.sessionId)) {
          socket.emit(WS.NAVIGATE, {
            url: `/api/v1/node/${targetNodeId}?html`,
            replace: false,
          });
        }
        const navSummary = `Navigated to ${targetPath || targetNodeId}.`;
        emitStatus(socket, "done", "");
        pushMemory(visitorId, message, navSummary);
        return {
          type: "completed",
          stepSummaries,
          lastTargetNodeId: targetNodeId,
          lastTargetPath: targetPath,
          navigateOnly: {
            success: true,
            answer: navSummary,
            modeKey: "tree:navigate",
            rootId,
            modesUsed,
          },
        };
      }
      stepSummaries.push(
        buildStepSummary({
          stepNum,
          intent: "navigate",
          targetPath,
          targetNodeId,
          execResult: {
            action: "navigated",
            summary: `Moved to ${targetPath || targetNodeId}`,
          },
        }),
      );
      lastTargetNodeId = targetNodeId;
      lastTargetPath = targetPath;
      await resetConversation(visitorId, { username, userId });
      continue;
    }

    // ══════════════════════════════════════════════════════
    // C) GET CONTEXT + SCOUT
    // ══════════════════════════════════════════════════════

    let nodeContext = null;
    let ctxResult = null;

    if (intent.needsContext && targetNodeId) {
      emitStatus(
        socket,
        "context",
        isOnlyStep ? "Reading node…" : `Step ${stepNum}: Reading node…`,
      );
      const ctxStart = new Date();

      const contextProfiles = {
        structure: {
          includeChildren: true,
          includeParentChain: true,
          includeValues: true,
          includeNotes: true,
        },
        edit: {
          includeChildren: true,
          includeParentChain: true,
          includeValues: true,
          includeNotes: false,
        },
        notes: {
          includeChildren: false,
          includeParentChain: false,
          includeValues: false,
          includeNotes: true,
        },
        query: {
          includeChildren: true,
          includeParentChain: true,
          includeValues: true,
          includeNotes: true,
        },
      };

      const profile = contextProfiles[intent.intent] || contextProfiles.query;
      ctxResult = await getContextForAi(targetNodeId, { ...profile, userId });

      // ── SCOUT LOOP ──
      const shouldScout =
        !intent.isDestructive &&
        !/\b(delet|merg|dedup|duplicat|remov|consolidat|redundan|clean\s*up|reorgani[sz]|move|reparent|relocat|transfer)\b/i.test(
          intent.directive,
        ) &&
        !/\b(move|from|into)\b.*\b(child|node|branch|content)/i.test(
          intent.directive,
        );

      if (
        intent.intent === "structure" &&
        ctxResult.children?.length > 0 &&
        shouldScout
      ) {
        const scoutResult = await scoutExistingStructure({
          ctxResult,
          directive: intent.directive,
          targetNodeId,
          profile,
          signal,
          userId,
        });

        if (scoutResult.adapted) {
          targetNodeId = scoutResult.targetNodeId;
          targetPath = scoutResult.targetPath || targetPath;
          ctxResult = scoutResult.ctxResult;
          intent.intent = scoutResult.newIntent;
          intent.directive = scoutResult.newDirective || intent.directive;

 log.verbose("Tree Orchestrator", 
            `  🔍 Scout adapted: ${op.intent} → ${intent.intent} at ${targetPath || targetNodeId}`,
          );
          emitModeResult(socket, "tree:scout", {
            adapted: true,
            newIntent: intent.intent,
            targetNodeId,
            reason: scoutResult.reason,
          });
        }
      }

      nodeContext = JSON.stringify(ctxResult, null, 2);

      // ── DEEP CONTEXT for destructive restructure operations ──
      const isRestructure =
        intent.isDestructive ||
        /\b(delet|merg|dedup|remov|consolidat|redundan|clean\s*up|reorgani[sz])\b/i.test(
          intent.directive,
        );

      if (
        intent.intent === "structure" &&
        isRestructure &&
        ctxResult.children?.length > 0
      ) {
        const childContexts = [];
        for (const child of ctxResult.children) {
          try {
            const childCtx = await getContextForAi(child.id, {
              includeChildren: true,
              includeParentChain: false,
              includeValues: false,
              includeNotes: false,
              userId,
            });
            childContexts.push(childCtx);
          } catch (err) {
 log.error("Tree Orchestrator", 
              `⚠️ Deep context failed for "${child.name}":`,
              err.message,
            );
          }
        }

        if (childContexts.length > 0) {
          nodeContext = JSON.stringify(
            {
              currentNode: ctxResult,
              childrenDetail: childContexts,
            },
            null,
            2,
          );
 log.verbose("Tree Orchestrator", 
            `  🔬 Deep context: fetched details for ${childContexts.length} children`,
          );
        }
      }

      // ── SECONDARY CONTEXT for move/reparent operations ──
      if (
        intent.intent === "structure" &&
        /\b(move|reparent|relocate|transfer)\b/i.test(intent.directive)
      ) {
        const counterparts = await fetchMoveCounterparts(
          intent.directive,
          targetNodeId,
          rootId,
          userId,
        );
        if (counterparts.length > 0) {
          const combined = {
            navigatedNode: ctxResult,
            referencedNodes: counterparts,
          };
          nodeContext = JSON.stringify(combined, null, 2);
 log.verbose("Tree Orchestrator", 
            `  📦 Move detected — fetched ${counterparts.length} counterpart(s): ${counterparts.map((c) => c.name).join(", ")}`,
          );
        }
      }

      // ── MERGE CONTEXT: inject candidate data from ambiguous nav ──
      if (intent._mergeContext) {
        const mc = intent._mergeContext;
        try {
          const parsed = JSON.parse(nodeContext);
          nodeContext = JSON.stringify(
            {
              mergeTarget: parsed,
              duplicateCandidates: mc.candidates,
            },
            null,
            2,
          );
        } catch {
          nodeContext = JSON.stringify(
            {
              mergeTarget: ctxResult,
              duplicateCandidates: mc.candidates,
            },
            null,
            2,
          );
        }
 log.verbose("Tree Orchestrator", 
          `  🔀 Injected ${mc.candidates.length} merge candidates into context`,
        );
      }

      emitModeResult(socket, "tree:get-context", ctxResult);

      const ctxEnd = new Date();
      rt.trackStep("tree:get-context", {
        input: `getContextForAi(${targetNodeId}, ${intent.intent})`,
        output: ctxResult,
        startTime: ctxStart,
        endTime: ctxEnd,
        llmProvider: rt.llmProvider,
        treeContext: {
          targetNodeId,
          targetPath,
          planStepIndex: stepNum,
          planTotalSteps: plan.length,
          directive: intent.intent,
          stepResult: "success",
        },
      });
    }

    // ══════════════════════════════════════════════════════
    // D) DESTRUCTIVE CHECK — pause for confirmation
    // ══════════════════════════════════════════════════════

    if (intent.isDestructive) {
      const remainingPlan = plan.slice(i + 1);

      pendingOperations.set(visitorId, {
        action: op.intent,
        directive: op.directive,
        targetNodeId,
        targetPath,
        nodeContext,
        originalMessage: message,
        remainingPlan,
        stepSummaries: [...stepSummaries],
        stepNum,
        responseHint,
        sessionId: rt.sessionId,
        modesUsed: [...modesUsed],
        chainIndex: rt.chainIndex,
      });

      const response = await runRespond({
        visitorId,
        socket,
        signal,
        ...meta,
        nodeContext,
        operationContext:
          stepSummaries.length > 0
            ? `${formatStepSummaries(stepSummaries)}\n\nPending destructive operation: ${intent.directive}`
            : `Destructive operation requested: ${intent.directive}`,
        confirmNeeded: true,
        originalMessage: message,
        responseHint:
          "Clearly describe the destructive action and ask for explicit confirmation.",
        stepSummaries,
      });
      return { type: "confirm", response };
    }

    // ══════════════════════════════════════════════════════
    // E) EXECUTE MUTATION
    // ══════════════════════════════════════════════════════

    const mutationIntents = ["structure", "edit", "notes"];
    const isMutation = mutationIntents.includes(intent.intent);
    const executionMode = isMutation ? await resolveModeForNode(intent.intent, targetNodeId) : null;
    let execResult = null;

    if (executionMode) {
      emitStatus(
        socket,
        "execute",
        isOnlyStep ? "Making changes…" : `Step ${stepNum}: Making changes…`,
      );

      let prestige = 0;
      if (nodeContext) {
        try {
          const parsed = JSON.parse(nodeContext);
          prestige = parsed.prestige ?? 0;
        } catch (err) { log.debug("TreeOrch", "Could not parse nodeContext for prestige:", err.message); }
      }

      await switchMode(visitorId, executionMode, {
        ...meta,
        targetNodeId,
        prestige,
        clearHistory: true,
      });

      const executionMessage = buildExecutionMessage(
        intent.directive || message,
        targetNodeId,
        nodeContext,
        stepSummaries,
      );

      const execStart = new Date();
      execResult = await processMessage(visitorId, executionMessage, {
        ...meta,
        signal,
        meta: { internal: true },
      });
      const execEnd = new Date();

      if (signal?.aborted) return null;
      emitModeResult(socket, executionMode, execResult);

      modesUsed.push(executionMode);
      rt.trackStep(executionMode, {
        input: intent.directive,
        output: execResult,
        startTime: execStart,
        endTime: execEnd,
        llmProvider: execResult?._llmProvider || rt.llmProvider,
        treeContext: {
          targetNodeId,
          targetPath,
          planStepIndex: stepNum,
          planTotalSteps: plan.length,
          directive: intent.directive,
          stepResult: execResultToStepResult(execResult),
          resultDetail: execResult?.summary || execResult?.reason || null,
        },
      });

      // Notify frontend of tree changes
      if (intent.intent === "structure" && execResult?.operations?.length > 0) {
        socket.emit(WS.TREE_CHANGED, {
          nodeId: targetNodeId,
          changeType: execResult?.action || "modified",
        });
      }
    }

    // ══════════════════════════════════════════════════════
    // F) SUMMARIZE & RESET
    // ══════════════════════════════════════════════════════

    const stepSummary = buildStepSummary({
      stepNum,
      intent: intent.intent,
      targetPath,
      targetNodeId,
      navResult: null,
      execResult,
      nodeContext,
    });
    stepSummaries.push(stepSummary);

    if (stepSummary.failed) {
 log.verbose("Tree Orchestrator", 
        `  ❌ Step ${stepNum} FAILED: ${stepSummary.detail || "unknown"}`,
      );
    } else {
 log.verbose("Tree Orchestrator", 
        `  ✅ Step ${stepNum} summary: ${stepSummary.detail || stepSummary.action || intent.intent}`,
      );
    }

    // Reset conversation — next step starts fresh
    await resetConversation(visitorId, { username, userId });

    // Carry forward position
    lastTargetNodeId = targetNodeId;
    lastTargetPath = targetPath;
  }

  return {
    type: "completed",
    stepSummaries,
    lastTargetNodeId,
    lastTargetPath,
  };
}

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
  // QUERY FAST PATH — skip classifier, go straight to context gather + respond
  // ────────────────────────────────────────────────────────

  if (forceQueryOnly) {
    return await runQueryFlow({
      visitorId,
      message,
      socket,
      signal,
      username,
      userId,
      rootId,
      modesUsed,
      rt,
      slot,
    });
  }

  // ────────────────────────────────────────────────────────
  // CHECK FOR PENDING CONFIRMATION
  // ────────────────────────────────────────────────────────

  const pending = pendingOperations.get(visitorId);
  if (pending) {
    pendingOperations.delete(visitorId);

    if (isConfirmation(message)) {
      return await executePendingOperation({
        visitorId,
        pending,
        socket,
        signal,
        ...meta,
        rt,
        skipRespond,
      });
    } else if (isDenial(message)) {
      const remaining = pending.remainingPlan?.length || 0;
      const cancelContext =
        remaining > 0
          ? `User cancelled the destructive operation. ${remaining} remaining plan step(s) were also abandoned.`
          : "User cancelled the operation.";

      if (skipRespond) {
        return {
          success: true,
          answer: null,
          modeKey: "tree:orchestrator",
          stepSummaries: pending.stepSummaries || [],
        };
      }
      return await runRespond({
        visitorId,
        socket,
        signal,
        ...meta,
        operationContext: cancelContext,
        nodeContext: pending.nodeContext,
        originalMessage: message,
        stepSummaries: pending.stepSummaries || [],
      });
    }
    // If neither confirm nor deny, treat as a new request (fall through)
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
      classification = await localClassify(message, getCurrentNodeId(visitorId) || rootId);
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
    const reason = classification.summary || "Idea does not fit this tree.";
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
    // Check if an extension at this position declares a guidedMode
    let guidedMode = "tree:be"; // default fallback
    const currentNodeId = getCurrentNodeId(visitorId) || rootId;
    try {
      const { getExtensionManifest, getLoadedExtensionNames } = await import("../loader.js");
      const nodeDoc = currentNodeId ? await Node.findById(currentNodeId).select("metadata").lean() : null;
      if (nodeDoc) {
        // Check node's extension metadata for a matching extension with guidedMode
        const meta = nodeDoc.metadata instanceof Map ? Object.fromEntries(nodeDoc.metadata) : (nodeDoc.metadata || {});
        for (const extName of getLoadedExtensionNames()) {
          if (meta[extName]?.role || meta[extName]?.initialized) {
            const manifest = getExtensionManifest(extName);
            if (manifest?.provides?.guidedMode) {
              guidedMode = manifest.provides.guidedMode;
              break;
            }
          }
        }
      }
    } catch {}

    log.verbose("Tree Orchestrator", `  BE mode: switching to ${guidedMode}`);
    await switchMode(visitorId, guidedMode, {
      username, userId, rootId,
      conversationMemory: formatMemoryContext(visitorId),
      clearHistory: true,
    });
    const result = await processMessage(visitorId, message, {
      username, userId, rootId, signal,
      socket, sessionId,
    });
    modesUsed.push(guidedMode);

    return {
      success: true,
      answer: result?.content || "",
      modeKey: guidedMode,
      modesUsed,
      rootId,
    };
  }

  // ────────────────────────────────────────────────────────
  // PATH 2: EXTENSION DETECTED — route directly to extension mode
  // One LLM call. No librarian. No navigation. No respond.
  // ────────────────────────────────────────────────────────

  if (classification.intent === "extension" && classification.mode) {
    // Extension modes handle their own AI conversation. No iframe navigation.
    // The extension node is used for mode resolution, not for visual navigation.
    const extTargetId = classification.targetNodeId || null;
    log.verbose("Tree Orchestrator",
      `  Extension route: ${classification.mode}${extTargetId ? ` via ${extTargetId}` : ""} (behavioral: ${behavioral})`);

    modesUsed.push(classification.mode);
    emitStatus(socket, "intent", "");

    // Switch to the extension's mode (use the extension node's rootId context)
    await switchMode(visitorId, classification.mode, {
      username, userId, rootId,
      conversationMemory: formatMemoryContext(visitorId),
      clearHistory: true,
    });

    // One LLM call. readOnly strips write tools for query constraint.
    const result = await processMessage(visitorId, message, {
      username, userId, rootId, signal, slot,
      readOnly: behavioral === "query",
      meta: { internal: false },
      onToolResults(results) {
        if (signal?.aborted) return;
        for (const r of results) socket.emit(WS.TOOL_RESULT, r);
      },
    });

    emitStatus(socket, "done", "");

    // If the extension mode returned JSON (parser modes like fitness-log),
    // don't show raw JSON to the user. Build a human response.
    let answer = result?.answer || null;
    if (answer && /^\s*\{/.test(answer)) {
      try {
        const parsed = JSON.parse(answer);
        // Build a human summary from the parsed data
        if (parsed.exercises) {
          // Fitness parser response
          answer = parsed.exercises.map(ex => {
            const sets = ex.sets?.map(s => s.weight > 0 ? `${s.weight}x${s.reps}` : `${s.reps}`).join("/") || "";
            return `${ex.name}: ${sets}`;
          }).join(", ") + ". Logged.";
        } else if (parsed.items) {
          // Food parser response
          answer = parsed.items.map(i => `${i.name} (${i.calories}cal)`).join(", ") + ". Logged.";
        } else {
          answer = "Done.";
        }
      } catch {
        // Not valid JSON, use as-is
      }
    }

    if (answer) pushMemory(visitorId, message, answer);

    // Apply behavioral constraint to response
    if (behavioral === "place" && answer) {
      return {
        success: true,
        answer: answer.split("\n")[0],
        modeKey: classification.mode,
        modesUsed,
        rootId,
      };
    }

    return {
      success: true,
      answer,
      modeKey: classification.mode,
      modesUsed,
      rootId,
    };
  }

  // ────────────────────────────────────────────────────────
  // PATH 3: LIBRARIAN (place/query) — merged navigate + execute
  // ────────────────────────────────────────────────────────

  if (classification.intent === "place" || classification.intent === "query") {
    return await runLibrarianFlow({
      visitorId,
      message,
      socket,
      signal,
      username,
      userId,
      rootId,
      treeSummary,
      classification,
      modesUsed,
      skipRespond,
      behavioral,
      rt,
    });
  }

  // ────────────────────────────────────────────────────────
  // DESTRUCTIVE PATH — full translate → plan → execute flow
  // ────────────────────────────────────────────────────────

  emitStatus(socket, "intent", "Planning operation…");

  let translation;
  const translatorStart = new Date();
  try {
    translation = await translateDestructive({
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
 log.error("Tree Orchestrator", " Destructive translation failed:", err.message);
    translation = {
      plan: [
        {
          intent: "query",
          targetHint: null,
          directive: message,
          needsNavigation: false,
          isDestructive: false,
        },
      ],
      responseHint: "Respond naturally to the user's message.",
      summary: message,
    };
  }
  const translatorEnd = new Date();

  if (signal?.aborted) return null;

  const responseHint = translation.responseHint || "";
  const plan = translation.plan;

 log.verbose("Tree Orchestrator", 
    `🎯 Destructive plan: ${plan.length} step(s) | "${translation.summary}"`,
  );
  emitModeResult(socket, "intent", {
    plan,
    responseHint,
    summary: translation.summary,
    confidence,
  });

  modesUsed.push("translator");
  rt.trackStep("translator", {
    input: message,
    output: translation,
    startTime: translatorStart,
    endTime: translatorEnd,
    llmProvider: translation.llmProvider || llmProvider,
  });

  // ────────────────────────────────────────────────────────
  // STEP 2+3: EXECUTE PLAN → RESPOND
  // ────────────────────────────────────────────────────────

  const planResult = await executePlanSteps({
    plan,
    visitorId,
    message,
    socket,
    signal,
    username,
    userId,
    rootId,
    modesUsed,
    initialTargetNodeId: rootId,
    initialTargetPath: null,
    stepSummaries: [],
    responseHint,
    includeMemoryOnFirstStep: true,
    rt,
  });

  return await respondToCompletion({
    planResult,
    visitorId, socket, signal, meta, message,
    responseHint, modesUsed, confidence, skipRespond, rt,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY FLOW — dedicated read-only path
// Skips classifier entirely. Librarian gathers context, respond generates answer.
// Two LLM calls instead of three. No plan generation, no discard.
// ─────────────────────────────────────────────────────────────────────────

async function runQueryFlow({
  visitorId,
  message,
  socket,
  signal,
  username,
  userId,
  rootId,
  modesUsed,
  rt,
  slot,
}) {
  const meta = { username, userId, rootId, slot };

  // Fetch tree summary for the librarian
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

      const brief = await getIntelligenceBrief(rootId, userId);
      if (brief) treeSummary += "\n\n" + brief;
    } catch (err) {
      log.error("Tree Orchestrator", "Query: tree summary failed:", err.message);
    }
  }

  if (signal?.aborted) return null;

  // ── LIBRARIAN: navigate and gather context (no plan needed) ──
  emitStatus(socket, "navigate", "Reading tree...");

  const queryLibMode = await resolveModeForNode("librarian", getCurrentNodeId(visitorId) || rootId);
  await switchMode(visitorId, queryLibMode, {
    ...meta,
    treeSummary: treeSummary || "",
    intent: "query",
    clearHistory: true,
    conversationMemory: formatMemoryContext(visitorId),
  });

  const libStart = new Date();
  const libResult = await processMessage(visitorId, message, {
    ...meta,
    signal,
    meta: { internal: true },
  });
  const libEnd = new Date();

  if (signal?.aborted) return null;
  emitModeResult(socket, "tree:librarian", libResult);

  modesUsed.push("tree:librarian");
  rt.trackStep("tree:librarian", {
    input: message,
    output: libResult,
    startTime: libStart,
    endTime: libEnd,
    llmProvider: libResult?._llmProvider || rt.llmProvider,
    treeContext: {
      targetNodeId: rootId,
      directive: "query context gathering",
      stepResult: libResult ? "success" : "failed",
    },
  });

  // ── RESPOND: generate answer from gathered context ──
  const responseHint = libResult?.responseHint || "Respond naturally based on what you found in the tree.";

  modesUsed.push("tree:respond");
  const respondStart = new Date();

  const response = await runRespond({
    visitorId,
    socket,
    signal,
    ...meta,
    nodeContext: null,
    operationContext: null,
    originalMessage: message,
    responseHint,
    librarianContext: libResult,
    stepSummaries: [],
  });

  const respondEnd = new Date();
  rt.trackStep("tree:respond", {
    input: responseHint,
    output: response?.answer || null,
    startTime: respondStart,
    endTime: respondEnd,
    llmProvider: response?.llmProvider || rt.llmProvider,
    treeContext: {
      targetNodeId: rootId,
      directive: responseHint,
      stepResult: "success",
    },
  });

  if (response) {
    response.modesUsed = modesUsed;
    response.confidence = libResult?.confidence || 0.8;
    response.modeKey = "tree:query";
  }

  // Save to conversation memory
  if (response?.answer) {
    pushMemory(visitorId, message, response.answer);
  }

  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// LIBRARIAN FLOW (place or chat — the main path for write operations)
// Librarian navigates tree with navigate-tree tool, returns a plan,
// then executePlanSteps runs the plan through existing modes.
// ─────────────────────────────────────────────────────────────────────────

async function runLibrarianFlow({
  visitorId,
  message,
  socket,
  signal,
  username,
  userId,
  rootId,
  treeSummary,
  classification,
  modesUsed,
  skipRespond = false,
  behavioral = "chat",
  rt,
}) {
  const meta = { username, userId, rootId, slot: rt?.slot };
  const isQuery = classification.intent === "query";

  // ── MERGED LIBRARIAN: navigate + read + execute in one conversation ──
  emitStatus(
    socket,
    "navigate",
    isQuery ? "Reading tree…" : "Working…",
  );

  const libMode = await resolveModeForNode("librarian", getCurrentNodeId(visitorId) || rootId);
  await switchMode(visitorId, libMode, {
    ...meta,
    treeSummary: treeSummary || "",
    intent: classification.intent,
    clearHistory: true,
    conversationMemory: formatMemoryContext(visitorId),
  });

  const libStart = new Date();

  // The merged librarian has execution tools for placement.
  // processMessage with internal:false lets it navigate, execute, AND respond
  // all in one tool-calling loop. No plan handoff.
  const libResult = await processMessage(visitorId, message, {
    ...meta,
    signal,
    meta: { internal: isQuery }, // query: internal (parse JSON). place: external (natural response)
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) socket.emit(WS.TOOL_RESULT, r);
    },
  });
  const libEnd = new Date();

  if (signal?.aborted) return null;

  modesUsed.push("tree:librarian");
  rt.trackStep("tree:librarian", {
    input: message,
    output: libResult?.answer?.slice(0, 500) || null,
    startTime: libStart,
    endTime: libEnd,
    llmProvider: libResult?._internal?.connectionId ? { connectionId: libResult._internal.connectionId } : rt.llmProvider,
    treeContext: {
      targetNodeId: rootId,
      directive: classification.summary,
      stepResult: libResult?.answer ? "success" : "failed",
    },
  });

  emitStatus(socket, "done", "");

  // ── Handle failure ──
  if (!libResult || libResult.action === "error") {
    log.error("Tree Orchestrator", "Librarian failed:", libResult?.reason || "no response");
    if (skipRespond) return { success: false, answer: null, modeKey: "tree:orchestrator", modesUsed, stepSummaries: [] };

    modesUsed.push("tree:respond");
    const response = await runRespond({
      visitorId, socket, signal, ...meta,
      originalMessage: message,
      responseHint: classification.responseHint || "Respond naturally to the user's message.",
      stepSummaries: [],
    });
    if (response) { response.modesUsed = modesUsed; response.confidence = classification.confidence; }
    return response;
  }

  // ── Smart response: check if the librarian's answer is sufficient ──

  const lastContent = libResult?.answer || libResult?.content || "";
  const hasNaturalResponse = lastContent.length > 20 && !/^(Tool |Error:|Failed:|{)/.test(lastContent);

  // For query mode, the librarian returns JSON (internal:true) with responseHint.
  // Always go to respond mode.
  if (isQuery) {
    // Parse the librarian's JSON output for responseHint
    let librarianContext = libResult;
    try {
      const { parseJsonSafe } = await import("../../seed/orchestrators/helpers.js");
      const parsed = parseJsonSafe(lastContent);
      if (parsed?.responseHint) librarianContext = parsed;
    } catch {}

    if (skipRespond) {
      return {
        success: true, answer: null, modeKey: "tree:orchestrator",
        modesUsed, confidence: librarianContext?.confidence || classification.confidence,
        stepSummaries: [],
      };
    }

    modesUsed.push("tree:respond");
    const response = await runRespond({
      visitorId, socket, signal, ...meta,
      originalMessage: message,
      responseHint: librarianContext?.responseHint || "",
      librarianContext,
      stepSummaries: [],
    });
    if (response) {
      response.modesUsed = modesUsed;
      response.confidence = librarianContext?.confidence || classification.confidence;
    }
    if (response?.answer) pushMemory(visitorId, message, response.answer);
    return response;
  }

  // For placement: the merged librarian navigated AND executed in one conversation.
  // Check if its response is user-friendly.

  if (hasNaturalResponse) {
    // Librarian wrote a good response. Use directly. Zero extra calls.
    log.verbose("Tree Orchestrator", "Librarian response sufficient. Skipping respond mode.");
    if (lastContent) pushMemory(visitorId, message, lastContent);
    return {
      success: true,
      answer: behavioral === "place" ? lastContent.split("\n")[0] : lastContent,
      modeKey: "tree:librarian",
      modesUsed,
      rootId,
      confidence: 0.9,
    };
  }

  // Librarian executed but response isn't user-friendly. Fall through to respond.
  if (skipRespond) {
    return { success: true, answer: lastContent || null, modeKey: "tree:orchestrator", modesUsed, stepSummaries: [] };
  }

  modesUsed.push("tree:respond");
  const response = await runRespond({
    visitorId, socket, signal, ...meta,
    originalMessage: message,
    responseHint: "Summarize what was just done. Be brief.",
    stepSummaries: [],
  });
  if (response) { response.modesUsed = modesUsed; response.confidence = 0.8; }
  if (response?.answer) pushMemory(visitorId, message, response.answer);
  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTE PENDING (after confirmation)
// Executes the confirmed destructive step, then resumes remaining plan
// steps using the shared executePlanSteps loop.
// ─────────────────────────────────────────────────────────────────────────

async function executePendingOperation({
  visitorId,
  pending,
  socket,
  signal,
  username,
  userId,
  rootId,
  rt,
  skipRespond = false,
}) {
  const meta = { username, userId, rootId };
  const modesUsed = pending.modesUsed || [];
  const stepSummaries = pending.stepSummaries || [];

  // Restore rt's chainIndex from the pending state
  if (pending.chainIndex) {
    rt.chainIndex = pending.chainIndex;
  }

  emitStatus(socket, "execute", "Executing confirmed operation…");

  const pendingMutationIntents = ["structure", "edit", "notes"];
  const executionMode = pendingMutationIntents.includes(pending.action)
    ? await resolveModeForNode(pending.action, pending.targetNodeId)
    : null;
  if (!executionMode) {
    return await runRespond({
      visitorId,
      socket,
      signal,
      ...meta,
      nodeContext: pending.nodeContext,
      operationContext: "Error: Unknown operation type for confirmation.",
      originalMessage: pending.originalMessage,
    });
  }

  // Extract prestige from context
  let prestige = 0;
  if (pending.nodeContext) {
    try {
      const parsed = JSON.parse(pending.nodeContext);
      prestige = parsed.prestige ?? 0;
    } catch (err) { log.debug("TreeOrch", "Could not parse pending nodeContext for prestige:", err.message); }
  }

  await switchMode(visitorId, executionMode, {
    ...meta,
    targetNodeId: pending.targetNodeId,
    prestige,
    clearHistory: true,
  });

  const executionMessage = buildExecutionMessage(
    pending.directive || pending.originalMessage,
    pending.targetNodeId,
    pending.nodeContext,
    stepSummaries,
  );

  const execStart = new Date();
  const execResult = await processMessage(visitorId, executionMessage, {
    ...meta,
    signal,
    meta: { internal: true },
  });
  const execEnd = new Date();

  if (signal?.aborted) return null;

  emitModeResult(socket, executionMode, execResult);
  modesUsed.push(executionMode);
  rt.trackStep(executionMode, {
    input: pending.directive || pending.originalMessage,
    output: execResult,
    startTime: execStart,
    endTime: execEnd,
    llmProvider: execResult?._llmProvider || rt.llmProvider,
    treeContext: {
      targetNodeId: pending.targetNodeId,
      targetPath: pending.targetPath,
      planStepIndex: pending.stepNum,
      planTotalSteps: null,
      directive: pending.directive,
      stepResult: execResultToStepResult(execResult),
      resultDetail: execResult?.summary || execResult?.reason || null,
    },
  });

  if (pending.action === "structure" && execResult?.operations?.length > 0) {
    socket.emit(WS.TREE_CHANGED, {
      nodeId: pending.targetNodeId,
      changeType: execResult?.action || "modified",
    });
  }

  // Record this step's summary
  stepSummaries.push(
    buildStepSummary({
      stepNum: pending.stepNum || stepSummaries.length + 1,
      intent: pending.action,
      targetPath: pending.targetPath,
      targetNodeId: pending.targetNodeId,
      execResult,
      nodeContext: pending.nodeContext,
    }),
  );

  await resetConversation(visitorId, { username, userId });

  // ── RESUME REMAINING PLAN STEPS (using shared loop) ──
  const remainingPlan = pending.remainingPlan || [];
  const pendingMessage = pending.originalMessage;
  const responseHint = pending.responseHint || "";

  if (remainingPlan.length > 0) {
    const planResult = await executePlanSteps({
      plan: remainingPlan,
      visitorId,
      message: pendingMessage,
      socket,
      signal,
      username,
      userId,
      rootId,
      modesUsed,
      initialTargetNodeId: pending.targetNodeId,
      initialTargetPath: pending.targetPath,
      stepSummaries,
      responseHint,
      includeMemoryOnFirstStep: false,
      rt,
    });

    if (!planResult) return null;

    // Early exits (nested destructive confirmation)
    if (planResult.type === "confirm" || planResult.type === "respond") {
      const r = planResult.response;
      if (r) {
        r.modesUsed = modesUsed;
        r.stepSummaries = stepSummaries;
      }
      return r;
    }
  }

  return await respondToCompletion({
    planResult: { type: "completed", stepSummaries, lastTargetNodeId: pending.targetNodeId, lastTargetPath: pending.targetPath },
    visitorId, socket, signal, meta,
    message: pendingMessage,
    responseHint, modesUsed, skipRespond, rt,
  });
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
function shouldDeferToMemory(classification) {
  if (classification.intent !== "place") return { defer: false };
  const axes = classification.placementAxes;
  if (!axes) return { defer: false };

  // Explicit structural intent — never defer
  if (axes.pathConfidence >= 0.9) return { defer: false };

  // Relational complexity — touches multiple subtrees
  if (axes.relationalComplexity > 0.5) {
    return {
      defer: true,
      reason: "Touches multiple subtrees — needs more context",
    };
  }

  // New domain area — no existing structure to attach to
  if (axes.domainNovelty > 0.5) {
    return {
      defer: true,
      reason: "New area — holding until more context emerges",
    };
  }

  // No clear existing spot
  if (axes.pathConfidence < 0.6) {
    return {
      defer: true,
      reason: "No clear home — holding for better placement",
    };
  }

  return { defer: false };
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a directive execution message for mutation modes.
 */
function buildExecutionMessage(
  userMessage,
  targetNodeId,
  nodeContext,
  stepSummaries = [],
) {
  const parts = [];

  // Include prior step results so the mode can reference created IDs, moved nodes, etc.
  if (stepSummaries.length > 0) {
    const priorOps = stepSummaries
      .filter((s) => s.operations || s.action)
      .map((s) => {
        const ops = s.operations
          ? s.operations
              .map(
                (o) =>
                  `${o.type}: "${o.nodeName}" (${o.nodeId})${o.parentId ? ` under ${o.parentId}` : ""}`,
              )
              .join("; ")
          : `${s.action} on ${s.target}`;
        return `Step ${s.step}: ${ops}`;
      });
    if (priorOps.length > 0) {
      parts.push(`Prior steps (use these IDs):\n${priorOps.join("\n")}`);
    }
  }

  if (nodeContext) parts.push(nodeContext);
  parts.push(`Target: ${targetNodeId}`);
  parts.push(userMessage);
  return parts.join("\n\n");
}

/**
 * Scout loop: when the plan says "create structure" but children already
 * exist that match, explore deeper before committing.
 *
 * Returns { adapted: false } if nothing matches, or:
 * {
 *   adapted: true,
 *   targetNodeId, targetPath, ctxResult,
 *   newIntent, newDirective, reason
 * }
 *
 * Logic:
 * - Extract keywords from the directive
 * - Check if any existing children fuzzy-match those keywords
 * - If a match exists, fetch its context and check deeper
 * - If the matched child already has the planned sub-structure → convert to edit
 * - If the matched child exists but is empty → dive in, keep structure intent
 * - Max 3 levels deep to prevent runaway
 */
async function scoutExistingStructure({
  ctxResult,
  directive,
  targetNodeId,
  profile,
  signal,
  userId = null,
}) {
  const MAX_SCOUT_DEPTH = 3;
  const directiveLower = directive.toLowerCase();

  // Extract likely node names from the directive
  // Look for quoted names or capitalized phrases
  const quotedNames =
    directive.match(/['"]([^'"]+)['"]/g)?.map((s) => s.slice(1, -1)) || [];

  // Only use meaningful words — skip short words and common stop words
  const STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "all",
    "can",
    "had",
    "her",
    "was",
    "one",
    "our",
    "out",
    "has",
    "his",
    "how",
    "its",
    "may",
    "new",
    "now",
    "old",
    "see",
    "way",
    "who",
    "did",
    "get",
    "let",
    "say",
    "she",
    "too",
    "use",
    "from",
    "into",
    "each",
    "make",
    "like",
    "been",
    "have",
    "this",
    "will",
    "with",
    "that",
    "they",
    "them",
    "then",
    "than",
    "some",
    "move",
    "create",
    "delete",
    "under",
    "child",
    "node",
    "branch",
    "already",
    "present",
    "level",
    "named",
    "after",
    "their",
    "contents",
  ]);
  const words = directive
    .split(/\s+/)
    .map((w) => w.replace(/['",.!?()]/g, ""))
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()));

  let currentCtx = ctxResult;
  let currentNodeId = targetNodeId;
  let depth = 0;

  while (depth < MAX_SCOUT_DEPTH && currentCtx.children?.length > 0) {
    if (signal?.aborted) return { adapted: false };

    // Find a child that matches the directive's target
    let match = findMatchingChild(
      currentCtx.children,
      directiveLower,
      quotedNames,
      words,
    );

    // Competence: prefer a competent sibling over a weak or absent name match
    if (!match || !quotedNames.some(q => match.name.toLowerCase() === q.toLowerCase())) {
      try {
        const compExt = (await import("../loader.js")).getExtension("competence");
        if (compExt?.exports?.getCompetence) {
          for (const child of currentCtx.children) {
            if (child === match) continue;
            const comp = await compExt.exports.getCompetence(child.id || child._id);
            if (comp?.strongTopics?.some(t => directiveLower.includes(t.toLowerCase()))) {
              match = child;
              break;
            }
          }
        }
      } catch {}
    }

    if (!match) break;

    // Found a matching child — dive deeper
    depth++;
 log.verbose("Tree Orchestrator", 
      `  🔍 Scout depth ${depth}: found existing "${match.name}" (${match.id})`,
    );

    const deeperCtx = await getContextForAi(match.id, {
      includeChildren: true,
      includeParentChain: true,
      includeValues: false,
      includeNotes: false,
      userId,
    });

    // Decide: does this child already cover what the plan wants to create?
    if (deeperCtx.children?.length > 0) {
      // Child has sub-structure — check if it overlaps with what we'd create
      const subNames = deeperCtx.children.map((c) => c.name.toLowerCase());
      const directiveKeywords = words.map((w) => w.toLowerCase());
      const overlap = directiveKeywords.filter((kw) =>
        subNames.some((sn) => sn.includes(kw) || kw.includes(sn)),
      );

      if (overlap.length >= 2) {
        // Significant overlap — this structure exists, convert to edit
        return {
          adapted: true,
          targetNodeId: match.id,
          targetPath: deeperCtx.path || match.name,
          ctxResult: deeperCtx,
          newIntent: "edit",
          newDirective: `Update existing structure. ${directive}`,
          reason: `"${match.name}" already exists with matching sub-nodes (${overlap.join(", ")}). Converted to edit.`,
        };
      }

      // Has children but no overlap — keep exploring
      currentCtx = deeperCtx;
      currentNodeId = match.id;
      continue;
    }

    // Child exists but is empty — re-target to it so structure builds inside
    return {
      adapted: true,
      targetNodeId: match.id,
      targetPath: deeperCtx.path || match.name,
      ctxResult: deeperCtx,
      newIntent: "structure",
      newDirective: directive,
      reason: `"${match.name}" already exists but is empty. Building inside it instead of creating a duplicate.`,
    };
  }

  return { adapted: false };
}

/**
 * Fuzzy match a child against the directive's target.
 * Checks quoted names first (exact), then keyword overlap.
 */
function findMatchingChild(children, directiveLower, quotedNames, words) {
  // Exact match on quoted names — this is reliable
  for (const qName of quotedNames) {
    const qLower = qName.toLowerCase();
    const match = children.find((c) => c.name.toLowerCase() === qLower);
    if (match) return match;
  }

  // Check if full child name appears literally in directive (e.g., "Life Plan" in directive)
  // Require at least 4 chars to avoid junk matches
  let bestMatch = null;
  let bestScore = 0;

  for (const child of children) {
    const childLower = child.name.toLowerCase();

    if (childLower.length >= 4 && directiveLower.includes(childLower)) {
      const score = childLower.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = child;
      }
      continue;
    }

    // Word overlap: only exact word-to-word matches (no substring games)
    // Both words must be 4+ chars to count
    const childWords = childLower.split(/\s+/).filter((w) => w.length >= 4);
    const filteredWords = words
      .filter((w) => w.length >= 4)
      .map((w) => w.toLowerCase());

    const overlap = childWords.filter((cw) =>
      filteredWords.some((fw) => fw === cw),
    );
    const score =
      childWords.length > 0 ? overlap.length / childWords.length : 0;
    if (score > 0.5 && overlap.length >= 1 && score > bestScore) {
      bestScore = score;
      bestMatch = child;
    }
  }

  return bestMatch;
}

/**
 * For move/reparent directives, find ALL nodes referenced in the directive
 * that we DIDN'T navigate to. Returns their contexts with children and IDs.
 *
 * "Move 'Backend' to 'JavaScript Project'" — if nav found Backend,
 * this returns JavaScript Project's context (and vice versa).
 *
 * Returns array of contexts, each with { id, name, children, path, ... }
 */
async function fetchMoveCounterparts(directive, navigatedNodeId, rootId, userId = null) {
  // Extract ALL quoted node names from the directive
  const quotedNames =
    directive.match(/['"]([^'"]+)['"]/g)?.map((s) => s.slice(1, -1)) || [];

  // Also extract unquoted names from common move patterns
  const movePatterns = [
    /\bmove\s+(?:node\s+)?['"]?([^'",.]+?)['"]?\s+(?:to|under|into)\b/i,
    /\b(?:to|under|into)\s+(?:be\s+)?(?:a\s+)?(?:child\s+of\s+)?['"]?([^'",.]+?)['"]?\.?\s*$/i,
    /\bof\s+['"]?([^'",.]+?)['"]?\s/i,
    /\bfrom\s+['"]?([^'",.]+?)['"]?\s/i,
  ];

  const candidates = new Set(quotedNames);
  for (const pattern of movePatterns) {
    const match = directive.match(pattern);
    if (match?.[1]) {
      candidates.add(match[1].trim());
    }
  }

  if (candidates.size === 0) return [];

  const searchRoot = rootId || navigatedNodeId;
  const results = [];
  const seenIds = new Set([navigatedNodeId]);

  for (const name of candidates) {
    try {
      const navCtx = await getNavigationContext(searchRoot, { search: name });
      if (!navCtx?.searchResults?.length) continue;

      // Fetch context for ALL matches that aren't the navigated node
      for (const match of navCtx.searchResults) {
        if (seenIds.has(match.id)) continue;
        seenIds.add(match.id);

        const ctx = await getContextForAi(match.id, {
          includeChildren: true,
          includeParentChain: true,
          includeValues: false,
          includeNotes: false,
          userId,
        });
        results.push(ctx);
      }
    } catch (err) {
 log.error("Tree Orchestrator", 
        `⚠️ Move counterpart lookup failed for "${name}":`,
        err.message,
      );
    }
  }

  return results;
}
