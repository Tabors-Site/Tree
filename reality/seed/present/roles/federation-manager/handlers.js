// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federation-manager handlers. Incoming SUMMON intent dispatch from
// peer realities. The role's summon() shim calls handleIncomingIntent
// which routes by intent name; each handler updates local negotiation
// state in qualities and returns the response payload that flows back
// to the peer via the moment's inner face.
//
// Six intents (see role.js header for the wire shape):
//   offer-graft     . peer offers a subtree to graft into this reality
//   accept-graft    . peer accepted our offer; we should deliver the bundle
//   reject-graft    . peer rejected our offer
//   deliver-bundle  . peer delivers a previously-accepted bundle
//   request-subtree . peer asks us to push them one of our subtrees
//   graft-result    . peer reports the outcome of a delivered bundle
//
// State mutation uses doVerb on the federation-manager being itself
// (nested under the outer moment, so it does not consume an extra
// op slot). The handlers do not initiate cross-reality dispatch; the
// operator's accept-offer / accept-request DO ops handle that. The
// split keeps the handlers deterministic and the negotiation pause-able
// at the operator's review step.

import log from "../../../seedReality/log.js";

const QUALITIES_NAMESPACE = "qualities.federation";

export async function handleIncomingIntent(intent, message, ctx) {
  switch (intent) {
    case "offer-graft":
      return await handleOfferGraft(message, ctx);
    case "accept-graft":
      return await handleAcceptGraft(message, ctx);
    case "reject-graft":
      return await handleRejectGraft(message, ctx);
    case "deliver-bundle":
      return await handleDeliverBundle(message, ctx);
    case "request-subtree":
      return await handleRequestSubtree(message, ctx);
    case "graft-result":
      return await handleGraftResult(message, ctx);
    default:
      log.warn("FederationManager", `unknown intent "${intent}"`);
      return {
        kind:   "failure",
        ok:     false,
        shape:  "invalid",
        reason: `unknown intent "${intent}"`,
      };
  }
}

// ────────────────────────────────────────────────────────────────────
// Handlers.
// ────────────────────────────────────────────────────────────────────

// PEER -> US. A peer offers a subtree to graft into our reality. We
// record the offer (manifest + sender identity) and return a
// "pending-review" response. The operator reviews via do:accept-offer
// or do:reject-offer; nothing grafts automatically in v1.
async function handleOfferGraft(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "offer-graft missing negotiationId");

  const manifest = message?.manifest || null;
  const sender = {
    beingId: ctx?.askerBeingId || null,
    reality: ctx?.askerReality || null,
  };

  await writeNegotiation(ctx, "pendingIncomingOffers", negotiationId, {
    sender,
    manifest,
    // The offered bundle's identity (meta.bundleHash). deliver-bundle
    // must reproduce it or the graft refuses cold — what the operator
    // reviewed is what lands, cryptographically.
    bundleHash:         message?.bundleHash || null,
    label:              message?.label || null,
    sourceSubtreePath:  message?.sourceSubtreePath || null,
    receivedAt:         iso(ctx),
  });

  return {
    kind:    "act",
    ok:      true,
    content: `federation: offer recorded for negotiation ${negotiationId.slice(0, 8)} (pending review)`,
  };
}

// PEER -> US. A peer accepted our outbound push. Read the cached
// bundle, fire deliver-bundle (one-way; we don't await graft outcome
// because the SUMMON return path only carries the receiver's
// descriptor as inner face, not the result value — that's how
// runVerbAsForeignActor / protocol.js wrap acks). The peer's
// handleDeliverBundle grafts AND fires a separate graft-result SUMMON
// back at us; handleGraftResult seals the negotiation when that
// arrives. Two cross reality steps, each a clean one-way.
async function handleAcceptGraft(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "accept-graft missing negotiationId");

  const outbound = await readBucket(ctx, "pendingOutbound", negotiationId);
  const bundle   = await readBucket(ctx, "bundleCache",     negotiationId);
  if (!outbound)        return failure("invalid", `no pendingOutbound[${negotiationId}]`);
  if (!bundle)          return failure("invalid", `no cached bundle for negotiation "${negotiationId}"`);
  if (!outbound.peer)   return failure("invalid", `outbound record missing peer reality`);

  await dispatchToPeer(ctx, outbound.peer, {
    intent:        "deliver-bundle",
    negotiationId,
    bundle,
  });

  await advanceOutbound(ctx, negotiationId, "delivered");

  // Clear cached bundle. The graft happens on the peer; we don't
  // need our copy after handoff. graft-result will seal the negotiation.
  await setQualityField(ctx, `bundleCache.${negotiationId}`, null);

  return { kind: "act", ok: true, content: "federation: Bundle delivered; awaiting graft-result. (" + negotiationId.slice(0,8) + ")" };
}

