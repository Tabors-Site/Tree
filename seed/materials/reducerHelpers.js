// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Shared reducer helpers. Logic the three material reducers
// (being / space / matter) all need.
//
// Today: applying `do:set` facts to derive qualities state. The
// `set` op's params shape is `{ field, value, merge=true }`. When
// `field` starts with "qualities." the reducer needs to produce the
// new qualities object from the fact alone (no store round-trip).
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
//
// set-model stamps its own fact (action "set-model") with the same
// {field, value, merge} params shape — its handler owns the
// authorization (self/author/owner per target kind), so it can't
// delegate to the set-<kind> trio without also requiring callers to
// hold those grants wherever they happen to stand. To the reducer
// it's one more qualities write; the target kind routes it to the
// right aggregate's reel.
// rename-matter rides the same reducer path as set-matter:name. The
// verb separates the intent (an audit-trail "rename") from the bare
// scalar write, but the fold is the same one-field update on the
// matter row's name. See materials/matter/ops.js renameMatterHandler.
const SET_ACTIONS = new Set([
  "set-space",
  "set-being",
  "set-matter",
  "set-model",
  "rename-matter",
  "set-render",
  "set-being-flow",
  "set-owner",
  "remove-owner",
]);
const CREATE_ACTIONS = new Set(["create-space", "create-matter"]);

