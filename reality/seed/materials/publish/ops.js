// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// publish/ops.js — DO + SEE operations for clone + graft + seed.
//
//   capture-template      — SEE op: extract a subtree's current shape into
//                        a portable clone bundle (facts-only, no acts)
//   plant-template        — DO op: apply a clone bundle into a target subtree
//   plant-template-by-name — DO op: apply an extension-registered clone by name
//   capture-graft       — DO op: capture the FULL reality (facts + acts +
//                        branches + reelHeads) as a portable seed
//   clones             — SEE op: discovery of registered extension clones
//
// Graft ops run inside the wrapping moment and emit substrate facts
// via the create-space / be:birth / create-matter handlers' fact-emission
// path. They do not seal; they piggyback on the caller's summon moment
// (or sealFacts singleton when called standalone).
//
// The earlier `replicate-subtree` / `graft-replicate` wire-compat aliases
// were retired 2026-06-09 when zero portal references remained. See
// seed/done/Chain-Rebuild.md for the vocabulary doctrine (clone vs seed
// as the two-artifact split).

import { registerOperation } from "../../ibp/operations.js";
import { registerSeeOperation } from "../../ibp/seeOps.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "../_targetShape.js";
import { loadOrFold } from "../projections.js";
import { listTemplates, getTemplate } from "./templateRegistry.js";

// ─────────────────────────────────────────────────────────────────────
// capture-template
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id }  — the scope root to clone
// params: { name?, sourceReality? }
//
// Returns: { bundle }  (the bundle is the substrate's wire payload)

// capture-template is a pure READ — extracts the subtree's current shape
// into a portable clone bundle. No state changes; no Fact emitted.
// SEE op (doctrinal shape).

registerSeeOperation("capture-template", {
  ownerExtension: "seed",
  description: "Extract a subtree's current shape into a portable clone bundle",
  args: {
    spaceId:       { type: "text", label: "Scope root space id", required: true },
    name:          { type: "text", label: "Clone name (optional)", required: false },
    sourceReality: { type: "text", label: "Source reality (optional)", required: false },
  },
  handler: async ({ identity, args, branch }) => {
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "capture-template: identity required (the operator's beingId)",
      );
    }
    const scopeSpaceId = args?.spaceId;
    if (!scopeSpaceId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "capture-template: `spaceId` is required");
    }
    const { captureTemplate } = await import("./seedTemplate.js");
    const bundle = await captureTemplate(scopeSpaceId, {
      branch: branch || "0",
      scopeName:       args?.name || null,
      sourceReality:   args?.sourceReality || null,
      operatorBeingId: String(identity.beingId),
    });
    return { bundle };
  },
});

// ─────────────────────────────────────────────────────────────────────
// plant-template
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id }  — the target parent (insertion point)
// params: { bundle }              — the clone bundle to apply
//
// Returns: { rootSpaceId, counts, remapTable }

async function plantTemplateHandler({ target, params, identity, summonCtx }) {
  const kind = detectTargetKind(target);
  if (kind !== "space") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `plant-template: target must be a space (got ${kind})`,
    );
  }
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "plant-template: identity required (the operator's beingId)",
    );
  }
  const { bundle } = params || {};
  if (!bundle) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "plant-template: params.bundle is required",
    );
  }
  const targetParentSpaceId = targetIdOf(target);
  const branch = summonCtx?.actorAct?.branch || "0";

  const { plantTemplate } = await import("./seedPlant.js");
  const result = await plantTemplate(bundle, targetParentSpaceId, {
    branch,
    operatorBeingId: String(identity.beingId),
    summonCtx,
  });

  // The graft already stamped a `template-planted` fact on the new
  // root's reel; we don't need the dispatcher to stamp a second audit
  // fact. _skipAudit suppresses it.
  return { ...result, _skipAudit: true };
}

registerOperation("plant-template", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "plant-template",
  skipAudit: true,
  args: {
    bundle: { type: "json", label: "Clone bundle (paste JSON)", required: true },
  },
  handler: plantTemplateHandler,
});

// ─────────────────────────────────────────────────────────────────────
// capture-graft
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id: <space root id> } OR a heaven space
// params: { realityName? }
//
// Captures the FULL reality (facts + acts + branches + reelHeads) as a
// portable seed and saves it to reality/seeds/ on the server. Returns
// { savedTo, counts }. Authority-only — the caller must have heaven
// authority (owner or angel role on heaven; gate-equivalent to "I am
// authorized to represent this reality"). Clone, by contrast, can be
// called by any authenticated being because it downloads bytes to
// the client.

