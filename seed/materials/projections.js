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
// Storage: the append-only FileStore (past/fileStore.js). Each
// (history, type, id) has a `.proj` snapshot slot {state, foldedSeq,
// position, tombstoned} beside its reel, and a derived inverted INDEX
// (name / position / parent / type / heavenSpace) the find* queries read.
// The snapshot + index are a rebuildable CACHE over the reels (the truth);
// this file is the history-aware READ/WRITE facade over them. Main
// (history="0") is not special-cased — its slots are own-history slots
// like any other history's.
//
// This file owns the HISTORY-LINEAGE inheritance logic (the walk over
// parent histories with branchPoint gating + divergence shadowing). The
// FileStore find* layer is own-history only; the lazy parent walk lives
// HERE, calling back into FileStore per-history.

import {
  loadSnapshot,
  saveSnapshot,
  initSnapshot,
  findByName as storeFindByName,
  findByPosition as storeFindByPosition,
  findByParent as storeFindByParent,
  listByType as storeListByType,
  findByHeavenSpace as storeFindByHeavenSpace,
} from "../past/fileStore.js";

const MAIN = "0";
const VALID_TYPES = new Set(["being", "space", "matter", "name", "library"]);

function assertType(type) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(
      `projections: unknown type "${type}" (expected being|space|matter|name)`,
    );
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
// Slot ↔ return-shape mapping
//
// FileStore snapshots hold {state, foldedSeq, position, tombstoned} only.
// `type`, `id`, and `history` are the lookup COORDINATES (not stored in
// the slot), so we re-attach them when shaping a return value — the same
// shape the file-store-backed projection slot carries.
// ─────────────────────────────────────────────────────────────────────

function shapeSlot(slot, type, id, history) {
  if (!slot) return null;
  return {
    state: slot.state || {},
    foldedSeq: slot.foldedSeq ?? null,
    position: slot.position ?? null,
    tombstoned: !!slot.tombstoned,
    type,
    id,
    history,
  };
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
 *   - Doctrinal singletons hardcoded to main ("0") . I, the
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
  // Names have NO reel of their own (only Names act; a Name is never acted-on).
  // A Name's row folds into the library catalog (library.names[nameId]); a "name"
  // read redirects there, so every loadProjection("name", ...) caller keeps working
  // with the per-name reel retired.
  if (type === "name") return await loadNameSlot(id, history);
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
  const slot = loadSnapshot(effectiveHistory, type, id);
  return shapeSlot(slot, type, id, effectiveHistory);
}

