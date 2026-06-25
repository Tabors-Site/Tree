// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// flow.js — pick a being's active able at moment-open.
//
// A being's `qualities.flow` is an ordered stack of conditional
// clauses; the first whose `when` matches AND whose `able` passes the
// requiredCognition guard wins. The chosen able's name flows into
// assign.activeAble; from there the rest of the moment treats it as
// the being's voice.
//
// ── Doctrine ────────────────────────────────────────────────────────
//
// The being is the identity. The able is the recipe for behavior at
// this moment. Flow is the per-being rule program that picks the
// able given the moment's open-context — who's calling, where we are,
// what they want. Same being, different ables per moment as conditions
// shift; no mutation, no internal state.
//
// Flow shape:
//
//   flow: [
//     { when: { connectedFrom: "<parent.beingId>" }, able: "human" },
//     { when: { and: [ { verb: "call" },
//                      { "caller.able": "human" } ] },
//       able: "human-conversationalist" },
//     { when: { and: [ { "space.name": "court" },
//                      { coords: { x: 12, y: 12 } } ] },
//       able: "judge" },
//     { able: "court-watcher" },   // terminal default (no when)
//   ]
//
// First match wins. A clause without a `when` always matches — use it
// as the terminal default. A clause whose able isn't registered, or
// whose able declares a requiredCognition the being doesn't have right
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
//   caller.able          — the asker's active able (the SUMMON envelope's)
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
//   me.able              — the being's defaultAble (not the resolved active one)
//   me.previousAble      — the activeAble from this being's last sealed moment
//   me.cognition         — the being's effective cognition (inhabit-aware)
//   me.position          — the being's current position spaceId
//   me.homeSpace         — the being's home space id
//   me.quality.<ns>.<k>  — read a quality on the being row
//   world.<ns>.<key>     — read a world signal published on story root
// NO time.* — a `when` tests order and content, never the clock (623/12: the fold, not a clock-read;
// a being that needs a wall-clock takes it as content via an `in`, never branches on it in a `when`).
//                          (set-world-signal writes to story-root.qualities.world.<ns>.<key>;
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
// moment-open). Same chain replays to the same able.

import { getAble } from "./registry.js";
import { beingCognition } from "../../materials/being/identity/lookups.js";
import {
  getAbleSpecForGrant,
  ableReachesTarget as reachCovers,
} from "./spaceLookup.js";

const OPERATORS = new Set(["eq", "ne", "in", "notIn", "gt", "gte", "lt", "lte", "present"]);
const COMPOSITES = new Set(["and", "or", "not"]);

/**
 * Resolve the active able STACK for an opening moment.
 *
 * The stack is `[primary, ...modifiers]`:
 *   - PRIMARY — the first non-stacked clause whose `when` passes AND
 *     whose able's requiredCognition matches `me.cognition`. Determines
 *     what this being IS for this moment.
 *   - MODIFIERS — every stacked clause (`stack: true`) whose `when`
 *     passes AND whose requiredCognition matches. Stack on top of the
 *     primary; their prompts and capabilities union in.
 *
 * @param {object} args                          (see `resolveActiveAble` for field semantics)
 * @returns {string[]}                           able-name stack; empty when no primary resolves
 */
export function resolveActiveStack({
  toBeing,
  entry,
  handoff = null,
  space = null,
  callerEnrichment = null,
  previousMoment = null,
  worldSignals = null,
  availableAbles = null,
}) {
  if (!toBeing) return [];

  // `availableAbles` is the pre-computed Map<ableName, spec> of ables
  // the being HOLDS and that REACH the current position
  // (seed/AblesAreAuth.md). The caller (assign.js) computes this once
  // per moment-open via `computeAvailableAbles` so this evaluator
  // stays sync. When null → fall back to the registry (covers genesis
  // / boot paths before grants are folded). Each clause's able must
  // appear here or the clause is skipped — same shape as a failed
  // when-condition. No silent fallback to ungranted ables.
  // Able-spec lookup at moment-time. Priority:
  //   1. The being's granted ables (availableAbles map) — the explicit
  //      grant chain back to I-Am.
  //   2. Registry-resident SEED ables — seed delegates carry their
  //      delegate able as their defaultAble (cherub → "cherub",
  //      birther → "birther", etc.) without an explicit grant. The
  //      "grant" is structural: their being-as-seed-delegate IS the
  //      mandate. User-authored and extension ables still require
  //      explicit grants.
  //
  // Doctrinally: ables at moment-time (frame composition) ≠ ables at
  // authorize-time (the gate). The auth gate strictly walks
  // ablesGranted; this lookup is for which voice the being SPEAKS in,
  // and seed delegates speak in their delegate voice by default.
  const lookup = (ableName) => {
    if (availableAbles && availableAbles instanceof Map) {
      const fromGrants = availableAbles.get(ableName);
      if (fromGrants) return fromGrants;
    }
    const fromRegistry = getAble(ableName);
    if (!fromRegistry) return null;
    // Allow seed ables unconditionally; require grants for non-seed.
    if (fromRegistry.origin === "seed") return fromRegistry;
    if (!availableAbles || !(availableAbles instanceof Map)) return fromRegistry;
    return null;
  };

  const quals = toBeing.qualities;
  const flow = Array.isArray(qGet(quals, "flow")) ? qGet(quals, "flow") : null;

  const ctx = buildCtx({
    toBeing,
    entry,
    handoff,
    space,
    callerEnrichment,
    previousMoment,
    worldSignals,
  });

  let primary = null;
  if (entry?.activeAble) {
    // Explicit activeAble on the entry — honor it ONLY if the being
    // can actually play it (held + reaching). Otherwise skip and let
    // the flow pick a real one.
    if (lookup(entry.activeAble)) primary = entry.activeAble;
  }

  if (!flow || flow.length === 0) {
    if (!primary) {
      const fallback = toBeing.defaultAble || null;
      if (fallback && lookup(fallback)) primary = fallback;
    }
    return primary ? [primary] : [];
  }

  const modifiers = [];
  for (const clause of flow) {
    if (!clause || typeof clause !== "object") continue;
    const { when: whenClause, able: ableName, stack: isStacked } = clause;
    if (typeof ableName !== "string" || !ableName) continue;

    const conditionPasses = whenClause == null ? true : evalWhen(whenClause, ctx);
    if (!conditionPasses) continue;

    const able = lookup(ableName);
    if (!able) continue; // not held, doesn't reach, or unknown — skip
    if (able.requiredCognition && able.requiredCognition !== ctx.me.cognition) continue;

    if (isStacked) {
      if (!modifiers.includes(ableName)) modifiers.push(ableName);
    } else if (!primary) {
      primary = ableName;
    }
  }

  if (!primary) {
    const fallback = toBeing.defaultAble || null;
    if (fallback && lookup(fallback)) primary = fallback;
  }
  if (!primary) return modifiers; // pathological: only modifiers, no primary
  return [primary, ...modifiers];
}

