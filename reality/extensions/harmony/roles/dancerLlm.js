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

import Being from "../../../seed/materials/being/being.js";
import Space from "../../../seed/materials/space/space.js";
import { registerSeeResolver } from "../../../seed/present/cognition/llm/seeResolvers.js";
import { readPositionsInSpace } from "../../../seed/past/projections/position/positionProjectionFold.js";
import log from "../../../seed/seedReality/log.js";

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
registerSeeResolver("neighbors", async (ctx) => {
  const beingId = String(ctx.being?._id || "");
  const gridSpaceId =
    (ctx.being?.position && String(ctx.being.position)) ||
    (ctx.being?.homeSpace && String(ctx.being.homeSpace)) ||
    null;
  if (!beingId || !gridSpaceId) return null;

  let positions, bounds;
  try {
    positions = await readPositionsInSpace(gridSpaceId);
    const space = await Space.findById(gridSpaceId).select("size").lean();
    bounds = {
      w: space?.size?.x > 0 ? space.size.x : null,
      h: space?.size?.y > 0 ? space.size.y : null,
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
    const rows = await Being
      .find({ _id: { $in: [...neighborIds] } })
      .select("_id name")
      .lean();
    const nameById = new Map(rows.map((r) => [String(r._id), r.name]));
    for (const k of Object.keys(neighbors)) {
      const v = neighbors[k];
      if (v !== "empty" && v !== "WALL") {
        neighbors[k] = `@${nameById.get(v) || v.slice(0, 8)}`;
      }
    }
  }

  const legalMoves = ["STAY", ...DIRS.map((d) => d.key).filter((k) => !walls.includes(k))];

  return {
    placed: true,
    position: { x: me.x, y: me.y },
    grid: bounds,
    neighbors,
    walls,
    legalMoves,
  };
}, "harmony");

const BASE_PROMPT = `You are a dancer on a grid. The drum has struck; this is your one moment to step.

Emit no tool call if you don't want to move this tick. The substrate records that as a release (SEE); the next tick you'll wake fresh. Walls are clamped by the bump rule. Pick with intent.`;

export const dancerLlmRole = Object.freeze({
  name: "harmony:dancer-llm",
  description: "LLM-cognition dancer. Sees its 8-cell neighborhood, steps with intent.",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  // Declared eyes. The seed's assembler resolves this every summon
  // and renders the result in the face — fresh, never cached.
  // Bare name ("neighbors") — getSeeResolver suffix-matches against
  // the extension-scoped key, so no prefix is needed inside this
  // extension.
  see: ["neighbors"],

  // Declared action surface. The face shows this; the LLM picks
  // The body of the being. The dancer's only act is to step. The
  // seed `do` tool is exposed automatically (canDo non-empty); the
  // LLM calls do({action: "harmony:step", args: {direction}}) and
  // the op handler resolves gridSpaceId from the dancer's position.
  // No toolNames field. The role spec IS its can* lists.
  canDo: [
    {
      action: "harmony:step",
      description:
        "Step one cell. args: { direction: 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW' }. " +
          "To stay in place, emit no tool call — that is a SEE, the substrate's " +
          "honest record of 'I looked and did not act.' Out-of-bounds picks throw " +
          "at the substrate; pick a legalMove.",
    },
  ],

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