// Read one entry from qualities.federation.<bucket>[id] on the LOCAL
// federation-manager being. For cross reality incoming SUMMONs, the
// asker is the foreign federation-manager (ctx.actorAct.beingIn);
// the LOCAL receiver is beingOut. State lives on the local being.
async function readBucket(ctx, bucket, key) {
  const branch    = ctx?.actorAct?.branch || "0";
  const myBeingId = ctx?.actorAct?.beingOut || ctx?.actorAct?.beingIn;
  if (!myBeingId) return null;
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", String(myBeingId), branch);
  if (!slot) return null;
  const q = slot.state?.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const fed = qualities?.federation || {};
  const bucketMap = fed[bucket] || {};
  return bucketMap[key] || null;
}

// Outbound cross-reality SUMMON from inside a handler. Uses the
// federation-manager itself as the actor (the moment's beingIn) so
// the canopy round trip is signed federation-manager to federation-
// manager. Fire and forget at this layer; the protocol's correlation
// is the negotiationId, not the wire return.
async function dispatchToPeer(ctx, peerReality, message) {
  const { v4: uuidv4 } = await import("uuid");
  const { crossRealityDispatch } = await import("../../../ibp/crossWorld.js");
  // Use the local federation-manager (beingOut) as actor — not the
  // foreign asker (beingIn). The cross reality act we open is OUR
  // outbound dispatch.
  const myBeingId = ctx?.actorAct?.beingOut || ctx?.actorAct?.beingIn;
  const branch    = ctx?.actorAct?.branch || "0";
  if (!myBeingId) {
    throw new Error("dispatchToPeer: no actorAct in ctx");
  }
  // Federation payload rides inside content (canonical SUMMON fields
  // are the only ones preserved through inbox enqueue — see ops.js
  // dispatchToPeer for the same shape).
  const envelope = {
    id:      uuidv4(),
    verb:    "summon",
    address: `${peerReality}/@federation-manager`,
    payload: {
      message: {
        from:    "/@federation-manager",
        content: { kind: "federation", ...message },
      },
    },
  };
  return await crossRealityDispatch({
    envelope,
    actor:    { beingId: myBeingId, branch },
    identity: { beingId: myBeingId, name: "federation-manager" },
  });
}

// PEER -> US. A peer rejected our outbound push. Record + seal.
async function handleRejectGraft(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "reject-graft missing negotiationId");

  await completeOutbound(ctx, negotiationId, {
    success: false,
    reason:  message?.reason || "peer rejected",
  });

  return { kind: "act", ok: true, content: "federation: Rejection recorded. (" + negotiationId.slice(0,8) + ")" };
}

