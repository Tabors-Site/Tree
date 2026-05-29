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
import gridEventOp from "./ops/grid-event.js";
import { drummerRole } from "./roles/drummer.js";
import { dancerTowardRole } from "./roles/dancerToward.js";
import { danceFloorSeed } from "./seeds/danceFloor.js";

export async function init(place) {
  // 1. DO operations (loader auto-namespaces each to harmony:<name>).
  place.do.registerOperation("tick", tickOp);
  place.do.registerOperation("place-being", placeBeingOp);
  place.do.registerOperation("move", moveOp);
  place.do.registerOperation("grid-event", gridEventOp);
  log.verbose("Harmony", "registered ops: tick, place-being, move, grid-event");

  // 2. Roles.
  place.declare.registerRole("harmony:drummer",       drummerRole);
  place.declare.registerRole("harmony:dancer-toward", dancerTowardRole);
  log.verbose("Harmony", "registered roles: drummer, dancer-toward");

  // 3. Seeds via init() return; loader namespaces + tracks owner. The
  //    seed catalog surface (`.discovery`) carries the registration,
  //    which the portal hotbar reads. From there the operator plants.
  return {
    seeds: [
      { name: "dance-floor", ...danceFloorSeed },
    ],
  };
}
