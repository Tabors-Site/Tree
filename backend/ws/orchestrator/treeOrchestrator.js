// ws/orchestrator/treeOrchestrator.js
// Orchestrates tree requests: classify → librarian (place/query) or destructive flow
// Librarian: navigates, reads, places — behind the scenes
// Destructive: translate → navigate → confirm → execute (existing flow)

import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
  resetConversation,
  getClientForUser,
  resolveRootLlmForMode,
} from "../conversation.js";
import { classify, translateDestructive } from "./translator.js";
import { trackChainStep, setAiContributionContext } from "../aiChatTracker.js";
import { isActiveNavigator } from "../sessionRegistry.js";

import { getContextForAi, getNavigationContext, buildDeepTreeSummary } from "../../core/treeFetch.js";
import Node from "../../db/models/node.js";
import ShortMemory from "../../db/models/shortMemory.js";
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
      } catch {}
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
      typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized, null, 2),
    timestamp: Date.now(),
  });
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
 *   { type: "completed", stepSummaries, lastTargetNodeId, lastTargetPath, chainIndex }
 *   { type: "confirm", response, chainIndex }  — destructive step paused for confirmation
 *   { type: "respond", response, chainIndex }   — early exit (ambiguity, not found)
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
  sessionId,
  modesUsed,
  chainIndex,
  initialTargetNodeId,
  initialTargetPath,
  stepSummaries,
  responseHint,
  includeMemoryOnFirstStep,
  llmProvider,
  rootChatId,
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
    trackChainStep({
      userId,
      sessionId,
      rootChatId,
      chainIndex: chainIndex++,
      modeKey: `tree:orchestrator:plan:${stepNum}`,
      input: `Step ${stepNum}: ${op.intent}${op.targetHint ? ` → ${op.targetHint}` : ""}\n${op.directive}`,
      llmProvider,
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

    console.log(
      `  📋 Step ${stepNum}: ${intent.intent} → ${intent.targetHint || "(current)"}`,
    );

    // ══════════════════════════════════════════════════════
    // A) NAVIGATE — establish position
    // ══════════════════════════════════════════════════════

    let targetNodeId = op.targetNodeId || lastTargetNodeId;
    let targetPath = lastTargetPath;

    // If librarian already provided a targetNodeId, skip navigation
    if (op.targetNodeId && !op.needsNavigation) {
      console.log(`  📍 Librarian provided ID: ${op.targetNodeId}`);
      targetNodeId = op.targetNodeId;
    } else if (intent.targetHint) {
      // ── LLM NAVIGATION — search for a specific node ──
      emitStatus(
        socket,
        "navigate",
        isOnlyStep ? "Finding node…" : `Step ${stepNum}: Finding node…`,
      );

      switchMode(visitorId, "tree:navigate", {
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
      trackChainStep({
        userId,
        sessionId,
        rootChatId,
        chainIndex: chainIndex++,
        modeKey: "tree:navigate",
        input: navDirective,
        output: navResult,
        startTime: navStart,
        endTime: navEnd,
        llmProvider: navResult?._llmProvider || llmProvider,
        treeContext: {
          targetNodeId:
            navResult?.action === "found"
              ? navResult.targetNodeId
              : lastTargetNodeId,
          targetPath:
            navResult?.action === "found"
              ? navResult.targetPath
              : lastTargetPath,
          planStepIndex: stepNum,
          planTotalSteps: plan.length,
          directive: navDirective,
          stepResult:
            navResult?.action === "found"
              ? "success"
              : navResult?.action === "ambiguous"
                ? "pending"
                : "failed",
          resultDetail: navResult?.reason || navResult?.summary || null,
        },
      });

      if (navResult?.action === "found") {
        targetNodeId = navResult.targetNodeId;
        targetPath = navResult.targetPath;

        // Only navigate if this session controls the iframe
        if (isActiveNavigator(userId, sessionId)) {
          socket.emit("navigate", {
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
          console.log(
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
              });
              candidateContexts.push(ctx);
            } catch (err) {
              console.error(
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

          console.log(
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
          return { type: "respond", response, chainIndex };
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
          return { type: "respond", response, chainIndex };
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
          resetConversation(visitorId, { username, userId });
          continue;
        }
      }
    } else {
      // ── NO TARGET — operate on current position (root or last step's target) ──
      targetNodeId = lastTargetNodeId || getCurrentNodeId(visitorId) || rootId;
      targetPath = lastTargetPath || null;
      console.log(
        `  📍 Using current position: ${targetPath || targetNodeId}`,
      );
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
          chainIndex,
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
      resetConversation(visitorId, { username, userId });
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
      ctxResult = await getContextForAi(targetNodeId, profile);

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
        });

        if (scoutResult.adapted) {
          targetNodeId = scoutResult.targetNodeId;
          targetPath = scoutResult.targetPath || targetPath;
          ctxResult = scoutResult.ctxResult;
          intent.intent = scoutResult.newIntent;
          intent.directive = scoutResult.newDirective || intent.directive;

          console.log(
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
            });
            childContexts.push(childCtx);
          } catch (err) {
            console.error(
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
          console.log(
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
        );
        if (counterparts.length > 0) {
          const combined = {
            navigatedNode: ctxResult,
            referencedNodes: counterparts,
          };
          nodeContext = JSON.stringify(combined, null, 2);
          console.log(
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
        console.log(
          `  🔀 Injected ${mc.candidates.length} merge candidates into context`,
        );
      }

      emitModeResult(socket, "tree:getContext", ctxResult);

      const ctxEnd = new Date();
      trackChainStep({
        userId,
        sessionId,
        rootChatId,
        chainIndex: chainIndex++,
        modeKey: "tree:getContext",
        input: `getContextForAi(${targetNodeId}, ${intent.intent})`,
        output: ctxResult,
        startTime: ctxStart,
        endTime: ctxEnd,
        llmProvider,
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
        sessionId,
        modesUsed: [...modesUsed],
        chainIndex,
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
      return { type: "confirm", response, chainIndex };
    }

    // ══════════════════════════════════════════════════════
    // E) EXECUTE MUTATION
    // ══════════════════════════════════════════════════════

    const mutationModes = {
      structure: "tree:structure",
      edit: "tree:edit",
      notes: "tree:notes",
    };

    const executionMode = mutationModes[intent.intent];
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
        } catch {}
      }

      switchMode(visitorId, executionMode, {
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
      trackChainStep({
        userId,
        sessionId,
        rootChatId,
        chainIndex: chainIndex++,
        modeKey: executionMode,
        input: intent.directive,
        output: execResult,
        startTime: execStart,
        endTime: execEnd,
        llmProvider: execResult?._llmProvider || llmProvider,
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
        socket.emit("treeChanged", {
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
      console.log(
        `  ❌ Step ${stepNum} FAILED: ${stepSummary.detail || "unknown"}`,
      );
    } else {
      console.log(
        `  ✅ Step ${stepNum} summary: ${stepSummary.detail || stepSummary.action || intent.intent}`,
      );
    }

    // Reset conversation — next step starts fresh
    resetConversation(visitorId, { username, userId });

    // Carry forward position
    lastTargetNodeId = targetNodeId;
    lastTargetPath = targetPath;
  }

  return {
    type: "completed",
    stepSummaries,
    lastTargetNodeId,
    lastTargetPath,
    chainIndex,
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

  // Resolve base llmProvider for tracking (processMessage auto-resolves per-mode)
  let llmProvider = { isCustom: false, model: null, connectionId: null };
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, "tree:librarian");
    const clientInfo = await getClientForUser(userId, slot, modeConnectionId);
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch (e) { /* use default */ }

  // Ensure AI contribution context is set so MCP tool calls get aiChatId/sessionId
  if (rootChatId) {
    setAiContributionContext(visitorId, sessionId, rootChatId);
  }

  const meta = { username, userId, rootId, slot, llmProvider };
  const modesUsed = []; // Track full chain for AIChat
  let chainIndex = 1; // 0 = user message (created in websocket.js)

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
        rootChatId,
        skipRespond,
      });
    } else if (isDenial(message)) {
      const remaining = pending.remainingPlan?.length || 0;
      const cancelContext =
        remaining > 0
          ? `User cancelled the destructive operation. ${remaining} remaining plan step(s) were also abandoned.`
          : "User cancelled the operation.";

      if (skipRespond) {
        return { success: true, answer: null, modeKey: "tree:orchestrator", stepSummaries: pending.stepSummaries || [] };
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
      treeSummary = await buildDeepTreeSummary(rootId, { includeEncodings: true });
      console.log("📋 treeSummary for librarian:\n", treeSummary);
    } catch (err) {
      console.error("⚠️ Pre-fetch tree summary failed:", err.message);
    }
  }

  let classification;
  const classifyStart = new Date();
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
      throw new Error("No LLM connection configured. Set one up at /setup or assign one to this tree.");
    }
    console.error("❌ Classification failed:", err.message);
    classification = {
      intent: "query",
      confidence: 0.5,
      responseHint: "Respond naturally to the user's message.",
      summary: message,
    };
  }
  const classifyEnd = new Date();

  if (signal?.aborted) return null;

  // ────────────────────────────────────────────────────────
  // FORCE QUERY ONLY — override intent for read-only mode
  // ────────────────────────────────────────────────────────

  if (forceQueryOnly && classification.intent !== "no_fit") {
    classification.intent = "query";
    console.log("🔒 Forced query-only mode (no tree edits)");
  }

  const confidence = classification.confidence ?? 0.5;

  console.log(
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
  trackChainStep({
    userId,
    sessionId,
    rootChatId,
    chainIndex: chainIndex++,
    modeKey: "classifier",
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
    console.log(`🚫 No fit: ${reason}`);

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

  const deferDecision = forceQueryOnly ? { defer: false }
    : classification.intent === "place" && !classification.placementAxes
    ? { defer: true, reason: "User explicitly requested deferral" }
    : shouldDeferToMemory(classification);
  if (deferDecision.defer) {
    console.log(`📝 Deferred to short memory: ${deferDecision.reason}`);

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

    trackChainStep({
      userId,
      sessionId,
      rootChatId,
      chainIndex: chainIndex++,
      modeKey: "short-memory:defer",
      input: message,
      output: { deferReason: deferDecision.reason, memoryItemId: memoryItem._id },
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
        responseHint: classification.responseHint || "Acknowledge the idea naturally. Do not mention deferral, memory, or holding.",
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
      sessionId,
      treeSummary,
      classification,
      modesUsed,
      chainIndex,
      skipRespond,
      forceQueryOnly,
      llmProvider,
      rootChatId,
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
    console.error("❌ Destructive translation failed:", err.message);
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

  console.log(
    `🎯 Destructive plan: ${plan.length} step(s) | "${translation.summary}"`,
  );
  emitModeResult(socket, "intent", {
    plan,
    responseHint,
    summary: translation.summary,
    confidence,
  });

  modesUsed.push("translator");
  trackChainStep({
    userId,
    sessionId,
    rootChatId,
    chainIndex: chainIndex++,
    modeKey: "translator",
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
    sessionId,
    modesUsed,
    chainIndex,
    initialTargetNodeId: rootId,
    initialTargetPath: null,
    stepSummaries: [],
    responseHint,
    includeMemoryOnFirstStep: true,
    llmProvider,
    rootChatId,
  });

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

  // Navigate-only shortcut
  if (planResult.navigateOnly) return planResult.navigateOnly;

  // Normal completion — respond with accumulated results
  const { stepSummaries, lastTargetNodeId, lastTargetPath } = planResult;
  chainIndex = planResult.chainIndex;

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
    ? `${responseHint ? responseHint + " " : ""}IMPORTANT: Some operations failed. Report what succeeded and what failed honestly. Do NOT claim success for failed operations.`
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
    stepSummaries,
  });

  const respondEnd = new Date();

  trackChainStep({
    userId,
    sessionId,
    rootChatId,
    chainIndex: chainIndex++,
    modeKey: "tree:respond",
    input: responseHint || "Respond to the user",
    output: response?.answer || null,
    startTime: respondStart,
    endTime: respondEnd,
    llmProvider: response?.llmProvider || llmProvider,
    treeContext: {
      targetNodeId: lastTargetNodeId,
      targetPath: lastTargetPath,
      planStepIndex: plan.length,
      planTotalSteps: plan.length,
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
// LIBRARIAN FLOW (place or query — the main path)
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
  sessionId,
  treeSummary,
  classification,
  modesUsed,
  chainIndex,
  skipRespond = false,
  forceQueryOnly = false,
  llmProvider,
  rootChatId,
}) {
  const meta = { username, userId, rootId };
  const isQuery = classification.intent === "query";

  // ── LIBRARIAN: navigate + decide ──
  emitStatus(
    socket,
    "navigate",
    isQuery ? "Reading tree…" : "Walking the tree…",
  );

  switchMode(visitorId, "tree:librarian", {
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
  if (!libPlan || libPlan.action === "error" || (!libPlan.plan && !libPlan.responseHint)) {
    console.error("❌ Librarian failed:", libPlan?.reason || libPlan?.raw || "no response");

    modesUsed.push("tree:librarian");
    trackChainStep({
      userId,
      sessionId,
      rootChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:librarian",
      input: message,
      output: libPlan,
      startTime: libStart,
      endTime: libEnd,
      llmProvider: libPlan?._llmProvider || llmProvider,
      treeContext: {
        targetNodeId: rootId,
        directive: classification.summary,
        stepResult: "failed",
      },
    });

    // Fall back to responding with what we have
    if (skipRespond) {
      return { success: false, answer: null, modeKey: "tree:orchestrator", modesUsed, stepSummaries: [] };
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
      responseHint: classification.responseHint || "Respond naturally to the user's message.",
      stepSummaries: [],
    });

    if (response) {
      response.modesUsed = modesUsed;
      response.confidence = classification.confidence;
    }
    return response;
  }

  modesUsed.push("tree:librarian");
  trackChainStep({
    userId,
    sessionId,
    rootChatId,
    chainIndex: chainIndex++,
    modeKey: "tree:librarian",
    input: message,
    output: libPlan,
    startTime: libStart,
    endTime: libEnd,
    llmProvider: libPlan?._llmProvider || llmProvider,
    treeContext: {
      targetNodeId: rootId,
      directive: classification.summary,
      stepResult: libPlan?.plan ? "success" : "failed",
    },
  });

  var plan = libPlan?.plan || [];
  const responseHint = libPlan?.responseHint || classification.responseHint || "";

  // Force empty plan in query-only mode — no edits regardless of librarian output
  if (forceQueryOnly && plan.length > 0) {
    console.log(`🔒 Query-only: discarding ${plan.length} librarian step(s)`);
    plan = [];
  }

  console.log(
    `📚 Librarian: ${plan.length} step(s) | "${libPlan?.summary || "no summary"}"`,
  );

  // ── QUERY: empty plan → skip execution, go to respond ──
  if (plan.length === 0) {
    if (skipRespond) {
      return {
        success: true, answer: null, modeKey: "tree:orchestrator",
        modesUsed, confidence: libPlan?.confidence || classification.confidence,
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
    trackChainStep({
      userId,
      sessionId,
      rootChatId,
      chainIndex: chainIndex++,
      modeKey: "tree:respond",
      input: responseHint || "Respond to the user",
      output: response?.answer || null,
      startTime: respondStart,
      endTime: respondEnd,
      llmProvider: response?.llmProvider || llmProvider,
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
    sessionId,
    modesUsed,
    chainIndex,
    initialTargetNodeId: rootId,
    initialTargetPath: null,
    stepSummaries: [],
    responseHint,
    includeMemoryOnFirstStep: false, // librarian already had context
    llmProvider,
    rootChatId,
  });

  if (!planResult) return null;

  // Early exits (shouldn't happen for librarian since isDestructive=false, but handle gracefully)
  if (planResult.type === "confirm" || planResult.type === "respond") {
    const r = planResult.response;
    if (r) {
      r.modesUsed = modesUsed;
      r.confidence = libPlan?.confidence || classification.confidence;
    }
    return r;
  }

  if (planResult.navigateOnly) return planResult.navigateOnly;

  // ── RESPOND ──
  const { stepSummaries, lastTargetNodeId, lastTargetPath } = planResult;
  chainIndex = planResult.chainIndex;

  const anyFailed = stepSummaries.some((s) => s.failed || s.skipped);

  if (skipRespond) {
    return {
      success: !anyFailed,
      answer: null,
      modeKey: "tree:orchestrator",
      modesUsed,
      confidence: libPlan?.confidence || classification.confidence,
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
    librarianContext: libPlan,
    stepSummaries,
  });

  const respondEnd = new Date();
  trackChainStep({
    userId,
    sessionId,
    rootChatId,
    chainIndex: chainIndex++,
    modeKey: "tree:respond",
    input: responseHint || "Respond to the user",
    output: response?.answer || null,
    startTime: respondStart,
    endTime: respondEnd,
    llmProvider: response?.llmProvider || llmProvider,
    treeContext: {
      targetNodeId: lastTargetNodeId,
      targetPath: lastTargetPath,
      directive: responseHint || "Respond to the user",
      stepResult: anyFailed ? "failed" : "success",
    },
  });

  if (response) {
    response.modesUsed = modesUsed;
    response.confidence = libPlan?.confidence || classification.confidence;
    response.stepSummaries = stepSummaries;
  }
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
  llmProvider,
  rootChatId,
  skipRespond = false,
}) {
  const meta = { username, userId, rootId };
  const modesUsed = pending.modesUsed || [];
  const stepSummaries = pending.stepSummaries || [];
  let chainIndex = pending.chainIndex || 1;
  const sessionId = pending.sessionId;

  emitStatus(socket, "execute", "Executing confirmed operation…");

  const mutationModes = {
    structure: "tree:structure",
    edit: "tree:edit",
    notes: "tree:notes",
  };

  const executionMode = mutationModes[pending.action];
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
    } catch {}
  }

  switchMode(visitorId, executionMode, {
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
  trackChainStep({
    userId,
    sessionId,
    rootChatId,
    chainIndex: chainIndex++,
    modeKey: executionMode,
    input: pending.directive || pending.originalMessage,
    output: execResult,
    startTime: execStart,
    endTime: execEnd,
    llmProvider: execResult?._llmProvider || llmProvider,
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
    socket.emit("treeChanged", {
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

  resetConversation(visitorId, { username, userId });

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
      sessionId,
      modesUsed,
      chainIndex,
      initialTargetNodeId: pending.targetNodeId,
      initialTargetPath: pending.targetPath,
      stepSummaries,
      responseHint,
      includeMemoryOnFirstStep: false,
      rootChatId,
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

    chainIndex = planResult.chainIndex;
  }

  // ── RESPOND ──
  if (skipRespond) {
    const anyFailed = stepSummaries.some((s) => s.failed || s.skipped);
    return { success: !anyFailed, answer: null, modeKey: "tree:orchestrator", modesUsed, stepSummaries };
  }

  modesUsed.push("tree:respond");

  const response = await runRespond({
    visitorId,
    socket,
    signal,
    ...meta,
    nodeContext: null,
    operationContext: JSON.stringify(stepSummaries, null, 2),
    originalMessage: pendingMessage,
    responseHint,
    stepSummaries,
  });

  if (response) {
    response.modesUsed = modesUsed;
    response.stepSummaries = stepSummaries;
  }
  return response;
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

  switchMode(visitorId, "tree:respond", {
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
        socket.emit("toolResult", r);
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
    return { defer: true, reason: "Touches multiple subtrees — needs more context" };
  }

  // New domain area — no existing structure to attach to
  if (axes.domainNovelty > 0.5) {
    return { defer: true, reason: "New area — holding until more context emerges" };
  }

  // No clear existing spot
  if (axes.pathConfidence < 0.6) {
    return { defer: true, reason: "No clear home — holding for better placement" };
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
    console.log(
      `  🔍 Scout depth ${depth}: found existing "${match.name}" (${match.id})`,
    );

    const deeperCtx = await getContextForAi(match.id, {
      includeChildren: true,
      includeParentChain: true,
      includeValues: false,
      includeNotes: false,
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
async function fetchMoveCounterparts(directive, navigatedNodeId, rootId) {
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
        });
        results.push(ctx);
      }
    } catch (err) {
      console.error(
        `⚠️ Move counterpart lookup failed for "${name}":`,
        err.message,
      );
    }
  }

  return results;
}
