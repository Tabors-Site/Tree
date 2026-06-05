// Harmony extension entry point.
//
// Registers:
//   - harmony:tick         DO op (drummer stamps the beat on the drum)
//   - harmony:step         DO op (dancer's step . set-being:coord wrapper)
//   - harmony:drummer      role (scripted; walks to drum + ticks)
//   - harmony:dancer-toward role (scripted; nearest-neighbor stepper)
//   - harmony:dancer-llm   role (LLM cognition; reads the structured world face)
//   - harmony:dance-floor  seed (plantable scaffold)
//
// Position tracking is owned by the seed (PositionProjection + the
// set-being:coord verb). Bounds are enforced by the seed at coord
// write time. Harmony adds the domain ops (step, tick) and the
// grid-shaped world face for LLM dancers; nothing else.
//
// Initial placement at plant time is just set-being:coord, called
// directly by the dance-floor scaffold. No harmony-specific place op.

import log from "../../seed/seedReality/log.js";
import tickOp from "./ops/tick.js";
import stepOp from "./ops/step.js";
import walkOp from "./ops/walk.js";
import { drummerRole } from "./roles/drummer.js";
import { dancerTowardRole } from "./roles/dancerToward.js";
import { dancerLlmRole, neighborsSeeResolver } from "./roles/dancerLlm.js";
import { danceFloorSeed } from "./seeds/danceFloor.js";

export async function init(reality) {
  // 1. DO operations (loader auto-namespaces each to harmony:<name>).
  reality.do.registerOperation("tick", tickOp);
  reality.do.registerOperation("step", stepOp);
  reality.do.registerOperation("walk", walkOp);
  log.verbose("Harmony", "registered ops: tick, step, walk");

  // 2. Roles.
  reality.declare.registerRole("drummer",       drummerRole);
  reality.declare.registerRole("dancer-toward", dancerTowardRole);
  reality.declare.registerRole("dancer-llm",    dancerLlmRole);
  log.verbose("Harmony", "registered roles: drummer, dancer-toward, dancer-llm");

  // 2b. SEE-resolver for dancer-llm's `neighbors` preloaded face.
  // Load-time registration routes through declare, matching the rule:
  // ctx.X = moment-time, reality.declare.X = load-time.
  reality.declare.registerSeeResolver("neighbors", neighborsSeeResolver);

  return {
    seeds: [
      { name: "dance-floor", ...danceFloorSeed },
    ],
  };
}
