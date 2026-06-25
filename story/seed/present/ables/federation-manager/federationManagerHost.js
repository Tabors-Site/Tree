// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federationManagerHost.js, host-escape glue for the seven federation-manager
// send-side DO words (offer-template / offer-being / request-template /
// accept-template / reject-template / fulfill-request / refuse-request). The
// ops are WORD-SOLE: each `.word` is the ONLY path, and reaches the floor
// through the see-ops wired here. No JS op handler survives.
//
// THE FLOOR HAS TWO IRREDUCIBLE SHAPES here, and nothing else:
//
//   1. resolve-federation-<op>  . a host READ + COMPUTE. Each returns a SPEC:
//      { managerId, writes: [{ field, value }], dispatch: { peer, intent, payload } }.
//      The read part is the genuine floor (capture a template/graft bundle,
//      compute its hash, mint the negotiationId, read an incoming offer/request
//      record, resolve the federation-manager being by name, stamp the iso
//      clock). It lays NO fact. The `.word` then fans `writes` out as its own
//      do:set-being deeds (one moment per field, exactly the old setQualityField
//      per-field doVerb), and fires the ONE cross-story dispatch.
//
//   2. dispatch-federation-intent  . the cross-story membrane OUT (a `call` to a
//      peer story, carried by crossStoryDispatch). Irreducible transport, a
//      federation reach into ANOTHER story is not a do:set-being fact, it is the
//      sanctioned floor `out`. Moved verbatim from the old `sendIntent` helper.
//
// The host throws the SAME IbpErrors the handlers threw; a host throw becomes
// the `.word`'s refusal. callHost invokes the escape as `fn({ args: [...] }, ctx)`.

import { randomUUID as uuidv4 } from "node:crypto";
import log from "../../../seedStory/log.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getStoryDomain } from "../../../ibp/address.js";

const FED = "qualities.federation";

// ── shared floor reads (verbatim from the old ops.js helpers) ──────────

// Resolve the federation-manager being id. The operator is the caller; the
// negotiation state lives on the federation-manager being, addressed by name.
async function managerBeingId(history) {
  const { findByName } = await import("../../../materials/projections.js");
  const slot = await findByName("being", "federation-manager", history);
  if (!slot) {
    throw new IbpError(IBP_ERR.NOT_FOUND, "no federation-manager being on this story");
  }
  return String(slot.id);
}

// Read one entry from qualities.federation.<bucket>[id] on the federation-manager
// being. Moved verbatim from the old ops.js readNegotiation.
async function readNegotiation(bucket, negotiationId, history) {
  const { findByName } = await import("../../../materials/projections.js");
  const slot = await findByName("being", "federation-manager", history);
  if (!slot) return null;
  const q = slot.state?.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const fed = qualities?.federation || {};
  const bucketMap = fed[bucket] || {};
  return bucketMap[negotiationId] || null;
}

