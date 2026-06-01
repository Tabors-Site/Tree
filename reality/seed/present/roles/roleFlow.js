// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// roleFlow.js — pick a being's active role at moment-open.
//
// A being's `qualities.roleFlow` is an ordered stack of conditional
// clauses; the first whose `when` matches AND whose `role` passes the
// requiredCognition guard wins. The chosen role's name flows into
// assign.activeRole; from there the rest of the moment treats it as
// the being's voice.
//
// ── Doctrine ────────────────────────────────────────────────────────
//
// The being is the identity. The role is the recipe for behavior at
// this moment. RoleFlow is the per-being rule program that picks the
// role given the moment's open-context — who's calling, where we are,
// what they want. Same being, different roles per moment as conditions
// shift; no mutation, no internal state.
//
// Flow shape:
//
//   roleFlow: [
//     { when: { connectedFrom: "<parent.beingId>" }, role: "human" },
//     { when: { and: [ { verb: "summon" },
//                      { "caller.role": "human" } ] },
//       role: "human-conversationalist" },
//     { when: { and: [ { "space.name": "court" },
//                      { coords: { x: 12, y: 12 } } ] },
//       role: "judge" },
//     { role: "court-watcher" },   // terminal default (no when)
//   ]
//
// First match wins. A clause without a `when` always matches — use it
// as the terminal default. A clause whose role isn't registered, or
// whose role declares a requiredCognition the being doesn't have right
// now, is skipped and evaluation continues with the next clause.
//
// ── Condition vocabulary ────────────────────────────────────────────
//
// The flow evaluator builds a read-only `ctx` from the moment's
// open-context. Conditions reference dot-paths into ctx:
//
//   connectedFrom        — the asker's beingId (null for self / transport-act)
//   caller.beingId       — same as connectedFrom but explicit
//   caller.name          — the asker's @name
//   caller.role          — the asker's active role (the SUMMON envelope's)
//   verb                 — "see" | "do" | "summon" | "be"
//   action               — DO action name (when verb=="do")
//   operation            — BE op name (when verb=="be")
//   intent               — classified intent if the envelope carried one
//   space.id             — the moment's space id
//   space.name           — the moment's space name
//   space.type           — the moment's space type
//   space.seedSpace      — non-null when the moment opens at a seed space
//   coords.x / coords.y  — the being's current coord, if any
//   inHomeSpace          — true when space.id === me.homeSpace
//   me.beingId           — the being's _id
//   me.name              — the being's name
//   me.role              — the being's defaultRole (not the resolved active one)
//   me.cognition         — the being's effective cognition (inhabit-aware)
//   me.position          — the being's current position spaceId
//   me.homeSpace         — the being's home space id
//
// Operators (object-form):
//   { eq: x }            value === x
//   { ne: x }            value !== x
//   { in: [a, b, c] }    [a,b,c].includes(value)
//   { notIn: [...] }     !["a","b"].includes(value)
//   { gte: n }           value >= n
//   { lte: n }           value <= n
//   { gt: n } / { lt: n }
//
// Composition (at the outer when level OR nested):
//   { and: [c1, c2, ...] }   every clause matches
//   { or:  [c1, c2, ...] }   at least one matches
//   { not: c }               clause does NOT match
//
// Bare values are equality shortcuts: `{ verb: "do" }` is
// `{ verb: { eq: "do" } }`. Object values that aren't operators
// recurse — `{ coords: { x: 12, y: 12 } }` reads as "x==12 AND y==12"
// inside ctx.coords. Top-level keys in a `when` are also implicit AND,
// so you almost never need to write `and: [...]` by hand:
//
//   // these three are equivalent
//   { when: { and: [ { "coords.x": 12 }, { "coords.y": 12 } ] } }
//   { when: { "coords.x": 12, "coords.y": 12 } }
//   { when: { coords: { x: 12, y: 12 } } }   // ← cleanest
//
// Reach for `and:` only when you want grouped negation (`not: { and:
// [...] }`) or when composing with `or:`.
//
// ── Hooks ──────────────────────────────────────────────────────────
//
// The evaluator runs in `seed/present/beats/1-assign.js` after the
// entry/defaultRole resolution, BEFORE the role-registry lookup.
// When no flow is set on the being, the legacy `entry.activeRole ||
// toBeing.defaultRole` selection runs unchanged.
//
// Future Step 2.1: cache the flow per (beingId, foldedSeq) so re-
// reading qualities on every moment-open isn't a fresh deserialize.
// Not in this slice; flows are small.

import { getRole } from "./registry.js";
import { beingCognition } from "../../materials/being/identity/lookups.js";

