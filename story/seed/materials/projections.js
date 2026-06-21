// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Projections — the cache the fold writes to and the engine reads from.
//
// Doctrine (locked with Tabor 2026-06-03):
//   1. Main is just-another-history with no parent. History is a
//      first-class dimension of every projection lookup.
//   2. Names are per-history identifiers; identity is `_id`. IBP
//      `#<history>` disambiguates.
//   3. Histories inherit parent state lazily. Modifications shadow main
//      for in-history queries.
//   4. Reducers are history-blind. The substrate handles history routing
//      around them.
//
// Storage: a single `projections` collection
// ([seed/materials/history/projection.js](history/projection.js)) holds
// every cache slot keyed `<history>:<type>:<id>`. Main (history="0") is
// not special-cased — its slots live alongside every other history's.
//
// No legacy compatibility paths. Callers that still read directly from
// Being / Space / Matter rows for projection data are now broken until
// swept onto this API (Phase 3). That is intentional: silent dual-shape
// fallbacks rot the architecture; loud breaks at the boundary are how
// the sweep gets finished.

import Projection, { projectionKey } from "./history/projection.js";

const MAIN = "0";
const VALID_TYPES = new Set(["being", "space", "matter", "name"]);

function assertType(type) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`projections: unknown type "${type}" (expected being|space|matter|name)`);
  }
}

// Doctrine (locked with Tabor 2026-06-04): history is a required argument
// on every projection API. Internal callers MUST thread it explicitly.
// Silent defaults to main were the failure mode — a caller forgot to
// pass history, the lookup landed on the wrong slot, and the user saw a
// "ghost" state with no error. The IBP parser is the only layer
// allowed to fill in absent histories (it resolves the wire-side default
// to "0" at expandStance); every other layer downstream of that
// resolution holds the value it was handed.
//
// `assertHistory` is the canonical check. It throws on any value that
// isn't a non-empty string, so a function called with `undefined`,
// `null`, or `""` fails loudly at the boundary instead of silently
// hitting main.
function assertHistory(history) {
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      `projections: history is required (got ${JSON.stringify(history)}). ` +
      `Internal callers must thread history from the moment's moment or the wire layer.`,
    );
  }
}

// Exported variant for use at substrate consumer boundaries (assign,
// fold, stamped, intake, inbox, scheduler, matters). Same shape as the
// projection-local check; callers use it at function entry so a missing
// history surfaces at THEIR site rather than masquerading as a projection
// lookup error one stack frame deeper. The doctrinal commitment is that
// every interior consumer trusts the perimeter has attached history and
// fails loud if not — no silent default to "0" / heaven.
export function assertHistoryOrThrow(history, callerName) {
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      `${callerName || "substrate consumer"}: history is required ` +
      `(got ${JSON.stringify(history)}). The wire layer / enclosing moment ` +
      `must thread history through; this consumer no longer silently defaults to heaven.`,
    );
  }
  return history;
}

// ─────────────────────────────────────────────────────────────────────
// Read / write a single slot
// ─────────────────────────────────────────────────────────────────────

/**
 * Read a projection slot in a history. Returns null when the slot has
 * never been initialized (the aggregate has never been touched in this
 * history's lineage), or a slot object — including tombstoned slots
 * (state-less, marker only). Callers handle tombstones explicitly.
 *
 * Lazy inheritance from parent histories is NOT done here. This function
 * is a single-slot read; the fold engine's cold-fold path walks the
 * lineage when the slot is missing, calls back through initProjection,
 * and subsequent reads land on the populated slot.
 *
 * DOCTRINE (read-back, history-anchored, null = "write didn't land")
 *
 * Use loadProjection when you JUST stamped a fact and you're confirming
 * the slot materialized. Null is a write-failure signal . the seal
 * didn't reach the slot. History-anchored: queries only the named
 * history's slot table, no lineage walk. The two canonical uses:
 *
 *   - Post-seal read-back ("I just stamped birth; is the row there?")
 *   - Doctrinal singletons hardcoded to main ("0") . I_AM, the
 *     `./config` cache, boot-time orphan-root walks. These rows live
 *     in main by construction; reading from a history makes no sense.
 *
 * Behavioral reads ("does this being exist anywhere I should care
 * about?", "what is this space's size?") need loadOrFold instead .
 * see its doc block.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} [history="0"]
 * @returns {Promise<{state, foldedSeq, position, tombstoned, type, id, history}|null>}
 */
