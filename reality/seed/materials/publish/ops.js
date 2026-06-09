// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// publish/ops.js — DO operations for clone + graft.
//
//   clone-subtree      — extract a subtree's current shape into a portable
//                        clone bundle (facts-only, no acts)
//   graft-clone        — apply a clone bundle into a target subtree
//
// Both ops run inside the wrapping moment and emit substrate facts via
// the create-space / be:birth / create-matter handlers' fact-emission
// path. The ops themselves do not seal; they piggyback on the caller's
// summon moment (or sealFacts singleton when called standalone).
//
// Wire compatibility aliases (kept until the portal / client surface
// migrates to clone-* naming):
//
//   replicate-subtree → clone-subtree
//   graft-replicate   → graft-clone
//
// Both alias names dispatch to the same handlers; they're registered
// here so existing portal calls don't break during the rename arc.
// Remove after the portal UI updates land. See seed/Chain-Rebuild.md
// for the vocabulary doctrine that drove this rename.

import { registerOperation } from "../../ibp/operations.js";
import { registerSeeOperation } from "../../ibp/seeOps.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "../_targetShape.js";
import { loadOrFold } from "../projections.js";
import { listClones, getClone } from "./cloneRegistry.js";

// ─────────────────────────────────────────────────────────────────────
// clone-subtree
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id }  — the scope root to clone
// params: { name?, sourceReality? }
//
// Returns: { bundle }  (the bundle is the substrate's wire payload)

// clone-subtree is a pure READ — extracts the subtree's current shape
// into a portable clone bundle. No state changes; no Fact emitted.
// SEE op (doctrinal shape).

registerSeeOperation("clone-subtree", {
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
        "clone-subtree: identity required (the operator's beingId)",
      );
    }
    const scopeSpaceId = args?.spaceId;
    if (!scopeSpaceId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "clone-subtree: `spaceId` is required");
    }
    const { cloneSubtree } = await import("./clone.js");
    const bundle = await cloneSubtree(scopeSpaceId, {
      branch: branch || "0",
      scopeName:       args?.name || null,
      sourceReality:   args?.sourceReality || null,
      operatorBeingId: String(identity.beingId),
    });
    return { bundle };
  },
});

// ─────────────────────────────────────────────────────────────────────
// graft-clone
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id }  — the target parent (insertion point)
// params: { bundle }              — the clone bundle to apply
//
// Returns: { rootSpaceId, counts, remapTable }

async function graftCloneHandler({ target, params, identity, summonCtx }) {
  const kind = detectTargetKind(target);
  if (kind !== "space") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `graft-clone: target must be a space (got ${kind})`,
    );
  }
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "graft-clone: identity required (the operator's beingId)",
    );
  }
  const { bundle } = params || {};
  if (!bundle) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "graft-clone: params.bundle is required",
    );
  }
  const targetParentSpaceId = targetIdOf(target);
  const branch = summonCtx?.branch || "0";

  const { graftClone } = await import("./graft.js");
  const result = await graftClone(bundle, targetParentSpaceId, {
    branch,
    operatorBeingId: String(identity.beingId),
    summonCtx,
  });

  // The graft already stamped a `graft-completed` fact on the new
  // root's reel; we don't need the dispatcher to stamp a second audit
  // fact. _skipAudit suppresses it.
  return { ...result, _skipAudit: true };
}

registerOperation("graft-clone", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "graft-clone",
  skipAudit: true,
  args: {
    bundle: { type: "json", label: "Clone bundle (paste JSON)", required: true },
  },
  handler: graftCloneHandler,
});

// Wire-compat alias: portal calls reality.do(addr, "graft-replicate", ...).
// Same handler; remove after portal updates to graft-clone.
registerOperation("graft-replicate", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "graft-replicate",
  skipAudit: true,
  handler: graftCloneHandler,
});

// ─────────────────────────────────────────────────────────────────────
// capture-seed
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id: <space root id> } OR a heaven space
// params: { realityName? }
//
// Captures the FULL reality (facts + acts + branches + reelHeads) as a
// portable seed and saves it to reality/seeds/ on the server. Returns
// { savedTo, counts }. Authority-only — the caller must be a contributor
// of the place root (which is gate-equivalent to "I am authorized to
// represent this reality"). Clone, by contrast, can be called by any
// authenticated being because it downloads bytes to the client.

async function captureSeedHandler({ target, params, identity, summonCtx }) {
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "capture-seed: identity required",
    );
  }

  // Authority gate: caller must be a heaven contributor. Heaven is
  // the I-Am's room; heaven contributors are the beings the I-Am has
  // admitted to act on the reality's behalf. Forming a seed bakes the
  // full reality identity into a portable artifact saved on the
  // server's disk; only heaven contributors should be able to. The
  // earlier "rootOperator" terminology collapsed into "is heaven
  // contributor" — one roster, no parallel state.
  const { isHeavenContributor } = await import("../space/heavenLineage.js");
  if (!(await isHeavenContributor(identity.beingId))) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "capture-seed: only heaven contributors may form a seed of the reality.",
    );
  }

  const { captureSeed } = await import("./seed.js");
  const result = await captureSeed({
    capturedBy: String(identity.beingId),
    realityName: (params || {}).realityName || null,
  });

  return {
    savedTo: result.savedTo,
    counts: result.bundle.meta.counts,
    _skipAudit: true,
  };
}

registerOperation("capture-seed", {
  // Accepts either the place root or a heaven space — both surfaces are
  // "authority surfaces" for the reality. Target identity isn't load-
  // bearing; the handler reads the place root regardless.
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "capture-seed",
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
  handler: () => ({ clones: listClones() }),
});

// ─────────────────────────────────────────────────────────────────────
// graft-clone-by-name — graft a registered extension clone by name
// ─────────────────────────────────────────────────────────────────────
//
// target: { kind: "space", id } — the insertion-point
// params: { name: "<ext>:<localName>", params?: { ... } }
//
// Returns: { rootSpaceId, counts, remapTable }
//
// Wrapper around graft-clone that looks the bundle up in the clone
// registry instead of accepting the bundle JSON over the wire. The
// portal calls this after the operator picks a clone from the list.

async function graftCloneByNameHandler({ target, params, identity, summonCtx }) {
  const kind = detectTargetKind(target);
  if (kind !== "space") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `graft-clone-by-name: target must be a space (got ${kind})`,
    );
  }
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "graft-clone-by-name: identity required (the operator's beingId)",
    );
  }
  const name = (params || {}).name;
  if (typeof name !== "string" || !name.length) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "graft-clone-by-name: params.name (clone fullName) is required",
    );
  }
  const entry = getClone(name);
  if (!entry) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `graft-clone-by-name: clone "${name}" not registered`,
    );
  }
  const targetParentSpaceId = targetIdOf(target);
  const branch = summonCtx?.branch || "0";
  const { graftClone } = await import("./graft.js");
  const result = await graftClone(entry.bundle, targetParentSpaceId, {
    branch,
    operatorBeingId: String(identity.beingId),
    params: (params || {}).params || {},
    summonCtx,
  });
  return { ...result, _skipAudit: true };
}

registerOperation("graft-clone-by-name", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "graft-clone-by-name",
  skipAudit: true,
  args: {
    name:   { type: "text", label: "Clone name", required: true },
    params: { type: "json", label: "Parameter values (optional)", required: false },
  },
  handler: graftCloneByNameHandler,
});
