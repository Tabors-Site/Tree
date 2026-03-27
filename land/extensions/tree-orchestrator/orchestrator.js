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
} from "../../seed/ws/conversation.js";
import { classify, translateDestructive } from "./translator.js";
import { getLandConfigValue } from "../../seed/landConfig.js";

/**
 * Local intent classification. Zero LLM calls.
 * The user already classified by typing the command (chat/place/query/fitness/etc).
 * This catches the remaining cases within chat where the AI needs a hint.
 * Wrong classification doesn't break anything because the AI has all tools.
 */
function localClassify(message) {
  const lower = message.toLowerCase().trim();

  // Conversational: skip librarian, go straight to respond
  if (/^(hey|hi|hello|thanks|ok|sure|yep|yeah|what's up|sup|yo|nice|cool|got it|good)\b/i.test(lower))
    return { intent: "query", confidence: 0.9, summary: message.slice(0, 100), responseHint: "" };

  // Questions: read-only query flow
  if (/^(what|how|why|when|where|who|is |are |does |do |can |show |tell |list )/.test(lower))
    return { intent: "query", confidence: 0.8, summary: message.slice(0, 100), responseHint: "" };

  // Destructive: needs LLM translation for safety
  if (/\b(delete|remove|move|merge|reorganize|clean up|mark .* completed?)\b/.test(lower))
    return { intent: "destructive", confidence: 0.7, summary: message.slice(0, 100), responseHint: "" };

  // Everything else: placement
  return { intent: "place", confidence: 0.6, summary: message.slice(0, 100), responseHint: "" };
}
import { setChatContext } from "../../seed/ws/chatTracker.js";
import { isActiveNavigator } from "../../seed/ws/sessionRegistry.js";

import {
  getContextForAi,
  getNavigationContext,
  buildDeepTreeSummary,
} from "../../seed/tree/treeFetch.js";
import mongoose from "mongoose";
import Node from "../../seed/models/node.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";
import { resolveMode } from "../../seed/ws/modes/registry.js";

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
const MAX_MEMORY_TURNS = 6; // 3 exchanges (user + assistant each)

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

        // Only navigate if this session controls the iframe
        if (isActiveNavigator(userId, rt.sessionId)) {
          socket.emit(WS.NAVIGATE, {
            url: `/api/v1/node/${targetNodeId}?html`,
            replace: false,
          });
        }
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
          includeValues: false,
          includeNotes: false,
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
      classification = localClassify(message);
    }
  } else {
    // Default: local classification. Zero LLM calls.
    classification = localClassify(message);
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

  // Explicit user defer → force defer
  if (classification.intent === "defer") {
    classification.intent = "place"; // treat as place for the defer path
    classification.placementAxes = null;
  }

  const deferDecision = classification.intent === "place" && !classification.placementAxes
      ? { defer: true, reason: "User explicitly requested deferral" }
      : shouldDeferToMemory(classification);
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
  // ROUTE: LIBRARIAN (place/query) or DESTRUCTIVE (delete/move/merge)
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
  rt,
}) {
  const meta = { username, userId, rootId };
  const isQuery = classification.intent === "query";

  // ── LIBRARIAN: navigate + decide ──
  emitStatus(
    socket,
    "navigate",
    isQuery ? "Reading tree…" : "Walking the tree…",
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
  const libPlan = await processMessage(visitorId, message, {
    ...meta,
    signal,
    meta: { internal: true },
  });
  const libEnd = new Date();

  if (signal?.aborted) return null;
  emitModeResult(socket, "tree:librarian", libPlan);

  // libPlan = { plan: [...], responseHint, summary, confidence }
  // Same format as translator output → feeds directly into plan execution

  // Handle librarian failure — fall back to simple response
  if (
    !libPlan ||
    libPlan.action === "error" ||
    (!libPlan.plan && !libPlan.responseHint)
  ) {
 log.error("Tree Orchestrator", 
      "❌ Librarian failed:",
      libPlan?.reason || libPlan?.raw || "no response",
    );

    modesUsed.push("tree:librarian");
    rt.trackStep("tree:librarian", {
      input: message,
      output: libPlan,
      startTime: libStart,
      endTime: libEnd,
      llmProvider: libPlan?._llmProvider || rt.llmProvider,
      treeContext: {
        targetNodeId: rootId,
        directive: classification.summary,
        stepResult: "failed",
      },
    });

    // Fall back to responding with what we have
    if (skipRespond) {
      return {
        success: false,
        answer: null,
        modeKey: "tree:orchestrator",
        modesUsed,
        stepSummaries: [],
      };
    }
    modesUsed.push("tree:respond");
    const response = await runRespond({
      visitorId,
      socket,
      signal,
      ...meta,
      nodeContext: null,
      operationContext: null,
      originalMessage: message,
      responseHint:
        classification.responseHint ||
        "Respond naturally to the user's message.",
      stepSummaries: [],
    });

    if (response) {
      response.modesUsed = modesUsed;
      response.confidence = classification.confidence;
    }
    return response;
  }

  modesUsed.push("tree:librarian");
  rt.trackStep("tree:librarian", {
    input: message,
    output: libPlan,
    startTime: libStart,
    endTime: libEnd,
    llmProvider: libPlan?._llmProvider || rt.llmProvider,
    treeContext: {
      targetNodeId: rootId,
      directive: classification.summary,
      stepResult: libPlan?.plan ? "success" : "failed",
    },
  });

  const plan = libPlan?.plan || [];
  const responseHint =
    libPlan?.responseHint || classification.responseHint || "";

 log.verbose("Tree Orchestrator", 
    `📚 Librarian: ${plan.length} step(s) | "${libPlan?.summary || "no summary"}"`,
  );

  // ── QUERY: empty plan → skip execution, go to respond ──
  if (plan.length === 0) {
    if (skipRespond) {
      return {
        success: true,
        answer: null,
        modeKey: "tree:orchestrator",
        modesUsed,
        confidence: libPlan?.confidence || classification.confidence,
        stepSummaries: [],
      };
    }
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
      librarianContext: libPlan,
      stepSummaries: [],
    });

    const respondEnd = new Date();
    rt.trackStep("tree:respond", {
      input: responseHint || "Respond to the user",
      output: response?.answer || null,
      startTime: respondStart,
      endTime: respondEnd,
      llmProvider: response?.llmProvider || rt.llmProvider,
      treeContext: {
        targetNodeId: rootId,
        directive: responseHint || "Respond to the user",
        stepResult: "success",
      },
    });

    if (response) {
      response.modesUsed = modesUsed;
      response.confidence = libPlan?.confidence || classification.confidence;
    }
    return response;
  }

  // ── EXECUTE PLAN (reuse shared step loop) ──
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
    includeMemoryOnFirstStep: false, // librarian already had context
    rt,
  });

  return await respondToCompletion({
    planResult,
    visitorId, socket, signal, meta, message,
    responseHint, modesUsed,
    confidence: libPlan?.confidence || classification.confidence,
    skipRespond, rt,
    librarianContext: libPlan,
  });
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
 * Decide whether a "place" classification should be deferred to short-term
 * memory instead of placed immediately. Based on the classifier's placement
 * axes: pathConfidence, domainNovelty, relationalComplexity.
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
    const match = findMatchingChild(
      currentCtx.children,
      directiveLower,
      quotedNames,
      words,
    );
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
