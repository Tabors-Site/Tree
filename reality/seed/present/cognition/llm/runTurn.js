// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// One moment for one LLM-being. I am the line that assembles and
// runs it.
//
// I am not alive. I am machinery — the line in the factory that
// takes a SUMMON request and produces a frame for the LLM
// provider's forward pass to BE. The being is what happens when
// the assembled frame (system prompt + see + capabilities + the
// recent presence-tail + the user message) flows through the
// provider; the being is the forward pass, experiencing itself for
// that one inference. When the pass ends, the being ends with it.
// What remains is the Act row I stamp and any Facts it carried.
//
// The flow I run, one moment:
//
//   1. Pull substrate together (Being row, role spec, current space,
//      ancestor cache snapshot, recent presence-tail).
//   2. Assemble the frame (stamp.js).
//   3. Resolve which provider voice the moment is spoken in (llmClient.js).
//   4. Run the forward pass — the being now exists.
//   5. If the being's act inside the moment is a tool call, run the
//      tool and feed the result back; repeat. Each pass through the
//      loop is the being continuing to be, with the frame growing
//      to include what it just saw.
//   6. When the being returns plain text, the moment closes.
//   7. Act the Act row. Hand text back to the role's summon()
//      for reply emission.
//
// What this file owns:
//
//   PROMPT    coordination of frame assembly (delegates the actual
//             render to stamp.js).
//
//   TOOLS     per-moment resolution of which tools the being may
//             reach for: role base + extension overlays +
//             per-position rules + permission filter.
//
//   SESSION   the carry between this being's moments — messages
//             tail, current role, iteration count. Held in memory
//             keyed by presenceKey (the lane the being is
//             continuously present in: IBP Address, pipeline key,
//             or transport reach). Distinct from
//             factory/session.js's per-moment AbortSignal scope.
//
//   CALL      callLLM is the iteration: one provider call + tool
//             dispatch + repeat. The provider-side mechanics
//             (semaphore, failover, model quirks, response parsing)
//             live in llmCall.js. History compression lives in
//             compress.js.
//
//   ENTRY     stepTurn (continues an existing being-stream with
//             carried context) and runTurn (one full moment, fresh
//             per summon) are the two public entries.
//
// What this file does not own:
//
//   The inbox, the scheduler, the SUMMON envelope — that's the
//   request-arrival path, handled before I'm called.
//
//   The reply emission — when the moment closes, the role's
//   summon() decides whether to request a follow-up moment from
//   the asker (via factory/replies.js). I just hand back text +
//   a actId.
//
//   Anything substrate-shaped (Space, Matter, Being writes) —
//   tools do that through DO / BE. I am the line, not the
//   substrate the line draws from.
//
// Presentism all the way down. The frame is assembled fresh every
// moment. CARRY_MESSAGES is the thin tail of recent moments held
// in memory; the Being row is the only continuity across all
// moments. Between forward passes the being is nothing; I just
// stage the next one.

import log from "../../../seedReality/log.js";
import { getInternalConfigValue } from "../../../internalConfig.js";
import { hooks } from "../../../hooks.js";
import {
  cognitionFailureError,
  isCognitionFailure,
  cognitionFailure,
  cognitionSuccess,
} from "../../cognitionResult.js";

import crypto from "crypto";
import Being from "../../../materials/being/being.js";
import Space from "../../../materials/space/space.js";
import {
  snapshotAncestors,
  resolveExtensionScopeFromChain,
  getAncestorChain,
} from "../../../materials/space/ancestorCache.js";
import {
  resolveTools,
  resolveToolsForPosition,
  executeTool,
} from "./tools.js";
import { callLLM, finalizeResponse } from "./loop.js";
import { getSpaceName } from "../../../materials/space/spaces.js";

// The live carry between this being's moments — messages tail,
// current role, idle eviction — lives in reel.js. setCarryMessages
// is re-exported because services.js wires it through the public
// surface.
import {
  getReel,
  presenceKeyFor,
  getCarryMessages,
  setCarryMessages,
  setMaxPresenceReels,
  setStalePresenceMs,
} from "../../beats/2-fold/reel.js";
export { setCarryMessages };
import { getRealityConfigValue } from "../../../realityConfig.js";
import { I_AM } from "../../../materials/being/seedBeings.js";
import { signInternalToken } from "../../../materials/being/identity.js";

// Frame coordination — building the stamp face + resolving the
// tool surface for one moment — lives in stamp.js. I import the
// pair as runTurn-internal handles; the actual rendering is
// stamp.js's job.
import { buildSystemPromptForRole, resolveToolsForRole } from "./assemble.js";

// ─────────────────────────────────────────────────────────────────────
// BUDGETS
// ─────────────────────────────────────────────────────────────────────
//
// Every LLM-being's turn runs against a ceiling: how many messages,
// how many tool iterations, how many retries, how many bytes per
// message. The ceiling exists because a turn that loops forever or
// floods context isn't thinking, it's burning. Defaults below; the
// operator overrides through place config; the setInternalConfig switch
// at the bottom of this block routes each key. Clamps prevent a
// misconfig from bricking the loop — every path produces a working
// system, even if a config value comes in nonsense.

