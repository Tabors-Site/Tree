// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federation-manager ops. The operator-facing DO surface for push
// and pull negotiations with peer realities.
//
// Six ops:
//
//   push-subtree     . initiate an outbound push. Clones the local
//                       subtree, sends offer-graft to the peer's
//                       federation-manager, caches the bundle until
//                       the peer accepts.
//
//   pull-subtree     . initiate an outbound pull. Sends request-subtree
//                       to the peer's federation-manager. If the peer's
//                       operator accepts, they push back into us via
//                       the offer-graft path (same code on the
//                       receiving side as any other incoming push).
//
//   accept-offer     . approve an incoming offer-graft. Sends accept-graft
//                       back to the sender; the sender then delivers
//                       the bundle via deliver-bundle (which the role
//                       handler grafts).
//
//   reject-offer     . refuse an incoming offer-graft. Sends reject-graft.
//
//   accept-request   . approve an incoming pull request. Runs push-subtree
//                       back at the requester for the asked subtree.
//
//   reject-request   . refuse an incoming pull request. Sends reject-graft
//                       (reusing the rejection envelope) to the requester.
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
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getRealityDomain } from "../../../ibp/address.js";

export function registerFederationManagerOps() {
  // registerOperation calls below run at module load; this is the
  // explicit entry point so genesis.js can import + call it the same
  // way it does for branch-manager / role-manager / llm-assigner.
}

// ────────────────────────────────────────────────────────────────────
// push-subtree . Operator initiates an outbound push.
// ────────────────────────────────────────────────────────────────────

registerOperation("push-subtree", {
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
      throw new IbpError(IBP_ERR.INVALID_INPUT, "push-subtree requires `peer`");
    }
    if (!subtreePath || typeof subtreePath !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "push-subtree requires `subtreePath`");
    }
    if (peer === getRealityDomain()) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "push-subtree: cannot push to local reality");
    }

    const negotiationId = uuidv4();

    // 1. Resolve subtreePath to a spaceId. Accepts both a raw uuid and
    // a slash-separated path.
    const branch = ctx.summonCtx?.actorAct?.branch || "0";
    const spaceId = await resolveSubtreeSpaceId(subtreePath, branch);
    if (!spaceId) {
      throw new IbpError(IBP_ERR.NOT_FOUND,
        `push-subtree: subtree "${subtreePath}" not found on branch ${branch}`);
    }

    // 2. Clone locally.
    const { cloneSubtree } = await import("../../../materials/publish/clone.js");
    let bundle;
    try {
      bundle = await cloneSubtree(spaceId, { branch });
    } catch (err) {
      throw new IbpError(IBP_ERR.INTERNAL, `cloneSubtree failed: ${err.message}`);
    }

    // 3. Cache the bundle + record pendingOutbound state BEFORE
    // dispatching to the peer. This avoids a race where the peer
    // auto-accepts and fires accept-graft back at us before our
    // moment seals — without these writes visible first, our
    // handleAcceptGraft would find no cached bundle and refuse.
    await cacheBundle(ctx, negotiationId, bundle);

    const manifest = bundle?.manifest || null;
    // The bundle's identity travels WITH the offer: the receiver pins
    // it, and deliver-bundle later verifies the delivered bundle
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

    // 4. Send offer-graft to the peer's federation-manager. The
    // payload carries only the manifest + bundle hash (cheap
    // rejection step); the bundle ships later via deliver-bundle on
    // accept.
    await sendIntent(ctx, peer, {
      intent:             "offer-graft",
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
// pull-subtree . Operator initiates an outbound pull.
// ────────────────────────────────────────────────────────────────────

registerOperation("pull-subtree", {
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
      throw new IbpError(IBP_ERR.INVALID_INPUT, "pull-subtree requires `peer`");
    }
    if (!subtreePath || typeof subtreePath !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "pull-subtree requires `subtreePath`");
    }
    if (peer === getRealityDomain()) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "pull-subtree: cannot pull from local reality");
    }

    const negotiationId = uuidv4();

    await sendIntent(ctx, peer, {
      intent:        "request-subtree",
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
// accept-offer . Operator approves an incoming offer-graft.
// ────────────────────────────────────────────────────────────────────

registerOperation("accept-offer", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    negotiationId: { type: "text", label: "Negotiation id", required: true },
  },
  handler: async (ctx) => {
    const negotiationId = ctx.params?.negotiationId;
    if (!negotiationId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "accept-offer requires `negotiationId`");
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
      intent:        "accept-graft",
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
// reject-offer . Operator refuses an incoming offer-graft.
// ────────────────────────────────────────────────────────────────────

registerOperation("reject-offer", {
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
      throw new IbpError(IBP_ERR.INVALID_INPUT, "reject-offer requires `negotiationId`");
    }
    const offer = await readNegotiation(ctx, "pendingIncomingOffers", negotiationId);
    if (!offer) {
      throw new IbpError(IBP_ERR.NOT_FOUND, `no pending offer "${negotiationId}"`);
    }

    await sendIntent(ctx, offer.sender.reality, {
      intent:        "reject-graft",
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
// accept-request . Operator approves an incoming pull request. Runs
// the equivalent of push-subtree back at the requester.
// ────────────────────────────────────────────────────────────────────

registerOperation("accept-request", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  skipAudit:      false,
  args: {
    negotiationId: { type: "text", label: "Negotiation id", required: true },
  },
  handler: async (ctx) => {
    const negotiationId = ctx.params?.negotiationId;
    if (!negotiationId) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "accept-request requires `negotiationId`");
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
    // push-subtree code path so the receiver side runs the same
    // offer-graft handling regardless of whether the push was operator
    // initiated or pull driven.
    const branch = ctx.summonCtx?.actorAct?.branch || "0";
    const spaceId = await resolveSubtreeSpaceId(request.subtreePath, branch);
    if (!spaceId) {
      throw new IbpError(IBP_ERR.NOT_FOUND,
        `accept-request: requested subtree "${request.subtreePath}" not found on branch ${branch}`);
    }

    const { cloneSubtree } = await import("../../../materials/publish/clone.js");
    const bundle = await cloneSubtree(spaceId, { branch });
    const pushNegotiationId = uuidv4();
    await cacheBundle(ctx, pushNegotiationId, bundle);

    await sendIntent(ctx, request.puller.reality, {
      intent:             "offer-graft",
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
// reject-request . Operator refuses an incoming pull request.
// ────────────────────────────────────────────────────────────────────

registerOperation("reject-request", {
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
      throw new IbpError(IBP_ERR.INVALID_INPUT, "reject-request requires `negotiationId`");
    }
    const request = await readNegotiation(ctx, "pendingIncomingRequests", negotiationId);
    if (!request) {
      throw new IbpError(IBP_ERR.NOT_FOUND, `no pending request "${negotiationId}"`);
    }

    await sendIntent(ctx, request.puller.reality, {
      intent:        "reject-graft",
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

  // SUMMON envelope only preserves canonical message fields
  // (from/content/correlation/etc.) at the inbox enqueue. Custom
  // application fields are stripped. So we pack the federation payload
  // into content (which accepts arbitrary objects, the same pattern
  // birther's summon:mate uses). The role's summon handler reads
  // message.content.intent to dispatch.
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
  // For an operator calling do:accept-offer on @federation-manager,
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
