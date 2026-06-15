// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Projections — the cache the fold writes to and the engine reads from.
//
// Doctrine (locked with Tabor 2026-06-03):
//   1. Main is just-another-branch with no parent. Branch is a
//      first-class dimension of every projection lookup.
//   2. Names are per-branch identifiers; identity is `_id`. IBP
//      `#<branch>` disambiguates.
//   3. Branches inherit parent state lazily. Modifications shadow main
//      for in-branch queries.
//   4. Reducers are branch-blind. The substrate handles branch routing
//      around them.
//
// Storage: a single `projections` collection
// ([seed/materials/branch/projection.js](branch/projection.js)) holds
// every cache slot keyed `<branch>:<type>:<id>`. Main (branch="0") is
// not special-cased — its slots live alongside every other branch's.
//
// No legacy compatibility paths. Callers that still read directly from
// Being / Space / Matter rows for projection data are now broken until
// swept onto this API (Phase 3). That is intentional: silent dual-shape
// fallbacks rot the architecture; loud breaks at the boundary are how
// the sweep gets finished.

import Projection, { projectionKey } from "./branch/projection.js";

const MAIN = "0";
const VALID_TYPES = new Set(["being", "space", "matter", "name"]);

function assertType(type) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`projections: unknown type "${type}" (expected being|space|matter|name)`);
  }
}

// Doctrine (locked with Tabor 2026-06-04): branch is a required argument
// on every projection API. Internal callers MUST thread it explicitly.
// Silent defaults to main were the failure mode — a caller forgot to
// pass branch, the lookup landed on the wrong slot, and the user saw a
// "ghost" state with no error. The IBP parser is the only layer
// allowed to fill in absent branches (it resolves the wire-side default
// to "0" at expandStance); every other layer downstream of that
// resolution holds the value it was handed.
//
// `assertBranch` is the canonical check. It throws on any value that
// isn't a non-empty string, so a function called with `undefined`,
// `null`, or `""` fails loudly at the boundary instead of silently
// hitting main.
function assertBranch(branch) {
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      `projections: branch is required (got ${JSON.stringify(branch)}). ` +
      `Internal callers must thread branch from the moment's summonCtx or the wire layer.`,
    );
  }
}

// Exported variant for use at substrate consumer boundaries (assign,
// fold, stamped, intake, inbox, scheduler, matters). Same shape as the
// projection-local check; callers use it at function entry so a missing
// branch surfaces at THEIR site rather than masquerading as a projection
// lookup error one stack frame deeper. The doctrinal commitment is that
// every interior consumer trusts the perimeter has attached branch and
// fails loud if not — no silent default to "0" / heaven.
export function assertBranchOrThrow(branch, callerName) {
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      `${callerName || "substrate consumer"}: branch is required ` +
      `(got ${JSON.stringify(branch)}). The wire layer / enclosing moment ` +
      `must thread branch through; this consumer no longer silently defaults to heaven.`,
    );
  }
  return branch;
}

// ─────────────────────────────────────────────────────────────────────
// Read / write a single slot
// ─────────────────────────────────────────────────────────────────────

/**
 * Read a projection slot in a branch. Returns null when the slot has
 * never been initialized (the aggregate has never been touched in this
 * branch's lineage), or a slot object — including tombstoned slots
 * (state-less, marker only). Callers handle tombstones explicitly.
 *
 * Lazy inheritance from parent branches is NOT done here. This function
 * is a single-slot read; the fold engine's cold-fold path walks the
 * lineage when the slot is missing, calls back through initProjection,
 * and subsequent reads land on the populated slot.
 *
 * DOCTRINE (read-back, branch-anchored, null = "write didn't land")
 *
 * Use loadProjection when you JUST stamped a fact and you're confirming
 * the slot materialized. Null is a write-failure signal . the seal
 * didn't reach the slot. Branch-anchored: queries only the named
 * branch's slot table, no lineage walk. The two canonical uses:
 *
 *   - Post-seal read-back ("I just stamped birth; is the row there?")
 *   - Doctrinal singletons hardcoded to main ("0") . I_AM, the
 *     `./config` cache, boot-time orphan-root walks. These rows live
 *     in main by construction; reading from a branch makes no sense.
 *
 * Behavioral reads ("does this being exist anywhere I should care
 * about?", "what is this space's size?") need loadOrFold instead .
 * see its doc block.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} [branch="0"]
 * @returns {Promise<{state, foldedSeq, position, tombstoned, type, id, branch}|null>}
 */