const OPERATORS = new Set(["eq", "ne", "in", "notIn", "gt", "gte", "lt", "lte"]);
const COMPOSITES = new Set(["and", "or", "not"]);

/**
 * Resolve the active role for an opening moment.
 *
 * @param {object} args
 * @param {object} args.toBeing        the recipient being (lean row); must include qualities + roles
 * @param {object} args.entry          the inbox entry (kind, activeRole, content, from, ...)
 * @param {object} [args.handoff]      summon handoff (carries asker identity for kind="summon")
 * @param {object} [args.space]        the moment's space row (lean) — for space.name / type / seedSpace
 * @returns {string|null}              role name, or null when no clause applies and no fallback hits
 */
export function resolveActiveRole({ toBeing, entry, handoff = null, space = null }) {
  if (!toBeing) return null;

  // Highest priority: an explicit activeRole on the entry. The caller
  // specifically requested this voice (e.g. `summon @being:role-name`);
  // honor it without running the flow. The carried-roles validation
  // happens later in assign.js; here we just return the requested name.
  if (entry?.activeRole) return entry.activeRole;

  // No flow declared → legacy: defaultRole wins. Returns null when the
  // being has no defaultRole either; assign.js then logs and skips.
  const quals = toBeing.qualities;
  const roleFlow = qGet(quals, "roleFlow");
  if (!Array.isArray(roleFlow) || roleFlow.length === 0) {
    return toBeing.defaultRole || null;
  }

  // Build the evaluation context. All paths the flow can reference
  // resolve through this single object — defensive about every field
  // being optional.
  const ctx = buildCtx({ toBeing, entry, handoff, space });

  for (const clause of roleFlow) {
    if (!clause || typeof clause !== "object") continue;
    const { when: whenClause, role: roleName } = clause;
    if (typeof roleName !== "string" || !roleName) continue;

    // No `when` → unconditional clause (terminal default).
    const conditionPasses = whenClause == null ? true : evalWhen(whenClause, ctx);
    if (!conditionPasses) continue;

    // requiredCognition guard. Unregistered roles or role/cognition
    // mismatches fall through to the next clause rather than failing
    // the whole moment.
    const role = getRole(roleName);
    if (!role) continue;
    if (role.requiredCognition && role.requiredCognition !== ctx.me.cognition) {
      continue;
    }
    return roleName;
  }

  // Flow exhausted with no match: fall back to defaultRole. Common case
  // is a flow that handles specific situations but expects defaultRole
  // for everything else; this makes the terminal default optional.
  return toBeing.defaultRole || null;
}

// ────────────────────────────────────────────────────────────────────
// Context builder
// ────────────────────────────────────────────────────────────────────

function buildCtx({ toBeing, entry, handoff, space }) {
  const quals = toBeing.qualities;
  const meHomeSpace = toBeing.homeSpace ? String(toBeing.homeSpace) : null;
  const mePosition  = toBeing.position  ? String(toBeing.position)  : null;
  const meCoord     = qGet(quals, "coord") || toBeing.coord || null;

  // SUMMON envelope shape carries `activeRole` and `from` (a stance
  // string). handoff carries the typed asker identity (beingId/name).
  // For transport-act, asker IS the being themselves.
  const isTransport = entry?.kind === "transport-act";
  const callerBeingId = isTransport
    ? String(toBeing._id)
    : (handoff?.identity?.beingId || null);
  const callerName = isTransport
    ? toBeing.name
    : (handoff?.identity?.name || parseQualifier(entry?.from) || null);
  const callerRole = entry?.activeRole || null;

  // verb / action / operation hints — only present when the envelope
  // routes through DO or BE (transport-act). For SUMMON, verb="summon"
  // and the content is the message.
  let verb = "summon";
  let action = null;
  let operation = null;
  if (isTransport) {
    const act = entry?.act || null;
    if (act?.verb === "do") {
      verb = "do";
      action = act.action || null;
    } else if (act?.verb === "be") {
      verb = "be";
      operation = act.target || null;
    }
  }

  // The space the moment opens at. Caller may pass a lean row; if not,
  // we still expose id from spaceId via entry/handoff (best-effort).
  const spaceId = space?._id ? String(space._id) : null;
  const spaceCtx = {
    id:        spaceId,
    name:      space?.name      || null,
    type:      space?.type      || null,
    seedSpace: space?.seedSpace || null,
  };

  const inHomeSpace = !!(spaceId && meHomeSpace && spaceId === meHomeSpace);

  return Object.freeze({
    connectedFrom: callerBeingId,
    caller: Object.freeze({
      beingId: callerBeingId,
      name:    callerName,
      role:    callerRole,
    }),
    verb,
    action,
    operation,
    intent: entry?.content?.intent || null,
    space: Object.freeze(spaceCtx),
    coords: meCoord && typeof meCoord === "object"
      ? Object.freeze({ x: meCoord.x ?? null, y: meCoord.y ?? null, z: meCoord.z ?? null })
      : Object.freeze({ x: null, y: null, z: null }),
    inHomeSpace,
    me: Object.freeze({
      beingId:   String(toBeing._id),
      name:      toBeing.name || null,
      role:      toBeing.defaultRole || null,
      cognition: beingCognition(toBeing),
      position:  mePosition,
      homeSpace: meHomeSpace,
    }),
  });
}

