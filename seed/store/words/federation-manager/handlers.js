// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federation-manager handlers. Incoming SUMMON intent dispatch from
// peer realities. The able's summon() shim calls handleIncomingIntent
// which routes by intent name; each handler updates local negotiation
// state in qualities and returns the response payload that flows back
// to the peer via the moment's inner face.
//
// Seven intents (see able.js header for the wire shape and the
// verb-object naming). Two cargoes: template (shape) and being (entity).
//   offer-template     . peer offers a template to plant in this story
//   accept-template    . peer accepted our offer; we should deliver the bundle
//   reject-template    . peer rejected our offer
//   deliver-template   . peer delivers a previously-accepted template bundle
//   request-template   . peer asks us to send them one of our templates
//   template-result    . peer reports the outcome of a delivered template
//   deliver-being      . peer delivers a being-graft one-shot (auto-accepted,
//                        self-certifying); we graft it verbatim, no review
//
// State mutation uses doVerb on the federation-manager being itself
// (nested under the outer moment, so it does not consume an extra
// op slot). The template handlers do not initiate cross-story dispatch;
// the operator's accept-template / fulfill-request DO ops handle that. The
// split keeps the handlers deterministic and the negotiation pause-able
// at the operator's review step. deliver-being is the exception: it grafts
// immediately, because a being-graft is self-certifying (no review needed).

import log from "../../../seedStory/log.js";

const QUALITIES_NAMESPACE = "qualities.federation";

export async function handleIncomingIntent(intent, message, ctx) {
  switch (intent) {
    case "offer-template":
      return await handleOfferTemplate(message, ctx);
    case "accept-template":
      return await handleAcceptTemplate(message, ctx);
    case "reject-template":
      return await handleRejectTemplate(message, ctx);
    case "deliver-template":
      return await handleDeliverTemplate(message, ctx);
    case "deliver-being":
      return await handleDeliverBeing(message, ctx);
    case "request-template":
      return await handleRequestTemplate(message, ctx);
    case "template-result":
      return await handleTemplateResult(message, ctx);
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

// PEER -> US. A peer offers a template to plant in our story. We
// record the offer (manifest + sender identity) and return a
// "pending-review" response. The operator reviews via do:accept-template
// or do:reject-template; nothing plants automatically in v1.
async function handleOfferTemplate(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "offer-template missing negotiationId");

  const manifest = message?.manifest || null;
  const sender = {
    beingId: ctx?.askerBeingId || null,
    story: ctx?.askerStory || null,
  };

  await writeNegotiation(ctx, "pendingIncomingOffers", negotiationId, {
    sender,
    manifest,
    // The offered bundle's identity (meta.bundleHash). deliver-template
    // must reproduce it or the graft refuses cold — what the operator
    // reviewed is what lands, cryptographically.
    bundleHash:         message?.bundleHash || null,
    label:              message?.label || null,
    sourceSubtreePath:  message?.sourceSubtreePath || null,
    // Inert display witness of when this negotiation record was written
    // (the moment's seal time when threaded, else null). Never an order key.
    at:                 iso(ctx),
  });

  return {
    kind:    "act",
    ok:      true,
    content: `federation: offer recorded for negotiation ${negotiationId.slice(0, 8)} (pending review)`,
  };
}

// PEER -> US. A peer accepted our outbound push. Read the cached
// bundle, fire deliver-template (one-way; we don't await graft outcome
// because the SUMMON return path only carries the receiver's
// descriptor as inner face, not the result value — that's how
// runVerbAsForeignActor / protocol.js wrap acks). The peer's
// handleDeliverTemplate plants AND fires a separate template-result SUMMON
// back at us; handleTemplateResult seals the negotiation when that
// arrives. Two cross story steps, each a clean one-way.
async function handleAcceptTemplate(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "accept-template missing negotiationId");

  const outbound = await readBucket(ctx, "pendingOutbound", negotiationId);
  const bundle   = await readBucket(ctx, "bundleCache",     negotiationId);
  if (!outbound)        return failure("invalid", `no pendingOutbound[${negotiationId}]`);
  if (!bundle)          return failure("invalid", `no cached bundle for negotiation "${negotiationId}"`);
  if (!outbound.peer)   return failure("invalid", `outbound record missing peer story`);

  await dispatchToPeer(ctx, outbound.peer, {
    intent:        "deliver-template",
    negotiationId,
    bundle,
  });

  await advanceOutbound(ctx, negotiationId, "delivered");

  // Clear cached bundle. The graft happens on the peer; we don't
  // need our copy after handoff. template-result will seal the negotiation.
  await setQualityField(ctx, `bundleCache.${negotiationId}`, null);

  return { kind: "act", ok: true, content: "federation: Bundle delivered; awaiting template-result. (" + negotiationId.slice(0,8) + ")" };
}

