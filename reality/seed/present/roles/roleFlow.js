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
//   caller.cognition     — the asker's effective cognition (llm/human/scripted)
//   caller.isSelf        — true when caller is the same being as me
//   caller.isAncestor    — true when caller is an ancestor of me on the being-tree
//   caller.isDescendant  — true when caller is a descendant of me on the being-tree
//   verb                 — "see" | "do" | "summon" | "be"
//   action               — DO action name (when verb=="do")
//   operation            — BE op name (when verb=="be")
//   intent               — classified intent if the envelope carried one
//   space.id             — the moment's space id
//   space.name           — the moment's space name
//   space.type           — the moment's space type
//   space.heavenSpace      — non-null when the moment opens at a heaven space
//   space.quality.<ns>.<k>  — read a quality on the moment's space row
//   coords.x / coords.y  — the being's current coord, if any
//   inHomeSpace          — true when space.id === me.homeSpace
//   me.beingId           — the being's _id
//   me.name              — the being's name
//   me.role              — the being's defaultRole (not the resolved active one)
//   me.previousRole      — the activeRole from this being's last sealed moment
//   me.cognition         — the being's effective cognition (inhabit-aware)
//   me.position          — the being's current position spaceId
//   me.homeSpace         — the being's home space id
//   me.quality.<ns>.<k>  — read a quality on the being row
//   time.hour            — moment-open hour (0–23, local server time)
//   time.dayOfWeek       — moment-open weekday (0=Sun … 6=Sat)
//   time.iso             — moment-open ISO timestamp
//   time.sinceLastMoment — seconds since this being's previous sealed moment (null on first)
//   world.<ns>.<key>     — read a world signal published on reality root
//                          (set-world-signal writes to reality-root.qualities.world.<ns>.<key>;
//                          coordination + environmental patterns ride on this surface)
//
// Operators (object-form):
//   { eq: x }            value === x
//   { ne: x }            value !== x
//   { in: [a, b, c] }    [a,b,c].includes(value)
//   { notIn: [...] }     !["a","b"].includes(value)
//   { gte: n }           value >= n
//   { lte: n }           value <= n
//   { gt: n } / { lt: n }
//   { present: true }    field has a non-null, non-undefined value
//   { present: false }   field is null or undefined
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
// ── Determinism ────────────────────────────────────────────────────
//
// The evaluator is a pure function of its inputs. No clock reads, no
// DB calls, no randomness. All time / lineage / qualities data is
// passed in via the call site (assign.js gathers it once per
// moment-open). Same chain replays to the same role.

import { getRole } from "./registry.js";
import { beingCognition } from "../../materials/being/identity/lookups.js";
import {
  getRoleSpecForGrant,
  roleReachesTarget as reachCovers,
} from "./spaceLookup.js";

const OPERATORS = new Set(["eq", "ne", "in", "notIn", "gt", "gte", "lt", "lte", "present"]);
const COMPOSITES = new Set(["and", "or", "not"]);

/**
 * Resolve the active role STACK for an opening moment.
 *
 * The stack is `[primary, ...modifiers]`:
 *   - PRIMARY — the first non-stacked clause whose `when` passes AND
 *     whose role's requiredCognition matches `me.cognition`. Determines
 *     what this being IS for this moment.
 *   - MODIFIERS — every stacked clause (`stack: true`) whose `when`
 *     passes AND whose requiredCognition matches. Stack on top of the
 *     primary; their prompts and capabilities union in.
 *
 * @param {object} args                          (see `resolveActiveRole` for field semantics)
 * @returns {string[]}                           role-name stack; empty when no primary resolves
 */
