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
    services: ["see", "do", "summon", "be", "qualities", "seeds", "models", "declare"],
    models:   ["Being", "Space"],
    extensions: [],
  },

  optional: { services: [], extensions: [] },

  provides: {
    // The role is registered in init() rather than declared here so
    // it can close over `place` for the SEE call inside summon().
    // Seeds are also registered in init() for the same reason
    // (scaffold needs `reality.summon` to plant the being).
    seeds: {},
    routes: false,
    jobs: false,
    env: [],
    cli: [],
    hooks: { fires: [], listens: [] },
    defaultPermissions: {
      // Anyone can SUMMON the greeter — that's the whole point of a
      // hello-world. No identity restriction at the place root.
      "summon:@hello-greeter": { requires: {} },
    },
  },
};