export async function loadProjection(type, id, branch) {
  if (!id) return null;
  assertType(type);
  assertBranch(branch);
  // Heaven routing: spaces in heaven have one projection per reality,
  // not per branch. If the caller passed a non-MAIN branch for a
  // heaven space, transparently rewrite to MAIN so the read returns
  // the single canonical row. The classifier is async (walks ancestor
  // cache), so guard on type=space to avoid cost on every being/matter
  // load.
  let effectiveBranch = branch;
  if (type === "space" && branch !== "0") {
    const { isHeavenSpace } = await import("./space/heavenLineage.js");
    if (await isHeavenSpace(id)) effectiveBranch = "0";
  }
  const slot = await Projection.findById(projectionKey(effectiveBranch, type, id)).lean();
  if (!slot) return null;
  return {
    state:      slot.state || {},
    foldedSeq:  slot.foldedSeq ?? null,
    position:   slot.position ?? null,
    tombstoned: !!slot.tombstoned,
    type:       slot.type,
    id:         slot.id,
    branch:     slot.branch,
  };
}

/**
 * Lazy cold-fold load. When the branch has no slot for this aggregate,
 * triggers a fold() against the branch's lineage. fold() walks
 * `readReelBetween(type, id, null, null, branch)` — lineage-aware,
 * branch-point-respecting — and either populates the slot or returns
 * null (the aggregate truly doesn't exist in this branch, e.g. created
 * in main AFTER branch point).
 *
 * DOCTRINE (behavioral, lineage-aware, null = "truly absent")
 *
 * Use loadOrFold when the slot's value DRIVES a decision and the
 * caller would be wrong to silently treat a branch-cache miss as
 * absence. Inherited beings, inherited spaces, ancestor walks for
 * auth or scope, parent-existence checks before stamping a child .
 * all of these need to see the branch's effective view, which
 * includes everything in the lineage up to the branch point. Null
 * here means "the aggregate truly doesn't exist anywhere I can reach
 * from this branch."
 *
 * Cost: one Mongo lookup on cache hit (fast). On miss: one lineage
 * walk + reel replay + slot write (slow once, then cached forever).
 * Branches inherit parent state automatically through this path .
 * the first lookup pays the walk; every subsequent lookup is fast.
 *
 * RULE OF THUMB
 *   . null should mean "doesn't exist anywhere"      → loadOrFold
 *   . null should mean "my immediately preceding
 *     write didn't land"                              → loadProjection
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} [branch="0"]
 */
