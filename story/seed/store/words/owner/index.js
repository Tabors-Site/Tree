// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The owner word pair — set-owner / remove-owner, carved from materials/space/ops.js. Both are
// WORD-SOLE (handler-less): each registers a `word` descriptor + ownerHostEnv; do.js's runOpWord
// resolves the `.word`, runs it with the standard trigger, and stampsWordFact promotes the
// word-authored factParams + factTarget (the space). The auth + per-space lock + CAS stay the
// FLOOR in ownership.js (setOwner / removeOwner), reached as `see` escapes (ownerHost.js). One
// fact per call (applySetField folds owner). Imported for side effects by genesis.js.
import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { ownerHostEnv } from "./ownerHost.js";

registerAbleWord("space", "set-owner", new URL("./set-owner.word", import.meta.url));
registerAbleWord("space", "remove-owner", new URL("./remove-owner.word", import.meta.url));

// set-owner — COMPOSITE (runAsStore): the `.word` gates the ownership auth (may-set-owner), then
// `do set-space {field:owner}` — the set-space LEAF lays the fact in its own moment. No own fact;
// the deed IS the fact. The unified word model: set-owner is a gated set-space ("apple is do"), not
// an own-fact op returning a block for the dispatcher to stamp.
registerOperation("set-owner", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  args: {
    newOwnerId: { type: "text", label: "New owner being id", required: true },
  },
  word: { noun: "space", runAsStore: true },
  hostEnv: ownerHostEnv,
});

// remove-owner — COMPOSITE (runAsStore): the `.word` gates (may-remove-owner), then `do set-space
// {field:owner, value:null}` — the set-space LEAF clears the owner in its own moment. Like set-owner:
// no own fact, the deed IS the fact, the chain shows do:set-space {field:owner}.
registerOperation("remove-owner", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  args: {},
  word: { noun: "space", runAsStore: true },
  hostEnv: ownerHostEnv,
});