export async function loadProjection(type, id, history) {
  if (!id) return null;
  assertType(type);
  assertHistory(history);
  // Heaven routing: spaces in heaven have one projection per story,
  // not per history. If the caller passed a non-MAIN history for a
  // heaven space, transparently rewrite to MAIN so the read returns
  // the single canonical row. The classifier is async (walks ancestor
  // cache), so guard on type=space to avoid cost on every being/matter
  // load.
  let effectiveHistory = history;
  if (type === "space" && history !== "0") {
    const { isHeavenSpace } = await import("./space/heavenLineage.js");
    if (await isHeavenSpace(id)) effectiveHistory = "0";
  }
  const slot = await Projection.findById(projectionKey(effectiveHistory, type, id)).lean();
  if (!slot) return null;
  return {
    state:      slot.state || {},
    foldedSeq:  slot.foldedSeq ?? null,
    position:   slot.position ?? null,
    tombstoned: !!slot.tombstoned,
    type:       slot.type,
    id:         slot.id,
    history:    slot.history,
  };
}

/**
 * Lazy cold-fold load. When the history has no slot for this aggregate,
 * triggers a fold() against the history's lineage. fold() walks
 * `readReelBetween(type, id, null, null, history)` — lineage-aware,
 * branch-point-respecting — and either populates the slot or returns
 * null (the aggregate truly doesn't exist in this history, e.g. created
 * in main AFTER branch point).
 *
 * DOCTRINE (behavioral, lineage-aware, null = "truly absent")
 *
 * Use loadOrFold when the slot's value DRIVES a decision and the
 * caller would be wrong to silently treat a history-cache miss as
 * absence. Inherited beings, inherited spaces, ancestor walks for
 * auth or scope, parent-existence checks before stamping a child .
 * all of these need to see the history's effective view, which
 * includes everything in the lineage up to the branch point. Null
 * here means "the aggregate truly doesn't exist anywhere I can reach
 * from this history."
 *
 * Cost: one Mongo lookup on cache hit (fast). On miss: one lineage
 * walk + reel replay + slot write (slow once, then cached forever).
 * Histories inherit parent state automatically through this path .
 * the first lookup pays the walk; every subsequent lookup is fast.
 *
 * RULE OF THUMB
 *   . null should mean "doesn't exist anywhere"      → loadOrFold
 *   . null should mean "my immediately preceding
 *     write didn't land"                              → loadProjection
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} [history="0"]
 */
export async function loadOrFold(type, id, history) {
  assertHistory(history);
  // Heaven routing: spaces in heaven live only on MAIN. Rewrite to
  // MAIN before the cold-fold so the fold engine reads/writes the
  // canonical heaven slot.
  let effectiveHistory = history;
  if (type === "space" && history !== "0") {
    const { isHeavenSpace } = await import("./space/heavenLineage.js");
    if (await isHeavenSpace(id)) effectiveHistory = "0";
  }
  const existing = await loadProjection(type, id, effectiveHistory);
  if (existing) return existing;
  // Cold-fold via the engine. fold writes to the history slot via
  // initProjection on the way out; the next loadProjection hits cache.
  try {
    const { fold } = await import("../present/stamper/2-fold/foldEngine.js");
    const { state, foldedSeq } = await fold(type, id, { history: effectiveHistory });
    if (!state || Object.keys(state).length === 0) return null;
    // Re-read the slot — fold's initProjection landed the canonical
    // shape (with `position` lifted to the slot level for indexing).
    return await loadProjection(type, id, effectiveHistory);
  } catch (err) {
    // Surface the failure. The empty catch that used to live here
    // hid every cold-fold issue (missing reel facts, history lineage
    // walk errors, reducer throws) as "slot returned null" with no
    // signal to anyone investigating. callers that legitimately
    // expect null (a never-touched aggregate) still see null — the
    // log just makes the "fold threw" case visible.
    const { default: log } = await import("../seedStory/log.js");
    log.warn(
      "Projections",
      `loadOrFold(${type}, ${String(id).slice(0, 8)}, ${effectiveHistory}) ` +
        `cold-fold failed: ${err.message}`,
    );
    return null;
  }
}