// Resolve a subtreePath to a spaceId. Accepts a raw uuid or a slash-separated
// path. Moved verbatim from the old ops.js resolveSubtreeSpaceId.
async function resolveSubtreeSpaceId(subtreePath, history) {
  if (/^[0-9a-f-]{36}$/i.test(subtreePath)) return subtreePath;
  try {
    const { parseWithContext, expand, getStoryDomain: _gRD } =
      await import("../../../ibp/address.js");
    const { resolveStance } = await import("../../../ibp/resolver.js");
    const localStory = _gRD();
    const parseCtx = {
      currentStory:   localStory,
      currentHistory: history,
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

function historyOf(caller, ctx) {
  return ctx?.moment?.actorAct?.history || ctx?.history || "0";
}

function iso(ctx) {
  const d = ctx?.moment?.actorAct?.date;
  return d ? new Date(d).toISOString() : null;
}

// ── the op SPEC resolvers ──────────────────────────────────────────────
//
// Each returns { managerId, writes, dispatch }. The `.word` lays each write as
// a do:set-being deed on managerId, then fires dispatch via dispatch-federation-
// intent. A null write VALUE clears that bucket entry (the reducer folds absent).

// offer-template . capture the local subtree template, cache the bundle + record
// pendingOutbound BEFORE dispatch (the race note from the old handler), then push.
async function resolveOfferTemplate(params, caller, ctx) {
  const peer = params?.peer;
  const subtreePath = params?.subtreePath;
  const label = params?.label;
  if (!peer || typeof peer !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-template requires `peer`");
  }
  if (!subtreePath || typeof subtreePath !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-template requires `subtreePath`");
  }
  if (peer === getStoryDomain()) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-template: cannot push to local story");
  }
  const history = historyOf(caller, ctx);
  const negotiationId = uuidv4();

  const spaceId = await resolveSubtreeSpaceId(subtreePath, history);
  if (!spaceId) {
    throw new IbpError(IBP_ERR.NOT_FOUND,
      `offer-template: subtree "${subtreePath}" not found on history ${history}`);
  }
  const { captureTemplate } = await import("../../../store/book/seedTemplate.js");
  let bundle;
  try {
    bundle = await captureTemplate(spaceId, { history });
  } catch (err) {
    throw new IbpError(IBP_ERR.INTERNAL, `captureTemplate failed: ${err.message}`);
  }

  const manifest = bundle?.manifest || null;
  const bundleHash = bundle?.meta?.bundleHash || null;
  const managerId = await managerBeingId(history);

  return {
    managerId,
    negotiationId,
    peer,
    subtreePath,
    // Cache the bundle + record pendingOutbound BEFORE dispatch (avoids a race
    // where the peer auto-accepts before our moment seals). The lastStep flips
    // to "offer-sent" in a later write, after the dispatch deed.
    writes: [
      { field: `${FED}.bundleCache.${negotiationId}`, value: bundle },
      { field: `${FED}.pendingOutbound.${negotiationId}`, value: {
          direction:   "push",
          peer,
          subtreePath,
          label:       label || null,
          manifest,
          bundleHash,
          startedAt:   iso(ctx),
          lastStep:    "offer-pending",
        } },
    ],
    dispatch: {
      peer,
      intent: "offer-template",
      payload: {
        negotiationId,
        manifest,
        bundleHash,
        label:             label || null,
        sourceSubtreePath: subtreePath,
      },
    },
    // Written AFTER dispatch (the word lays it last).
    sentWrite: { field: `${FED}.pendingOutbound.${negotiationId}.lastStep`, value: "offer-sent" },
  };
}

// offer-being . capture the being's signed graft bundle and deliver one-shot.
// No local negotiation state (the bundle is self-certifying).
async function resolveOfferBeing(params, caller, ctx) {
  const peer = params?.peer;
  const beingId = params?.beingId;
  if (!peer || typeof peer !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-being requires `peer`");
  }
  if (!beingId || typeof beingId !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-being requires `beingId`");
  }
  if (peer === getStoryDomain()) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "offer-being: cannot graft to the local story");
  }
  const history = historyOf(caller, ctx);
  const { captureGraft } = await import("../../../store/book/graft.js");
  let bundle;
  try {
    ({ bundle } = await captureGraft({
      beingId,
      capturedBy: caller != null ? String(caller) : null,
      returnOnly: true,
    }));
  } catch (err) {
    throw new IbpError(IBP_ERR.INTERNAL, `captureGraft failed: ${err.message}`);
  }
  if (!bundle?.meta?.beingId) {
    throw new IbpError(IBP_ERR.NOT_FOUND,
      `offer-being: being "${beingId.slice(0, 12)}…" has no reel to capture`);
  }
  const negotiationId = uuidv4();
  const managerId = await managerBeingId(history);
  return {
    managerId,
    negotiationId,
    peer,
    beingId,
    counts: bundle.meta.counts,
    writes: [],
    dispatch: {
      peer,
      intent:  "deliver-being",
      payload: { negotiationId, bundle },
    },
  };
}

// request-template . send the pull request, then record pendingOutbound.
async function resolveRequestTemplate(params, caller, ctx) {
  const peer = params?.peer;
  const subtreePath = params?.subtreePath;
  const label = params?.label;
  if (!peer || typeof peer !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "request-template requires `peer`");
  }
  if (!subtreePath || typeof subtreePath !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "request-template requires `subtreePath`");
  }
  if (peer === getStoryDomain()) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "request-template: cannot pull from local story");
  }
  const history = historyOf(caller, ctx);
  const negotiationId = uuidv4();
  const managerId = await managerBeingId(history);
  return {
    managerId,
    negotiationId,
    peer,
    subtreePath,
    dispatch: {
      peer,
      intent:  "request-template",
      payload: { negotiationId, subtreePath, label: label || null },
    },
    // Recorded AFTER the dispatch (the word lays it last, matching the old order).
    writes: [
      { field: `${FED}.pendingOutbound.${negotiationId}`, value: {
          direction:  "pull",
          peer,
          subtreePath,
          label:      label || null,
          startedAt:  iso(ctx),
          lastStep:   "request-sent",
        } },
    ],
  };
}