async function captureSeedHandler({ target, params, identity, summonCtx }) {
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "capture-graft: identity required",
    );
  }

  // Authority gate: caller must have heaven authority. Heaven is the
  // I-Am's room; beings with heaven authority are those the I-Am (or
  // an angel) has admitted via role grant or ownership transfer.
  // Forming a seed bakes the full reality identity into a portable
  // artifact saved on the server's disk; only authorized beings
  // should be able to.
  const { hasHeavenAuthority } = await import("../space/heavenLineage.js");
  if (!(await hasHeavenAuthority(identity.beingId))) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "capture-graft: only beings with heaven authority (owner or angel role) may form a seed of the reality.",
    );
  }

  const { captureGraft } = await import("./graft.js");
  const result = await captureGraft({
    capturedBy: String(identity.beingId),
    realityName: (params || {}).realityName || null,
  });

  return {
    savedTo: result.savedTo,
    counts: result.bundle.meta.counts,
    _skipAudit: true,
  };
}

registerOperation("capture-graft", {
  // Accepts either the place root or a heaven space — both surfaces are
  // "authority surfaces" for the reality. Target identity isn't load-
  // bearing; the handler reads the place root regardless.
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "capture-graft",
  skipAudit: true,
  args: {
    realityName: { type: "text", label: "Reality name (optional)", required: false },
  },
  handler: captureSeedHandler,
});

// ─────────────────────────────────────────────────────────────────────
// clones — discovery surface for extension-shipped clone bundles
// ─────────────────────────────────────────────────────────────────────
//
// SEE op. Pure read: returns the registered clone catalog.
// Used by the portal's graft UI to populate the picker.
//
// Replaces the retired `list-clones` DO+skipAudit op (DO-as-read smell).

registerSeeOperation("clones", {
  ownerExtension: "seed",
  description: "Catalog of registered clone bundles (extension-shipped + operator-captured)",
  handler: () => ({ clones: listTemplates() }),
});

// ─────────────────────────────────────────────────────────────────────
// plant-template-by-name — graft a registered extension clone by name
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id } — the insertion-point
// params: { name: "<ext>:<localName>", params?: { ... } }
//
// Returns: { rootSpaceId, counts, remapTable }
//
// Wrapper around plant-template that looks the bundle up in the clone
// registry instead of accepting the bundle JSON over the wire. The
// portal calls this after the operator picks a clone from the list.

async function plantTemplateByNameHandler({ target, params, identity, summonCtx }) {
  const kind = detectTargetKind(target);
  if (kind !== "space") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `plant-template-by-name: target must be a space (got ${kind})`,
    );
  }
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "plant-template-by-name: identity required (the operator's beingId)",
    );
  }
  const name = (params || {}).name;
  if (typeof name !== "string" || !name.length) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "plant-template-by-name: params.name (clone fullName) is required",
    );
  }
  const entry = getTemplate(name);
  if (!entry) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `plant-template-by-name: clone "${name}" not registered`,
    );
  }
  const targetParentSpaceId = targetIdOf(target);
  const branch = summonCtx?.actorAct?.branch || "0";
  const { plantTemplate } = await import("./seedPlant.js");
  const result = await plantTemplate(entry.bundle, targetParentSpaceId, {
    branch,
    operatorBeingId: String(identity.beingId),
    params: (params || {}).params || {},
    summonCtx,
  });
  return { ...result, _skipAudit: true };
}

registerOperation("plant-template-by-name", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "plant-template-by-name",
  skipAudit: true,
  args: {
    name:   { type: "text", label: "Clone name", required: true },
    params: { type: "json", label: "Parameter values (optional)", required: false },
  },
  handler: plantTemplateByNameHandler,
});

