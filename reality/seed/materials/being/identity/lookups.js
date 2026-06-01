// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// lookups.js — read-side identity helpers.
//
// Every "find a being" / "is this the I-Am" / "who's the operator"
// answer comes through here. No state changes, no Fact stamps, no
// auth side-effects — just lean reads against the Being collection.

import Being from "../being.js";
import { escapeRegex } from "../../../utils.js";

/**
 * Find the I_AM: the place's first Being row, the root of the
 * being-tree, identified by `parentBeingId: null`. Every other
 * being on the place chains back to it. Created during
 * `ensureSpaceRoot()`; absent only on a pre-bootstrap place.
 */
export async function findIAm() {
  return Being.findOne({ parentBeingId: null }).select("_id name").lean();
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
// first being that ISN'T one of these — i.e. the first being the
// cherub admitted via register/claim, regardless of operating
// mode. The list lives here because there's no schema-level flag
// for "system being" yet; if a new seed being lands, add it here.
const SEED_SYSTEM_BEING_NAMES = new Set([
  "i-am",
  "arrival",
  "cherub",
  "llm-assigner",
  "reality-manager",
]);

// Build the "came through cherub" filter — beings whose
// `parentBeingId` is the I_AM (first-being bootstrap path) OR the
// cherub itself (every subsequent register/claim). Excludes beings
// minted by other code paths (e.g. a planted dance-floor's dancers,
// which are parented under whoever planted), which would otherwise
// be candidates by name alone.
async function _registeredParentIds() {
  const allowed = ["i-am"];
  const cherub = await Being
    .findOne({ name: "cherub" })
    .select("_id")
    .lean();
  if (cherub) allowed.push(String(cherub._id));
  return allowed;
}

/**
 * Walk the being-tree from `descendantBeingId` upward, return true if
 * `ancestorBeingId` is anywhere on the chain. Used by cherub's
 * connect-via-inherit auth path: an authenticated caller can `connect`
 * to a target without password when the target's parentBeingId chain
 * reaches the caller's beingId (the caller is the target's ancestor =
 * the target is the caller's descendant).
 *
 * Defensive: returns false on missing rows, cycles, or depth > MAX_HOPS.
 * The being-tree's depth in practice is shallow (humans → their
 * children → their children's children); a hard cap at 64 is plenty.
 *
 * @param {string} ancestorBeingId    the prospective ancestor
 * @param {string} descendantBeingId  the being to check
 * @returns {Promise<boolean>}
 */
export async function isAncestorOf(ancestorBeingId, descendantBeingId) {
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
    const row = await Being.findById(cursor).select("parentBeingId").lean();
    if (!row) return false;
    const parent = row.parentBeingId ? String(row.parentBeingId) : null;
    if (!parent) return false;
    if (parent === ancestor) return true;
    cursor = parent;
  }
  return false;
}

/**
 * Resolve a being's effective cognition: "llm" | "human" | "scripted".
 *
 * Per the cognition doctrine (see seed/present/roles/registry.js header),
 * cognition is a being concept, not a role concept. Effective cognition is:
 *
 *   1. If qualities.connection.inhabitedBy is set → "human"
 *      (an operator is inhabiting via BE:connect; they drive)
 *   2. Else qualities.cognition.defaultKind        (what this being is normally)
 *   3. Else null (caller decides a safe default)
 *
 * The being stays itself across the transition. inhabitedBy is a projection
 * the connection-tracking reducer derives from BE:connect / BE:release facts —
 * not a direct write. Replay reproduces who was driving each being at each
 * moment from the chain.
 *
 * This is the SINGLE resolver. The legacy `Being.operatingMode` schema
 * field is gone; everything that used to read it now branches on this
 * helper's return value.
 *
 * @param {object} being  — Being row, lean or full
 * @returns {"llm"|"human"|"scripted"|null}
 */
export function beingCognition(being) {
  if (!being) return null;
  const quals = being.qualities;
  const qGet = (ns) => {
    if (!quals) return null;
    return quals instanceof Map ? quals.get(ns) : quals[ns];
  };
  // Inhabit is the live override. inhabitedBy set → human is driving.
  const connection = qGet("connection");
  if (connection?.inhabitedBy) return "human";
  // Default kind on the being.
  const cognition = qGet("cognition");
  if (cognition?.defaultKind) return cognition.defaultKind;
  return null;
}

/**
 * Find the reality's root operator — the first being the cherub
 * admitted via register/claim. Doctrinally: the first being that
 * isn't a system being and came through the cherub
 * (parent=I_AM for the bootstrap user, parent=cherub for every
 * subsequent). Mode-agnostic — an LLM being signing up first IS
 * the operator, same as a human.
 *
 * Ordered by `createdAt` (not `_id`, which is a random UUID) so
 * "first by creation time" matches the doctrine reliably. Falls
 * back to `_id` as a tiebreaker for deterministic rebuild order.
 *
 * Returns null on a fresh reality before any being has registered.
 */
export async function findRootOperator() {
  const parents = await _registeredParentIds();
  return Being.findOne({
    name: { $type: "string", $nin: [...SEED_SYSTEM_BEING_NAMES] },
    parentBeingId: { $in: parents },
  })
    .sort({ createdAt: 1, _id: 1 })
    .select("_id name")
    .lean();
}

/**
 * Check if no operator-being has yet been minted by the cherub.
 * Used by the first-boot path (and by cherub.register) to decide
 * whether to take the first-being bootstrap branch.
 */
export async function isFirstBeing() {
  const parents = await _registeredParentIds();
  return (
    (await Being.countDocuments({
      name: { $type: "string", $nin: [...SEED_SYSTEM_BEING_NAMES] },
      parentBeingId: { $in: parents },
    })) === 0
  );
}

/**
 * Find a being by name (case-insensitive). The `+password` projection
 * is intentional — auth flows need the bcrypt hash, and the schema
 * has `password: { select: false }` so a plain `.findOne()` would omit
 * it. Callers that don't need the hash should `.select("-password")`.
 */
export async function findBeingByName(name) {
  if (!name || typeof name !== "string") return null;
  return Being.findOne({
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: "i" },
  }).select("+password");
}
