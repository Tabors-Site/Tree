// IBP SEE — wire adapter.
//
// Envelope: { id, verb: "see", address, payload: { live?, at? } }
//
// Thin glue: delegates to `seeVerb` in seed/ibp/verbs/see.js for the
// descriptor, then subscribes the socket to live updates when the
// payload asks for them.
//
// Identity flows from the authenticated socket, NOT from the envelope.
// The address IS the identity for verb dispatch (per Diff A doctrine);
// the seed-side seeVerb takes an `identity` opt for back-compat
// during the migration but the wire constructs it from socket.
//
// `payload.at = { atSeq?, atTimestamp? }` is the historical-read
// qualifier. When present, the descriptor returned is the substrate's
// state as of that past point (foldAt under the hood) instead of the
// current weave. Read-only — the substrate refuses DO / SUMMON / BE
// when `at` is set, so subscriptions to live updates are also skipped
// on the historical path (a past state has no live patches to push).

import log from "../../../seed/seedStory/log.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError } from "../envelope.js";
import { seeVerb } from "../../../seed/ibp/verbs/see.js";
import { subscribePosition } from "../live.js";
import { subscribeInnerFace } from "../innerFaceLive.js";

export async function handleSee(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, addressKind, payload } = env;
    // Unauthenticated callers get the arrival stance. assertVerbCaller
    // in seed/ibp/verbs/_shared.js requires a truthy identity; without this
    // the wire-layer SEE refused every visitor before they could even
    // see what they were joining. authorize sees beingId:null and
    // applies ARRIVAL_PROPS (arrival: true); the relaxed place-root
    // SEE default `requires: {}` admits. Per-position rules at
    // private trees can still tighten..
    const identity = socket.beingId
      ? { beingId: socket.beingId, name: socket.name, nameId: socket.nameId || null }
      : { beingId: null, name: "arrival", nameId: socket.nameId || null };

    const descriptor = await seeVerb(address, {
      identity,
      addressKind,
      currentUser: socket.name || "arrival",
      // First-person stance hint: the socket's tracked history + path
      // are the implicit "where am I" context the parser fills
      // relative addresses against.
      currentHistory: socket.currentHistory || "0",
      currentPath:   socket.currentPath   || "/",
      payload,
      // Historical-read qualifier hoists out of payload so the seed
      // verb sees it as a first-class option (alongside identity /
      // addressKind). Wire shape stays payload-based for client
      // ergonomics; the seed boundary is opts-based for clarity.
      at: payload?.at || null,
    });

    // Wire-layer concern: live updates need a socket to push patches
    // through. In-process callers of seeVerb don't have one, so the
    // subscription stays here rather than in the seed verb. Historical
    // descriptors carry isHistorical:true and have no live patches to
    // subscribe to — skip the subscribe call so a past view doesn't
    // get spuriously refreshed when the live present changes.
    if (
      payload?.live === true &&
      socket?.id &&
      descriptor?.address?.spaceId &&
      !descriptor?.isHistorical
    ) {
      subscribePosition(socket, descriptor.address.spaceId);
    }

    // Inner-face live subscription. When the address resolved to the
    // my-inner-face SEE op (or any future op flagged liveInnerFace by
    // returning a face with weave), and the caller asked for live,
    // register the per-stance subscription so subsequent reel arrivals
    // refold and push back. The portal calls this on every navigate;
    // resubscribing on the same socket+stance rotates the weave
    // rather than minting a new id (innerFaceLive owns that policy).
    if (
      payload?.live === true &&
      socket?.id &&
      socket.beingId &&
      descriptor &&
      Array.isArray(descriptor.weave)
    ) {
      try {
        subscribeInnerFace(
          socket,
          {
            beingId: socket.beingId,
            history: socket.currentHistory || "0",
          },
          descriptor,
        );
      } catch (err) {
        log.warn("IBP", `subscribeInnerFace failed: ${err.message}`);
      }
    }

    // Track first-person stance from the resolved descriptor. Every
    // successful live SEE updates the socket's currentPath so
    // subsequent DO/SUMMON/BE calls inherit the caller's left-stance
    // path (e.g. `~` and relative addresses resolve correctly).
    // currentHistory is intentionally NOT updated here — the session's
    // history is the BE ops' concern (birth/connect/release/switch
    // return seatHistory; handleBe seats it). The discipline is
    // structural: navigating a SEE does not switch the being's
    // act-reel; only an explicit be:switch does. See cherub's
    // switchHandler.
    if (descriptor?.address && !descriptor.isHistorical) {
      const p = descriptor.address.pathByNames || descriptor.address.path;
      if (typeof p === "string") socket.currentPath = p;
    }

    return ackOk(ack, id, descriptor);
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `SEE failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }
}
