// IBP SEE — wire adapter.
//
// Envelope: { id, verb: "see", address, payload: { live?: boolean }, identity? }
//
// Thin glue: delegates to `seeVerb` in seed/ibp/verbs.js for the
// descriptor, then subscribes the socket to live updates when the
// payload asks for them. See [[project_four_verbs_one_execution]].

import log from "../../../seed/system/log.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/errors.js";
import { ackOk, ackError } from "../envelope.js";
import { seeVerb } from "../../../seed/ibp/verbs.js";
import { subscribePosition } from "../live.js";

export async function handleSee(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, addressKind, payload } = env;
    const identity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;

    const descriptor = await seeVerb(address, {
      identity,
      addressKind,
      currentUser: socket.name,
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
