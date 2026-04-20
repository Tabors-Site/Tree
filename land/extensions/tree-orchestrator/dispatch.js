// dispatch.js
// Extracted from orchestrator.js — mode dispatch, chain execution, and
// supporting helpers (emitStatus, emitModeResult, resolveLlmProvider).

import log from "../../seed/log.js";
import { WS } from "../../seed/protocol.js";
import {
  switchMode,
  processMessage,
  getCurrentNodeId,
  setCurrentNodeId,
  getClientForUser,
  resolveRootLlmForMode,
} from "../../seed/llm/conversation.js";
import { setChatContext } from "../../seed/llm/chatTracker.js";
async function swarmExt() {
  const { getExtension } = await import("../loader.js");
  return getExtension("swarm")?.exports || null;
}
import { parsePlan, setPendingPlan } from "./pendingPlan.js";
import {
  pushMemory, formatMemoryContext,
  getActiveRequest, setActiveRequest,
} from "./state.js";
import { runSteppedMode } from "./steppedMode.js";

// ─────────────────────────────────────────────────────────────────────────
// EMIT HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a status event to the frontend. No-op when socket is null — the
 * orchestrator runs legitimately without a socket in background contexts
 * (room-agent delivery, cron-driven chains, batch jobs). Hardening here
 * lets every such caller invoke orchestrateTreeRequest without stubbing.
 */
export function emitStatus(socket, phase, text) {
  if (!socket?.emit) return;
  socket.emit(WS.EXECUTION_STATUS, { phase, text });
}

/**
 * Build the standard progress-callback bundle passed into processMessage /
 * runSteppedMode. Every call site in the tree orchestrator wants the same
 * three things: forward tool results, announce tool calls as they begin,
 * and stream the model's mid-turn reasoning prose. Extracted here so the
 * six+ call sites stay in sync as the event set grows. Returns a frozen
 * object; callers spread it into their ctx.
 *
 * Safe when socket is null — each callback becomes a no-op. Signal check
 * mirrors the old onToolResults guard so an aborted run stops emitting.
 */
export function buildSocketBridge(socket, signal = null) {
  const isLive = () => socket?.emit && !signal?.aborted;
  return {
    onToolResults: (results) => {
      if (!isLive()) return;
      for (const r of results) socket.emit(WS.TOOL_RESULT, r);
    },
    onToolCalled: (call) => {
      if (!isLive()) return;
      socket.emit(WS.TOOL_CALLED, call);
    },
    onThinking: (thought) => {
      if (!isLive()) return;
      socket.emit(WS.THINKING, thought);
    },
  };
}

/**
 * Emit an internal mode result to the chat so the user can see what's
 * happening. No-op when socket is null (same rationale as emitStatus).
 */
