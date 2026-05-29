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
import { summonCreateBeing } from "../../../seed/ibp/verbs/summon.js";

const TICK_MS  = 1500;
const GRID_W   = 10;
const GRID_H   = 10;

// Rung 5 roster: five dancers, varied start positions. All run the
// same `dancer-toward` rule (step toward nearest neighbor). With five
// dancers on a 10x10 board, multiple dancers will repeatedly target
// adjacent cells, and the Strategy A deterministic bump in foldGrid
// (PARALLEL FACTS §4) resolves collisions at fold time.
//
// Different rules (away/mirror/box/pulse) can layer in later passes;
// the substrate already supports them because each dancer is its own
// summon and the grid reel doesn't care which rule produced a move.
const DANCER_ROSTER = [
  { role: "harmony:dancer-toward", suffix: "toward-nw", start: { x: 0, y: 0 } },
  { role: "harmony:dancer-toward", suffix: "toward-ne", start: { x: 9, y: 0 } },
  { role: "harmony:dancer-toward", suffix: "toward-sw", start: { x: 0, y: 9 } },
  { role: "harmony:dancer-toward", suffix: "toward-se", start: { x: 9, y: 9 } },
  { role: "harmony:dancer-toward", suffix: "toward-c",  start: { x: 5, y: 5 } },
];

export const danceFloorSeed = {
  description: "Plant a dance-floor: grid space + drum + drummer + dancers + scheduled tick.",

  async scaffold(ctx) {
    const { rootSpaceId, identity, place, plantedSeedId, summonCtx } = ctx;

    // Every place.do / place.be in this scaffold threads summonCtx so
    // every Fact pushes onto the SAME moment's deltaF and rides the
    // SAME actId. sealAct commits the whole scaffold together — or
    // none of it. A mid-scaffold rejection (auth, validation, etc.)
    // discards every Fact stamped so far, leaving no orphan rows on
    // the place root or anywhere else.
    const opOpts = { identity, summonCtx };

    // 1. dance-floor space. create-space returns
    // `{spaceId, name, position, _factTarget}` (shapeNewSpace).
    // Read spaceId; the legacy _id / id paths never resolved on
    // this op and silently fell through to "[object Object]".
    const grid = await place.do(rootSpaceId, "create-space", {
      spec: { name: "dance-floor", type: "domain" },
    }, opOpts);
    const gridSpaceId = String(grid?.spaceId || grid?._id || grid?.id || "");
    if (!gridSpaceId) {
      throw new Error("create-space did not return a spaceId; cannot continue scaffold");
    }
    log.info("Harmony", `planted dance-floor space ${gridSpaceId.slice(0, 8)}`);

    // 1a. Set the grid's bounding box. The seed will clamp every
    //     dancer's `coord` write to this size at set-being time —
    //     a being can't be outside the space it's in.
    await place.do(gridSpaceId, "set-space", {
      field: "size",
      value: { x: GRID_W, y: GRID_H },
    }, opOpts);

    // 2. drum matter. create-matter returns `{matterId, spaceId,
    // parentMatterId}`.
    const drum = await place.do(gridSpaceId, "create-matter", {
      spec: { name: "drum", content: null, origin: "ibp" },
    }, opOpts);
    const drumMatterId = String(drum?.matterId || drum?._id || drum?.id || "");
    if (!drumMatterId) {
      throw new Error("create-matter did not return a matterId; cannot continue scaffold");
    }
    log.info("Harmony", `planted drum matter ${drumMatterId.slice(0, 8)}`);

    // 3. drummer being. Use summonCreateBeing directly (the same path
    // hello-world's seed uses). `place.be("create-being", ...)` is a
    // doc-claimed shape but cherub's honoredOperations does not
    // include "create-being" — that dispatch would throw
    // ACTION_NOT_SUPPORTED.
    const drummerResult = await summonCreateBeing({
      spec: {
        name: `drummer-${plantedSeedId.slice(0, 6)}`,
        operatingMode: "scripted",
        roles: ["harmony:drummer"],
        defaultRole: "harmony:drummer",
        homeSpace: gridSpaceId,
        position: gridSpaceId,
        parentBeingId: identity?.beingId || null,
      },
      identity,
      summonCtx,
    });
    const drummerBeingId = String(drummerResult?.beingId || drummerResult?.being?._id || "");
    if (!drummerBeingId) {
      throw new Error("summonCreateBeing drummer returned no beingId");
    }
    log.info("Harmony", `summoned drummer being ${drummerBeingId.slice(0, 8)}`);

    // 4. drummer role-config (knows what to tick, where to dance)
    await place.do(drummerBeingId, "set-being", {
      field: "qualities.harmony.role",
      value: { drumMatterId, gridSpaceId, gridW: GRID_W, gridH: GRID_H, tickMs: TICK_MS },
    }, opOpts);

    // 5. dancers — same summonCreateBeing pattern.
    const dancers = [];
    for (const spec of DANCER_ROSTER) {
      const dancerResult = await summonCreateBeing({
        spec: {
          name: `${spec.suffix}-${plantedSeedId.slice(0, 6)}`,
          operatingMode: "scripted",
          roles: [spec.role],
          defaultRole: spec.role,
          homeSpace: gridSpaceId,
          position: gridSpaceId,
          parentBeingId: identity?.beingId || null,
        },
        identity,
        summonCtx,
      });
      const dancerBeingId = String(dancerResult?.beingId || dancerResult?.being?._id || "");
      if (!dancerBeingId) {
        throw new Error(`summonCreateBeing dancer ${spec.suffix} returned no beingId`);
      }
      log.info("Harmony", `summoned dancer ${spec.suffix} ${dancerBeingId.slice(0, 8)}`);

      // 5a. place at starting coords. Atomic two-fact op:
      //     dancer's coord schema field + grid reel place-event.
      await place.do(dancerBeingId, "harmony:place-being", {
        x: spec.start.x,
        y: spec.start.y,
        gridSpaceId,
      }, opOpts);

      // 5b. subscribe the dancer to drum ticks. The drummer no longer
      //     fans SUMMONs (stigmergic refactor): it just stamps the
      //     tick fact on the drum's qualities.harmony.tick. The
      //     seed's afterQualityWrite hook fires, the seed's
      //     subscription system fans a SUMMON to every dancer whose
      //     filter matches. Each dancer is its own subscriber; a new
      //     dancer joining the grid simply registers its own
      //     subscription and the drummer is none the wiser.
      //
      //     Filter on the exact field path so other harmony qualities
      //     writes (e.g. the drummer's qualities.harmony.role config)
      //     don't trigger the dance.
      place.declare.subscribe(dancerBeingId, {
        event: "afterQualityWrite",
        scope: { spaceId: gridSpaceId },
        filter: { field: "qualities.harmony.tick" },
        priority: 3, // INTERACTIVE
        id: `harmony-tick-sub-${dancerBeingId}`,
      });

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
