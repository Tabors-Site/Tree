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

/**
 * Find the place's root operator — the first human who registered.
 * The I_AM precedes them; the operator is the first being whose
 * `operatingMode === "human"`. Returns null on a fresh reality before
 * any human has registered. Use this for "who runs this place"
 * checks (place-LLM config, root-only operations); use `findIAm()`
 * for "who is the substrate's identity" checks.
 */
export async function findRootOperator() {
  return Being.findOne({ operatingMode: "human" })
    .sort({ _id: 1 })
    .select("_id name")
    .lean();
}

/**
 * Check if no human has yet registered on this place. Used by the
 * first-boot path to decide whether the plant-context credentials
 * mint the operator-being.
 */
export async function isFirstBeing() {
  return (await Being.countDocuments({ operatingMode: "human" })) === 0;
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
