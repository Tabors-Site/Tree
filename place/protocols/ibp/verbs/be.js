// TreeOS IBP — BE verb (wire adapter).
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "be", address (stance or place), payload, identity? }
//
// `payload.op` is one of "register" | "claim" | "release" | "switch".
// Remaining payload fields carry operation-specific credentials/state:
//
//   register  { op, name, password, ... }
//   claim     { op, name, password }         (against the place's auth-being)
//   claim     { op }                          (re-claim a held stance)
//   release   { op }
//   switch    { op, from }                    (address is the target stance)
//
// BE addresses the place's auth-being. A bare-place address (e.g.
// "treeos.ai") is shorthand for the auth-being stance "treeos.ai/@auth".
// For release/switch/token-reclaim the address is the held stance.
//
// Thin wire adapter: extracts envelope fields, delegates to `beVerb`
// in seed/ibp/verbs.js. The auth-being role (seed/cognition/roles/auth.js)
// runs there. See [[project_four_verbs_one_execution]].

import log from "../../../seed/system/log.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError } from "../envelope.js";
import { beVerb } from "../../../seed/ibp/verbs.js";

export async function handleBe(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, addressKind, payload } = env;
    const operation = payload?.op || payload?.operation;

    // Strip op/operation/identity from payload before handing it to
    // beVerb. What remains is the operation-specific data.
    const { op: _op, operation: _operation, identity: _identityField, ...opPayload } = payload || {};

    const identity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;

    const result = await beVerb(operation, opPayload, {
      address,
      addressKind,
      identity,
      socket,
      req: socket?._req || null,
    });

    return ackOk(ack, id, result);
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `BE failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }
}