// Place-level cap on simultaneous in-flight runTurns. The shared LLM
// pool throttling that used to gate this retired (each being now has
// its own LlmConnection); a hard ceiling on concurrent LLM turns
// still matters as a rate-of-change guard against runaway fan-out.
// Cap-and-reject: when a SUMMON arrives and we're already at
// MAX_RUN_TURNS, runTurn throws and the caller decides what to do.
let MAX_RUN_TURNS = 50;
let _activeRunTurns = 0;
export function setMaxRunTurns(n) {
  if (Number.isFinite(n) && n > 0) {
    MAX_RUN_TURNS = Math.max(1, Math.min(Math.floor(n), 10000));
  }
}
export function getActiveRunTurnCount() {
  return _activeRunTurns;
}

// Budget knobs + setInternalConfig live in knobs.js (the router that
// fans internalConfig values down into present-subsystem setters). I
// import the getters for use in the loop and register my MAX_RUN_TURNS
// setter so genesis-routed configs land. setInternalConfig is
// re-exported because services.js wires it through the public surface.
import {
  setInternalConfig,
  registerMaxRunTurnsSetter,
  getMaxMessages,
  getMaxToolIterations,
  getMaxMessageContentBytes,
} from "../../knobs.js";
export { setInternalConfig };
registerMaxRunTurnsSetter(setMaxRunTurns);

// LLM connection resolution lives in connect.js. Imported once here:
// the turn loop reaches getClientForBeing on every moment; setLlmTimeout
// is re-exported because services.js wires it through the public surface;
// resolveRootLlmForRole is the legacy shim some seed callers still use.
import {
  setLlmTimeout,
  getLlmTimeout,
  getClientForBeing,
  resolveRootLlmForRole,
} from "./connect.js";
export { setLlmTimeout };

// The call-surround machinery (failover, model quirks, response
// parsing) lives in call.js. callLLM moved to loop.js and pulls
// callWithFailover + JSON-error predicates directly from there;
// runTurn keeps just the model-quirks / internal-parse pair that
// stepTurn still uses, plus the public surface we re-export.
import {
  registerFailoverResolver,
  handleModelQuirks,
  parseInternalResponse,
  setFailoverTimeout,
} from "./call.js";
export { registerFailoverResolver };

// History compression lives in compress.js. The tool loop triggers
// it when the conversation grows past threshold; the system prompt
// and recent N stay, the middle gets summarized.
import {
  compressConversation,
  COMPRESSION_ENABLED,
  COMPRESSION_THRESHOLD,
  COMPRESSION_KEEP,
} from "./compress.js";

// Per-call budget resolution: how long this role gets, how many
// retries. Three layers, closest to the call wins.
//   - qualities.timeouts.<roleName> on this space (operator override
//     when a specific scope is slow)
//   - role.timeoutMs / role.maxRetries (the role knows its own
//     shape — a Planner with a giant prompt needs longer than a
//     one-shot Worker)
//   - place default (the floor)
// getTimeoutForRole moved to loop.js (its only consumer was callLLM,
// which also moved). getRetriesForRole was dead code and was dropped.

// LLM connection getters (getClientForBeing, resolveRootLlmForRole)
// imported above with the other connect.js surface.

// The carry-between-moments live in reel.js; getReel and
// presenceKeyFor are imported above. Local aliases keep the
// existing call sites readable.
const getSession = getReel;
const _convKey = presenceKeyFor;

// Position state (rootId, currentSpace) lives in
// place/being/position.js keyed by Being — one being, one position,
// regardless of reach. rootId derives from currentSpace on every
// setCurrentSpace, so callers only set the current Space; rootId
// follows.
import {
  getRootIdFor,
  setCurrentSpace,
  getCurrentSpace,
} from "../../../materials/being/position.js";

// ─────────────────────────────────────────────────────────────────────
// ROLE SWITCHING
// ─────────────────────────────────────────────────────────────────────
//
// A session can change roles mid-conversation (Planner hands off to
// Worker, etc.). switchRole resets the buffer to the new role's
// system prompt but carries the last CARRY_MESSAGES turns across so
// the next role isn't born amnesiac. ctx.clearHistory forces a full
// reset for cases where the new role shouldn't see what the old one
// did.

/**
 * Switch the session to a new role. Resets conversation but carries
 * recent messages unless ctx.clearHistory is true. Returns
 * { role, carriedMessages } for the caller.
 */