export async function loadOrFold(type, id, branch) {
  assertBranch(branch);
  // Heaven routing: spaces in heaven live only on MAIN. Rewrite to
  // MAIN before the cold-fold so the fold engine reads/writes the
  // canonical heaven slot.
  let effectiveBranch = branch;
  if (type === "space" && branch !== "0") {
    const { isHeavenSpace } = await import("./space/heavenLineage.js");
    if (await isHeavenSpace(id)) effectiveBranch = "0";
  }
  const existing = await loadProjection(type, id, effectiveBranch);
  if (existing) return existing;
  // Cold-fold via the engine. fold writes to the branch slot via
  // initProjection on the way out; the next loadProjection hits cache.
  try {
    const { fold } = await import("../present/beats/2-fold/foldEngine.js");
    const { state, foldedSeq } = await fold(type, id, { branch: effectiveBranch });
    if (!state || Object.keys(state).length === 0) return null;
    // Re-read the slot — fold's initProjection landed the canonical
    // shape (with `position` lifted to the slot level for indexing).
    return await loadProjection(type, id, effectiveBranch);
  } catch (err) {
    // Surface the failure. The empty catch that used to live here
    // hid every cold-fold issue (missing reel facts, branch lineage
    // walk errors, reducer throws) as "slot returned null" with no
    // signal to anyone investigating. callers that legitimately
    // expect null (a never-touched aggregate) still see null — the
    // log just makes the "fold threw" case visible.
    const { default: log } = await import("../seedReality/log.js");
    log.warn(
      "Projections",
      `loadOrFold(${type}, ${String(id).slice(0, 8)}, ${effectiveBranch}) ` +
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
 * @param {string} branch
 * @param {{state, foldedSeq, position}} next
 * @param {number|null} expectedFoldedSeq
 * @returns {Promise<boolean>}
 */
export async function saveProjection(type, id, branch, next, expectedFoldedSeq) {
  if (!id) return false;
  assertType(type);
  assertBranch(branch);
  const { state = {}, foldedSeq, position } = next;
  if (typeof foldedSeq !== "number") {
    throw new Error("saveProjection: next.foldedSeq must be a number");
  }
  const _id = projectionKey(branch, type, id);
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
 * @param {string} branch
 * @param {{state, foldedSeq, position}} next
 * @returns {Promise<void>}
 */
export async function initProjection(type, id, branch, next) {
  if (!id) throw new Error("initProjection: id is required");
  assertType(type);
  assertBranch(branch);
  if (!next || typeof next !== "object") {
    throw new Error("initProjection: next object is required");
  }
  const { state = {}, foldedSeq, position } = next;
  if (typeof foldedSeq !== "number") {
    throw new Error("initProjection: next.foldedSeq must be a number");
  }
  const _id = projectionKey(branch, type, id);
  await Projection.updateOne(
    { _id },
    {
      $set: {
        state,
        foldedSeq,
        position:   position ?? null,
        tombstoned: false,
      },
      $setOnInsert: { _id, branch, type, id },
    },
    { upsert: true },
  );
}

/**
 * Mark an aggregate as released-in-branch. Tombstoned slots are
 * filtered out of findByPosition / findByName / listByType / findByParent
 * but preserved by loadProjection so callers can render "gone here."
 *
 * Tombstones DO shadow parent-branch projections during query: a being
 * tombstoned in #1 will not leak through from main when a #1 query
 * runs. Without the tombstone marker the lazy-inheritance rule would
 * resurrect it on every query.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {string} branch
 * @param {number} atFoldedSeq
 * @param {object} [opts]
 * @param {object} [opts.state]  the terminal fold state to record alongside
 *        the tombstone. When the gone-state IS the truth (ended matter
 *        whose spaceId folded to DELETED), consumers should still read it
 *        from the slot — the tombstone is cache-control, not amnesia.
 *        Omitted: state is left as-is (release/death paths that only flag).
 * @returns {Promise<void>}
 */
export async function tombstoneProjection(type, id, branch, atFoldedSeq, opts = {}) {
  if (!id) throw new Error("tombstoneProjection: id is required");
  assertType(type);
  assertBranch(branch);
  if (typeof atFoldedSeq !== "number") {
    throw new Error("tombstoneProjection: atFoldedSeq must be a number");
  }
  const _id = projectionKey(branch, type, id);
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
      $setOnInsert: { _id, branch, type, id, ...(opts.state ? {} : { state: {} }) },
    },
    { upsert: true },
  );
}

// ─────────────────────────────────────────────────────────────────────
// Branch-aware queries with shadow + tombstone semantics.
//
// The pattern in every non-main query: union main's contributions
// (filtered by ids the branch has TOUCHED — modified or tombstoned)
// with the branch's own slots. This is how lazy inheritance manifests
// at the query layer: untouched-in-branch aggregates show through from
// main; touched-in-branch ones are shadowed by branch's slot.
// ─────────────────────────────────────────────────────────────────────

/**
 * Find aggregates positioned at a space in the given branch. Returns
 * [{ type, id, foldedSeq, position }].
 *
 * @param {string} spaceId
 * @param {string} [branch="0"]
 */
export async function findByPosition(spaceId, branch) {
  if (!spaceId) return [];
  assertBranch(branch);
  if (branch === MAIN) {
    const rows = await Projection.find({
      branch: MAIN, position: spaceId, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean();
    return rows.map(toOccupant);
  }
  // Non-main: union with shadowing AND branchPoint filtering. A main
  // aggregate at this position is only visible in `branch` if it
  // existed at branch creation (has a branchPoint entry for its reel).
  // Without this filter, aggregates created in main AFTER the branch
  // would leak into the branch's view of this space.
  const { getBranchPoint } = await import("./branch/branches.js");
  const [branchHere, mainOccupants, branchTouched] = await Promise.all([
    Projection.find({
      branch, position: spaceId, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean(),
    findByPosition(spaceId, MAIN),
    Projection.find({ branch }).select("type id").lean(),
  ]);
  const shadowedKey = (t, i) => `${t}:${i}`;
  const shadowed = new Set(branchTouched.map((s) => shadowedKey(s.type, s.id)));
  // Filter main candidates: (1) not shadowed, (2) existed at branchPoint.
  const mainVisible = [];
  for (const o of mainOccupants) {
    if (shadowed.has(shadowedKey(o.type, o.id))) continue;
    const bp = await getBranchPoint(branch, o.type, o.id);
    if (bp && bp > 0) mainVisible.push(o);
  }
  return [...mainVisible, ...branchHere.map(toOccupant)];
}

/**
 * Find an aggregate by name in the given branch. Name uniqueness is
 * per-branch (unique partial index excludes tombstoned slots).
 *
 * Lazy inheritance: if no branch slot matches by name, walks the
 * parent chain (recursively, so nested branches see their full
 * lineage). An inherited match is visible only when the aggregate
 * predates this branch's fork AND this branch has no divergent slot
 * for it (a rename or tombstone here shadows the inherited name).
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} name
 * @param {string} [branch="0"]
 * @returns {Promise<{state, foldedSeq, position, type, id, branch}|null>}
 */
export async function findByName(type, name, branch) {
  assertType(type);
  assertBranch(branch);
  if (!name) return null;
  // Branch-local match first (works for main too — main IS just-another-branch).
  const branchSlot = await Projection.findOne({
    branch, type, "state.name": name, tombstoned: { $ne: true },
  }).lean();
  if (branchSlot) {
    return {
      state:     branchSlot.state || {},
      foldedSeq: branchSlot.foldedSeq ?? null,
      position:  branchSlot.position ?? null,
      type:      branchSlot.type,
      id:        branchSlot.id,
      branch:    branchSlot.branch,
    };
  }
  if (branch === MAIN) return null;
  // Lazy fall-through to the PARENT branch, recursing to main —
  // nested branches (#1a1) inherit names through their full lineage,
  // not by jumping straight to main. Each unwind step gates
  // visibility:
  //   • branchPoint: the aggregate must have existed when THIS branch
  //     forked; named on the ancestor after the fork → invisible here.
  //   • divergence shadow: ANY branch-local slot for that id means
  //     this branch's own view of the aggregate is authoritative
  //     (rename, tombstone, divergent fold) — and since the
  //     branch-local name query above didn't match it, the inherited
  //     name doesn't resolve here.
  const { getBranchPoint, loadBranch } = await import("./branch/branches.js");
  const branchRow = await loadBranch(branch);
  const parentPath = branchRow?.parent || MAIN;
  const inherited = await findByName(type, name, parentPath);
  if (!inherited) return null;
  const bp = await getBranchPoint(branch, type, inherited.id);
  if (!bp || bp <= 0) return null;
  const touched = await Projection.findOne({
    branch, type, id: inherited.id,
  }).select("_id").lean();
  if (touched) return null;
  return inherited;
}

/**
 * Find children of a being (by parentBeingId) in the given branch.
 * Used by being-lineage queries (descriptor's being-children).
 *
 * Lazy inheritance walks the parent chain recursively (same model as
 * findByName), so nested branches (#1a1) see their full lineage. At
 * each level: an inherited child is visible only when it predates
 * this branch's fork (branchPoint gate) and this branch holds no
 * divergent slot for it (a local slot of any kind shadows the
 * inherited row — the branch's own view is authoritative).
 *
 * @param {string} beingId
 * @param {string} [branch="0"]
 */
export async function findByParent(beingId, branch) {
  if (!beingId) return [];
  assertBranch(branch);
  if (branch === MAIN) {
    const rows = await Projection.find({
      branch: MAIN, type: "being",
      "state.parentBeingId": beingId,
      tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean();
    return rows.map(toOccupant);
  }
  const { getBranchPoint, loadBranch } = await import("./branch/branches.js");
  const branchRow = await loadBranch(branch);
  const parentPath = branchRow?.parent || MAIN;
  const [branchChildren, inheritedChildren, branchTouched] = await Promise.all([
    Projection.find({
      branch, type: "being",
      "state.parentBeingId": beingId,
      tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean(),
    findByParent(beingId, parentPath),
    Projection.find({ branch, type: "being" }).select("id").lean(),
  ]);
  const shadowed = new Set(branchTouched.map((s) => s.id));
  const inheritedVisible = [];
  for (const o of inheritedChildren) {
    if (shadowed.has(o.id)) continue;
    const bp = await getBranchPoint(branch, "being", o.id);
    if (bp && bp > 0) inheritedVisible.push(o);
  }
  return [...inheritedVisible, ...branchChildren.map(toOccupant)];
}

/**
 * List every aggregate of a type in the given branch. Powers
 * .beings / .spaces / .matters catalog SEEs.
 *
 * Lazy inheritance walks the parent chain recursively (same model as
 * findByName / findByParent), so nested branches see their full
 * lineage with per-level branchPoint gating and divergence shadowing.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} [branch="0"]
 */
export async function listByType(type, branch) {
  assertType(type);
  assertBranch(branch);
  if (branch === MAIN) {
    const rows = await Projection.find({
      branch: MAIN, type, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean();
    return rows.map(toOccupant);
  }
  const { getBranchPoint, loadBranch } = await import("./branch/branches.js");
  const branchRow = await loadBranch(branch);
  const parentPath = branchRow?.parent || MAIN;
  const [branchSlots, inheritedAll, branchTouched] = await Promise.all([
    Projection.find({
      branch, type, tombstoned: { $ne: true },
    }).select("type id foldedSeq position").lean(),
    listByType(type, parentPath),
    Projection.find({ branch, type }).select("id").lean(),
  ]);
  const shadowed = new Set(branchTouched.map((s) => s.id));
  const inheritedVisible = [];
  for (const o of inheritedAll) {
    if (shadowed.has(o.id)) continue;
    const bp = await getBranchPoint(branch, type, o.id);
    if (bp && bp > 0) inheritedVisible.push(o);
  }
  return [...inheritedVisible, ...branchSlots.map(toOccupant)];
}

/**
 * Find root-of-the-tree aggregates: beings with no parentBeingId,
 * spaces with no parent, matter with no... well, matter is always at
 * a space, so this only meaningfully applies to beings + spaces.
 *
 * @param {"being"|"space"} type
 * @param {string} [branch="0"]
 * @returns {Promise<Array<{type, id, foldedSeq, position}>>}
 */
export async function findRoot(type, branch) {
  assertType(type);
  assertBranch(branch);
  const parentField = type === "being" ? "state.parentBeingId" : "state.parent";
  const where = {
    branch, type,
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
 * @param {string} [branch="0"]
 * @returns {Promise<Array<{state, foldedSeq, position, type, id}>>}
 */
export async function findByNamePattern(type, pattern, branch) {
  assertType(type);
  assertBranch(branch);
  if (!pattern) return [];
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const rows = await Projection.find({
    branch, type,
    "state.name": { $regex: re.source, $options: re.flags },
    tombstoned: { $ne: true },
  }).lean();
  return rows.map((slot) => ({
    state:     slot.state || {},
    foldedSeq: slot.foldedSeq ?? null,
    position:  slot.position ?? null,
    type:      slot.type,
    id:        slot.id,
    branch:    slot.branch,
  }));
}

/**
 * List the names of matter in one FOLDER — the (space, parent-matter)
 * pair that scopes matter-name uniqueness. Optionally filtered to names
 * matching a regex (used by the generated-name floor to find the next
 * free `<type><n>`). Branch-local: matter uniqueness keys on branch, so
 * inherited matter in a parent branch never collides with a fresh slot
 * here. parentMatterId null means top-level matter directly under the
 * space.
 *
 * @param {string} branch
 * @param {string} spaceId
 * @param {string|null} parentMatterId
 * @param {RegExp} [pattern]
 * @returns {Promise<string[]>}
 */
export async function listMatterNamesInFolder(branch, spaceId, parentMatterId, pattern) {
  assertBranch(branch);
  if (!spaceId) return [];
  const where = {
    branch, type: "matter",
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
 * Count aggregates of a type in a branch.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} [branch="0"]
 * @returns {Promise<number>}
 */
export async function countByType(type, branch) {
  assertType(type);
  assertBranch(branch);
  return await Projection.countDocuments({
    branch, type, tombstoned: { $ne: true },
  });
}

/**
 * Count beings whose parentBeingId matches the given being id.
 *
 * @param {string} beingId
 * @param {string} [branch="0"]
 * @returns {Promise<number>}
 */
export async function countByParent(beingId, branch) {
  if (!beingId) return 0;
  assertBranch(branch);
  return await Projection.countDocuments({
    branch, type: "being",
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
 * @param {string} [branch="0"]
 * @returns {Promise<Map<string, {state, foldedSeq, position, tombstoned, type, id, branch}>>}
 */
export async function loadProjections(type, ids, branch) {
  assertType(type);
  assertBranch(branch);
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const keys = ids.map((id) => projectionKey(branch, type, id));
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
      branch:     slot.branch,
    });
  }
  return out;
}

/**
 * Find the space whose `heavenSpace` marker matches the given kind. Used
 * by the migrations runner and seed-space lookups (.config, .threads,
 * heaven, etc.). Seed-space markers are singletons within a branch.
 *
 * @param {string} heavenSpaceKind  e.g. "config", "heaven", "threads"
 * @param {string} [branch="0"]
 * @returns {Promise<{state, foldedSeq, position, type, id}|null>}
 */
export async function findByHeavenSpace(heavenSpaceKind, branch) {
  if (!heavenSpaceKind) return null;
  assertBranch(branch);
  const slot = await Projection.findOne({
    branch, type: "space",
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
    branch:    slot.branch,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Heaven-scoped wrappers . explicit-intent helpers for reads that
// the caller KNOWS are reality-level (not branched). All forward to
// the branch-required helpers with branch="0".
//
// The substrate's projection layer also auto-routes heaven targets
// to MAIN regardless of caller's branch (via isHeavenSpace), so
// branched callers that incidentally touch a heaven space don't
// have to know to use these wrappers. They exist for readability at
// the call site when the intent is unambiguously heaven.
// ─────────────────────────────────────────────────────────────────────

/**
 * Read a heaven-scoped being or space by name. Same as findByName but
 * locked to MAIN. Used by callers that need a reality-level lookup
 * regardless of which branch they're acting on (e.g., the pointer
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
 * Reality's root operator — the first non-system being admitted
 * through cherub. Encapsulates the doctrine (parent-must-be-I_AM-or-
 * cherub + name-not-in-system-set + earliest-by-createdAt) so callers
 * can't drift from it.
 *
 * @param {Array<string>} systemNames  set of seed system being names
 * @param {string} [branch="0"]
 * @returns {Promise<{id, name}|null>}
 */
export async function findRootOperator(systemNames, branch) {
  assertBranch(branch);
  // First find cherub's id (registered through findByName); main+branch.
  const cherubSlot = await findByName("being", "cherub", branch);
  const allowedParents = ["i-am"];
  if (cherubSlot) allowedParents.push(cherubSlot.id);
  const row = await Projection.findOne({
    branch, type: "being",
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
