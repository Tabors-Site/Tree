// harmony:dance-floor — the plantable scaffold.
//
// One plant act creates:
//   1. A "dance-floor" Space under the target (typically the reality root).
//   2. A "drum" Matter under the dance-floor.
//   3. A "drummer" scripted Being whose qualities point at the drum
//      and the dance-floor.
//   4. A roster of dancer Beings (rung 2: 1 dancer; rung 4: 5).
//   5. harmony:place-being for each dancer (initial coords).
//   6. A scheduled wake on the drummer every TICK_MS.

import log from "../../../seed/seedReality/log.js";

const TICK_MS  = 1500;
const GRID_W   = 10;
const GRID_H   = 10;

// Rung 2 roster: one dancer to prove the pipeline. Rung 4 expands to 5.
const DANCER_ROSTER = [
  { role: "harmony:dancer-toward", suffix: "toward", start: { x: 0, y: 0 } },
];

export const danceFloorSeed = {
  description: "Plant a dance-floor: grid space + drum + drummer + dancers + scheduled tick.",

  async scaffold(ctx) {
    const { rootSpaceId, identity, place, plantedSeedId } = ctx;

    // 1. dance-floor space
    const grid = await place.do(rootSpaceId, "create", {
      kind: "space",
      spec: { name: "dance-floor", type: "domain" },
    }, { identity });
    const gridSpaceId = String(grid?._id || grid?.id || grid);
    log.info("Harmony", `planted dance-floor space ${gridSpaceId.slice(0, 8)}`);

    // 2. drum matter
    const drum = await place.do(gridSpaceId, "create", {
      kind: "matter",
      spec: { name: "drum", content: null, origin: "ibp" },
    }, { identity });
    const drumMatterId = String(drum?._id || drum?.id || drum);
    log.info("Harmony", `planted drum matter ${drumMatterId.slice(0, 8)}`);

    // 3. drummer being
    const drummer = await place.be("create-being", {
      name: `drummer-${plantedSeedId.slice(0, 6)}`,
      operatingMode: "scripted",
      roles: ["harmony:drummer"],
      defaultRole: "harmony:drummer",
      homeSpace: gridSpaceId,
      currentSpace: gridSpaceId,
    }, { identity });
    const drummerBeingId = String(drummer?.being?._id || drummer?.beingId || drummer);
    log.info("Harmony", `summoned drummer being ${drummerBeingId.slice(0, 8)}`);

    // 4. drummer role-config (knows what to tick, where to dance)
    await place.do(drummerBeingId, "set", {
      field: "qualities.harmony.role",
      value: { drumMatterId, gridSpaceId, gridW: GRID_W, gridH: GRID_H, tickMs: TICK_MS },
    }, { identity });

    // 5. dancers
    const dancers = [];
    for (const spec of DANCER_ROSTER) {
      const dancer = await place.be("create-being", {
        name: `${spec.suffix}-${plantedSeedId.slice(0, 6)}`,
        operatingMode: "scripted",
        roles: [spec.role],
        defaultRole: spec.role,
        homeSpace: gridSpaceId,
        currentSpace: gridSpaceId,
      }, { identity });
      const dancerBeingId = String(dancer?.being?._id || dancer?.beingId || dancer);
      log.info("Harmony", `summoned dancer ${spec.suffix} ${dancerBeingId.slice(0, 8)}`);

      // 5a. place at starting coords. Atomic two-fact op:
      //     dancer's qualities.harmony.coords + grid reel place-event.
      await place.do(dancerBeingId, "harmony:place-being", {
        x: spec.start.x,
        y: spec.start.y,
        gridSpaceId,
      }, { identity });

      dancers.push({ beingId: dancerBeingId, role: spec.role, start: spec.start });
    }

    // 6. schedule the drummer wake. Default emitter sends as @I-AM.
    const scheduleId = place.declare.schedule(drummerBeingId, {
      intervalMs: TICK_MS,
      content: { event: "tick", drumMatterId, gridSpaceId },
      priority: 4,
      id: `harmony-tick-${plantedSeedId}`,
    });
    log.info("Harmony", `scheduled drummer wake every ${TICK_MS}ms (id=${String(scheduleId).slice(0, 8)})`);

    return {
      gridSpaceId,
      drumMatterId,
      drummerBeingId,
      dancers,
      scheduleId,
      tickMs: TICK_MS,
      gridW: GRID_W,
      gridH: GRID_H,
    };
  },
};
