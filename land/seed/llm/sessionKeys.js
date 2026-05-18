/**
 * AI-chat session key builders.
 *
 * What `aiSessionKey` IS, after the per-being / per-Portal-Address refactor:
 *
 *   - A transport-session identifier. Each tab / CLI / mobile reach gets
 *     its own key so the in-memory `sessions` Map in conversation.js can
 *     hold per-tab LLM-conversation buffers (messages[], modeKey) without
 *     two tabs clobbering each other's working state.
 *   - The cache key for stanceless background pipelines (compress, scout,
 *     intent, dreams, …). Those use `pipeline:ephemeral:<uuid>` or
 *     `pipeline:tree:<rootId>:<purpose>` keys — see
 *     `resolveInternalAiSessionKey` below.
 *   - A tracing/logging label. JWTs carry it so MCP tool calls and server
 *     logs can be correlated to the reach that initiated them.
 *
 * What `aiSessionKey` IS NOT used for anymore:
 *
 *   - Position state. Lives on `Being.currentPositionId` keyed by beingId
 *     (Slice 1). Two tabs for the same being share position automatically.
 *   - Thread identity. The canonical identifier for a conversation between
 *     two beings is `Chat.ibpAddress` (Slice 0).
 *   - Tool-call → summonId correlation. The conversation loop injects
 *     `summonId` / `rootSummonId` / `ibpAddress` into MCP tool args
 *     directly; mcp/server.js reads them without a Map lookup (Slice 2).
 *   - MCP client cache key for being-to-being conversations. Keyed by
 *     `ibpAddress` so all the being's sockets share one MCP client
 *     (Slice 3). Internal-cognition pipelines still key on aiSessionKey.
 *   - Per-conversation extension state (ruler/foreman decisions, abort
 *     registry, pending plans, swarm plans). Keyed on `rootSummonId` or
 *     `ibpAddress` per each Map's semantics (Slice 4).
 *   - Per-socket broadcast for async chat events. The conversation loop
 *     emits via `io.to('being:' + beingId)` so every tab the being has
 *     connected receives the stream (Slice 5).
 *
 * Entry points (websocket.js, routes/api/orchestrate.js, gateway extensions)
 * pass raw ingredients to runOrchestration; runOrchestration is the sole
 * caller of buildUserAiSessionKey. Extensions never import this file.
 *
 * Key shapes:
 *   user:${beingId}:${rootId}:${device}       (tree; handle replaces device)
 *   user:${beingId}:home:${device}
 *   user:${beingId}:land:${device}
 *
 * `device` (from socket.clientKind, "http", or a gateway-composed
 * "${channel}:${external_id}") is the default last segment so CLI,
 * dashboard, mobile, and every gateway auto-decouple. Two simultaneous
 * reaches on the same tree get separate aiSessionKeys (which means
 * separate per-tab LLM buffers) but share their being-level state.
 *
 * `handle`, when provided, REPLACES device:
 *   - handle="shared" from two devices → one merged tab-level buffer
 *   - handle="draft-xyz" from one device → a named side-thread
 *
 * nodeId intentionally omitted from the key — position is per-being now,
 * not per-aiSessionKey.
 */

/**
 * Resolve the pipeline key for a runChat / OrchestratorRuntime call.
 *
 * A pipeline key identifies a stanceless internal-cognition lane — the
 * conversation-equivalent cache key for work that has no addressee
 * being. Distinct namespace from `aiSessionKey` (transport identity)
 * and `ibpAddress` (being-to-being conversation identity).
 *
 * Three paths, in priority order:
 *   1. `pipelineKey` — explicit pass-through (extension joining an upstream caller's pipeline).
 *   2. `scope` + `purpose` — extension declares a named internal lane.
 *      Produces `pipeline:tree:${rootId}:${purpose}[:${extra}]`,
 *      `pipeline:home:${beingId}:${purpose}[:${extra}]`, or
 *      `pipeline:land:${purpose}[:${extra}]`.
 *   3. Neither — fresh `pipeline:ephemeral:${uuid}`. One-shot, no
 *      cross-call memory.
 *
 * Returns `{ key, persist }`. `persist === false` iff the key is
 * ephemeral — callers skip the session-chain cache so the key dies
 * with the call.
 */
export function resolvePipelineKey({
  pipelineKey = null,
  scope = null,
  purpose = null,
  extra = null,
  beingId = null,
  rootId = null,
  makeEphemeral,
}) {
  if (pipelineKey) {
    return { key: pipelineKey, persist: !pipelineKey.startsWith("pipeline:ephemeral:") };
  }
  if (scope) {
    const suffix = extra ? `:${String(extra).slice(0, 64).replace(/[^a-z0-9:._-]/gi, "")}` : "";
    if (scope === "tree") {
      if (!rootId || !purpose) throw new Error("resolvePipelineKey: scope='tree' requires rootId and purpose");
      return { key: `pipeline:tree:${rootId}:${purpose}${suffix}`, persist: true };
    }
    if (scope === "home") {
      if (!beingId || !purpose) throw new Error("resolvePipelineKey: scope='home' requires beingId and purpose");
      return { key: `pipeline:home:${beingId}:${purpose}${suffix}`, persist: true };
    }
    if (scope === "land") {
      if (!purpose) throw new Error("resolvePipelineKey: scope='land' requires purpose");
      return { key: `pipeline:land:${purpose}${suffix}`, persist: true };
    }
    throw new Error(`resolvePipelineKey: unknown scope "${scope}"`);
  }
  // Ephemeral. Caller supplies the uuid factory so tests can stub it.
  const uuid = typeof makeEphemeral === "function" ? makeEphemeral() : cryptoRandomUUID();
  return { key: `pipeline:ephemeral:${uuid}`, persist: false };
}

// Back-compat alias for any callers still importing the old name.
// Slated for deletion once all imports have migrated.
export const resolveInternalAiSessionKey = resolvePipelineKey;

function cryptoRandomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Fallback: node < 19
  // eslint-disable-next-line global-require
  return require("node:crypto").randomUUID();
}

export function buildUserAiSessionKey({ beingId, zone, rootId = null, device = null, handle = null }) {
  if (!beingId) throw new Error("buildUserAiSessionKey: beingId required");
  if (!zone) throw new Error("buildUserAiSessionKey: zone required");
  // At least one of `device` or `handle` must be present. Without this
  // guard, a caller that forgets to pass device silently collapses every
  // reach into one shared `…:default` session — a latent cross-user /
  // cross-device collision. Entry points (ws/http/gateways) must pass
  // `device` at minimum. Handle is the opt-in override.
  if (!device && !handle) {
    throw new Error("buildUserAiSessionKey: device or handle required (entry points must declare the reach)");
  }

  let anchor;
  if (zone === "tree") {
    if (!rootId) throw new Error("buildUserAiSessionKey: zone='tree' requires rootId");
    anchor = rootId;
  } else if (zone === "home" || zone === "land") {
    anchor = zone;
  } else {
    throw new Error(`buildUserAiSessionKey: unknown zone "${zone}"`);
  }

  const suffix = handle || device;
  const u = String(beingId).slice(0, 64);
  const s = String(suffix).slice(0, 64).replace(/[^a-z0-9:._-]/gi, "");
  if (!s) throw new Error("buildUserAiSessionKey: device/handle reduced to empty after sanitization");
  return `user:${u}:${anchor}:${s}`;
}
