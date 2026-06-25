// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The llm-connection word cluster — registration only (handler-less, Tabor's no-mirror law).
// Each op's `.word` IS the op; the host floor (llmHost.js → connect.js E6 kernels) computes +
// bakes the set-being params; the dispatcher stamps. A connection is ONE fact however rich (the
// spacebar). Carved from materials/being/ops.js.
//
// FOUR WORD-SOLE ops, two shapes:
//
//   • update / delete — ATOMIC one-fact words. The `.word` returns the merged/unset set-being
//     params as `factParams` + the target `beingId`; runOpWord (do.js) runs it in the caller's
//     ONE moment and promotes factParams + the being target (read from result.beingId via idFrom)
//     via stampsWordFact. Registered `word: { noun:"being", idFrom:"beingId" }`.
//
//   • add / assign-llm-slot — MULTI-MOMENT composites. add.word does `do set-being` (record the
//     connection) then `If first, do assign-llm-slot` (make it main); assign-llm-slot.word does a
//     conditional `do` (set-being for a being slot / set-space for a space slot). Each deed must
//     seal as its OWN moment / fact / commit, so they register `word: { ..., runAsStore:true }`:
//     do.js's runOpWordToStore runs the `.word` through runWordToStore (per-act moments) and wraps
//     the result in ranAsMoments — the op lays NO fact of its own; its deeds lay theirs.
//
// All compute the words can't do inline goes through EXISTING SEE floor reads in llmHost.js
// (resolve-connection / resolve-connection-update / resolve-connection-removal / resolve-slot-
// assignment — the closed set). No new floor names. (The legacy post-fact client-cache bust the
// handlers did was a cache invalidation, not a fact — a fold-hook is its proper home; the
// handler-less path drops it, as create-space / create-matter carry none.)

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { llmHostEnv } from "./llmHost.js";

registerAbleWord("being", "update-llm-connection", new URL("./update-llm-connection.word", import.meta.url));
registerAbleWord("being", "delete-llm-connection", new URL("./delete-llm-connection.word", import.meta.url));
registerAbleWord("being", "add-llm-connection", new URL("./add-llm-connection.word", import.meta.url));
registerAbleWord("being", "assign-llm-slot", new URL("./assign-llm-slot.word", import.meta.url));
registerAbleWord("space", "assign-llm-slot", new URL("./assign-llm-slot.word", import.meta.url));

// update-llm-connection — WORD-SOURCED, atomic. update-llm-connection.word returns the merged
// set-being params as `factParams` + the target `beingId`; runOpWord promotes both (the fact
// lands on the being, identical to the old stampsFact(result, factParams) on the call-target).
registerOperation("update-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "set-being",
  word: { noun: "being", idFrom: "beingId" },
  hostEnv: llmHostEnv,
});

// delete-llm-connection — WORD-SOURCED, atomic. Returns the unset set-being params (value:null)
// as `factParams` + the target `beingId`. The slot-clears run-on is dropped (the dangling ref folds).
registerOperation("delete-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "set-being",
  word: { noun: "being", idFrom: "beingId" },
  hostEnv: llmHostEnv,
});

// add-llm-connection — WORD-SOURCED, MULTI-MOMENT composite (do.js discovers it via wordHasDeeds). add.word lays TWO deeds:
// `do set-being` (the connection) then `If $conn.isFirst, do assign-llm-slot` (auto-assign-to-main)
// — each its OWN moment / fact via runWordToStore. The op lays NO own fact (runOpWordToStore wraps
// the result in ranAsMoments). Host floor: resolve-connection (validate / SSRF / encrypt / mint /
// isFirst). No factAction — the deeds carry their own (set-being, assign-llm-slot).
registerOperation("add-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  word: { noun: "being" },
  hostEnv: llmHostEnv,
});

// assign-llm-slot — WORD-SOURCED, MULTI-MOMENT composite (runAsStore), POLYMORPHIC (being / space).
// assign-llm-slot.word issues ONE CONDITIONAL DEED ($a.isBeing → do set-being / $a.isSpace → do
// set-space), the chosen deed its own moment via runWordToStore. The branch flags come from the host
// floor resolve-slot-assignment (which reads the target kind). The op lays NO own fact (ranAsMoments).
registerOperation("assign-llm-slot", {
  targets: ["being", "space"],
  ownerExtension: "seed",
  word: { noun: "being" },
  hostEnv: llmHostEnv,
});
