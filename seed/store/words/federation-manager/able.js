// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federation-manager. The being that negotiates transfers with peer
// realities on an operator's behalf.
//
// Seed and graft are the DATA primitives (capture / apply a bundle): a
// SEED brings the SHAPE (a template, fresh ids on planting); a GRAFT
// brings the THING ITSELF (a being, verbatim id + chain). Two cargoes,
// one transport. Push and pull are the NEGOTIATIONS on top: who initiated
// the transfer, did the receiver consent, did the manifest satisfy the
// receiver's policy. I carry those out.
//
// I am scripted cognition. The protocol is deterministic: classify the
// incoming SUMMON by intent, look up or update the negotiation record in
// my qualities, return a response. No LLM, no prompt.
//
// NAMING (verb-object, two cargoes). Every name is <verb>-<cargo>, and
// the cargo is template (the shape) or being (the entity). The content
// path and the identity path read as the same act on different cargo:
//   offer-template   / offer-being     push: I send you cargo
//   request-template                   pull: I ask you for cargo
//   deliver-template / deliver-being   the bytes themselves
//   accept-template  / reject-template the receiver's verdict on an offer
//   fulfill-request  / refuse-request  the asked side's verdict on a pull
//   template-result                    terminal outcome report
//
// One token, two sides: offer-template (and accept / reject / request-
// template) names BOTH an operator DO op (the local trigger the operator
// runs) AND the wire intent it emits to the peer. Same concept seen from
// the two realities; a log line tells you which by its side. The identity
// path is the exception that proves the rule: offer-being delivers in one
// shot (deliver-being, auto-accepted, no offer/accept review), because a
// graft is self-certifying (the receiver verifies the signed graftRoot
// with no callback), so there is no accept-being or being-result pair.
//
// THE WIRE INTENTS my handler classifies (./handlers.js):
//
//   offer-template     sender -> peer
//     "I have a template I would plant in your story. Here is the
//      manifest. Will you accept?"
//     payload: { negotiationId, manifest, label?, sourceSubtreePath? }
//     response: pending-review, or auto-accept if policy admits.
//
//   accept-template    peer -> sender
//     "Yes, send it." payload: { negotiationId }
//     sender's accept handler then SUMMONs deliver-template.
//
//   reject-template    peer -> sender
//     "No thanks." payload: { negotiationId, reason? }
//
//   deliver-template   sender -> peer
//     "Here is the bundle for the negotiation you accepted."
//     payload: { negotiationId, bundle }
//     response: { kind: "template-result", success, summary?, error? }
//
//   request-template   puller -> offerer
//     "Would you send me <subtreePath>?"
//     payload: { negotiationId, subtreePath, label? }
//     If policy admits, the offerer's fulfill-request handler runs
//     offer-template back at the puller. If not, the operator decides.
//
//   template-result    peer -> sender
//     "The plant completed (or failed). Here are the details."
//     payload: { negotiationId, success, summary?, error? }
//     terminal: sender records the outcome and the negotiation seals.
//
//   deliver-being      sender -> peer
//     One-shot identity graft (see NAMING above): auto-accepted, verified
//     self-certifyingly, lands the being verbatim. No review handshake.
//
// NEGOTIATION STATE lives in my qualities.federation map:
//
//   qualities.federation.pendingIncomingOffers[id]
//     { sender, manifest, label, sourceSubtreePath, at }
//   qualities.federation.pendingIncomingRequests[id]
//     { puller, subtreePath, label, at }
//   qualities.federation.pendingOutbound[id]
//     { direction, peer, subtreePath, label, manifest?, bundleCacheKey?, startedAt, lastStep }
//   qualities.federation.completed[id]
//     { direction, peer, success, summary?, error?, completedAt }
//
// Cached bundles (large) are stored as separate matter on the able
// being's reel so they don't bloat the qualities map; the bundleCacheKey
// names the matter id. (v1 inlines them for simplicity; matter-keyed
// cache is a follow-up when bundles get large enough to matter.)

import log from "../../../seedStory/log.js";

// federation-manager's summon handler-floor. The grant-set — what it can see / do / call — is the
// WORD (store/words/ables/federation-manager.word). This file is only the irreducible behavior the
// word can't express: classify an incoming SUMMON by intent and route it to ./handlers.js. genesis
// folds the word and attaches this as the spec's `call`, so the grant-set has one source (the word)
// and the handler is the floor.
export const federationManagerHandler = async (message, ctx) => {
  // Federation payload still rides inside content for cross-story
  // SUMMONs (the canopy serializer hasn't been updated to carry
  // envelope intent yet — see TODO in dispatchToPeer in ./handlers.js
  // and ./ops.js). Pull the rest of the federation fields from
  // content as before.
  const fedMessage = (typeof message?.content === "object" && message.content !== null
                     && message.content.kind === "federation")
    ? message.content
    : message;

  // Envelope intent first (per seed/SUMMON.md). Fall back to
  // content.intent / content.kind for legacy cross-story envelopes
  // that haven't migrated yet. Same-story callers should use the
  // envelope; cross-story callers will follow when canopy carries it.
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
    `routing intent="${intent}" askerStory=${ctx?.askerStory || "(local)"}`);
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
};