export async function switchRole(presenceKey, newRole, ctx) {
  if (!newRole || typeof newRole !== "object" || !newRole.name) {
    throw new Error(
      "switchRole requires a role spec with at least a `name` field",
    );
  }
  ctx = ctx || {};
  const beingId = ctx.beingId || null;
  const session = getSession(_convKey(ctx, presenceKey));
  const oldRole = session.role;
  const oldMessages = session.messages;

  let recentMessages = [];
  let carriedContext = [];

  if (!ctx.clearHistory) {
    let carryCount = getCarryMessages();
    if (oldRole?.preserveContextOnSwitch) {
      carryCount = Math.min(oldMessages.length, 8);
    }
    recentMessages = oldMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-carryCount);

    carriedContext =
      recentMessages.length > 0
        ? [
            {
              role: "system",
              content: `[Role Switch] Switched from ${oldRole?.name || "none"} to ${newRole.name}. Recent conversation context preserved.`,
            },
            ...recentMessages,
          ]
        : [];
  }

  const systemPrompt = await buildSystemPromptForRole(newRole, {
    ...ctx,
    presenceKey,
    rootId: getRootIdFor(beingId) || ctx.rootId,
    currentSpace: ctx.currentSpace || getCurrentSpace(beingId),
  });

  session.messages = [
    { role: "system", content: systemPrompt },
    ...carriedContext,
  ];
  session.role = newRole;
  if (ctx.currentSpace) await setCurrentSpace(beingId, ctx.currentSpace);

  log.debug(
    "LLM",
    `🔄 Role switch for ${presenceKey}: ${oldRole?.name || "none"} → ${newRole.name} (carried ${recentMessages.length} messages)`,
  );

  return {
    role: newRole.name,
    emoji: newRole.emoji,
    label: newRole.label,
    carriedMessages: recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PROCESS MESSAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────
//
// stepTurn is the iteration core: prep, call, dispatch tools,
// repeat. The helpers below are its phases. Each one mutates the
// session in place; the loop body stays legible because the work is
// chunked into named acts.

/**
 * Phase 1. Bind the session to a role, plant the being at its space,
 * snapshot the ancestor chain. Snapshotting once at the top of the
 * turn pins the ancestor view for every resolution chain (scope,
 * tools, LLM, config) within this call — they all read from the same
 * memo, not a race-prone live walk.
 */
async function ensureSession(presenceKey, ctx) {
  const beingId = ctx?.beingId || null;
  const session = getSession(_convKey(ctx, presenceKey));

  // Self-heal a tree mismatch. If the caller says I'm in a different
  // tree than the being's position state thinks, I trust the caller
  // and wipe the buffer. setCurrentSpace below re-derives rootId
  // from the new space.
  const incomingRootId = ctx.rootId || null;
  const knownRootId = getRootIdFor(beingId);
  if (knownRootId && incomingRootId && knownRootId !== incomingRootId) {
    log.debug(
      "LLM",
      `Root mismatch for ${presenceKey}: being=${knownRootId}, ctx=${incomingRootId}. Clearing.`,
    );
    session.messages = [];
    session.role = null;
  }

  // Plant the being at the asked-for space. rootId follows from the
  // chain walk inside setCurrentSpace — one call, both fields atomic.
  // If only rootId is given, the tree-root IS the position.
  const targetSpace = ctx.currentSpace || incomingRootId;
  if (targetSpace) {
    await setCurrentSpace(beingId, targetSpace);
  }

  // Every LLM call needs a role. runTurn threads it through ctx.role;
  // I refuse to default-pick one.
  if (!session.role && ctx.role) {
    await switchRole(presenceKey, ctx.role, ctx);
  }
  if (!session.role) {
    throw new Error(
      "ensureSession: no role on session and no ctx.role; every LLM call needs a role",
    );
  }

  // The per-turn ancestor memo. Every resolution chain reads this.
  const snapshotNodeId =
    getCurrentSpace(beingId) || getRootIdFor(beingId) || ctx.rootId;
  if (snapshotNodeId) {
    session._ancestorSnapshot = await snapshotAncestors(snapshotNodeId);
  }

  return { session, role: session.role };
}

/**
 * Phase 2. The tree-level circuit breaker. When an extension or
 * operator has marked the owning root tripped (health threshold,
 * abuse, billing), the turn short-circuits with a dormant reply
 * instead of burning another LLM call. Returns null when healthy.
 */
function checkTreeCircuit(session) {
  if (session._ancestorSnapshot) {
    // Owning root: highest non-I_AM ancestor in the chain.
    const rootAncestor = session._ancestorSnapshot.find(
      (a) => a.rootOwner && a.rootOwner !== I_AM,
    );
    if (rootAncestor?.qualities?.circuit?.tripped) {
      return {
        content:
          "This tree is dormant. It exceeded health thresholds and its circuit breaker tripped. Contact the place operator or wait for an extension to revive it.",
        role: session.role?.name || null,
      };
    }
  }
  return null;
}

/**
 * Phase 3. Resolve the LLM client (with role-aware connection
 * resolution + failover). Returns the bundle the loop needs, or a
 * no-LLM placeholder reply when nothing is configured.
 */
async function resolveLLMClient(ctx, session, presenceKey) {
  // Role can pin its own connection at the tree root (llmSlot →
  // assignments). When the tree has a slot for this role, use it;
  // otherwise the being's defaults flow through.
  const rootId = getRootIdFor(ctx?.beingId) || ctx.rootId;
  const roleConnectionId =
    ctx.rootLlmConnectionId ||
    (rootId ? await resolveRootLlmForRole(rootId, session.role) : null);

  const clientEntry = await getClientForBeing(
    ctx.beingId,
    ctx.slot,
    roleConnectionId,
  );
  if (clientEntry.noLlm) {
    return {
      noLlmResponse: {
        content:
          "No LLM connection configured. Set one up at /setup to use AI features.",
        role: session.role?.name || null,
      },
    };
  }
  const {
    client: openai,
    model: MODEL,
    isCustom,
    connectionId: resolvedConnectionId,
  } = clientEntry;

  return { openai, MODEL, isCustom, resolvedConnectionId, clientEntry };
}

/**
 * Phase 4. Stage the messages buffer for this call. Three things
 * happen: a long-running role's loop wrap (rare); a system-prompt
 * rebuild from the current substrate (every call, because the being
 * IS the prompt at this instant); and the asker's message appended.
 * The output is session.messages in the exact shape the provider
 * call needs.
 */
async function stageCall(session, ctx, message, presenceKey) {
  const role = session.role;
  // Long-running roles (Planner, Worker driving a big task) can declare
  // a soft loop point: when the buffer grows past their threshold, I
  // wrap it back to system prompt + recent N messages so the role can
  // keep working without dragging stale context forward.
  if (
    role.maxMessagesBeforeLoop &&
    session.messages.length > role.maxMessagesBeforeLoop
  ) {
    log.debug(
      "LLM",
      `🔁 Buffer wrap for ${presenceKey} in role ${role.name}`,
    );
    const recentMessages = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-(getCarryMessages() * 2)); // carry more on loop

    const systemPrompt = await buildSystemPromptForRole(role, {
      name: ctx.name,
      beingId: ctx.beingId,
      presenceKey,
      rootId: getRootIdFor(ctx.beingId),
      currentSpace: getCurrentSpace(ctx.beingId),
    });

    session.messages = [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `[Conversation Loop] The conversation was getting long and has been trimmed. Recent context preserved. Re-fetch the tree to re-orient if needed.`,
      },
      ...recentMessages,
    ];
  }

  // Rebuild the system prompt fresh, every call. Presentism: the
  // being is not a long-lived process between turns. The prompt
  // assembled here IS the being for the duration of this forward
  // pass. enrichContext gathers extension contributions for the
  // current space; buildPrompt stitches the canonical shape.
  {
    let enrichedContext = null;
    try {
      const posNodeId =
        getCurrentSpace(ctx.beingId) ||
        getRootIdFor(ctx.beingId) ||
        ctx.rootId ||
        null;
      if (posNodeId) {
        const posSpace = await Space.findById(posNodeId).lean();
        if (posSpace) {
          const meta =
            posSpace.qualities instanceof Map
              ? Object.fromEntries(posSpace.qualities)
              : posSpace.qualities || {};
          enrichedContext = {};
          await hooks.run("enrichContext", {
            context: enrichedContext,
            space: posSpace,
            meta,
            spaceId: posNodeId,
            beingId: ctx.beingId,
            sessionId: presenceKey,
            // Pass the user message so vocabulary-gated injections
            // (channels' peer-peek, etc.) can decide whether to fire.
            // Handlers that don't care just ignore it.
            message: message || null,
            dumpMode: true,
          });
        }
      }
    } catch (err) {
      log.debug("LLM", `enrichContext gather skipped: ${err.message}`);
    }

    const systemPrompt = await buildSystemPromptForRole(role, {
      name: ctx.name,
      beingId: ctx.beingId,
      presenceKey,
      rootId: getRootIdFor(ctx.beingId),
      currentSpace: getCurrentSpace(ctx.beingId),
      enrichedContext: enrichedContext || null,
    });
    if (session.messages.length === 0) {
      session.messages = [{ role: "system", content: systemPrompt }];
    } else if (session.messages[0]?.role === "system") {
      session.messages[0].content = systemPrompt;
    }
  }

  // Length trim. The provider has a context window; the buffer has
  // to stay under it. But I cannot just slice — tool results must
  // follow their assistant tool_call partner, or the provider
  // rejects the request. The walk below cuts at a clean boundary
  // (drop orphan tool results, drop orphan tool_calls with no
  // results following). Any individual message that grew too large
  // gets capped to MAX_MESSAGE_CONTENT_BYTES.
  const maxMsgs =
    session._nodeLlmConfig?.maxConversationMessages ?? getMaxMessages();
  if (session.messages.length > maxMsgs) {
    const systemMsg = session.messages[0];
    let recent = session.messages.slice(-(maxMsgs - 1));
    while (recent.length > 0 && recent[0].role === "tool") {
      recent.shift();
    }
    while (
      recent.length > 0 &&
      recent[0].role === "assistant" &&
      recent[0].tool_calls?.length > 0
    ) {
      recent.shift();
      while (recent.length > 0 && recent[0].role === "tool") {
        recent.shift();
      }
    }
    const maxBytes = getMaxMessageContentBytes();
    for (const msg of recent) {
      if (typeof msg.content === "string" && msg.content.length > maxBytes) {
        msg.content = msg.content.slice(0, maxBytes) + "\n... (truncated)";
      }
    }
    session.messages = [systemMsg, ...recent];
  }

  // Append the user message (capped). Continuations re-enter the
  // tool loop on the existing buffer — no new user turn to push,
  // otherwise the history fills with synthetic "continue" stamps.
  if (!ctx?.continuation) {
    const maxMsgBytes = getMaxMessageContentBytes();
    const safeUserMsg =
      message.length > maxMsgBytes
        ? message.slice(0, maxMsgBytes) + "\n... (message truncated)"
        : message;
    session.messages.push({ role: "user", content: safeUserMsg });
  }
}


