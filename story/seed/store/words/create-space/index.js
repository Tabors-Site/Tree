// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do create-space` — bring a new space into a place (target is the parent space,
// or a stance whose resolved position gives the parent). One fact per birth — the
// spacebar lift: the compute is the taps (lays nothing), the dispatcher's single
// do:create-space stamp is the finished mark.
//
// WIRED bundle (mirrors store/words/create-matter/index.js): create-space's world
// strand is create.word — the handler runs it through the bridge (resolveAbleWord ->
// runAbleWord, CALLER mode, host escapes wired by spaceHost.js). Per Tabor's NO-JS-
// FALLBACK rule the `.word` IS the implementation: on a clean miss the op REFUSES
// (a disabled/gone word = the op is gone — executability is a fold), it does NOT fall
// through to a shadow JS body (the duplication the Word dissolves).
//
// Carved out of materials/space/ops.js, which still owns set-space, end-space,
// make-heaven, and add-reigning.
//
// The op does NOT self-emit: resolve-birth-space computes the enriched birth spec +
// the uuid while HOLDING the parent-lock (released on moment.afterSeal so it brackets
// the stamp), the handler returns them as _factParams + _factTarget, and the
// dispatcher's one auto-Fact path lays the caller-attributed do:create-space fact,
// target forced to the new space. owner/heaven are SEPARATE words (next moments).

import { registerOperation } from "../../../ibp/operations.js";
import { stampsWordFact } from "../../../ibp/factResult.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { detectTargetKind } from "../../../materials/_targetShape.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge
// resolves ("space", "create-space") to create.word, its host escapes wired by
// spaceHost.js. Registered at module load (services.js imports this file at boot).
registerAbleWord("space", "create-space", new URL("./create.word", import.meta.url));

// create-space's world strand is create.word: the actor gate, the resolve-birth-space
// compute (via the host), and the return. CALLER mode (no `through`): the create
// attributes to the asker. Returns the stampsWordFact result, or null on a clean miss.
async function _createSpaceViaWord({ target, params, caller, moment }) {
  if (!moment) return null;
  const { resolveAbleWord, runAbleWord } = await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("space", "create-space", moment?.actorAct?.history);
  if (!ir) return null;
  const { spaceHostEnv } = await import("./spaceHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runAbleWord(ir, {
      moment, history,
      trigger: {
        target,
        targetKind: detectTargetKind(target),
        params: params || {},
        caller: caller ? String(caller) : null,
        branch: history,
      },
      env: { host: spaceHostEnv() },
    });
    if (!result) return null;
    // The .word authored its fact as `factParams` (the enriched birth spec the space
    // reducer folds). Land it: the dispatcher lays the one caller-attributed
    // do:create-space fact, targeting the new SPACE (stampsWordFact forces _factTarget,
    // since resolveAuditTarget would otherwise pick the bare parent). No self-emit.
    return stampsWordFact(result, "space", "spaceId");
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function createSpaceHandler(ctx) {
  const { target, params, identity, moment } = ctx;
  // THE CONVERSION: create-space's world strand is create.word (caller mode).
  // NO JS fallback (Tabor) — on a clean miss the op refuses.
  const viaWord = await _createSpaceViaWord({ target, params, caller: identity?.beingId, moment });
  if (!viaWord) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "create-space: create.word is not available on this history",
    );
  }
  return viaWord;
}

registerOperation("create-space", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  factAction: "create-space",
  args: {
    name: { type: "text", label: "Name (kebab-case)", required: true },
    type: { type: "text", label: "Type (optional, e.g. 2d / 3d)", required: false },
    size: { type: "json", label: "Size (optional)", required: false, placeholder: '{"x":50,"y":50}' },
  },
  handler: createSpaceHandler,
});
