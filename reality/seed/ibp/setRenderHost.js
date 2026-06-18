// setRenderHost.js — host-escape glue for the set-render DO op (setRender.js).
//
// THE WALL. set-render's world strand is set-render.word: the target-kind gate,
// the kind dispatch, and the render write (a NATIVE do:set-<kind> at the static
// field qualities.render — NOT a host escape). The ONE genuine host escape is
// validateRenderBlock: pure schema computation (reject unknown top-level keys;
// validate the model / scale / rotation / animations / sounds shapes), which is
// neither a substrate read nor a write. This wires the SAME validateRenderBlock
// the JS handler calls into ctx.env.host — no reimplementation.
//
// callHost invokes it as `fn({ args: [params] }, ctx)` (the parser emits
// `host: validateRenderBlock(params) as block` -> params:{ args:["$params"] }).
// It lays no fact; the WRITE form's set-<kind> acts lay the lone world fact via
// the evaluator's live doVerb path, attributed per the cut (see setRender.js).

import { validateRenderBlock } from "./setRender.js";

export function setRenderHostEnv() {
  return {
    // validateRenderBlock(params) -> the validated render block (throws IbpError
    // on an unknown key or a malformed channel). The SAME function the JS handler
    // calls; pure compute, no fact.
    "validate-render-block": ({ args: [params] }) => validateRenderBlock(params),
  };
}
