// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// set-being-roleflow — write a roleFlow onto a being's qualities.
//
// The roleFlow is the per-being composition program: an array of
// clauses each declaring "when this condition holds, the active role
// stack picks this role; modifiers stack on top." resolveActiveStack
// (in roleFlow.js) walks this array on every moment-open to compose
// the active role for that moment.
//
// Why a dedicated op? roleFlow is technically writable through
// set-being:qualities.roleFlow already, but:
//
//   1. The shape is structured (array of clauses with strict fields),
//      not a free-form quality blob, so authoring needs schema-aware
//      validation: every clause must declare `role: string`, optional
//      `when` and `stack` fields. A typoed `tack: true` instead of
//      `stack: true` silently breaks stacking with no error.
//
//   2. The roleflow-composer LLM helper writes here. Surface a clear,
//      typed op so the helper can target it and the substrate's
//      structured-args layer renders a proper form in the portal.
//
//   3. Referenced role names should exist. Surface unknown-role
//      warnings at write-time rather than at moment-open time where
//      the clause silently fails to match.
//
// Clauses pass through to qualities.roleFlow verbatim once validated.
// The condition vocabulary (operators, composites, the `me.*`, `space.*`,
// `world.*`, `time.*` paths) is defined in roleFlow.js; that file is
// the source of truth for what `when` may contain. This op doesn't
// re-validate `when` here . the moment-assign evaluator handles unknown
// operators and missing context paths by failing the clause closed
// (silent skip). Future tightening can move validation up to write-time.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getRole } from "../registry.js";
import { doVerb } from "../../../ibp/verbs/do.js";
import { targetsFact } from "../../../ibp/factResult.js";

registerOperation("set-being-roleflow", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    beingId: {
      type:     "text",
      label:    "Target being id (omit when targeting a stance directly)",
      required: false,
    },
    roleFlow: {
      type:     "json",
      label:    "roleFlow . array of clauses { when?, role, stack? }",
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
    // roleflow-composer helper passes it when authoring against a
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
        "set-being-roleflow: could not resolve target being (pass params.beingId or address a being stance).",
      );
    }

    const flow = params?.roleFlow;
    if (!Array.isArray(flow)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-being-roleflow: `roleFlow` must be an array of clauses.",
      );
    }

    const validated = [];
    const unknownRoles = [];
    for (let i = 0; i < flow.length; i++) {
      const clause = flow[i];
      if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-being-roleflow: clause[${i}] must be an object.`,
        );
      }
      const role = clause.role;
      if (typeof role !== "string" || !role) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-being-roleflow: clause[${i}].role must be a non-empty string.`,
        );
      }
      // Surface unknown-role warnings . don't fail. The role may be
      // added moments later (live authoring is iterative).
      if (!getRole(role)) unknownRoles.push(role);

      const out = { role };
      if (clause.when !== undefined && clause.when !== null) out.when = clause.when;
      if (clause.stack === true) out.stack = true;
      // Ignore unknown keys silently. Tightening later: reject unknown
      // top-level fields the way set-render does. For now lenience
      // helps the LLM helper iterate without spurious rejections.
      validated.push(out);
    }

    // Route the actual write through set-being so the fact stamps on
    // the target being's reel. We're a thin typed front; the reducer +
    // projection pipeline handles materialization.
    await doVerb(
      { kind: "being", id: beingId },
      "set-being",
      { field: "qualities.roleFlow", value: validated, merge: false },
      { identity, moment },
    );

    return targetsFact({
      written:       true,
      beingId,
      clauseCount:   validated.length,
      unknownRoles:  unknownRoles.length ? unknownRoles : undefined,
      notes:         params?.notes || undefined,
    }, { kind: "being", id: beingId });
  },
});
