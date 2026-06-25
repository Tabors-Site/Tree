// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// lookups.js — read-side identity helpers.
//
// Every "find a being" / "is this the I-Am" / "who's the operator"
// answer comes through here. No state changes, no Fact stamps, no
// auth side-effects — just lean reads against the per-history
// projections collection via the unified API.

import {
  loadProjection,
  findByName,
  findByNamePattern,
  findRoot,
  findRootOperator as findRootOperatorImpl,
  countByType,
  listByType,
} from "../../projections.js";

/**
 * Find the I: the place's first Being row, the root of the
 * being-tree, identified by `parentBeingId: null`. Every other
 * being on the place chains back to it. Created during
 * `ensureSpaceRoot()`; absent only on a pre-bootstrap place.
 *
 * History-aware: main-history only by default; I is a doctrinal
 * singleton at the story root, not a per-history concept.
 */
export async function findIAm() {
  const roots = await findRoot("being", "0");
  if (roots.length === 0) return null;
  const first = roots[0];
  const slot = await loadProjection("being", first.id, "0");
  return slot ? { _id: slot.id, name: slot.state?.name || null } : null;
}

// Cached I identity object suitable for `opts.identity` on verb
// calls. The I has universal authority on its story; seed-internal
// callers (DO-trigger fan-out, scheduled-wake tick, genesis
// scaffolding) pass this identity so `authorize` shorts to allow.
let _iAmIdentityCache = null;
export async function iAmIdentity() {
  if (_iAmIdentityCache) return _iAmIdentityCache;
  const row = await findIAm();
  if (!row) return null;
  _iAmIdentityCache = { beingId: String(row._id), name: row.name };
  return _iAmIdentityCache;
}

// Seed system beings, minted at genesis. The "operator" is the
// first being that ISN'T one of these. Kept for back-compat with the
// remaining findRootOperator caller (just isFirstBeing today, which is
// being migrated to a cognition-based test below). When updating, mirror
// seedDelegates.js's SEED_DELEGATES roster.
const SEED_SYSTEM_BEING_NAMES = [
  "i-am",
  "arrival",
  "cherub",
  "birther",
  "able-manager",
  "able-finder",
  "flow-composer",
  "llm-assigner",
  "story-manager",
  "history-manager",
  "federation-manager",
];

/**
 * Walk the being-tree from `descendantBeingId` upward, return true if
 * `ancestorBeingId` is anywhere on the chain. Used by cherub's
 * connect-via-inherit auth path: an authenticated caller can `connect`
 * to a target without password when the target's parentBeingId chain
 * reaches the caller's beingId.
 *
 * Defensive: returns false on missing rows, cycles, or depth > MAX_HOPS.
 *
 * @param {string} ancestorBeingId    the prospective ancestor
 * @param {string} descendantBeingId  the being to check
 * @param {string} [history="0"]
 * @returns {Promise<boolean>}
 */
export async function isAncestorOf(
  ancestorBeingId,
  descendantBeingId,
  history = "0",
) {
  if (!ancestorBeingId || !descendantBeingId) return false;
  const ancestor = String(ancestorBeingId);
  let cursor = String(descendantBeingId);
  if (cursor === ancestor) return false; // self isn't your own ancestor
  const visited = new Set();
  const MAX_HOPS = 64;
  let hops = 0;
  while (cursor && !visited.has(cursor) && hops < MAX_HOPS) {
    visited.add(cursor);
    hops++;
    // loadOrFold: behavioral read . the parent being may live in the
    // history's main lineage with no divergent slot yet. loadProjection
    // would short-circuit to false on inherited beings; loadOrFold
    // walks the lineage and cold-folds from the inherited reel.
    const { loadOrFold } = await import("../../projections.js");
    const slot = await loadOrFold("being", cursor, history);
    if (!slot) return false;
    const parent = slot.state?.parentBeingId || null;
    if (!parent) return false;
    if (parent === ancestor) return true;
    cursor = parent;
  }
  return false;
}

/**
 * Resolve a being's effective cognition: "llm" | "human" | "scripted".
 *
 *   1. If qualities.connection.inhabitedBy is set → "human"
 *      (an operator is inhabiting via BE:connect; they drive)
 *   2. Else qualities.cognition.defaultKind        (what this being is normally)
 *   3. Else null (caller decides a safe default)
 *
 * @param {object} being  — flattened slot row (loadProjection result with .state spread, or a doc-shaped object)
 * @returns {"llm"|"human"|"scripted"|null}
 */
