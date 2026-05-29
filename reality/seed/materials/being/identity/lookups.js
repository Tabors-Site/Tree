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
    .findOne({ name: "cherub", operatingMode: "scripted" })
    .select("_id")
    .lean();
  if (cherub) allowed.push(String(cherub._id));
  return allowed;
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