/**
 * Conditional advance of an existing slot. Returns false when
 * `expectedFoldedSeq` doesn't match (someone else advanced first; the
 * next fold catches up). The slot MUST already exist — use
 * initProjection to land a cold-fold's first write.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} history
 * @param {{state, foldedSeq, position}} next
 * @param {number|null} expectedFoldedSeq
 * @returns {Promise<boolean>}
 */
export async function saveProjection(type, id, history, next, expectedFoldedSeq) {
  if (!id) return false;
  assertType(type);
  assertHistory(history);
  const { state = {}, foldedSeq, position } = next;
  if (typeof foldedSeq !== "number") {
    throw new Error("saveProjection: next.foldedSeq must be a number");
  }
  const _id = projectionKey(history, type, id);
  const guard = expectedFoldedSeq == null
    ? { $or: [{ foldedSeq: null }, { foldedSeq: { $exists: false } }] }
    : { foldedSeq: expectedFoldedSeq };
  const r = await Projection.updateOne(
    { _id, ...guard },
    { $set: { state, foldedSeq, position: position ?? null } },
  );
  return r.matchedCount > 0;
}

/**
 * Insert-or-overwrite a slot. Used by the cold-fold landing path where
 * the slot may not yet exist. Unconditional — the reducer's output is
 * authoritative, the slot IS that output.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} history
 * @param {{state, foldedSeq, position}} next
 * @returns {Promise<void>}
 */
export async function initProjection(type, id, history, next) {
  if (!id) throw new Error("initProjection: id is required");
  assertType(type);
  assertHistory(history);
  if (!next || typeof next !== "object") {
    throw new Error("initProjection: next object is required");
  }
  const { state = {}, foldedSeq, position } = next;
  if (typeof foldedSeq !== "number") {
    throw new Error("initProjection: next.foldedSeq must be a number");
  }
  const _id = projectionKey(history, type, id);
  await Projection.updateOne(
    { _id },
    {
      $set: {
        state,
        foldedSeq,
        position:   position ?? null,
        tombstoned: false,
      },
      $setOnInsert: { _id, history, type, id },
    },
    { upsert: true },
  );
}

/**
 * Mark an aggregate as released-in-history. Tombstoned slots are
 * filtered out of findByPosition / findByName / listByType / findByParent
 * but preserved by loadProjection so callers can render "gone here."
 *
 * Tombstones DO shadow parent-history projections during query: a being
 * tombstoned in #1 will not leak through from main when a #1 query
 * runs. Without the tombstone marker the lazy-inheritance rule would
 * resurrect it on every query.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} history
 * @param {number} atFoldedSeq
 * @param {object} [opts]
 * @param {object} [opts.state]  the terminal fold state to record alongside
 *        the tombstone. When the gone-state IS the truth (ended matter
 *        whose spaceId folded to DELETED), consumers should still read it
 *        from the slot — the tombstone is cache-control, not amnesia.
 *        Omitted: state is left as-is (release/death paths that only flag).
 * @returns {Promise<void>}
 */