// PEER -> US. A peer delivers a bundle for a negotiation we previously
// accepted via accept-offer. We graft, seal the incoming offer, and
// fire graft-result back at the sender as a separate cross reality
// SUMMON so they can seal their outbound. graftClone's manifest gate
// handles missing-extension refusals.
async function handleDeliverBundle(message, ctx) {
  const negotiationId = message?.negotiationId;
  const bundle = message?.bundle;
  if (!negotiationId) return failure("invalid", "deliver-bundle missing negotiationId");
  if (!bundle)        return failure("invalid", "deliver-bundle missing bundle");

  let result = null;
  let error  = null;
  try {
    // ── The accepted thing IS the delivered thing ──
    // The offer carried the bundle's identity (meta.bundleHash); the
    // operator reviewed THAT manifest. If the delivered bundle's hash
    // doesn't match the pinned offer, someone swapped the bundle
    // between review and delivery — refuse before graftClone runs
    // (which would ALSO catch internal tampering via its own
    // recompute; this pin catches wholesale substitution).
    const offer = await readBucket(ctx, "pendingIncomingOffers", negotiationId);
    if (offer?.bundleHash) {
      const delivered = bundle?.meta?.bundleHash || null;
      if (delivered !== offer.bundleHash) {
        throw new Error(
          `delivered bundle is not the offered bundle: offer pinned ` +
          `${offer.bundleHash.slice(0, 16)}…, delivery carries ${String(delivered).slice(0, 16)}…`,
        );
      }
    }

    const { graftClone } = await import("../../../materials/publish/graft.js");
    const targetParentSpaceId = await resolveDefaultGraftParent(ctx);
    // The local federation-manager being grafts on its own authority.
    // operatorBeingId is the audit-trail attribution (GRAFT_INITIATOR
    // fact author + Act actor); for federation grafts that's the
    // federation-manager itself, not the foreign asker.
    const operatorBeingId = ctx?.actorAct?.beingOut || ctx?.actorAct?.beingIn;
    result = await graftClone(bundle, targetParentSpaceId, { operatorBeingId });
  } catch (err) {
    error = err.message || String(err);
    log.warn("FederationManager", `graft failed for ${negotiationId}: ${error}`);
  }

  const success = !!result && !error;
  const summary = success ? summarizeGraftResult(result) : null;

  await completeIncomingOffer(ctx, negotiationId, { success, summary, error });

  // Notify the sender so they can seal their outbound. askerReality is
  // the canopy-verified home reality of whoever sent deliver-bundle to
  // us (the sender). One-way SUMMON; sender's handleGraftResult does
  // the bookkeeping.
  const senderReality = ctx?.askerReality || null;
  if (senderReality) {
    try {
      await dispatchToPeer(ctx, senderReality, {
        intent:        "graft-result",
        negotiationId,
        success,
        summary,
        error,
      });
    } catch (err) {
      log.warn("FederationManager",
        `graft-result notify failed for "${negotiationId}" to ${senderReality}: ${err.message}`);
    }
  }

  return {
    kind:    "act",
    ok:      true,
    content: success ? `federation: graft complete (${negotiationId.slice(0, 8)})` : `federation: graft failed (${negotiationId.slice(0, 8)}): ${error}`,
  };
}

// PEER -> US. A peer asks us to push them one of our subtrees. Record
// the request and return "pending-review"; the operator decides via
// do:accept-request (which fires push-subtree back to the requester)
// or do:reject-request.
async function handleRequestSubtree(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "request-subtree missing negotiationId");

  const subtreePath = message?.subtreePath;
  if (!subtreePath) return failure("invalid", "request-subtree missing subtreePath");

  const puller = {
    beingId: ctx?.askerBeingId || null,
    reality: ctx?.askerReality || null,
  };

  await writeNegotiation(ctx, "pendingIncomingRequests", negotiationId, {
    puller,
    subtreePath,
    label:      message?.label || null,
    receivedAt: iso(ctx),
  });

  return { kind: "act", ok: true, content: "federation: Pull request recorded; awaiting operator review. (" + negotiationId.slice(0,8) + ")" };
}

// PEER -> US. The peer reports the outcome of a bundle we delivered.
// Terminal: seal the outbound negotiation.
async function handleGraftResult(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "graft-result missing negotiationId");

  await completeOutbound(ctx, negotiationId, {
    success: !!message?.success,
    summary: message?.summary || null,
    error:   message?.error   || null,
  });

  return { kind: "act", ok: true, content: "federation: Result recorded; negotiation sealed. (" + negotiationId.slice(0,8) + ")" };
}

