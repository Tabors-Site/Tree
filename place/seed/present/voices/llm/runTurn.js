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

import log from "../../../system/log.js";
import { hooks } from "../../../system/hooks.js";

import crypto from "crypto";
import Being from "../../../materials/being/being.js";
import Space from "../../../materials/space/space.js";
import {
  snapshotAncestors,
  resolveExtensionScopeFromChain,
  getAncestorChain,
} from "../../../materials/space/ancestorCache.js";
import { isDbHealthy } from "../../../system/dbConfig.js";
import { resolveTools } from "./tools.js";
import { getSpaceName } from "../../../materials/space/spaces.js";
// MCP wiring retired. Tools dispatch directly via getToolHandler in
// executeTool; the verb dispatcher's authorize gate covers per-verb
// auth + extension-scope. No protocol layer between the LLM voice
// and the handler.

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
} from "../../fold/reel.js";
export { setCarryMessages };
import { getPlaceConfigValue } from "../../../placeConfig.js";
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
// operator overrides through place config; the setSeedConfig switch
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

// Budget knobs + setSeedConfig live in config.js. I import the
// getters for use in the loop and register my MAX_RUN_TURNS setter
// so genesis-routed configs land. setSeedConfig is re-exported
// because services.js wires it through the public surface.
import {
  setSeedConfig,
  registerMaxRunTurnsSetter,
  getMaxMessages,
  getMaxToolIterations,
  getLlmMaxRetries,
  getToolCallTimeoutMs,
  getToolResultMaxBytes,
  getMaxMessageContentBytes,
} from "../../config.js";
export { setSeedConfig };
registerMaxRunTurnsSetter(setMaxRunTurns);

export { setLlmTimeout } from "./connect.js";
import { setLlmTimeout, getLlmTimeout } from "./connect.js";

// The call-surround machinery (failover, model quirks, response
// parsing) lives in llmCall.js. I import what callLLM uses
// internally and re-export the public surface (registerFailoverResolver)
// so external callers reach it through runTurn the way they always
// have.
import {
  callWithFailover,
  isJsonEscapeError,
  isJsonStructuralError,
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
function getRetriesForRole(role) {
  return role?.maxRetries ?? getLlmMaxRetries();
}
function getTimeoutForRole(role, spaceQualities = null) {
  const meta =
    spaceQualities instanceof Map
      ? Object.fromEntries(spaceQualities)
      : spaceQualities || {};
  const spaceTimeout = role?.name ? meta.timeouts?.[role.name] : null;
  if (spaceTimeout && Number.isFinite(spaceTimeout)) return spaceTimeout;
  if (role?.timeoutMs && Number.isFinite(role.timeoutMs)) return role.timeoutMs;
  return getLlmTimeout();
}

// LLM connection resolution lives in seed/present/voices/llm/connect.js. Imported
// here for use by the turn engine.
import { getClientForBeing, resolveRootLlmForRole } from "./connect.js";

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
  getSpaceRootId,
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
    rootId: getSpaceRootId(beingId) || ctx.rootId,
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
  const knownRootId = getSpaceRootId(beingId);
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
    getCurrentSpace(beingId) || getSpaceRootId(beingId) || ctx.rootId;
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
        _internal: { tripped: true, rootId: rootAncestor._id },
      };
    }
  }
  return null;
}

/**
 * Phase 3. Resolve the LLM client (with role-aware connection
 * resolution + failover) and the MCP client for tool dispatch.
 * Returns the bundle the loop needs, or a no-LLM placeholder reply
 * when nothing is configured.
 */
