// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// _targetShape.js — target-shape utilities used across material ops.
//
// Every DO operation's handler receives a `target` whose shape
// varies: the IBP wire arrives with a resolved stance object
// (carries `.chain`), in-process callers may pass a Mongoose doc,
// or a plain `{ _id }` envelope, or a raw string id. These two
// helpers cover all four shapes so each handler doesn't reimplement
// the detection. Used by materials/<kind>/ops.js.

/**
 * Detect what the target argument is. Returns one of:
 *   "stance"   — resolved stance from the IBP wire (carries `.chain`)
 *   "being"    — Mongoose Being doc
 *   "matter"   — Mongoose Matter doc
 *   "space"    — Mongoose Space doc OR anything else (default; covers
 *                plain `{ _id }` shapes and raw string ids that the
 *                space materials helpers already handle)
 *
 * Detection priority:
 *   1. `.chain` is an array → resolver output (every resolved stance
 *      carries a top-down chain, including `[]` for bare place root)
 *   2. Mongoose `.constructor.modelName` → model-typed doc
 *   3. Default → "space"
 */
export function detectTargetKind(target) {
  // A stance target has an actual chain of named segments (the @-walk
  // through `~name` or named children). An EMPTY chain doesn't make
  // something a stance — the place root and other position addresses
  // also flow through resolveStance and carry `chain: []` from the
  // base() helper. Check for at least one chain entry, or the
  // presence of the `being` (@-qualifier) field which is the other
  // unambiguous stance signal.
  if (
    target && typeof target === "object" &&
    ((Array.isArray(target.chain) && target.chain.length > 0) || target.being)
  ) {
    return "stance";
  }
  const modelName = target?.constructor?.modelName;
  if (modelName === "Being") return "being";
  if (modelName === "Matter") return "matter";
  return "space";
}

/**
 * Best-effort id extraction across the target shapes the dispatcher
 * accepts (Mongoose doc, plain `{_id}` shape, IBP wire `{spaceId}`
 * envelope, raw string id).
 */
export function targetIdOf(target) {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  if (target._id) return String(target._id);
  if (target.spaceId) return String(target.spaceId);
  if (target.id) return String(target.id);
  return null;
}