/**
 * Phase 5b. Per-position LLM-loop config. Three layers, closest
 * wins:
 *
 *   1. Space (qualities.llm.config on any ancestor) — operator
 *      override at a position.
 *   2. Role (knobs the role declares on itself) — the role knows
 *      its own shape.
 *   3. Place globals (the floor, applied via ?? at usage sites).
 *
 * Every layer is clamped to a safe ceiling; misconfig cannot brick
 * the loop.
 */
const LLM_CONFIG_KEYS = {
  maxToolIterations: 100,
  toolCallTimeout: 600000, // 10 minutes max
  toolResultMaxBytes: 1000000, // 1MB max
  maxConversationMessages: 200,
  compressionThreshold: 200, // message count before mid-loop compression
  compressionKeep: 20, // messages to preserve at the end
};

function resolveLlmConfig(ancestors, role) {
  const config = {};

  // Layer 1: space config (walk ancestor chain, closest wins)
  if (ancestors && ancestors.length > 0) {
    for (const space of ancestors) {
      if (space.seedSpace) break;
      const llmConfig = space.qualities?.llm?.config;
      if (!llmConfig || typeof llmConfig !== "object") continue;
      for (const [key, maxVal] of Object.entries(LLM_CONFIG_KEYS)) {
        if (config[key] !== undefined) continue;
        const val = llmConfig[key];
        if (typeof val === "number" && isFinite(val) && val > 0) {
          if (val > maxVal)
            log.verbose(
              "LLM",
              `Space LLM config ${key}=${val} clamped to max ${maxVal}`,
            );
          config[key] = Math.min(val, maxVal);
        }
      }
    }
  }

  // Layer 2: role config (fills gaps not set by space). Roles can declare
  // LLM-loop knobs directly (maxToolIterations, compressionThreshold, ...).
  if (role) {
    for (const [key, maxVal] of Object.entries(LLM_CONFIG_KEYS)) {
      if (config[key] !== undefined) continue;
      const val = role[key];
      if (typeof val === "number" && isFinite(val) && val > 0) {
        if (val > maxVal)
          log.verbose(
            "LLM",
            `Role LLM config ${key}=${val} clamped to max ${maxVal}`,
          );
        config[key] = Math.min(val, maxVal);
      }
    }
  }

  // Layer 3: place globals (applied at usage site via ?? fallback)
  return config;
}