async function resolveLLMClient(ctx, session, presenceKey) {
  // Role can pin its own connection at the tree root (llmSlot →
  // assignments). When the tree has a slot for this role, use it;
  // otherwise the being's defaults flow through.
  const rootId = getSpaceRootId(ctx?.beingId) || ctx.rootId;
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
      rootId: getSpaceRootId(ctx.beingId),
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
        getSpaceRootId(ctx.beingId) ||
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
      rootId: getSpaceRootId(ctx.beingId),
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
async function resolveToolsForPosition(
  session,
  beingId,
  rolePermissions = null,
) {
  let treeToolConfig = null;
  let blockedExtensions = null;
  let restrictedExtensions = null;
  const currentSpace = getCurrentSpace(beingId) || getSpaceRootId(beingId);
  if (currentSpace) {
    try {
      const ancestors =
        session._ancestorSnapshot || (await getAncestorChain(currentSpace));

      if (ancestors && ancestors.length > 0) {
        // Position-scoped tool allow/block. Walks closest-to-farthest;
        // any space can contribute, place-seed spaces terminate.
        const allowed = new Set();
        const blocked = new Set();
        for (const space of ancestors) {
          if (space.seedSpace) break;
          const meta = space.qualities || {};
          if (meta.tools?.allowed)
            for (const t of meta.tools.allowed) allowed.add(t);
          if (meta.tools?.blocked)
            for (const t of meta.tools.blocked) blocked.add(t);
        }
        if (allowed.size || blocked.size) {
          treeToolConfig = {
            allowed: allowed.size ? [...allowed] : undefined,
            blocked: blocked.size ? [...blocked] : undefined,
          };
        }

        // Confined-extension scope: same resolver extensionScope.js uses,
        // so policy stays in one place.
        const { getConfinedExtensions } =
          await import("../../../materials/space/extensionScope.js");
        const scope = resolveExtensionScopeFromChain(
          ancestors,
          getConfinedExtensions(),
        );
        if (scope.blocked.size) blockedExtensions = scope.blocked;
        if (scope.restricted.size) restrictedExtensions = scope.restricted;
      }
    } catch (scopeErr) {
      log.warn(
        "LLM",
        `Tool scope resolution failed for space ${currentSpace}: ${scopeErr.message}`,
      );
    }
  }
  // Role base + extension overlays + position overlays + permission
  // filter. Permissions are role identity; envelopes never widen them.
  let tools = resolveToolsForRole(
    session.role,
    treeToolConfig,
    rolePermissions,
  );
  if (blockedExtensions || restrictedExtensions) {
    const { filterToolsByScope } =
      await import("../../../materials/space/extensionScope.js");
    tools = filterToolsByScope(tools, blockedExtensions, restrictedExtensions);
  }
  return { tools, blockedExtensions, restrictedExtensions };
}

/**
 * One forward pass through the provider. Wraps the call with the
 * semaphore (so background work doesn't starve human turns), the
 * failover chain (so one dead provider doesn't kill the loop), the
 * beforeLLMCall + afterLLMCall hooks (so extensions can meter,
 * cancel, capture forensics), and the JSON-error retry path. The
 * loop body (stepTurn) calls this once per iteration and
 * dispatches tools from the result.
 */
async function callLLM(
  openai,
  MODEL,
  session,
  tools,
  ctx,
  clientEntry,
  presenceKey,
) {
  const requestParams = {
    model: MODEL,
    messages: session.messages,
  };

  if (tools.length > 0) {
    requestParams.tools = tools;
    requestParams.tool_choice = "auto";
  }

  const requestOpts = ctx.signal ? { signal: ctx.signal } : {};

  // beforeLLMCall: extensions can cancel (quota exhausted) or rewrite
  // params. Exposing `messages` lets a before-handler inject a system
  // line into the actual buffer. actId / sessionId / parentStampId
  // let forensics capture handlers correlate back to the dispatching
  // call. The inReplyTo lookup is one query per LLM call, skipped
  // silently when the doc isn't there.
  const _llmChatId = ctx?.actId || null;
  const _llmSessionId = ctx?.sessionId || null;
  let _llmParentChatId = null;
  if (_llmChatId) {
    try {
      const { default: _Stamp } = await import("../../../past/act/act.js");
      const _chatDoc = await _Summon
        .findById(_llmChatId)
        .select("inReplyTo")
        .lean();
      if (_chatDoc?.inReplyTo) _llmParentChatId = String(_chatDoc.inReplyTo);
    } catch {}
  }
  const llmHookData = {
    beingId: ctx.beingId,
    rootId: ctx.rootId,
    role: session.role?.name,
    model: MODEL,
    messageCount: session.messages.length,
    hasTools: tools.length > 0,
    messages: session.messages,
    spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
    actId: _llmChatId,
    sessionId: _llmSessionId,
    parentStampId: _llmParentChatId,
  };
  const llmHookResult = await hooks.run("beforeLLMCall", llmHookData);
  if (llmHookResult.cancelled) {
    throw new Error(llmHookResult.reason || "LLM call rejected");
  }

  // Quick log of the [Block] tags at the top of the prompt — useful
  // when debugging which extension contributed what to the assembled
  // identity (each enrichContext block lands as its own labeled
  // section).
  if (session.messages[0]?.role === "system") {
    const sys = session.messages[0].content;
    const blocks = sys
      .split("\n")
      .filter((l) => l.startsWith("["))
      .map((l) => l.split("]")[0] + "]")
      .slice(0, 10);
    if (blocks.length > 0) {
      log.verbose(
        "Grammar",
        `[role:${session.role?.name}] modifiers: ${blocks.join(" ")}`,
      );
    }
  }

  let response;

  try {
    const failoverResult = await callWithFailover(
      (client, model) =>
        client.chat.completions.create(
          { ...requestParams, model },
          requestOpts,
        ),
      clientEntry,
      ctx.beingId,
      ctx.rootId || null,
    );
    response = failoverResult.response;
    if (failoverResult.usedClient !== clientEntry) {
      Object.assign(clientEntry, failoverResult.usedClient);
    }

    // afterLLMCall: token metering, billing, analytics, forensics.
    // Carries responseText so capture handlers don't need a second
    // hook to find "what the AI said."
    hooks
      .run("afterLLMCall", {
        beingId: ctx.beingId,
        rootId: ctx.rootId,
        role: session.role?.name,
        model: failoverResult.usedClient?.model || MODEL,
        usage: response?.usage || null,
        hasToolCalls: !!response?.choices?.[0]?.message?.tool_calls?.length,
        actId: _llmChatId,
        sessionId: _llmSessionId,
        responseText: response?.choices?.[0]?.message?.content || null,
      })
      .catch(() => {});
  } catch (apiErr) {
    // Salvage path. Cheap models on aggregators sometimes attempt
    // function-call syntax with hallucinated tool names; the provider
    // rejects the call with tool_use_failed and stashes the model's
    // actual prose in failed_generation. I dig the prose out so the
    // turn produces an answer instead of a stack trace.
    if (apiErr.code === "tool_use_failed" && apiErr.error?.failed_generation) {
      const inventedTool =
        apiErr.error?.message?.match(/tool '(\w+)'/)?.[1] || "?";
      let extracted = null;

      // Three salvage passes, each one weaker than the last.
      // 1. Parse as JSON, walk the common field names models stash
      //    prose into.
      try {
        const gen = JSON.parse(apiErr.error.failed_generation);
        const args = gen.arguments || gen;
        extracted =
          args.responseHint ||
          args.response ||
          args.content ||
          args.summary ||
          args.text ||
          args.message ||
          args.answer;
        if (!extracted && gen.arguments && typeof gen.arguments === "object") {
          extracted = JSON.stringify(gen.arguments);
        }
      } catch {
        // 2. JSON parse failed. Regex the same field names out of the
        //    raw text in case the JSON was malformed but the prose is
        //    still recoverable.
        const raw = apiErr.error.failed_generation;
        for (const field of [
          "responseHint",
          "response",
          "content",
          "summary",
          "text",
          "message",
          "answer",
        ]) {
          const match = raw.match(
            new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*[,}])`),
          );
          if (match) {
            extracted = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
            break;
          }
        }
        // 3. Last resort. If the raw text itself looks like prose
        //    (not JSON, not XML, long enough to be meaningful), use
        //    it directly.
        if (
          !extracted &&
          raw &&
          !raw.startsWith("{") &&
          !raw.startsWith("<") &&
          raw.length > 10
        ) {
          extracted = raw;
        }
      }

      if (extracted && extracted !== "undefined" && extracted !== "null") {
        log.warn(
          "LLM",
          `Model invented tool "${inventedTool}". Extracted response from failed_generation (${extracted.length} chars).`,
        );
        response = {
          choices: [
            {
              message: { role: "assistant", content: extracted },
              finish_reason: "stop",
            },
          ],
        };

        // Still fire afterLLMCall so metering tracks the call.
        hooks
          .run("afterLLMCall", {
            beingId: ctx.beingId,
            rootId: ctx.rootId,
            role: session.role?.name,
            model: clientEntry?.model || MODEL,
            usage: null,
            hasToolCalls: false,
            _failedGeneration: true,
            actId: _llmChatId,
            sessionId: _llmSessionId,
            responseText: extracted || null,
          })
          .catch(() => {});
      } else {
        log.error(
          "LLM",
          `Model invented tool "${inventedTool}" but no usable text could be extracted from failed_generation.`,
        );
        throw apiErr;
      }
    } else if (
      (isJsonEscapeError(apiErr) || isJsonStructuralError(apiErr)) &&
      !session._jsonRetryDone
    ) {
      // The provider rejected the model's tool-call JSON. Two
      // distinct failure shapes: bad escape sequences in arguments
      // (model wrote raw backslashes, control chars), or structural
      // breakage in the envelope (unmatched bracket, truncated
      // string). Each gets its own corrective system line; a blind
      // retry of the identical request would just fail identically.
      // The guard below caps retries at one per session — if the
      // model can't produce clean output even with the hint, I
      // surface the error instead of looping forever.
      session._jsonRetryDone = true;
      const errMsg = String(
        apiErr.message || apiErr.error?.message || "",
      ).slice(0, 200);
      const isEscape = isJsonEscapeError(apiErr);
      const failureClass = isEscape ? "escape" : "structural";
      log.warn(
        "LLM",
        `JSON ${failureClass} failure on ${MODEL} (${errMsg}). Retrying once with corrective hint.`,
      );

      // Diagnostic line for the structural class. Captures the
      // shape of what I sent (model, connection, message count,
      // input size, max_tokens) plus any partial output the
      // provider salvaged. When max_tokens prints "unset" the
      // provider's silent default is the prime suspect for
      // mid-stream truncation.
      try {
        const totalMessageChars = (session.messages || []).reduce(
          (sum, m) =>
            sum + (typeof m?.content === "string" ? m.content.length : 0),
          0,
        );
        const failedGen =
          apiErr?.error?.failed_generation ||
          apiErr?.error?.failed_response ||
          null;
        const failedGenLen = failedGen ? String(failedGen).length : null;
        const failedGenTail = failedGen
          ? String(failedGen).slice(-200).replace(/\s+/g, " ")
          : null;
        log.warn(
          "LLM",
          `↳ diagnostic: model=${MODEL} ` +
            `connection=${clientEntry?.connectionId ? String(clientEntry.connectionId).slice(0, 8) : "default"} ` +
            `messages=${(session.messages || []).length} ` +
            `inputChars=${totalMessageChars} ` +
            `tools=${tools.length} ` +
            `max_tokens=${requestParams.max_tokens ?? "unset"} ` +
            (failedGenLen != null
              ? `partialOutputChars=${failedGenLen} `
              : "") +
            (failedGenTail ? `tail="${failedGenTail}"` : ""),
        );
      } catch (diagErr) {
        log.debug(
          "LLM",
          `structural-failure diagnostic skipped: ${diagErr.message}`,
        );
      }

      const escapeHint =
        `The provider could not deserialize one of your tool-call arguments because it contained ` +
        `invalid escape sequences (raw backslashes, backslash followed by a space, or unescaped ` +
        `control characters). RETRY WITH SIMPLER CONTENT: avoid backslashes entirely in tool ` +
        `arguments, keep content ASCII where possible, and prefer prose over literal code / regex / ` +
        `file paths. If you must include code, keep it short and use only simple identifiers.`;

      const structuralHint =
        `The provider could not deserialize your tool-call payload because the JSON envelope itself ` +
        `was malformed at a structural position (unmatched bracket, unexpected token after a key/` +
        `value pair, or a truncated string). This is usually NOT about escape characters — your ` +
        `previous content may have been fine, but the JSON wrapping around it broke. RETRY by: ` +
        `(1) keeping tool-call arguments shorter — split a long file into multiple smaller writes ` +
        `if needed; (2) double-checking that every quote, bracket, and brace in your arguments ` +
        `is balanced; (3) avoiding embedding raw long strings of code that may have triggered a ` +
        `truncation. The fix is structural, not lexical — do not strip backslashes or rewrite as ` +
        `prose unless the content itself was the problem.`;

      session.messages.push({
        role: "system",
        content:
          `Your previous turn failed with a JSON parse error: "${errMsg}". ` +
          (isEscape ? escapeHint : structuralHint),
      });
      ctx._retryJsonEscape = true;
    } else {
      throw apiErr;
    }
  }

  // The retry re-enters callLLM. The corrective system line is
  // already in session.messages; the _jsonRetryDone guard on
  // session prevents a second pass through this branch.
  if (ctx._retryJsonEscape) {
    ctx._retryJsonEscape = false;
    return await callLLM(
      openai,
      MODEL,
      session,
      tools,
      ctx,
      clientEntry,
      presenceKey,
    );
  }

  // Provider response shapes vary. Some return null, some return an
  // empty choices array, some return a choice with no message. I
  // normalize to "the AI couldn't answer" so the loop can keep
  // going instead of crashing on .choices[0].message.
  if (!response || !response.choices || !Array.isArray(response.choices)) {
    log.warn(
      "LLM",
      `LLM returned malformed response (no choices array). Model: ${MODEL}`,
    );
    response = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "I was unable to generate a response. Please try again.",
          },
          finish_reason: "stop",
        },
      ],
    };
  } else if (response.choices.length === 0) {
    log.warn("LLM", `LLM returned empty choices array. Model: ${MODEL}`);
    response = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "I was unable to generate a response. Please try again.",
          },
          finish_reason: "stop",
        },
      ],
    };
  } else if (!response.choices[0].message) {
    log.warn("LLM", `LLM returned choice without message. Model: ${MODEL}`);
    response.choices[0].message = {
      role: "assistant",
      content: "I was unable to generate a response. Please try again.",
    };
  }

  return response;
}


/**
 * I run one tool call. The LLM has asked for a hand reach: parse
 * its args, check the per-tool circuit breaker, fire beforeToolCall
 * so extensions can rewrite or cancel, dispatch through the MCP
 * client (the handler lives wherever — in-process extension, a
 * separate MCP server, doesn't matter to me), capture the result,
 * fire afterToolCall. The result lands in session.messages as the
 * `tool` role partner of the assistant's tool_call so the next
 * call I make sees the answer in its history.
 */
async function executeTool(toolCall, session, ctx, presenceKey) {
  const toolName = toolCall.function.name;
  let args;

  if (
    !toolCall.function.arguments ||
    typeof toolCall.function.arguments !== "string"
  ) {
    log.error("LLM", `Missing or non-string tool arguments for ${toolName}`);
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: "Missing tool arguments" }),
    });
    return { tool: toolName, success: false, error: "Missing tool arguments" };
  }

  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    log.error("LLM", `Invalid tool arguments for ${toolName}:`, e.message);
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: "Invalid arguments" }),
    });
    return {
      tool: toolName,
      success: false,
      error: "Invalid arguments",
    };
  }

  // Auto-injected context args. The LLM doesn't know the summon's
  // identifiers; I do. I stamp them onto every tool call so the
  // handler on the other side of MCP can correlate back without
  // global lookups. beingId names the caller; actId/sessionId tie
  // to this LLM turn; rootStampId points at the user-message-level
  // root for per-turn state; ibpAddress identifies the conversation;
  // spaceId pins the position. Mirrors what mcp/server.js stamps on
  // HTTP-path calls so handlers see one shape regardless of route.
  args.beingId = ctx.beingId;
  if (ctx?.actId && !args.actId) args.actId = ctx.actId;
  if (ctx?.sessionId && !args.sessionId) args.sessionId = ctx.sessionId;
  if (ctx?.rootStampId && !args.rootStampId)
    args.rootStampId = ctx.rootStampId;
  else if (ctx?.actId && !args.rootStampId)
    args.rootStampId = ctx.actId;
  if (presenceKey && !args.ibpAddress) args.ibpAddress = presenceKey;
  if (ctx.rootId && !args.rootId) args.rootId = ctx.rootId;
  // Position-pin. When a turn is dispatched with an explicit
  // ctx.currentSpace (sub-Ruler turn, branch dispatch, Worker-at-
  // scope, etc.) the tool call places AT THAT space even if the user
  // navigates somewhere else mid-turn. Without this, a dispatched
  // Worker's writes follow the user's cursor — position is per-being,
  // and user-driven and dispatch-driven turns share it. The pin is
  // the only thing keeping the two flows from clobbering each other.
  const _curNode =
    ctx.currentSpace || getCurrentSpace(ctx.beingId) || ctx.rootId || null;
  if (_curNode && !args.spaceId) args.spaceId = _curNode;

  // Per-tool circuit breaker. If one tool keeps failing this
  // session, I disable it for the rest of the session. The tool
  // disappears from the AI's perspective; it routes around. One
  // bad API key kills one tool, not the whole turn.
  if (!session._toolFailures) session._toolFailures = {};
  const toolCircuitThreshold = parseInt(
    getPlaceConfigValue("toolCircuitThreshold") || "5",
    10,
  );
  if ((session._toolFailures[toolName] || 0) >= toolCircuitThreshold) {
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        error: `Tool "${toolName}" has been temporarily disabled due to repeated failures. Use a different approach.`,
      }),
    });
    return {
      tool: toolName,
      args,
      success: false,
      error: "tool_circuit_tripped",
    };
  }

  // beforeToolCall lets extensions rewrite args or cancel the call.
  // actId / sessionId / spaceId let forensics correlate the call
  // back to the originating turn.
  const _toolChatId = ctx?.actId || null;
  const _toolSessionId = ctx?.sessionId || null;
  const hookData = {
    toolName,
    args,
    beingId: ctx.beingId,
    rootId: ctx.rootId,
    role: session.role?.name,
    actId: _toolChatId,
    sessionId: _toolSessionId,
    spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
  };
  const hookResult = await hooks.run("beforeToolCall", hookData);
  if (hookResult.cancelled) {
    const errCode = hookResult.timedOut ? "HOOK_TIMEOUT" : "HOOK_CANCELLED";
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        error: hookResult.reason || "Tool call cancelled",
        code: errCode,
      }),
    });
    return { tool: toolName, args, success: false, error: errCode };
  }
  args = hookData.args;
  const resolvedToolName = hookData.toolName || toolName;

  log.debug("LLM", `🔧 [role:${session.role?.name}] ${resolvedToolName}`, args);

  // Announce the call before I dispatch it. Live consumers (CLI,
  // web) get to show "running <tool>..." while the work is happening
  // instead of waiting for the answer to flash in.
  if (ctx.onToolCalled) {
    try {
      ctx.onToolCalled({ tool: resolvedToolName, args });
    } catch {
      /* never let a listener break the tool loop */
    }
  }

  // DB health gate. If Mongo is unreachable, every substrate-touching
  // tool will fail in the same way; rather than burn time on the
  // failures, I tell the AI directly so it can speak to the user.
  if (!isDbHealthy()) {
    const dbErr =
      "Database is currently unavailable. Tell the user the place is experiencing issues and to try again shortly.";
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: dbErr }),
    });
    return { tool: toolName, args, success: false, error: "db_unavailable" };
  }

  try {
    // Direct handler dispatch. Tools are verb-tagged and registered
    // with their handler in voices/llm/tools.js; the handler IS the
    // verb call (it usually wraps place.see / place.do / place.summon /
    // place.be against a target). The verb dispatcher's authorize gate
    // covers per-verb auth and the extension-scope block — no protocol
    // layer between the LLM voice and the handler.
    const { getToolHandler } = await import("./tools.js");
    const handler = getToolHandler(resolvedToolName);
    if (typeof handler !== "function") {
      throw new Error(`Tool "${resolvedToolName}" has no registered handler`);
    }
    const nodeToolTimeout =
      session._nodeLlmConfig?.toolCallTimeout ?? getToolCallTimeoutMs();
    const result = await Promise.race([
      Promise.resolve(handler(args)),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Tool "${resolvedToolName}" timed out after ${nodeToolTimeout / 1000}s`,
              ),
            ),
          nodeToolTimeout,
        ),
      ),
    ]);
    let resultText =
      typeof result === "string" ? result : JSON.stringify(result);
    // Cap the result before it joins history. The full answer
    // already informed this turn; only the historical copy gets
    // truncated, so future turns don't drag a megabyte of file dump
    // across the wire on every call.
    const nodeResultMax =
      session._nodeLlmConfig?.toolResultMaxBytes ?? getToolResultMaxBytes();
    if (resultText && Buffer.byteLength(resultText, "utf8") > nodeResultMax) {
      const charEstimate = Math.floor(nodeResultMax * 0.9);
      resultText =
        resultText.slice(0, charEstimate) +
        `\n... (truncated, result exceeded ${Math.round(nodeResultMax / 1024)}KB)`;
    }

    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: resultText,
    });

    // Success clears the breaker. One transient failure shouldn't
    // disable a tool for the rest of the turn.
    delete session._toolFailures[resolvedToolName];

    hooks
      .run("afterToolCall", {
        toolName: resolvedToolName,
        args,
        result: resultText,
        success: true,
        beingId: ctx.beingId,
        rootId: ctx.rootId,
        role: session.role?.name,
        actId: _toolChatId,
        sessionId: _toolSessionId,
        spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
      })
      .catch(() => {});

    // The full text rides back on the return so the Act row can
    // archive what actually ran. Callers that only need success/fail
    // ignore it; the extra field costs nothing.
    return { tool: resolvedToolName, args, result: resultText, success: true };
  } catch (err) {
    log.error("LLM", `❌ Tool ${resolvedToolName} failed:`, err.message);

    session._toolFailures[resolvedToolName] =
      (session._toolFailures[resolvedToolName] || 0) + 1;
    if (session._toolFailures[resolvedToolName] >= toolCircuitThreshold) {
      log.warn(
        "LLM",
        `Tool "${resolvedToolName}" tripped after ${toolCircuitThreshold} consecutive failures. Disabled for this session.`,
      );
    }

    // If Mongo died during the call, the error shape is misleading;
    // I rewrite the message so the AI knows the cause.
    const errorMsg = !isDbHealthy()
      ? "Database became unavailable during this operation. Tell the user the place is experiencing issues."
      : err.message;

    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: errorMsg }),
    });

    hooks
      .run("afterToolCall", {
        toolName: resolvedToolName,
        args,
        error: err.message,
        success: false,
        beingId: ctx.beingId,
        rootId: ctx.rootId,
        role: session.role?.name,
        actId: _toolChatId,
        sessionId: _toolSessionId,
        spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
      })
      .catch(() => {});

    return {
      tool: resolvedToolName,
      args,
      success: false,
      error: err.message,
    };
  }
}

