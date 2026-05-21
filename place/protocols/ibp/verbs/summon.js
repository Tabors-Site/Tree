// TreeOS IBP — SUMMON verb (wire adapter).
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "summon", address (stance), payload: { message, ...threading }, identity? }
//
// `payload.message` is the inbox payload: `{ from, content,
// correlation?, inReplyTo?, attachments?, sentAt?, activeRole? }`.
// `activeRole` may live on `message` OR at the top level of payload.
// The wire normalizes it onto message before delegating.
//
// Thin wire adapter: extracts envelope fields, composes the async-reply
// broadcaster, delegates to `summonVerb` in seed/ibp/verbs.js. The
// scheduler invokes the broadcaster when async summoning completes;
// the reply places on every socket the asker has connected (via the
// being-room). See [[project_four_verbs_one_execution]] and
// [[project_protocol_transport_separation]].

import log from "../../../seed/system/log.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError } from "../envelope.js";
import { summonVerb } from "../../../seed/ibp/verbs.js";
import { emitToBeingRoom } from "../../../seed/ibp/pushChannel.js";
import { IBP_EVENT } from "../events.js";

/**
 * Broadcast an out-of-band SUMMON push (async reply or unsolicited
 * inbox arrival) to every socket the recipient being has connected.
 * Falls back to the originating socket when beingId isn't tracked.
 *
 * The push rides the unified `ibp` event:
 *
 *   { verb: "summon", payload: <inbox entry> }
 *
 * Direction (server → client) is implicit. The client routes by
 * envelope.verb and uses `payload.inReplyTo` / `payload.correlation`
 * to match against whatever it's awaiting.
 */
function emitUpdateForSocket(socket) {
  return (entry) => {
    const envelope = { verb: "summon", payload: entry };
    const beingId = socket?.beingId;
    if (beingId) {
      try {
        emitToBeingRoom(beingId, IBP_EVENT, envelope);
        return;
      } catch {}
    }
    try {
      if (socket?.connected) socket.emit(IBP_EVENT, envelope);
    } catch {}
  };
}

export async function handleSummon(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, payload } = env;
    if (!payload?.message || typeof payload.message !== "object") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "SUMMON payload must include a `message` object");
    }

    // Normalize threading: activeRole may live at payload.activeRole or
    // inside message.activeRole. summonVerb reads from message.
    const message = {
      ...payload.message,
      activeRole: payload.message.activeRole || payload.activeRole || null,
    };

    const identity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;

    const result = await summonVerb(address, message, {
      identity,
      currentUser: socket.name,
      onResponse:  emitUpdateForSocket(socket),
    });

    return ackOk(ack, id, result);
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `SUMMON failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }
}
