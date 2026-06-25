// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// acquisition.js — how a being gets a able.
//
// Per seed/AblesAreAuth.md, every able has a CONTRACT for who can
// hold it (canX entries) AND a CONTRACT for how it's acquired (this
// file's `acquisition` block on the able spec). The acquisition
// block describes which intake paths the able admits:
//
//   asked       → "auto" | "queue" | false   — how `ask-able` resolves
//                 "auto"  : grant immediately on ask
//                 "queue" : summon the host owner with intent "able-request"
//                 false   : the ask op refuses; only direct grant-able
//                           works (default; closed baseline)
//
//   grabbed     → bool                       — `take-able` walk-in flag
//                 true : anyone can take the able at will
//                 false: no take-able surface (default)
//
//   autoOnEntry → bool                       — admit-on-entry policy
//                 true : a being MAY acquire this able on entry. (The old
//                        "SEE fires grant-able" mechanism was REMOVED — a
//                        space is a NOUN, it can't grant a being; a being
//                        reads this policy and self-takes via take-able.)
//                 false: closed on entry (default)
//
// The default policy when the able spec has no `acquisition` block:
// CLOSED on every axis. Extensions that don't declare a policy can't
// be ask/take/auto-acquired — operators or grantors must explicitly
// hand the able out via grant-able. This is the safest baseline: a
// able without thought-out acquisition shouldn't accidentally
// distribute itself.
//
// To make a able openly askable: declare `acquisition: { asked: "auto" }`.
// To make a able walk-in: declare `acquisition: { grabbed: true }`.
// To open entry self-take: declare `acquisition: { autoOnEntry: true }`.
//
// The "queue" path is reserved for when the summon-the-owner flow
// lands; until then, undeclared = closed.

export const DEFAULT_ACQUISITION = Object.freeze({
  asked:       false,
  grabbed:     false,
  autoOnEntry: false,
});

/**
 * Normalize a able spec's acquisition block into the canonical shape.
 * Ables without an `acquisition` field get the safe default: closed
 * on every axis (no asks, no grabs, no auto-on-entry).
 */
export function normalizeAcquisition(spec) {
  const a = (spec && typeof spec === "object" && spec.acquisition) || null;
  if (!a || typeof a !== "object") return { ...DEFAULT_ACQUISITION };
  const asked = a.asked === "auto" || a.asked === "queue" || a.asked === false
    ? a.asked
    : DEFAULT_ACQUISITION.asked;
  return {
    asked,
    grabbed:     !!a.grabbed,
    autoOnEntry: !!a.autoOnEntry,
  };
}

// Time-bound grants: NOT a wall-clock concept. There is no expiry
// field on grants. Beings have no clocks, calendars, or shared "now"
// — wall-clock time is the human world's, and an `expiresAt` ISO
// timestamp would smuggle it into the story's auth core. When
// time-bound grants land they will be STORY-time: measured in the
// world's own units (a being's moments, reel seq, harmony beats),
// enforced the same way everything else is — at the able-walk.
// Until that unit exists, a grant lasts until revoked.

/**
 * Walk a being's existing grants and return true if they already hold
 * the able anchored at the host space (so auto-grant / take-able
 * doesn't pile up duplicate entries on every SEE).
 */
export function alreadyHoldsAble(grants, ableName, hostSpaceId) {
  if (!Array.isArray(grants) || !ableName) return false;
  const hostStr = hostSpaceId ? String(hostSpaceId) : null;
  return grants.some((g) =>
    g?.able === ableName &&
    (!hostStr || String(g.anchorSpaceId) === hostStr),
  );
}
