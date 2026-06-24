// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// set-being-flow — write a flow onto a being's qualities.
//
// The flow is the per-being composition program: an array of
// clauses each declaring "when this condition holds, the active able
// stack picks this able; modifiers stack on top." resolveActiveStack
// (in flow.js) walks this array on every moment-open to compose
// the active able for that moment.
//
// Why a dedicated op? flow is technically writable through
// set-being:qualities.flow already, but:
//
//   1. The shape is structured (array of clauses with strict fields),
//      not a free-form quality blob, so authoring needs schema-aware
//      validation: every clause must declare `able: string`, optional
//      `when` and `stack` fields. A typoed `tack: true` instead of
//      `stack: true` silently breaks stacking with no error.
//
//   2. The flow-composer LLM helper writes here. Surface a clear,
//      typed op so the helper can target it and the substrate's
//      structured-args layer renders a proper form in the portal.
//
//   3. Referenced able names should exist. Surface unknown-able
//      warnings at write-time rather than at moment-open time where
//      the clause silently fails to match.
//
// Clauses pass through to qualities.flow verbatim once validated.
// The condition vocabulary (operators, composites, the `me.*`, `space.*`,
// `world.*`, `time.*` paths) is defined in flow.js; that file is
// the source of truth for what `when` may contain. This op doesn't
// re-validate `when` here . the moment-assign evaluator handles unknown
// operators and missing context paths by failing the clause closed
// (silent skip). Future tightening can move validation up to write-time.
//
// WORD-SOLE (handler-less, Tabor's no-mirror law): set-being-flow.word is the ONLY op path (do.js
// runOpWord runs it). The CONTROL strand (the `flow`-required gate + the return) is the .word; the
// genuine compute + the able-registry READ — resolve the target being (params.beingId else the being
// target), validate the clause-array SHAPE, and the getAble unknown-able warning — are the host
// see-op resolve-set-being-flow-spec (setBeingFlowHost.js), reaching the SAME getAble the old handler
// called. The .word AUTHORS its fact: it returns { beingId, factParams } where factParams is the EXACT
// shape the retired handler returned via stampsFact — { field: "qualities.flow", value: <validated>,
// merge: false }. do.js's runOpWord (stampsWordFact, idFrom:"beingId") lays the ONE do:set-being-flow
// fact on the being's reel; applySetQualities folds it (set-being-flow is in SET_ACTIONS), exactly as
// the inner write did. (Was: an inline handler validating + returning stampsFact = the same one fact;
// the validation now lives behind the floor read, byte-identical.)

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { setBeingFlowHostEnv } from "./setBeingFlowHost.js";

// Self-register the co-located world strand so resolveAbleWord("being", "set-being-flow") finds it.
registerAbleWord("being", "set-being-flow", new URL("./set-being-flow.word", import.meta.url));

registerOperation("set-being-flow", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  args: {
    beingId: {
      type:     "text",
      label:    "Target being id (omit when targeting a stance directly)",
      required: false,
    },
    flow: {
      type:     "json",
      label:    "flow . array of clauses { when?, able, stack? }",
      required: true,
    },
    notes: {
      type:     "multiline",
      label:    "Optional author notes (round-trips on the fact, not the qualities)",
      required: false,
    },
  },
  word: { noun: "being", able: "being", idFrom: "beingId" },
  hostEnv: setBeingFlowHostEnv,
});
