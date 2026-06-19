// hello-world pack (RESOURCES.md).
//
// The canonical hello-world. A scripted greeter being that, when
// summoned, looks at where it stands (its space + the children
// around it) and returns a greeting addressed to BOTH the asker and
// the world it just saw.
//
// PACK CONTENTS:
//   roles/greeter/  — the greeter role spec (scripted; inline summon)
//   seeds/greeter/  — plants one greeter being at a position
//
// No code piece. The role's summon does the substrate work via ctx
// (ctx.read, ctx.act) plus a dynamic import for the children
// projection. Nothing requires substrate-side init.
//
// Operator workflow:
//   1. The pack loads at boot. Both pieces register through their
//      kind handlers.
//   2. `do <space> plant-template-by-name { name: "hello-world:greeter" }`
//      spawns one greeter being at <space>.
//   3. `summon <space>@hello-greeter` returns the greeting.

export default {
  kind:    "pack",
  name:    "hello-world",
  version: "1.0.0",
  description:
    "The canonical hello-world. A scripted greeter that greets both you and the world around it.",
  requires: [
    { type: "role", ref: "hello-world:greeter" },
    { type: "seed", ref: "hello-world:greeter" },
  ],
};
