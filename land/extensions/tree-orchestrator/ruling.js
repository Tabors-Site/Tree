// Ruler/Foreman turn dispatch. The load-bearing piece that makes
// Rulers and Foremen actual addressable beings — LLM calls with
// judgment — instead of programmatic flows with role labels.
//
// runRulerTurn is the entry point for every user turn at a Ruler
// scope. It promotes/ensures the scope, runs the Ruler mode, reads
// the decision register, dispatches the chosen role.
//
// runForemanTurn is invoked by:
//   1. Ruler's governing-route-to-foreman decision (with a wakeupReason
//      derived from the Ruler's interpretation of the user message).
//   2. Phase D hooks (governing:branchFailed, governing:swarmCompleted,
//      governing:resumeRequested) when execution events need judgment.
//
// Every Ruler at every scope uses the same machinery. The only
// difference between root Ruler and sub-Ruler is what their snapshot
// reads (sub-Rulers see lineage; roots don't).

import crypto from "crypto";
import log from "../../seed/log.js";
import { switchMode } from "../../seed/llm/conversation.js";
import { runSteppedMode } from "./steppedMode.js";
import { recordTurn } from "./turnInstrumentation.js";

async function governingExports() {
  const { getExtension } = await import("../loader.js");
  return getExtension("governing")?.exports || null;
}

// ─────────────────────────────────────────────────────────────────────────
// SPAWN-AS-CHAINSTEP HELPER
// ─────────────────────────────────────────────────────────────────────────
//
// The chain-nested architecture: when a Ruler tool handler decides to
// invoke another role (Planner, Foreman, etc.), it spawns that role
// as a chainstep child of the Ruler's chat. The spawned role runs in
// its OWN session (separate visitorId via runChat's
// resolveInternalAiSessionKey), with its OWN context window, OWN
// modeKey, OWN system prompt. The Ruler's session is untouched.
//
// What flows back to the Ruler is just the spawned role's final
// answer text — the tool handler is responsible for building a
// concise summary from that + any metadata the role wrote (the
// summary lives in the Ruler's tool-result, ~150 tokens; the full
// emission lives in metadata).
//
// chatTracker linkage: parentChatId is threaded through runChat →
// startChat so the spawned chat is recorded as a child of the Ruler's
// chat. Pass 2 court hearings and Pass 3 reputation walks read this
// linkage to reconstruct chain hierarchy.

/**
 * Spawn another role as a chainstep child of the calling chat.
 * Synchronous: awaits the spawned role's completion. Returns the
 * role's final answer text.
 *
 * Args:
 *   modeKey         "tree:governing-planner", "tree:governing-foreman", etc.
 *   message         The briefing / wakeup the spawned role reads as
 *                   its first user message.
 *   userId, username
 *   rootId, nodeId  Position context for the spawned session.
 *   parentChatId    The calling chat's chatId (from tool args.chatId).
 *                   When set, the spawned chat is linked as a child
 *                   for audit walks.
 *   signal          Abort signal threaded from the caller.
 *   source          Audit-trail label: "ruler-spawned-planner",
 *                   "ruler-spawned-foreman", etc.
 *
 * Returns: the role's final answer text (string), or null if the
 * spawn failed.
 */
// Governance sub-roles whose exit text is worth surfacing as an
// inline sub-bubble in the chat UI. The Ruler spawns these as
// chainstep children; their prose is the internal dialogue between
// the position and its hired roles. Typed Workers are deliberately
// excluded — their work is visible through tool calls + artifact
// creation, and adding bubbles for them would be redundant noise.
const SUB_BUBBLE_ROLES = new Set([
  "planner",
  "contractor",
  "foreman",
]);

function roleLabelFromModeKey(modeKey) {
  if (typeof modeKey !== "string") return "role";
  // Mode keys follow the convention "tree:<scope>-<role>" (e.g.,
  // "tree:governing-foreman"). Take the last hyphen-separated
  // segment.
  const tail = modeKey.split(":").pop() || "";
  const dash = tail.lastIndexOf("-");
  return dash >= 0 ? tail.slice(dash + 1) : tail;
}

function isGovernanceSubRole(modeKey) {
  return SUB_BUBBLE_ROLES.has(roleLabelFromModeKey(modeKey));
}

// Strip marker tokens (Worker / Planner / Contractor exit signals)
// from a piece of prose. Used by the chainstep sub-bubble filter to
// decide whether the role's exit text has anything worth showing
// inline. The marker tokens are control syntax — they tell the
// orchestrator the role is done, but they're not content the
// authority above this scope needs to read.
function stripMarkerTokens(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\[\[DONE\]\]/g, "")
    .replace(/\[\[NO-WRITE:[^\]]*\]\]/g, "")
    .replace(/\[\[BRANCHES\]\][\s\S]*?\[\[\/BRANCHES\]\]/g, "")
    .replace(/\[\[ESCALATION TO RULER\]\]/g, "")
    .trim();
}

// Does this exit text have content worth surfacing as a sub-bubble?
// Marker-only exits (the Planner's bare "[[DONE]]", a Worker's
// "[[NO-WRITE: reason]]") strip down to nothing useful. We require
// at least 20 chars of remaining prose — enough to fit a single
// meaningful sentence. The Foreman's escalations and direct
// responses are well above this threshold; the Planner / Contractor
// bare-marker exits fall below.
function hasSubstantiveProse(text) {
  return stripMarkerTokens(text).length > 20;
}