// ─────────────────────────────────────────────────────────────────────
// capture-being  — SEE op (pure READ): a being's identity-preserving
//                  graft bundle (its reel + act-chain + lineage, VERBATIM)
// ─────────────────────────────────────────────────────────────────────
//
// args: { beingId }   Returns: { bundle }
//
// READ-ONLY: assembles the bundle from reads, emits no Fact, mutates
// nothing — the doctrinal SEE shape, same as capture-template.
//
// AUTHORITY-GATED (self OR heaven), unlike capture-template. The reason
// is the hash: a being's be:birth fact folds its WHOLE params into its
// _id (hash.js contentOf), and that params carries qualities.auth.
// privateKeyEnc. So the encrypted key is HASH-BOUND — the bundle MUST
// carry it verbatim or verifyReel breaks on the receiver; it cannot be
// redacted out (the template family can redact precisely because it
// re-mints fresh keys). The encrypted key is reality-bound (AES-GCM via
// HKDF-from-JWT_SECRET — undecryptable on any reality but the source, so
// a graft to elsewhere can't use it; the owner re-imports their key
// there). The gate keeps this otherwise-redacted blob from leaking to
// unauthorized callers. SEE-op returns are NOT auto-redacted (only the
// descriptor/reels are), so the verbatim bundle reaches the caller intact.
//
// Gate breadth, stated plainly: hasHeavenAuthority is coarse by design —
// the first human and their inheritors all carry it, so in a single-
// operator reality this gate reads as "self, or the operator." That is
// the intended breadth (the operator runs migration / backup / federation
// for every being they host); it is NOT a fine-grained per-being grant.
// A narrower "who may export THIS being" capability is a future refinement,
// not a hole — the coarse gate is correct for the sovereign-host model.

registerSeeOperation("capture-being", {
  ownerExtension: "seed",
  description: "Capture a being's identity-preserving graft bundle (reel + act-chain + lineage), verbatim. Authority-gated (self or heaven).",
  args: {
    beingId: { type: "text", label: "Being id (pubkey) to capture", required: true },
  },
  handler: async ({ identity, args }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "capture-being: identity required (the operator's beingId)");
    }
    const beingId = args?.beingId;
    if (!beingId || typeof beingId !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "capture-being: `beingId` is required");
    }
    // Gate: the being itself (sovereign self-export) OR a heaven-authority
    // operator (migration / backup / federation). A being's graft bundle
    // carries its verbatim be:birth fact (with the reality-bound encrypted
    // key), so it is not freely readable.
    const isSelf = String(identity.beingId) === String(beingId);
    if (!isSelf) {
      const { hasHeavenAuthority } = await import("../space/heavenLineage.js");
      if (!(await hasHeavenAuthority(identity.beingId))) {
        throw new IbpError(IBP_ERR.FORBIDDEN, "capture-being: only the being itself or a heaven-authority operator may capture a being's graft bundle.");
      }
    }
    const { captureGraft } = await import("./graft.js");
    const { bundle } = await captureGraft({ beingId: String(beingId), capturedBy: String(identity.beingId), returnOnly: true });
    return { bundle };
  },
});

// ─────────────────────────────────────────────────────────────────────
// graft-being  — DO op (actual mutation): apply a being-graft bundle
//                into THIS (living) reality, identity preserved
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id } — an authority surface (not load-bearing;
//          the being lands at its own verbatim homeSpace ref). Same shape
//          as capture-graft.
// params: { bundle }   Returns: { beingId, mode, counts, verified }
//
// HEAVEN-GATED on the target reality: admitting another being's full chain
// into this reality is a reality-operator decision. applyGraft inserts the
// foreign chain VERBATIM (never emitFact — imported facts are foreign by
// construction) and stamps its own graft-being-completed audit on the
// operator's reel, so skipAudit.

async function graftBeingHandler({ params, identity, summonCtx }) {
  if (!identity?.beingId) {
    throw new IbpError(IBP_ERR.UNAUTHORIZED, "graft-being: identity required (the operator's beingId)");
  }
  const { hasHeavenAuthority } = await import("../space/heavenLineage.js");
  if (!(await hasHeavenAuthority(identity.beingId))) {
    throw new IbpError(IBP_ERR.FORBIDDEN, "graft-being: only beings with heaven authority may graft a being into this reality.");
  }
  const { bundle } = params || {};
  if (!bundle) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "graft-being: params.bundle is required");
  }
  const branch = summonCtx?.actorAct?.branch || "0";
  const { applyGraft } = await import("./graft.js");
  const result = await applyGraft(bundle, { operatorBeingId: String(identity.beingId), branch });
  return { ...result, _skipAudit: true };
}

registerOperation("graft-being", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "graft-being",
  skipAudit: true,
  args: {
    bundle: { type: "json", label: "Being-graft bundle (paste JSON)", required: true },
  },
  handler: graftBeingHandler,
});
