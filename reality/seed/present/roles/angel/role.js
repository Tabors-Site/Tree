// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// angel/role.js — super-sudo. The I-Am's implicit role and the role
// granted to seed delegates at boot. Wide-open canX; reach-unlimited
// global scope.
//
// Per seed/RolesAreAuth.md, all authority chains back to I-Am. The
// I-Am holds the angel role implicitly (the bootstrap axiom: the
// authorize layer has a code-level I_AM bypass). Every other being
// that holds angel got it via a grant from someone who did — most
// commonly the I-Am at genesis, granting the angel role to each
// seed delegate at the place root.
//
// USE SPARINGLY. Granting angel hands a being the keys to the world.
// In typical realities the only beings with angel are:
//   - The I-Am (implicit)
//   - Seed delegates birthed at genesis (cherub, birther, ...)
//   - Operators of the place who explicitly upgrade themselves
//
// canDo:["grant-role:*"] is the recursive primitive: an angel can
// grant any role to anyone, including more angels. This is how
// "completing the hierarchy" (auth3) starts — from I-Am, through
// angels, down.

export const angelRole = Object.freeze({
  name: "angel",
  description:
    "Super-sudo. The I-Am's role; granted to seed delegates at genesis. " +
    "Reality-wide unrestricted reach. Use sparingly.",
  // Reality-wide. `reach` is omitted → true-global (the auth walk
  // applies this role at every target, no constraint).
  scope: "global",
  // LLM-cognition by default (an angel can in principle hold any
  // cognition; this is the default for live-anointed angels). I-Am
  // doesn't run cognition — its bypass is code-level.
  requiredCognition: null,
  respondMode: "async",
  triggerOn: ["message"],
  canSee: ["*"],
  canDo: [
    { action: "*", description: "do anything" },
    { action: "grant-role:*", description: "grant any role to any being" },
    { action: "revoke-role:*", description: "revoke any grant" },
  ],
  canSummon: [
    { pattern: "@*", description: "summon any being" },
  ],
  canBe: [
    { operation: "*", description: "any BE operation" },
  ],
});
