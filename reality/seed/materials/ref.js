// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Refs — TreeOS's typed identity primitive.
//
// Anywhere the substrate carries an aggregate ID, the value is a
// tagged Ref, not a bare string. Cross-substrate operations
// (replicate, graft, future mirror, future deep-clone) detect refs
// by structure and remap them automatically.
//
// See seed/REFS.md for the full doctrine and public API.
//
// Shape:
//   { __ref: "being",  id: "abc-123" }
//   { __ref: "space",  id: "def-456" }
//   { __ref: "matter", id: "789-ghi" }
//   { __ref: "graft-initiator" }   ← sentinel; resolved at graft time
//   { __ref: "insertion-point" }   ← sentinel; resolved at graft time

// Aggregate kinds . the three substrate primitives the substrate
// will remap during a graft. Closed set; refusing other kinds at
// construction keeps Ref from drifting into a generic "I'm an ID
// of something" wrapper.
const AGGREGATE_KINDS = new Set(["being", "space", "matter"]);

// Sentinel kinds . values that mean "the graft layer should resolve
// this at apply time, not via the remap table." Closed set.
const SENTINEL_KINDS = new Set(["graft-initiator", "insertion-point"]);

const ALL_KINDS = new Set([...AGGREGATE_KINDS, ...SENTINEL_KINDS]);

// ─────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────

/**
 * Construct a Ref. For aggregate kinds (being/space/matter) the id
 * is required and must be a non-empty string. For sentinel kinds
 * (graft-initiator/insertion-point) the id is forbidden — they're
 * resolved from graft context.
 *
 * Returns a frozen plain object that survives JSON/BSON round-trips.
 * The shape is { __ref: kind, id } for aggregate refs and
 * { __ref: kind } for sentinels.
 *
 * @param {string} kind
 * @param {string} [id] required for aggregate kinds; omitted for sentinels
 */
export function ref(kind, id) {
  if (typeof kind !== "string" || !ALL_KINDS.has(kind)) {
    throw new Error(
      `ref: invalid kind "${kind}" (must be one of ${[...ALL_KINDS].join(", ")})`,
    );
  }
  if (AGGREGATE_KINDS.has(kind)) {
    if (typeof id !== "string" || !id.length) {
      throw new Error(`ref: id must be a non-empty string for aggregate kind "${kind}"`);
    }
    return Object.freeze({ __ref: kind, id });
  }
  // Sentinel
  if (id !== undefined) {
    throw new Error(`ref: sentinel kind "${kind}" must not carry an id`);
  }
  return Object.freeze({ __ref: kind });
}

// Pre-frozen sentinels so callers don't allocate on every use.
export const REF_GRAFT_INITIATOR = ref("graft-initiator");
export const REF_INSERTION_POINT = ref("insertion-point");

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/**
 * True for any Ref shape (aggregate or sentinel). Use this as the
 * broad "is this a substrate reference" check . the walker calls it
 * to decide whether to descend or treat as a leaf.
 */
export function isRef(v) {
  return (
    v != null &&
    typeof v === "object" &&
    typeof v.__ref === "string" &&
    ALL_KINDS.has(v.__ref) &&
    // aggregate kinds must have a non-empty id; sentinels must NOT have one
    (AGGREGATE_KINDS.has(v.__ref)
      ? typeof v.id === "string" && v.id.length > 0
      : v.id === undefined)
  );
}

/**
 * True for an aggregate-kind Ref (being/space/matter) — one that
 * carries an id the remap table substitutes. Excludes sentinels.
 */
export function isAggregateRef(v) {
  return isRef(v) && AGGREGATE_KINDS.has(v.__ref);
}

/**
 * True for a sentinel-kind Ref (graft-initiator / insertion-point) —
 * one that the graft layer resolves from operation context, not from
 * the remap table.
 */
export function isSentinelRef(v) {
  return isRef(v) && SENTINEL_KINDS.has(v.__ref);
}

// ─────────────────────────────────────────────────────────────────────
// Accessors
// ─────────────────────────────────────────────────────────────────────

/**
 * The kind of a Ref (one of the five valid kinds) or null when the
 * input isn't a Ref. Use this to dispatch on what the Ref points at.
 */
export function refKind(v) {
  return isRef(v) ? v.__ref : null;
}

/**
 * The aggregate id of a Ref, or null when the input is a sentinel or
 * not a Ref. Use this to look up the local id in a remap table.
 */
export function refId(v) {
  return isAggregateRef(v) ? v.id : null;
}

// ─────────────────────────────────────────────────────────────────────
// Coercion (boundary helper for legacy callers)
// ─────────────────────────────────────────────────────────────────────

/**
 * Accept either a Ref or a bare string and return a Ref. The kindHint
 * names what kind a bare string should be coerced to.
 *
 * Use at substrate boundaries that may receive legacy bare-string IDs
 * (HTTP/WS payloads from old clients, qualities namespaces not yet
 * migrated, etc.). When the input is already a Ref, the kindHint is
 * verified to match — a mismatch throws loud rather than silently
 * coercing a being-ref to a space-kind context.
 *
 * Returns null when given null/undefined (passes through; lets callers
 * distinguish "absent ref" from "present ref").
 *
 * @param {string | object | null | undefined} value
 * @param {string} kindHint  one of the aggregate kinds
 */
export function coerceRef(value, kindHint) {
  if (value == null) return null;
  if (typeof value === "string") {
    if (!value.length) return null;
    return ref(kindHint, value);
  }
  if (isRef(value)) {
    if (isAggregateRef(value) && value.__ref !== kindHint) {
      throw new Error(
        `coerceRef: kind mismatch . expected "${kindHint}", got "${value.__ref}"`,
      );
    }
    return value;
  }
  throw new Error(
    `coerceRef: value must be a Ref or a bare string id (got ${typeof value})`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Introspection (for the .refs SEE catalog and debug tooling)
// ─────────────────────────────────────────────────────────────────────

export function listAggregateKinds() {
  return [...AGGREGATE_KINDS];
}

export function listSentinelKinds() {
  return [...SENTINEL_KINDS];
}
