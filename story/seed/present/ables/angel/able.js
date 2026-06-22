// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// angel/able.js — super-sudo. The I-Am's implicit able and the able
// granted to seed delegates at boot. Wide-open canX; reach-unlimited
// global scope.
//
// Per seed/AblesAreAuth.md, all authority chains back to I-Am. The
// I-Am holds the angel able implicitly (the bootstrap axiom: the
// authorize layer has a code-level I_AM bypass). Every other being
// that holds angel got it via a grant from someone who did — most
// commonly the I-Am at genesis, granting the angel able to each
// seed delegate at the place root.
//
// USE SPARINGLY. Granting angel hands a being the keys to the world.
// In typical realities the only beings with angel are:
//   - The I-Am (implicit)
//   - Seed delegates birthed at genesis (cherub, birther, ...)
//   - Operators of the place who explicitly upgrade themselves
//
// can:[{verb:"do",word:"grant-able:*"}] is the recursive primitive: an
// angel can grant any able to anyone, including more angels. This is how
// "completing the hierarchy" (auth3) starts — from I-Am, through
// angels, down.

export const angelAble = Object.freeze({
  name: "angel",
  description:
    "Super-sudo. Hosted on heaven (system-internal). The I-Am holds it " +
    "implicitly via code-level bypass; seed delegates get it granted at " +
    "genesis. Reach is extended story-wide so heaven-authority covers " +
    "the whole story. Use sparingly.",
  // Hosted on heaven — default reach is heaven + descendants. The
  // `reach` field extends to the whole story (any path under root)
  // so heaven-anchored grants of angel reach into the place root and
  // everything else outside heaven's subtree. This is the able
  // expressing "heaven-class authority is story-wide authority."
  reach: ["/**"],
  requiredCognition: null,
  respondMode: "async",
  triggerOn: ["message"],
  can: [
    { verb: "see", word: "*" },
    { verb: "do", word: "*", description: "do anything" },
    { verb: "do", word: "grant-able:*", description: "grant any able to any being" },
    { verb: "do", word: "revoke-able:*", description: "revoke any grant" },
    { verb: "call", word: "@*", description: "summon any being" },
    { verb: "be", word: "*", description: "any BE operation" },
  ],
});