export async function tombstoneProjection(type, id, history, atFoldedSeq, opts = {}) {
  if (!id) throw new Error("tombstoneProjection: id is required");
  assertType(type);
  assertHistory(history);
  if (typeof atFoldedSeq !== "number") {
    throw new Error("tombstoneProjection: atFoldedSeq must be a number");
  }
  const _id = projectionKey(history, type, id);
  const set = {
    tombstoned: true,
    foldedSeq:  atFoldedSeq,
    position:   null,
  };
  if (opts.state && typeof opts.state === "object") set.state = opts.state;
  await Projection.updateOne(
    { _id },
    {
      $set: set,
      $setOnInsert: { _id, history, type, id, ...(opts.state ? {} : { state: {} }) },
    },
    { upsert: true },
  );
}

// ─────────────────────────────────────────────────────────────────────
// History-aware queries with shadow + tombstone semantics.
//
// The pattern in every non-main query: union main's contributions
// (filtered by ids the history has TOUCHED — modified or tombstoned)
// with the history's own slots. This is how lazy inheritance manifests
// at the query layer: untouched-in-history aggregates show through from
// main; touched-in-history ones are shadowed by history's slot.
// ─────────────────────────────────────────────────────────────────────

/**
 * Find aggregates positioned at a space in the given history. Returns
 * [{ type, id, foldedSeq, position }].
 *
 * @param {string} spaceId
 * @param {string} [history="0"]
 */