// Read one entry from qualities.federation.<bucket>[id] on the LOCAL
// federation-manager being. For cross story incoming SUMMONs, the
// asker is the foreign federation-manager (ctx.actorAct.through);
// the LOCAL receiver is `to`. State lives on the local being.
async function readBucket(ctx, bucket, key) {
  const history   = ctx?.actorAct?.history || "0";
  const myBeingId = ctx?.actorAct?.to || ctx?.actorAct?.through;
  if (!myBeingId) return null;
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", String(myBeingId), history);
  if (!slot) return null;
  const q = slot.state?.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const fed = qualities?.federation || {};
  const bucketMap = fed[bucket] || {};
  return bucketMap[key] || null;
}

// Outbound cross-story SUMMON from inside a handler. Uses the
// federation-manager itself as the actor (the moment's `through`) so
// the canopy round trip is signed federation-manager to federation-
// manager. Fire and forget at this layer; the protocol's correlation
// is the negotiationId, not the wire return.
async function dispatchToPeer(ctx, peerStory, message) {
  const { randomUUID: uuidv4 } = await import("node:crypto");
  const { crossStoryDispatch } = await import("../../../ibp/crossWorld.js");
  // Use the local federation-manager (`to`) as actor — not the
  // foreign asker (`through`). The cross story act we open is OUR
  // outbound dispatch.
  const myBeingId = ctx?.actorAct?.to || ctx?.actorAct?.through;
  const history   = ctx?.actorAct?.history || "0";
  if (!myBeingId) {
    throw new Error("dispatchToPeer: no actorAct in ctx");
  }
  // Envelope intent at the wire level (per seed/SUMMON.md). The other
  // federation fields (negotiationId, bundle, summary, etc.) ride in
  // content; the peer's federation-manager.summon reads envelope.intent
  // first to dispatch.
  const { intent: messageIntent, ...rest } = message || {};
  const envelope = {
    id:      uuidv4(),
    verb:    "call",
    address: `${peerStory}/@federation-manager`,
    payload: {
      message: {
        from:    "/@federation-manager",
        intent:  messageIntent || null,
        content: { kind: "federation", ...rest },
      },
    },
  };
  return await crossStoryDispatch({
    envelope,
    actor:    { beingId: myBeingId, history },
    identity: { beingId: myBeingId, name: "federation-manager" },
  });
}

// PEER -> US. A peer rejected our outbound push. Record + seal.
async function handleRejectTemplate(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "reject-template missing negotiationId");

  await completeOutbound(ctx, negotiationId, {
    success: false,
    reason:  message?.reason || "peer rejected",
  });

  return { kind: "act", ok: true, content: "federation: Rejection recorded. (" + negotiationId.slice(0,8) + ")" };
}

