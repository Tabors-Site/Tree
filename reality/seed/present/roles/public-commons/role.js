// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// public-commons/role.js — the implicit role visitors carry at a
// space whose owner is @public.
//
// Per seed/RolesAreAuth.md "@public being": when authorize encounters
// a target inside a public-owned subtree, the visitor is treated as
// if they hold THIS role. The spec is a narrower-than-human floor —
// "basic things a visitor can do" — so public-owned spaces aren't
// the wide-open authority that owner-bypass would give. Operators
// wanting a richer commons surface author a real role on the
// public-owned space's qualities.roles (and the role-walk above
// public-commons picks that up first).
//
// This role lives in the registry like every other seed role.
// roleAuth's public-commons step reads it by name; if it's not
// registered (boot order edge), the public-commons branch refuses.
//
// Customization path: this is the seed-shipped DEFAULT. Operators
// who want their commons surface to look different just install a
// role onto the public-owned space's qualities.roles — that role
// goes through the normal role-walk (above the public-commons
// fallback) and applies via the standard reach + canX gate.

export const publicCommonsRole = Object.freeze({
  name: "public-commons",
  description:
    "Implicit visitor floor at any space whose owner is @public. " +
    "Lets visitors see, move, place matter, and stake new sub-spaces. " +
    "Operators replace with a custom role on qualities.roles for a different surface.",
  requiredCognition: null,
  respondMode: "async",
  triggerOn: [],
  canSee:    ["*"],
  canDo: [
    { action: "move",                description: "move in space" },
    { action: "set-being:coord",     description: "update your coord" },
    { action: "set-being:position",  description: "walk to another space" },
    { action: "create-space",        description: "stake a new sub-space here" },
    { action: "create-matter",       description: "place matter here" },
  ],
  canSummon: [
    { pattern: "@cherub", description: "address the gate" },
  ],
  canBe: [
    { operation: "release", description: "log out" },
  ],
});