// accept-template . read the incoming offer, send accept (no local write).
async function resolveAcceptTemplate(params, caller, ctx) {
  const negotiationId = params?.negotiationId;
  if (!negotiationId) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "accept-template requires `negotiationId`");
  }
  const history = historyOf(caller, ctx);
  const offer = await readNegotiation("pendingIncomingOffers", negotiationId, history);
  if (!offer) {
    throw new IbpError(IBP_ERR.NOT_FOUND, `no pending offer "${negotiationId}"`);
  }
  if (!offer.sender?.story) {
    throw new IbpError(IBP_ERR.INVALID_INPUT,
      `offer "${negotiationId}" has no sender story recorded`);
  }
  const managerId = await managerBeingId(history);
  return {
    managerId,
    negotiationId,
    sender: offer.sender,
    writes: [],
    dispatch: {
      peer:    offer.sender.story,
      intent:  "accept-template",
      payload: { negotiationId },
    },
  };
}

// reject-template . send reject, then complete the incoming offer (set completed,
// clear the pending entry).
async function resolveRejectTemplate(params, caller, ctx) {
  const negotiationId = params?.negotiationId;
  if (!negotiationId) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "reject-template requires `negotiationId`");
  }
  const history = historyOf(caller, ctx);
  const offer = await readNegotiation("pendingIncomingOffers", negotiationId, history);
  if (!offer) {
    throw new IbpError(IBP_ERR.NOT_FOUND, `no pending offer "${negotiationId}"`);
  }
  const reason = params?.reason || "rejected by operator";
  const managerId = await managerBeingId(history);
  return {
    managerId,
    negotiationId,
    dispatch: {
      peer:    offer.sender?.story,
      intent:  "reject-template",
      payload: { negotiationId, reason: params?.reason || null },
    },
    // completeIncomingOffer: record completed, clear the pending entry. Laid
    // after the dispatch (the old handler dispatched first).
    writes: [
      { field: `${FED}.completed.${negotiationId}`, value: {
          direction:   "incoming",
          completedAt: iso(ctx),
          success:     false,
          reason,
        } },
      { field: `${FED}.pendingIncomingOffers.${negotiationId}`, value: null },
    ],
  };
}

// fulfill-request . capture the requested subtree, push it back at the puller
// (the offer-template path), record pendingOutbound, complete the incoming request.
async function resolveFulfillRequest(params, caller, ctx) {
  const negotiationId = params?.negotiationId;
  if (!negotiationId) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "fulfill-request requires `negotiationId`");
  }
  const history = historyOf(caller, ctx);
  const request = await readNegotiation("pendingIncomingRequests", negotiationId, history);
  if (!request) {
    throw new IbpError(IBP_ERR.NOT_FOUND, `no pending request "${negotiationId}"`);
  }
  if (!request.puller?.story) {
    throw new IbpError(IBP_ERR.INVALID_INPUT,
      `request "${negotiationId}" has no puller story recorded`);
  }
  const spaceId = await resolveSubtreeSpaceId(request.subtreePath, history);
  if (!spaceId) {
    throw new IbpError(IBP_ERR.NOT_FOUND,
      `fulfill-request: requested subtree "${request.subtreePath}" not found on history ${history}`);
  }
  const { captureTemplate } = await import("../../../store/book/seedTemplate.js");
  const bundle = await captureTemplate(spaceId, { history });
  const pushNegotiationId = uuidv4();
  const managerId = await managerBeingId(history);
  return {
    managerId,
    negotiationId,
    pushNegotiationId,
    peer: request.puller.story,
    // bundleCache + (after dispatch) pendingOutbound + completeIncomingRequest.
    writes: [
      { field: `${FED}.bundleCache.${pushNegotiationId}`, value: bundle },
    ],
    dispatch: {
      peer:    request.puller.story,
      intent:  "offer-template",
      payload: {
        negotiationId:     pushNegotiationId,
        manifest:          bundle?.manifest || null,
        label:             request.label || null,
        sourceSubtreePath: request.subtreePath,
        replyToRequest:    negotiationId,
      },
    },
    // Laid AFTER dispatch (matches the old handler order).
    postWrites: [
      { field: `${FED}.pendingOutbound.${pushNegotiationId}`, value: {
          direction:      "push",
          peer:           request.puller.story,
          subtreePath:    request.subtreePath,
          label:          request.label || null,
          manifest:       bundle?.manifest || null,
          startedAt:      iso(ctx),
          lastStep:       "offer-sent",
          replyToRequest: negotiationId,
        } },
      { field: `${FED}.completed.${negotiationId}`, value: {
          direction:   "incoming-request",
          completedAt: iso(ctx),
          success:     true,
          summary:     { pushNegotiationId },
        } },
      { field: `${FED}.pendingIncomingRequests.${negotiationId}`, value: null },
    ],
  };
}