export function resolveActiveStack({
  toBeing,
  entry,
  handoff = null,
  space = null,
  callerEnrichment = null,
  previousMoment = null,
  now = null,
  worldSignals = null,
  availableRoles = null,
}) {
  if (!toBeing) return [];

  // `availableRoles` is the pre-computed Map<roleName, spec> of roles
  // the being HOLDS and that REACH the current position
  // (seed/RolesAreAuth.md). The caller (assign.js) computes this once
  // per moment-open via `computeAvailableRoles` so this evaluator
  // stays sync. When null → fall back to the registry (covers genesis
  // / boot paths before grants are folded). Each clause's role must
  // appear here or the clause is skipped — same shape as a failed
  // when-condition. No silent fallback to ungranted roles.
  // Role-spec lookup at moment-time. Priority:
  //   1. The being's granted roles (availableRoles map) — the explicit
  //      grant chain back to I-Am.
  //   2. Registry-resident SEED roles — seed delegates carry their
  //      delegate role as their defaultRole (cherub → "cherub",
  //      birther → "birther", etc.) without an explicit grant. The
  //      "grant" is structural: their being-as-seed-delegate IS the
  //      mandate. User-authored and extension roles still require
  //      explicit grants.
  //
  // Doctrinally: roles at moment-time (frame composition) ≠ roles at
  // authorize-time (the gate). The auth gate strictly walks
  // rolesGranted; this lookup is for which voice the being SPEAKS in,
  // and seed delegates speak in their delegate voice by default.
  const lookup = (roleName) => {
    if (availableRoles && availableRoles instanceof Map) {
      const fromGrants = availableRoles.get(roleName);
      if (fromGrants) return fromGrants;
    }
    const fromRegistry = getRole(roleName);
    if (!fromRegistry) return null;
    // Allow seed roles unconditionally; require grants for non-seed.
    if (fromRegistry.origin === "seed") return fromRegistry;
    if (!availableRoles || !(availableRoles instanceof Map)) return fromRegistry;
    return null;
  };

  const quals = toBeing.qualities;
  const roleFlow = Array.isArray(qGet(quals, "roleFlow")) ? qGet(quals, "roleFlow") : null;

  const ctx = buildCtx({
    toBeing,
    entry,
    handoff,
    space,
    callerEnrichment,
    previousMoment,
    now,
    worldSignals,
  });

  let primary = null;
  if (entry?.activeRole) {
    // Explicit activeRole on the entry — honor it ONLY if the being
    // can actually play it (held + reaching). Otherwise skip and let
    // the flow pick a real one.
    if (lookup(entry.activeRole)) primary = entry.activeRole;
  }

  if (!roleFlow || roleFlow.length === 0) {
    if (!primary) {
      const fallback = toBeing.defaultRole || null;
      if (fallback && lookup(fallback)) primary = fallback;
    }
    return primary ? [primary] : [];
  }

  const modifiers = [];
  for (const clause of roleFlow) {
    if (!clause || typeof clause !== "object") continue;
    const { when: whenClause, role: roleName, stack: isStacked } = clause;
    if (typeof roleName !== "string" || !roleName) continue;

    const conditionPasses = whenClause == null ? true : evalWhen(whenClause, ctx);
    if (!conditionPasses) continue;

    const role = lookup(roleName);
    if (!role) continue; // not held, doesn't reach, or unknown — skip
    if (role.requiredCognition && role.requiredCognition !== ctx.me.cognition) continue;

    if (isStacked) {
      if (!modifiers.includes(roleName)) modifiers.push(roleName);
    } else if (!primary) {
      primary = roleName;
    }
  }

  if (!primary) {
    const fallback = toBeing.defaultRole || null;
    if (fallback && lookup(fallback)) primary = fallback;
  }
  if (!primary) return modifiers; // pathological: only modifiers, no primary
  return [primary, ...modifiers];
}

/**
 * Pre-compute the set of roles a being can currently play.
 *
 * Walks toBeing.qualities.rolesGranted; for each grant looks up the
 * role spec at grant.anchorSpaceId (walking up qualities.roles[name])
 * and keeps it iff the spec's reach covers the being's current
 * position. The returned Map<roleName, spec> is what
 * resolveActiveStack consults for both grant-held AND reaches-here.
 *
 * Called once per moment-open from assign.js; the result is passed
 * into resolveActiveStack as `availableRoles`.
 *
 * @param {object} toBeing                — the being whose moment is opening
 * @param {string} positionSpaceId         — toBeing.position
 * @param {string} branch                  — the branch ("0" for main)
 * @returns {Promise<Map<string, object>>}  role-name → spec
 */
export async function computeAvailableRoles({ toBeing, positionSpaceId, branch }) {
  const out = new Map();
  if (!toBeing) return out;
  if (typeof branch !== "string" || !branch.length) {
    throw new Error("computeAvailableRoles requires `branch` (no silent default)");
  }

  const grants = readGrantsFromBeing(toBeing);
  if (grants.length === 0) return out;

  for (const grant of grants) {
    const { spec, hostSpaceId } = await getRoleSpecForGrant(grant, branch);
    if (!spec) continue;
    if (!await reachCovers(spec, hostSpaceId, { spaceId: positionSpaceId }, branch)) continue;
    if (!out.has(grant.role)) out.set(grant.role, spec);
  }
  return out;
}

