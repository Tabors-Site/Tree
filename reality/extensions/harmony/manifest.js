// TreeOS extension: harmony.
//
// A 2D dance. A drummer keeps the beat. Dancers fold the grid for
// themselves and step by their own rule. The grid space's reel IS
// the timelapse; replay = fold the grid forward by tick.
//
// Tests the model's core claim: many scripted beings folding one
// shared world, each acting by its own voice, synchronizing through
// facts on shared reels. No LLMs.

export default {
  name: "harmony",
  version: "0.1.0",
  description: "Scripted-being dance on a 2D grid. The hello-world for many-beings synchronization.",

  needs: {
    // Verbs and registries the extension reaches for:
    //   do      — registerOperation + do() in the seed scaffold
    //   be      — be("create-being", ...) in the seed scaffold
    //   declare — registerRole, schedule (drummer wake)
    //   hooks   — afterBoot hook for the auto-plant gate
    // (Space/Being model lookups inside the extension import seed
    // models directly; "models" is not part of the scoped bundle.)
    services: ["do", "be", "declare", "hooks"],
  },

  optional: {
    services: [],
  },

  provides: {
    tools: false,
    seeds: {
      // harmony:dance-floor — plant grid + drum + drummer (+ dancers in
      // later rungs). The seed recipe runs through the place bundle.
    },
    hooks: { fires: [], listens: [] },
  },

  env: [
    // HARMONY_AUTO_PLANT=true at boot will plant a default dance-floor
    // at the reality root for testing. Off by default; operators plant
    // via the seed mechanism (place.do(rootId, "plant", { seed: ... })).
    { name: "HARMONY_AUTO_PLANT", required: false, description: "Auto-plant a default dance-floor at the reality root on boot." },
  ],
};