export async function findByPosition(spaceId, history) {
  if (!spaceId) return [];
  assertHistory(history);
  if (history === MAIN) {
    const rows = await Projection.find({
      history: MAIN, position: spaceId, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean();
    return rows.map(toOccupant);
  }
  // Non-main: union with shadowing AND branchPoint filtering. A main
  // aggregate at this position is only visible in `history` if it
  // existed at branch creation (has a branchPoint entry for its reel).
  // Without this filter, aggregates created in main AFTER the history
  // would leak into the history's view of this space.
  const { getBranchPoint } = await import("./history/histories.js");
  const [historyHere, mainOccupants, historyTouched] = await Promise.all([
    Projection.find({
      history, position: spaceId, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean(),
    findByPosition(spaceId, MAIN),
    Projection.find({ history }).select("type id").lean(),
  ]);
  const shadowedKey = (t, i) => `${t}:${i}`;
  const shadowed = new Set(historyTouched.map((s) => shadowedKey(s.type, s.id)));
  // Filter main candidates: (1) not shadowed, (2) existed at branchPoint.
  const mainVisible = [];
  for (const o of mainOccupants) {
    if (shadowed.has(shadowedKey(o.type, o.id))) continue;
    const bp = await getBranchPoint(history, o.type, o.id);
    if (bp && bp > 0) mainVisible.push(o);
  }
  return [...mainVisible, ...historyHere.map(toOccupant)];
}

/**
 * Find an aggregate by name in the given history. Name uniqueness is
 * per-history (unique partial index excludes tombstoned slots).
 *
 * Lazy inheritance: if no history slot matches by name, walks the
 * parent chain (recursively, so nested histories see their full
 * lineage). An inherited match is visible only when the aggregate
 * predates this history's fork AND this history has no divergent slot
 * for it (a rename or tombstone here shadows the inherited name).
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} name
 * @param {string} [history="0"]
 * @returns {Promise<{state, foldedSeq, position, type, id, history}|null>}
 */
export async function findByName(type, name, history) {
  assertType(type);
  assertHistory(history);
  if (!name) return null;
  // History-local match first (works for main too — main IS just-another-history).
  const historySlot = await Projection.findOne({
    history, type, "state.name": name, tombstoned: { $ne: true },
  }).lean();
  if (historySlot) {
    return {
      state:     historySlot.state || {},
      foldedSeq: historySlot.foldedSeq ?? null,
      position:  historySlot.position ?? null,
      type:      historySlot.type,
      id:        historySlot.id,
      history:   historySlot.history,
    };
  }
  if (history === MAIN) return null;
  // Lazy fall-through to the PARENT history, recursing to main —
  // nested histories (#1a1) inherit names through their full lineage,
  // not by jumping straight to main. Each unwind step gates
  // visibility:
  //   • branchPoint: the aggregate must have existed when THIS history
  //     forked; named on the ancestor after the fork → invisible here.
  //   • divergence shadow: ANY history-local slot for that id means
  //     this history's own view of the aggregate is authoritative
  //     (rename, tombstone, divergent fold) — and since the
  //     history-local name query above didn't match it, the inherited
  //     name doesn't resolve here.
  const { getBranchPoint, loadHistory } = await import("./history/histories.js");
  const historyRow = await loadHistory(history);
  const parentPath = historyRow?.parent || MAIN;
  const inherited = await findByName(type, name, parentPath);
  if (!inherited) return null;
  const bp = await getBranchPoint(history, type, inherited.id);
  if (!bp || bp <= 0) return null;
  const touched = await Projection.findOne({
    history, type, id: inherited.id,
  }).select("_id").lean();
  if (touched) return null;
  return inherited;
}

/**
 * Find children of a being (by parentBeingId) in the given history.
 * Used by being-lineage queries (descriptor's being-children).
 *
 * Lazy inheritance walks the parent chain recursively (same model as
 * findByName), so nested histories (#1a1) see their full lineage. At
 * each level: an inherited child is visible only when it predates
 * this history's fork (branchPoint gate) and this history holds no
 * divergent slot for it (a local slot of any kind shadows the
 * inherited row — the history's own view is authoritative).
 *
 * @param {string} beingId
 * @param {string} [history="0"]
 */
export async function findByParent(beingId, history) {
  if (!beingId) return [];
  assertHistory(history);
  if (history === MAIN) {
    const rows = await Projection.find({
      history: MAIN, type: "being",
      "state.parentBeingId": beingId,
      tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean();
    return rows.map(toOccupant);
  }
  const { getBranchPoint, loadHistory } = await import("./history/histories.js");
  const historyRow = await loadHistory(history);
  const parentPath = historyRow?.parent || MAIN;
  const [historyChildren, inheritedChildren, historyTouched] = await Promise.all([
    Projection.find({
      history, type: "being",
      "state.parentBeingId": beingId,
      tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean(),
    findByParent(beingId, parentPath),
    Projection.find({ history, type: "being" }).select("id").lean(),
  ]);
  const shadowed = new Set(historyTouched.map((s) => s.id));
  const inheritedVisible = [];
  for (const o of inheritedChildren) {
    if (shadowed.has(o.id)) continue;
    const bp = await getBranchPoint(history, "being", o.id);
    if (bp && bp > 0) inheritedVisible.push(o);
  }
  return [...inheritedVisible, ...historyChildren.map(toOccupant)];
}

/**
 * List every aggregate of a type in the given history. Powers
 * .beings / .spaces / .matters catalog SEEs.
 *
 * Lazy inheritance walks the parent chain recursively (same model as
 * findByName / findByParent), so nested histories see their full
 * lineage with per-level branchPoint gating and divergence shadowing.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} [history="0"]
 */
export async function listByType(type, history) {
  assertType(type);
  assertHistory(history);
  if (history === MAIN) {
    const rows = await Projection.find({
      history: MAIN, type, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean();
    return rows.map(toOccupant);
  }
  const { getBranchPoint, loadHistory } = await import("./history/histories.js");
  const historyRow = await loadHistory(history);
  const parentPath = historyRow?.parent || MAIN;
  const [historySlots, inheritedAll, historyTouched] = await Promise.all([
    Projection.find({
      history, type, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean(),
    listByType(type, parentPath),
    Projection.find({ history, type }).select("id").lean(),
  ]);
  const shadowed = new Set(historyTouched.map((s) => s.id));
  const inheritedVisible = [];
  for (const o of inheritedAll) {
    if (shadowed.has(o.id)) continue;
    const bp = await getBranchPoint(history, type, o.id);
    if (bp && bp > 0) inheritedVisible.push(o);
  }
  return [...inheritedVisible, ...historySlots.map(toOccupant)];
}

/**
 * Find root-of-the-tree aggregates: beings with no parentBeingId,
 * spaces with no parent, matter with no... well, matter is always at
 * a space, so this only meaningfully applies to beings + spaces.
 *
 * @param {"being"|"space"} type
 * @param {string} [history="0"]
 * @returns {Promise<Array<{type, id, foldedSeq, position}>>}
 */
export async function findRoot(type, history) {
  assertType(type);
  assertHistory(history);
  const parentField = type === "being" ? "state.parentBeingId" : "state.parent";
  const where = {
    history, type,
    tombstoned: { $ne: true },
    $or: [
      { [parentField]: null },
      { [parentField]: { $exists: false } },
    ],
  };
  const rows = await Projection.find(where).select("type id foldedSeq position").lean();
  return rows.map(toOccupant);
}

/**
 * Find aggregates whose name matches a regex pattern. Used by the
 * case-insensitive name lookup callers (auth flows).
 *
 * @param {"being"|"space"|"matter"} type
 * @param {RegExp|string} pattern
 * @param {string} [history="0"]
 * @returns {Promise<Array<{state, foldedSeq, position, type, id}>>}
 */
export async function findByNamePattern(type, pattern, history) {
  assertType(type);
  assertHistory(history);
  if (!pattern) return [];
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const rows = await Projection.find({
    history, type,
    "state.name": { $regex: re.source, $options: re.flags },
    tombstoned: { $ne: true },
  }).lean();
  return rows.map((slot) => ({
    state:     slot.state || {},
    foldedSeq: slot.foldedSeq ?? null,
    position:  slot.position ?? null,
    type:      slot.type,
    id:        slot.id,
    history:   slot.history,
  }));
}

/**
 * List the names of matter in one FOLDER — the (space, parent-matter)
 * pair that scopes matter-name uniqueness. Optionally filtered to names
 * matching a regex (used by the generated-name floor to find the next
 * free `<type><n>`). History-local: matter uniqueness keys on history, so
 * inherited matter in a parent history never collides with a fresh slot
 * here. parentMatterId null means top-level matter directly under the
 * space.
 *
 * @param {string} history
 * @param {string} spaceId
 * @param {string|null} parentMatterId
 * @param {RegExp} [pattern]
 * @returns {Promise<string[]>}
 */
export async function listMatterNamesInFolder(history, spaceId, parentMatterId, pattern) {
  assertHistory(history);
  if (!spaceId) return [];
  const where = {
    history, type: "matter",
    "state.spaceId": String(spaceId),
    "state.parentMatterId": parentMatterId ? String(parentMatterId) : null,
    tombstoned: { $ne: true },
  };
  if (pattern instanceof RegExp) {
    where["state.name"] = { $regex: pattern.source, $options: pattern.flags };
  }
  const rows = await Projection.find(where).select("state.name").lean();
  return rows.map((r) => r.state?.name).filter((n) => typeof n === "string");
}

/**
 * Count aggregates of a type in a history.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} [history="0"]
 * @returns {Promise<number>}
 */
export async function countByType(type, history) {
  assertType(type);
  assertHistory(history);
  return await Projection.countDocuments({
    history, type, tombstoned: { $ne: true },
  });
}

/**
 * Count beings whose parentBeingId matches the given being id.
 *
 * @param {string} beingId
 * @param {string} [history="0"]
 * @returns {Promise<number>}
 */
export async function countByParent(beingId, history) {
  if (!beingId) return 0;
  assertHistory(history);
  return await Projection.countDocuments({
    history, type: "being",
    "state.parentBeingId": beingId,
    tombstoned: { $ne: true },
  });
}

/**
 * Batch-load multiple projection slots. Returns a Map keyed by id;
 * missing entries are absent from the map (callers handle via map.get).
 *
 * @param {"being"|"space"|"matter"} type
 * @param {Array<string>} ids
 * @param {string} [history="0"]
 * @returns {Promise<Map<string, {state, foldedSeq, position, tombstoned, type, id, history}>>}
 */
export async function loadProjections(type, ids, history) {
  assertType(type);
  assertHistory(history);
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const keys = ids.map((id) => projectionKey(history, type, id));
  const rows = await Projection.find({ _id: { $in: keys } }).lean();
  const out = new Map();
  for (const slot of rows) {
    out.set(slot.id, {
      state:      slot.state || {},
      foldedSeq:  slot.foldedSeq ?? null,
      position:   slot.position ?? null,
      tombstoned: !!slot.tombstoned,
      type:       slot.type,
      id:         slot.id,
      history:    slot.history,
    });
  }
  return out;
}

/**
 * Find the space whose `heavenSpace` marker matches the given kind. Used
 * by the migrations runner and seed-space lookups (.config, .threads,
 * heaven, etc.). Seed-space markers are singletons within a history.
 *
 * @param {string} heavenSpaceKind  e.g. "config", "heaven", "threads"
 * @param {string} [history="0"]
 * @returns {Promise<{state, foldedSeq, position, type, id}|null>}
 */
export async function findByHeavenSpace(heavenSpaceKind, history) {
  if (!heavenSpaceKind) return null;
  assertHistory(history);
  const slot = await Projection.findOne({
    history, type: "space",
    "state.heavenSpace": heavenSpaceKind,
    tombstoned: { $ne: true },
  }).lean();
  if (!slot) return null;
  return {
    state:     slot.state || {},
    foldedSeq: slot.foldedSeq ?? null,
    position:  slot.position ?? null,
    type:      slot.type,
    id:        slot.id,
    history:   slot.history,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Heaven-scoped wrappers . explicit-intent helpers for reads that
// the caller KNOWS are story-level (not per-history). All forward to
// the history-required helpers with history="0".
//
// The substrate's projection layer also auto-routes heaven targets
// to MAIN regardless of caller's history (via isHeavenSpace), so
// per-history callers that incidentally touch a heaven space don't
// have to know to use these wrappers. They exist for readability at
// the call site when the intent is unambiguously heaven.
// ─────────────────────────────────────────────────────────────────────

/**
 * Read a heaven-scoped being or space by name. Same as findByName but
 * locked to MAIN. Used by callers that need a story-level lookup
 * regardless of which history they're acting on (e.g., the pointer
 * registry reader).
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} name
 */
export async function findInHeaven(type, name) {
  return await findByName(type, name, "0");
}

/**
 * Read a heaven seed-space entry by kind. Same as findByHeavenSpace
 * but locked to MAIN.
 */
export async function findHeavenSpace(heavenSpaceKind) {
  return await findByHeavenSpace(heavenSpaceKind, "0");
}

/**
 * Load a heaven projection by (type, id). Same as loadProjection
 * but locked to MAIN.
 */
export async function loadHeavenProjection(type, id) {
  return await loadProjection(type, id, "0");
}

/**
 * Story's root operator — the first non-system being admitted
 * through cherub. Encapsulates the doctrine (parent-must-be-I_AM-or-
 * cherub + name-not-in-system-set + earliest-by-createdAt) so callers
 * can't drift from it.
 *
 * @param {Array<string>} systemNames  set of seed system being names
 * @param {string} [history="0"]
 * @returns {Promise<{id, name}|null>}
 */
export async function findRootOperator(systemNames, history) {
  assertHistory(history);
  // First find cherub's id (registered through findByName); main+history.
  const cherubSlot = await findByName("being", "cherub", history);
  const allowedParents = ["i-am"];
  if (cherubSlot) allowedParents.push(cherubSlot.id);
  const row = await Projection.findOne({
    history, type: "being",
    "state.name": { $type: "string", $nin: systemNames },
    "state.parentBeingId": { $in: allowedParents },
    tombstoned: { $ne: true },
  })
    .sort({ "state.createdAt": 1, _id: 1 })
    .select("id state.name")
    .lean();
  return row ? { _id: row.id, name: row.state?.name } : null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function toOccupant(s) {
  return {
    type: s.type,
    id: s.id,
    foldedSeq: s.foldedSeq ?? null,
    position: s.position ?? null,
  };
}
