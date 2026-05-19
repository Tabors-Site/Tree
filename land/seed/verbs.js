// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// The four-verb dispatcher. core.see / core.do / core.summon / core.be.
//
// Phase 1: only `do` is implemented as a registry-backed dispatcher.
// see/summon/be land in their own phases. Until then, extensions
// continue to call the existing namespaces (core.tree.*, core.summon.*,
// core.auth.*). See [[project_seed_four_verbs_only]] memory for the
// commitment and migration plan.

import log from "./log.js";
import { getOperation, registerOperation, unregisterOperation, unregisterOperationsFromExtension, listOperations } from "./operations.js";
import { logDid } from "./tree/dids.js";

/**
 * DO verb. Looks up the registered operation, runs its handler, writes
 * a Did (unless the op opts out), returns the handler's result.
 *
 * @param {*} target - whatever the operation expects (node, being, artifact, id, stance, ...)
 *                     The dispatcher passes target through; the operation handler
 *                     interprets it. Convention: nodes/beings/artifacts can be
 *                     Mongoose docs, plain `{ _id }` objects, or id strings.
 * @param {string} operation - operation name ("create-child" or "food:log-meal")
 * @param {object} [params] - operation-specific payload
 * @param {object} [opts]
 * @param {object} [opts.identity] - { beingId, username } when called from a being context
 * @param {object} [opts.summonCtx] - summon context for correlation / audit attribution
 * @param {boolean} [opts.skipAudit] - skip Did write. Reserve for kernel-internal use.
 * @returns the handler's return value
 */
export async function doVerb(target, operation, params = {}, opts = {}) {
  if (typeof operation !== "string" || operation.length === 0) {
    throw new Error("core.do(target, operation, params): operation must be a non-empty string");
  }

  const op = getOperation(operation);
  if (!op) {
    throw new Error(`Unknown DO operation: "${operation}". Use core.do.listOperations() to see available operations.`);
  }

  // Phase 1 dispatcher is intentionally thin. Operations handle their own
  // target resolution and validation. Phase 2 adds an authorize() gate
  // and target-kind validation against op.targets here.
  const ctx = {
    target,
    params: params || {},
    identity: opts.identity || null,
    summonCtx: opts.summonCtx || null,
  };

  const result = await op.handler(ctx);

  // Auto-Did. Operations can opt out via spec.skipAudit. Callers can also
  // skip via opts.skipAudit (kernel-trusted batch operations).
  const shouldAudit = !op.skipAudit && !opts.skipAudit;
  if (shouldAudit) {
    try {
      const nodeId = resolveNodeIdForAudit(target, result);
      // logDid expects { nodeId, action, beingId, ...extensionData }.
      // The beforeDid hook can enrich extensionData; extensions listen
      // there if they want richer per-op audit fields.
      await logDid({
        nodeId,
        action:   op.didAction,
        beingId:  opts.identity?.beingId || null,
        summonId: opts.summonCtx?.summonId || null,
        // The operation name lands in `action`; extensions can add more
        // via beforeDid. Params/result intentionally NOT auto-serialized
        // (too much variance; opt-in via beforeDid).
      });
    } catch (err) {
      // Audit failure must not kill the operation. Log loudly so it does
      // not pass unnoticed.
      log.error("Verbs", `Did write failed for op "${operation}": ${err.message}`);
    }
  }

  return result;
}

/**
 * Attach registry methods to the doVerb function so callers can use
 * `core.do(target, op, params)` AND `core.do.registerOperation(...)`.
 */
doVerb.registerOperation = registerOperation;
doVerb.unregisterOperation = unregisterOperation;
doVerb.unregisterOperationsFromExtension = unregisterOperationsFromExtension;
doVerb.getOperation = getOperation;
doVerb.listOperations = listOperations;

// ────────────────────────────────────────────────────────────────────
// Phase 1 placeholders for the other three verbs. They throw so callers
// know not to depend on them yet, but the slots exist on `core` so
// future phases land additively.
// ────────────────────────────────────────────────────────────────────

export async function seeVerb(_target, _options = {}) {
  throw new Error("core.see not yet implemented. Phase 1 covers core.do only. Use existing read helpers for now.");
}

export async function summonVerb(_stance, _message, _opts = {}) {
  throw new Error("core.summon not yet implemented. Use core.ibp.wake() for now.");
}

export async function beVerb(_operation, _params = {}, _opts = {}) {
  throw new Error("core.be not yet implemented. Use core.auth.* helpers for now.");
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

/**
 * Best-effort nodeId resolution for the audit Did. Most DO operations
 * target a node; the dispatcher tries (in order):
 *   1. result._didNodeId      (operation handler hint)
 *   2. target._id              (Mongoose Node doc)
 *   3. target.nodeId           (envelope-like { nodeId, ... })
 *   4. target.id               (generic { id, ... })
 *   5. target as string        (raw id)
 *
 * When nothing is resolvable (e.g., being- or artifact-only operations
 * that have no node side), the Did is written without nodeId.
 */
function resolveNodeIdForAudit(target, result) {
  if (result && typeof result === "object" && result._didNodeId) {
    return String(result._didNodeId);
  }
  if (target && typeof target === "object") {
    if (target._id) return String(target._id);
    if (target.nodeId) return String(target.nodeId);
    if (target.id) return String(target.id);
  }
  if (typeof target === "string") return target;
  return null;
}