export function emitModeResult(socket, modeKey, result) {
  if (!socket?.emit) return;
  // Strip internal tracking fields before sending to client
  let sanitized = result;
  if (result && typeof result === "object") {
    const { _llmProvider, _raw, ...rest } = result;
    sanitized = rest;
  }
  socket.emit(WS.ORCHESTRATOR_STEP, {
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

export async function resolveLlmProvider(userId, rootId, modeKey, slot) {
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
// RUN MODE AND RETURN (eliminates copy-pasted switchMode/processMessage)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Switch to a mode, run processMessage, handle memory and status events,
 * return the standard response shape. Every exit path that runs a mode
 * should call this instead of inlining the same 20 lines.
 */
export async function runModeAndReturn(visitorId, mode, message, {
  socket, username, userId, rootId, signal, slot,
  currentNodeId, readOnly = false, clearHistory = false,
  onToolLoopCheckpoint, modesUsed,
  targetNodeId = null,
  sessionId = null, rootChatId = null, rt = null,
  treeCapabilities = null,
  adjectives = null,
  quantifiers = null,
  temporalScope = null,
  fanoutContext = null,
  reroutePrefix = null,
  voice = "active",
}) {
  modesUsed.push(mode);
  emitStatus(socket, "intent", "");

  // Build conversation memory + grammar modifier injections.
  let memory = formatMemoryContext(visitorId);

  // Reroute prefix injection: when the orchestrator intercepted a correction
  // and substituted the message, tell the AI to open its response with a
  // brief note explaining the reroute. This keeps the chat history readable:
  // the user sees their correction in the history, then the AI's response
  // starts with "↪ Rerouted your previous message to food: ...". Without
  // this, the chat looks like the AI ignored the correction and answered a
  // random question, which is confusing.
  if (reroutePrefix) {
    const rerouteBlock = `[Rerouted] This message was rerouted from another extension. ` +
      `Your response MUST begin with EXACTLY this line on its own, followed by a blank line, ` +
      `then your normal response to the message:\n\n${reroutePrefix}\n\nDo not paraphrase the ` +
      `reroute line. Copy it exactly as shown above.`;
    memory = (memory ? memory + "\n\n" : "") + rerouteBlock;
  }

  // Temporal scope injection: constrains the data window the AI operates on.
  // Time is not tense. Tense = intent. Time = which data to look at.
  if (temporalScope) {
    let timeDesc;
    if (temporalScope.type === "range") timeDesc = `from ${temporalScope.from} to ${temporalScope.to}`;
    else if (temporalScope.type === "since") timeDesc = `since ${temporalScope.from}`;
    else if (temporalScope.type === "duration") timeDesc = `${temporalScope.raw}`;
    else timeDesc = temporalScope.raw;
    const timeBlock = `[Time Scope] The user is asking about a specific time window: ${timeDesc}. ` +
      `Constrain your data queries and analysis to this period. Do not include data outside this window unless comparing.`;
    memory = (memory ? memory + "\n\n" : "") + timeBlock;
  }

  // Voice injection: passive voice means the user is observing, not commanding.
  // The AI should acknowledge, reflect, and suggest rather than execute.
  if (voice === "passive") {
    const voiceBlock = `[Voice: passive] The user is describing something that happened or a state they noticed. ` +
      `Observe and acknowledge. Reflect on what it means. Suggest next steps if relevant. ` +
      `Do not treat this as a command to log or execute.`;
    memory = (memory ? memory + "\n\n" : "") + voiceBlock;
  }

  // Fanout injection: pre-resolved set data replaces generic selection annotation.
  // When FANOUT executed, items are already resolved with real enriched context.
  // When no fanout, fall back to annotation telling the AI to query the set itself.
  if (fanoutContext) {
    memory = (memory ? memory + "\n\n" : "") + fanoutContext;
  } else if (quantifiers && quantifiers.length > 0) {
    const qDescs = quantifiers.map(q => {
      if (q.type === "numeric") return `${q.direction} ${q.count}`;
      if (q.type === "temporal") return `${q.direction} ${q.unit}`;
      if (q.type === "superlative") return `${q.qualifier} ${q.subject}`;
      if (q.type === "comparative") return "compare/contrast";
      if (q.type === "universal") return "all/every";
      return q.type;
    });
    const qBlock = `[Selection] The user is asking about a SET, not a single item: ${qDescs.join(", ")}. Query and aggregate across multiple entries. Do not respond about just the current/latest value.`;
    memory = (memory ? memory + "\n\n" : "") + qBlock;
  }

  // Adjective injection: focus constraints from the parsed message.
  if (adjectives && adjectives.length > 0) {
    const focusLines = adjectives.map(a => {
      const subject = a.subject ? ` ${a.subject}` : "";
      return `${a.qualifier}${subject}`;
    });
    const focusBlock = `[Focus] The user's message emphasizes: ${focusLines.join(", ")}. Prioritize this in your response.`;
    memory = (memory ? memory + "\n\n" : "") + focusBlock;
  }

  try {
    const { getModeOwner } = await import("../../seed/tree/extensionScope.js");
    const extOwner = getModeOwner(mode);
    // Only inject boundary for extension-owned modes (not kernel modes like tree:converse)
    if (extOwner && !mode.startsWith("tree:converse") && !mode.startsWith("tree:fallback")) {
      const { getIndexForRoot } = await import("./routingIndex.js");
      const index = rootId ? getIndexForRoot(rootId) : null;
      const otherDomains = [];
      if (index) {
        for (const [ext, entry] of index) {
          if (ext !== extOwner) otherDomains.push(`${ext} (${entry.path})`);
        }
      }
      const boundary = `[Boundary] You are the ${extOwner} extension. You ONLY handle ${extOwner}. ` +
        `Do not offer to set up, manage, or advise on other domains. ` +
        `You have only ${extOwner}-specific tools.` +
        (otherDomains.length > 0
          ? ` Other domains in this tree: ${otherDomains.join(", ")}. ` +
            `For those, tell the user to navigate there or talk about it at the tree root.`
          : "");
      memory = (memory ? memory + "\n\n" : "") + boundary;
    }
  } catch {}

  await switchMode(visitorId, mode, {
    username, userId, rootId,
    currentNodeId: currentNodeId || targetNodeId,
    conversationMemory: memory,
    clearHistory,
    treeCapabilities,
  });

  const result = await runSteppedMode(visitorId, mode, message, {
    username, userId, rootId, signal, slot,
    readOnly, onToolLoopCheckpoint, socket,
    sessionId, rootChatId, rt,
  });

  emitStatus(socket, "done", "");
  let answer = result?._allContent || result?.content || result?.answer || null;

  // Branch swarm detection. If the mode emitted a [[BRANCHES]]...[[/BRANCHES]]
  // block, parse it and dispatch each branch as its own sequence of
  // plan-mode runs at a dedicated child node. This is how a compound
  // project request ("make a tinder app with backend and frontend") turns
  // into a tree of chats that each build one component. The branch runner
  // is sequential in phase 1; the `slot` field on each branch is preserved
  // for when we flip to parallel (per-slot LLM routing).
  if (answer) {
    const sw = await swarmExt();
    if (!sw) {
      // swarm extension absent: leave the answer unchanged, skip dispatch.
      // A mode emitting [[BRANCHES]] has nothing to dispatch to without swarm.
    } else {
    // Parse contracts FIRST so parseBranches sees the cleaned text.
    // Contracts are optional — a simple single-branch build doesn't need
    // them — but when present they become the authoritative wire protocol
    // every branch must implement.
    const contractsParse = sw.parseContracts(answer);
    let parsedContracts = contractsParse.contracts;
    if (parsedContracts.length > 0) {
      answer = contractsParse.cleaned;
      if (result) {
        result.content = contractsParse.cleaned;
        result.answer = contractsParse.cleaned;
      }
      log.info("Tree Orchestrator",
        `📜 Architect declared ${parsedContracts.length} contract(s): ${parsedContracts.map((c) => `${c.kind} ${c.name}`).join(", ")}`,
      );
    }

    log.info("Tree Orchestrator", `🔍 parseBranches input: ${answer?.length || 0} chars, has [[BRANCHES]]: ${answer?.includes?.("[[BRANCHES]]") || false}`);
    const branchParse = sw.parseBranches(answer);
    log.info("Tree Orchestrator", `🔍 parseBranches result: ${branchParse.branches.length} branches`);
    if (branchParse.branches.length > 0) {
      answer = branchParse.cleaned;
      if (result) {
        result.content = branchParse.cleaned;
        result.answer = branchParse.cleaned;
      }
      log.info("Tree Orchestrator",
        `🌿 Detected ${branchParse.branches.length} branches from ${mode}: ${branchParse.branches.map((b) => b.name).join(", ")}`,
      );

      try {
        const searchNodeId = currentNodeId || targetNodeId || rootId;
        // Find the swarm project anchored at or above this position. If
        // none exists, swarm.ensureProject promotes rootId into one and
        // fires swarm:afterProjectInit so code-workspace (or any other
        // domain workspace) can finish its side of the init.
        let projectNode = searchNodeId ? await sw.findProjectForNode(searchNodeId) : null;
        if (!projectNode && rootId) {
          log.info("Tree Orchestrator", `Swarm: no project at position, promoting tree root ${rootId}`);
          projectNode = await sw.ensureProject({
            rootId,
            systemSpec: message,
            owner: { userId, username },
          });
        }

        if (!projectNode) {
          log.warn("Tree Orchestrator", "Swarm: no project root found at current position; branches will not run.");
        } else {
          // Persist the architect's declared contracts on the project
          // root before dispatch. Each branch's enrichContext injects
          // them via readContracts so contracts flow to every branch
          // from turn 1 without a separate distribution step.
          if (parsedContracts && parsedContracts.length > 0) {
            try {
              await sw.setContracts({
                projectNodeId: projectNode._id,
                contracts: parsedContracts,
              });
              log.info("Tree Orchestrator",
                `📜 Contracts stored on project root ${String(projectNode._id).slice(0, 8)}`,
              );
            } catch (ctxErr) {
              log.warn("Tree Orchestrator", `Failed to store contracts: ${ctxErr.message}`);
            }
          }

          // Validate the architect's branch paths. If any branch is
          // broken, reject the whole block, skip dispatch, and append
          // an error so the next turn forces the architect to re-emit
          // a corrected [[BRANCHES]] block.
          const validation = sw.validateBranches(branchParse.branches, projectNode?.name);
          if (validation.errors.length > 0) {
            log.warn("Tree Orchestrator",
              `🚫 Swarm: rejecting branch plan with ${validation.errors.length} validation error(s):\n  - ${validation.errors.join("\n  - ")}`,
            );
            const errorBlock = [
              "",
              "⚠️ BRANCH PLAN REJECTED — the [[BRANCHES]] block violated the seam rules:",
              ...validation.errors.map((e) => `  • ${e}`),
              "",
              "Re-emit the [[BRANCHES]] block with valid paths and [[DONE]] your turn again.",
            ].join("\n");
            answer = (answer || "") + "\n" + errorBlock;
            if (result) {
              result.content = answer;
              result.answer = answer;
            }
            return { success: true, answer, modeKey: mode, modesUsed, rootId, targetNodeId: targetNodeId || currentNodeId };
          }

          const _swarmActive = getActiveRequest(visitorId) || {};
          // Prefer the architect's own last chain-step chatId so the
          // branch dispatch markers and their worker turns nest
          // directly under the step that emitted [[BRANCHES]]. Falls
          // back to rootChatId if steppedMode didn't expose it.
          const architectChatId = result?._lastChatId || rootChatId || null;
          const swarmResult = await sw.runBranchSwarm({
            branches: branchParse.branches,
            rootProjectNode: projectNode,
            rootChatId,
            architectChatId,
            sessionId,
            visitorId,
            userId,
            username,
            rootId,
            signal,
            slot,
            socket,
            onToolLoopCheckpoint,
            userRequest: message,
            rt: _swarmActive.rt,
            core: { metadata: { setExtMeta: async (node, ns, data) => {
              const NodeModel = (await import("../../seed/models/node.js")).default;
              await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
            } } },
            emitStatus,
            runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot, markerChatId, ...rest }) => {
              // Position the session at the branch node + clear history so
              // each branch starts fresh at its own tree position.
              log.info("Tree Orchestrator",
                `🌿 runBranch dispatching: mode=${branchMode} branchNodeId=${branchNodeId?.slice?.(0, 8)} (was currentNodeId=${getCurrentNodeId(visitorId)?.slice?.(0, 8)})`,
              );
              setCurrentNodeId(visitorId, branchNodeId);
              // Refresh the active request so the branch's
              // runSteppedMode can read sessionId/userId/rt.
              // The 30s TTL on getActiveRequest expires during
              // long builds; re-stamp with the values captured
              // at swarm start (line 2497) so they survive.
              setActiveRequest(visitorId, {
                socket, username, userId, signal,
                sessionId,
                rootId,
                rootChatId,
                slot, onToolLoopCheckpoint,
                rt: (getActiveRequest(visitorId) || {}).rt,
              });
              await switchMode(visitorId, branchMode, {
                username, userId, rootId,
                currentNodeId: branchNodeId,
                clearHistory: true,
              });
              log.info("Tree Orchestrator",
                `🌿 runBranch post-switch: currentNodeId=${getCurrentNodeId(visitorId)?.slice?.(0, 8)} (expected ${branchNodeId?.slice?.(0, 8)})`,
              );
              // Stamp dispatch lineage on the branch's chat chain so
              // the operator can walk from the orchestrator's root
              // step down to each branch and back. When the swarm
              // passes markerChatId, worker continuations nest UNDER
              // the dispatch marker card; without it, fall back to
              // rootChatId so the tree still walks.
              return runSteppedMode(visitorId, branchMode, branchMessage, {
                username, userId, rootId, signal, slot: branchSlot,
                readOnly: false, onToolLoopCheckpoint, socket,
                sessionId, rootChatId, rt,
                parentChatId: markerChatId || rootChatId || null,
                dispatchOrigin: "branch-swarm",
              });
            },
          });

          // Replace the answer with the swarm summary so the user sees the
          // full picture. Original architect text + swarm result.
          answer = [answer, "", swarmResult.summary].filter(Boolean).join("\n");
          if (result) {
            result.content = answer;
            result.answer = answer;
          }

          // Restore position to the original project root
          if (projectNode?._id) setCurrentNodeId(visitorId, String(projectNode._id));
        }
      } catch (err) {
        log.error("Tree Orchestrator", `Swarm dispatch failed: ${err.message}`);
        log.error("Tree Orchestrator", err.stack?.split("\n").slice(0, 5).join("\n"));
      }
    }
    }
  }

  // Flat-build scout. If the builder wrote files but dispatched no
  // branches, swarm:afterAllBranchesComplete never fired — so the
  // existing cross-branch validators (symbol coherence, behavioral
  // tests, etc.) stayed silent. Ask code-workspace for a one-shot
  // syntax scan across the workspace so obvious broken files surface
  // before the user tries to run the app.
  const SUMMARIZE_MODES = new Set(["tree:code-plan", "tree:code-log", "tree:code-coach"]);
  let flatScoutReport = null;
  if (
    SUMMARIZE_MODES.has(mode) &&
    (result?._writeCount || 0) > 0 &&
    rootId
  ) {
    try {
      const { getExtension } = await import("../loader.js");
      const cw = getExtension("code-workspace")?.exports;
      if (cw?.runFlatBuildScout) {
        flatScoutReport = await cw.runFlatBuildScout({ rootId });
        if (flatScoutReport?.errors?.length > 0) {
          log.warn("Tree Orchestrator",
            `🔍 Flat-build scout: ${flatScoutReport.errors.length} syntax issue(s) across ${flatScoutReport.filesScanned} file(s)`,
          );
        } else if (flatScoutReport?.filesScanned > 0) {
          log.info("Tree Orchestrator",
            `✅ Flat-build scout: ${flatScoutReport.filesScanned} file(s), zero syntax issues`,
          );
        }
      }
    } catch (err) {
      log.warn("Tree Orchestrator", `flat-build scout failed: ${err.message}`);
    }
  }

  // Summarizer rescue. When the builder ends with a bare "[[DONE]]" or
  // empty prose but tools actually ran, the user sees nothing. Fire a
  // one-shot summarizer so the chat doesn't close on silence. Only for
  // modes that opt in (the tree:code-* builder family). Skipped when
  // branches dispatched (they produce their own summary) or the builder
  // already wrote a real reply (>= 80 chars after marker strip).
  if (
    SUMMARIZE_MODES.has(mode) &&
    (result?._writeCount || 0) > 0 &&
    Array.isArray(result?._toolTrace) && result._toolTrace.length > 0 &&
    ((answer || "").trim().length < 80)
  ) {
    try {
      const { runChat } = await import("../../seed/llm/conversation.js");
      const traceLines = result._toolTrace
        .map((t) => `  - ${t.tool}${t.hint ? " (" + t.hint + ")" : ""}`)
        .join("\n");
      const scoutNote = flatScoutReport && flatScoutReport.errors?.length > 0
        ? `\n\nSCOUT FOUND SYNTAX ISSUES:\n${flatScoutReport.errors
            .slice(0, 6)
            .map((e) => `  - ${e.file}${e.line ? ":" + e.line : ""}: ${e.message}`)
            .join("\n")}\n(Mention these to the user — they will need to be fixed before the app runs.)`
        : "";
      const summarizerMsg =
        `ORIGINAL REQUEST:\n${message}\n\n` +
        `TOOL TRACE (${result._toolTrace.length} calls, ${result._writeCount} writes, ${result._readCount || 0} reads):\n${traceLines}\n\n` +
        `BUILDER'S FINAL REPLY: ${((answer || "").trim()) || "(empty)"}` +
        scoutNote +
        `\n\nWrite the user-facing recap now.`;
      const summary = await runChat({
        userId, username,
        message: summarizerMsg,
        mode: "tree:code-summarize",
        rootId,
        signal,
        // Separate visitorId keeps the summarizer session from clobbering
        // the main builder session's mode + chat context.
        visitorId: `summarize:${rootId || "nil"}:${userId}`,
        llmPriority: "INTERACTIVE",
      });
      const recap = (summary?.answer || "").trim();
      if (recap && recap.length > 0 && recap !== "No response.") {
        answer = recap;
        if (result) {
          result.content = recap;
          result.answer = recap;
        }
        log.info("Tree Orchestrator", `📝 Summarizer rescued bare [[DONE]] (${recap.length} chars)`);
      }
    } catch (err) {
      log.warn("Tree Orchestrator", `summarizer failed: ${err.message}`);
    }
  }

  // Coach → plan handoff. A diagnose-mode (tree:code-coach) that is
  // confident about a concrete fix emits `[[HANDOFF: <task>]]` on its
  // last line. The orchestrator strips that marker from the visible
  // answer and dispatches a fresh tree:code-plan run at the same node
  // with the task description as its input. Result: one chat turn
  // delivers both the diagnosis and the applied fix, instead of making
  // the user re-prompt.
  if (answer) {
    const handoffMatch = answer.match(/\[\[HANDOFF:\s*([^\]]+?)\s*\]\]/);
    if (handoffMatch) {
      const fixTask = handoffMatch[1].trim();
      answer = answer.replace(/\[\[HANDOFF:[^\]]+\]\]/g, "").trim();
      if (result) {
        result.content = answer;
        result.answer = answer;
      }
      log.info("Tree Orchestrator",
        `🔧 Handoff: coach → plan at ${currentNodeId || rootId} — "${fixTask.slice(0, 80)}${fixTask.length > 80 ? "..." : ""}"`,
      );
      try {
        const { runChat } = await import("../../seed/llm/conversation.js");
        const planRun = await runChat({
          userId, username,
          message: fixTask,
          mode: "tree:code-plan",
          rootId,
          nodeId: currentNodeId || targetNodeId || rootId,
          signal,
          // Dedicated visitorId for handoffs — keeps the plan run isolated
          // from both the coach session and any concurrent user chats.
          // Deterministic per-(rootId, userId) so successive handoffs at
          // the same tree share continuity.
          visitorId: `handoff:${rootId || "nil"}:${userId}`,
          llmPriority: "INTERACTIVE",
        });
        const planAnswer = (planRun?.answer || "").trim();
        if (planAnswer) {
          answer = answer
            ? `${answer}\n\n---\n\n${planAnswer}`
            : planAnswer;
          if (result) {
            result.content = answer;
            result.answer = answer;
          }
          log.info("Tree Orchestrator", `🔧 Handoff plan completed (${planAnswer.length} chars)`);
        }
      } catch (err) {
        log.warn("Tree Orchestrator", `handoff plan failed: ${err.message}`);
        answer = `${answer}\n\n(handoff failed: ${err.message})`;
        if (result) {
          result.content = answer;
          result.answer = answer;
        }
      }
    }
  }

  // Plan capture: if the mode emitted a [[PLAN]]...[[/PLAN]] block, strip it
  // from the visible answer and stash it for the next turn. The next
  // affirmative from this visitor will expand the plan into N sequential
  // runs, one chat per item. Non-affirmative next message clears it.
  if (answer) {
    const { items, cleaned } = parsePlan(answer);
    if (items.length > 0) {
      setPendingPlan(visitorId, items, mode);
      answer = cleaned;
      if (result) {
        result.content = cleaned;
        result.answer = cleaned;
      }
      log.info("Tree Orchestrator",
        `📋 Captured plan: ${items.length} items from ${mode}. Say an affirmative to expand.`,
      );
    }
  }

  if (answer) pushMemory(visitorId, message, answer);
  return { success: true, answer, modeKey: mode, modesUsed, rootId, targetNodeId: targetNodeId || currentNodeId };
}

// ─────────────────────────────────────────────────────────────────────────
// RUN CHAIN (eliminates duplicated chain execution logic)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Execute a multi-extension chain. Each step runs in its own mode,
 * results pass forward as context.
 */
export async function runChain(chain, message, visitorId, {
  socket, username, userId, rootId, signal, slot,
  onToolLoopCheckpoint, modesUsed,
}) {
  emitStatus(socket, "intent", "Chaining extensions...");

  let context = message;
  const chainModes = [];

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const isLast = i === chain.length - 1;

    const stepNodeId = step.targetNodeId || getCurrentNodeId(visitorId) || rootId;
    await switchMode(visitorId, step.mode, {
      username, userId, rootId,
      currentNodeId: stepNodeId,
      conversationMemory: context,
      clearHistory: true,
    });

    const stepResult = await processMessage(visitorId,
      isLast ? context : `${context}\n\nDo this step and return what you produced.`, {
        username, userId, rootId, signal, slot,
        onToolLoopCheckpoint,
        onToolResults(results) {
          if (signal?.aborted) return;
          for (const r of results) socket?.emit?.(WS.TOOL_RESULT, r);
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