// PEER -> US. A peer delivers a BEING-graft (an AGENT — a being's key +
// chain, meant to continue here). Unlike deliver-template (a CONTENT template,
// negotiated via offer/accept review), a being-graft is a ONE-SHOT delivery
// auto-accepted by federation policy: the bundle is self-certifying
// (applyGraft verifies the SOURCE story's signed graftRoot with no
// callback), the canopy signature proves the sender, and the federation-
// manager grafts on its own (reigning) authority. The being lands VERBATIM
// (foreign by construction — imported facts keep foreign hashes). This is
// the peer-to-peer graft path GRAFT-AND-SEED.md / ROOTS.md pin: a being
// crosses between exactly the two realities concerned, never via a catalog.
//
// v1 policy is auto-accept (registering the peer IS the opt-in). An
// accept-list / operator-review policy is a follow-on (flow on the
// federation-manager, mirroring the deliver-template offer/accept path).
async function handleDeliverBeing(message, ctx) {
  const bundle = message?.bundle;
  if (!bundle) return failure("invalid", "deliver-being missing bundle");
  if (!(bundle.kind === "graft" && bundle.meta?.beingId)) {
    return failure("invalid", "deliver-being: bundle is not a being-graft (kind:graft with meta.beingId)");
  }
  // The federation-manager grafts on its own authority (same attribution as
  // deliver-template): operatorBeingId is the audit-fact author, not the
  // foreign sender.
  const operatorBeingId = ctx?.actorAct?.to || ctx?.actorAct?.through;
  try {
    // A delivered being is RECEIVED as a being-reel BOOK — reels only (doctrine: a book carries
    // reels, NOT act-chains; the act-chain is the foreign Name's and stays home; the receiver gets
    // the vessel reel). The receiving story vouches the colophon; the source's graftRoot rides as
    // lineage provenance. (Replaces the retired applyGraft — all in book/receive now.)
    const { makeBook } = await import("../../../store/book/book.js");
    const { sealColophon } = await import("../../../store/book/colophon.js");
    const { receive } = await import("../../../store/book/receive.js");
    const body = { reels: [{ being: bundle.meta.beingId, facts: bundle.facts, reelHeads: bundle.reelHeads, histories: bundle.histories || [] }] };
    if (bundle.casBlobs && Object.keys(bundle.casBlobs).length) {
      body.matter = { casRefs: [], casBlobs: bundle.casBlobs, casManifest: {} }; // blobs hash-verify on the way in
    }
    let book = makeBook(
      { title: `being ${String(bundle.meta.beingId).slice(0, 10)}`, body },
      { sourceStory: bundle.sourceStory, createdBy: operatorBeingId, parent: bundle.meta?.graftRoot || null },
    );
    book = sealColophon(book); // the receiving story vouches
    const result = await receive(book, { history: "0", actorBeingId: operatorBeingId });
    // receive does NOT fold (verbatim instate); trigger the first read so the being is visible to SEE.
    try {
      const { loadOrFold } = await import("../../../materials/projections.js");
      await loadOrFold("being", bundle.meta.beingId, "0");
    } catch { /* fold-on-read will catch up on the next SEE */ }
    log.info("FederationManager",
      `received being ${String(bundle.meta.beingId).slice(0, 12)}… from ${ctx?.askerStory || "?"} ` +
      `as a reel book — ${result.reels} fact(s) landed`);
    return { kind: "act", ok: true, content: `federation: received being ${String(bundle.meta.beingId).slice(0, 10)}… (${result.reels} fact(s))`, result };
  } catch (err) {
    log.warn("FederationManager", `deliver-being receive failed: ${err.message || err}`);
    return failure("receive-failed", err.message || String(err));
  }
}