// refuse-request . send reject (reusing the rejection envelope), complete the
// incoming request.
async function resolveRefuseRequest(params, caller, ctx) {
  const negotiationId = params?.negotiationId;
  if (!negotiationId) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "refuse-request requires `negotiationId`");
  }
  const history = historyOf(caller, ctx);
  const request = await readNegotiation("pendingIncomingRequests", negotiationId, history);
  if (!request) {
    throw new IbpError(IBP_ERR.NOT_FOUND, `no pending request "${negotiationId}"`);
  }
  const reason = params?.reason || "rejected by operator";
  const managerId = await managerBeingId(history);
  return {
    managerId,
    negotiationId,
    dispatch: {
      peer:    request.puller?.story,
      intent:  "reject-template",
      payload: { negotiationId, reason: params?.reason || null },
    },
    writes: [
      { field: `${FED}.completed.${negotiationId}`, value: {
          direction:   "incoming-request",
          completedAt: iso(ctx),
          success:     false,
          reason,
        } },
      { field: `${FED}.pendingIncomingRequests.${negotiationId}`, value: null },
    ],
  };
}

// ── the cross-story membrane out (verbatim from the old sendIntent) ─────
//
// dispatch-federation-intent(peer, intent, payload) → one `call` to the peer
// story's @federation-manager, carried by crossStoryDispatch. The actor is the
// caller (the operator's being), per the old sendIntent.
async function dispatchFederationIntent(peer, intent, payload, ctx) {
  const { crossStoryDispatch } = await import("../../../ibp/crossWorld.js");
  const actorBeingId = ctx?.moment?.actorAct?.through
    || ctx?.identity?.beingId
    || (ctx?.caller != null ? String(ctx.caller) : null);
  const actorHistory = ctx?.moment?.actorAct?.history || ctx?.history || "0";
  if (!actorBeingId) {
    throw new IbpError(IBP_ERR.INTERNAL, "dispatch-federation-intent: no actor beingId in ctx");
  }
  const envelope = {
    id:      uuidv4(),
    verb:    "call",
    address: `${peer}/@federation-manager`,
    payload: {
      message: {
        from:    "/@federation-manager",
        intent:  intent || null,
        content: { kind: "federation", ...(payload || {}) },
      },
    },
  };
  try {
    const result = await crossStoryDispatch({
      envelope,
      actor:    { beingId: actorBeingId, history: actorHistory },
      identity: { beingId: actorBeingId, name: ctx?.identity?.name || null },
    });
    if (result?.peerAck?.status !== "ok") {
      log.warn("FederationManager",
        `cross-story dispatch to ${peer} non-ok: ${JSON.stringify(result?.peerAck?.error || result?.peerAck).slice(0, 300)}`);
    } else {
      log.info("FederationManager",
        `cross-story dispatch to ${peer} ok (intent=${intent})`);
    }
    return result;
  } catch (err) {
    log.warn("FederationManager", `cross-story dispatch to ${peer} failed: ${err.message}`);
    throw new IbpError(IBP_ERR.INTERNAL,
      `cross-story dispatch to "${peer}" failed: ${err.message}`);
  }
}

// ── the per-op host factory ─────────────────────────────────────────────
//
// `mode` fixes which spec resolver backs `resolve-federation-spec`; the `.word`
// passes only (params, caller). dispatch-federation-intent is shared across all
// seven (the one membrane out), wired into every env so the words can fire it.
const RESOLVERS = {
  "offer-template":   resolveOfferTemplate,
  "offer-being":      resolveOfferBeing,
  "request-template": resolveRequestTemplate,
  "accept-template":  resolveAcceptTemplate,
  "reject-template":  resolveRejectTemplate,
  "fulfill-request":  resolveFulfillRequest,
  "refuse-request":   resolveRefuseRequest,
};

export function federationManagerHostEnv(mode) {
  const resolve = RESOLVERS[mode];
  if (!resolve) throw new Error(`federationManagerHostEnv: unknown mode "${mode}"`);
  return function () {
    return {
      "resolve-federation-spec": async ({ args: [params, caller] }, ctx) =>
        resolve(params || {}, caller, ctx),
      "dispatch-federation-intent": async ({ args: [peer, intent, payload] }, ctx) =>
        dispatchFederationIntent(peer, intent, payload, ctx),
    };
  };
}