// ────────────────────────────────────────────────────────────────────
// Expression evaluator
// ────────────────────────────────────────────────────────────────────

/**
 * Evaluate a `when` expression against ctx. Returns boolean.
 * Defensive: malformed clauses evaluate to false (clause is skipped).
 */
export function evalWhen(expr, ctx) {
  if (expr == null) return true;
  if (typeof expr !== "object" || Array.isArray(expr)) return false;

  // Composites first — and/or/not.
  if (Object.prototype.hasOwnProperty.call(expr, "and")) {
    const arr = expr.and;
    if (!Array.isArray(arr)) return false;
    return arr.every((c) => evalWhen(c, ctx));
  }
  if (Object.prototype.hasOwnProperty.call(expr, "or")) {
    const arr = expr.or;
    if (!Array.isArray(arr)) return false;
    return arr.some((c) => evalWhen(c, ctx));
  }
  if (Object.prototype.hasOwnProperty.call(expr, "not")) {
    return !evalWhen(expr.not, ctx);
  }

  // Otherwise treat as a field-constraint map. Each key is a dot-path
  // into ctx; each value is either a constant (equality), an operator
  // object, or a nested object (recursive equality on sub-fields).
  const keys = Object.keys(expr);
  if (keys.length === 0) return true; // empty when matches
  for (const key of keys) {
    if (!evalField(key, expr[key], ctx)) return false;
  }
  return true;
}

function evalField(path, constraint, ctx) {
  const value = readPath(ctx, path);

  // Constant equality shortcut: { field: 7 } or { field: "x" } or null.
  if (
    constraint === null ||
    typeof constraint === "string" ||
    typeof constraint === "number" ||
    typeof constraint === "boolean"
  ) {
    return value === constraint;
  }

  if (Array.isArray(constraint)) {
    // [a, b, c] shorthand for { in: [a, b, c] }.
    return constraint.includes(value);
  }

  if (typeof constraint !== "object") return false;

  // Operator object? `{ eq: ... }`, `{ in: [...] }`, etc.
  const constraintKeys = Object.keys(constraint);
  const hasOperator = constraintKeys.some((k) => OPERATORS.has(k));
  if (hasOperator) {
    for (const op of constraintKeys) {
      if (!applyOperator(op, value, constraint[op])) return false;
    }
    return true;
  }

  // Otherwise: recursive equality on sub-fields. `{ coords: { x: 12 } }`
  // becomes "ctx.coords.x === 12". Builds the sub-context by stepping
  // into the parent path and recursing.
  if (value == null || typeof value !== "object") return false;
  for (const subKey of constraintKeys) {
    const subValue = constraint[subKey];
    if (!evalField(subKey, subValue, value)) return false;
  }
  return true;
}

function applyOperator(op, value, operand) {
  switch (op) {
    case "eq":    return value === operand;
    case "ne":    return value !== operand;
    case "in":    return Array.isArray(operand) && operand.includes(value);
    case "notIn": return Array.isArray(operand) && !operand.includes(value);
    case "gt":    return typeof value === "number" && typeof operand === "number" && value >  operand;
    case "gte":   return typeof value === "number" && typeof operand === "number" && value >= operand;
    case "lt":    return typeof value === "number" && typeof operand === "number" && value <  operand;
    case "lte":   return typeof value === "number" && typeof operand === "number" && value <= operand;
    default:      return false;
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

// Dot-path read. Returns undefined when any segment misses.
function readPath(obj, path) {
  if (!obj || typeof obj !== "object") return undefined;
  if (!path || typeof path !== "string") return undefined;
  const parts = path.split(".");
  let cursor = obj;
  for (const p of parts) {
    if (cursor == null) return undefined;
    cursor = cursor[p];
  }
  return cursor;
}

function qGet(quals, ns) {
  if (!quals) return null;
  if (quals instanceof Map) return quals.get(ns) || null;
  return quals[ns] || null;
}

function parseQualifier(stance) {
  if (typeof stance !== "string") return null;
  const m = stance.match(/@([a-z][a-z0-9-]*)$/i);
  return m ? m[1] : null;
}