// PEER -> US. A peer delivers a bundle for a negotiation we previously
// accepted via accept-template. We graft, seal the incoming offer, and
// fire template-result back at the sender as a separate cross story
// SUMMON so they can seal their outbound. plantTemplate's manifest gate
// handles missing-extension refusals.
async function handleDeliverTemplate(message, ctx) {
  const negotiationId = message?.negotiationId;
  const bundle = message?.bundle;
  if (!negotiationId) return failure("invalid", "deliver-template missing negotiationId");
  if (!bundle)        return failure("invalid", "deliver-template missing bundle");

  let result = null;
  let error  = null;
  try {
    // ── The accepted thing IS the delivered thing ──
    // The offer carried the bundle's identity (meta.bundleHash); the
    // operator reviewed THAT manifest. If the delivered bundle's hash
    // doesn't match the pinned offer, someone swapped the bundle
    // between review and delivery — refuse before plantTemplate runs
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

    const { plantTemplate } = await import("../../../store/book/seedPlant.js");
    const targetParentSpaceId = await resolveDefaultPlantParent(ctx);
    // The local federation-manager being plants on its own authority.
    // operatorBeingId is the audit-trail attribution (GRAFT_INITIATOR
    // fact author + Act actor); for federation plants that's the
    // federation-manager itself, not the foreign asker.
    const operatorBeingId = ctx?.actorAct?.to || ctx?.actorAct?.through;
    result = await plantTemplate(bundle, targetParentSpaceId, { operatorBeingId });
  } catch (err) {
    error = err.message || String(err);
    log.warn("FederationManager", `graft failed for ${negotiationId}: ${error}`);
  }

  const success = !!result && !error;
  const summary = success ? summarizeTemplateResult(result) : null;

  await completeIncomingOffer(ctx, negotiationId, { success, summary, error });

  // Notify the sender so they can seal their outbound. askerStory is
  // the canopy-verified home story of whoever sent deliver-template to
  // us (the sender). One-way SUMMON; sender's handleTemplateResult does
  // the bookkeeping.
  const senderStory = ctx?.askerStory || null;
  if (senderStory) {
    try {
      await dispatchToPeer(ctx, senderStory, {
        intent:        "template-result",
        negotiationId,
        success,
        summary,
        error,
      });
    } catch (err) {
      log.warn("FederationManager",
        `template-result notify failed for "${negotiationId}" to ${senderStory}: ${err.message}`);
    }
  }

  return {
    kind:    "act",
    ok:      true,
    content: success ? `federation: graft complete (${negotiationId.slice(0, 8)})` : `federation: graft failed (${negotiationId.slice(0, 8)}): ${error}`,
  };
}

// PEER -> US. A peer asks us to send them one of our templates. Record
// the request and return "pending-review"; the operator decides via
// do:fulfill-request (which fires offer-template back to the requester)
// or do:refuse-request.
async function handleRequestTemplate(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "request-template missing negotiationId");

  const subtreePath = message?.subtreePath;
  if (!subtreePath) return failure("invalid", "request-template missing subtreePath");

  const puller = {
    beingId: ctx?.askerBeingId || null,
    story: ctx?.askerStory || null,
  };

  await writeNegotiation(ctx, "pendingIncomingRequests", negotiationId, {
    puller,
    subtreePath,
    label:      message?.label || null,
    // Inert display witness (seal time when threaded, else null), never order.
    at:         iso(ctx),
  });

  return { kind: "act", ok: true, content: "federation: Pull request recorded; awaiting operator review. (" + negotiationId.slice(0,8) + ")" };
}

// PEER -> US. The peer reports the outcome of a bundle we delivered.
// Terminal: seal the outbound negotiation.
async function handleTemplateResult(message, ctx) {
  const negotiationId = message?.negotiationId;
  if (!negotiationId) return failure("invalid", "template-result missing negotiationId");

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
  // (the moment's receiver = `to`), not the asker. For cross
  // story incoming SUMMONs the asker is the foreign federation
  // manager, who has no grants on this story and would deny the
  // doVerb authorize. The local federation-manager has angel granted
  // at boot via ensureSeedDelegates and is the natural authority over
  // its own qualities.
  const myBeingId = ctx?.actorAct?.to || ctx?.actorAct?.through;
  if (!myBeingId) {
    log.warn("FederationManager", "setQualityField: no actorAct.to/through in ctx; skipping write");
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
      moment:     ctx,
      currentHistory: ctx?.actorAct?.history || null,
    },
  );
}

// Resolve the default plant position (the insertion point). v1 plants under the place root;
// future versions can route via the offer's manifest or an operator
// policy (different incoming sources to different positions).
async function resolveDefaultPlantParent(ctx) {
  const history = ctx?.actorAct?.history || "0";
  const { findRoot } = await import("../../../materials/projections.js");
  const roots = await findRoot("space", history);
  return roots?.[0]?.id || null;
}

function summarizeTemplateResult(result) {
  if (!result || typeof result !== "object") return null;
  // plantTemplate's return shape is { rootSpaceId, counts: { spaces,
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
