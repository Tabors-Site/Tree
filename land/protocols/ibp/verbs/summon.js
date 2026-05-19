// TreeOS IBP — SUMMON verb (wire adapter).
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "summon", address (stance), payload: { message, ...threading }, identity? }
//
// `payload.message` is the inbox payload: `{ from, content, intent?,
// correlation?, inReplyTo?, attachments?, sentAt?, activeRole? }`.
// `activeRole` may live on `message` OR at the top level of payload.
// The wire normalizes it onto message before delegating.
//
// Thin wire adapter: extracts envelope fields, composes the async-reply
// broadcaster, delegates to `summonVerb` in seed/core/verbs.js. The
// scheduler invokes the broadcaster when async summoning completes;
// the reply lands on every socket the asker has connected (via the
// being-room). See [[project_four_verbs_one_execution]] and
// [[project_protocol_transport_separation]].

import log from "../../../seed/core/log.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/core/errors.js";
import { ackOk, ackError } from "../envelope.js";
import { summonVerb } from "../../../seed/core/verbs.js";
import { getIO } from "../../../transports/ws/websocket.js";

/**
 * Broadcast an out-of-band IBP update (the async SUMMON reply) to
 * every socket the asker being has connected. Falls back to the
 * originating socket when beingId or io aren't available.
 *
 * Wire shape: `{ correlation, content }` per
 * [[project_protocol_transport_separation]]. `content` carries the
 * inbox entry; `correlation` matches what the client routes against
 * (rootCorrelation or inReplyTo, whichever the client tracked).
 */
function emitUpdateForSocket(socket) {
  return (entry) => {
    const update = {
      correlation: entry?.inReplyTo || entry?.correlation || null,
      content:     entry,
    };
    const beingId = socket?.beingId;
    const io = getIO();
    if (beingId && io) {
      try {
        io.to(`being:${String(beingId)}`).emit("ibp:update", update);
        return;
      } catch {}
    }
    try {
      if (socket?.connected) socket.emit("ibp:update", update);
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
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal portal error");
  }
}