/**
 * Close the turn. The loop has exited; I have either a text answer
 * or a response that ends with tool_calls but no prose. In the
 * second case I make one more call to the model with no tools so it
 * speaks its conclusion. Then I append the final assistant message
 * to the buffer (unless this is an internal-shaped turn where the
 * caller wants the raw response object) and hand the answer back
 * with provenance for the Act row.
 */
async function finalizeResponse(
  session,
  openai,
  MODEL,
  response,
  isInternal,
  isCustom,
  resolvedConnectionId,
  ctx,
) {
  // Ensure final text response. If the tool loop ended with no text content
  // (e.g., model returned only tool calls), make one more call to get a summary.
  if (!response?.choices?.[0]?.message?.content) {
    const finalResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: session.messages,
    });
    response = finalResponse;
  }

  const finalAnswer = response?.choices?.[0]?.message?.content || "Done.";

  // Append only if the loop didn't already place this exact answer.
  // Avoids the assistant message appearing twice on weird code paths.
  if (!isInternal) {
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg?.role !== "assistant" || lastMsg?.content !== finalAnswer) {
      session.messages.push({ role: "assistant", content: finalAnswer });
    }
  }

  // _internal carries provenance for the closing stamp() (which
  // model, which connection). Never leaves the seed; clients see
  // only the text.
  const _internal = {
    role: session.role?.name,
    rootId: getSpaceRootId(ctx.beingId),
    isCustom,
    model: MODEL,
    connectionId: resolvedConnectionId || null,
  };

  return {
    success: true,
    content: finalAnswer,
    text: finalAnswer,
    _internal,
  };
}

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

    // Place mode. The whole point of the turn is the tool calls,
    // not the prose; once at least one tool succeeds I stop. Saves
    // a round-trip generating an answer the user will never see.
    if (ctx.skipRespond && toolResults.some((r) => r?.success !== false)) {
      continueReason = "place-done";
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
  // re-enter on a new step with continuation: true) and place-done
  // (the tools were the answer, no prose needed).
  if (continueReason === "tool-cap" || continueReason === "place-done") {
    const _internal = {
      role: session.role?.name,
      rootId: getSpaceRootId(ctx.beingId),
      isCustom,
      model: MODEL,
      connectionId: resolvedConnectionId || null,
    };
    return {
      success: true,
      content: "",
      text: "",
      _internal,
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
// Inside, I derive identifiers, open or reuse the MCP connection,
// open the Act row, set the position, run stepTurn, fire
// beforeResponse on the answer, finalize the Act row, and hand
// back { text, actId, role, sessionKey } to the role's handler
// for reply emission.
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
    await import("../../intake/session.js");
  const { resolvePipelineKey } = await import("../../intake/session.js");
  const { computeIbpStampAddress } = await import("../../../ibp/address.js");

  // The IBP Address is the conversation identifier. When I can
  // resolve both stances, that address keys the per-being session
  // across every Act between these two beings; when I can't, I
  // fall back to an ephemeral pipeline key so the turn still runs.
  const _eagerIbpAddress = beingOut
    ? await computeIbpStampAddress({
        askerBeingId: beingId,
        askerPosition: getCurrentSpace(beingId) || null,
        addresseeBeingId: beingOut,
      })
    : null;
  const { key: resolvedKey } = resolvePipelineKey({ beingId, rootId });
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
      rootStampId: actId,
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
    throw err;
  }

  const stopped = abortSignal.aborted;
  let text = stopped
    ? null
    : result?.content || result?.answer || "No response.";

  // 5. Last shaping pass. beforeResponse lets extensions rewrite
  // the answer before it leaves (PII redaction, formatting, etc.).
  // The scheduler reads this text and presses the closing face on
  // the Act row with it.
  if (text && !stopped) {
    try {
      const hookData = { content: text, beingId, rootId, role: role.name };
      await hooks.run("beforeResponse", hookData);
      text = hookData.content;
    } catch {}
  }

  // 6. Release the abort registration. The session buffer + MCP
  // connection stay alive for the next turn on this key; only the
  // cancel hook for this specific turn lets go.
  if (abort) clearSessionAbort(sessionKey);

  return {
    text,
    actId,
    role: role.name,
    sessionKey,
  };
  } finally {
    _activeRunTurns--;
  }
}
