// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federation-manager. The delegate that negotiates subtree exchange
// with peer realities.
//
// Clone and graft are the DATA primitives (capture / apply a bundle).
// Push and pull are NEGOTIATIONS between sovereign realities: who
// initiated the transfer, did the receiver consent, did the manifest
// satisfy the receiver's policy. I am the addressable being who
// carries out those negotiations on behalf of an operator.
//
// I am scripted cognition. The protocol is deterministic: classify
// the incoming SUMMON by intent, look up or update the negotiation
// record in my qualities, return a response. No LLM, no prompt.
// Operators drive me through my DO ops (push-subtree, pull-subtree,
// accept-offer, reject-offer, accept-request, reject-request); peers
// reach me through SUMMONs my handler classifies below.
//
// SIX INTENTS (the wire shape).
//
//   offer-graft       sender -> peer
//     "I have a subtree I would like to graft into your reality.
//      Here is the manifest. Will you accept?"
//     payload: { negotiationId, manifest, label?, sourceSubtreePath? }
//     response: { kind: "pending-review", negotiationId } if not
//      auto-accepted; { kind: "auto-accept" } if policy admits.
//
//   accept-graft      peer -> sender
//     "Yes, send the bundle."
//     payload: { negotiationId }
//     sender's accept handler then SUMMONs deliver-bundle.
//
//   reject-graft      peer -> sender
//     "No thanks."
//     payload: { negotiationId, reason? }
//
//   deliver-bundle    sender -> peer
//     "Here is the bundle for the negotiation you accepted."
//     payload: { negotiationId, bundle }
//     response: { kind: "graft-result", success, summary?, error? }
//
//   request-subtree   puller -> offerer
//     "Would you push your <subtreePath> to me?"
//     payload: { negotiationId, subtreePath, label? }
//     If offerer's policy admits, offerer's accept-request handler
//     runs push-subtree back at the requester. If not, the offerer's
//     operator reviews and decides.
//
//   graft-result      peer -> sender
//     "The graft completed (or failed). Here are the details."
//     payload: { negotiationId, success, summary?, error? }
//     terminal: sender records the outcome and the negotiation seals.
//
// NEGOTIATION STATE lives in my qualities.federation map:
//
//   qualities.federation.pendingIncomingOffers[id]
//     { sender, manifest, label, sourceSubtreePath, receivedAt }
//   qualities.federation.pendingIncomingRequests[id]
//     { puller, subtreePath, label, receivedAt }
//   qualities.federation.pendingOutbound[id]
//     { direction, peer, subtreePath, label, manifest?, bundleCacheKey?, startedAt, lastStep }
//   qualities.federation.completed[id]
//     { direction, peer, success, summary?, error?, completedAt }
//
// Cached bundles (large) are stored as separate matter on the role
// being's reel so they don't bloat the qualities map; the bundleCacheKey
// names the matter id. (v1 inlines them for simplicity; matter-keyed
// cache is a follow-up when bundles get large enough to matter.)

import log from "../../../seedReality/log.js";

export const federationManagerRole = Object.freeze({
  name: "federation-manager",
  description:
    "Negotiates subtree exchange with peer realities. Operator triggers push-subtree or pull-subtree DO ops; the role handles incoming offer-graft / request-subtree / deliver-bundle SUMMONs from peer realities.",
  requiredCognition: "scripted",
  permissions: ["see", "do", "summon"],
  respondMode: "async",
  triggerOn: ["message"],

  // What I can read locally to do my job. The peer registry (to
  // validate peer addresses and look up keys) and my own identity
  // (negotiation state lives in my own qualities, addressable by
  // reading my own being). The incoming subtree itself does NOT
  // arrive through SEE . it is carried inside the peer's SUMMON
  // payload, which lands in my inbox automatically (substrate
  // intake, not canSee). The bundle bytes are message content, not
  // a foreign-branch read.
  canSee: [
    "identity",
    "peers",
  ],

  // Operator-facing DO ops. Each lives in ops.js and registers via
  // registerOperation at module load.
  canDo: [
    {
      action:      "push-subtree",
      description: "Offer a subtree to a peer reality. Args: { peer, subtreePath, label? }",
    },
    {
      action:      "pull-subtree",
      description: "Request a subtree from a peer reality. Args: { peer, subtreePath, label? }",
    },
    {
      action:      "accept-offer",
      description: "Accept an incoming offer-graft from a peer. Args: { negotiationId }",
    },
    {
      action:      "reject-offer",
      description: "Reject an incoming offer-graft. Args: { negotiationId, reason? }",
    },
    {
      action:      "accept-request",
      description: "Accept an incoming request-subtree (triggers a push back to the requester). Args: { negotiationId }",
    },
    {
      action:      "reject-request",
      description: "Reject an incoming request-subtree. Args: { negotiationId, reason? }",
    },
  ],

  canSummon: [
    {
      stance:      "(asker)",
      description: "Reply to whoever woke this moment (default target / inReplyTo).",
    },
  ],

  // Peers can address me; I can be addressed by anyone authenticated
  // (operator policy decides what to do with the request).
  canBe: [],

  label: "Federation Manager",

  // Incoming SUMMON dispatch. Classifies by intent and routes. Returns
  // the response payload that flows back to the caller (via the moment's
  // descriptor inner face when cross-reality, via the local SUMMON
  // return shape when same-reality).
  async summon(message, ctx) {
    // Federation payload still rides inside content for cross-reality
    // SUMMONs (the canopy serializer hasn't been updated to carry
    // envelope intent yet — see TODO in dispatchToPeer in ./handlers.js
    // and ./ops.js). Pull the rest of the federation fields from
    // content as before.
    const fedMessage = (typeof message?.content === "object" && message.content !== null
                       && message.content.kind === "federation")
      ? message.content
      : message;

    // Envelope intent first (per seed/SUMMON.md). Fall back to
    // content.intent / content.kind for legacy cross-reality envelopes
    // that haven't migrated yet. Same-reality callers should use the
    // envelope; cross-reality callers will follow when canopy carries it.
    const intent = message?.intent
      || ((typeof fedMessage === "object" && fedMessage !== null)
            ? (fedMessage.intent || fedMessage.kind || null)
            : null);

    if (!intent || intent === "federation") {
      log.warn("FederationManager",
        `SUMMON arrived with no federation intent; ignoring (content kind=${message?.content?.kind || "(string)"})`);
      return null;
    }

    log.info("FederationManager",
      `routing intent="${intent}" askerReality=${ctx?.askerReality || "(local)"}`);
    try {
      const { handleIncomingIntent } = await import("./handlers.js");
      const result = await handleIncomingIntent(intent, fedMessage, ctx);
      log.info("FederationManager",
        `intent="${intent}" handler returned kind=${result?.kind}`);
      return result;
    } catch (err) {
      log.warn("FederationManager", `intent "${intent}" handler threw: ${err.message}`);
      return {
        kind:  "failure",
        ok:    false,
        shape: "internal",
        reason: err.message,
      };
    }
  },
});