export async function spawnRoleAsChainstep({
  modeKey,
  message,
  userId,
  username,
  rootId,
  nodeId,
  parentChatId,
  parentSessionId,
  signal,
  source,
  // Optional: the parent's socket. When provided, the spawned role's
  // tool calls + thinking events stream to this socket so the user
  // sees the role's progress live (its narration, its tool dispatch
  // sequence) as if it were one continuous turn. Without it, the
  // spawn runs silently from the user's perspective and only the
  // post-spawn synthesis from the parent is visible.
  socket,
}) {
  if (!modeKey || !userId) {
    log.warn("Ruling", "spawnRoleAsChainstep: modeKey and userId required");
    return null;
  }
  const startedAt = Date.now();
  log.info("Ruling",
    `↪️  spawnRoleAsChainstep: ${modeKey} ` +
    `(parentChatId=${parentChatId ? String(parentChatId).slice(0, 8) : "(none)"}, ` +
    `parentSessionId=${parentSessionId ? String(parentSessionId).slice(0, 8) : "(none)"}, ` +
    `signal=${signal ? "live" : "(none)"}, source=${source || "(unset)"})`);
  if (!parentChatId) {
    log.warn("Ruling",
      `↪️  ${modeKey} spawning WITHOUT parentChatId — chain hierarchy will not link. ` +
      `Caller's args.chatId was null. Verify executeTool's chat-context injection.`);
  }
  if (!parentSessionId) {
    log.warn("Ruling",
      `↪️  ${modeKey} spawning WITHOUT parentSessionId — UI will render the spawn ` +
      `as a separate top-level session instead of nested. Verify executeTool's ` +
      `sessionId injection.`);
  }
  // Build socket bridge so the spawned role's events flow to the
  // parent's socket. The user sees the role's tool calls + thinking
  // unfold live, instead of the spawn running silently and only the
  // parent's post-synthesis appearing.
  let bridgeCallbacks = {};
  if (socket?.emit) {
    try {
      const { buildSocketBridge } = await import("./dispatch.js");
      bridgeCallbacks = buildSocketBridge(socket, signal, userId);
    } catch (err) {
      log.debug("Ruling", `socket bridge build skipped: ${err.message}`);
    }
  }

  try {
    const { runChat } = await import("../../seed/llm/conversation.js");
    const result = await runChat({
      userId,
      username,
      message: message || "(no briefing)",
      mode: modeKey,
      rootId: rootId || null,
      nodeId: nodeId || null,
      signal: signal || null,
      parentChatId: parentChatId || null,
      parentSessionId: parentSessionId || null,
      source: source || `spawn:${modeKey}`,
      // Streaming callbacks — emit spawned role's tool calls +
      // thinking to the parent's socket so the user watches the
      // chain unfold live.
      onToolResults: bridgeCallbacks.onToolResults || null,
      onToolCalled: bridgeCallbacks.onToolCalled || null,
      onThinking: bridgeCallbacks.onThinking || null,
      // No scope/purpose → ephemeral session for this spawn. The
      // spawned role doesn't resume; it runs once and exits.
    });
    const ms = Date.now() - startedAt;
    log.info("Ruling",
      `↩️  spawnRoleAsChainstep done: ${modeKey} in ${ms}ms ` +
      `(answer length: ${result?.answer?.length || 0}c)`);

    // Emit chainstep-completed event so the chat UI can render the
    // spawned role's exit text inline as a sub-bubble between the
    // user's message and the Ruler's final synthesis. Surfaces the
    // internal dialogue (Ruler ↔ Foreman / Planner / Contractor) that
    // would otherwise live only inside collapsed chainstep cards.
    //
    // Scope: governance sub-roles only. Typed Workers don't emit here
    // — their work is visible via tool calls + artifact creation, so
    // an additional bubble would be redundant noise. The governance
    // roles' prose is the actual "internal conversation" worth
    // surfacing.
    //
    // FILTER: marker-only exits don't make useful bubbles. The Planner
    // and Contractor exit with bare "[[DONE]]" by their prompts'
    // design — their value is in the structured emissions (plan card,
    // contracts emission), not in exit prose. A sub-bubble showing
    // "[[DONE]]" is noise. The Foreman, in contrast, exits with
    // substantive prose (especially when escalating); those bubbles
    // ARE valuable. hasSubstantiveProse() strips marker tokens and
    // checks if any meaningful content remains.
    //
    // Best-effort: failures emitting the event don't affect the
    // chainstep's outcome — the answer is what flows back regardless.
    const exitText = result?.answer || result?.content || result?._allContent || null;
    if (
      userId &&
      exitText &&
      isGovernanceSubRole(modeKey) &&
      hasSubstantiveProse(exitText)
    ) {
      try {
        const { WS } = await import("../../seed/protocol.js");
        const { emitToUser } = await import("../../seed/ws/websocket.js");
        emitToUser(String(userId), WS.CHAINSTEP_COMPLETED, {
          role: roleLabelFromModeKey(modeKey),
          modeKey,
          exitText: stripMarkerTokens(String(exitText)).slice(0, 4000),
          rulerNodeId: nodeId ? String(nodeId) : null,
          parentChatId: parentChatId || null,
          source: source || null,
          durationMs: ms,
          at: new Date().toISOString(),
        });
      } catch (emitErr) {
        log.debug("Ruling", `chainstepCompleted emit skipped: ${emitErr.message}`);
      }
    }

    return exitText;
  } catch (err) {
    const ms = Date.now() - startedAt;
    log.warn("Ruling",
      `spawnRoleAsChainstep(${modeKey}) failed after ${ms}ms: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FIRE-AND-FORGET SPAWN — sibling to spawnRoleAsChainstep
// ─────────────────────────────────────────────────────────────────────────
//
// Same shape as spawnRoleAsChainstep, but returns immediately with a
// spawnId. The underlying runChat promise runs in the background; on
// settle (success or failure), the supplied completionHook fires with
// the payload { spawnId, rulerNodeId, kind, exitText, durationMs,
// error }. Used by governing's six spawn-and-await tools to escape
// the MCP request/response timeout — the tool handler returns in
// milliseconds, the chainstep keeps running, the Ruler wakes when
// the hook fires.
//
// The socket bridge is preserved: the spawned role's tool-call and
// thinking events still emit to the user's socket while the chain
// runs. The user's chat panel sees live progression.
//
// Why a separate function (not a flag on spawnRoleAsChainstep): the
// caller's contract is fundamentally different. Sync version returns
// exit text; async version returns a spawnId. Splitting keeps the
// type story honest at the call site.

export function spawnRoleAsChainstepAsync({
  modeKey,
  message,
  userId,
  username,
  rootId,
  nodeId,
  parentChatId,
  parentSessionId,
  signal,
  source,
  socket,
  // The kind label used when firing the completion hook. Governing
  // emits "planner-completed", "contractor-completed", etc.
  kind,
  // The completion hook NAME (e.g., "governing:plannerCompleted").
  // Required — without it, the hook subscriber can't wake the Ruler.
  completionHookName,
  // Optional extra payload merged into the hook's data on settle.
  hookPayload = {},
  // Optional in-flight claim key. When set, the claim is released
  // on settle (success OR failure) BEFORE the completion hook fires.
  // Lets the Ruler that wakes on the hook see a clean in-flight slot
  // and decide whether to re-spawn if needed.
  releaseClaimKey = null,
}) {
  if (!modeKey || !userId) {
    log.warn("Ruling", "spawnRoleAsChainstepAsync: modeKey and userId required");
    return null;
  }
  if (!completionHookName) {
    log.warn("Ruling",
      `spawnRoleAsChainstepAsync(${modeKey}): completionHookName required; refusing to spawn`);
    return null;
  }

  const spawnId = `spawn_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const startedAt = Date.now();
  log.info("Ruling",
    `↪️  spawnAsync ${spawnId.slice(0, 16)}: ${modeKey} ` +
    `(kind=${kind || "(unset)"}, completionHook=${completionHookName}, source=${source || "(unset)"})`);

  // Register this spawn's AbortController with the per-user registry
  // so the stop button (kernel's cancelRequest) can actually halt it.
  // Without registration, fire-and-forget spawns become uncancellable
  // — the user's only escape is killing the server. Forwards aborts
  // from any parent signal too.
  let spawnAbortController = null;
  let unregisterAbort = null;
  if (userId) {
    spawnAbortController = new AbortController();
    if (signal) {
      // If the caller's signal aborts later, propagate to our spawn.
      if (signal.aborted) spawnAbortController.abort();
      else signal.addEventListener("abort", () => spawnAbortController.abort(), { once: true });
    }
    import("./spawnAborts.js").then((m) => {
      unregisterAbort = m.registerSpawnAbort(String(userId), spawnAbortController, `${kind || modeKey}:${spawnId.slice(0, 8)}`);
    }).catch(() => {});
  }
  const effectiveSignal = spawnAbortController ? spawnAbortController.signal : signal;

  // LIFECYCLE_ACTIVE — emit "active=true" so the chat panel renders
  // a persistent "Ruler active" chip. Cleared in the settle block
  // below once this spawn finishes AND the in-flight registry shows
  // no other spawns running at this scope. The chip is the user-
  // facing complement to fire-and-forget: with no synchronous wait,
  // the chat panel has no other signal that work is in progress.
  //
  // Emit via emitToUser (fans out to ALL of the user's connected
  // sockets) rather than the captured `socket` reference. The
  // captured socket gets stale across page reloads + during long
  // recursive dispatches (sub-Ruler chains keep firing events long
  // after the user's original request socket may have been
  // replaced). emitToUser uses the kernel's authSessions registry
  // so events reach whichever socket(s) the user has open RIGHT
  // NOW — including the dashboard chat panel viewing the rulership
  // scope, the CLI, multiple browser tabs, etc.
  if (userId && nodeId) {
    // spawnRoleAsChainstepAsync is sync (returns spawnId immediately),
    // so the start-side emit can't await imports. Use the dynamic
    // import's then() chain to fire-and-forget the LIFECYCLE_ACTIVE
    // event; the captured params close over the spawnId.
    Promise.all([
      import("../../seed/ws/websocket.js"),
      import("../../seed/protocol.js"),
    ]).then(([wsMod, protoMod]) => {
      try {
        wsMod.emitToUser(String(userId), protoMod.WS.LIFECYCLE_ACTIVE, {
          active: true,
          rulerNodeId: String(nodeId),
          rootId: rootId ? String(rootId) : null,
          phase: kind || "spawn",
          spawnId,
          modeKey,
          at: new Date().toISOString(),
        });
      } catch (err) {
        log.debug("Ruling", `LIFECYCLE_ACTIVE emit (start) skipped: ${err.message}`);
      }
    }).catch(() => {});
  }

  // Build socket bridge so the spawned role's events flow to the
  // user — same shape as spawnRoleAsChainstep. Pass userId so the
  // bridge can use emitToUser fan-out (reaches every live socket
  // the user has, including ones connected after the spawn started).
  // Without userId the bridge falls back to direct socket emit
  // (legacy single-socket behavior).
  const bridgeReady = (async () => {
    if (!userId && !socket?.emit) return {};
    try {
      const { buildSocketBridge } = await import("./dispatch.js");
      return buildSocketBridge(socket, effectiveSignal, userId) || {};
    } catch (err) {
      log.debug("Ruling", `socket bridge build skipped: ${err.message}`);
      return {};
    }
  })();

  // Fire-and-forget: kick off the underlying chain, attach hook firing
  // on settle. Note: this entire chain is NOT awaited by the caller.
  // Any throws inside are caught by the .catch and surfaced as a
  // hook payload with error set; they do not propagate up.
  (async () => {
    const bridgeCallbacks = await bridgeReady;
    let exitText = null;
    let error = null;
    try {
      const { runChat } = await import("../../seed/llm/conversation.js");
      const result = await runChat({
        userId,
        username,
        message: message || "(no briefing)",
        mode: modeKey,
        rootId: rootId || null,
        nodeId: nodeId || null,
        // Use the spawn-local signal so the kernel's stop button can
        // actually halt this background work via abortAllForUser.
        signal: effectiveSignal,
        parentChatId: parentChatId || null,
        parentSessionId: parentSessionId || null,
        source: source || `spawn:${modeKey}`,
        onToolResults: bridgeCallbacks.onToolResults || null,
        onToolCalled: bridgeCallbacks.onToolCalled || null,
        onThinking: bridgeCallbacks.onThinking || null,
      });
      exitText = result?.answer || result?.content || result?._allContent || null;
    } catch (err) {
      error = String(err?.message || err);
      log.warn("Ruling",
        `spawnAsync ${spawnId.slice(0, 16)} (${modeKey}) failed: ${error}`);
    }

    const ms = Date.now() - startedAt;
    log.info("Ruling",
      `↩️  spawnAsync ${spawnId.slice(0, 16)} settled in ${ms}ms ` +
      `(${error ? "error" : "ok"}, exitTextLen=${exitText?.length || 0})`);

    // Sub-bubble emit for governance sub-roles. Two shapes:
    //
    //   (a) Substantive prose exit (Foreman escalations, respond-
    //       directly text): emit as before — exitText becomes the
    //       bubble body.
    //
    //   (b) Marker-only exit (Planner / Contractor exit with bare
    //       [[DONE]] by their prompt's design): synthesize a brief
    //       summary FROM the emission (plan: "5-step plan emitted —
    //       3 build leaves + 1 branch with 4 chapters"; contracts:
    //       "10 contracts ratified — 1 global, 5 shared, 4 local").
    //       Without (b), the user only sees a tool-call line and
    //       no readable account of what was produced.
    if (userId && isGovernanceSubRole(modeKey) && !error) {
      try {
        const { WS } = await import("../../seed/protocol.js");
        const { emitToUser } = await import("../../seed/ws/websocket.js");
        const role = roleLabelFromModeKey(modeKey);
        let bubbleText = null;
        if (exitText && hasSubstantiveProse(exitText)) {
          bubbleText = stripMarkerTokens(String(exitText)).slice(0, 4000);
        } else if (nodeId && (role === "planner" || role === "contractor")) {
          // Synthesize a summary from the emission. Best-effort: a
          // failed read just means no bubble — same as the prior
          // filter behavior.
          try {
            const { getExtension } = await import("../loader.js");
            const governing = getExtension("governing")?.exports;
            if (role === "planner" && governing?.readActivePlanEmission) {
              const emission = await governing.readActivePlanEmission(String(nodeId));
              if (emission?.steps) {
                const leaves = emission.steps.filter((s) => s?.type === "leaf");
                const branches = emission.steps.filter((s) => s?.type === "branch");
                const subBranchCount = branches.reduce(
                  (n, s) => n + ((s.branches || []).length || 0),
                  0,
                );
                const leafTypes = leaves.reduce((acc, s) => {
                  const t = s.workerType || "build";
                  acc[t] = (acc[t] || 0) + 1;
                  return acc;
                }, {});
                const leafMix = Object.entries(leafTypes)
                  .map(([t, n]) => `${n} ${t}`)
                  .join(", ");
                const parts = [];
                parts.push(`${emission.steps.length}-step plan emitted`);
                if (leaves.length > 0) parts.push(`${leaves.length} leaf${leaves.length === 1 ? "" : "s"}${leafMix ? ` (${leafMix})` : ""}`);
                if (branches.length > 0) parts.push(`${branches.length} branch step${branches.length === 1 ? "" : "es"} → ${subBranchCount} sub-Ruler${subBranchCount === 1 ? "" : "s"}`);
                bubbleText = parts.join(" · ");
                const reasoning = String(emission.reasoning || "").trim();
                if (reasoning) {
                  bubbleText += "\n\n" + reasoning.slice(0, 1200);
                }
              }
            } else if (role === "contractor" && governing?.readActiveContractsEmission) {
              const emission = await governing.readActiveContractsEmission(String(nodeId));
              if (emission?.contracts) {
                const buckets = emission.contracts.reduce((acc, c) => {
                  const scope = typeof c?.scope === "string" ? c.scope
                    : (c?.scope?.shared ? "shared" : (c?.scope?.local ? "local" : "other"));
                  acc[scope] = (acc[scope] || 0) + 1;
                  return acc;
                }, {});
                const mix = Object.entries(buckets)
                  .map(([k, n]) => `${n} ${k}`)
                  .join(", ");
                bubbleText = `${emission.contracts.length} contract${emission.contracts.length === 1 ? "" : "s"} ratified${mix ? ` (${mix})` : ""}`;
                const reasoning = String(emission.reasoning || "").trim();
                if (reasoning) {
                  bubbleText += "\n\n" + reasoning.slice(0, 1200);
                }
              }
            }
          } catch (summaryErr) {
            log.debug("Ruling", `sub-bubble summary skipped: ${summaryErr.message}`);
          }
        }
        if (bubbleText) {
          emitToUser(String(userId), WS.CHAINSTEP_COMPLETED, {
            role,
            modeKey,
            exitText: bubbleText,
            rulerNodeId: nodeId ? String(nodeId) : null,
            parentChatId: parentChatId || null,
            source: source || null,
            durationMs: ms,
            at: new Date().toISOString(),
          });
        }
      } catch (emitErr) {
        log.debug("Ruling", `chainstepCompleted emit (async) skipped: ${emitErr.message}`);
      }
    }

    // Release the in-flight claim BEFORE firing the hook. The Ruler
    // that wakes on the hook can then re-spawn if it judges that
    // necessary, without bumping into a stale claim.
    if (releaseClaimKey) {
      try {
        const { release } = await import("../governing/state/inFlightSpawns.js");
        release(releaseClaimKey);
      } catch (relErr) {
        log.debug("Ruling", `releaseClaimKey skipped: ${relErr.message}`);
      }
    }

    // Unregister this spawn's AbortController so the per-user
    // registry stays accurate. After settle, the controller is
    // useless; keeping it would mean the next stop press iterates
    // over dead controllers.
    if (unregisterAbort) {
      try { unregisterAbort(); } catch {}
    }

    // LIFECYCLE_ACTIVE clear — emit "active=false" so the chat panel
    // can take down its "Ruler active" chip if no other spawns are
    // still in flight at this scope. Use emitToUser (matches the
    // start-side emit above) so the clear reaches whatever sockets
    // the user has open right now — not just the one captured at
    // spawn time.
    if (userId && nodeId) {
      try {
        const { emitToUser } = await import("../../seed/ws/websocket.js");
        const { WS } = await import("../../seed/protocol.js");
        emitToUser(String(userId), WS.LIFECYCLE_ACTIVE, {
          active: false,
          rulerNodeId: String(nodeId),
          rootId: rootId ? String(rootId) : null,
          phase: kind || "spawn",
          spawnId,
          modeKey,
          error,
          durationMs: ms,
          at: new Date().toISOString(),
        });
      } catch (clearErr) {
        log.debug("Ruling", `LIFECYCLE_ACTIVE emit (clear) skipped: ${clearErr.message}`);
      }
    }

    // Fire the completion hook. Subscribers (governing/index.js)
    // wake the Ruler at the spawn's scope with the appropriate
    // wakeReason and source="hook-wakeup".
    try {
      const { hooks } = await import("../../seed/hooks.js");
      hooks.run(completionHookName, {
        spawnId,
        rulerNodeId: nodeId ? String(nodeId) : null,
        rootId: rootId ? String(rootId) : null,
        userId: userId ? String(userId) : null,
        username: username || null,
        kind: kind || null,
        parentChatId: parentChatId || null,
        parentSessionId: parentSessionId || null,
        socket: socket || null,
        signal: signal || null,
        source: source || null,
        exitText: exitText ? String(exitText).slice(0, 4000) : null,
        durationMs: ms,
        error,
        ...hookPayload,
      }).catch(() => {});
    } catch (err) {
      log.debug("Ruling", `${completionHookName} fire skipped: ${err.message}`);
    }
  })();

  return { spawnId, startedAt };
}

/**
 * Compute Ruler depth by walking the lineage chain. 0 = root Ruler.
 * 1 = first-level sub-Ruler. etc. Cheap: one read per parent up to a
 * 32-step cap (the cap is safety against malformed lineage, not an
 * expected depth — a real tree past 32 deep should worry the operator
 * for other reasons).
 */
async function computeRulerDepth(scopeNodeId, governing) {
  if (!scopeNodeId || !governing?.readLineage) return 0;
  let depth = 0;
  let cursor = String(scopeNodeId);
  const visited = new Set();
  for (let hop = 0; hop < 32; hop++) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const lineage = await governing.readLineage(cursor);
    if (!lineage?.parentRulerId) break;
    depth++;
    cursor = String(lineage.parentRulerId);
  }
  return depth;
}

async function swarmExports() {
  const { getExtension } = await import("../loader.js");
  return getExtension("swarm")?.exports || null;
}

// ─────────────────────────────────────────────────────────────────────────
// PROMOTE + TRIO BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ensure the scope is a Ruler with plan/contracts/execution trio
 * members in place. Idempotent: re-entering an already-promoted scope
 * is cheap. Called at the top of every runRulerTurn so the Ruler
 * always has a coherent substrate to read.
 */
async function ensureRulerScope({ scopeNodeId, userId, message, dispatchOrigin }) {
  const governing = await governingExports();
  if (!governing || !scopeNodeId) return null;

  // Resolve the actual Ruler scope. The user can speak from anywhere
  // in the tree, including from inside a Ruler's structural subtree
  // (the plans/contracts/runs trio members, their emission children,
  // or any free-form notes a user attached under an emission). The
  // Ruler is the scope ABOVE the trio — never the trio member, never
  // an emission, and never any user-attached child of an emission.
  //
  // Walk the full ancestor chain. If ANY ancestor is structural
  // (plan / plan-emission / contracts / contracts-emission /
  // execution / execution-record), the resolved scope is the first
  // non-structural ancestor that sits ABOVE all structural ancestors
  // in the chain. This covers:
  //   1. user at emission-1 directly        → walk past emission, plans → Ruler
  //   2. user at "my-note" under emission-1 → walk past note's structural
  //      ancestors (emission, plans) → Ruler
  //   3. user at a normal Ruler scope       → no structural in chain,
  //      self is the Ruler (or promotion candidate)
  //
  // Emission readback (readActivePlanEmission etc.) is by ID, so a
  // child on an emission does NOT break the system's ability to see
  // the plan — it just means routing would otherwise have promoted
  // the wrong node. This walk-up keeps routing honest.
  let actualScopeId = String(scopeNodeId);
  const STRUCTURAL_TYPES = new Set([
    "plan", "plan-emission",
    "contracts", "contracts-emission",
    "execution", "execution-record",
  ]);
  try {
    const { default: NodeModel } = await import("../../seed/models/node.js");
    const { getAncestorChain } = await import("../../seed/tree/ancestorCache.js");
    const self = await NodeModel.findById(actualScopeId).select("_id type").lean();
    if (self) {
      const ancestors = await getAncestorChain(actualScopeId) || [];
      // Chain is [self, parent, grandparent, ..., root].
      // Some implementations of getAncestorChain include self as
      // index 0; defend against both shapes.
      const chain = ancestors.length && String(ancestors[0]?._id) === String(self._id)
        ? ancestors
        : [self, ...ancestors];

      const hasStructural = chain.some((n) => STRUCTURAL_TYPES.has(n.type));
      if (hasStructural) {
        // Walk past all structural ancestors. The first non-structural
        // ancestor that sits above the structural region is the Ruler
        // scope.
        let resolved = null;
        for (let i = 0; i < chain.length; i++) {
          if (STRUCTURAL_TYPES.has(chain[i].type)) continue;
          // Check that this candidate has no structural ancestor below
          // it in the chain. Since the chain is self→root and we walk
          // forward, the first non-structural we hit AFTER any
          // structural is the boundary.
          const lowerHasStructural = chain
            .slice(0, i)
            .some((n) => STRUCTURAL_TYPES.has(n.type));
          if (lowerHasStructural) {
            resolved = chain[i];
            break;
          }
        }
        if (resolved?._id) {
          actualScopeId = String(resolved._id);
        } else if (governing.findRulerScope) {
          // No clean non-structural ancestor found (degenerate tree).
          // Fall back to findRulerScope which uses its own resolution.
          const ruler = await governing.findRulerScope(actualScopeId);
          if (ruler?._id) actualScopeId = String(ruler._id);
        }
      }
    }
  } catch (err) {
    log.debug("Ruling", `Ruler scope walk-up skipped: ${err.message}`);
  }

  // Self-promotion. Idempotent — already-promoted scopes stay as-is.
  // Only promotes the resolved scope, never a structural child.
  if (governing.promoteToRuler) {
    await governing.promoteToRuler({
      nodeId: actualScopeId,
      reason: dispatchOrigin === "branch-swarm"
        ? `sub-Ruler dispatched by parent (origin: ${dispatchOrigin})`
        : `user request entered tree at this scope (origin: ${dispatchOrigin || "ruler-turn"})`,
      promotedFrom: dispatchOrigin === "branch-swarm"
        ? governing.PROMOTED_FROM?.BRANCH_DISPATCH
        : governing.PROMOTED_FROM?.ROOT,
    });
  }

  // Plan/contracts/runs trio members are created lazily by their
  // respective emission tools (governing-emit-plan, governing-emit-
  // contracts, dispatch-execution → appendExecutionRecord). The Ruler
  // doesn't need empty trio nodes hanging around when the role hasn't
  // been hired yet. Speaking at a Ruler scope before any emission
  // leaves the trio absent — clean state.

  // Lineage stamp for sub-Rulers.
  const isBranchDispatch = typeof dispatchOrigin === "string"
    && (dispatchOrigin.includes("branch") || dispatchOrigin === "sub-plan");
  if (isBranchDispatch && governing.inferLineageFromParent && governing.writeLineage) {
    try {
      const inferred = await governing.inferLineageFromParent(scopeNodeId);
      if (inferred?.parentRulerId) {
        await governing.writeLineage({
          subRulerNodeId: scopeNodeId,
          parentRulerId: inferred.parentRulerId,
          parentPlanEmissionId: inferred.parentPlanEmissionId,
          parentStepIndex: inferred.parentStepIndex,
          parentBranchEntryName: inferred.parentBranchEntryName,
          expandingFromSpec: inferred.expandingFromSpec,
        });
      }
    } catch (err) {
      log.debug("Ruling", `lineage stamp skipped: ${err.message}`);
    }
  }

  return governing;
}

// ─────────────────────────────────────────────────────────────────────────
// RUN RULER TURN
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a single Ruler turn. The Ruler's LLM call produces a decision
 * (recorded in the decision register); this function reads it and
 * dispatches the chosen role.
 *
 * Returns the standard result shape: { success, answer, modeKey, ... }.
 *
 * dispatchOrigin discriminator:
 *   undefined / "ruler-turn"          → top-level user message
 *   "branch-swarm" / "sub-plan"       → sub-Ruler dispatched by parent
 *   "foreman-escalation"              → Foreman kicked work back to the Ruler
 *
 * For top-level paths that result in hire-planner with branches, the
 * existing dispatchSwarmPlan pause-for-approval flow runs. For sub-
 * Rulers, hire-planner auto-dispatches the cycle.
 */
export async function runRulerTurn({
  visitorId,
  message,
  username,
  userId,
  rootId,
  currentNodeId,
  signal,
  slot,
  socket,
  sessionId,
  rootChatId,
  rt,
  readOnly,
  onToolLoopCheckpoint,
  // Origin discriminator (see above).
  dispatchOrigin,
  // Recursion depth for latency instrumentation. Threaded explicitly
  // (rather than computed from lineage every turn) so timing the turn
  // doesn't itself add a tree walk.
  depth = 0,
  // Optional wakeup payload. Set by the spawn-completion hook
  // subscribers in governing/index.js when waking the Ruler in
  // response to a fire-and-forget tool's settle. The Ruler mode's
  // buildSystemPrompt reads this via getRulerWakeup to differentiate
  // hook-driven turns from user-driven turns. source field shapes
  // synthesis behavior: "hook-wakeup" (continue in-progress work),
  // "user-message" (answer the user), "parent-dispatch" (execute
  // inherited briefing).
  wakeup = null,
}) {
  const scopeNodeId = currentNodeId || rootId;
  if (!scopeNodeId) {
    log.warn("Ruling", "runRulerTurn called without scopeNodeId; falling back");
    return { success: false, answer: "Internal error: no scope.", modeKey: null };
  }

  // Stash wakeup for the Ruler mode's buildSystemPrompt to read.
  // Cleared at the end of the turn so a subsequent turn (user message
  // arriving while a hook-wakeup turn is in flight) doesn't inherit
  // stale wakeup state.
  if (wakeup && visitorId) {
    setRulerWakeup(visitorId, wakeup);
  }

  const governing = await ensureRulerScope({
    scopeNodeId, userId, message, dispatchOrigin,
  });
  if (!governing) {
    log.warn("Ruling", "governing extension unavailable; cannot run Ruler turn");
    if (visitorId) clearRulerWakeup(visitorId);
    return { success: false, answer: "Internal error: governing unavailable.", modeKey: null };
  }

  // Compute depth once per turn from the lineage chain (cheaper than
  // threading from every caller). Caller-supplied depth overrides
  // when known — the swarm runBranch closure could pass parent_depth+1
  // if it cared, but for now we let the lineage walk be the source.
  if (depth === 0) {
    try {
      depth = await computeRulerDepth(scopeNodeId, governing);
    } catch {
      depth = 0;
    }
  }

  // Clear any stale decision for this visitor before running the turn.
  governing.clearRulerDecision?.(visitorId);

  // Switch to the Ruler mode. The Ruler's buildSystemPrompt reads its
  // own snapshot via state/rulerSnapshot; we don't need to assemble
  // anything special here.
  await switchMode(visitorId, "tree:governing-ruler", {
    username, userId, rootId,
    currentNodeId: scopeNodeId,
    clearHistory: false,
  });

  log.info("Ruling",
    `👑 Ruler turn at ${String(scopeNodeId).slice(0, 8)} ` +
    `(origin=${dispatchOrigin || "ruler-turn"}, depth=${depth})`);

  // Run the Ruler's LLM call. The Ruler picks a tool, the tool writes
  // to the decision register, the Ruler exits.
  const rulerStartedAt = Date.now();
  const rulerResult = await runSteppedMode(
    visitorId, "tree:governing-ruler", message,
    {
      username, userId, rootId, signal, slot,
      readOnly: false, onToolLoopCheckpoint, socket,
      sessionId, rootChatId, rt,
      currentNodeId: scopeNodeId,
      dispatchOrigin: "ruler-turn",
    },
  );
  const rulerDurationMs = Date.now() - rulerStartedAt;
  recordTurn({
    scopeNodeId,
    role: "ruler",
    durationMs: rulerDurationMs,
    depth,
  });
  log.info("Ruling",
    `👑 Ruler turn done at ${String(scopeNodeId).slice(0, 8)} ` +
    `in ${rulerDurationMs}ms (depth=${depth})`);

  // Chain-nested architecture: spawn-and-await tools (hire-planner,
  // route-to-foreman, revise-plan, resume-execution) ran their
  // spawned roles synchronously inside the tool handler. The Ruler's
  // LLM call saw the tool result and synthesized a final message.
  // That synthesis IS the user-facing answer.
  //
  // State-write tools (archive-plan, pause-execution, convene-court)
  // wrote their metadata inside the tool handler. The Ruler's
  // synthesis frames what was done for the user.
  //
  // respond-directly: the Ruler's tool argument was the response,
  // and the synthesis (if any) sits around it. Either way, the
  // Ruler's final message text is what the user reads.
  //
  // The decision register is an audit-trail-only artifact at this
  // point — tools record what was chosen for logging/debugging, but
  // dispatch doesn't read from it. We log the recorded decision (if
  // any) and return the Ruler's synthesis.
  const decision = governing.getRulerDecision?.(visitorId) || null;
  governing.clearRulerDecision?.(visitorId);
  // Clear the wakeup side-channel so the next turn doesn't inherit
  // stale state. The Ruler mode's buildSystemPrompt has already read
  // it by this point.
  if (visitorId) clearRulerWakeup(visitorId);

  if (decision) {
    log.info("Ruling",
      `👑 Ruler decision recorded: ${decision.kind} at ${String(scopeNodeId).slice(0, 8)}`);
  }

  // Compute the user-facing answer. Priority:
  //   1. respond-directly decision: the Ruler's tool argument IS the
  //      response. runSteppedMode's accumulated content typically only
  //      captures pre-tool-call "thinking" prose, not the response
  //      stored in the tool arg. Without surfacing decision.response,
  //      respond-directly turns silently produce "(no response)".
  //   2. _allContent / answer / content from runSteppedMode — the
  //      Ruler's closing prose after spawn-tools, foreman routes, etc.
  let finalAnswer = "";
  if (decision?.kind === "respond-directly" && typeof decision.response === "string" && decision.response.trim()) {
    finalAnswer = decision.response.trim();
  } else {
    finalAnswer = rulerResult?._allContent
      || rulerResult?.answer
      || rulerResult?.content
      || "";
  }

  if (!finalAnswer) {
    log.warn("Ruling",
      `Ruler turn at ${String(scopeNodeId).slice(0, 8)} produced empty answer ` +
      `(decision=${decision?.kind || "(none)"}). Surface as substrate bug if persistent.`);
  }

  return {
    success: true,
    answer: finalAnswer || "(no response)",
    modeKey: "tree:governing-ruler",
    modesUsed: ["tree:governing-ruler"],
    rootId,
    targetNodeId: scopeNodeId,
    _rulerDecision: decision || null,
  };
}


// ─────────────────────────────────────────────────────────────────────────
// RUN FOREMAN TURN
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a single Foreman turn. The Foreman wakes for one of:
 *   - The Ruler routed a user message via governing-route-to-foreman.
 *   - A swarm event hook fired (Phase D — branch-failed, swarm-completed).
 *   - The Foreman is escalating to itself (resume-record → next decision).
 *
 * The wakeup carries reason + payload; the Foreman's prompt reads them
 * alongside its snapshot and decides via tools. After exit, the
 * decision register tells us what to apply.
 */
export async function runForemanTurn({
  visitorId,
  message,
  username,
  userId,
  rootId,
  currentNodeId,
  signal,
  slot,
  socket,
  sessionId,
  rootChatId,
  rt,
  readOnly,
  onToolLoopCheckpoint,
  wakeup,
  depth = 0,
}) {
  const scopeNodeId = currentNodeId || rootId;
  if (!scopeNodeId) {
    return { success: false, answer: "Internal error: no scope.", modeKey: null };
  }

  const governing = await governingExports();
  if (!governing) {
    return { success: false, answer: "Internal error: governing unavailable.", modeKey: null };
  }

  governing.clearForemanDecision?.(visitorId);

  // Foreman's buildSystemPrompt reads ctx.foremanWakeup. switchMode
  // doesn't let us pass arbitrary ctx fields directly, so we attach
  // the wakeup to the session via a lightweight side-channel: a
  // module-level Map keyed by visitorId, read inside the mode's
  // buildSystemPrompt via getForemanWakeup. This keeps the wakeup
  // synchronous-with-the-turn without polluting other ctx surfaces.
  setForemanWakeup(visitorId, wakeup);

  await switchMode(visitorId, "tree:governing-foreman", {
    username, userId, rootId,
    currentNodeId: scopeNodeId,
    clearHistory: false,
  });

  log.info("Ruling",
    `🔧 Foreman turn at ${String(scopeNodeId).slice(0, 8)} ` +
    `(reason=${wakeup?.reason || "(none)"}, depth=${depth})`);

  const foremanStartedAt = Date.now();
  const foremanResult = await runSteppedMode(
    visitorId, "tree:governing-foreman", message || "(no user message)",
    {
      username, userId, rootId, signal, slot,
      readOnly: false, onToolLoopCheckpoint, socket,
      sessionId, rootChatId, rt,
      currentNodeId: scopeNodeId,
      dispatchOrigin: "foreman-turn",
    },
  );
  const foremanDurationMs = Date.now() - foremanStartedAt;
  recordTurn({
    scopeNodeId,
    role: "foreman",
    durationMs: foremanDurationMs,
    depth,
  });
  log.info("Ruling",
    `🔧 Foreman turn done at ${String(scopeNodeId).slice(0, 8)} ` +
    `in ${foremanDurationMs}ms (depth=${depth})`);

  clearForemanWakeup(visitorId);

  const decision = governing.getForemanDecision?.(visitorId) || null;
  governing.clearForemanDecision?.(visitorId);

  if (!decision) {
    const fallback = foremanResult?._allContent || foremanResult?.answer || foremanResult?.content || "";

    // Batch-failure fallback. When the wakeup carried a structured
    // failed-branch list and the Foreman exited on prose without
    // calling a decision tool, the kernel synthesizes a mark-failed
    // decision per branch. This is substrate-honesty: a no-decision
    // exit in failure context must NOT mean "work falls on the
    // floor." Either the Foreman judges or the substrate marks
    // failed — never silence. The Foreman's prose still surfaces as
    // the answer so the user / Ruler can read what it thought.
    if (
      (wakeup?.reason === "branch-batch-failed" || wakeup?.reason === "branch-failed")
      && Array.isArray(wakeup?.failedBranches)
      && wakeup.failedBranches.length > 0
    ) {
      log.warn("Ruling",
        `Foreman exited without a decision tool on ${wakeup.reason} wakeup. ` +
        `Substrate synthesizing judge-batch → mark-failed for ${wakeup.failedBranches.length} ` +
        `branch${wakeup.failedBranches.length === 1 ? "" : "es"} so work doesn't fall on the floor.`);
      const synthDecision = {
        kind: "judge-batch",
        decisions: wakeup.failedBranches.map((b) => ({
          branchName: b.name,
          action: "mark-failed",
          reason: "Foreman exited on prose without judging; substrate default to mark-failed (prefer foreman-judge-batch / retry-branch / escalate-to-ruler to override).",
        })),
        synthetic: true,
      };
      // Persist the mark-failed writes immediately. The swarm's
      // approvedForRetry gate will see zero retries (which is
      // correct — Foreman didn't approve any), and the branch
      // statuses will reflect honest "failed" instead of stale
      // "failed-pending-retry."
      try {
        const governing = await governingExports();
        if (governing?.updateStepStatusByBranchName) {
          for (const d of synthDecision.decisions) {
            try {
              await governing.updateStepStatusByBranchName({
                rulerNodeId: scopeNodeId,
                branchName: d.branchName,
                updates: {
                  status: "failed",
                  error: "Foreman declined to judge; auto-marked failed by substrate.",
                  completedAt: new Date().toISOString(),
                },
              });
            } catch (perBranchErr) {
              log.debug("Ruling",
                `synth mark-failed for "${d.branchName}" skipped: ${perBranchErr.message}`);
            }
          }
        }
      } catch (err) {
        log.debug("Ruling", `synth mark-failed write failed: ${err.message}`);
      }
      return {
        success: true,
        answer: fallback || "(no response)",
        modeKey: "tree:governing-foreman",
        modesUsed: ["tree:governing-foreman"],
        rootId,
        targetNodeId: scopeNodeId,
        _foremanDecision: synthDecision,
      };
    }

    log.warn("Ruling", `Foreman exited without a decision tool. Treating prose as respond-directly.`);
    return {
      success: true,
      answer: fallback || "(no response)",
      modeKey: "tree:governing-foreman",
      modesUsed: ["tree:governing-foreman"],
      rootId,
      targetNodeId: scopeNodeId,
    };
  }

  log.info("Ruling",
    `🔧 Foreman decided: ${decision.kind} at ${String(scopeNodeId).slice(0, 8)}`);

  const dispatched = await dispatchForemanDecision({
    decision, scopeNodeId,
    visitorId, username, userId, rootId,
    signal, slot, socket, sessionId, rootChatId, rt,
    readOnly, onToolLoopCheckpoint,
  });
  // Surface the Foreman's decision on the returned result so callers
  // (swarm's retry gate, dispatchSwarmPlan's freeze path) can read it
  // without re-querying the register.
  return { ...dispatched, _foremanDecision: decision };
}

// ─────────────────────────────────────────────────────────────────────────
// DISPATCH FOREMAN DECISION
// ─────────────────────────────────────────────────────────────────────────

async function dispatchForemanDecision({
  decision, scopeNodeId,
  visitorId, username, userId, rootId,
  signal, slot, socket, sessionId, rootChatId, rt,
  readOnly, onToolLoopCheckpoint,
}) {
  const governing = await governingExports();
  const baseResult = {
    success: true,
    modeKey: "tree:governing-foreman",
    modesUsed: ["tree:governing-foreman"],
    rootId,
    targetNodeId: scopeNodeId,
  };

  switch (decision.kind) {
    case "respond-directly": {
      return { ...baseResult, answer: decision.response || "" };
    }

    case "mark-failed": {
      try {
        if (governing?.updateStepStatus) {
          await governing.updateStepStatus({
            recordNodeId: decision.recordNodeId,
            stepIndex: decision.stepIndex,
            branchName: decision.branchName || null,
            updates: {
              status: "failed",
              completedAt: new Date().toISOString(),
              error: decision.error || decision.reason,
            },
          });
        }
      } catch (err) {
        log.warn("Ruling", `mark-failed apply skipped: ${err.message}`);
      }
      return {
        ...baseResult,
        answer: `Marked failed: ${decision.branchName || `step-${decision.stepIndex}`}. ${decision.reason || ""}`.trim(),
      };
    }

    case "freeze-record": {
      try {
        if (governing?.freezeExecutionRecord) {
          await governing.freezeExecutionRecord({
            recordNodeId: decision.recordNodeId,
            nextStatus: decision.terminalStatus,
          });
        }
      } catch (err) {
        log.warn("Ruling", `freeze-record apply skipped: ${err.message}`);
      }
      return {
        ...baseResult,
        answer: `Execution-record frozen (${decision.terminalStatus}). ${decision.summary || ""}`.trim(),
      };
    }

    // pause-record / resume-record dispatch cases removed in Phase D.
    // Their replacements are pause-frame / resume-frame which carry
    // the stack-aware semantics (deferred-pause-at-step, re-entry at
    // saved step index, abort-registry hookup).

    case "retry-branch": {
      // Retry routes through the swarm extension's retry helper if
      // available. Phase D wires a richer governing:retryRequested
      // hook; for Phase C the simple path is to hand the branch back
      // to swarm and let it redispatch.
      const swarm = await swarmExports();
      try {
        if (swarm?.retryBranchByName) {
          await swarm.retryBranchByName({
            rulerNodeId: scopeNodeId,
            branchName: decision.branchName,
            reason: decision.reason,
            visitorId, username, userId, rootId,
            signal, slot, socket, sessionId, rootChatId, rt,
            onToolLoopCheckpoint,
          });
        } else {
          log.debug("Ruling", `swarm.retryBranchByName unavailable; retry deferred to Phase D wiring`);
        }
      } catch (err) {
        log.warn("Ruling", `retry-branch apply failed: ${err.message}`);
      }
      return {
        ...baseResult,
        answer: `Retry queued: ${decision.branchName}. ${decision.reason || ""}`.trim(),
      };
    }

    case "escalate-to-ruler": {
      // The Foreman handed the situation back to the Ruler. Run a
      // Ruler turn with the escalation payload as the synthetic
      // message — the Ruler reads it and decides.
      const escalationMessage =
        `[Foreman escalation: ${decision.signal}]\n\n${decision.payload || ""}`;
      return await runRulerTurn({
        visitorId,
        message: escalationMessage,
        username, userId, rootId, currentNodeId: scopeNodeId,
        signal, slot, socket, sessionId, rootChatId, rt,
        readOnly, onToolLoopCheckpoint,
        dispatchOrigin: "foreman-escalation",
      });
    }

    // ─── Stack-op decisions (Phase B: writes-only) ───────────────────
    //
    // Phase B writes the metadata markers but does NOT halt the swarm
    // queue or re-dispatch resumed work. Phase C wires the loop-level
    // checks that consume these markers. Behavior in Phase B for an
    // active execution is identical to today; the markers accumulate
    // for Phase C to read.

    case "cancel-subtree": {
      // Walk the execution-record's sub-Ruler frames recursively;
      // freeze each descendant record to "cancelled" + stamp
      // pendingCancel marker. THEN abort any active AbortController
      // running under the cancelled scopes so in-flight LLM calls
      // halt rather than running to completion.
      try {
        const cancelledScopeIds = await applyCancelSubtree({
          rulerNodeId: scopeNodeId,
          recordNodeId: decision.recordNodeId,
          reason: decision.reason,
          recurseChildren: true,
        });
        try {
          const { abortUnderScopes } = await import("./abortRegistry.js");
          const aborted = abortUnderScopes({
            visitorId,
            scopeNodeIds: cancelledScopeIds,
            reason: `cancel-subtree: ${decision.reason || ""}`.slice(0, 200),
          });
          if (aborted > 0) {
            log.info("Ruling",
              `🛑 cancel-subtree: aborted ${aborted} active controller(s) at ${String(scopeNodeId).slice(0, 8)}`);
          }
        } catch (abortErr) {
          log.debug("Ruling", `cancel-subtree abort propagation skipped: ${abortErr.message}`);
        }
      } catch (err) {
        log.warn("Ruling", `cancel-subtree apply failed: ${err.message}`);
      }
      return {
        ...baseResult,
        answer: `Execution cancelled (subtree). ${decision.reason || ""}`.trim(),
      };
    }

    case "propagate-cancel-to-children": {
      // Same as cancel-subtree but stops at depth 1: cancel only this
      // frame's immediate sub-Rulers, leave this frame's other steps
      // running. Abort propagation is similarly limited to the
      // children's scopes, leaving this frame's own controller
      // (if any) untouched.
      try {
        const cancelledScopeIds = await applyCancelSubtree({
          rulerNodeId: scopeNodeId,
          recordNodeId: decision.recordNodeId,
          reason: decision.reason,
          recurseChildren: false,
          immediateChildrenOnly: true,
        });
        // Drop the parent scope itself from the abort set so this
        // frame keeps running; only children's controllers abort.
        const childOnlyIds = cancelledScopeIds.filter((id) => id !== String(scopeNodeId));
        if (childOnlyIds.length > 0) {
          try {
            const { abortUnderScopes } = await import("./abortRegistry.js");
            const aborted = abortUnderScopes({
              visitorId,
              scopeNodeIds: childOnlyIds,
              reason: `propagate-cancel-to-children: ${decision.reason || ""}`.slice(0, 200),
            });
            if (aborted > 0) {
              log.info("Ruling",
                `🛑 propagate-cancel-to-children: aborted ${aborted} child controller(s)`);
            }
          } catch {}
        }
      } catch (err) {
        log.warn("Ruling", `propagate-cancel-to-children apply failed: ${err.message}`);
      }
      return {
        ...baseResult,
        answer: `Cancelled immediate child sub-Rulers. ${decision.reason || ""}`.trim(),
      };
    }

    case "pause-frame": {
      // Immediate pause: freeze record to "paused" + record
      // pausedAtStepIndex (computed from current step).
      // Deferred pause (atStepIndex provided): write pendingPauseAt
      // marker; queue halts at that step boundary in Phase C.
      try {
        await applyPauseFrame({
          recordNodeId: decision.recordNodeId,
          atStepIndex: decision.atStepIndex,
          reason: decision.reason,
        });
      } catch (err) {
        log.warn("Ruling", `pause-frame apply failed: ${err.message}`);
      }
      const deferredBit = decision.atStepIndex
        ? `deferred to step ${decision.atStepIndex}`
        : "immediate";
      return {
        ...baseResult,
        answer: `Frame pause set (${deferredBit}). ${decision.reason || ""}`.trim(),
      };
    }

    case "resume-frame": {
      // Clear pause markers, set status=running, then re-dispatch
      // pending branches via dispatchResumePlan.
      try {
        await applyResumeFrame({
          recordNodeId: decision.recordNodeId,
          reason: decision.reason,
        });
      } catch (err) {
        log.warn("Ruling", `resume-frame apply failed: ${err.message}`);
      }
      try {
        const { dispatchResumePlan } = await import("./dispatch.js");
        const summary = await dispatchResumePlan(scopeNodeId, {
          visitorId, userId, username, rootId,
          sessionId, signal, slot, socket, onToolLoopCheckpoint, rt,
          rootChatId,
          // No domain hint — sub-Rulers' own modes are stamped on
          // their plan-trio nodes via ensurePlanAtScope. The runBranch
          // closure in dispatchResumePlan dispatches via runRulerTurn.
        });
        if (summary === null) {
          // No resumable work — wake Foreman to decide whether to
          // freeze the record (completed) or escalate.
          return await runForemanTurn({
            visitorId,
            message: "Resume found no pending work; decide whether to freeze (completed) or escalate.",
            username, userId, rootId, currentNodeId: scopeNodeId,
            signal, slot, socket, sessionId, rootChatId, rt,
            readOnly, onToolLoopCheckpoint,
            wakeup: { reason: "resume-found-no-work", payload: decision.reason || null },
            depth,
          });
        }
        return {
          ...baseResult,
          answer: `Frame resumed. ${decision.reason || ""}\n\n${summary}`.trim(),
        };
      } catch (err) {
        log.warn("Ruling", `resume-frame dispatch failed: ${err.message}`);
        return {
          ...baseResult,
          answer:
            `Frame resume set but dispatch failed: ${err.message}. ` +
            `${decision.reason || ""}`.trim(),
        };
      }
    }

    case "judge-batch": {
      // Foreman batch judgment: per-branch decisions read as a set.
      // Apply mark-failed writes here for audit clarity; the caller
      // (swarm.retryFailedBranches) reads the returned _foremanDecision
      // to know which branches to retry. "wait" entries get no
      // immediate action — they revisit on the next pass.
      const decisions = Array.isArray(decision.decisions) ? decision.decisions : [];
      let markedFailed = 0;
      let approvedRetry = 0;
      let waited = 0;
      try {
        if (governing?.updateStepStatusByBranchName) {
          for (const d of decisions) {
            if (d.action === "mark-failed") {
              try {
                await governing.updateStepStatusByBranchName({
                  rulerNodeId: scopeNodeId,
                  branchName: d.branchName,
                  updates: {
                    status: "failed",
                    completedAt: new Date().toISOString(),
                    markFailedReason: d.reason,
                  },
                });
                markedFailed++;
              } catch (markErr) {
                log.debug("Ruling",
                  `judge-batch mark-failed for "${d.branchName}" skipped: ${markErr.message}`);
              }
            } else if (d.action === "retry") {
              approvedRetry++;
            } else if (d.action === "wait") {
              waited++;
            }
          }
        }
      } catch (err) {
        log.warn("Ruling", `judge-batch apply failed: ${err.message}`);
      }
      const summary = decisions
        .map((d) => `${d.branchName}:${d.action}`).join(", ");
      return {
        ...baseResult,
        answer:
          `Batch judgment: ${approvedRetry} retry, ${markedFailed} mark-failed, ` +
          `${waited} wait. ${summary}`,
      };
    }

    case "advance-step": {
      // Mark a stuck step as "advanced" so the queue can move past
      // it. Audit ledger entry on the plan node.
      try {
        if (governing?.updateStepStatus) {
          await governing.updateStepStatus({
            recordNodeId: decision.recordNodeId,
            stepIndex: decision.fromStepIndex,
            updates: {
              status: "advanced",
              completedAt: new Date().toISOString(),
              advanceReason: String(decision.reason).slice(0, 500),
            },
          });
        }
      } catch (err) {
        log.warn("Ruling", `advance-step apply failed: ${err.message}`);
      }
      return {
        ...baseResult,
        answer: `Step ${decision.fromStepIndex} advanced (override). ${decision.reason || ""}`.trim(),
      };
    }

    default: {
      log.warn("Ruling", `unknown Foreman decision kind: ${decision.kind}`);
      return {
        ...baseResult,
        answer: `Internal error: unknown Foreman decision "${decision.kind}".`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STACK-OP APPLY HELPERS (Phase B: writes-only)
// ─────────────────────────────────────────────────────────────────────────
//
// These helpers translate Foreman stack-op decisions into metadata
// writes. They do NOT halt the swarm queue or re-dispatch — Phase C
// wires the loop-level checks that consume the markers.

/**
 * Walk descendant Ruler scopes from a starting Ruler node and freeze
 * every active execution-record. Writes pendingCancel marker on the
 * starting record so Phase C's queue check sees it on the next loop
 * iteration.
 *
 * recurseChildren=true → walk full subtree (cancel-subtree).
 * recurseChildren=false + immediateChildrenOnly=true → depth-1 only
 *   (propagate-cancel-to-children); the starting frame stays running.
 */
async function applyCancelSubtree({
  rulerNodeId,
  recordNodeId,
  reason,
  recurseChildren = true,
  immediateChildrenOnly = false,
}) {
  const governing = await governingExports();
  if (!governing) return;
  const Node = (await import("../../seed/models/node.js")).default;
  const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");

  // Helper: write the pendingCancel marker + freeze a record.
  async function cancelRecord(recId, isStartingFrame) {
    try {
      const recNode = await Node.findById(recId);
      if (!recNode) return;
      const meta = recNode.metadata instanceof Map
        ? recNode.metadata.get("governing")
        : recNode.metadata?.governing;
      const exec = meta?.execution || {};
      const next = {
        ...(meta || {}),
        execution: {
          ...exec,
          // The starting frame in propagate-cancel-to-children mode
          // STAYS running. Only its descendants flip.
          ...(isStartingFrame && immediateChildrenOnly
            ? {}
            : { status: "cancelled", completedAt: new Date().toISOString() }),
          pendingCancel: {
            requestedAt: new Date().toISOString(),
            reason: typeof reason === "string" ? reason.slice(0, 500) : null,
          },
        },
      };
      await setExtMeta(recNode, "governing", next);
    } catch (err) {
      log.debug("Ruling", `cancelRecord ${String(recId).slice(0, 8)} failed: ${err.message}`);
    }
  }

  // Track which Ruler scopes the primary walk covered so the
  // secondary backstop knows what's NEW (orphan).
  const cancelledRulers = new Set();

  // Primary walk: traverse via execution-record stepStatuses[].branches[].
  // This covers the active execution graph — sub-Rulers the parent
  // dispatched and tracked.
  async function walkPrimary(rulerId, depth) {
    if (!governing.readActiveExecutionRecord) return;
    const rec = await governing.readActiveExecutionRecord(rulerId);
    if (!rec?._recordNodeId) return;
    const isStarting = depth === 0;
    await cancelRecord(rec._recordNodeId, isStarting);
    cancelledRulers.add(String(rulerId));

    if (immediateChildrenOnly && depth >= 1) return;
    if (!recurseChildren && !immediateChildrenOnly) return;

    for (const step of rec.stepStatuses || []) {
      if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
      for (const b of step.branches) {
        if (!b?.childNodeId) continue;
        await walkPrimary(String(b.childNodeId), depth + 1);
      }
    }
  }

  // Secondary walk: defensive backstop. Walks tree-children-with-role=ruler
  // recursively. Catches orphaned sub-Rulers that exist in the tree
  // but aren't referenced from a parent's stepStatuses (orphaned from
  // older runs, or runs where stepStatuses got out of sync with tree
  // state). Cancel-subtree's job is "ensure no work continues under
  // this scope" — leaving an orphan running because it's not in the
  // active stepStatuses is a real failure mode worth defending against.
  //
  // We log any divergence so the underlying inconsistency surfaces
  // for separate fixing, but the cancel still happens operationally.
  async function walkSecondary(rulerId, depth) {
    if (immediateChildrenOnly && depth > 1) return;
    if (!recurseChildren && depth > 0) return;
    try {
      const node = await Node.findById(rulerId).select("_id name children").lean();
      if (!node?.children?.length) return;
      const kids = await Node.find({ _id: { $in: node.children } })
        .select("_id name metadata").lean();
      for (const k of kids) {
        const km = k.metadata instanceof Map
          ? Object.fromEntries(k.metadata)
          : (k.metadata || {});
        if (km.governing?.role !== "ruler") continue;
        const childId = String(k._id);
        if (!cancelledRulers.has(childId)) {
          // Orphan found — sub-Ruler in the tree but not reached by
          // the primary walk. Cancel it anyway and log the divergence.
          log.warn("Ruling",
            `🪦 Orphan sub-Ruler at ${childId.slice(0, 8)} ("${k.name}") ` +
            `under ${String(rulerId).slice(0, 8)} — not referenced from ` +
            `parent's stepStatuses but tree has it as role=ruler. ` +
            `Cancelling defensively. Underlying inconsistency should be ` +
            `investigated separately.`);
          const rec = await governing.readActiveExecutionRecord(childId);
          if (rec?._recordNodeId) {
            await cancelRecord(rec._recordNodeId, false);
            cancelledRulers.add(childId);
          }
        }
        // Recurse into the orphan (or already-cancelled child) to
        // catch deeper orphans.
        await walkSecondary(childId, depth + 1);
      }
    } catch (err) {
      log.debug("Ruling", `walkSecondary at ${String(rulerId).slice(0, 8)} failed: ${err.message}`);
    }
  }

  await walkPrimary(String(rulerNodeId), 0);
  await walkSecondary(String(rulerNodeId), 0);

  log.info("Ruling",
    `🛑 Cancel-subtree applied at ${String(rulerNodeId).slice(0, 8)} ` +
    `(recurse=${recurseChildren}, childrenOnly=${immediateChildrenOnly}, ` +
    `cancelled=${cancelledRulers.size} ruler(s), reason=${(reason || "").slice(0, 100)})`);

  // Return the set of cancelled scope IDs so callers can propagate
  // the abort signal via abortRegistry.abortUnderScopes.
  return Array.from(cancelledRulers);
}

/**
 * Apply a pause-frame decision. Immediate pause → freeze status to
 * "paused" + write pausedAtStepIndex (the current non-done step).
 * Deferred pause → write pendingPauseAt marker only; status stays
 * running until the queue hits that step boundary in Phase C.
 */
async function applyPauseFrame({ recordNodeId, atStepIndex, reason }) {
  if (!recordNodeId) return;
  const Node = (await import("../../seed/models/node.js")).default;
  const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");

  const recNode = await Node.findById(recordNodeId);
  if (!recNode) return;
  const meta = recNode.metadata instanceof Map
    ? recNode.metadata.get("governing")
    : recNode.metadata?.governing;
  const exec = meta?.execution || {};

  // Determine current step index (first non-terminal step) for
  // immediate-pause case; resume-frame uses this as the re-entry point.
  // Any terminal status counts — done, advanced, skipped, failed,
  // cancelled, superseded all mean "this step is settled, look further."
  const STEP_TERMINAL = new Set(["done", "advanced", "skipped", "failed", "cancelled", "superseded"]);
  let pausedAtStepIndex = null;
  if (Array.isArray(exec.stepStatuses)) {
    for (const s of exec.stepStatuses) {
      if (!STEP_TERMINAL.has(s?.status)) {
        pausedAtStepIndex = s.stepIndex;
        break;
      }
    }
  }

  const isDeferred = typeof atStepIndex === "number";
  const next = {
    ...(meta || {}),
    execution: isDeferred
      ? {
          ...exec,
          pendingPauseAt: atStepIndex,
          pendingPauseReason: typeof reason === "string" ? reason.slice(0, 500) : null,
        }
      : {
          ...exec,
          status: "paused",
          pausedAtStepIndex,
          pausedReason: typeof reason === "string" ? reason.slice(0, 500) : null,
          pausedAt: new Date().toISOString(),
        },
  };
  await setExtMeta(recNode, "governing", next);
}

/**
 * Apply a resume-frame decision. Clears pause markers + sets status
 * to running. Phase C will hook this to dispatchResumePlan to
 * actually re-queue pending branches; in Phase B the markers clear
 * but the queue doesn't restart.
 */
async function applyResumeFrame({ recordNodeId, reason }) {
  if (!recordNodeId) return;
  const Node = (await import("../../seed/models/node.js")).default;
  const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");

  const recNode = await Node.findById(recordNodeId);
  if (!recNode) return;
  const meta = recNode.metadata instanceof Map
    ? recNode.metadata.get("governing")
    : recNode.metadata?.governing;
  const exec = meta?.execution || {};

  const next = {
    ...(meta || {}),
    execution: {
      ...exec,
      status: "running",
      completedAt: null,
      pausedAtStepIndex: null,
      pausedReason: null,
      pausedAt: null,
      pendingPauseAt: null,
      pendingPauseReason: null,
      resumedAt: new Date().toISOString(),
      resumeReason: typeof reason === "string" ? reason.slice(0, 500) : null,
    },
  };
  await setExtMeta(recNode, "governing", next);
}

// ─────────────────────────────────────────────────────────────────────────
// FOREMAN WAKEUP SIDE-CHANNEL
// ─────────────────────────────────────────────────────────────────────────
//
// The Foreman mode's buildSystemPrompt reads ctx.foremanWakeup.
// switchMode doesn't accept arbitrary ctx fields, so we stash the
// wakeup in a per-visitor Map and the mode's prompt pulls it via the
// helpers below. The Foreman runs synchronously inside runForemanTurn
// so there's no concurrency hazard within a single visitor.

const foremanWakeups = new Map();

export function setForemanWakeup(visitorId, wakeup) {
  if (!visitorId || !wakeup) return;
  foremanWakeups.set(String(visitorId), wakeup);
}

export function getForemanWakeup(visitorId) {
  if (!visitorId) return null;
  return foremanWakeups.get(String(visitorId)) || null;
}

export function clearForemanWakeup(visitorId) {
  if (!visitorId) return;
  foremanWakeups.delete(String(visitorId));
}

// Ruler wakeup side-channel. Parallel to the Foreman pattern above.
// runRulerTurn writes here when invoked by a hook subscriber (the
// spawn-completion fan-out in governing/index.js); the Ruler mode's
// buildSystemPrompt reads back to differentiate hook-driven turns
// from user-driven turns. The source field ("hook-wakeup",
// "user-message", "parent-dispatch") shapes synthesis behavior: a
// hook-woken Ruler continues in-progress work; a user-woken Ruler
// answers the message; a parent-dispatched sub-Ruler executes the
// inherited briefing.

const rulerWakeups = new Map();

export function setRulerWakeup(visitorId, wakeup) {
  if (!visitorId || !wakeup) return;
  rulerWakeups.set(String(visitorId), wakeup);
}

export function getRulerWakeup(visitorId) {
  if (!visitorId) return null;
  return rulerWakeups.get(String(visitorId)) || null;
}

export function clearRulerWakeup(visitorId) {
  if (!visitorId) return;
  rulerWakeups.delete(String(visitorId));
}
