// harmony:dance-floor — the plantable scaffold.
//
// One plant act creates:
//   1. A "dance-floor" Space under the target (typically the reality root).
//   2. A "drum" Matter under the dance-floor, placed at center.
//   3. A "drummer" scripted Being placed adjacent to the drum.
//   4. A roster of dancer Beings at corner starts.
//   5. set-being:coord on every being for its initial position.
//   6. A scheduled wake on the drummer every TICK_MS.

import log from "../../../seed/seedReality/log.js";
import { summonCreateBeing } from "../../../seed/ibp/verbs/summon.js";

// Tick cadence. One minute keeps the LLM dancers' per-tick inference
// load light and gives a human watching the floor time to read each
// move before the next one lands. Drop to 5-30s when running cheap
// models or no LLM dancers; raise when adding more beings.
const TICK_MS  = 60000;
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
    const { rootSpaceId, identity, reality, plantedSeedId, summonCtx } = ctx;

    // Every reality.do / reality.be in this scaffold threads summonCtx so
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
    const grid = await reality.do(rootSpaceId, "create-space", {
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
    const drum = await reality.do({ kind: "space", id: gridSpaceId }, "create-matter", {
      spec: { name: "drum", content: null, origin: "ibp" },
    }, opOpts);
    const drumMatterId = String(drum?.matterId || drum?._id || drum?.id || "");
    if (!drumMatterId) {
      throw new Error("create-matter did not return a matterId; cannot continue scaffold");
    }
    log.info("Harmony", `planted drum matter ${drumMatterId.slice(0, 8)}`);

    // 2a. Place the drum at center. Without this the drum has no
    // coord and the drummer has no destination to approach — he'd
    // either tick from nowhere (the old "no coord, just tick" lie)
    // or stand still forever. Centering the drum gives him a clear
    // starting target; operators can then move it with the Move
    // tool and watch the drummer follow.
    const drumStart = { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) };
    await reality.do({ kind: "matter", id: drumMatterId }, "set-matter", {
      field: "coord",
      value: drumStart,
    }, opOpts);
    log.info("Harmony", `placed drum at (${drumStart.x},${drumStart.y})`);

    // 2b. Render the drum. set-render writes qualities.render . the
    // seed-owned sensory block (model + animations + sounds + future
    // channels). Animations and sounds ride today even though the
    // portal won't play them until rung 3 wires fact-arrival push;
    // capturing them now means the substrate is ready and rung 3 is
    // a portal-side addition only.
    await reality.do({ kind: "matter", id: drumMatterId }, "set-render", {
      model: "harmony:drum",
      // The drum exported from Mixamo / Sketchfab at FBX cm-units too;
      // 56-unit-tall drum gets the same 0.015 correction down to ~84cm,
      // which fits the cell grid (1.5 world units / cell). Tune if the
      // drum source ships in different units.
      scale: 0.015,
      // No animations . the static drum prop has no clips. Sound
      // dispatch is parallel to animation; per assets.md sounds use
      // the namespaced `<ext>:<asset-name>` form so the audio
      // resolver can split it.
      sounds: { "harmony:tick": "harmony:drum-hit" },
    }, opOpts);

    // 3. drummer being. Use summonCreateBeing directly (the same path
    // hello-world's seed uses). `reality.be("create-being", ...)` is a
    // doc-claimed shape but cherub's honoredOperations does not
    // include "create-being" — that dispatch would throw
    // ACTION_NOT_SUPPORTED.
    const drummerResult = await summonCreateBeing({
      spec: {
        name: `drummer-${plantedSeedId.slice(0, 6)}`,
        cognition: "scripted",
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

    // 3a. Place the drummer at a starting cell adjacent to the drum
    // so the first wake strikes (he's already in range). Subsequent
    // drum moves force him to walk back. Without a coord, his
    // approach logic has nothing to work with.
    const drummerStart = { x: drumStart.x, y: drumStart.y };
    await reality.do({ kind: "being", id: drummerBeingId }, "set-being", {
      field: "coord",
      value: drummerStart,
    }, opOpts);
    log.info("Harmony", `placed drummer at (${drummerStart.x},${drummerStart.y})`);

    // 4. drummer role-config (knows what to tick, where to dance)
    await reality.do(drummerBeingId, "set-being", {
      field: "qualities.harmony.role",
      value: { drumMatterId, gridSpaceId, gridW: GRID_W, gridH: GRID_H, tickMs: TICK_MS },
    }, opOpts);

    // 4a. Render the drummer. Rung-3 sensory block: the drummer's
    // own reel carries two fact actions . harmony:tick (when he strikes
    // the drum) and harmony:walk (when he steps toward the drum).
    // Clip names match what the user's drummer.glb exports from
    // Mixamo: "Playing Drums_1" is the strike, "Walking_2" is the
    // step. With no explicit "idle" clip in the file, the AnimationMixer
    // falls back to looping the first clip (Playing Drums_1) as the
    // default pose . the drummer is always-drumming between events,
    // which reads correctly for the demo. No sound on the drummer
    // himself . the drum-hit sound rides on the drum matter's render
    // block (harmony:tick on the drum).
    await reality.do({ kind: "being", id: drummerBeingId }, "set-render", {
      model: "harmony:drummer",
      // Mixamo characters export at FBX cm-units; converters that
      // don't auto-rescale land in three.js as 100x the intended
      // size. 0.01 brings a typical Mixamo character down to ~1.7m,
      // which fits the scene's cell grid (1.5 world units / cell).
      // Tune per-character if the source uses different units.
      scale: 0.015,
      animations: {
        "harmony:tick": "Playing Drums_1",
        "harmony:walk": "Walking_2",
      },
    }, opOpts);

    // 5. dancers — same summonCreateBeing pattern. cognition is
    //    "llm" so each wake routes through runTurn; the LLM
    //    connection resolves through the seed's standard chain (set-
    //    place-llm pins the reality default, dancers inherit).
    const dancers = [];
    for (const spec of DANCER_ROSTER) {
      const isLlm = spec.role === "harmony:dancer-llm";
      const dancerResult = await summonCreateBeing({
        spec: {
          name: `${spec.suffix}-${plantedSeedId.slice(0, 6)}`,
          cognition: isLlm ? "llm" : "scripted",
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
        await reality.do(dancerBeingId, "set-being", {
          field: "qualities.harmony.persona",
          value: spec.persona,
        }, opOpts);
      }

      // 5b. place at starting coords. set-being:coord . the seed
      //     writes Being.coord and the factory's PositionProjection
      //     fold caches the position row.
      await reality.do({ kind: "being", id: dancerBeingId }, "set-being", {
        field: "coord",
        value: { x: spec.start.x, y: spec.start.y },
      }, opOpts);

      // 5b'. Render the dancer. The 3D portal dispatches facts
      // population-level: every loaded entity whose render block
      // names an incoming fact's action reacts in parallel. So the
      // dancer can declare a reaction to harmony:tick (stamped by
      // the drummer onto the drum matter) even though the dancer
      // isn't the fact's target . the dance-floor space's subscriber
      // bucket carries the push to every viewer, who walks every
      // loaded entity. Clip names match the user's dancer.glb (from
      // Mixamo): "Catwalk Walk_2" is the step motion; "Shuffling_1"
      // is the dance-shuffle that doubles as the looping idle (it's
      // also the on-beat pulse here . restarts from frame 0 on each
      // tick fact, which reads as a rhythmic shuffle pulse).
      await reality.do({ kind: "being", id: dancerBeingId }, "set-render", {
        model: "harmony:dancer",
        // Same Mixamo cm→m correction the drummer needs.
        scale: 0.015,
        animations: {
          "harmony:step": "Catwalk Walk_2",
          "harmony:tick": "Shuffling_1",
        },
        // Sound references use the namespaced `<ext>:<asset-name>`
        // form per assets.md . the audio resolver splits on `:` to
        // look the file up in harmony's asset manifest.
        sounds: { "harmony:step": "harmony:footstep" },
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
      reality.declare.subscribe(dancerBeingId, {
        event: "afterQualityWrite",
        scope: { spaceId: gridSpaceId },
        filter: { field: "qualities.harmony.tick" },
        priority: 3, // INTERACTIVE
        // 100 ms window — at the current TICK_MS, drum strikes are far
        // enough apart that nothing coalesces (so behavior is identical
        // to today). The window kicks in only when a future faster
        // tick or a burst of writes lands within 100 ms — in which
        // case the dancer wakes ONCE per batch instead of N times.
        // Conservative latency budget for an animated grid.
        // dancerToward.js's summon handler reads the coalesced shape
        // (c.events[0].spaceId) when c.spaceId is absent.
        coalesceMs: 100,
        id: `harmony-tick-sub-${dancerBeingId}`,
      });

      dancers.push({ beingId: dancerBeingId, role: spec.role, start: spec.start });
    }

    // 6. schedule the drummer wake. Default emitter sends as @I-AM.
    const scheduleId = reality.declare.schedule(drummerBeingId, {
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