/**
 * Pre-compute the set of ables a being can currently play.
 *
 * Walks toBeing.qualities.ablesGranted; for each grant looks up the
 * able spec at grant.anchorSpaceId (walking up qualities.ables[name])
 * and keeps it iff the spec's reach covers the being's current
 * position. The returned Map<ableName, spec> is what
 * resolveActiveStack consults for both grant-held AND reaches-here.
 *
 * Called once per moment-open from assign.js; the result is passed
 * into resolveActiveStack as `availableAbles`.
 *
 * @param {object} toBeing                — the being whose moment is opening
 * @param {string} positionSpaceId         — toBeing.position
 * @param {string} history                 — the history ("0" for main)
 * @returns {Promise<Map<string, object>>}  able-name → spec
 */
export async function computeAvailableAbles({ toBeing, positionSpaceId, history }) {
  const out = new Map();
  if (!toBeing) return out;
  if (typeof history !== "string" || !history.length) {
    throw new Error("computeAvailableAbles requires `history` (no silent default)");
  }

  const grants = readGrantsFromBeing(toBeing);
  if (grants.length === 0) return out;

  for (const grant of grants) {
    const { spec, hostSpaceId } = await getAbleSpecForGrant(grant, history);
    if (!spec) continue;
    if (!await reachCovers(spec, hostSpaceId, { spaceId: positionSpaceId }, history)) continue;
    if (!out.has(grant.able)) out.set(grant.able, spec);
  }
  return out;
}

function readGrantsFromBeing(toBeing) {
  const q = toBeing.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const arr = qualities?.ablesGranted;
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
  worldSignals,
}) {
  const quals = toBeing.qualities;
  const meHomeSpace = toBeing.homeSpace || null;
  const mePosition  = toBeing.position || null;
  const meCoord     = qGet(quals, "coord") || toBeing.coord || null;

  // SUMMON envelope shape carries `activeAble` and `from` (a stance
  // string). handoff carries the typed asker identity (beingId/name).
  // For transport-act, asker IS the being themselves.
  const isTransport = entry?.kind === "transport-act";
  const callerBeingId = isTransport
    ? String(toBeing._id)
    : (handoff?.identity?.beingId || null);
  const callerName = isTransport
    ? toBeing.name
    : (handoff?.identity?.name || parseQualifier(entry?.from) || null);
  const callerAble = entry?.activeAble || null;
  const callerIsSelf = !!(callerBeingId && String(callerBeingId) === String(toBeing._id));

  // verb / action / operation hints — only present when the envelope
  // routes through DO or BE (transport-act). For SUMMON, verb="summon"
  // and the content is the message.
  let verb = "call";
  let action = null;
  let operation = null;
  if (isTransport) {
    const act = entry?.act || null;
    if (act?.verb === "do") {
      verb = "do";
      action = act.act || null;
    } else if (act?.verb === "be") {
      verb = "be";
      operation = act.act || null;
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

  // NO time anchors. A `when` tests order + content, never the clock (623/12; 20.md: the fold of
  // facts, not a variable mutating over steps). The wall-clock was a logical dependency that broke
  // replay; it is gone from the moment ctx so no flow can branch on it.

  return Object.freeze({
    connectedFrom: callerBeingId,
    caller: Object.freeze({
      beingId:      callerBeingId,
      name:         callerName,
      able:         callerAble,
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
      able:         toBeing.defaultAble || null,
      previousAble: previousMoment?.activeAble || null,
      cognition:    beingCognition(toBeing),
      position:     mePosition,
      homeSpace:    meHomeSpace,
      // me.quality.<ns>.<key> reads through a serialized snapshot.
      quality:      serializeQualitiesShallow(toBeing.qualities),
    }),
    // world.<namespace>.<key> reads from story root's qualities.world
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
