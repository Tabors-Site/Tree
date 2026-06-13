// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federation-manager ops. The operator-facing DO surface for transfers
// with peer realities. Two cargoes (template = the shape, fresh ids on
// planting; being = the entity, verbatim id + chain) over one push/pull
// transport. See role.js for the verb-object naming and the one-token-
// two-sides note (an op name and the wire intent it emits coincide).
//
// Seven ops:
//
//   offer-template    . push a template out. Captures a template of the
//                       local subtree, sends offer-template to the peer's
//                       federation-manager, caches the bundle until the
//                       peer accepts.
//
//   offer-being       . push a being out (identity graft). Captures the
//                       being's signed graft bundle and delivers it one-
//                       shot via deliver-being. No offer/accept review.
//
//   request-template  . pull a template. Sends request-template to the
//                       peer. If the peer's operator fulfills, they push
//                       back into us via the offer-template path (the same
//                       receiving code as any other incoming push).
//
//   accept-template   . approve an incoming offer-template. Sends accept-
//                       template back; the sender then delivers the bundle
//                       via deliver-template (which the role handler plants).
//
//   reject-template   . refuse an incoming offer-template. Sends reject-template.
//
//   fulfill-request   . approve an incoming request-template. Captures and
//                       pushes the asked template back at the requester.
//
//   refuse-request    . refuse an incoming request-template. Sends reject-
//                       template (reusing the rejection envelope).
//
// Auth: operator-only by default. canDo on the federation-manager role
// licenses these ops, and the role is granted at the reality root to
// the @federation-manager being itself; the operator addresses
// @federation-manager via SUMMON which dispatches the op. Custom
// operator policy (auto-accept particular peers, throttle pulls, etc.)
// lives in roleFlow on the @federation-manager being.

import { v4 as uuidv4 } from "uuid";
import log from "../../../seedReality/log.js";
import { registerOperation } from "../../../ibp/operations.js";
import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getRealityDomain } from "../../../ibp/address.js";

export function registerFederationManagerOps() {
  // registerOperation / registerSeeOperation calls below run at module
  // load; this is the explicit entry point so genesis.js can import + call
  // it the same way it does for branch-manager / role-manager / llm-assigner.
}

