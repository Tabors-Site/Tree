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
  // classify-matter is the pure "what type would this become?" read
  // every being needs before placing matter. verify-reel /
  // chain-root are the chain's verification + fingerprint reads —
  // anyone may check that the world's history is intact.
  canSee: ["place", "classify-matter", "verify-reel", "chain-root"],
  // Baseline mutations. Move yourself, update your own coord, walk
  // to another space, petition for additional roles. The petition
  // ops (ask-role / take-role) MUST live here because the role-walk
  // is the single gate (seed/RolesAreAuth.md): the substrate has no
  // bypass mechanism. Every being needs to be able to ask, so every
  // being must hold a role permitting ask. global is that role.
  // Operators expand the rest for their reality.
  canDo: [
    { action: "move",                description: "move yourself in space" },
    { action: "set-being:coord",     description: "update your own coord" },
    { action: "set-being:position",  description: "walk to another space" },
    { action: "ask-role",            description: "request acquisition of a role from its host" },
    { action: "take-role",           description: "walk in and take a role with acquisition.grabbed=true" },
    // The skins catalog (/skins at the reality root) is everyone's:
    // upload a model there, wear any model from it. set-model's own
    // handler enforces self/author/owner per target, so the floor
    // grant is safe — you still can't set models on things that
    // aren't yours.
    { action: "create-matter:model", description: "upload a 3D model into the /skins catalog" },
    { action: "set-model",           description: "wear a model from /skins (or set one on things you own)" },
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
