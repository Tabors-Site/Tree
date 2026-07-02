// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// setBeingFlowHost.js — the floor see-op for set-being-flow.word (able-manager/flowOp.js, the
// set-being-flow DO op).
//
// The CONTROL strand (the `flow`-required gate + the return) is the .word; the genuine compute +
// substrate READ this op needs are one host see-op, `resolve-set-being-flow-spec`:
//   - resolve the TARGET being (params.beingId wins — the flow-composer helper passes it when
//     authoring against a being it isn't standing as; else the {kind:"being",id} verb target),
//   - validate the flow CLAUSE ARRAY shape (every clause an object with a non-empty `able` string;
//     normalize each to { able[, when][, stack:true] }, dropping unknown keys — the structured
//     validation the Word grammar can't express, exactly the set-render precedent's host compute),
//   - read the able REGISTRY via getAble for the non-fatal `unknownAbles` warning (a able may be
//     authored moments later — surface, don't fail).
// It REUSES the SAME primitives the JS handler called (getAble); it reimplements nothing. The .word
// reaches it through `see`; the dispatcher lays the one do:set-being-flow fact from the returned
// factParams. A host throw is the .word's refusal — a READ: it validates, resolves, and RETURNS; it
// lays no fact and mutates nothing. Mirrors set-render's validate-render-block (setRenderHost.js).
//
// THE BLOCK it returns is { beingId, factParams, clauseCount, unknownAbles } where factParams is the
// EXACT fact shape the handler returned via stampsFact before this conversion:
//   { field: "qualities.flow", value: <validated clauses>, merge: false }
// applySetQualities folds it onto the being's qualities.flow (set-being-flow is in SET_ACTIONS),
// exactly as the inner write did. beingId is the fact TARGET (the .word promotes it via
// idFrom:"beingId"); clauseCount + unknownAbles ride the RESULT to the asker, never the fact.

import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getAble } from "../../../present/ables/registry.js";

export function setBeingFlowHostEnv() {
  return {
    // resolve-set-being-flow-spec(target, params) — the genuine compute + able-registry read.
    // The .word's `If no flow` gate runs FIRST; this re-states the array-type guard so a non-array
    // surfaces the SAME clean IbpError. Returns { beingId, factParams } + the warning fields. NO fact.
    "resolve-set-being-flow-spec": async ({ args: [target, params] }) => {
      // Resolve the target being. Explicit params.beingId wins (the flow-composer helper passes it
      // when authoring against a being it's not standing as). Otherwise the verb's target is the
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

      // ONE act, ONE fact (23.md): the canonical do:set-being-flow fact carries the flow as a
      // qualities.flow set; the being reducer folds it via applySetQualities (set-being-flow is in
      // SET_ACTIONS). The fact bytes are byte-identical to the pre-conversion handler's stampsFact.
      return {
        beingId,
        factParams: { field: "qualities.flow", value: validated, merge: false },
        clauseCount: validated.length,
        unknownAbles: unknownAbles.length ? unknownAbles : undefined,
      };
    },
  };
}