// Plain scalar/array fields the `do:set` op writes on a single
// aggregate. The reducer's job: set `state[field] = value`. Validation
// happened in the verb handler (which threw on bad input before the
// fact was stamped); the reducer just records what the fact says.
//
// `owner` is the one authority-bearing structural field on a Space —
// setSpaceOwner / removeSpaceOwner stamp through here just like any
// other scalar. Every other authority shape lives in qualities.ables
// + qualities.ablesGranted per seed/AblesAreAuth.md.
//
// A parent reassignment is one write on one aggregate now; downward
// walks query by parent / parentBeingId, no cross-aggregate update
// needed. The Space reducer also derives `position` from a parent
// set so foldPlace's occupant query sees the move.
const SCALAR_SET_FIELDS = new Set([
  "name",
  "type",
  "owner",
  "parent",
  "parentBeingId",
  // Being identity scalars added during genesis cleanup (2026-05-23).
  // seedDelegates drift correction stamps do:set facts for each
  // when an existing delegate's row drifts from spec. Cognition no
  // longer lives here as a schema field — it's at
  // qualities.cognition.defaultKind and writes through the qualities
  // path, not SCALAR_SET_FIELDS.
  "defaultAble",
  "homeSpace",
  "homeHistory",
  // password: bcrypt hash. credential-reset (and any future flow that
  // re-mints credentials) stamps a do:set-being fact carrying the new
  // hash; the reducer records it exactly like any other Being scalar.
  // Plaintext never touches this field.
  "password",
  // Matter scalars added in Slice C-matter-full (2026-05-23). The
  // editMatter content update, endMatter soft-delete
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
// full initial row state from `fact.params` (which the verb
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
  if (!SET_ACTIONS.has(fact?.act)) return state;
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
    // no defined meaning for an array). flow is the canonical case:
    // an ordered list of clauses lives at qualities.flow directly.
    // Callers writing an array must pass merge:false.
    if (Array.isArray(value)) {
      if (merge) return state;
      return {
        ...state,
        qualities: { ...currentQualities, [namespace]: value },
      };
    }
    const currentNs =
      currentQualities[namespace] &&
      typeof currentQualities[namespace] === "object" &&
      !Array.isArray(currentQualities[namespace])
        ? currentQualities[namespace]
        : {};
    const newNs = merge ? { ...currentNs, ...value } : value;
    return {
      ...state,
      qualities: { ...currentQualities, [namespace]: newNs },
    };
  }

  // Deep path: walk into the namespace and set the leaf
  const currentNs =
    currentQualities[namespace] &&
    typeof currentQualities[namespace] === "object"
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
  if (!SET_ACTIONS.has(fact?.act)) return state;
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
 * Apply a `be:birth` fact targeting a being. Produces the initial
 * being row state from `fact.params`.
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
  if (fact?.of?.kind !== "being") return state;
  const action = fact?.act;
  if (action !== "connect" && action !== "release") return state;

  // Preserve any other namespaces under qualities by merging at the
  // connection sub-key. qualities itself may be undefined on first
  // touch; default to {}.
  const qualities = state.qualities || {};
  const prev = qualities.connection || {};

  let connection;
  if (action === "connect") {
    const inhabitedBy = fact?.params?.inhabitedBy || null;
    // `since` records WHEN the connection opened, kept for audit only
    // (no reader sorts or compares connection.since for truth). Take
    // only a caller-supplied value; the wall-clock fact.date fallback
    // would fold a clock into state, so it is dropped. Absent a
    // caller value, since stays null and WHEN is the fact's chain
    // position.
    const since = fact?.params?.since ?? null;
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

/**
 * Apply be:death facts to the being's qualities.death projection.
 *
 * Death is the being's final lifecycle act (seed/done/DualBeingParents).
 * One-way: once stamped, the being's act-chain is locked, no new BE
 * ops are accepted, summons refuse, able grants refuse. Past acts and
 * past grants remain valid (facts at the time stand; later closure
 * doesn't retroactively invalidate them).
 *
 * Idempotent: re-applying a be:death to an already-dead being is a
 * no-op (the FIRST death's timestamp is the canonical death moment).
 *
 * Fact shape:
 *   verb:   "be"
 *   action: "death"
 *   target.kind: "being", target.id: <being whose death we're recording>
 *   params.byActor: <beingId who closed this being> (today: always I)
 *
 * The projection lands at `qualities.death = { time, byActor }`.
 * Consumers test `being.qualities.death?.time != null` for the
 * is-dead predicate.
 *
 * RENDERING SCRUB: death also nulls every field that descriptor
 * builders consult to render the being at a position — `position`,
 * `coord`, and `qualities.connection.inhabitedBy`. The dead being
 * stops appearing in any place's beingsAtSpace lookup without a
 * per-call filter; SEE just doesn't see them anywhere. Identity-
 * level state (name, defaultAble, ablesGranted, homeSpace,
 * parentBeingId) stays — the being remains queryable as history.
 *
 * @param {object} state
 * @param {object} fact
 * @returns {object} new state
 */
export function applyDeath(state, fact) {
  if (fact?.verb !== "be") return state;
  if (fact?.act !== "death") return state;
  if (fact?.of?.kind !== "being") return state;

  const qualities = state.qualities || {};

  // Idempotent — first death wins. The being is dead the moment the be:death FACT exists; that fact's
  // existence IS the death (no clock — an act is present, a fact is past, and "when" is the chain
  // position, not a timestamp). Re-folding preserves the byActor and the cleared rendering state.
  if (qualities.death) return state;

  const byActor = fact?.params?.byActor || fact?.through || null;

  // Inhabit-state cleared so the "human" cognition flip-up doesn't
  // fire for a dead being even on stale reads.
  const connection = qualities.connection
    ? { ...qualities.connection, inhabitedBy: null }
    : { inhabitedBy: null };

  return {
    ...state,
    // Rendering scrub: nulled at fold time so all SEE projections
    // (beingsAtSpace, position lookups, coord readers) naturally
    // exclude the dead being without a per-call alive-filter.
    position: null,
    coord: null,
    qualities: {
      ...qualities,
      connection,
      death: { byActor },
    },
  };
}

/**
 * Apply a be:truename fact: re-point this being's trueName at an EXISTING
 * Name (the verb handler validated it before the stamp). Identity-level (a
 * BE op), folded onto this being's OWN reel. The being's _id (its frozen
 * birth-event hash) is unaffected, so the reel key + chain stay intact
 * across the transfer. Idempotent: re-folding the same value is a no-op.
 */
export function applyTrueName(state, fact) {
  if (fact?.verb !== "be") return state;
  if (fact?.act !== "truename") return state;
  if (fact?.of?.kind !== "being") return state;
  const trueName = fact?.params?.trueName;
  if (typeof trueName !== "string" || !trueName) return state;
  if (state.trueName === trueName) return state;
  return { ...state, trueName };
}

/**
 * Apply do:grant-able / do:revoke-able facts to the being's
 * qualities.ablesGranted projection (seed/AblesAreAuth.md).
 *
 * Grant facts append a new entry; revoke facts remove the matching
 * tuple. Uniqueness is on (able, anchorSpaceId|anchorBeingId, grantedBy);
 * duplicate grants from different grantors live as separate entries
 * and survive each other's revocations independently.
 *
 * Fact shape for both:
 *   {
 *     verb:   "do",
 *     action: "grant-able" | "revoke-able",
 *     target: { kind: "being", id: <granteeBeingId> },
 *     params: {
 *       able:          <ableName>,
 *       anchorSpaceId: <spaceId | null>,
 *       anchorBeingId: <beingId | null>,
 *       grantedBy:     <grantorBeingId>,
 *     }
 *   }
 *
 * Grants: at most one anchor field populated; the other null.
 * Revocations match by (able, both-anchor-keys, grantedBy) — caller
 * must identify the specific grant to revoke (mirrors subscriptions).
 */
export function applyAbleGrants(state, fact) {
  if (fact?.verb !== "do") return state;
  // A able grant folds from WHICHEVER act granted it: an explicit do:grant-able, or a being
  // TAKING (do:take-able) / being granted via ASK (do:ask-able). Take/ask ALWAYS stamp their
  // act (every act makes a fact) but carry the grant record (grantedBy) ONLY when
  // they actually granted — the no-grant paths (an idempotent re-take, a queued ask) stamp
  // the act with no grantedBy, so the `!grantedBy` guard below stops them here (nothing folds).
  const isGrant =
    fact.act === "grant-able" ||
    fact.act === "take-able" ||
    fact.act === "ask-able";
  const isRevoke = fact.act === "revoke-able";
  if (!isGrant && !isRevoke) return state;
  if (fact?.of?.kind !== "being") return state;
  const params = fact?.params;
  if (!params || typeof params !== "object") return state;
  const able = params.able;
  if (typeof able !== "string" || !able.length) return state;
  const anchorSpaceId = params.anchorSpaceId || null;
  const anchorBeingId = params.anchorBeingId || null;
  if (!anchorSpaceId && !anchorBeingId) return state;
  // grantedBy is the GRANTOR. take/ask/internal carry it in params; a word-sourced
  // grant-able does NOT duplicate it — grantedBy is the fact's SIGNER (the acting being on
  // `through`). Read params first (those paths), fall back to the signer (the no-mirror law:
  // the grantor isn't restated, it's who signed).
  const grantedBy =
    params.grantedBy || (fact.through ? String(fact.through) : null);
  if (!grantedBy) return state;

  const existingQualities = state.qualities || {};
  const existing = Array.isArray(existingQualities.ablesGranted)
    ? existingQualities.ablesGranted
    : [];

  if (isGrant) {
    // No clock: a grant's WHEN is its PLACE in the chain (seq/lineage) — chains create off
    // each other, that ordering IS the time. NEVER derive it from fact.date (the wall-clock
    // the time-purge removed). No path passes a grantedAt anymore. The builders, the .words,
    // and this reducer all dropped it; the fact's seq is the only "when".
    // Dedupe by the uniqueness tuple — re-emit is idempotent.
    const alreadyHas = existing.some(
      (e) =>
        e.able === able &&
        (e.anchorSpaceId || null) === anchorSpaceId &&
        (e.anchorBeingId || null) === anchorBeingId &&
        (e.grantedBy || null) === grantedBy,
    );
    if (alreadyHas) return state;
    const next = [
      ...existing,
      {
        able,
        anchorSpaceId,
        anchorBeingId,
        grantedBy,
      },
    ];
    return {
      ...state,
      qualities: { ...existingQualities, ablesGranted: next },
    };
  }

  // Revoke: drop the matching entry. If none matches, no-op.
  const filtered = existing.filter(
    (e) =>
      !(
        e.able === able &&
        (e.anchorSpaceId || null) === anchorSpaceId &&
        (e.anchorBeingId || null) === anchorBeingId &&
        (e.grantedBy || null) === grantedBy
      ),
  );
  if (filtered.length === existing.length) return state;
  return {
    ...state,
    qualities: { ...existingQualities, ablesGranted: filtered },
  };
}

export function applyCreateBeing(state, fact) {
  if (fact?.verb !== "be" || fact?.act !== "birth") return state;
  if (fact?.of?.kind !== "being") return state;
  const spec = fact?.params;
  if (!spec || typeof spec !== "object") return state;

  const defaultAble = spec.defaultAble || spec.able || null;

  return {
    ...state,
    name: spec.name,
    password: spec.password,
    defaultAble,
    // The trueName this presence expresses (the mother's trueName at
    // birth; host-transferable later). Folds from the be:birth spec.
    trueName: spec.trueName ?? null,
    parentBeingId: spec.parentBeingId ?? null,
    homeSpace: spec.homeSpace ?? null,
    homeHistory: spec.homeHistory ?? null,
    isRemote: Boolean(spec.isRemote),
    homeStory: spec.homeStory ?? null,
    // Cognition (closed-set: "llm" | "human" | "scripted") lives at
    // qualities.cognition.defaultKind. Effective cognition is computed
    // at read time by beingCognition() in identity/lookups.js, which
    // checks the inhabit projection first and falls back to this.
    qualities: spec.qualities ?? {},
    // Being.children retired 2026-05-23; downward walks query by
    // parentBeingId (parallel to Space.children retirement).
    // `position` carries either an explicit `spec.position` (caller
    // chose a starting position different from homeSpace) or falls
    // back to homeSpace. Legacy `spec.currentSpace` accepted as an
    // alias during migration; callers should pass `spec.position`
    // going forward.
    position: spec.position ?? spec.currentSpace ?? spec.homeSpace ?? null,
    // Coord inside the position space. createBeing assigns a random
    // coord inside the position space's size when none was passed;
    // the reducer just records it. Movement later writes coord via
    // set-being:coord facts which applySetField picks up.
    coord: spec.coord ?? null,
    bornOrd: fact.ord,
  };
}

/**
 * Apply a `do:birth` fact targeting a space. Produces the initial
 * space row state from `fact.params`.
 *
 * Same safety pattern as applyCreateBeing: when `fact.params` is
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
  if (fact?.verb !== "do" || !CREATE_ACTIONS.has(fact?.act)) return state;
  if (fact?.of?.kind !== "space") return state;
  const spec = fact?.params;
  if (!spec || typeof spec !== "object") return state;

  // Owner of the new space. Genesis spaces (heaven + heaven children)
  // seed owner to I-Am; user trees seed owner to their creator. The
  // spec carries owner directly; ownerId is accepted as a shorthand
  // alias. (Decomposed shape: a slim birth omits owner/heaven and a
  // SEPARATE set-owner / make-heaven moment follows — genesis is a
  // sequence of moments, one word each. The fat spec is the run-on
  // we're untangling, but it still folds via the spec.* branch here.)
  const initialOwner = spec.owner
    ? String(spec.owner)
    : spec.ownerId
      ? String(spec.ownerId)
      : null;

  return {
    ...state,
    name: spec.name,
    type: spec.type ?? null,
    parent: spec.parent ?? spec.parentId ?? null,
    owner: initialOwner,
    heavenSpace: spec.heavenSpace ?? null,
    size: spec.size ?? null,
    // Space's own coord within its parent. The createSpace handler
    // assigns a random coord inside the parent's size when none was
    // passed; the reducer just records it.
    coord: spec.coord ?? null,
    qualities: spec.qualities ?? {},
    bornOrd: fact.ord,
    position: spec.parent ?? spec.parentId ?? null,
  };
}

/**
 * Apply a `do:birth` fact targeting a matter. Produces the initial
 * matter row state from `fact.params`.
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
/**
 * do:make-heaven — the HEAVEN WORD. Heaven-ness is a separable attribute
 * decomposed OUT of a space's birth (the same shape as owner/qualities): a
 * being makes a space a heaven space with its own do, its own fact on the
 * space's reel. create-space.word lays it as an inner act after the birth.
 * Only the I-Am can author it (the op has no able grant, so it fails closed
 * for everyone else — the genesis-only heaven-creation gate). Wired AFTER
 * applyCreateSpace in the space reducer so the birth (heavenSpace:null) lands
 * first and this sets the real flag.
 */
export function applyMakeHeaven(state, fact) {
  if (fact?.act !== "make-heaven" || fact?.of?.kind !== "space") return state;
  const which = fact?.params?.heavenSpace;
  if (typeof which !== "string" || !which) return state;
  return { ...state, heavenSpace: which };
}

export function applyMove(state, fact) {
  if (fact?.verb !== "do" || fact?.act !== "move") return state;
  const kind = fact?.of?.kind;
  if (kind !== "space" && kind !== "matter") return state;
  const { coord, to } = fact?.params || {};

  if (
    coord &&
    typeof coord === "object" &&
    Number.isFinite(coord.x) &&
    Number.isFinite(coord.y)
  ) {
    const next = { x: coord.x, y: coord.y };
    if (Number.isFinite(coord.z)) next.z = coord.z;
    return { ...state, coord: next };
  }

  // params.to is a bare space-id. Reducer writes it through to the
  // appropriate field (state.parent for space, state.spaceId for matter)
  // plus the denormalized position cache.
  if (typeof to === "string" && to) {
    if (kind === "space")
      return { ...state, parent: to, position: to };
    if (kind === "matter")
      return { ...state, spaceId: to, position: to };
  }

  return state;
}

export function applyCreateMatter(state, fact) {
  if (fact?.verb !== "do" || !CREATE_ACTIONS.has(fact?.act)) return state;
  if (fact?.of?.kind !== "matter") return state;
  const spec = fact?.params || {};
  return {
    ...state,
    spaceId: spec.spaceId ?? null,
    beingId: spec.beingId ?? null,
    name: spec.name ?? null,
    // Content: a CAS ref object ({kind:"cas", hash, ...}) for owned
    // bytes; reference types keep their reference shapes (http {url},
    // ibpa {target}, source {path}). The reducer copies, never
    // computes — preview rides on the fact.
    content: spec.content ?? null,
    // Registered matter type (materials/matter/types.js). Defaulted
    // here too so pre-type facts fold deterministically.
    type: spec.type || "generic",
    // Born-at-a-position. Validated (clamped-or-thrown) in the
    // handler before the fact stamped; the reducer copies.
    coord: spec.coord ?? null,
    parentMatterId: spec.parentMatterId ?? null,
    qualities: spec.qualities ?? {},
    children: [],
    position: spec.spaceId ?? null,
    bornOrd: fact.ord,
  };
}

/**
 * do:purge-content — the bytes behind this matter's content hash were
 * physically removed from the content store. The ref stays (the chain
 * proves what the content WAS — hash, size, type); the projection
 * marks it purged so readers return the purged marker instead of
 * attempting a store read. Only flips when the fact's hash matches
 * the CURRENT content — purging a historical version's hash doesn't
 * touch the live ref.
 */
export function applyPurgeContent(state, fact) {
  if (fact?.verb !== "do" || fact?.act !== "purge-content") return state;
  if (fact?.of?.kind !== "matter") return state;
  const hash = fact?.params?.hash;
  if (!hash || !state?.content || typeof state.content !== "object")
    return state;
  if (state.content.hash !== hash) return state;
  return {
    ...state,
    content: { ...state.content, purged: true, preview: null },
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
  const child =
    childRaw && typeof childRaw === "object" && !Array.isArray(childRaw)
      ? childRaw
      : {};
  return { ...obj, [head]: setDeepPath(child, rest, value) };
}
