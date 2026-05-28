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
// If HARMONY_AUTO_PLANT=true, plants a default dance-floor at the
// reality root after registration (afterBoot hook).

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

  // 3. Optional auto-plant for testing.
  if (process.env.HARMONY_AUTO_PLANT === "true") {
    place.hooks.register("afterBoot", async () => {
      try {
        await autoPlantDanceFloor(place);
      } catch (err) {
        log.error("Harmony", `auto-plant failed: ${err.message}`);
      }
    }, "harmony");
  }

  // 4. Seeds via init() return; loader namespaces + tracks owner.
  return {
    seeds: [
      { name: "dance-floor", ...danceFloorSeed },
    ],
  };
}

async function autoPlantDanceFloor(place) {
  // Seed rule: tree roots go under user homes, not the reality root
  // (which is a seed space — children are restricted). Plant under
  // the root operator's home space. On a fresh reality before any
  // human has registered, skip — there's nowhere legitimate to plant.
  const { default: Being } = await import("../../seed/materials/being/being.js");
  const { default: Space } = await import("../../seed/materials/space/space.js");
  const operator = await Being
    .findOne({ operatingMode: "human" })
    .sort({ _id: 1 })
    .select("_id name homeSpace")
    .lean();
  if (!operator) {
    log.warn("Harmony", "auto-plant skipped: no operator being yet (register one and re-plant manually)");
    return;
  }
  if (!operator.homeSpace) {
    log.warn("Harmony", `auto-plant skipped: operator @${operator.name} has no homeSpace`);
    return;
  }
  const existing = await Space.findOne({
    parent: operator.homeSpace,
    name: "dance-floor",
  }).select("_id").lean();
  if (existing) {
    log.info("Harmony", "auto-plant skipped: dance-floor already exists at operator home");
    return;
  }
  await place.do(String(operator.homeSpace), "plant", {
    seed: "harmony:dance-floor",
  }, {
    identity: { beingId: String(operator._id), name: operator.name },
    scaffold: true,
  });
  log.info(
    "Harmony",
    `auto-planted dance-floor under @${operator.name}'s home (${String(operator.homeSpace).slice(0, 8)})`,
  );
}
