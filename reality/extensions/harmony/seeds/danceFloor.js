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

// Tick cadence. 30s is conservative for big local models
// (qwen3.5:27b on consumer GPU/CPU runs ~5-15s per inference once
// presentism is in play). With 5 dancers × ~10s/call / 30s tick =
// well under saturation; the inbox drains, no buffer backup.
//
// Drop to 5-10s when Ollama is reliably fast (e.g. small models,
// good hardware).
const TICK_MS  = 30000;
const GRID_W   = 10;
const GRID_H   = 10;

// LLM roster — 5 personas, one role template, persona-per-being via
// `qualities.harmony.persona`. The buildSystemPrompt on dancer-llm
// reads the quality and appends it to the base prompt, so each being
// gets a distinct character at runtime without N role files.
//
// Each LLM dancer inherits its LlmConnection through the seed's
// 4-layer resolver (set-reality-llm pins the reality default; dancers
// have no per-being slot, so resolution falls through to that).
//
// Doctrine: same SUMMON path as scripted dancers. The drum strikes,
// the seed's afterQualityWrite subscription self-wakes each dancer,
// the dancer's role.summon calls runTurn. Cognition swaps without
// the rest of the substrate noticing.
const DANCER_ROSTER = [
  {
    role: "harmony:dancer-llm",
    suffix: "explorer",
    start: { x: 0, y: 0 },
    persona:
      "You wander. You're drawn to empty space — head toward the directions with the fewest neighbors and the most room. Avoid the crowd.",
  },
  {
    role: "harmony:dancer-llm",
    suffix: "follower",
    start: { x: 9, y: 0 },
    persona:
      "You track the nearest other being. Try to stay one cell away from them — close enough to keep contact, far enough not to crowd. If your nearest neighbor is adjacent, STAY.",
  },
  {
    role: "harmony:dancer-llm",
    suffix: "mirror",
    start: { x: 0, y: 9 },
    persona:
      "You're a contrarian. Step in the direction OPPOSITE to where the most beings around you are. If most are to your N, go S. If everyone's clustered, escape outward.",
  },
  {
    role: "harmony:dancer-llm",
    suffix: "hunter",
    start: { x: 9, y: 9 },
    persona:
      "You hunt. Pick whoever your nearest neighbor is on the first tick and chase them, stepping toward them every tick from here on. Don't switch targets unless they vanish.",
  },
  {
    role: "harmony:dancer-llm",
    suffix: "wallflower",
    start: { x: 5, y: 5 },
    persona:
      "You crave the edge. Head for the corner with the fewest other beings near it. Stay on the perimeter. Avoid the center of the grid.",
  },
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
    // `size` rides on the create spec, so the bounding box lands in
    // one fact instead of create-then-set. The seed clamps every
    // dancer's `coord` write to this size at set-being time, so a
    // being can't be outside the space it's in.
    const grid = await place.do(rootSpaceId, "create-space", {
      spec: {
        name: "dance-floor",
        type: "domain",
        size: { x: GRID_W, y: GRID_H },
      },
    }, opOpts);
    const gridSpaceId = String(grid?.spaceId || grid?._id || grid?.id || "");
    if (!gridSpaceId) {
      throw new Error("create-space did not return a spaceId; cannot continue scaffold");
    }
    log.info("Harmony", `planted dance-floor space ${gridSpaceId.slice(0, 8)}`);

    // 2. drum matter. create-matter returns `{matterId, spaceId,
    //    parentMatterId}`.
    //
    // Typed target ({kind:"space", id}) — passing the bare string id
    // would land in detectTargetKind's "unknown" branch (returns
    // null), and create-matter's `targetKind === "space"` check
    // would fail, falling back to `spec.spaceId ?? null`. The drum
    // would then be created with spaceId=null and the subscription
    // scope check on every tick would silently miss
    // (afterQualityWrite resolves payload.spaceId from matter.spaceId,
    // which would be null). That's how the dance can tick without
    // ever waking a dancer.
    const drum = await place.do({ kind: "space", id: gridSpaceId }, "create-matter", {
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

    // 5. dancers — same summonCreateBeing pattern. operatingMode is
    //    "llm" so each wake routes through runTurn; the LLM
    //    connection resolves through the seed's standard chain (set-
    //    place-llm pins the reality default, dancers inherit).
    const dancers = [];
    for (const spec of DANCER_ROSTER) {
      const isLlm = spec.role === "harmony:dancer-llm";
      const dancerResult = await summonCreateBeing({
        spec: {
          name: `${spec.suffix}-${plantedSeedId.slice(0, 6)}`,
          operatingMode: isLlm ? "llm" : "scripted",
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
      log.info("Harmony", `summoned dancer ${spec.suffix} ${dancerBeingId.slice(0, 8)} (${isLlm ? "llm" : "scripted"})`);

      // 5a. persona on qualities. The dancer-llm role's
      //     buildSystemPrompt reads qualities.harmony.persona and
      //     appends it to the base prompt; this gives every LLM
      //     dancer a distinct character at runtime without N role
      //     templates. Skipped for scripted roles (no prompt).
      if (isLlm && spec.persona) {
        await place.do(dancerBeingId, "set-being", {
          field: "qualities.harmony.persona",
          value: spec.persona,
        }, opOpts);
      }

      // 5b. place at starting coords. The harmony grid reducer
      //     processes the resulting harmony:grid-event fact and
      //     writes Being.coord + PositionProjection (single writer).
      await place.do(dancerBeingId, "harmony:place-being", {
        x: spec.start.x,
        y: spec.start.y,
        gridSpaceId,
      }, opOpts);

      // 5c. subscribe the dancer to drum ticks. The drummer no longer
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
