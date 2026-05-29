// IBP SEE — wire adapter.
//
// Envelope: { id, verb: "see", address, payload: { live?: boolean }, identity? }
//
// Thin glue: delegates to `seeVerb` in seed/ibp/verbs/see.js for the
// descriptor, then subscribes the socket to live updates when the
// payload asks for them. See [[project_four_verbs_one_execution]].

import log from "../../../seed/seedReality/log.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError } from "../envelope.js";
import { seeVerb } from "../../../seed/ibp/verbs/see.js";
import { subscribePosition } from "../live.js";

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
    // private trees can still tighten. See [[project-arrival-see]].
    const identity = socket.beingId
      ? { beingId: socket.beingId, name: socket.name }
      : { beingId: null, name: "arrival" };

    const descriptor = await seeVerb(address, {
      identity,
      addressKind,
      currentUser: socket.name || "arrival",
      payload,
    });

    // Wire-layer concern: live updates need a socket to push patches
    // through. In-process callers of seeVerb don't have one, so the
    // subscription stays here rather than in the seed verb.
    if (payload?.live === true && socket?.id && descriptor?.address?.spaceId) {
      subscribePosition(socket, descriptor.address.spaceId);
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
