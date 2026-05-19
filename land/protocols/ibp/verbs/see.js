// TreeOS IBP — SEE verb (wire adapter).
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "see", address, payload: { live?: boolean }, identity? }
//
// Thin wire adapter: extracts envelope fields, delegates to `seeVerb`
// in seed/core/verbs.js for execution, returns the descriptor as the
// ack body. Address resolution, stance authorization, descriptor
// construction, discovery short-circuit, and live subscription all
// happen inside seeVerb. See [[project_four_verbs_one_execution]].

import log from "../../../seed/core/log.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { ackOk, ackError } from "../envelope.js";
import { seeVerb } from "../../../seed/core/verbs.js";

export async function handleSee(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, addressKind, payload } = env;
    const identity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;

    const descriptor = await seeVerb(address, {
      identity,
      addressKind,
      currentUser: socket.name,
      live:        payload?.live === true,
      socket,
    });

    return ackOk(ack, id, descriptor);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `ibp SEE failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}
