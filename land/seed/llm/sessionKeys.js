/**
 * AI-chat session key builders.
 *
 * Entry points (websocket.js, routes/api/orchestrate.js, gateway extensions)
 * pass raw ingredients to runOrchestration; runOrchestration is the sole
 * caller of buildUserAiSessionKey. Extensions never import this file.
 *
 * Key shapes:
 *   user:${userId}:${rootId}:${device}       (tree; handle replaces device)
 *   user:${userId}:home:${device}
 *   user:${userId}:land:${device}
 *
 * `device` (from socket.clientKind, "http", or a gateway-composed
 * "${channel}:${external_id}") is the default last segment so CLI,
 * dashboard, mobile, and every gateway auto-decouple. Two simultaneous
 * reaches on the same tree produce two sessions, not one merged thread.
 *
 * `handle`, when provided, REPLACES device:
 *   - handle="shared" from two devices → one merged session (explicit)
 *   - handle="draft-xyz" from one device → a named side-thread
 *
 * nodeId intentionally omitted — position is tracked as session state
 * via setCurrentNodeId, not as part of the key. This preserves cross-
 * branch conversational continuity within a tree.
 */

/**
 * Resolve the ai-chat session key for a runChat / OrchestratorRuntime call.
 *
 * Three paths, in priority order:
 *   1. `aiSessionKey` — explicit pass-through (extension joining an upstream caller's session).
 *   2. `scope` + `purpose` — extension declares a named internal lane.
 *      Produces `tree-internal:${rootId}:${purpose}[:${extra}]`,
 *      `home-internal:${userId}:${purpose}[:${extra}]`, or
 *      `land-internal:${purpose}[:${extra}]`.
 *   3. Neither — fresh `ephemeral:${uuid}`. One-shot, no cross-call memory.
 *
 * Returns `{ key, persist }`. `persist === false` iff the key is ephemeral —
 * callers skip the session-chain cache so the key dies with the call.
 */
export function resolveInternalAiSessionKey({
  aiSessionKey = null,
  scope = null,
  purpose = null,
  extra = null,
  userId = null,
  rootId = null,
  makeEphemeral,
}) {
  if (aiSessionKey) {
    return { key: aiSessionKey, persist: !aiSessionKey.startsWith("ephemeral:") };
  }
  if (scope) {
    const suffix = extra ? `:${String(extra).slice(0, 64).replace(/[^a-z0-9:._-]/gi, "")}` : "";
    if (scope === "tree") {
      if (!rootId || !purpose) throw new Error("resolveInternalAiSessionKey: scope='tree' requires rootId and purpose");
      return { key: `tree-internal:${rootId}:${purpose}${suffix}`, persist: true };
    }
    if (scope === "home") {
      if (!userId || !purpose) throw new Error("resolveInternalAiSessionKey: scope='home' requires userId and purpose");
      return { key: `home-internal:${userId}:${purpose}${suffix}`, persist: true };
    }
    if (scope === "land") {
      if (!purpose) throw new Error("resolveInternalAiSessionKey: scope='land' requires purpose");
      return { key: `land-internal:${purpose}${suffix}`, persist: true };
    }
    throw new Error(`resolveInternalAiSessionKey: unknown scope "${scope}"`);
  }
  // Ephemeral. Caller supplies the uuid factory so tests can stub it.
  const uuid = typeof makeEphemeral === "function" ? makeEphemeral() : cryptoRandomUUID();
  return { key: `ephemeral:${uuid}`, persist: false };
}

function cryptoRandomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Fallback: node < 19
  // eslint-disable-next-line global-require
  return require("node:crypto").randomUUID();
}

export function buildUserAiSessionKey({ userId, zone, rootId = null, device = null, handle = null }) {
  if (!userId) throw new Error("buildUserAiSessionKey: userId required");
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
  const u = String(userId).slice(0, 64);
  const s = String(suffix).slice(0, 64).replace(/[^a-z0-9:._-]/gi, "");
  if (!s) throw new Error("buildUserAiSessionKey: device/handle reduced to empty after sanitization");
  return `user:${u}:${anchor}:${s}`;
}
