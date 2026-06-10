// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// global/role.js — the baseline role every authenticated being
// carries (arrival doesn't — anonymous callers stay on their
// implicit read-only floor).
//
// Per seed/RolesAreAuth.md, the role NAME is `global` (meaning
// "every being gets this") but its SCOPE field is `"anchored"` —
// granted at the place root by cherub on registration. The "global"
// in the name refers to who carries it (everyone), not to the
// scope mechanism.
//
// Customizable per reality. Operators edit this role's canDo as
// they decide what "everyone here can do." Default seed-shipped
// canX is conservative — move yourself, see your position, release.
// Operators add things like "create-space" (so any being can stake
// a new sub-place) or "create-matter" (so any being can place
// matter in public spaces).
//
// The "public" surface of a reality is implicit: a space is "public"
// iff this role (or some other granted role) reaches it. There is
// no public/private flag on Space — only the role's reach defines
// what's accessible.

export const globalRole = Object.freeze({
  name: "global",
  description:
    "The baseline role every authenticated being carries in this reality. " +
    "Granted by cherub at registration (and by parents to children they birth). " +
    "Customize the canX entries to set the floor for what everyone can do here.",
  // Hosted on the reality root (installed at genesis). Default reach
  // is reality-wide since reality-root + descendants = the whole tree.
  // No `reach` field needed; the default covers everything.
  requiredCognition: null,
  respondMode: "async",
  triggerOn: ["message"],
  // Baseline perceptions. Add SEE op names as the operator extends
  // the surface (e.g. `["place", "library", "directory"]`).
  canSee: ["place"],
  // Baseline mutations. Move yourself, update your own coord, walk
  // to another space. Operators expand for their reality.
  canDo: [
    { action: "move",                description: "move yourself in space" },
    { action: "set-being:coord",     description: "update your own coord" },
    { action: "set-being:position",  description: "walk to another space" },
  ],
  // Anyone can address the gate.
  canSummon: [
    { pattern: "@cherub", description: "address the gate" },
  ],
  // Anyone can release their own session.
  canBe: [
    { operation: "release", description: "log out / release identity" },
  ],
});
