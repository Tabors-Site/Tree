// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The llm-connection word cluster — each op lays its set-being fact through the dispatcher
// (skipAudit gone, no self-emit). A connection is ONE fact however rich (the spacebar). The
// host floor (llmHost.js → connect.js E6 kernels) computes + bakes the set-being params; the
// `.word` returns them; the dispatcher stamps. Carved from materials/being/ops.js.
//
// WORD-SOURCED, all four (Tabor's no-mirror law — NO JS handler on any). Two execution models,
// both driven by do.js straight from the op's `word` descriptor:
//   update + delete — ATOMIC: one set-being fact. runOpWord runs the `.word` via runAbleWord
//     (the caller's one moment) and promotes its factParams + the being target (idFrom) via
//     stampsWordFact. One word, one fact.
//   add + assign-llm-slot — MULTI-MOMENT composites (the "apple is: do, do, do" shape). Each deed
//     must RE-FACT as its OWN act→fact at the head, so do.js routes word.runAsStore through
//     runWordToStore (each deed its own moment, the trail hardening behind — never a multi-mark
//     stamp) and the op lays no own fact (ranAsMoments). No _xViaWord adapter, no JS body.
// (The old post-fact LLM client-cache bust is dropped on all four — a cache invalidation is not a
// fact; a fold-hook on the llmConnection fact is its proper home. Flagged for that follow-up.)

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { llmHostEnv } from "./llmHost.js";

registerAbleWord("being", "update-llm-connection", new URL("./update-llm-connection.word", import.meta.url));
registerAbleWord("being", "delete-llm-connection", new URL("./delete-llm-connection.word", import.meta.url));
registerAbleWord("being", "add-llm-connection", new URL("./add-llm-connection.word", import.meta.url));
registerAbleWord("being", "assign-llm-slot", new URL("./assign-llm-slot.word", import.meta.url));
registerAbleWord("space", "assign-llm-slot", new URL("./assign-llm-slot.word", import.meta.url));

// update-llm-connection — WORD-SOURCED. update-llm-connection.word returns the merged
// set-being params as `factParams` plus the target `beingId`; runOpWord promotes both
// (stampsWordFact reads result.beingId via idFrom → the fact lands on the being, identical to
// the old stampsFact(result, factParams) which resolved the being from the call-target).
registerOperation("update-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "set-being",
  word: { noun: "being", idFrom: "beingId" },
  hostEnv: llmHostEnv,
});

// delete-llm-connection — WORD-SOURCED. delete-llm-connection.word returns the unset
// set-being params (value:null) as `factParams` plus the target `beingId`. The old
// slot-clears run-on is already dropped (the dangling ref folds); one fact.
registerOperation("delete-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "set-being",
  word: { noun: "being", idFrom: "beingId" },
  hostEnv: llmHostEnv,
});

// add-llm-connection — WORD-SOURCED (the MULTI-MOMENT proof; the "apple is: do, do, do, do"
// shape). add.word's deeds — `do set-being` (the connection) then `If $conn.isFirst, do
// assign-llm-slot` (auto-assign-to-main) — each RE-FACT as their OWN act→fact at the head:
// do.js routes op.word.runAsStore through runWordToStore (runOpWordToStore) so each deed seals
// its own moment, the trail hardening behind, never a multi-mark stamp. The op lays NO own fact
// (ranAsMoments; the deeds ARE the facts). No JS handler, no _addViaWord adapter — the .word IS
// the op. (The old post-fact LLM client-cache bust is dropped, as update/delete already did — a
// fold-hook on the llmConnection fact is its proper home; flagged for that follow-up.)
registerOperation("add-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  word: { noun: "being", runAsStore: true },
  hostEnv: llmHostEnv,
});

// assign-llm-slot — WORD-SOURCED, MULTI-MOMENT + POLYMORPHIC (being / space). The `.word` issues
// ONE CONDITIONAL DEED (only the matching branch fires: set-being or set-space), and runAsStore
// routes it through runWordToStore so that chosen deed seals as its OWN moment. `noun: "being"`
// is purely the resolution key — assign-llm-slot.word is registered under BOTH the being and
// space ablewords (above), pointing at the same file, so the one descriptor resolves for either
// target and the `.word` self-branches on targetKind. The op lays no own fact (ranAsMoments).
// When add.word's `do assign-llm-slot` deed calls this, the nesting is runWordToStore inside
// runWordToStore — each deed still its own moment, the model consistent across the chain.
registerOperation("assign-llm-slot", {
  targets: ["being", "space"],
  ownerExtension: "seed",
  word: { noun: "being", runAsStore: true },
  hostEnv: llmHostEnv,
});
