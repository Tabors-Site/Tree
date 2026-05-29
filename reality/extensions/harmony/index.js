// Harmony extension entry point.
//
// Registers:
//   - harmony:tick         DO op (the drummer's beat on the drum)
//   - harmony:place-being  DO op (initial placement; two-fact atomic)
//   - harmony:move         DO op (one move; two-fact atomic)
//   - harmony:grid-event   DO op (marker; the audit fact on the grid)
//   - harmony:drummer      role (scripted; ticks + fans SUMMONs)
//   - harmony:dancer-toward role (scripted; folds grid, steps toward neighbor)
//   - harmony:dance-floor  seed (plantable scaffold; returned from init)
//
// No boot-time plant. Seeds are planted by a being in the world, at a
// position — the operator picks the dance-floor from the seed hotbar
// in their portal and plants at their home. The planter being is the
// canonical owner of the resulting scaffold; assigning that at boot
// would mean making one up, which is the doctrine violation we're not
// committing here. Register → sign in → hotbar → plant.

import log from "../../seed/seedReality/log.js";
import tickOp from "./ops/tick.js";
import placeBeingOp from "./ops/place-being.js";
import moveOp from "./ops/move.js";
import stepOp from "./ops/step.js";
import gridEventOp from "./ops/grid-event.js";
import { drummerRole } from "./roles/drummer.js";
import { dancerTowardRole } from "./roles/dancerToward.js";
import { dancerLlmRole } from "./roles/dancerLlm.js";
import { danceFloorSeed } from "./seeds/danceFloor.js";
import { harmonyTools } from "./tools.js";
// Side-effect import: registerCrossCuttingHandler runs at module
// load. The grid reducer becomes the single writer of Being.coord +
// PositionProjection for beings on a harmony grid the moment
// harmony loads.
import "./handlers/gridReducer.js";

export async function init(place) {
  // 1. DO operations (loader auto-namespaces each to harmony:<name>).
  place.do.registerOperation("tick", tickOp);
  place.do.registerOperation("place-being", placeBeingOp);
  place.do.registerOperation("move", moveOp);
  place.do.registerOperation("step", stepOp);
  place.do.registerOperation("grid-event", gridEventOp);
  log.verbose("Harmony", "registered ops: tick, place-being, move, step, grid-event");

  // 2. Roles.
  place.declare.registerRole("harmony:drummer",       drummerRole);
  place.declare.registerRole("harmony:dancer-toward", dancerTowardRole);
  place.declare.registerRole("harmony:dancer-llm",    dancerLlmRole);
  log.verbose("Harmony", "registered roles: drummer, dancer-toward, dancer-llm");

  // 3. Seeds + tools via init() return; loader namespaces + tracks
  //    owner. Tools become LLM-callable as harmony:<name>; the seed
  //    catalog surface (`.discovery`) carries the seed registration.
  return {
    seeds: [
      { name: "dance-floor", ...danceFloorSeed },
    ],
    tools: harmonyTools,
  };
}