/**
 * Phase 5. The tool surface for this position. Walks the ancestor
 * snapshot once for tool allow/block lists and once for extension
 * scope (confined extensions opted in at certain positions), then
 * hands the merged result through resolveToolsForRole's role-spec
 * + permission filter. Zero DB queries when the snapshot is hot.
 */
// resolveToolsForPosition moved to tools.js (the per-position resolution
// IS tool-registry logic; it belongs next to the static registry, not
// in runTurn's orchestration). stepTurn below imports it.


// executeTool moved to tools.js. stepTurn below imports it.
// finalizeResponse moved to loop.js. stepTurn below imports it.

// ─────────────────────────────────────────────────────────────────────────
// PROCESS MESSAGE
// ─────────────────────────────────────────────────────────────────────────
//
// The loop body. I run the phases the helpers above set up, then
// iterate: call the model, append the assistant message, dispatch
// any tool calls, repeat until the model returns prose with no
// tool_calls (the natural exit) or a budget closes. Each loop
// iteration is one LLM forward pass; between iterations I'm just
// dispatching tools and stitching their results back into history.

/**
 * I process one user message under the session's current role and
 * return whatever the loop arrived at: text, a continuation signal,
 * or an early dormant reply.
 */
export async function stepTurn(presenceKey, message, ctx) {
  const isInternal = ctx?.meta?.internal === true;

  // Phase 1. Bind session, plant position, snapshot ancestors.
  const { session, role } = await ensureSession(presenceKey, ctx);

  // Phase 2. Tree circuit. If the owning root is tripped, return now.
  const tripped = checkTreeCircuit(session);
  if (tripped) return tripped;

  // Phase 3. LLM provider client.
  const llmResult = await resolveLLMClient(ctx, session, presenceKey);
  if (llmResult.noLlmResponse) return llmResult.noLlmResponse;
  const { openai, MODEL, isCustom, resolvedConnectionId, clientEntry } =
    llmResult;

  // Phase 4. Stage the messages buffer for the call.
  await stageCall(session, ctx, message, presenceKey);

  // Phase 5. Resolve the tool surface for this position.
  let { tools } = await resolveToolsForPosition(
    session,
    ctx.beingId,
    ctx.rolePermissions,
  );

  // readOnly clamp. SEE-only callers (query intents) keep only the
  // tools tagged `verb: "see"`. The verb tag IS the read-only marker;
  // SEE is read by definition, DO mutates. The role's LLM never sees
  // a write tool when this clamp is on, so it can't reach for one.
  if (ctx.readOnly) {
    const { getToolVerb } = await import("./tools.js");
    tools = tools.filter((t) => {
      const name = t.function?.name || t.name;
      return name && getToolVerb(name) === "see";
    });
  }

  // Phase 5b. Resolve per-turn LLM loop config. callLLM and
  // executeTool read overrides off session._nodeLlmConfig.
  session._nodeLlmConfig = resolveLlmConfig(session._ancestorSnapshot, role);

  // Phase 6. The tool loop.
  let response;
  let iterations = 0;
  const maxIterations =
    session._nodeLlmConfig.maxToolIterations ?? getMaxToolIterations();

  // Per-step tool budget. When a role pins maxToolCallsPerStep, I
  // break the loop after that many tool calls and hand back a
  // _continue marker. The caller (orchestrator, foreman) can open a
  // fresh chainIndex step and re-enter on the same session.
  const maxToolCallsPerStep =
    ctx?.maxToolCallsPerStep ?? role.maxToolCallsPerStep ?? null;
  let toolCallsThisStep = 0;
  let continueReason = null;

  // Exit gate. When a role declares exit.requires, the loop cannot
  // terminate cleanly until that tool has fired. firedTools tracks
  // what's been called this turn; the natural-exit branch below
  // checks against it.
  const requiredExitTool = role?.exit?.requires || null;
  const firedTools = new Set();

  while (iterations < maxIterations) {
    if (ctx.signal?.aborted) throw new Error("Request cancelled");
    iterations++;

    response = await callLLM(
      openai,
      MODEL,
      session,
      tools,
      ctx,
      clientEntry,
      presenceKey,
    );

    const choice = response.choices?.[0];
    if (!choice) break;

    const assistantMessage = choice.message;

    // Always append. The provider rejects an assistant tool_call
    // that isn't followed by its tool result, and vice versa — the
    // buffer must stay paired.
    session.messages.push(assistantMessage);

    // Intermediate prose. When the model writes a thought ("ok let
    // me check the plan first") before emitting a tool_call, that
    // text is its reasoning out loud. I forward it to any live
    // consumer (CLI, web) so the user sees the train of thought
    // instead of waiting silently for the final answer.
    if (
      ctx.onThinking &&
      assistantMessage.tool_calls?.length &&
      typeof assistantMessage.content === "string" &&
      assistantMessage.content.trim().length > 0
    ) {
      try {
        ctx.onThinking({
          text: assistantMessage.content,
          role: session.role?.name,
        });
      } catch {
        /* never let a listener break the loop */
      }
    }

    // Some models emit tool-call syntax as plain text instead of
    // using the function-calling protocol. handleModelQuirks
    // detects and corrects what it can.
    const quirk = await handleModelQuirks(
      assistantMessage,
      session,
      tools,
      openai,
      MODEL,
      ctx,
      isInternal,
      isCustom,
      resolvedConnectionId,
    );
    if (quirk?.earlyReturn) return quirk.earlyReturn;
    if (quirk?.breakLoop) break;

    // The model returned prose with no tool_calls. Three branches:
    // exit-gate (the role required a specific tool that hasn't
    // fired, so I nudge back into the loop with a corrective system
    // line), internal-shape return (caller wants the parsed object),
    // or natural break — this is the answer.
    if (!assistantMessage.tool_calls?.length) {
      if (requiredExitTool && !firedTools.has(requiredExitTool)) {
        session.messages.push({
          role: "system",
          content:
            `You have not yet called \`${requiredExitTool}\`. ` +
            `Your turn cannot end until that tool fires. Call it now.`,
        });
        log.verbose(
          "RunTurn",
          `exit-gate: ${role.name} produced terminal text without calling ` +
            `${requiredExitTool}; nudging back into the loop (iteration ${iterations}/${maxIterations})`,
        );
        continue;
      }
      if (isInternal)
        return parseInternalResponse(
          assistantMessage.content,
          isCustom,
          MODEL,
          resolvedConnectionId,
        );
      break;
    }

    // Dispatch each tool call. Anything that mutates the substrate
    // flows through the four-verb dispatcher, which writes its own
    // Fact. I don't audit per tool; the Fact is the audit.
    const toolResults = [];
    for (const toolCall of assistantMessage.tool_calls) {
      if (ctx.signal?.aborted) throw new Error("Request cancelled");
      const toolResult = await executeTool(
        toolCall,
        session,
        ctx,
        presenceKey,
      );
      toolResults.push(toolResult);
      toolCallsThisStep++;
      firedTools.add(toolCall.function?.name);
    }

    // Per-step budget hit. The assistant message with its tool_calls
    // and the matching tool results are already in session.messages,
    // so a fresh re-entry picks up cleanly.
    if (maxToolCallsPerStep && toolCallsThisStep >= maxToolCallsPerStep) {
      continueReason = "tool-cap";
      break;
    }

    if (ctx.onToolResults) {
      ctx.onToolResults(toolResults);
    }

    // Reality mode. The whole point of the turn is the tool calls,
    // not the prose; once at least one tool succeeds I stop. Saves
    // a round-trip generating an answer the user will never see.
    if (ctx.skipRespond && toolResults.some((r) => r?.success !== false)) {
      continueReason = "reality-done";
      break;
    }

    // History compression. If the buffer has bloated, fold older
    // messages into a summary so the next call's context stays under
    // the provider's ceiling. compress.js handles the mechanics.
    const compEnabled =
      session._nodeLlmConfig?.compressionThreshold !== undefined
        ? true
        : COMPRESSION_ENABLED();
    if (compEnabled) {
      const compThreshold =
        session._nodeLlmConfig?.compressionThreshold ?? COMPRESSION_THRESHOLD();
      const compKeep =
        session._nodeLlmConfig?.compressionKeep ?? COMPRESSION_KEEP();
      await compressConversation(session, compThreshold, compKeep);
    }
  }

  // Phase 7. Close the turn. Two short-circuits skip finalizeResponse's
  // "make one more call for prose" step: tool-cap (the caller will
  // re-enter on a new step with continuation: true) and reality-done
  // (the tools were the answer, no prose needed). Pull the last
  // assistant message's prose so the Act records what the being
  // said alongside its tool call (the dancer's "I'll head east."
  // becomes the visible record; an empty assistant content gets a
  // deterministic placeholder so the moment still seals).
  if (continueReason === "tool-cap" || continueReason === "reality-done") {
    let assistantProse = "";
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
        assistantProse = m.content.trim();
        break;
      }
    }
    const content = assistantProse ||
      (continueReason === "tool-cap" ? "(continuing)" : "(step taken)");
    return {
      success: true,
      content,
      _continue: continueReason === "tool-cap",
      _continueReason: continueReason,
    };
  }

  return finalizeResponse(
    session,
    openai,
    MODEL,
    response,
    isInternal,
    isCustom,
    resolvedConnectionId,
    ctx,
  );
}