// ────────────────────────────────────────────────────────────────────
// State helpers. Each writes one field into qualities.federation.<bucket>
// via doVerb nested under the outer moment. doVerb's _inOp guard means
// these do not consume additional op slots.
// ────────────────────────────────────────────────────────────────────

async function writeNegotiation(ctx, bucket, negotiationId, value) {
  await setQualityField(ctx, `${bucket}.${negotiationId}`, value);
}

async function advanceOutbound(ctx, negotiationId, lastStep) {
  // Re-read is awkward without async coupling; v1 just merges the new
  // step onto the bucket entry. The reducer's nested set handles partial
  // updates within a quality object.
  await setQualityField(ctx, `pendingOutbound.${negotiationId}.lastStep`, lastStep);
  await setQualityField(ctx, `pendingOutbound.${negotiationId}.updatedAt`, iso(ctx));
}

async function completeOutbound(ctx, negotiationId, outcome) {
  await setQualityField(ctx, `completed.${negotiationId}`, {
    direction:   "outbound",
    completedAt: iso(ctx),
    ...outcome,
  });
  await setQualityField(ctx, `pendingOutbound.${negotiationId}`, null);
}

async function completeIncomingOffer(ctx, negotiationId, outcome) {
  await setQualityField(ctx, `completed.${negotiationId}`, {
    direction:   "incoming",
    completedAt: iso(ctx),
    ...outcome,
  });
  await setQualityField(ctx, `pendingIncomingOffers.${negotiationId}`, null);
}

async function setQualityField(ctx, subPath, value) {
  // The actor for the qualities write is the LOCAL federation-manager
  // (the moment's receiver = beingOut), not the asker. For cross
  // reality incoming SUMMONs the asker is the foreign federation
  // manager, who has no grants on this reality and would deny the
  // doVerb authorize. The local federation-manager has angel granted
  // at boot via ensureSeedDelegates and is the natural authority over
  // its own qualities.
  const myBeingId = ctx?.actorAct?.beingOut || ctx?.actorAct?.beingIn;
  if (!myBeingId) {
    log.warn("FederationManager", "setQualityField: no actorAct.beingOut/beingIn in ctx; skipping write");
    return;
  }
  const { doVerb } = await import("../../../ibp/verbs/do.js");
  await doVerb(
    { kind: "being", id: String(myBeingId) },
    "set-being",
    {
      field: `${QUALITIES_NAMESPACE}.${subPath}`,
      value,
    },
    {
      identity:      { beingId: myBeingId, name: "federation-manager" },
      summonCtx:     ctx,
      currentBranch: ctx?.actorAct?.branch || null,
    },
  );
}

// Resolve the default graft target. v1 grafts under the place root;
// future versions can route via the offer's manifest or an operator
// policy (different incoming sources to different subtrees).
async function resolveDefaultGraftParent(ctx) {
  const branch = ctx?.actorAct?.branch || "0";
  const { findRoot } = await import("../../../materials/projections.js");
  const roots = await findRoot("space", branch);
  return roots?.[0]?.id || null;
}

function summarizeGraftResult(result) {
  if (!result || typeof result !== "object") return null;
  // graftClone's return shape is { rootSpaceId, counts: { spaces,
  // beings, matter, facts }, verified: { bundle, casBlobs, chain } }.
  // Surface a compact summary including the verification verdicts so
  // the sender's completed record shows the transfer was PROVEN, not
  // just finished.
  return {
    graftedRootId: result.rootSpaceId || null,
    spaces:        result.counts?.spaces || 0,
    beings:        result.counts?.beings || 0,
    matter:        result.counts?.matter || 0,
    facts:         result.counts?.facts  || 0,
    verified:      result.verified || null,
  };
}

function iso(ctx) {
  // Prefer the moment's seal time when threaded so the reducer remains
  // deterministic; fall back to the ctx's date or null.
  return ctx?.actorAct?.date
    ? new Date(ctx.actorAct.date).toISOString()
    : null;
}

function failure(shape, reason) {
  return {
    kind:  "failure",
    ok:    false,
    shape,
    reason,
  };
}