export function beingCognition(being) {
  if (!being) return null;
  const quals = being.qualities;
  const qGet = (ns) => {
    if (!quals) return null;
    return quals instanceof Map ? quals.get(ns) : quals[ns];
  };
  const connection = qGet("connection");
  if (connection?.inhabitedBy) return "human";
  const cognition = qGet("cognition");
  if (cognition?.defaultKind) return cognition.defaultKind;
  return null;
}

/**
 * Find the story's root operator — the first being the cherub
 * admitted via register/claim. Doctrine encapsulated in the unified
 * findRootOperator helper.
 *
 * Returns null on a fresh story before any being has registered.
 *
 * @param {string} [history="0"]
 */
export async function findRootOperator(history = "0") {
  return await findRootOperatorImpl(SEED_SYSTEM_BEING_NAMES, history);
}

/**
 * Check if no human-cognition being has yet been registered through
 * the cherub. Used by the first-boot path (and by cherub.birth) to
 * decide whether to take the first-being bootstrap branch — which
 * sets the new human as a direct child of I and queues the heaven
 * anoint via moment.afterSeal.
 *
 * Uses a cognition-based query rather than a name-list exclusion so
 * the answer doesn't drift when the seed delegate roster changes
 * (the prior implementation relied on a SEED_SYSTEM_BEING_NAMES list
 * that fell out of sync with seedDelegates.js, causing a delegate to
 * be misclassified as the operator and the bootstrap branch to skip
 * for the real first human).
 */
export async function isFirstBeing(history = "0") {
  // CURATED: listByType returns the live (non-tombstoned) being occupants
  // for the history; load each slot's state and test cognition. True when
  // no human-cognition being is present. The match is on the nested
  // projection field state.qualities.cognition.defaultKind === "human",
  // read off the folded slot state.
  const occupants = await listByType("being", history);
  for (const o of occupants) {
    const slot = await loadProjection("being", o.id, history);
    const kind = slot?.state?.qualities?.cognition?.defaultKind;
    if (kind === "human") return false;
  }
  return true;
}

/**
 * Find a being by name (case-insensitive). History-scoped: same name in
 * different histories resolves to different beings.
 *
 * Returns a doc-shaped object with `_id` + flattened state fields so
 * auth callers (which read `being.password`, `being.qualities.auth`,
 * etc.) keep working without refactoring.
 */
export async function findBeingByName(name, history = "0") {
  if (!name || typeof name !== "string") return null;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = await findByNamePattern(
    "being",
    new RegExp(`^${escaped}$`, "i"),
    history,
  );
  if (matches.length === 0) return null;
  const slot = matches[0];
  return { _id: slot.id, position: slot.position, ...slot.state };
}

/**
 * Find every being that answers to `name`, across ALL histories.
 *
 * The identity surface (BE:connect) runs before a session has a
 * history seated, so a being born on history #7a must be findable from
 * a fresh socket sitting on the default history. Lineage walks don't cover this (a
 * sibling or child history is not in the default history's lineage), so
 * this is a deliberate cross-history sweep of the projections
 * collection.
 *
 * Dedupes by being id. For each being, the returned doc is the HOME
 * slot view: the slot whose history equals state.homeHistory (where the
 * be:birth fact landed). Divergent copies of the same being on other
 * histories (lazy cold-folds, renames) don't get to redefine who the
 * being is for authentication. Beings predating homeHistory fall back
 * to whichever slot was found.
 *
 * Candidates are ordered default-history-first so the common case (one
 * being, born on main) costs one comparison. Callers that authenticate
 * should verify credentials per candidate; the password disambiguates
 * same-name beings born on different histories.
 *
 * @param {string} name
 * @returns {Promise<Array<{_id, homeHistory, position, ...state}>>}
 */
