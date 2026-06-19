// harmony:dancer-llm — LLM-cognition dancer.
//
// Pure role spec. The seed's role registry auto-wraps defaultSummon
// for roles without a custom summon function . defaultSummon calls
// runLlmMoment with the right envelope and routes the discriminated
// result. This file is data describing what the being IS; engine
// dispatch is the substrate's job.
//
// The see-resolver below is legitimately harmony-shaped . it reads
// the seed's PositionProjection (the factory-owned cross-cutting
// fold of beings' coords per space) and returns the dancer's
// structured world face. The seed enforces grid bounds via
// Space.size at set-being:coord time.

import log from "../../../../seed/seedStory/log.js";

const DIRS = [
  { key: "N",  dx:  0, dy: -1 },
  { key: "NE", dx:  1, dy: -1 },
  { key: "E",  dx:  1, dy:  0 },
  { key: "SE", dx:  1, dy:  1 },
  { key: "S",  dx:  0, dy:  1 },
  { key: "SW", dx: -1, dy:  1 },
  { key: "W",  dx: -1, dy:  0 },
  { key: "NW", dx: -1, dy: -1 },
];

// Structured world face for the dancer. Returns a JSON object;
// assemble.js stringifies it under [neighbors] in the system prompt.
// Source of truth: the seed's PositionProjection (factory-owned).
//
// Registered from harmony/index.js via story.declare.registerSeeOperation
// (load-time registration goes through the declare namespace, never
// through a seed-internal import).
export const neighborsSeeResolver = async (ctx) => {
  const beingId = String(ctx.being?._id || "");
  const gridSpaceId =
    (ctx.being?.position && String(ctx.being.position)) ||
    (ctx.being?.homeSpace && String(ctx.being.homeSpace)) ||
    null;
  if (!beingId || !gridSpaceId) return null;

  let positions, bounds;
  try {
    // Public surface: ctx.read("positions", spaceId) — the moment
    // ctx's projection read. No seed-internal imports.
    positions = (await ctx.read("positions", gridSpaceId)) || [];
    // Branch comes from the moment ctx — extensions never assume a
    // particular branch, just thread whatever's live.
    const grid = await ctx.read("space", gridSpaceId);
    const size = grid?.size;
    bounds = {
      w: size?.x > 0 ? size.x : null,
      h: size?.y > 0 ? size.y : null,
    };
  } catch (err) {
    log.warn("DancerLlm", `see-resolver read failed: ${err.message}`);
    return null;
  }

  const me = positions.find((p) => String(p.beingId) === beingId);
  if (!me) {
    return { placed: false };
  }

  // Build cell→beingId map and collect neighbor ids.
  const occupants = new Map();
  for (const p of positions) {
    const id = String(p.beingId);
    if (id === beingId) continue;
    occupants.set(`${p.x},${p.y}`, id);
  }

  const walls = [];
  const neighborIds = new Set();
  const neighbors = {};
  for (const d of DIRS) {
    const nx = me.x + d.dx;
    const ny = me.y + d.dy;
    const oob =
      (bounds.w !== null && (nx < 0 || nx >= bounds.w)) ||
      (bounds.h !== null && (ny < 0 || ny >= bounds.h));
    if (oob) {
      walls.push(d.key);
      neighbors[d.key] = "WALL";
      continue;
    }
    const occ = occupants.get(`${nx},${ny}`);
    if (occ) {
      neighbors[d.key] = occ;
      neighborIds.add(occ);
    } else {
      neighbors[d.key] = "empty";
    }
  }

  if (neighborIds.size > 0) {
    // N parallel ctx.read calls (≤ 8 neighbors in practice — eight
    // compass cells). Each goes through the branch-aware reader so
    // inherited dancers resolve on sub-branches too. Slower than a
    // single $in query in absolute terms, but the surrounding fold
    // dominates and the extension stays substrate-clean.
    const lookups = await Promise.all(
      [...neighborIds].map(async (id) => [String(id), await ctx.read("being", id)]),
    );
    const nameById = new Map(lookups.map(([id, row]) => [id, row?.name]));
    for (const k of Object.keys(neighbors)) {
      const v = neighbors[k];
      if (v !== "empty" && v !== "WALL") {
        neighbors[k] = `@${nameById.get(v) || v.slice(0, 8)}`;
      }
    }
  }

  // legalMoves names exactly the values the harmony:step tool accepts:
  // STAY is always legal; the eight compass directions minus walls.
  // The dancer prompt directs the model to pick one of these every wake.
  const legalMoves = ["STAY", ...DIRS.map((d) => d.key).filter((k) => !walls.includes(k))];

  return {
    placed: true,
    position: { x: me.x, y: me.y },
    grid: bounds,
    neighbors,
    walls,
    legalMoves,
  };
};

const BASE_PROMPT = `You are a harmony dancer on a grid. On each beat, call harmony:step(direction) where direction is one of legalMoves (N/NE/E/SE/S/SW/W/NW/STAY). STAY means stay put . it is still a step and still recorded. No prose. Just call the tool.`;

export const dancerLlmRole = Object.freeze({
  name: "dancer-llm",
  description: "LLM-cognition dancer. Sees its 8-cell neighborhood, steps with intent.",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  // Declared capabilities. The `can` list is the role's preloaded
  // face. A see entry resolves at moment-open . a registered see name
  // runs its resolver and the structured return becomes a JSON face
  // block. Bare name "neighbors" suffix-matches the extension-scoped
  // key (`harmony:neighbors`); no prefix needed inside this extension.
  // A do entry is the declared action surface. The face shows it; the
  // LLM picks the body of the being. The dancer's only act is to step.
  // The seed `do` tool is exposed automatically (a do entry present);
  // the LLM calls do({action: "harmony:step", args: {direction}}) and
  // the op handler resolves gridSpaceId from the dancer's position.
  // No toolNames field. The role spec IS its `can` list.
  can: [
    { verb: "see", word: "neighbors" },
    {
      verb: "do",
      word: "step",
      description:
        "Step one cell or stay. args: { direction: 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'|'STAY' }. " +
          "Pick exactly one of legalMoves. STAY records a deliberate hold at the current cell.",
    },
  ],

  // Force the provider to call a tool on every wake. Without this the
  // model deliberates in prose ("I'm a harmony dancer, this is my
  // first moment to step . let me explore") and emits no tool call,
  // which the substrate treats as a SEE. Forced tool calls drop
  // latency from minutes to seconds.
  forceToolCall: true,

  // Presentism. Every tick is a fresh "now" — the face is rebuilt
  // from substrate each summon (identity + see-resolvers +
  // capabilities + persona). Without this, a dancer's self-self IBP
  // address would key the same session for every wake and the
  // prompt would grow unboundedly across ticks.
  presentist: true,

  label: "Harmony Dancer (LLM)",

  // The body of the face. Persona is per-being via
  // qualities.harmony.persona — the dance-floor seed writes it at
  // plant time. One role template, N personas at runtime.
  prompt(ctx) {
    const persona = ctx?.being?.qualities?.harmony?.persona;
    if (persona && typeof persona === "string" && persona.length > 0) {
      return `${BASE_PROMPT}\n\nYour character: ${persona}`;
    }
    return BASE_PROMPT;
  },
});
