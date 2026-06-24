// setRenderHost.js — the see-escape set-render.word reaches (the op's hostEnv).
//
// THE WALL. set-render's world strand is set-render.word — the ONLY path (no JS
// handler). The CONTROL strand (the return) is `.word`. The ONE genuine compute reads
// as a `see`-op (bottoming out in a host fn, but spoken as a see-op, never a `host:`
// escape), a pure compute (NO fact):
//   - validate-render-block(params, kind): validate the target KIND (matter|space|being)
//     + the render block (reject unknown top-level keys; validate model / scale /
//     rotation / animations / sounds — THROWS IbpError on a bad kind or key, surfacing
//     as the op's refusal), then shape the { field:"qualities.render", value, merge }
//     the lone do:set-render fact carries (the SAME shape the retired JS handler laid,
//     which applySetQualities folds unchanged).
// There is NO host: emit and NO write sentence — the word lays no fact of its own. It
// returns the fact params as `factParams`; do.js's runOpWord promotes them to _factParams
// and the ONE auto-Fact path lays the caller-attributed do:set-render fact, its target
// resolved to the DISPATCH target (resolveAuditTarget's call-target fallback) so of.kind
// stays the actual matter|space|being kind.
//
// callHost invokes it as `fn({ args: [params, kind] }, ctx)` (the parser emits
// `see validate-render-block(params, targetKind) as renderParams`). NO reimplementation —
// it reuses the SAME validateRenderBlock the op already exported.

import { validateRenderBlock } from "./setRender.js";

export function setRenderHostEnv() {
  return {
    // validate-render-block(params, kind) -> the do:set-render fact params { field,
    // value, merge } (throws IbpError on a bad kind, an unknown key, or a malformed
    // channel). Pure compute, no fact.
    "validate-render-block": ({ args: [params, kind] }) =>
      validateRenderBlock(params, kind),
  };
}