// ────────────────────────────────────────────────────────────────────
// federation-status . SEE op (pure READ): the negotiation queues.
// ────────────────────────────────────────────────────────────────────
//
// The read half of the operator's federation panel. Returns the four
// qualities.federation buckets as flat lists (each entry carries its
// negotiationId as `id`). READ-ONLY: folds the federation-manager being
// and reads its qualities, emits no Fact. Operator-gated (heaven
// authority), since the queues reveal who this reality is negotiating
// with. The DO ops below are how the operator acts on what this surfaces.
registerSeeOperation("federation-status", {
  ownerExtension: "seed",
  description: "Read the federation-manager's negotiation state: incoming offers/requests, outbound in-flight, completed. Operator-gated, read-only.",
  args: {},
  handler: async ({ identity, branch }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "federation-status: identity required");
    }
    const { hasHeavenAuthority } = await import("../../../materials/space/heavenLineage.js");
    if (!(await hasHeavenAuthority(identity.beingId))) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "federation-status: operator (heaven authority) only");
    }
    const { findByName } = await import("../../../materials/projections.js");
    const slot = await findByName("being", "federation-manager", branch);
    const q = slot?.state?.qualities;
    const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : (q || {});
    const fed = qualities.federation || {};
    // Each bucket is a map keyed by negotiationId; flatten to a list and
    // lift the id onto each entry so the panel can address actions by it.
    const asList = (m) => Object.entries(m || {})
      .filter(([, v]) => v != null)
      .map(([id, v]) => (v && typeof v === "object" ? { id, ...v } : { id, value: v }));
    return {
      pendingIncomingOffers:   asList(fed.pendingIncomingOffers),
      pendingIncomingRequests: asList(fed.pendingIncomingRequests),
      pendingOutbound:         asList(fed.pendingOutbound),
      completed:               asList(fed.completed),
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// offer-template . Operator initiates an outbound push.
// ────────────────────────────────────────────────────────────────────

registerOperation("offer-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    peer: {
      type:        "text",
      label:       "Peer reality domain (e.g. \"bing.com\")",
      required:    true,
    },
    subtreePath: {
      type:        "text",
      label:       "Path or space id of the subtree to push",
      required:    true,
    },
    label: {
      type:        "text",
      label:       "Optional human-readable label for the negotiation",
      required:    false,
    },
  },
  handler: async (ctx) => {
    const { peer, subtreePath, label } = ctx.params || {};
    if (!peer || typeof peer !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-template requires `peer`");
    }
    if (!subtreePath || typeof subtreePath !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-template requires `subtreePath`");
    }
    if (peer === getRealityDomain()) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-template: cannot push to local reality");
    }

    const negotiationId = uuidv4();

    // 1. Resolve subtreePath to a spaceId. Accepts both a raw uuid and
    // a slash-separated path.
    const branch = ctx.summonCtx?.actorAct?.branch || "0";
    const spaceId = await resolveSubtreeSpaceId(subtreePath, branch);
    if (!spaceId) {
      throw new IbpError(IBP_ERR.NOT_FOUND,
        `offer-template: subtree "${subtreePath}" not found on branch ${branch}`);
    }

    // 2. Clone locally.
    const { captureTemplate } = await import("../../../materials/publish/seedTemplate.js");
    let bundle;
    try {
      bundle = await captureTemplate(spaceId, { branch });
    } catch (err) {
      throw new IbpError(IBP_ERR.INTERNAL, `captureTemplate failed: ${err.message}`);
    }

    // 3. Cache the bundle + record pendingOutbound state BEFORE
    // dispatching to the peer. This avoids a race where the peer
    // auto-accepts and fires accept-template back at us before our
    // moment seals — without these writes visible first, our
    // handleAcceptGraft would find no cached bundle and refuse.
    await cacheBundle(ctx, negotiationId, bundle);

    const manifest = bundle?.manifest || null;
    // The bundle's identity travels WITH the offer: the receiver pins
    // it, and deliver-template later verifies the delivered bundle
    // recomputes this exact hash. The accepted thing IS the delivered
    // thing, cryptographically — no swap in flight, no bait-and-switch
    // between review and delivery.
    const bundleHash = bundle?.meta?.bundleHash || null;
    await writeNegotiation(ctx, "pendingOutbound", negotiationId, {
      direction:    "push",
      peer,
      subtreePath,
      label:        label || null,
      manifest,
      bundleHash,
      startedAt:    iso(ctx),
      lastStep:     "offer-pending",
    });

    // 4. Send offer-template to the peer's federation-manager. The
    // payload carries only the manifest + bundle hash (cheap
    // rejection step); the bundle ships later via deliver-template on
    // accept.
    await sendIntent(ctx, peer, {
      intent:             "offer-template",
      negotiationId,
      manifest,
      bundleHash,
      label:              label || null,
      sourceSubtreePath:  subtreePath,
    });

    await setQualityField(ctx, `pendingOutbound.${negotiationId}.lastStep`, "offer-sent");

    return {
      negotiationId,
      peer,
      subtreePath,
      status: "offered",
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// offer-being . Operator grafts a BEING to a peer reality.
// ────────────────────────────────────────────────────────────────────
//
// The IDENTITY counterpart to offer-template (which pushes a CONTENT
// template). Captures the being's identity-preserving graft bundle
// (verbatim ids + chain, signed by this reality's key) and delivers it
// one-shot to the peer's federation-manager via deliver-being. No
// offer/accept review: a being-graft is self-certifying (the receiver
// verifies the signed graftRoot, no callback) and the peer auto-accepts
// by federation policy. Peer-to-peer only — never a roots/catalog.
registerOperation("offer-being", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    peer:    { type: "text", label: "Peer reality domain (e.g. \"beta.test\")", required: true },
    beingId: { type: "text", label: "Being id (pubkey) to graft to the peer", required: true },
  },
  handler: async (ctx) => {
    const { peer, beingId } = ctx.params || {};
    if (!peer || typeof peer !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-being requires `peer`");
    }
    if (!beingId || typeof beingId !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-being requires `beingId`");
    }
    if (peer === getRealityDomain()) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-being: cannot graft to the local reality");
    }

    // Capture the being's graft bundle (verbatim, signed by this reality).
    const { captureGraft } = await import("../../../materials/publish/graft.js");
    let bundle;
    try {
      ({ bundle } = await captureGraft({ beingId, capturedBy: ctx.identity?.beingId || null, returnOnly: true }));
    } catch (err) {
      throw new IbpError(IBP_ERR.INTERNAL, `captureGraft failed: ${err.message}`);
    }
    if (!bundle?.meta?.beingId) {
      throw new IbpError(IBP_ERR.NOT_FOUND, `offer-being: being "${beingId.slice(0, 12)}…" has no reel to capture`);
    }

    // One-shot delivery. The bundle's self-certification + the canopy sig
    // are the trust; no negotiation state to cache.
    const negotiationId = uuidv4();
    await sendIntent(ctx, peer, { intent: "deliver-being", negotiationId, bundle });

    return {
      negotiationId,
      peer,
      beingId,
      status: "delivered",
      counts: bundle.meta.counts,
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// request-template . Operator initiates an outbound pull.
// ────────────────────────────────────────────────────────────────────

registerOperation("request-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    peer: {
      type:        "text",
      label:       "Peer reality domain to pull from",
      required:    true,
    },
    subtreePath: {
      type:        "text",
      label:       "Path or space id of the subtree on the peer",
      required:    true,
    },
    label: {
      type:        "text",
      label:       "Optional human-readable label for the negotiation",
      required:    false,
    },
  },
  handler: async (ctx) => {
    const { peer, subtreePath, label } = ctx.params || {};
    if (!peer || typeof peer !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "request-template requires `peer`");
    }
    if (!subtreePath || typeof subtreePath !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "request-template requires `subtreePath`");
    }
    if (peer === getRealityDomain()) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "request-template: cannot pull from local reality");
    }

    const negotiationId = uuidv4();

    await sendIntent(ctx, peer, {
      intent:        "request-template",
      negotiationId,
      subtreePath,
      label:         label || null,
    });

    await writeNegotiation(ctx, "pendingOutbound", negotiationId, {
      direction:   "pull",
      peer,
      subtreePath,
      label:       label || null,
      startedAt:   iso(ctx),
      lastStep:    "request-sent",
    });

    return {
      negotiationId,
      peer,
      subtreePath,
      status: "requested",
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// accept-template . Operator approves an incoming offer-template.
// ────────────────────────────────────────────────────────────────────

registerOperation("accept-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    negotiationId: { type: "text", label: "Negotiation id", required: true },
  },
  handler: async (ctx) => {
    const negotiationId = ctx.params?.negotiationId;
    if (!negotiationId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "accept-template requires `negotiationId`");
    }
    const offer = await readNegotiation(ctx, "pendingIncomingOffers", negotiationId);
    if (!offer) {
      throw new IbpError(IBP_ERR.NOT_FOUND, `no pending offer "${negotiationId}"`);
    }
    if (!offer.sender?.reality) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `offer "${negotiationId}" has no sender reality recorded`);
    }

    await sendIntent(ctx, offer.sender.reality, {
      intent:        "accept-template",
      negotiationId,
    });

    return {
      negotiationId,
      status: "accepted",
      sender: offer.sender,
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// reject-template . Operator refuses an incoming offer-template.
// ────────────────────────────────────────────────────────────────────

registerOperation("reject-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    negotiationId: { type: "text", label: "Negotiation id", required: true },
    reason:        { type: "text", label: "Optional reason", required: false },
  },
  handler: async (ctx) => {
    const negotiationId = ctx.params?.negotiationId;
    if (!negotiationId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "reject-template requires `negotiationId`");
    }
    const offer = await readNegotiation(ctx, "pendingIncomingOffers", negotiationId);
    if (!offer) {
      throw new IbpError(IBP_ERR.NOT_FOUND, `no pending offer "${negotiationId}"`);
    }

    await sendIntent(ctx, offer.sender.reality, {
      intent:        "reject-template",
      negotiationId,
      reason:        ctx.params?.reason || null,
    });

    await completeIncomingOffer(ctx, negotiationId, {
      success: false,
      reason:  ctx.params?.reason || "rejected by operator",
    });

    return {
      negotiationId,
      status: "rejected",
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// fulfill-request . Operator approves an incoming pull request. Runs
// the equivalent of offer-template back at the requester.
// ────────────────────────────────────────────────────────────────────

registerOperation("fulfill-request", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    negotiationId: { type: "text", label: "Negotiation id", required: true },
  },
  handler: async (ctx) => {
    const negotiationId = ctx.params?.negotiationId;
    if (!negotiationId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "fulfill-request requires `negotiationId`");
    }
    const request = await readNegotiation(ctx, "pendingIncomingRequests", negotiationId);
    if (!request) {
      throw new IbpError(IBP_ERR.NOT_FOUND, `no pending request "${negotiationId}"`);
    }
    if (!request.puller?.reality) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `request "${negotiationId}" has no puller reality recorded`);
    }

    // Push the requested subtree back at the puller. Reuses the
    // offer-template code path so the receiver side runs the same
    // offer-template handling regardless of whether the push was operator
    // initiated or pull driven.
    const branch = ctx.summonCtx?.actorAct?.branch || "0";
    const spaceId = await resolveSubtreeSpaceId(request.subtreePath, branch);
    if (!spaceId) {
      throw new IbpError(IBP_ERR.NOT_FOUND,
        `fulfill-request: requested subtree "${request.subtreePath}" not found on branch ${branch}`);
    }

    const { captureTemplate } = await import("../../../materials/publish/seedTemplate.js");
    const bundle = await captureTemplate(spaceId, { branch });
    const pushNegotiationId = uuidv4();
    await cacheBundle(ctx, pushNegotiationId, bundle);

    await sendIntent(ctx, request.puller.reality, {
      intent:             "offer-template",
      negotiationId:      pushNegotiationId,
      manifest:           bundle?.manifest || null,
      label:              request.label || null,
      sourceSubtreePath:  request.subtreePath,
      replyToRequest:     negotiationId,
    });

    await writeNegotiation(ctx, "pendingOutbound", pushNegotiationId, {
      direction:    "push",
      peer:         request.puller.reality,
      subtreePath:  request.subtreePath,
      label:        request.label || null,
      manifest:     bundle?.manifest || null,
      startedAt:    iso(ctx),
      lastStep:     "offer-sent",
      replyToRequest: negotiationId,
    });

    // Mark the request as fulfilled (closed). Outbound's negotiationId
    // is the new one; the original request id is sealed.
    await completeIncomingRequest(ctx, negotiationId, {
      success:                true,
      summary:                { pushNegotiationId },
    });

    return {
      negotiationId,
      pushNegotiationId,
      status:                 "pushing",
      peer:                   request.puller.reality,
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// refuse-request . Operator refuses an incoming pull request.
// ────────────────────────────────────────────────────────────────────

registerOperation("refuse-request", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    negotiationId: { type: "text", label: "Negotiation id", required: true },
    reason:        { type: "text", label: "Optional reason", required: false },
  },
  handler: async (ctx) => {
    const negotiationId = ctx.params?.negotiationId;
    if (!negotiationId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "refuse-request requires `negotiationId`");
    }
    const request = await readNegotiation(ctx, "pendingIncomingRequests", negotiationId);
    if (!request) {
      throw new IbpError(IBP_ERR.NOT_FOUND, `no pending request "${negotiationId}"`);
    }

    await sendIntent(ctx, request.puller.reality, {
      intent:        "reject-template",
      negotiationId,
      reason:        ctx.params?.reason || null,
    });

    await completeIncomingRequest(ctx, negotiationId, {
      success: false,
      reason:  ctx.params?.reason || "rejected by operator",
    });

    return {
      negotiationId,
      status: "rejected",
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// Helpers shared with handlers.js (state I/O + cross-reality dispatch).
// ────────────────────────────────────────────────────────────────────

async function sendIntent(ctx, peerReality, message) {
  const { crossRealityDispatch } = await import("../../../ibp/crossWorld.js");
  const actorBeingId = ctx.summonCtx?.actorAct?.beingIn || ctx.identity?.beingId;
  const actorBranch  = ctx.summonCtx?.actorAct?.branch  || "0";
  if (!actorBeingId) {
    throw new IbpError(IBP_ERR.INTERNAL, "sendIntent: no actor beingId in ctx");
  }

  // Envelope intent is canonical (per seed/SUMMON.md): the auth gate
  // and the receiver's permitsReceiverSummon both read it from the
  // envelope. crossRealityDispatch passes payload.message straight
  // through to summonVerb, so envelope.intent on the wire is the same
  // envelope.intent the local verb stamps onto the summon Fact. The
  // rest of the federation fields (negotiationId, manifest, bundle,
  // etc.) ride inside content as before.
  const { intent: messageIntent, ...rest } = message || {};
  const envelope = {
    id:      uuidv4(),
    verb:    "summon",
    address: `${peerReality}/@federation-manager`,
    payload: {
      message: {
        from:    "/@federation-manager",
        intent:  messageIntent || null,
        content: { kind: "federation", ...rest },
      },
    },
  };

  try {
    const result = await crossRealityDispatch({
      envelope,
      actor:    { beingId: actorBeingId, branch: actorBranch },
      identity: { beingId: actorBeingId, name: ctx.identity?.name || null },
    });
    if (result?.peerAck?.status !== "ok") {
      log.warn("FederationManager",
        `cross-reality dispatch to ${peerReality} non-ok: ${JSON.stringify(result?.peerAck?.error || result?.peerAck).slice(0, 300)}`);
    } else {
      log.info("FederationManager",
        `cross-reality dispatch to ${peerReality} ok (intent=${envelope.payload.message.intent})`);
    }
    return result;
  } catch (err) {
    log.warn("FederationManager", `cross-reality dispatch to ${peerReality} failed: ${err.message}`);
    throw new IbpError(IBP_ERR.INTERNAL,
      `cross-reality dispatch to "${peerReality}" failed: ${err.message}`);
  }
}

async function resolveSubtreeSpaceId(subtreePath, branch) {
  // If already a uuid, return as-is.
  if (/^[0-9a-f-]{36}$/i.test(subtreePath)) return subtreePath;
  // Otherwise resolve through the address parser. Bare paths are
  // interpreted relative to the local reality root.
  try {
    const { parseWithContext, expand, getRealityDomain: _gRD } = await import("../../../ibp/address.js");
    const { resolveStance } = await import("../../../ibp/resolver.js");
    const localReality = _gRD();
    const parseCtx = {
      currentReality: localReality,
      currentBranch:  branch,
      currentUser:    null,
      currentPath:    null,
    };
    const parsed = parseWithContext(subtreePath, parseCtx);
    const expanded = expand(parsed, parseCtx);
    const resolved = await resolveStance(expanded.right || expanded, parseCtx);
    return resolved?.spaceId || null;
  } catch (err) {
    log.warn("FederationManager", `resolveSubtreeSpaceId failed for "${subtreePath}": ${err.message}`);
    return null;
  }
}

async function cacheBundle(ctx, negotiationId, bundle) {
  await setQualityField(ctx, `bundleCache.${negotiationId}`, bundle);
}

async function writeNegotiation(ctx, bucket, negotiationId, value) {
  await setQualityField(ctx, `${bucket}.${negotiationId}`, value);
}

async function readNegotiation(ctx, bucket, negotiationId) {
  const myBeingId = ctx.summonCtx?.actorAct?.beingIn || ctx.identity?.beingId;
  if (!myBeingId) return null;
  // Read directly from the projection. The role being is the
  // federation-manager being itself; in v1 we read its own state.
  // For an operator calling do:accept-template on @federation-manager,
  // the addressed being is the federation-manager (whose qualities
  // hold the negotiation state).
  const branch = ctx.summonCtx?.actorAct?.branch || "0";
  const { loadOrFold } = await import("../../../materials/projections.js");
  // Resolve the federation-manager being by name (not the caller's
  // beingId, which is the operator). The negotiation state lives on
  // the federation-manager being.
  const { findByName } = await import("../../../materials/projections.js");
  const slot = await findByName("being", "federation-manager", branch);
  if (!slot) return null;
  const q = slot.state?.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const fed = qualities?.federation || {};
  const bucketMap = fed[bucket] || {};
  return bucketMap[negotiationId] || null;
}

async function completeIncomingOffer(ctx, negotiationId, outcome) {
  await setQualityField(ctx, `completed.${negotiationId}`, {
    direction:   "incoming",
    completedAt: iso(ctx),
    ...outcome,
  });
  await setQualityField(ctx, `pendingIncomingOffers.${negotiationId}`, null);
}

async function completeIncomingRequest(ctx, negotiationId, outcome) {
  await setQualityField(ctx, `completed.${negotiationId}`, {
    direction:   "incoming-request",
    completedAt: iso(ctx),
    ...outcome,
  });
  await setQualityField(ctx, `pendingIncomingRequests.${negotiationId}`, null);
}

async function setQualityField(ctx, subPath, value) {
  // Resolve the federation-manager being. The operator's op handler
  // ctx has the operator as actor; the negotiation state lives on the
  // federation-manager being, addressed by name.
  const branch = ctx.summonCtx?.actorAct?.branch || "0";
  const { findByName } = await import("../../../materials/projections.js");
  const slot = await findByName("being", "federation-manager", branch);
  if (!slot) {
    log.warn("FederationManager", "setQualityField: no federation-manager being found");
    return;
  }
  const myBeingId = String(slot.id);
  const { doVerb } = await import("../../../ibp/verbs/do.js");
  await doVerb(
    { kind: "being", id: myBeingId },
    "set-being",
    {
      field: `qualities.federation.${subPath}`,
      value,
    },
    {
      identity:      ctx.identity || { beingId: myBeingId, name: "federation-manager" },
      summonCtx:     ctx.summonCtx,
      currentBranch: branch,
    },
  );
}

function iso(ctx) {
  return ctx.summonCtx?.actorAct?.date
    ? new Date(ctx.summonCtx.actorAct.date).toISOString()
    : null;
}
