// Per-visitor AbortController registry.
//
// Today's swarm.js creates a `branchAbort` controller inside a per-
// branch closure (swarm.js:1044) that bridges parent signal → child
// signal. The closure publishes nothing; cancel-subtree (in ruling.js)
// can write a metadata marker but can't reach in-flight LLM calls
// directly because the controller isn't accessible.
//
// This registry exposes active controllers so cancel-subtree can
// abort them. Each branch's runBranch closure registers its
// controller on entry and removes it on exit. cancel-subtree's
// dispatch case looks up active controllers under the cancelling
// scope and aborts them — propagation to nested children rides on
// the existing parent → child signal bridging.
//
// PER-VISITOR-SYNCHRONOUS ASSUMPTION:
// Today, one visitor has at most one active turn at a time. Within
// that turn, swarm dispatches branches sequentially (one runBranch
// resolves before the next begins). Nested sub-Rulers run inside
// the same call stack — the controllers are nested in time, not
// concurrent. So a per-visitor flat list of controllers is correct
// AS LONG AS this assumption holds.
//
// When concurrent turns become a real use case (Pass 2 court
// hearings? parallel sub-Rulers?), the registry should re-key by
// execution-record-node-id instead of visitorId. Queued for that
// refactor; today's keying is sufficient.
//
// Race shape: registration happens BEFORE the LLM call begins
// (synchronous setup); deregistration happens in the branch's
// finally-block (synchronous teardown). cancel-subtree's abort runs
// during the LLM call. No race between register and abort because
// the LLM call dwarfs both setup and teardown.

import log from "../../seed/log.js";

// visitorId → array of { controller, scopeNodeId, branchName }.
// The array models the call-stack: outer branches earlier, inner
// branches later. Aborting an outer scope must abort everything below
// (call-stack discipline); we walk the list from the matching scope
// onward and abort each.
const registry = new Map();

/**
 * Register an AbortController against a visitor + scope. Returns a
 * deregistration function the caller stores in its finally-block.
 *
 * scopeNodeId is the Ruler scope this branch is running under (or
 * the project root if it's a top-level dispatch). Used by
 * abortUnderScope to know which controllers should fire when a
 * cancel-subtree is issued at a higher scope.
 */
export function registerController({ visitorId, scopeNodeId, branchName, controller }) {
  if (!visitorId || !controller) return () => {};
  const key = String(visitorId);
  const list = registry.get(key) || [];
  const entry = {
    controller,
    scopeNodeId: scopeNodeId ? String(scopeNodeId) : null,
    branchName: branchName ? String(branchName) : null,
    registeredAt: Date.now(),
  };
  list.push(entry);
  registry.set(key, list);
  return function deregister() {
    const cur = registry.get(key);
    if (!cur) return;
    const idx = cur.indexOf(entry);
    if (idx >= 0) cur.splice(idx, 1);
    if (cur.length === 0) registry.delete(key);
  };
}

/**
 * Abort all controllers for a visitor that are running under (or at)
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
export function abortUnderScopes({ visitorId, scopeNodeIds, reason }) {
  if (!visitorId || !Array.isArray(scopeNodeIds) || scopeNodeIds.length === 0) {
    return 0;
  }
  const key = String(visitorId);
  const list = registry.get(key);
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
 * Abort everything for a visitor — used by hard-cancel paths (e.g.
 * session disconnect, force-stop). Cancel-subtree uses
 * abortUnderScopes; this is the bigger hammer.
 */
export function abortAllForVisitor({ visitorId, reason }) {
  if (!visitorId) return 0;
  const key = String(visitorId);
  const list = registry.get(key);
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
  registry.delete(key);
  return aborted;
}

/**
 * Inspect active controllers for a visitor. Diagnostic only.
 */
export function getActiveControllers(visitorId) {
  if (!visitorId) return [];
  const list = registry.get(String(visitorId));
  if (!list) return [];
  return list.map((e) => ({
    scopeNodeId: e.scopeNodeId,
    branchName: e.branchName,
    aborted: e.controller.signal.aborted,
    ageMs: Date.now() - e.registeredAt,
  }));
}
