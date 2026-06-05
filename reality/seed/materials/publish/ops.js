// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// publish/ops.js — DO operations for replicate + graft.
//
//   replicate-subtree  — extract a subtree's current shape into a bundle
//   graft-replicate    — apply a bundle into a target subtree
//
// Both ops run inside the wrapping moment and emit substrate facts via
// the create-space / be:birth / create-matter handlers' fact-emission
// path. The ops themselves do not seal; they piggyback on the caller's
// summon moment (or sealFacts singleton when called standalone).

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "../_targetShape.js";

// ─────────────────────────────────────────────────────────────────────
// replicate-subtree
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id }  — the scope root to replicate
// params: { name?, sourceReality? }
//
// Returns: { bundle }  (the bundle is the substrate's wire payload)

async function replicateSubtreeHandler({ target, params, identity, summonCtx }) {
  const kind = detectTargetKind(target);
  if (kind !== "space") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `replicate-subtree: target must be a space (got ${kind})`,
    );
  }
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "replicate-subtree: identity required (the operator's beingId)",
    );
  }
  const scopeSpaceId = targetIdOf(target);
  const branch = summonCtx?.branch || "0";

  const { replicateSubtree } = await import("./replicate.js");
  const bundle = await replicateSubtree(scopeSpaceId, {
    branch,
    scopeName:       (params || {}).name || null,
    sourceReality:   (params || {}).sourceReality || null,
    operatorBeingId: String(identity.beingId),
  });

  // Stamp a provenance fact on the scope root's reel. The act records
  // "this subtree was replicated by <operator> at <time>"; the bundle
  // returns separately as the wire payload so its bytes don't blow up
  // the fact. Without this, the moment seals with no facts and sealAct
  // refuses (see beats/4-stamped.js "SEE moment, not an act" guard).
  const { emitFact } = await import("../../past/fact/facts.js");
  await emitFact({
    verb:    "do",
    action:  "replicate-stamped",
    beingId: String(identity.beingId),
    target:  { kind: "space", id: scopeSpaceId },
    params:  {
      scopeName:  (params || {}).name || null,
      sourceReality: (params || {}).sourceReality || null,
      counts: {
        spaces: bundle.content.spaces.length,
        beings: bundle.content.beings.length,
        matter: bundle.content.matter.length,
      },
      createdAt: bundle.meta.createdAt,
    },
    actId:   summonCtx?.actId || null,
    branch,
  }, summonCtx);

  return { bundle, _skipAudit: true };
}

registerOperation("replicate-subtree", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "replicate-subtree",
  // The handler stamps its own provenance fact (`replicate-stamped`);
  // the dispatcher's auto-audit would only duplicate that — and would
  // also embed the bundle bytes into the fact's `result`, which is
  // exactly what we want to avoid.
  skipAudit: true,
  handler: replicateSubtreeHandler,
});

// ─────────────────────────────────────────────────────────────────────
// graft-replicate
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id }  — the target parent (insertion point)
// params: { bundle }              — the replicate bundle to apply
//
// Returns: { rootSpaceId, counts, remapTable }

async function graftReplicateHandler({ target, params, identity, summonCtx }) {
  const kind = detectTargetKind(target);
  if (kind !== "space") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `graft-replicate: target must be a space (got ${kind})`,
    );
  }
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "graft-replicate: identity required (the operator's beingId)",
    );
  }
  const { bundle } = params || {};
  if (!bundle) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "graft-replicate: params.bundle is required",
    );
  }
  const targetParentSpaceId = targetIdOf(target);
  const branch = summonCtx?.branch || "0";

  const { graftReplicate } = await import("./graft.js");
  const result = await graftReplicate(bundle, targetParentSpaceId, {
    branch,
    operatorBeingId: String(identity.beingId),
    summonCtx,
  });

  // The graft already stamped a `graft-completed` fact on the new
  // root's reel; we don't need the dispatcher to stamp a second audit
  // fact. _skipAudit suppresses it.
  return { ...result, _skipAudit: true };
}

registerOperation("graft-replicate", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "graft-replicate",
  skipAudit: true,
  handler: graftReplicateHandler,
});
