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

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getAble } from "../registry.js";
import { stampsFact } from "../../../ibp/factResult.js";

registerOperation("set-being-flow", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
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
  handler: async ({ target, params, identity, moment }) => {
    // Resolve the target being. Explicit beingId in params wins (the
    // flow-composer helper passes it when authoring against a
    // being it's not standing as). Otherwise the verb's target is the
    // being — typed { kind: "being", id } envelope.
    const explicitBeingId = params?.beingId ? String(params.beingId).trim() : null;
    const beingId =
      explicitBeingId ||
      (target && typeof target === "object" && target.kind === "being" && target.id
        ? String(target.id)
        : null);
    if (!beingId) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-being-flow: could not resolve target being (pass params.beingId or address a being stance).",
      );
    }

    const flow = params?.flow;
    if (!Array.isArray(flow)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-being-flow: `flow` must be an array of clauses.",
      );
    }

    const validated = [];
    const unknownAbles = [];
    for (let i = 0; i < flow.length; i++) {
      const clause = flow[i];
      if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-being-flow: clause[${i}] must be an object.`,
        );
      }
      const able = clause.able;
      if (typeof able !== "string" || !able) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-being-flow: clause[${i}].able must be a non-empty string.`,
        );
      }
      // Surface unknown-able warnings . don't fail. The able may be
      // added moments later (live authoring is iterative).
      if (!getAble(able)) unknownAbles.push(able);

      const out = { able };
      if (clause.when !== undefined && clause.when !== null) out.when = clause.when;
      if (clause.stack === true) out.stack = true;
      // Ignore unknown keys silently. Tightening later: reject unknown
      // top-level fields the way set-render does. For now lenience
      // helps the LLM helper iterate without spurious rejections.
      validated.push(out);
    }

    // ONE act, ONE fact (23.md): set-being-flow returns its OWN fact — do:set-being-flow
    // carrying the flow as a qualities.flow set — and the dispatcher stamps it on the target
    // being's reel. The being reducer folds it via applySetQualities (set-being-flow is in
    // SET_ACTIONS), exactly as the inner doVerb(set-being) used to. No inner doVerb, one fact, the fold
    // materializes. (Was: an inner set-being write + a re-targeted audit fact = two facts for one act.)
    return stampsFact({
      written:       true,
      beingId,
      clauseCount:   validated.length,
      unknownAbles:  unknownAbles.length ? unknownAbles : undefined,
      notes:         params?.notes || undefined,
    }, { field: "qualities.flow", value: validated, merge: false }, { kind: "being", id: beingId });
  },
});