// Name rows have no reel; they fold into the library catalog (library.names[nameId]).
// Fold the library forward (story-global, history "0") and return the name's entry
// shaped like a normal slot. Null when the name isn't in the catalog.
async function loadNameSlot(nameId, history) {
  const { getStoryDomain } = await import("../ibp/address.js");
  const { fold } = await import("../present/stamper/2-fold/foldEngine.js");
  const lib = await fold("library", getStoryDomain(), { history: "0" });
  const entry = lib?.state?.names?.[String(nameId)];
  if (!entry) return null;
  return {
    state: entry,
    foldedSeq: lib.foldedSeq ?? 0,
    position: undefined,
    tombstoned: false,
    type: "name",
    id: String(nameId),
    history,
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
 * Cost: one snapshot read on cache hit (fast). On miss: one lineage
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
    const { state, foldedSeq } = await fold(type, id, {
      history: effectiveHistory,
    });
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
export async function saveProjection(
  type,
  id,
  history,
  next,
  expectedFoldedSeq,
) {
  if (!id) return false;
  assertType(type);
  assertHistory(history);
  const { state = {}, foldedSeq, position } = next;
  if (typeof foldedSeq !== "number") {
    throw new Error("saveProjection: next.foldedSeq must be a number");
  }
  // CAS-guarded write. A null-guard (expected slot null/absent) maps to the
  // FileStore CAS: a never-folded slot has no on-disk snapshot, so an
  // expectedFoldedSeq of null/undefined must only land when there is no
  // existing slot. saveSnapshot's CAS compares the on-disk foldedSeq to
  // expectedFoldedSeq when it's a number; for the null guard we check
  // the slot is absent ourselves (single-writer commit mutex makes the
  // load→save sequence atomic).
  const slot = {
    state,
    foldedSeq,
    position: position ?? null,
    tombstoned: false,
  };
  if (expectedFoldedSeq == null) {
    const existing = loadSnapshot(history, type, id);
    if (existing && existing.foldedSeq != null) return false;
    return saveSnapshot(history, type, id, slot);
  }
  return saveSnapshot(history, type, id, slot, expectedFoldedSeq);
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
  initSnapshot(history, type, id, {
    state,
    foldedSeq,
    position: position ?? null,
    tombstoned: false,
  });
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
export async function tombstoneProjection(
  type,
  id,
  history,
  atFoldedSeq,
  opts = {},
) {
  if (!id) throw new Error("tombstoneProjection: id is required");
  assertType(type);
  assertHistory(history);
  if (typeof atFoldedSeq !== "number") {
    throw new Error("tombstoneProjection: atFoldedSeq must be a number");
  }
  // A tombstone is a saveSnapshot with tombstoned:true. Preserve the
  // existing state unless the caller hands a terminal state to record
  // (the gone-state-is-truth case). Unconditional (no CAS): the
  // tombstone is the authoritative close of the slot in this history.
  const existing = loadSnapshot(history, type, id);
  const state =
    opts.state && typeof opts.state === "object"
      ? opts.state
      : existing?.state || {};
  saveSnapshot(history, type, id, {
    state,
    foldedSeq: atFoldedSeq,
    position: null,
    tombstoned: true,
  });
}

// ─────────────────────────────────────────────────────────────────────
// History-aware queries with shadow + tombstone semantics.
//
// The pattern in every non-main query: union the parent lineage's
// contributions (filtered by branchPoint + shadowed where this history
// has its OWN slot for an id) with the history's own slots. This is how
// lazy inheritance manifests at the query layer: untouched-in-history
// aggregates show through from the parent; touched-in-history ones are
// shadowed by this history's slot.
//
// The own-history reads delegate to the FileStore index (storeFind*).
// The lineage walk + branchPoint gating + divergence shadowing live
// here. Shadowing checks each inherited candidate's own-history slot via
// loadSnapshot directly (a live OR tombstoned slot shadows), the same
// per-candidate model findByName uses.
// ─────────────────────────────────────────────────────────────────────

// True when `history` holds ANY own slot (live OR tombstoned) for this
// (type, id) — meaning this history's view of that aggregate is
// authoritative and an inherited row must NOT leak through.
function historyShadows(history, type, id) {
  return loadSnapshot(history, type, id) != null;
}

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
  const here = storeFindByPosition(history, spaceId).map(toOccupant);
  if (history === MAIN) return here;
  // Non-main: union with shadowing AND branchPoint filtering. A main
  // aggregate at this position is only visible in `history` if it
  // existed at branch creation (has a branchPoint entry for its reel).
  // Without this filter, aggregates created in main AFTER the history
  // would leak into the history's view of this space.
  const { getBranchPoint } = await import("./history/histories.js");
  const mainOccupants = await findByPosition(spaceId, MAIN);
  const mainVisible = [];
  for (const o of mainOccupants) {
    if (historyShadows(history, o.type, o.id)) continue;
    const bp = await getBranchPoint(history, o.type, o.id);
    if (bp && bp > 0) mainVisible.push(o);
  }
  return [...mainVisible, ...here];
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
  const historySlot = storeFindByName(history, type, name);
  if (historySlot) {
    return shapeSlot(historySlot, type, historySlot.id, history);
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
  const { getBranchPoint, loadHistory } =
    await import("./history/histories.js");
  const historyRow = await loadHistory(history);
  const parentPath = historyRow?.parent || MAIN;
  const inherited = await findByName(type, name, parentPath);
  if (!inherited) return null;
  const bp = await getBranchPoint(history, type, inherited.id);
  if (!bp || bp <= 0) return null;
  if (historyShadows(history, type, inherited.id)) return null;
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
  const here = storeFindByParent(history, beingId, "being").map(toOccupant);
  if (history === MAIN) return here;
  const { getBranchPoint, loadHistory } =
    await import("./history/histories.js");
  const historyRow = await loadHistory(history);
  const parentPath = historyRow?.parent || MAIN;
  const inheritedChildren = await findByParent(beingId, parentPath);
  const inheritedVisible = [];
  for (const o of inheritedChildren) {
    if (historyShadows(history, "being", o.id)) continue;
    const bp = await getBranchPoint(history, "being", o.id);
    if (bp && bp > 0) inheritedVisible.push(o);
  }
  return [...inheritedVisible, ...here];
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
  const here = storeListByType(history, type)
    .map((id) => slotOccupant(history, type, id))
    .filter(Boolean);
  if (history === MAIN) return here;
  const { getBranchPoint, loadHistory } =
    await import("./history/histories.js");
  const historyRow = await loadHistory(history);
  const parentPath = historyRow?.parent || MAIN;
  const inheritedAll = await listByType(type, parentPath);
  const inheritedVisible = [];
  for (const o of inheritedAll) {
    if (historyShadows(history, type, o.id)) continue;
    const bp = await getBranchPoint(history, type, o.id);
    if (bp && bp > 0) inheritedVisible.push(o);
  }
  return [...inheritedVisible, ...here];
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
  // Roots = aggregates the parent-index buckets under the null key (no
  // parentBeingId / no parent). The FileStore parent-index keys live
  // slots by their parent; the null bucket is the roots. Walk the
  // history's own live ids and keep those whose parent field is empty.
  const parentField = type === "being" ? "parentBeingId" : "parent";
  const out = [];
  for (const id of storeListByType(history, type)) {
    const slot = loadSnapshot(history, type, id);
    if (!slot || slot.tombstoned) continue;
    const parent = slot.state?.[parentField];
    if (parent == null) out.push(toOccupant(slotShape(slot, type, id)));
  }
  return out;
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
  // No regex facet in the inverted index: scan the kind's live ids and
  // filter by name. Own-history only — no lineage walk here.
  const out = [];
  for (const id of storeListByType(history, type)) {
    const slot = loadSnapshot(history, type, id);
    if (!slot || slot.tombstoned) continue;
    const name = slot.state?.name;
    if (typeof name === "string" && re.test(name)) {
      out.push(shapeSlot(slot, type, id, history));
    }
  }
  return out;
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
export async function listMatterNamesInFolder(
  history,
  spaceId,
  parentMatterId,
  pattern,
) {
  assertHistory(history);
  if (!spaceId) return [];
  const wantSpace = String(spaceId);
  const wantParent = parentMatterId ? String(parentMatterId) : null;
  const out = [];
  for (const id of storeListByType(history, "matter")) {
    const slot = loadSnapshot(history, "matter", id);
    if (!slot || slot.tombstoned) continue;
    const st = slot.state || {};
    if (String(st.spaceId ?? "") !== wantSpace) continue;
    const slotParent = st.parentMatterId ? String(st.parentMatterId) : null;
    if (slotParent !== wantParent) continue;
    const name = st.name;
    if (typeof name !== "string") continue;
    if (pattern instanceof RegExp && !pattern.test(name)) continue;
    out.push(name);
  }
  return out;
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
  return storeListByType(history, type).length;
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
  return storeFindByParent(history, beingId, "being").length;
}

/**
 * CROSS-HISTORY content-hash refcount. Every live (non-tombstoned) matter
 * row, in ANY history, whose CURRENT content is the CAS ref `hash` —
 * optionally excluding one matter id. The curated peer of the purge-content
 * shared-fate gate's old `Projection.find({type:"matter",
 * "state.content.hash":hash})`: content is deduplicated by hash, so purging
 * the bytes blinds every matter pointing at them, across every world.
 *
 * Per-history materialized read: enumerates the live history set
 * (listLiveHistories) and, for each, the history's OWN folded matter slots
 * (the file-store's own-history `type` index, matching the old query's
 * per-history projection rows — an inherited-but-never-diverged matter has
 * no row in the child history). Returns
 * [{ matterId, history }].
 *
 * @param {string} hash            the content hash to refcount
 * @param {object} [opts]
 * @param {string} [opts.excludeId] a matter id to skip (the one being purged)
 * @returns {Promise<Array<{matterId:string, history:string}>>}
 */
export async function findMatterByContentHash(hash, { excludeId } = {}) {
  if (typeof hash !== "string" || !hash.length) return [];
  const skip = excludeId != null ? String(excludeId) : null;
  const { listLiveHistories } = await import("./history/histories.js");
  const histories = [MAIN];
  for (const row of await listLiveHistories()) {
    const path = String(row._id ?? row.path);
    if (path !== MAIN) histories.push(path);
  }
  const out = [];
  for (const history of histories) {
    // Own-history materialized matter slots (no lineage over-collection,
    // no cold-fold): the file-store `type` index lists exactly the ids
    // physically folded in this history.
    for (const id of storeListByType(history, "matter")) {
      if (skip && String(id) === skip) continue;
      const slot = loadSnapshot(history, "matter", id);
      if (!slot || slot.tombstoned) continue;
      const content = slot.state?.content;
      if (content && typeof content === "object" && content.hash === hash) {
        out.push({ matterId: String(id), history });
      }
    }
  }
  return out;
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
  const out = new Map();
  for (const id of ids) {
    const slot = loadSnapshot(history, type, id);
    if (!slot) continue;
    out.set(id, shapeSlot(slot, type, id, history));
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
  const slot = storeFindByHeavenSpace(history, "space", heavenSpaceKind);
  if (!slot) return null;
  return shapeSlot(slot, "space", slot.id, history);
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
 * through cherub. Encapsulates the doctrine (parent-must-be-I-or-
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
  const allowedParents = new Set(["i-am"]);
  if (cherubSlot) allowedParents.add(cherubSlot.id);
  const systemSet = new Set(systemNames || []);
  // Walk the history's own live beings whose parent is I or cherub and whose name isn't a system
  // name; pick the earliest by BIRTH ORDER (bornOrd = the birth fact's append ordinal — clock-free,
  // the ordinal IS the order, replacing the old state.createdAt asc), id as a deterministic tiebreak.
  const candidates = [];
  for (const id of storeListByType(history, "being")) {
    const slot = loadSnapshot(history, "being", id);
    if (!slot || slot.tombstoned) continue;
    const st = slot.state || {};
    if (typeof st.name !== "string" || systemSet.has(st.name)) continue;
    if (!allowedParents.has(st.parentBeingId)) continue;
    candidates.push({ id, name: st.name, bornOrd: st.bornOrd });
  }
  candidates.sort((a, b) => {
    const ca = a.bornOrd ?? 0;
    const cb = b.bornOrd ?? 0;
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const row = candidates[0];
  return row ? { _id: row.id, name: row.name } : null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

// Reduce a FileStore find* row ({kind|type, id, state, foldedSeq,
// position, tombstoned}) to the occupant shape callers expect.
function toOccupant(s) {
  return {
    type: s.type || s.kind,
    id: s.id,
    foldedSeq: s.foldedSeq ?? null,
    position: s.position ?? null,
  };
}

// Wrap a bare FileStore slot ({state, foldedSeq, position, tombstoned})
// with its (type, id) coordinates so toOccupant can read them.
function slotShape(slot, type, id) {
  return { type, id, ...slot };
}

// Load a history's own slot for (type, id) and shape it to an occupant,
// or null if absent/tombstoned. Used by listByType to materialize the
// occupant rows the index's id-list points at.
function slotOccupant(history, type, id) {
  const slot = loadSnapshot(history, type, id);
  if (!slot || slot.tombstoned) return null;
  return toOccupant(slotShape(slot, type, id));
}