export async function findBeingCandidatesByName(name) {
  if (!name || typeof name !== "string") return [];
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // CURATED CROSS-HISTORY sweep (every history's slot for the name, deduped by
  // being id, home-slot picked). The projections.js find* layer is history-SCOPED
  // (own history + lineage), so a cross-history sweep enumerates every history
  // (the curated, file-backed histories.listAllHistories — main + every branch
  // path) and runs the own-history name pattern read on each. findByNamePattern
  // already excludes tombstones and shapes the slot ({id, position, state, ...,
  // history}); we collect every match, then group + pick the home slot exactly
  // as the old Projection.find did.
  const re = new RegExp(`^${escaped}$`, "i");
  const { listAllHistories } = await import("../../history/histories.js");
  const histories = ["0"];
  for (const row of await listAllHistories()) {
    const p = row?.path ?? row?._id;
    if (p != null && String(p) !== "0") histories.push(String(p));
  }
  const rows = [];
  for (const h of histories) {
    for (const slot of await findByNamePattern("being", re, h)) {
      // findByNamePattern returns the shaped slot {id, position, history, ...state-spread? no}.
      // It returns shapeSlot: {state, foldedSeq, position, tombstoned, type, id, history}. Keep
      // the doc-ish row the grouping below reads (id, history, state, position).
      rows.push({
        id: slot.id,
        history: slot.history,
        state: slot.state,
        position: slot.position,
      });
    }
  }
  if (rows.length === 0) return [];

  const { getDefaultHistory } =
    await import("../../history/historyRegistry.js");
  const defaultHistory = await getDefaultHistory();

  // Group slots per being id, then pick each being's home slot.
  const byId = new Map();
  for (const row of rows) {
    const list = byId.get(row.id) || [];
    list.push(row);
    byId.set(row.id, list);
  }
  const candidates = [];
  for (const [id, slots] of byId) {
    const home =
      slots.find(
        (s) => s.state?.homeHistory && s.history === s.state.homeHistory,
      ) ||
      slots.find((s) => s.history === defaultHistory) ||
      slots[0];
    candidates.push({
      _id: id,
      homeHistory: home.state?.homeHistory || defaultHistory,
      position: home.position ?? null,
      ...(home.state || {}),
    });
  }
  candidates.sort((a, b) => {
    const aHome = a.homeHistory === defaultHistory ? 0 : 1;
    const bHome = b.homeHistory === defaultHistory ? 0 : 1;
    return aHome - bHome;
  });
  return candidates;
}

/**
 * The history a being owns as their present: state.homeHistory from
 * their home slot (the slot on the history they were birthed on).
 *
 * Cross-history by necessity, same reasoning as
 * findBeingCandidatesByName: BE:connect / BE:release / the WS
 * handshake seat the session's currentHistory from this, and at those
 * moments the session has no history to scope the lookup by.
 *
 * Falls back to the default history for legacy rows without
 * homeHistory and for unknown ids.
 *
 * @param {string} beingId
 * @returns {Promise<string>}
 */
export async function findHomeHistoryOfBeing(beingId) {
  const { getDefaultHistory } =
    await import("../../history/historyRegistry.js");
  const defaultHistory = await getDefaultHistory();
  if (!beingId) return defaultHistory;
  // CURATED CROSS-HISTORY sweep — every history's own slot for ONE being id, to
  // pick the home slot (history === state.homeHistory). Like
  // findBeingCandidatesByName: the projections.js layer is history-scoped, so we
  // enumerate every history (histories.listAllHistories — the curated, file-backed
  // registry) and do an own-history loadProjection on each. loadProjection
  // (not loadOrFold) reads only the history's OWN slot — no lineage cold-fold —
  // so an inherited being yields no slot for a history it never diverged in,
  // matching the old Projection.find by stored history. Tombstoned slots are
  // skipped (the old query excluded them).
  const id = String(beingId);
  const { listAllHistories } = await import("../../history/histories.js");
  const histories = ["0"];
  for (const row of await listAllHistories()) {
    const p = row?.path ?? row?._id;
    if (p != null && String(p) !== "0") histories.push(String(p));
  }
  const slots = [];
  for (const h of histories) {
    const slot = await loadProjection("being", id, h);
    if (slot && !slot.tombstoned) {
      slots.push({ history: slot.history, state: slot.state });
    }
  }
  if (slots.length === 0) return defaultHistory;
  const home =
    slots.find(
      (s) => s.state?.homeHistory && s.history === s.state.homeHistory,
    ) || slots[0];
  return home.state?.homeHistory || defaultHistory;
}
