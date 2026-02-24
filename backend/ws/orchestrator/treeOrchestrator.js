// ws/orchestrator/treeOrchestrator.js
// Orchestrates tree requests: translator → navigate → getContext → execute → respond
// Each plan step: navigate (establish position) → context → execute → summarize → reset

import {
  switchMode,
  processMessage,
  getRootId,
  getCurrentNodeId,
  resetConversation,
} from "../conversation.js";
import { translate } from "./translator.js";
import { trackChainStep } from "../aiChatTracker.js";

import { getContextForAi, getNavigationContext } from "../../core/treeFetch.js";
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
  socket.emit("orchestratorStep", {
    modeKey,
    result:
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
    timestamp: Date.now(),
  });
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
}) {
  if (signal?.aborted) return null;

  const rootId = rootIdParam ?? getRootId(visitorId);
  const meta = { username, userId, rootId };
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
      });
    } else if (isDenial(message)) {
      const remaining = pending.remainingPlan?.length || 0;
      const cancelContext =
        remaining > 0
          ? `User cancelled the destructive operation. ${remaining} remaining plan step(s) were also abandoned.`
          : "User cancelled the operation.";

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
  // STEP 1: TRANSLATE (natural language → tree operations)
  // ────────────────────────────────────────────────────────

  emitStatus(socket, "intent", "Understanding request…");

  // Pre-fetch full tree shape so translator can see what exists at every level
  let treeSummary = null;
  if (rootId) {
    try {
      treeSummary = await buildDeepTreeSummary(rootId);
    } catch (err) {
      console.error("⚠️ Pre-fetch tree summary failed:", err.message);
    }
  }

  let translation;
  const translatorStart = new Date();
  try {
    translation = await translate({
      message,
      userId,
      conversationMemory: formatMemoryContext(visitorId),
      treeSummary,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return null;
    console.error("❌ Translation failed:", err.message);
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
  const confidence = translation.confidence ?? 0.5;

  console.log(
    `🎯 Translated: ${plan.length} step(s) | confidence: ${confidence} | "${translation.summary}"`,
  );
  emitModeResult(socket, "intent", {
    plan,
    responseHint,
    summary: translation.summary,
    confidence,
  });

  // Track translation step
  modesUsed.push("translator");
  trackChainStep({
    userId,
    sessionId,
    chainIndex: chainIndex++,
    modeKey: "translator",
    input: message,
    output: translation,
    startTime: translatorStart,
    endTime: translatorEnd,
  });

  // ────────────────────────────────────────────────────────
  // NO_FIT CHECK — tree rejects this idea
  // ────────────────────────────────────────────────────────

  if (plan.length === 1 && plan[0].intent === "no_fit") {
    const reason = plan[0].directive || "Idea does not fit this tree.";
    console.log(`🚫 No fit: ${reason}`);

    emitStatus(socket, "done", "");

    return {
      success: false,
      noFit: true,
      confidence,
      reason,
      summary: translation.summary,
      modeKey: "translator",
      rootId,
      modesUsed,
    };
  }

  // ────────────────────────────────────────────────────────
  // STEP 2: EXECUTE PLAN
  // Each step: navigate → context → execute → summarize → reset
  // ────────────────────────────────────────────────────────

  const stepSummaries = []; // Accumulated summaries — the state thread between steps
  let lastTargetNodeId = rootId;
  let lastTargetPath = null;

  for (let i = 0; i < plan.length; i++) {
    if (signal?.aborted) {
      // Store partial progress in memory
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
    const stepNum = i + 1;
    const isOnlyStep = plan.length === 1;

    // Emit plan step marker
    trackChainStep({
      userId,
      sessionId,
      chainIndex: chainIndex++,
      modeKey: `tree:orchestrator:plan:${stepNum}`,
      input: `Step ${stepNum}/${plan.length}: ${op.intent}${op.targetHint ? ` → ${op.targetHint}` : ""}\n${op.directive}`,
      treeContext: {
        targetNodeId: lastTargetNodeId,
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
      `  📋 Step ${stepNum}/${plan.length}: ${intent.intent} → ${intent.targetHint || "(current)"}`,
    );

    // ══════════════════════════════════════════════════════
    // A) NAVIGATE — always first, establishes position
    // ══════════════════════════════════════════════════════

    let targetNodeId = lastTargetNodeId;
    let targetPath = lastTargetPath;

    if (intent.targetHint) {
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
      const memCtx = i === 0 ? formatMemoryContext(visitorId) : "";
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
        chainIndex: chainIndex++,
        modeKey: "tree:navigate",
        input: navDirective,
        output: navResult,
        startTime: navStart,
        endTime: navEnd,
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

        socket.emit("navigate", {
          url: `/api/v1/node/${targetNodeId}?html`,
          replace: false,
        });
      } else if (navResult?.action === "ambiguous") {
        // For merge/dedup/duplicate operations, ambiguity is EXPECTED.
        // Collect all candidates and continue with the parent as target.
        const isBatchOp =
          /\b(merge|dedup|duplicat|redundan|consolidat|delet|remov|clean\s*up|all|both|every|each)\b/i.test(
            intent.directive || message,
          );

        if (isBatchOp && navResult.candidates?.length > 0) {
          console.log(
            `  🔀 Merge operation — collecting ${navResult.candidates.length} ambiguous candidates`,
          );

          // Fetch context for all candidates
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

          // Use the parent of the first candidate as the merge target
          // (they're duplicates, so they should share the same parent)
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

          // Inject candidate contexts as supplementary data for the execution step
          intent._mergeContext = {
            mergeTarget: targetNodeId,
            candidates: candidateContexts,
          };

          console.log(
            `  📍 Merge target: ${targetPath || targetNodeId} with ${candidateContexts.length} candidates`,
          );
        } else {
          // Normal ambiguity — ask user
          return await runRespond({
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
        }
      } else if (navResult?.action === "not_found") {
        if (i === 0) {
          return await runRespond({
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
      console.log(`  📍 Using current position: ${targetPath || targetNodeId}`);
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
          success: true,
          answer: navSummary,
          modeKey: "tree:navigate",
          rootId,
          modesUsed,
        };
      }
      // Navigate step in a multi-step plan — record summary and continue
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
      // Reset conversation before next step
      resetConversation(visitorId, { username, userId });
      continue;
    }

    // ══════════════════════════════════════════════════════
    // C) GET CONTEXT + SCOUT — explore deeper if targets exist
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
      // Scout is ONLY useful for one case: preventing duplicate node creation
      // when you say "create X" and X already exists.
      //
      // SKIP scouting for anything else — moves, deletes, merges, reorganization.
      // Scout was wrongly converting these to "edit", breaking the operation.
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
          // Scout found existing structure — update position and intent
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
      // Merge/dedup/cleanup needs to see children WITH their own children
      // so the structure mode has all the IDs to move and delete.
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
      // Move needs IDs from BOTH source and destination.
      // Navigation found one — fetch all other referenced nodes.
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
        chainIndex: chainIndex++,
        modeKey: "tree:getContext",
        input: `getContextForAi(${targetNodeId}, ${intent.intent})`,
        output: ctxResult,
        startTime: ctxStart,
        endTime: ctxEnd,
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

    if (intent.isDestructive) {
      // Save everything needed to resume the plan after confirmation
      // Use op.intent (original from translator), NOT intent.intent which scout may have modified
      const remainingPlan = plan.slice(i + 1);

      pendingOperations.set(visitorId, {
        action: op.intent,
        directive: op.directive,
        targetNodeId,
        targetPath,
        nodeContext,
        originalMessage: message,
        // State needed to resume the plan
        remainingPlan,
        stepSummaries: [...stepSummaries],
        stepNum,
        responseHint,
        sessionId,
        modesUsed: [...modesUsed],
        chainIndex,
      });

      return await runRespond({
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

      // Track execute step
      modesUsed.push(executionMode);
      trackChainStep({
        userId,
        sessionId,
        chainIndex: chainIndex++,
        modeKey: executionMode,
        input: intent.directive,
        output: execResult,
        startTime: execStart,
        endTime: execEnd,
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

      // Notify frontend of tree changes — only if operations actually happened
      if (intent.intent === "structure" && execResult?.operations?.length > 0) {
        socket.emit("treeChanged", {
          nodeId: targetNodeId,
          changeType: execResult?.action || "modified",
        });
      }
    }

    // ══════════════════════════════════════════════════════
    // F) SUMMARIZE & RESET — compact this step, drop conversation
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

    // Reset conversation — next step starts fresh with only accumulated summaries
    resetConversation(visitorId, { username, userId });

    // Carry forward position for next step
    lastTargetNodeId = targetNodeId;
    lastTargetPath = targetPath;
  }

  // ────────────────────────────────────────────────────────
  // STEP 3: RESPOND (with accumulated step summaries)
  // ────────────────────────────────────────────────────────

  const anyFailed = stepSummaries.some((s) => s.failed || s.skipped);

  const operationContext =
    stepSummaries.length > 0 ? formatStepSummaries(stepSummaries) : null;

  // Also pass the raw summaries for structured access
  const structuredResults =
    stepSummaries.length > 0 ? JSON.stringify(stepSummaries, null, 2) : null;

  // Adjust responseHint if any steps failed
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
    nodeContext: null, // responder gets what it needs from summaries
    operationContext: structuredResults || operationContext,
    originalMessage: message,
    responseHint: finalResponseHint,
    stepSummaries,
  });

  const respondEnd = new Date();

  trackChainStep({
    userId,
    sessionId,
    chainIndex: chainIndex++,
    modeKey: "tree:respond",
    input: responseHint || "Respond to the user",
    output: response?.answer || null,
    startTime: respondStart,
    endTime: respondEnd,
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
// EXECUTE PENDING (after confirmation)
// ─────────────────────────────────────────────────────────────────────────

async function executePendingOperation({
  visitorId,
  pending,
  socket,
  signal,
  username,
  userId,
  rootId,
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

  // Use the specific directive, not the original message
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
    chainIndex: chainIndex++,
    modeKey: executionMode,
    input: pending.directive || pending.originalMessage,
    output: execResult,
    startTime: execStart,
    endTime: execEnd,
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

  // Reset conversation before continuing
  resetConversation(visitorId, { username, userId });

  // ── RESUME REMAINING PLAN STEPS ──
  const remainingPlan = pending.remainingPlan || [];
  const message = pending.originalMessage;
  let lastTargetNodeId = pending.targetNodeId;
  let lastTargetPath = pending.targetPath;

  for (let i = 0; i < remainingPlan.length; i++) {
    if (signal?.aborted) return null;

    const op = remainingPlan[i];
    const stepNum = stepSummaries.length + 1;
    const isOnlyStep = false; // we're mid-plan

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
      `  📋 Resuming step ${stepNum}: ${intent.intent} → ${intent.targetHint || "(current)"}`,
    );

    // ── NAVIGATE ──
    let targetNodeId = lastTargetNodeId;
    let targetPath = lastTargetPath;

    if (intent.targetHint) {
      emitStatus(socket, "navigate", `Step ${stepNum}: Finding node…`);

      switchMode(visitorId, "tree:navigate", {
        ...meta,
        currentNodeId: getCurrentNodeId(visitorId) || rootId,
        clearHistory: true,
      });

      const priorStepsCtx = formatStepSummaries(stepSummaries);
      const navStart = new Date();
      const navResult = await processMessage(
        visitorId,
        `${priorStepsCtx}\n\nCurrent request: ${intent.directive || message}`,
        {
          ...meta,
          signal,
          meta: { internal: true },
        },
      );
      const navEnd = new Date();

      if (signal?.aborted) return null;
      emitModeResult(socket, "tree:navigate", navResult);
      modesUsed.push("tree:navigate");
      trackChainStep({
        userId,
        sessionId,
        chainIndex: chainIndex++,
        modeKey: "tree:navigate",
        input: intent.directive,
        output: navResult,
        startTime: navStart,
        endTime: navEnd,
        treeContext: {
          targetNodeId: navResult?.action === "found" ? navResult.targetNodeId : lastTargetNodeId,
          targetPath: navResult?.action === "found" ? navResult.targetPath : lastTargetPath,
          planStepIndex: stepNum,
          planTotalSteps: null,
          directive: intent.directive,
          stepResult: navResult?.action === "found" ? "success" : navResult?.action === "ambiguous" ? "pending" : "failed",
          resultDetail: navResult?.reason || navResult?.summary || null,
        },
      });

      if (navResult?.action === "found") {
        targetNodeId = navResult.targetNodeId;
        targetPath = navResult.targetPath;
        socket.emit("navigate", {
          url: `/api/v1/node/${targetNodeId}?html`,
          replace: false,
        });
      } else {
        stepSummaries.push(
          buildStepSummary({
            stepNum,
            intent: intent.intent,
            targetNodeId,
            targetPath,
            skipped: true,
            skipReason:
              navResult?.action === "ambiguous"
                ? "Ambiguous target"
                : "Node not found",
          }),
        );
        resetConversation(visitorId, { username, userId });
        continue;
      }
    } else {
      targetNodeId = lastTargetNodeId || getCurrentNodeId(visitorId) || rootId;
      targetPath = lastTargetPath || null;
    }

    // ── GET CONTEXT ──
    let nodeContext = null;
    if (intent.needsContext && targetNodeId) {
      emitStatus(socket, "context", `Step ${stepNum}: Reading node…`);

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
      const ctxResult = await getContextForAi(targetNodeId, profile);
      nodeContext = JSON.stringify(ctxResult, null, 2);

      // Deep context for destructive restructure
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
          } catch {}
        }
        if (childContexts.length > 0) {
          nodeContext = JSON.stringify(
            { currentNode: ctxResult, childrenDetail: childContexts },
            null,
            2,
          );
        }
      }

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
        }
      }

      emitModeResult(socket, "tree:getContext", ctxResult);
    }

    // ── DESTRUCTIVE CHECK (nested confirmation — rare but possible) ──
    if (intent.isDestructive) {
      pendingOperations.set(visitorId, {
        action: op.intent,
        directive: op.directive,
        targetNodeId,
        targetPath,
        nodeContext,
        originalMessage: message,
        remainingPlan: remainingPlan.slice(i + 1),
        stepSummaries: [...stepSummaries],
        stepNum,
        responseHint: pending.responseHint,
        sessionId,
        modesUsed: [...modesUsed],
        chainIndex,
      });

      return await runRespond({
        visitorId,
        socket,
        signal,
        ...meta,
        nodeContext,
        operationContext: `${formatStepSummaries(stepSummaries)}\n\nPending destructive operation: ${intent.directive}`,
        confirmNeeded: true,
        originalMessage: message,
        responseHint:
          "Clearly describe the destructive action and ask for explicit confirmation.",
        stepSummaries,
      });
    }

    // ── EXECUTE ──
    const execMode = mutationModes[intent.intent];
    let stepExecResult = null;

    if (execMode) {
      emitStatus(socket, "execute", `Step ${stepNum}: Making changes…`);

      let stepPrestige = 0;
      if (nodeContext) {
        try {
          stepPrestige = JSON.parse(nodeContext).prestige ?? 0;
        } catch {}
      }

      switchMode(visitorId, execMode, {
        ...meta,
        targetNodeId,
        prestige: stepPrestige,
        clearHistory: true,
      });

      const execMsg = buildExecutionMessage(
        intent.directive || message,
        targetNodeId,
        nodeContext,
        stepSummaries,
      );
      const sStart = new Date();
      stepExecResult = await processMessage(visitorId, execMsg, {
        ...meta,
        signal,
        meta: { internal: true },
      });
      const sEnd = new Date();

      if (signal?.aborted) return null;
      emitModeResult(socket, execMode, stepExecResult);
      modesUsed.push(execMode);
      trackChainStep({
        userId,
        sessionId,
        chainIndex: chainIndex++,
        modeKey: execMode,
        input: intent.directive,
        output: stepExecResult,
        startTime: sStart,
        endTime: sEnd,
        treeContext: {
          targetNodeId,
          targetPath,
          planStepIndex: stepNum,
          planTotalSteps: null,
          directive: intent.directive,
          stepResult: execResultToStepResult(stepExecResult),
          resultDetail: stepExecResult?.summary || stepExecResult?.reason || null,
        },
      });

      if (
        intent.intent === "structure" &&
        stepExecResult?.operations?.length > 0
      ) {
        socket.emit("treeChanged", {
          nodeId: targetNodeId,
          changeType: stepExecResult?.action || "modified",
        });
      }
    }

    stepSummaries.push(
      buildStepSummary({
        stepNum,
        intent: intent.intent,
        targetPath,
        targetNodeId,
        execResult: stepExecResult,
        nodeContext,
      }),
    );
    resetConversation(visitorId, { username, userId });
    lastTargetNodeId = targetNodeId;
    lastTargetPath = targetPath;
  }

  // ── RESPOND ──
  const responseHint = pending.responseHint || "";
  modesUsed.push("tree:respond");

  const response = await runRespond({
    visitorId,
    socket,
    signal,
    ...meta,
    nodeContext: null,
    operationContext: JSON.stringify(stepSummaries, null, 2),
    originalMessage: message,
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
}) {
  emitStatus(socket, "respond", "");

  // Include conversation memory so respond can reference prior exchanges
  const memCtx = formatMemoryContext(visitorId);

  // Build a combined context: memory + step summaries + operation details
  const summaryCtx = formatStepSummaries(stepSummaries);

  switchMode(visitorId, "tree:respond", {
    username,
    userId,
    rootId,
    nodeContext: nodeContext || null,
    operationContext: operationContext || null,
    conversationMemory: memCtx || null,
    stepSummaries: summaryCtx || null,
    responseHint: responseHint || null,
    confirmNeeded,
    clearHistory: true,
  });

  // Build trigger with responseHint for tone/content guidance
  let trigger;
  if (confirmNeeded) {
    trigger = "Present the pending operation and ask for confirmation.";
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
 * Recursively fetch tree structure and format as an indented summary.
 * Caps at MAX_DEPTH levels and MAX_NODES total to keep it bounded.
 * This gives the translator full visibility into the tree's shape.
 */
const TREE_SUMMARY_MAX_DEPTH = 4;
const TREE_SUMMARY_MAX_NODES = 60;

async function buildDeepTreeSummary(rootId) {
  let nodeCount = 0;

  async function walkNode(nodeId, depth) {
    if (nodeCount >= TREE_SUMMARY_MAX_NODES) return null;
    nodeCount++;

    const ctx = await getContextForAi(nodeId, {
      includeChildren: true,
      includeParentChain: false,
      includeValues: true,
      includeNotes: false,
    });

    const indent = "  ".repeat(depth);
    const values = ctx.version?.values;
    const valueStr =
      values && Object.keys(values).length > 0
        ? ` (${Object.entries(values)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")})`
        : "";

    let line = `${indent}- ${ctx.name}${valueStr}`;

    if (depth < TREE_SUMMARY_MAX_DEPTH && ctx.children?.length > 0) {
      const childLines = [];
      for (const child of ctx.children) {
        if (nodeCount >= TREE_SUMMARY_MAX_NODES) {
          childLines.push(
            `${"  ".repeat(depth + 1)}- ... (${ctx.children.length - childLines.length} more)`,
          );
          break;
        }
        const childResult = await walkNode(child.id, depth + 1);
        if (childResult) childLines.push(childResult);
      }
      if (childLines.length > 0) {
        line += "\n" + childLines.join("\n");
      }
    } else if (ctx.children?.length > 0) {
      line += ` [${ctx.children.length} children]`;
    }

    return line;
  }

  const result = await walkNode(rootId, 0);
  if (!result) return "(empty tree)";
  return `Tree structure:\n${result}`;
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