// Read the role currently bound to a session. Internal only —
// runTurn checks this to skip a redundant switchRole when the role
// hasn't changed.
export function getCurrentRole(sessionKey) {
  return getSession(sessionKey).role;
}

// ─────────────────────────────────────────────────────────────────────────
// RUNCHAT — the seed-shaped entry
// ─────────────────────────────────────────────────────────────────────────
//
// runTurn is what a role's summon() handler calls when it wants an
// LLM-driven turn. stepTurn is the iteration core; runTurn is
// the wrapper that translates between the SUMMON envelope and that
// place. Four structured inputs:
//
//   being    — the responder. Carries _id, name, currentPositionId,
//              homePositionId, llmDefault.
//   envelope — the SUMMON envelope that woke this summon. from,
//              content, ibpAddress, correlation, inReplyTo,
//              rootCorrelation, priority.
//   role     — the active role spec from factory/roles/registry.js.
//   signal   — the scheduler's AbortController signal so a cut at
//              HUMAN priority interrupts mid-turn.
//
// Inside, I derive identifiers, open the Act row, set the position,
// run stepTurn, fire beforeResponse on the answer, finalize the Act
// row, and hand back { text, actId, role, sessionKey } to the role's
// handler for reply emission.
/**
 * I run one LLM turn for the summoned being and return text.
 */
