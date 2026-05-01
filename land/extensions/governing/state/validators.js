// Declarative validator registry for governing.
//
// Pass 1's existing validators (smoke test, contract conformance, scout
// loop, chapter validation) register through the kernel hook system on
// names like "swarm:afterBranchComplete" and fire in registration order.
// That works while only one or two validators run per scope, but Pass 2's
// court system will introduce validators that MUST run in a specific
// order relative to court rulings — pre-court (gate), court (main), and
// post-court (after a ruling has been applied). Implicit registration
// order can't express that.
//
// This module owns the parallel, declarative registry that swarm fires
// alongside its kernel hooks. Validators registered here carry an
// explicit `phase` (pre | main | post) and `order` (numeric tiebreaker;
// lower = innermost = fires first within the phase). Callers sort by
// (phase, order) before invocation, so registration order doesn't affect
// semantics.
//
// Backward-compatible by design: extensions that don't register here
// continue to fire through their kernel hook subscriptions exactly as
// before. New validators (especially Pass 2's court system) opt into
// declarative ordering by calling registerValidator(...).
//
// Scope vocabulary (Pass 1):
//   "branch-complete"  - fires per branch after termination
//   "swarm-complete"   - fires once after all branches terminate
//   "court-ruling"     - Pass 2 placeholder; no firing site yet
//
// Phase semantics:
//   "pre"   - gate / preflight; runs before main validators in this scope
//   "main"  - the substantive validation (smoke, contracts, etc.)
//   "post"  - reactive cleanup; runs after main validators settle
//
// Validators may mutate the payload (e.g., flip `result.status` to
// "failed" on the branch-complete payload to force a retry); callers
// preserve that contract.

import log from "../../../seed/log.js";

const PHASE_ORDER = { pre: 0, main: 1, post: 2 };

// Single in-process registry. Keyed by scope so the firing path doesn't
// have to re-filter the entire list on every call.
const _registry = new Map(); // scope -> Array<{ ext, phase, order, fn }>

/**
 * Register a validator. Idempotent on (ext, scope, fn) — re-registering
 * the same function from the same extension at the same scope replaces
 * the prior entry rather than duplicating.
 *
 *   registerValidator({
 *     ext:   "code-workspace",
 *     scope: "branch-complete",
 *     phase: "main",            // pre | main | post (default "main")
 *     order: 0,                 // numeric, lower = fires first in phase
 *     fn:    async (payload) => { ... },
 *   });
 *
 * Throws on missing required fields. Returns nothing.
 */
export function registerValidator({ ext, scope, phase = "main", order = 0, fn } = {}) {
  if (!ext || typeof ext !== "string") {
    throw new Error("registerValidator: ext (string) is required");
  }
  if (!scope || typeof scope !== "string") {
    throw new Error("registerValidator: scope (string) is required");
  }
  if (typeof fn !== "function") {
    throw new Error("registerValidator: fn (function) is required");
  }
  if (!(phase in PHASE_ORDER)) {
    throw new Error(
      `registerValidator: phase "${phase}" not recognized; use "pre", "main", or "post"`,
    );
  }

  if (!_registry.has(scope)) _registry.set(scope, []);
  const list = _registry.get(scope);

  // Idempotent re-register: same (ext, fn) → replace in place to keep
  // hot-reload / repeated init() calls clean.
  const existing = list.findIndex((v) => v.ext === ext && v.fn === fn);
  const entry = { ext, phase, order: Number.isFinite(order) ? order : 0, fn };
  if (existing >= 0) {
    list[existing] = entry;
  } else {
    list.push(entry);
  }
}

/**
 * Remove all validators registered by a given extension. Called on
 * extension unload.
 */
export function unregisterValidatorsForExt(ext) {
  if (!ext) return;
  for (const [scope, list] of _registry.entries()) {
    _registry.set(scope, list.filter((v) => v.ext !== ext));
  }
}

/**
 * Fire all validators for a scope in declared order. Phase-major
 * (pre → main → post), order-minor (ascending within phase). Within a
 * single (phase, order) tier, ties resolve by registration order.
 *
 * Validators run sequentially (not parallel) because each may inspect
 * state mutated by the previous one. Errors are logged and skipped so
 * one broken validator doesn't block the rest.
 *
 * Returns nothing. Validators communicate by mutating `payload`.
 */
export async function runValidators(scope, payload) {
  const list = _registry.get(scope);
  if (!Array.isArray(list) || list.length === 0) return;

  // Stable sort by phase then order. Array.prototype.sort is stable in
  // modern Node, so ties preserve registration order.
  const sorted = [...list].sort((a, b) => {
    const pd = (PHASE_ORDER[a.phase] ?? 1) - (PHASE_ORDER[b.phase] ?? 1);
    if (pd !== 0) return pd;
    return (a.order || 0) - (b.order || 0);
  });

  for (const entry of sorted) {
    try {
      await entry.fn(payload);
    } catch (err) {
      log.warn(
        "GoverningValidators",
        `[${scope}] ${entry.ext} (phase=${entry.phase}, order=${entry.order}) ` +
        `threw: ${err.message}`,
      );
    }
  }
}

/**
 * Diagnostic: return the registered validators for a scope in firing
 * order. Useful for boot-time logging and admin pages.
 */
export function listValidators(scope) {
  const list = _registry.get(scope);
  if (!Array.isArray(list)) return [];
  return [...list]
    .sort((a, b) => {
      const pd = (PHASE_ORDER[a.phase] ?? 1) - (PHASE_ORDER[b.phase] ?? 1);
      if (pd !== 0) return pd;
      return (a.order || 0) - (b.order || 0);
    })
    .map((v) => ({ ext: v.ext, phase: v.phase, order: v.order }));
}
