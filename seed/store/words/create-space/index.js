// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do create-space` — bring a new space into a place (target is the parent space,
// or a stance whose resolved position gives the parent). One fact per birth — the
// spacebar lift: the compute is the taps (lays nothing), the dispatcher's single
// do:create-space stamp is the finished mark.
//
// WORD-SOURCED (handler-less, Tabor's no-mirror law): create-space has NO JS handler.
// Its world strand is create.word — the ONLY path. The op registers a `word` descriptor
// ({ noun:"space", idFrom:"spaceId" }) + its `hostEnv` (spaceHostEnv); the dispatcher's
// generic runOpWord (do.js) resolves create.word, runs it with the standard trigger, and
// promotes the word-authored `factParams` (+ the spaceId target) via stampsWordFact. There
// is no `_createSpaceViaWord` adapter and no JS body — the per-op wiring collapsed into the
// one generic word-dispatch path, so this file is registration only.
//
// The compute (resolve-birth-space: name/type/size validation, coord auto-assign, the
// beforeSpaceCreate hook, sibling-name uniqueness, the heaven-parent gate, max-children
// under the parent-lock, the uuid mint) lives in spaceHost.js as the ONE see-escape the
// .word reaches — it lays NO fact (a read of the floor). owner/heaven are SEPARATE words.

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { spaceHostEnv } from "./spaceHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge
// resolves ("space", "create-space") to create.word. Registered at module load
// (services.js imports this file at boot).
registerAbleWord("space", "create-space", new URL("./create.word", import.meta.url));

// WORD-SOURCED registration — no handler. do.js routes this through runOpWord, which runs
// create.word (CALLER mode: no `through`, the create attributes to the asker) and stamps the
// one caller-attributed do:create-space fact, target forced to the new SPACE via idFrom.
registerOperation("create-space", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  factAction: "create-space",
  args: {
    name: { type: "text", label: "Name (kebab-case)", required: true },
    type: { type: "text", label: "Type (optional, e.g. 2d / 3d)", required: false },
    size: { type: "json", label: "Size (optional)", required: false, placeholder: '{"x":50,"y":50}' },
  },
  word: { noun: "space", idFrom: "spaceId" },
  hostEnv: spaceHostEnv,
});
