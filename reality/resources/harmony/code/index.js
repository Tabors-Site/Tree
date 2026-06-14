// harmony/code — pack code piece.
//
// Registers the three DO ops + the neighbors SEE op. Role specs and
// the dance-floor seed register themselves through their pieces' kind
// handlers (RESOURCES.md), before this init() runs. Position tracking
// is owned by the seed (PositionProjection + set-being:coord); this
// piece adds only the domain ops and the grid-shaped face for
// dancer-llm.

import tickOp from "./ops/tick.js";
import stepOp from "./ops/step.js";
import walkOp from "./ops/walk.js";
import { neighborsSeeResolver } from "../roles/dancer-llm/role.js";

export async function init(reality) {
  reality.do.registerOperation("tick", tickOp);
  reality.do.registerOperation("step", stepOp);
  reality.do.registerOperation("walk", walkOp);

  reality.declare.registerSeeOperation("neighbors", {
    description: "The dancer's local neighborhood: beings + obstacles.",
    handler: ({ ctx }) => neighborsSeeResolver(ctx),
  });

  return {};
}
