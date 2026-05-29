// harmony:dancer-llm — LLM-cognition dancer.
//
// Doctrine — the being IS its perspective.
//
// The face is built fresh every summon by the seed's assembler
// (seed/present/voices/llm/assemble.js → buildPrompt). The
// assembler renders:
//
//   identity      "I am <name>, harmony:dancer-llm at <space>."
//   preloaded     fresh resolution of every entry in role.see.
//                 The dancer declares `see: ["harmony:neighbors"]`;
//                 the registered resolver below reads the live grid
//                 fold and returns "[Your view] at (x,y). N=...,
//                 NE=..., walls=...". This is the dancer's eyes for
//                 the moment.
//   capabilities  rendered list of canDo. The dancer can ONLY
//                 harmony:step.
//   body          this file's prompt(ctx) — base instructions plus
//                 the per-being persona injected from
//                 qualities.harmony.persona.
//   time          ISO timestamp of this moment.
//
// The being doesn't ask for its view through a SEE tool. The view
// is what it IS for this instant. It only acts: one harmony:step.
//
// LlmConnection resolves through the seed's 4-layer chain (the
// reality-default pinned by set-reality-llm carries the dancer).

import mongoose from "mongoose";
import { runTurn } from "../../../seed/present/voices/llm/runTurn.js";
import { registerSeeResolver } from "../../../seed/present/voices/llm/seeResolvers.js";
import { foldGridLive, loadGridBounds } from "../lib/foldGrid.js";
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

// Side-effect: register the dancer's eye on module load. The
// resolver is registered under the qualified key
// "harmony:neighbors"; roles reference it the same way.
registerSeeResolver("neighbors", async (ctx) => {
  const beingId = String(ctx.being?._id || "");
  const gridSpaceId =
    (ctx.being?.position && String(ctx.being.position)) ||
    (ctx.being?.homeSpace && String(ctx.being.homeSpace)) ||
    null;
  if (!beingId || !gridSpaceId) return null;

  let board, bounds;
  try {
    board = await foldGridLive(gridSpaceId);
    bounds = await loadGridBounds(gridSpaceId);
  } catch (err) {
    log.warn("DancerLlm", `see-resolver fold failed: ${err.message}`);
    return null;
  }

  const me = board.get(beingId);
  if (!me) return "[Your view] You are not yet placed on the grid.";

  const gw = bounds.gridW === Infinity ? "∞" : bounds.gridW;
  const gh = bounds.gridH === Infinity ? "∞" : bounds.gridH;

  const occupants = new Map();
  for (const [bid, pos] of board.entries()) {
    occupants.set(`${pos.x},${pos.y}`, bid);
  }

  const walls = [];
  const neighborIds = new Set();
  const neighborByDir = {};
  for (const d of DIRS) {
    const nx = me.x + d.dx;
    const ny = me.y + d.dy;
    const oob =
      bounds.gridW !== Infinity &&
      (nx < 0 || nx >= bounds.gridW || ny < 0 || ny >= bounds.gridH);
    if (oob) {
      walls.push(d.key);
      neighborByDir[d.key] = "WALL";
      continue;
    }
    const occ = occupants.get(`${nx},${ny}`);
    if (occ && occ !== beingId) {
      neighborByDir[d.key] = occ;
      neighborIds.add(occ);
    } else {
      neighborByDir[d.key] = "empty";
    }
  }

  if (neighborIds.size > 0) {
    const Being = mongoose.model("Being");
    const rows = await Being
      .find({ _id: { $in: [...neighborIds] } })
      .select("_id name")
      .lean();
    const nameById = new Map(rows.map((r) => [String(r._id), r.name]));
    for (const k of Object.keys(neighborByDir)) {
      const v = neighborByDir[k];
      if (v !== "empty" && v !== "WALL") {
        neighborByDir[k] = `@${nameById.get(v) || v.slice(0, 8)}`;
      }
    }
  }

  const lines = [];
  lines.push("[Your view]");
  lines.push(`You are at (${me.x}, ${me.y}) on a ${gw}×${gh} grid.`);
  lines.push("Neighbors (8 cells around you):");
  for (const d of DIRS) {
    lines.push(`  ${d.key.padEnd(2)} → ${neighborByDir[d.key]}`);
  }
  if (walls.length > 0) {
    lines.push(`Walls (do not step into these): ${walls.join(", ")}`);
  }
  return lines.join("\n");
}, "harmony");

const BASE_PROMPT = `You are a dancer on a grid. The drum has struck; this is your one moment to step.

You can see what's around you above ([Your view]). You MUST call the \`step\` tool exactly once this turn. Do not reply with text alone — text without a step call is wasted; the loop will reject the turn and force a retry.

Pick exactly one of these directions and pass it to step:

  N, NE, E, SE, S, SW, W, NW, STAY

STAY is a real choice (the tool still fires, the dancer holds). Picking a direction in your "Walls" list gets clamped by the bump rule — prefer an open direction. Pick with intent.

After the tool call you may add one short sentence about your choice; that sentence becomes the visible record of this moment in your act-chain.`;

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
  // exactly one call per moment. Names are bare ("step") — inside
  // this extension you don't prefix with the extension name.
  canDo: ["step"],
  canSummon: [],
  canBe: [],
  canSee: [],

  // Presentism. Every tick is a fresh "now" — the face is rebuilt
  // from substrate each summon (identity + see-resolvers +
  // capabilities + persona), so prior-turn conversation history
  // adds no signal and grows the prompt unboundedly across ticks.
  // Without this, a dancer's self-self IBP address would key the
  // same session for every wake and session.messages would stack
  // 2 messages/tick. By tick 30 the prompt is ~30× what it should
  // be and inference latency runs away.
  presentist: true,

  // One step per moment. The summon ends when the step seals.
  maxMessagesBeforeLoop: 2,
  maxToolCallsPerStep: 1,

  // Exit gate. The seed's loop refuses to terminate until `step`
  // fires; if the model emits prose without calling step, the loop
  // injects a corrective system line and re-runs. Without this, a
  // chatty model just narrates ("I step north.") as plain text,
  // the loop exits naturally with no tool_calls, and the dancer
  // never actually moves.
  exit: { requires: "step" },

  // The tool registry's filter list. Only this tool is offered to
  // the LLM. (Tool registration itself happens in extensions/harmony/
  // tools.js via the loader.)
  toolNames: ["step"],

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

  async summon(message, ctx) {
    try {
      const result = await runTurn({
        being:    ctx.toBeing,
        envelope: message,
        role:     dancerLlmRole,
        signal:   ctx.signal,
      });
      // runTurn returns a CognitionResult on success
      // (`{ok:true, content}` per cognitionSuccess) or a
      // noLlmResponse / cognitionFailure (`{content}` or
      // `{ok:false, reason}`). The text we want for the act-chain
      // is `result.content` in all those shapes — `.text` doesn't
      // exist, which is why earlier acts all showed "(no reply)".
      const text =
        (typeof result?.content === "string" && result.content) ||
        (typeof result?.reason === "string" && `cognition failed: ${result.reason}`) ||
        "(no reply)";
      return { text };
    } catch (err) {
      if (ctx.signal?.aborted) return null;
      log.warn("DancerLlm", `LLM call failed: ${err.message}`);
      return { text: `dancer error: ${err.message}` };
    }
  },
});
