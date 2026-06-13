// TreeOS extension: hello-world.
//
// The canonical example extension. It does one thing: plant a seed
// that spawns a being whose role greets you and the world it sees.
//
// Two parts:
//   - role "greeter"  — when summoned, looks around (SEE its position
//                       + children), and returns "hello world to you,
//                       [asker], and to my surroundings: [...]".
//   - seed "greeter"  — when planted at a position, spawns one being
//                       there with that role.
//
// Operator workflow:
//   1. The extension loads at boot (placed under extensions/hello-world/).
//   2. `treeos do <space> plant { seed: "hello-world:greeter" }`
//      — or via the IBP DO verb directly — spawns the being.
//   3. `treeos summon <space>@hello-<id>` greets you.
//
// Today the role is "scripted" (code-cognition). Flipping to LLM
// cognition is a one-line change in the seed (cognition: "llm"
// + an llm connection on the being); the role's prompt already
// describes the desired behavior. The scripted variant runs without
// LLM credentials so the canonical hello-world can be reproduced on
// any fresh install.

export default {
  name: "hello-world",
  version: "1.0.0",
  description:
    "Plants a greeter being whose role says hello world to you and to the world it sees.",

  needs: {
    services: ["see", "do", "summon", "be", "qualities", "models", "declare"],
    models:   ["Being", "Space"],
    extensions: [],
  },

  optional: { services: [], extensions: [] },

  provides: {
    // The role is registered in init() rather than declared here so
    // it can close over `place` for the SEE call inside summon().
    routes: false,
    jobs: false,
    env: [],
    cli: [],
    // Shippable structure — clone bundles operators graft at a position.
    // Replaces the retired seed-scaffold pattern. Each bundle's content
    // is a static list of fact specs that replay at graft time. See
    // seed/done/Chain-Rebuild.md for the bundle format + parameter system.
    seeds: {
      greeter: "./seeds/greeter.seed.json",
    },
    hooks: { fires: [], listens: [] },
    // defaultPermissions retired (seed/RolesAreAuth.md). To make
    // @hello-greeter summonable, this extension would either:
    //   - ship a role whose canSummon includes "@hello-greeter" and
    //     grant it to the operator (or have the operator self-author),
    //   - OR have the operator extend the seed `global` role's
    //     canSummon to include "@hello-greeter".
    // For the demo, the operator can grant themselves a role with
    // canSummon: ["@hello-greeter"] at the place root.
  },
};
