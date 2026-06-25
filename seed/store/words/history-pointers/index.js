// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// history-pointers store bundle. Carved from history-manager/ops.js.
//
// The two named-pointer registry ops — set-pointer / delete-pointer —
// plus their co-located `.word` slices. The pointer map lives on the
// `.histories` heaven space's qualities.pointers. The IBP address parser
// resolves named pointers (#main, #prod) through this map via
// resolveHistoryPointers (the wire-layer async step). Canonical paths
// (#0, #1a2) bypass.
//
// WORD-SOURCED (handler-less, Tabor's no-mirror law): neither op has a JS
// handler. Each op's world strand IS its `.word` — set-pointer is
// history-manager.word, delete-pointer is delete-pointer.word — the ONLY
// path. Each registers a `word` descriptor ({ noun:"being", able:
// "history-manager" }) + its hostEnv (historyManagerHostEnv); the
// dispatcher's generic runOpWord (do.js) resolves the `.word`, runs it with
// the standard trigger { name, canonical, caller, branch }, and stamps the
// one caller-attributed audit fact (do:set-pointer / do:delete-pointer) on
// the call target — the .word's own `replace ... qualities.pointers` is the
// lone WORLD write. There is no `_xViaWord` adapter and no JS body — the
// per-op wiring collapsed into the one generic word-dispatch path, so this
// file is registration only. On a clean miss runOpWord REFUSES (a gone word
// = the op is gone — executability is a fold), it does NOT fall through to a
// shadow JS body (the duplication the Word dissolves).
//
// These ops were briefly hosted on a dedicated @history-registry
// delegate; retired 2026-06-04 when "heaven never branches" landed.
// The storage is heaven; the ops live with the history-manager
// workflow they participate in (merging frequently re-points main).

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { historyManagerHostEnv } from "./historyManagerHost.js";

// Self-register this bundle's co-located `.word` slices (CONVERTING.md): importing
// this module (at seed boot, or in a DRY harness) registers them so resolveAbleWord(
// "history-manager", "set-pointer") finds it. do.js's runOpWord resolves the word by
// its able key ("history-manager") + op name, runs its CONTROL strand through
// runAbleWord with historyManagerHostEnv (the ONLY path).
registerAbleWord(
  "history-manager",
  "set-pointer",
  new URL("./history-manager.word", import.meta.url),
);
registerAbleWord(
  "history-manager",
  "delete-pointer",
  new URL("./delete-pointer.word", import.meta.url),
);

// set-pointer — WORD-SOURCED. history-manager.word's CONTROL strand (caller gate,
// name/canonical validation, .histories resolution) runs through runOpWord in CALLER
// mode (no `through` — the pointer write attributes to the setter). The two regex
// validators + the heaven reads + the lone set-space onto qualities.pointers are the
// host escapes wired by historyManagerHost.js. The .word returns
// {set,name,canonical,previous}; no idFrom, so the dispatcher's auto-Fact lands on the
// call target (the acting being / stance), carrying the call params.
registerOperation("set-pointer", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  args: {
    name: {
      type: "text",
      label: 'Pointer name (e.g. "main", "prod", "release-v2")',
      required: true,
    },
    canonical: {
      type: "text",
      label:
        'Canonical history path the pointer should resolve to (e.g. "0", "7", "1a2")',
      required: true,
    },
  },
  word: { noun: "being", able: "history-manager" },
  hostEnv: historyManagerHostEnv,
});

// delete-pointer — WORD-SOURCED. delete-pointer.word's CONTROL strand (caller gate,
// valid name, non-reserved name, .histories resolution) runs through runOpWord in
// CALLER mode. The heaven read + the lone pointer-map set-space stay host. Returns
// {name,deleted,alreadyAbsent}; the auto-Fact lands on the call target.
registerOperation("delete-pointer", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  args: {
    name: {
      type: "text",
      label: "Pointer name to delete",
      required: true,
    },
  },
  word: { noun: "being", able: "history-manager" },
  hostEnv: historyManagerHostEnv,
});
