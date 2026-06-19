// harmony pack (RESOURCES.md).
//
// A 2D dance. A drummer keeps the beat. Dancers fold the grid for
// themselves and step by their own rule. The grid space's reel IS
// the timelapse; replay = fold the grid forward by tick.
//
// Tests the substrate's claim: many scripted beings folding one
// shared world, each acting by its own voice, synchronizing through
// facts on shared reels.
//
// PACK CONTENTS:
//   code/                — the substrate code (ops, init, the SEE op
//                          for dancer-llm's preloaded neighborhood face)
//   roles/drummer/       — the beat-keeper (scripted cognition; walks
//                          to the drum, strikes when adjacent)
//   roles/dancer-toward/ — nearest-neighbor stepper (scripted)
//   roles/dancer-llm/    — LLM cognition dancer reading the structured
//                          neighborhood face
//   seeds/dance-floor/   — the plantable world (grid + drum + drummer
//                          + LLM dancers + per-dancer subscription)
//   assets/              — drum.glb, drummer.glb, dancer.glb, drumhit.mp3,
//                          footstep.mp3 (sensory bytes the portal serves)

export default {
  kind:    "pack",
  name:    "harmony",
  version: "0.1.0",
  description:
    "Scripted-being dance on a 2D grid. The substrate's hello-world for many-beings synchronization. Glues together the harmony code, three roles (drummer + dancer-toward + dancer-llm), and the dance-floor seed.",

  // The pack's requires lists every piece it bundles. When the resource
  // graph's draw/install lands, drawing harmony pulls every member of
  // this closure by hash. For now (with on-disk pieces co-located), this
  // also documents what the pack covers.
  requires: [
    { type: "code",  ref: "harmony"               },
    { type: "role",  ref: "harmony:drummer"       },
    { type: "role",  ref: "harmony:dancer-toward" },
    { type: "role",  ref: "harmony:dancer-llm"    },
    { type: "seed",  ref: "harmony:dance-floor"   },
    { type: "asset", ref: "harmony:models"        },
    { type: "asset", ref: "harmony:sounds"        },
  ],
};