function readGrantsFromBeing(toBeing) {
  const q = toBeing.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const arr = qualities?.rolesGranted;
  return Array.isArray(arr) ? arr : [];
}


// ────────────────────────────────────────────────────────────────────
// Context builder
// ────────────────────────────────────────────────────────────────────

function buildCtx({
  toBeing,
  entry,
  handoff,
  space,
  callerEnrichment,
  previousMoment,
  now,
  worldSignals,
}) {
  const quals = toBeing.qualities;
  const meHomeSpace = toBeing.homeSpace || null;
  const mePosition  = toBeing.position || null;
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
  const callerIsSelf = !!(callerBeingId && String(callerBeingId) === String(toBeing._id));

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
    heavenSpace: space?.heavenSpace || null,
    // Qualities map → plain object so dot-paths land.
    quality:   serializeQualitiesShallow(space?.qualities),
  };

  const inHomeSpace = !!(spaceId && meHomeSpace && spaceId === meHomeSpace);

  // Time anchors. The caller passes `now` (the moment's open
  // wall-clock); if absent we fall back to entry.receivedAt or null
  // (conditions on time.* then evaluate to undefined and short-circuit
  // false, leaving the clause to fall through).
  const nowDate = now instanceof Date
    ? now
    : (entry?.receivedAt ? new Date(entry.receivedAt) : null);
  const lastDate = previousMoment?.stampedAt
    ? new Date(previousMoment.stampedAt)
    : null;
  const timeCtx = nowDate
    ? Object.freeze({
        hour:             nowDate.getHours(),
        dayOfWeek:        nowDate.getDay(),
        iso:              nowDate.toISOString(),
        sinceLastMoment:  lastDate
          ? Math.max(0, Math.floor((nowDate.getTime() - lastDate.getTime()) / 1000))
          : null,
      })
    : Object.freeze({ hour: null, dayOfWeek: null, iso: null, sinceLastMoment: null });

  return Object.freeze({
    connectedFrom: callerBeingId,
    caller: Object.freeze({
      beingId:      callerBeingId,
      name:         callerName,
      role:         callerRole,
      cognition:    callerEnrichment?.cognition    ?? null,
      isSelf:       callerIsSelf,
      isAncestor:   callerEnrichment?.isAncestor   ?? false,
      isDescendant: callerEnrichment?.isDescendant ?? false,
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
      beingId:      String(toBeing._id),
      name:         toBeing.name || null,
      role:         toBeing.defaultRole || null,
      previousRole: previousMoment?.activeRole || null,
      cognition:    beingCognition(toBeing),
      position:     mePosition,
      homeSpace:    meHomeSpace,
      // me.quality.<ns>.<key> reads through a serialized snapshot.
      quality:      serializeQualitiesShallow(toBeing.qualities),
    }),
    time: timeCtx,
    // world.<namespace>.<key> reads from reality root's qualities.world
    // namespace, which set-world-signal writes to. Passed in by assign.js
    // (a single space-row lookup per moment-open).
    world: worldSignals && typeof worldSignals === "object"
      ? Object.freeze(worldSignals)
      : Object.freeze({}),
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
    case "eq":      return value === operand;
    case "ne":      return value !== operand;
    case "in":      return Array.isArray(operand) && operand.includes(value);
    case "notIn":   return Array.isArray(operand) && !operand.includes(value);
    case "gt":      return typeof value === "number" && typeof operand === "number" && value >  operand;
    case "gte":     return typeof value === "number" && typeof operand === "number" && value >= operand;
    case "lt":      return typeof value === "number" && typeof operand === "number" && value <  operand;
    case "lte":     return typeof value === "number" && typeof operand === "number" && value <= operand;
    case "present": {
      const exists = value !== null && value !== undefined;
      return operand === false ? !exists : exists;
    }
    default:        return false;
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

// Convert the qualities Map (or plain object) into a shallow plain
// object so dot-paths like `me.quality.ambient.tone` resolve through
// `readPath`. Internal — values are passed through by reference, not
// deep-copied, since the ctx is immediately frozen and read-only.
function serializeQualitiesShallow(quals) {
  if (!quals) return Object.freeze({});
  if (quals instanceof Map) {
    const out = {};
    for (const [k, v] of quals.entries()) out[k] = v;
    return Object.freeze(out);
  }
  if (typeof quals === "object") return Object.freeze({ ...quals });
  return Object.freeze({});
}

function parseQualifier(stance) {
  if (typeof stance !== "string") return null;
  const m = stance.match(/@([a-z][a-z0-9-]*)$/i);
  return m ? m[1] : null;
}