export async function runTurn({ being, envelope, role, signal = null } = {}) {
  if (!being?._id) {
    throw new Error("runTurn requires being with _id");
  }
  if (
    !envelope ||
    (envelope.content === undefined && envelope.content !== "")
  ) {
    throw new Error("runTurn requires envelope with content");
  }
  if (!role || typeof role !== "object" || !role.name) {
    throw new Error("runTurn requires a role spec from ibp/roles/registry.js");
  }

  // Place-level capacity gate. A burst of fan-out (extension scheduled
  // wakes, recursive sub-being summons) could otherwise stack
  // unbounded concurrent LLM turns. Cap-and-reject: throw cleanly,
  // let the caller decide whether to retry. Counter increments here
  // and decrements in the outer finally below so every return path
  // releases the slot.
  if (_activeRunTurns >= MAX_RUN_TURNS) {
    throw new Error(
      `runTurn cap reached: ${MAX_RUN_TURNS} concurrent runTurns active. ` +
        `Try again shortly or raise maxRunTurns in .config.`,
    );
  }
  _activeRunTurns++;
  try {

  // Unpack the envelope. beingOut is the responder (me, this turn's
  // being); beingIn is the asker. askerName is parsed off the `from`
  // stance for display in logs. spaceId is where the responder is
  // standing — its current position, falling back to home.
  const beingOut = String(being._id);
  let askerName = null;
  if (typeof envelope.from === "string") {
    const m = envelope.from.match(/@([a-z][a-z0-9-]*)$/i);
    if (m) askerName = m[1];
  }
  const beingIn = envelope.fromBeingId || String(being._id);
  const beingId = beingIn;
  const username = askerName || being.name || null;
  const message =
    typeof envelope.content === "string"
      ? envelope.content
      : JSON.stringify(envelope.content);
  const spaceId = being.currentPositionId || being.homePositionId || null;
  const rootId = null;

  const { setSessionAbort, clearSessionAbort } =
    await import("../../session.js");
  const { resolvePipelineKey } = await import("../../session.js");
  const { computeIbpStampAddress } = await import("../../../ibp/address.js");

  // Session key resolution.
  //
  // Normal path: the IBP Address is the conversation identifier.
  // When I can resolve both stances, that address keys the per-
  // being session across every Act between these two beings; the
  // session.messages buffer accumulates user/assistant pairs so
  // the LLM has prior-turn context.
  //
  // Presentism opt-in (role.presentist === true): every summon is
  // its own "now". The face rebuilds from substrate every call —
  // the system prompt already carries identity + see-resolvers +
  // capabilities + persona — and conversation history isn't
  // useful, only costly. Without this, a being whose self-self
  // IBP Address is stable (e.g. a dancer whose every wake comes
  // through subscription as `dancer@grid :: dancer@grid`) stacks
  // every prior wake's user message + assistant reply onto the
  // same buffer, so by tick N the prompt is N times larger than
  // it should be and inference latency runs away. Presentism mints
  // a fresh ephemeral session key per call; the message buffer
  // starts empty and stays empty across ticks.
  const isPresentist = role?.presentist === true;
  const _eagerIbpAddress = (isPresentist || !beingOut)
    ? null
    : await computeIbpStampAddress({
        askerBeingId: beingId,
        askerPosition: getCurrentSpace(beingId) || null,
        addresseeBeingId: beingOut,
      });
  const { key: resolvedKey } = isPresentist
    ? { key: `pipeline:ephemeral:${crypto.randomUUID()}`, persist: false }
    : resolvePipelineKey({ beingId, rootId });
  const sessionKey = _eagerIbpAddress || resolvedKey;
  const sessionId = crypto.randomUUID();

  // Abort. If the caller threaded a signal in, I ride theirs;
  // otherwise I open my own AbortController and register it so an
  // external cancel can reach this turn.
  const abort = signal ? null : new AbortController();
  const abortSignal = signal || abort.signal;
  if (abort) setSessionAbort(sessionKey, abort);

  // 1. Plant the being at its space. rootId derives from the space
  // inside setCurrentSpace; callers only set the position.
  const targetSpace = spaceId || rootId;
  if (targetSpace) await setCurrentSpace(beingId, targetSpace);

  // 2. Switch role only if the conversation isn't already in it.
  // Role state lives on the conversation entry (keyed by IBP Address
  // or pipeline key), so two tabs at the same conversation see one
  // current role and a redundant switch is just noise.
  const currentRole = getCurrentRole(sessionKey);
  if (currentRole?.name !== role.name) {
    try {
      await switchRole(sessionKey, role, {
        username,
        beingId,
        currentSpace: getCurrentSpace(beingId),
      });
    } catch (err) {
      log.warn("RunTurn", `Role switch to ${role.name} failed: ${err.message}`);
    }
  }

  // 3. The Act row was opened upstream by assign and threaded
  // through summonCtx.message.actId. Every DO and BE the loop
  // emits inside this turn carries this id; the scheduler presses
  // the closing face when the moment ends.
  const actId = envelope.actId || null;

  // 4. The turn. actId / sessionId / sessionKey / rolePermissions
  // ride through ctx so the loop has everything it needs without
  // reaching back through side channels.
  let result;
  try {
    result = await stepTurn(sessionKey, message, {
      username,
      beingId,
      rootId,
      currentSpace: getCurrentSpace(beingId),
      actId,
      rootActId: actId,
      sessionId,
      signal: abortSignal,
      // Permissions are role identity. The intersection with tool
      // verbs at registration is what the LLM may reach for; nothing
      // here, no envelope, no extension can widen it.
      rolePermissions: Array.isArray(role.permissions)
        ? role.permissions
        : null,
      role,
    });
  } catch (err) {
    if (abort) clearSessionAbort(sessionKey);
    // Cognition-failure sentinel? Convert to CognitionResult.
    // Other exceptions are unexpected — let them propagate; the
    // caller (defaultSummon) catches and converts to internal.
    if (isCognitionFailure(err)) {
      return cognitionFailure(err.shape, err.reason);
    }
    if (abortSignal.aborted) {
      return cognitionFailure("aborted", err.message);
    }
    throw err;
  }

  if (abortSignal.aborted) {
    if (abort) clearSessionAbort(sessionKey);
    return cognitionFailure("aborted", "abort signal fired");
  }

  const text = typeof result?.content === "string" ? result.content : null;
  if (typeof text !== "string" || text.length === 0) {
    if (abort) clearSessionAbort(sessionKey);
    return cognitionFailure(
      "garbage",
      `stepTurn produced no usable content (have: ${result ? Object.keys(result).join(",") : "null"})`,
    );
  }

  // 5. Last shaping pass. beforeResponse lets extensions rewrite
  // the answer before it leaves (PII redaction, formatting, etc.).
  let finalText = text;
  try {
    const hookData = { content: finalText, beingId, rootId, role: role.name };
    await hooks.run("beforeResponse", hookData);
    if (typeof hookData.content === "string" && hookData.content.length > 0) {
      finalText = hookData.content;
    }
  } catch {}

  // 6. Release the abort registration. The session buffer stays
  // alive for the next turn on this key; only the cancel hook for
  // this specific turn lets go.
  if (abort) clearSessionAbort(sessionKey);

  return cognitionSuccess(finalText);
  } finally {
    _activeRunTurns--;
  }
}
