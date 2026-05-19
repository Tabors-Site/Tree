/**
 * Session key builders.
 *
 * What `clientSessionId` IS:
 *   - A transport-session identifier. One per tab / CLI / mobile reach.
 *     Built at connect time in transports/ws/websocket.js as
 *     `${beingId}:${clientKind}:${clientInstance}` and stable for the
 *     lifetime of the reach (survives socket reconnect because
 *     `clientInstance` is client-stable across refresh; `socket.id`
 *     rotates). Used for per-tab enqueue serialization, in-flight chat
 *     re-attach, and tracing/logging.
 *   - A tracing/logging label. JWTs and MCP tool calls correlate back
 *     to the reach that initiated them via this id.
 *
 * What `clientSessionId` IS NOT:
 *   - Conversation identity. The canonical identifier for a conversation
 *     between two beings is `Summon.ibpAddress` (the stance pair).
 *   - Position state. Lives on `Being.currentPositionId`. Two tabs for
 *     the same being share position automatically.
 *   - Tool-call → summonId correlation. The SUMMON loop injects
 *     `summonId` / `rootCorrelation` / `ibpAddress` into MCP tool args
 *     directly; mcp/server.js reads them without a Map lookup.
 *   - MCP client cache key. Keyed by `ibpAddress` so all the being's
 *     sockets share one MCP client.
 *   - Per-conversation extension state (ruler/foreman decisions, abort
 *     registry, pending plans). Keyed on `rootCorrelation` or
 *     `ibpAddress` per each Map's semantics.
 *   - Per-socket broadcast for async chat events. The SUMMON loop
 *     emits via `io.to('being:' + beingId)` so every tab the being has
 *     connected receives the stream.
 *
 * Composing a session-shaped key from payload state at dispatch time
 * (the retired `buildUserAiSessionKey` shape) is a legacy anti-pattern
 * — reach the transport key via `socket.clientSessionId`; reach
 * conversation continuity via IBP Address.
 */

/**
 * Resolve the pipeline key for a runChat / OrchestratorRuntime call.
 *
 * A pipeline key identifies a stanceless internal-cognition lane — the
 * conversation-equivalent cache key for work that has no addressee
 * being. Distinct namespace from `clientSessionId` (transport identity)
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
