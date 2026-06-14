// TreeOS extension: harmony.
//
// A 2D dance. A drummer keeps the beat. Dancers fold the grid for
// themselves and step by their own rule. The grid space's reel IS
// the timelapse; replay = fold the grid forward by tick.
//
// Tests the model's core claim: many scripted beings folding one
// shared world, each acting by its own voice, synchronizing through
// facts on shared reels.

export default {
  name: "harmony",
  version: "0.1.0",
  description:
    "Scripted-being dance on a 2D grid. The hello-world for many-beings synchronization.",

  needs: {
    // Verbs the extension reaches for:
    //   do      — registerOperation (tick/step/walk runtime ops)
    //   declare — registerRole, registerSeeOperation
    services: ["do", "declare"],
  },

  optional: {
    services: [],
  },

  provides: {
    // Shippable structure — clone bundles operators graft at a
    // position. Replaces the retired scaffold(ctx) seed pattern.
    // dance-floor encodes the full grid + drum + drummer + 5 LLM
    // dancers + per-dancer drum-tick subscription + drummer wake
    // schedule, all as static facts (~30 entries). See
    // seed/done/Chain-Rebuild.md for the bundle format.
    seeds: {
      "dance-floor": "./seeds/dance-floor.seed.json",
    },
    hooks: { fires: [], listens: [] },

    // Sensory assets the extension ships. The loader mounts
    // <ext>/assets/ at /assets/harmony/* and serves a synthetic
    // manifest.json at /assets/harmony/manifest.json returning this
    // block verbatim. The portal resolves `harmony:drum` against
    // assets.models["drum"] → /assets/harmony/drum.glb.
    //
    // Sound files ride along even though rung 1's portal doesn't
    // play them yet . once rung 3 wires the fact-arrival push and
    // the Web Audio renderer, every drum tick will sound without
    // re-shipping the extension.
    assets: {
      models: {
        "drum":    "models/drum.glb",
        "drummer": "models/drummer.glb",
        "dancer":  "models/dancer.glb",
      },
      sounds: {
        "drum-hit": "sounds/drumhit.mp3",
        "footstep": "sounds/footstep.mp3",
      },
    },
  },
};
