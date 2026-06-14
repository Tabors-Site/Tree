// harmony/seeds/dance-floor — the plantable dance-floor world.
//
// A complete grid + drum + drummer + 5 LLM dancers + per-dancer
// drum-tick subscription + drummer wake schedule, all as static facts
// (~30 entries). Operators plant via plant-template-by-name with
// bundle name "harmony:dance-floor".

export default {
  kind:    "seed",
  name:    "dance-floor",
  version: "0.1.0",
  description:
    "The dance-floor world: 10x10 grid, drum, drummer, five LLM dancers, drum-tick subscription wiring, drummer wake schedule. ~30 static facts.",
  requires: [
    { type: "role", ref: "harmony:drummer"    },
    { type: "role", ref: "harmony:dancer-llm" },
    { type: "code", ref: "harmony"            },
  ],
};
