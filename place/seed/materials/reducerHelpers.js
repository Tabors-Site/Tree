// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Shared reducer helpers. Logic the three material reducers
// (being / space / matter) all need.
//
// Today: applying `do:set` facts to derive qualities state. The
// `set` op's params shape is `{ field, value, merge=true }`. When
// `field` starts with "qualities." the reducer needs to produce the
// new qualities object from the fact alone (no Mongo round-trip).
//
// Pure functions. Same (state, fact) → same state every time. No
// I/O. Concurrent calls compute identical results.

const QUALITIES_PREFIX = "qualities.";

// Plain scalar/array fields the `do:set` op writes on a single
// aggregate. The reducer's job: set `state[field] = value`. Validation
// happened in the verb handler (which threw on bad input before the
// fact was stamped); the reducer just records what the fact says.
//
// `parent` and `llmDefault` are intentionally NOT in this set —
// parent is cross-aggregate (changes children[] on old/new parents)
// and llmDefault delegates to assign-llm-slot's multi-write coord.
// They land in later slices.
const SCALAR_SET_FIELDS = new Set(["name", "type"]);

// Per-kind birth shapes. The reducer's job on `do:birth`: produce the
// full initial row state from `fact.params.spec` (which the verb
// handler enriched with derived fields like spaceId, parentMatterId,
// beingId before the fact was stamped). Different aggregate kinds
// produce different shapes; the helper dispatches on the fact's
// target.kind.
//
// Pure: same fact → same state. `fact.date` provides the wall-clock
// (set when logFact created the fact); reducers MUST use that rather
// than calling new Date() / Date.now() so concurrent folds compute
// identical state and rebuild is deterministic.

/**
 * Apply a `do:set` fact's qualities-path update to state.
 *
 * `fact.params.field` shapes:
 *   - "qualities.<namespace>"               → whole-namespace write/merge
 *   - "qualities.<namespace>.<innerKey>"    → set/unset one inner key
 *   - "qualities.<namespace>.<a>.<b>...."   → deeper path (max depth bounded
 *                                              by qualityMaxNestingDepth)
 *
 * `fact.params.value`:
 *   - any JSON value to set at the path
 *   - null + whole-namespace → unset the namespace
 *   - null + sub-path        → unset the inner key
 *
 * `fact.params.merge`:
 *   - true (default for whole-namespace) → merge into existing namespace
 *   - false                              → replace namespace entirely
 *   - irrelevant for sub-paths           → always sets/unsets the leaf
 *
 * Returns the new state. If the fact doesn't apply (wrong action,
 * non-qualities field, malformed input), returns state unchanged.
 *
 * @param {object} state  current reducer state
 * @param {object} fact   the fact to apply
 * @returns {object} new state
 */
export function applySetQualities(state, fact) {
  if (fact?.action !== "set") return state;
  const params = fact.params || {};
  const field = params.field;
  if (typeof field !== "string" || !field.startsWith(QUALITIES_PREFIX)) {
    return state;
  }

  const rest = field.slice(QUALITIES_PREFIX.length);
  if (!rest) return state;
  const parts = rest.split(".");
  const namespace = parts[0];
  if (!namespace) return state;

  const currentQualities = state.qualities || {};
  const value = params.value;
  const merge = params.merge !== false; // default true

  if (parts.length === 1) {
    // Whole-namespace write
    if (value === null) {
      // Unset namespace
      const next = { ...currentQualities };
      delete next[namespace];
      return { ...state, qualities: next };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      // Malformed — reducer is defensive; pass through
      return state;
    }
    const currentNs = (currentQualities[namespace] && typeof currentQualities[namespace] === "object")
      ? currentQualities[namespace]
      : {};
    const newNs = merge ? { ...currentNs, ...value } : value;
    return {
      ...state,
      qualities: { ...currentQualities, [namespace]: newNs },
    };
  }

  // Deep path: walk into the namespace and set the leaf
  const currentNs = (currentQualities[namespace] && typeof currentQualities[namespace] === "object")
    ? currentQualities[namespace]
    : {};
  const newNs = setDeepPath(currentNs, parts.slice(1), value);
  return {
    ...state,
    qualities: { ...currentQualities, [namespace]: newNs },
  };
}

/**
 * Apply a `do:set` fact's scalar-field update (name, type) to state.
 * Schema-field writes that the reducer can take ownership of without
 * cross-aggregate effects.
 *
 * If the fact isn't `do:set`, or `field` isn't in SCALAR_SET_FIELDS,
 * returns state unchanged. Null `value` unsets the field.
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
export function applySetField(state, fact) {
  if (fact?.action !== "set") return state;
  const { field, value } = fact.params || {};
  if (typeof field !== "string" || !SCALAR_SET_FIELDS.has(field)) {
    return state;
  }
  if (value === null) {
    const next = { ...state };
    delete next[field];
    return next;
  }
  return { ...state, [field]: value };
}

/**
 * Apply a `do:birth` fact targeting a matter. Produces the initial
 * matter row state from `fact.params.spec`.
 *
 * The verb handler is responsible for enriching the spec with derived
 * fields BEFORE the fact is stamped (parent target → spaceId or
 * parentMatterId; identity → beingId). The reducer just reads the
 * enriched spec.
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
export function applyBirthMatter(state, fact) {
  if (fact?.verb !== "do" || fact?.action !== "birth") return state;
  if (fact?.target?.kind !== "matter") return state;
  const spec = fact?.params?.spec || {};
  return {
    ...state,
    spaceId:        spec.spaceId ?? null,
    beingId:        spec.beingId ?? null,
    name:           spec.name ?? null,
    content:        spec.content ?? null,
    origin:         spec.origin || "ibp",
    parentMatterId: spec.parentMatterId ?? null,
    qualities:      spec.qualities ?? {},
    children:       [],
    position:       spec.spaceId ?? null,
    createdAt:      fact.date,
    updatedAt:      fact.date,
  };
}

/**
 * Immutably set `value` at `pathParts` inside `obj`. Walks the path,
 * cloning each level. null at leaf removes the leaf key.
 *
 * @param {object} obj
 * @param {string[]} pathParts  non-empty
 * @param {*} value
 * @returns {object} new obj
 */
function setDeepPath(obj, pathParts, value) {
  const [head, ...rest] = pathParts;
  if (rest.length === 0) {
    // Leaf
    if (value === null) {
      const next = { ...obj };
      delete next[head];
      return next;
    }
    return { ...obj, [head]: value };
  }
  // Recurse into child
  const childRaw = obj[head];
  const child = (childRaw && typeof childRaw === "object" && !Array.isArray(childRaw))
    ? childRaw
    : {};
  return { ...obj, [head]: setDeepPath(child, rest, value) };
}
