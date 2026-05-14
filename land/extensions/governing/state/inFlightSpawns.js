// In-flight spawn tracker.
//
// Several governance tools (governing-hire-planner, governing-hire-
// contractor, governing-dispatch-execution, governing-revise-plan,
// governing-route-to-foreman, governing-resume-execution, foreman-
// retry-branch) spawn another role as a chainstep and await its
// completion synchronously inside the tool handler. When the spawned
// chain is long-running (especially dispatch-execution which recurses
// through sub-Rulers), the MCP request can exceed the kernel's
// TOOL_CALL_TIMEOUT_MS. The kernel surfaces -32001 to the LLM; the
// LLM commonly responds by re-emitting the same tool call — which
// starts a SECOND concurrent spawn at the same scope.
//
// This module is the substrate-level guard against that duplicate
// spawn. Before a spawn starts, claim() records the spawn under a
// key composed of rulerNodeId + kind. If a claim already exists, the
// caller learns "already in-flight since T" and returns a pending
// response without spawning a duplicate. release() runs in a finally
// block so a thrown handler doesn't leak the claim.
//
// Pass 2 architectural note: spawn-and-await is a synchronous
// pattern that doesn't fit MCP's request/response shape well for
// LLM chains that take 10+ minutes. The Pass 2 rework would make
// these tools fire-and-forget — return immediately with a spawn-id,
// let the natural event loop (Foreman wakeups, dashboard SSE) drive
// resolution. This file is the bounded fix until that rework lands.

const _inFlight = new Map();

function makeKey(rulerNodeId, kind) {
  return `${String(rulerNodeId)}::${String(kind)}`;
}

/**
 * Try to claim an in-flight slot for (rulerNodeId, kind).
 * Returns:
 *   { ok: true, key }                — claim succeeded; caller spawns
 *   { ok: false, existing, since }   — claim refused; caller returns pending
 */
export function tryClaim({ rulerNodeId, kind, visitorId = null, briefing = null }) {
  if (!rulerNodeId || !kind) return { ok: true, key: null };
  const key = makeKey(rulerNodeId, kind);
  const existing = _inFlight.get(key);
  if (existing) {
    return {
      ok: false,
      existing: { ...existing, key },
      since: existing.since,
    };
  }
  const entry = {
    rulerNodeId: String(rulerNodeId),
    kind: String(kind),
    visitorId: visitorId ? String(visitorId) : null,
    briefing: briefing ? String(briefing).slice(0, 200) : null,
    since: new Date().toISOString(),
    sinceMs: Date.now(),
  };
  _inFlight.set(key, entry);
  return { ok: true, key };
}

/**
 * Release the claim. Safe to call multiple times; releasing a stale
 * key is a no-op. Always release in a finally block.
 */
export function release(key) {
  if (!key) return;
  _inFlight.delete(key);
}

/**
 * Read all in-flight spawns at a scope (or all globally if rulerNodeId
 * is omitted). Used for diagnostics / dashboard / Foreman snapshot.
 */
export function listInFlight(rulerNodeId = null) {
  const out = [];
  for (const [key, entry] of _inFlight) {
    if (rulerNodeId && entry.rulerNodeId !== String(rulerNodeId)) continue;
    out.push({ key, ...entry, ageMs: Date.now() - entry.sinceMs });
  }
  return out;
}

/**
 * Sweep stale claims older than maxAgeMs (default 1 hour). Belt and
 * suspenders: if a handler crashed without releasing, the claim
 * leaks forever; the sweep recovers.
 */
export function sweepStale(maxAgeMs = 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let swept = 0;
  for (const [key, entry] of _inFlight) {
    if (entry.sinceMs < cutoff) {
      _inFlight.delete(key);
      swept++;
    }
  }
  return swept;
}

/**
 * Produce a pending-result tool response shape. The LLM reads this
 * when its retry hits an in-flight slot — it should see "another
 * instance is already running this work" and back off rather than
 * starting again.
 */
export function buildPendingResponse({ existing, kind }) {
  const ageS = Math.round((Date.now() - existing.sinceMs) / 1000);
  return {
    ok: false,
    pending: true,
    kind,
    rulerNodeId: existing.rulerNodeId,
    since: existing.since,
    ageSeconds: ageS,
    note:
      `A ${kind} spawn at this Ruler scope started ${ageS}s ago and is still in flight. ` +
      `Another instance is already doing this work. DO NOT call ${kind} again — instead, ` +
      `synthesize an instruction-completion-report acknowledging the spawn is mid-flight, ` +
      `and exit your turn. The original spawn's outcome will drive subsequent state. ` +
      `Re-invoking would duplicate work and is rejected by the substrate.`,
  };
}
