// Per-conversation AbortController registry.
//
// swarm.js creates a `branchAbort` controller inside a per-branch closure
// that bridges parent signal → child signal. The closure publishes
// nothing; cancel-subtree (in ruling.js) needs a way to reach in-flight
// LLM calls and abort them.
//
// This registry exposes active controllers so cancel-subtree can abort
// them. Each branch's runBranch closure registers its controller on
// entry and removes it on exit. cancel-subtree's dispatch case looks
// up active controllers under the cancelling scope and aborts them —
// propagation to nested children rides on the existing parent → child
// signal bridging.
//
// Keying: `conversationKey`. Identifies the conversation that the
// in-flight controllers belong to:
//   - For being-to-being conversations this is the canonical Portal
//     Address (so multiple sockets / chainsteps under the same
//     conversation see the same abort fleet).
//   - For stanceless background pipelines it's the internal session
//     key (`ephemeral:<uuid>` / `tree-internal:<rootId>:<purpose>`).
// The Map is string-keyed; callers pick the right flavor for their
// context.
//
// PER-CONVERSATION-SYNCHRONOUS ASSUMPTION:
// Today, one conversation has at most one active turn at a time.
// Within that turn, swarm dispatches branches sequentially (one
// runBranch resolves before the next begins). Nested sub-Rulers run
// inside the same call stack — the controllers are nested in time,
// not concurrent. So a per-conversation flat list of controllers is
// correct AS LONG AS this assumption holds.
//
// When concurrent turns become a real use case (Pass 2 court hearings?
// parallel sub-Rulers?), the registry should re-key by execution-
// record-node-id instead of conversationKey. Queued for that
// refactor; today's keying is sufficient.
//
// Race shape: registration happens BEFORE the LLM call begins
// (synchronous setup); deregistration happens in the branch's
// finally-block (synchronous teardown). cancel-subtree's abort runs
// during the LLM call. No race between register and abort because
// the LLM call dwarfs both setup and teardown.

import log from "../../seed/log.js";

// conversationKey → array of { controller, scopeNodeId, branchName }.
// The array models the call-stack: outer branches earlier, inner
// branches later. Aborting an outer scope must abort everything below
// (call-stack discipline); we walk the list from the matching scope
// onward and abort each.
const registry = new Map();

/**
 * Register an AbortController against a conversation + scope. Returns a
 * deregistration function the caller stores in its finally-block.
 *
 * scopeNodeId is the Ruler scope this branch is running under (or
 * the project root if it's a top-level dispatch). Used by
 * abortUnderScope to know which controllers should fire when a
 * cancel-subtree is issued at a higher scope.
 *
 * `aiSessionKey` is accepted as a legacy alias for `conversationKey`
 * during the per-conversation rekey migration. New callers should
 * pass `conversationKey`.
 */
export function registerController({ conversationKey, aiSessionKey, scopeNodeId, branchName, controller }) {
  const key = conversationKey || aiSessionKey;
  if (!key || !controller) return () => {};
  const k = String(key);
  const list = registry.get(k) || [];
  const entry = {
    controller,
    scopeNodeId: scopeNodeId ? String(scopeNodeId) : null,
    branchName: branchName ? String(branchName) : null,
    registeredAt: Date.now(),
  };
  list.push(entry);
  registry.set(k, list);
  return function deregister() {
    const cur = registry.get(k);
    if (!cur) return;
    const idx = cur.indexOf(entry);
    if (idx >= 0) cur.splice(idx, 1);
    if (cur.length === 0) registry.delete(k);
  };
}

/**
 * Abort all controllers for a conversation that are running under (or at)
 * a specific scope. The scope match is by ancestor membership: a
 * controller registered with scopeNodeId === <child of scopeNodeId>
 * counts as "under" the scope and gets aborted.
 *
 * Caller provides a `descendantScopeIds` set listing every Ruler
 * scope the cancel applies to (precomputed by applyCancelSubtree's
 * primary+secondary walk). We abort any controller whose scopeNodeId
 * is in that set.
 *
 * Returns the count of controllers aborted (for logging).
 */
export function abortUnderScopes({ conversationKey, aiSessionKey, scopeNodeIds, reason }) {
  const key = conversationKey || aiSessionKey;
  if (!key || !Array.isArray(scopeNodeIds) || scopeNodeIds.length === 0) {
    return 0;
  }
  const k = String(key);
  const list = registry.get(k);
  if (!list || list.length === 0) return 0;

  const targetSet = new Set(scopeNodeIds.map(String));
  let aborted = 0;
  for (const entry of list) {
    if (entry.scopeNodeId && targetSet.has(entry.scopeNodeId)) {
      try {
        if (!entry.controller.signal.aborted) {
          entry.controller.abort(new Error(reason || "cancel-subtree"));
          aborted++;
        }
      } catch (err) {
        log.debug("AbortRegistry", `abort entry failed: ${err.message}`);
      }
    }
  }
  return aborted;
}

/**
 * Abort everything for a conversation — used by hard-cancel paths
 * (force-stop, session teardown). Cancel-subtree uses
 * abortUnderScopes; this is the bigger hammer.
 */
export function abortAllForConversation({ conversationKey, aiSessionKey, reason }) {
  const key = conversationKey || aiSessionKey;
  if (!key) return 0;
  const k = String(key);
  const list = registry.get(k);
  if (!list || list.length === 0) return 0;
  let aborted = 0;
  for (const entry of list) {
    try {
      if (!entry.controller.signal.aborted) {
        entry.controller.abort(new Error(reason || "abort-all"));
        aborted++;
      }
    } catch {}
  }
  registry.delete(k);
  return aborted;
}

// Back-compat alias for legacy callers that still use the visitor-naming.
export const abortAllForVisitor = abortAllForConversation;

/**
 * Inspect active controllers for a conversation. Diagnostic only.
 */
export function getActiveControllers(conversationKey) {
  if (!conversationKey) return [];
  const list = registry.get(String(conversationKey));
  if (!list) return [];
  return list.map((e) => ({
    scopeNodeId: e.scopeNodeId,
    branchName: e.branchName,
    aborted: e.controller.signal.aborted,
    ageMs: Date.now() - e.registeredAt,
  }));
}
