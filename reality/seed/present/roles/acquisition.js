// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// acquisition.js — how a being gets a role.
//
// Per seed/RolesAreAuth.md, every role has a CONTRACT for who can
// hold it (canX entries) AND a CONTRACT for how it's acquired (this
// file's `acquisition` block on the role spec). The acquisition
// block describes which intake paths the role admits:
//
//   asked       → "auto" | "queue" | false   — how `ask-role` resolves
//                 "auto"  : grant immediately on ask
//                 "queue" : summon the host owner with intent "role-request"
//                           (default; safe baseline for undeclared roles)
//                 false   : the ask op refuses; only direct grant-role works
//
//   grabbed     → bool                       — `take-role` walk-in flag
//                 true : anyone can take the role at will
//                 false: no take-role surface (default)
//
//   autoOnEntry → bool                       — silent grant on SEE
//                 true : the SEE verb fires grant-role for the actor
//                        when they first see a space hosting this role
//                 false: no silent grants (default)
//
// The default policy when the role spec has no `acquisition` block:
// CLOSED on every axis. Extensions that don't declare a policy can't
// be ask/take/auto-acquired — operators or grantors must explicitly
// hand the role out via grant-role. This is the safest baseline: a
// role without thought-out acquisition shouldn't accidentally
// distribute itself.
//
// To make a role openly askable: declare `acquisition: { asked: "auto" }`.
// To make a role walk-in: declare `acquisition: { grabbed: true }`.
// To auto-grant on entry: declare `acquisition: { autoOnEntry: true }`.
//
// The "queue" path is reserved for when the summon-the-owner flow
// lands; until then, undeclared = closed.

export const DEFAULT_ACQUISITION = Object.freeze({
  asked:       false,
  grabbed:     false,
  autoOnEntry: false,
});

/**
 * Normalize a role spec's acquisition block into the canonical shape.
 * Roles without an `acquisition` field get the safe default (queue +
 * no grabs + no auto-on-entry).
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

/**
 * Walk a being's existing grants and return true if they already hold
 * the role anchored at the host space (so auto-grant / take-role
 * doesn't pile up duplicate entries on every SEE).
 */
export function alreadyHoldsRole(grants, roleName, hostSpaceId) {
  if (!Array.isArray(grants) || !roleName) return false;
  const hostStr = hostSpaceId ? String(hostSpaceId) : null;
  return grants.some((g) =>
    g?.role === roleName &&
    (!hostStr || String(g.anchorSpaceId) === hostStr),
  );
}
