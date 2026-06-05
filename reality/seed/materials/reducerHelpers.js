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

// Fact actions emitted by the material-scoped DO ops.
//
// Reducers route on action name so a fact saying "I set a Being field"
// (`set-being`) and one saying "I set a Space field" (`set-space`) both
// land in applySetField / applySetQualities. The ops live in
// materials/<kind>/ops.js; their factAction strings are what the
// dispatcher stamps into each fact.
const SET_ACTIONS = new Set(["set-space", "set-being", "set-matter"]);
const CREATE_ACTIONS = new Set(["create-space", "create-matter"]);

// Plain scalar/array fields the `do:set` op writes on a single
// aggregate. The reducer's job: set `state[field] = value`. Validation
// happened in the verb handler (which threw on bad input before the
// fact was stamped); the reducer just records what the fact says.
//
// `llmDefault` lives here as of slice F-llm (2026-05-23). It writes
// to the same scalar field on both Being and Space aggregates; the
// reducer for each just records value. Slot-name validation + per-being
// connection-ownership happen in the verb handler before the fact
// stamps. Cache invalidation (clearBeingClientCache) is the
// connection helper's responsibility, after doVerb returns.
//
// `rootOwner` and `contributors` join the set in slice F-ownership
// (2026-05-23). Both are scalar-shape on a single Space aggregate
// (rootOwner = beingId or null; contributors = array of beingIds).
// The cross-aggregate effects of an ownership change are propagation
// via the read-side resolver chain (resolveSpaceAccess) walking the
// parent chain, NOT writes to other aggregates — so set-on-one-Space
// captures everything the fact needs to record. Read-modify-write
// callers (addContributor / removeContributor) hold the space lock
// around the read so the projection they recompute doesn't race a
// concurrent fold.
//
// `parent` (Space) + `parentBeingId` (Being) join the set in genesis
// cleanup (2026-05-23) once the parent-side children[] caches retired.
// A parent reassignment is one write on one aggregate now; downward
// walks query by parent / parentBeingId, no cross-aggregate update
// needed. The Space reducer also derives `position` from a parent
// set so foldPlace's occupant query sees the move.
const SCALAR_SET_FIELDS = new Set([
  "name",
  "type",
  "llmDefault",
  "rootOwner",
  "contributors",
  "parent",
  "parentBeingId",
  // Being identity scalars added during genesis cleanup (2026-05-23).
  // seedDelegates drift correction stamps do:set facts for each
  // when an existing delegate's row drifts from spec. Cognition no
  // longer lives here as a schema field — it's at
  // qualities.cognition.defaultKind and writes through the qualities
  // path, not SCALAR_SET_FIELDS.
  "defaultRole",
  "homeSpace",
  // password: bcrypt hash. credential-reset (and any future flow that
  // re-mints credentials) stamps a do:set-being fact carrying the new
  // hash; the reducer records it exactly like any other Being scalar.
  // Plaintext never touches this field.
  "password",
  // Matter scalars added in Slice C-matter-full (2026-05-23). The
  // editMatter content update, deleteMatterAndFile soft-delete
  // (spaceId/beingId=DELETED), and transferMatter cross-space move
  // all stamp do:set facts on these fields. The shared reducer is
  // safe because the verb handler enforces kind=matter before
  // emitting; cross-kind writes never reach the reducer.
  "content",
  "spaceId",
  "beingId",
  // SPATIAL fields. Both shapes are `{ x, y, z? }`. coord (Being)
  // is the position inside currentSpace; size (Space) is the
  // bounding box. The set-being handler clamps coord to size
  // before stamping; the reducer just records the clamped value.
  "coord",
  "size",
  // `position` (Being.position): the Space this being is in right
  // now. Written via be:occupy with params.toPosition;
  // set-being:position is the symmetric DO-side path used by the
  // portal on navigate ("I am now in this space") so the being
  // shows up in descriptor.occupantsByPosition. The reducer
  // accepts either form — both write the same field.
  "position",
]);

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
  if (!SET_ACTIONS.has(fact?.action)) return state;
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
    if (typeof value !== "object") {
      // Malformed — reducer is defensive; pass through
      return state;
    }
    // Arrays-as-namespace are legal but only as a replacement (merge has
    // no defined meaning for an array). roleFlow is the canonical case:
    // an ordered list of clauses lives at qualities.roleFlow directly.
    // Callers writing an array must pass merge:false.
    if (Array.isArray(value)) {
      if (merge) return state;
      return {
        ...state,
        qualities: { ...currentQualities, [namespace]: value },
      };
    }
    const currentNs = (currentQualities[namespace] && typeof currentQualities[namespace] === "object" && !Array.isArray(currentQualities[namespace]))
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
  if (!SET_ACTIONS.has(fact?.action)) return state;
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
 * Apply a `be:register` fact targeting a being. Produces the initial
 * being row state from `fact.params.spec`.
 *
 * Important safety: when the fact's params don't carry `spec` (the
 * legacy slim shape: `{name, role, witnessedBy}` from the pre-conversion
 * birthBeing path), this returns state unchanged. That keeps
 * the reducer harmless while the legacy `new Being(...).save()` flow
 * still runs in parallel. Once birthBeing landed to emit a
 * full spec, the reducer becomes the source.
 *
 * The verb handler is responsible for input normalization BEFORE the
 * fact is stamped: bcrypt-hash the password, resolve home space,
 * auto-generate name (non-humans), validate. Reducer reads what the
 * handler wrote, stays pure.
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
/**
 * Connection-tracking reducer for being-targeted BE:connect and
 * BE:release facts. Maintains qualities.connection.{inhabitedBy, since}
 * as a projection of the connect/release fact stream.
 *
 * Doctrine: an inhabit IS a BE:connect (cherub Mode-3 ancestor-relation
 * auth path), not a new BE op or a DO:set. The chain stamps a normal
 * connect fact; this reducer derives the inhabitedBy quality from it.
 * Replay reconstructs the full inhabit history.
 *
 * Fact shape this recognizes:
 *   verb: "be"
 *   action: "connect" → set inhabitedBy + since
 *   action: "release" → clear inhabitedBy (set to null)
 *   target.kind: "being", target.id: <being whose state we're updating>
 *   params.inhabitedBy: <the identity now driving this being>
 *
 * Cherub's three connect paths all stamp the same fact shape:
 *   - credential connect: inhabitedBy = the bound being's id (self)
 *   - re-claim: inhabitedBy = caller's beingId (self, no change)
 *   - inherit: inhabitedBy = caller's beingId (parent driving child)
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
export function applyConnectionState(state, fact) {
  if (fact?.verb !== "be") return state;
  if (fact?.target?.kind !== "being") return state;
  const action = fact?.action;
  if (action !== "connect" && action !== "release") return state;

  // Preserve any other namespaces under qualities by merging at the
  // connection sub-key. qualities itself may be undefined on first
  // touch; default to {}.
  const qualities = state.qualities || {};
  const prev = qualities.connection || {};

  let connection;
  if (action === "connect") {
    const inhabitedBy = fact?.params?.inhabitedBy || null;
    const since = fact?.date || fact?.params?.since || null;
    connection = { ...prev, inhabitedBy, since };
  } else {
    // release — clear the inhabitedBy. Keep `since` for audit
    // (last-connected-at; the next connect overwrites).
    connection = { ...prev, inhabitedBy: null };
  }

  return {
    ...state,
    qualities: {
      ...qualities,
      connection,
    },
  };
}

export function applyCreateBeing(state, fact) {
  if (fact?.verb !== "be" || fact?.action !== "birth") return state;
  if (fact?.target?.kind !== "being") return state;
  const spec = fact?.params?.spec;
  if (!spec || typeof spec !== "object") return state; // legacy slim params

  // Resolve defaultRole. The carry list (`roles: [String]`) retired
  // 2026-06-01 with the RoleFlow build; the be:birth fact's spec may
  // still carry `roles` for back-compat (legacy chains) but we only
  // honor the first entry as a fallback for defaultRole.
  let defaultRole = spec.defaultRole || spec.role || null;
  if (!defaultRole && Array.isArray(spec.roles) && spec.roles.length > 0) {
    defaultRole = spec.roles[0];
  }

  return {
    ...state,
    name:          spec.name,
    password:      spec.password,
    defaultRole,
    parentBeingId: spec.parentBeingId ?? null,
    homeSpace:     spec.homeSpace ?? null,
    llmDefault:    spec.llmDefault ?? null,
    isRemote:      Boolean(spec.isRemote),
    homeReality:   spec.homeReality ?? null,
    // Cognition (closed-set: "llm" | "human" | "scripted") lives at
    // qualities.cognition.defaultKind. Effective cognition is computed
    // at read time by beingCognition() in identity/lookups.js, which
    // checks the inhabit projection first and falls back to this.
    qualities:     spec.qualities ?? {},
    // Being.children retired 2026-05-23; downward walks query by
    // parentBeingId (parallel to Space.children retirement).
    // `position` carries either an explicit `spec.position` (caller
    // chose a starting position different from homeSpace) or falls
    // back to homeSpace. Legacy `spec.currentSpace` accepted as an
    // alias during migration; callers should pass `spec.position`
    // going forward.
    position:      spec.position ?? spec.currentSpace ?? spec.homeSpace ?? null,
    // Coord inside the position space. createBeing assigns a random
    // coord inside the position space's size when none was passed;
    // the reducer just records it. Movement later writes coord via
    // set-being:coord facts which applySetField picks up.
    coord:         spec.coord ?? null,
    createdAt:     fact.date,
    updatedAt:     fact.date,
  };
}

/**
 * Apply a `do:birth` fact targeting a space. Produces the initial
 * space row state from `fact.params.spec`.
 *
 * Same safety pattern as applyCreateBeing: when `fact.params.spec` is
 * absent (the legacy createSpaceChild → createSpace path doesn't emit
 * a spec on the fact today), this returns state unchanged. The
 * reducer becomes load-bearing only when the space-birth handler
 * converts to emit a spec-carrying fact.
 *
 * Verb handler responsibility (when converted): validate name/type,
 * resolve parent, run beforeSpaceCreate hook, build the spec. Reducer
 * reads what the handler wrote.
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
export function applyCreateSpace(state, fact) {
  if (fact?.verb !== "do" || !CREATE_ACTIONS.has(fact?.action)) return state;
  if (fact?.target?.kind !== "space") return state;
  const spec = fact?.params?.spec;
  if (!spec || typeof spec !== "object") return state; // legacy birth fact

  return {
    ...state,
    name:         spec.name,
    type:         spec.type ?? null,
    parent:       spec.parent ?? spec.parentId ?? null,
    // Space.children retired 2026-05-23; parent-side cache replaced by
    // findByPosition / parent-queries. The reducer doesn't write it.
    rootOwner:    spec.rootOwner ?? null,
    contributors: [],
    seedSpace:    spec.seedSpace ?? null,
    llmDefault:   spec.llmDefault ?? null,
    size:         spec.size ?? null,
    // Space's own coord within its parent. The createSpace handler
    // assigns a random coord inside the parent's size when none was
    // passed; the reducer just records it.
    coord:        spec.coord ?? null,
    qualities:    spec.qualities ?? {},
    dateCreated:  fact.date,
    position:     spec.parent ?? spec.parentId ?? null,
  };
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
/**
 * Apply a `do:move` fact. One unified action with two modes,
 * discriminated by which params field is present.
 *
 * Mode 1, coord (the everyday case — repositioning within a space):
 *   params.coord = { x, y[, z] }
 *   matter target → coord becomes params.coord
 *   space target  → coord becomes params.coord (a child tree's spot
 *                   in its parent space)
 *
 * Mode 2, container (carrying across a doorway):
 *   params.to = <spaceId>
 *   matter target → spaceId becomes params.to (matter now lives in
 *                   that space)
 *   space target  → parent becomes params.to (tree now lives under
 *                   that space)
 *
 * Beings have their own movement path (set-being:coord for in-space
 * motion, set-being:position for cross-space). `move` is what beings
 * do TO things in their world.
 */
export function applyMove(state, fact) {
  if (fact?.verb !== "do" || fact?.action !== "move") return state;
  const kind = fact?.target?.kind;
  if (kind !== "space" && kind !== "matter") return state;
  const { coord, to } = fact?.params || {};

  if (coord && typeof coord === "object" &&
      Number.isFinite(coord.x) && Number.isFinite(coord.y)) {
    const next = { x: coord.x, y: coord.y };
    if (Number.isFinite(coord.z)) next.z = coord.z;
    return { ...state, coord: next, updatedAt: fact.date };
  }

  // params.to is a bare space-id. Reducer writes it through to the
  // appropriate field (state.parent for space, state.spaceId for matter)
  // plus the denormalized position cache.
  if (typeof to === "string" && to) {
    if (kind === "space")  return { ...state, parent: to, position: to, updatedAt: fact.date };
    if (kind === "matter") return { ...state, spaceId: to, position: to, updatedAt: fact.date };
  }

  return state;
}

export function applyCreateMatter(state, fact) {
  if (fact?.verb !== "do" || !CREATE_ACTIONS.has(fact?.action)) return state;
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
