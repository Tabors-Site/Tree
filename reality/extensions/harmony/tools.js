// Harmony tools — the LLM-visible action surface.
//
// Doctrine: the dancer's VIEW is built into the face by the seed's
// assembler via `see: ["harmony:neighbors"]` on the role (the
// resolver lives in roles/dancerLlm.js). The LLM does not call a
// SEE tool — it already sees, as part of being assembled this
// moment.
//
// What the LLM CAN call is the one thing it can do: step.
//
//   harmony:step   move one compass direction (or STAY) from
//                  wherever the fold puts the dancer right now.
//
// The dancer's gridSpaceId is resolved server-side from
// being.position; the LLM passes only the direction. The handler
// routes through doVerb on the dancer's own being so auth + audit
// fact stamping run identically to any other DO.

import { z } from "zod";
import { doVerb } from "../../seed/ibp/verbs/do.js";

async function _gridSpaceForBeing(beingId) {
  const Being = (await import("../../seed/materials/being/being.js")).default;
  const b = await Being.findById(String(beingId)).select("position homeSpace").lean();
  return b?.position || b?.homeSpace || null;
}

export const harmonyTools = [
  {
    // Tool names are validated by the seed's tool registry
    // (TOOL_NAME_RE in seed/present/voices/llm/tools.js — lowercase
    // alphanumeric + hyphens + underscores; no colons). Roles inside
    // this extension declare just "step" — no `harmony:` prefix
    // needed when you're already inside harmony.
    name: "step",
    description:
      "Step one cell in a compass direction. Pick exactly one of: " +
      "N, NE, E, SE, S, SW, W, NW, STAY. STAY does nothing. The bump " +
      "rule clamps out-of-bounds picks to the nearest valid cell, but " +
      "prefer not to pick a wall direction (the view section above " +
      "lists your walls).",
    verb: "do",
    schema: {
      direction: z
        .enum(["N","NE","E","SE","S","SW","W","NW","STAY"])
        .describe("Compass direction to step, or STAY."),
      beingId: z.string().describe("Injected by server. Ignore."),
      name:    z.string().optional().describe("Injected by server. Ignore."),
    },
    async handler({ direction, beingId, name }, callCtx) {
      const gridSpaceId = await _gridSpaceForBeing(beingId);
      if (!gridSpaceId) {
        return { stepped: false, reason: "caller has no grid position" };
      }
      return doVerb(beingId, "harmony:step", { gridSpaceId, direction }, {
        identity: callCtx?.identity || (beingId ? { beingId, name } : null),
        summonCtx: callCtx?.summonCtx || null,
      });
    },
  },
];
