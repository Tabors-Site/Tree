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
import { parseBranches, runBranchSwarm, validateBranches, parseContracts } from "./swarm.js";
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
 * Emit a status event to the frontend.
 */
export function emitStatus(socket, phase, text) {
  socket.emit("executionStatus", { phase, text });
}

/**
 * Emit an internal mode result to the chat so the user can see what's happening.
 */
export function emitModeResult(socket, modeKey, result) {
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
    // Parse contracts FIRST so parseBranches sees the cleaned text
    // (the [[CONTRACTS]] block is stripped before parseBranches runs).
    // Contracts are optional — a simple single-branch build doesn't
    // need them — but when present they become the authoritative wire
    // protocol all branches must implement.
    const contractsParse = parseContracts(answer);
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
    const branchParse = parseBranches(answer);
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

      // Resolve the current project root node so the swarm runner knows
      // where to hang branch children. We look up by the current position
      // walking the metadata.code-workspace.role chain to find "project".
      // If no project exists yet (common: user is at a fresh tree root,
      // no files written), auto-initialize the tree root as a workspace
      // project so the swarm has somewhere to hang branches.
      try {
        const { getExtension } = await import("../loader.js");
        const cwExt = getExtension("code-workspace");
        // Walk from current position to find the project root
        let projectNode = null;
        const searchNodeId = currentNodeId || targetNodeId || rootId;
        const NodeModel = (await import("../../seed/models/node.js")).default;
        if (searchNodeId) {
          let cursor = String(searchNodeId);
          for (let i = 0; i < 64 && cursor; i++) {
            const n = await NodeModel.findById(cursor).select("_id name parent metadata").lean();
            if (!n) break;
            const meta = n.metadata instanceof Map ? n.metadata.get("code-workspace") : n.metadata?.["code-workspace"];
            if (meta?.role === "project" && meta?.initialized) {
              projectNode = n;
              break;
            }
            if (!n.parent) break;
            cursor = String(n.parent);
          }
        }

        // Auto-init fallback. If the user is at a tree root with no
        // existing project metadata, treat the tree root as the project
        // and initialize it via code-workspace's initProject export.
        // Mirrors the ensureProject auto-init that runs on first file
        // write, but fires before the swarm dispatch so branches have a
        // parent to hang under.
        if (!projectNode && rootId && cwExt?.exports?.initProject) {
          log.info("Tree Orchestrator", `Swarm: no project at position, auto-initializing tree root ${rootId}`);
          try {
            const rootNode = await NodeModel.findById(rootId).lean();
            if (rootNode) {
              await cwExt.exports.initProject({
                projectNodeId: rootId,
                name: rootNode.name || "workspace",
                description: "Auto-initialized by swarm dispatch.",
                userId,
              });
              projectNode = await NodeModel.findById(rootId).select("_id name parent metadata").lean();
            }
          } catch (initErr) {
            log.error("Tree Orchestrator", `Swarm auto-init failed: ${initErr.message}`);
          }
        }

        if (!projectNode) {
          log.warn("Tree Orchestrator", "Swarm: no project root found at current position; branches will not run.");
        } else {
          // Persist the architect's declared contracts on the project
          // root BEFORE the swarm dispatches, so each branch session's
          // enrichContext walks into them via readProjectContracts and
          // injects them into the branch's system prompt from turn 1.
          // This is how the architect's design flows to every
          // implementing branch without a separate distribution step.
          if (parsedContracts && parsedContracts.length > 0) {
            try {
              const { setProjectContracts } = await import("../code-workspace/swarmEvents.js");
              await setProjectContracts({
                projectNodeId: projectNode._id,
                contracts: parsedContracts,
                core: { metadata: { setExtMeta: async (node, ns, data) => {
                  const NodeModel = (await import("../../seed/models/node.js")).default;
                  await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
                } } },
              });
              log.info("Tree Orchestrator",
                `📜 Contracts stored on project root ${String(projectNode._id).slice(0, 8)}`,
              );
            } catch (ctxErr) {
              log.warn("Tree Orchestrator", `Failed to store contracts: ${ctxErr.message}`);
            }
          }

          // Validate the architect's branch paths against the seam
          // rules (no path may equal the project name, all paths must
          // be unique, every branch must have a path). If any branch
          // is broken, reject the whole block, skip the swarm dispatch,
          // and append an error message to the answer so the next turn
          // forces the architect to re-emit a corrected [[BRANCHES]]
          // block. Without this, a bad branch plan (like two branches
          // both using path=ProjectName) silently collapses the whole
          // swarm into one subdirectory with empty branch nodes.
          const validation = validateBranches(branchParse.branches, projectNode?.name);
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
          const swarmResult = await runBranchSwarm({
            branches: branchParse.branches,
            rootProjectNode: projectNode,
            rootChatId,
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
              // Safe fallback via direct Node update if core services aren't available here
              const NodeModel = (await import("../../seed/models/node.js")).default;
              await NodeModel.updateOne({ _id: node._id }, { $set: { [`metadata.${ns}`]: data } });
            } } },
            emitStatus,
            runBranch: async ({ mode: branchMode, message: branchMessage, branchNodeId, slot: branchSlot, ...rest }) => {
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
              // step down to each branch and back. parentChatId points
              // at the orchestrator's root chat (active.rootChatId);
              // dispatchOrigin tells the renderer "this is a swarm
              // branch spawn" so the labels are right.
              return runSteppedMode(visitorId, branchMode, branchMessage, {
                username, userId, rootId, signal, slot: branchSlot,
                readOnly: false, onToolLoopCheckpoint, socket,
                sessionId, rootChatId, rt,
                parentChatId: rootChatId || null,
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
