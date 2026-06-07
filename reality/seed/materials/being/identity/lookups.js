// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// lookups.js — read-side identity helpers.
//
// Every "find a being" / "is this the I-Am" / "who's the operator"
// answer comes through here. No state changes, no Fact stamps, no
// auth side-effects — just lean reads against the per-branch
// projections collection via the unified API.

import {
  loadProjection,
  findByName,
  findByNamePattern,
  findRoot,
  findRootOperator as findRootOperatorImpl,
  countByType,
} from "../../projections.js";

/**
 * Find the I_AM: the place's first Being row, the root of the
 * being-tree, identified by `parentBeingId: null`. Every other
 * being on the place chains back to it. Created during
 * `ensureSpaceRoot()`; absent only on a pre-bootstrap place.
 *
 * Branch-aware: main-branch only by default; I_AM is a doctrinal
 * singleton at the reality root, not a per-branch concept.
 */
export async function findIAm() {
  const roots = await findRoot("being", "0");
  if (roots.length === 0) return null;
  const first = roots[0];
  const slot = await loadProjection("being", first.id, "0");
  return slot ? { _id: slot.id, name: slot.state?.name || null } : null;
}

// Cached I_AM identity object suitable for `opts.identity` on verb
// calls. The I_AM has universal authority on its reality; seed-internal
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
  "role-manager",
  "role-finder",
  "roleflow-composer",
  "llm-assigner",
  "reality-manager",
  "branch-manager",
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
 * @param {string} [branch="0"]
 * @returns {Promise<boolean>}
 */
export async function isAncestorOf(ancestorBeingId, descendantBeingId, branch = "0") {
  if (!ancestorBeingId || !descendantBeingId) return false;
  const ancestor = String(ancestorBeingId);
  let cursor = String(descendantBeingId);
  if (cursor === ancestor) return false;  // self isn't your own ancestor
  const visited = new Set();
  const MAX_HOPS = 64;
  let hops = 0;
  while (cursor && !visited.has(cursor) && hops < MAX_HOPS) {
    visited.add(cursor);
    hops++;
    // loadOrFold: behavioral read . the parent being may live in the
    // branch's main lineage with no divergent slot yet. loadProjection
    // would short-circuit to false on inherited beings; loadOrFold
    // walks the lineage and cold-folds from the inherited reel.
    const { loadOrFold } = await import("../../projections.js");
    const slot = await loadOrFold("being", cursor, branch);
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
 * Find the reality's root operator — the first being the cherub
 * admitted via register/claim. Doctrine encapsulated in the unified
 * findRootOperator helper.
 *
 * Returns null on a fresh reality before any being has registered.
 *
 * @param {string} [branch="0"]
 */
export async function findRootOperator(branch = "0") {
  return await findRootOperatorImpl(SEED_SYSTEM_BEING_NAMES, branch);
}

/**
 * Check if no human-cognition being has yet been registered through
 * the cherub. Used by the first-boot path (and by cherub.birth) to
 * decide whether to take the first-being bootstrap branch — which
 * sets the new human as a direct child of I_AM and queues the heaven
 * anoint via summonCtx.afterSeal.
 *
 * Uses a cognition-based query rather than a name-list exclusion so
 * the answer doesn't drift when the seed delegate roster changes
 * (the prior implementation relied on a SEED_SYSTEM_BEING_NAMES list
 * that fell out of sync with seedDelegates.js, causing a delegate to
 * be misclassified as the operator and the bootstrap branch to skip
 * for the real first human).
 */
export async function isFirstBeing(branch = "0") {
  const { default: Projection } = await import("../../branch/projection.js");
  const row = await Projection.findOne({
    branch, type: "being",
    "state.qualities.cognition.defaultKind": "human",
    tombstoned: { $ne: true },
  })
    .select("id")
    .lean();
  return row == null;
}

/**
 * Find a being by name (case-insensitive). Branch-scoped: same name in
 * different branches resolves to different beings.
 *
 * Returns a doc-shaped object with `_id` + flattened state fields so
 * auth callers (which read `being.password`, `being.qualities.auth`,
 * etc.) keep working without refactoring.
 */
export async function findBeingByName(name, branch = "0") {
  if (!name || typeof name !== "string") return null;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = await findByNamePattern("being", new RegExp(`^${escaped}$`, "i"), branch);
  if (matches.length === 0) return null;
  const slot = matches[0];
  return { _id: slot.id, position: slot.position, ...slot.state };
}
