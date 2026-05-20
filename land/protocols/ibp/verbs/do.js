// TreeOS IBP — DO verb (wire adapter).
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "do", address, payload: { action, args?, ... }, identity? }
//
// `address` is a position; a stance shape is accepted but its @being
// qualifier is informational (stripped). The world is data at positions;
// beings are not data targets.
//
// `payload.action` names the registered DO operation (e.g. "create-child",
// "set-meta", or extension ops like "governing:flag-issue"). `payload.args`
// (canonical) carries the operation's arguments. For backward-compat the
// rest of payload (minus `action` + `identity`) is also accepted as args.
//
// Thin wire adapter: parses envelope, strips @being from address,
// resolves the stance to a target, delegates to `doVerb` in
// seed/ibp/verbs.js. Stance authorization, read-only origin checks,
// handler dispatch, and the audit Did all happen inside doVerb. See
// [[project_four_verbs_one_execution]].

import log from "../../../seed/system/log.js";
import { parseFromSocket, expand, getLandDomain } from "../../../seed/ibp/address.js";
import { resolveStance } from "../../../seed/ibp/resolver.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/errors.js";
import { ackOk, ackError, stripBeingQualifier } from "../envelope.js";
import { doVerb } from "../../../seed/ibp/verbs.js";
import { getOperation, listOperations } from "../../../seed/ibp/operations.js";

export async function handleDo(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, payload } = env;
    const action = typeof payload?.action === "string" ? payload.action : null;
    if (!action) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "ibp DO payload must include `action`");
    }
    if (!getOperation(action)) {
      throw new IbpError(
        IBP_ERR.ACTION_NOT_SUPPORTED,
        `Unknown DO action: "${action}"`,
        { action, available: listOperations().map(op => op.name) },
      );
    }

    // DO targets positions; strip any @being qualifier on stance addresses.
    const positionString = stripBeingQualifier(address);

    const parsed = parseFromSocket(socket, positionString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.name,
    });
    const resolved = await resolveStance(expanded.right);

    // Resolve operation args. Canonical: payload.args. Fallback: every
    // payload field except `action` + `identity`.
    const args = payload.args !== undefined
      ? payload.args
      : (() => {
          const { action: _a, identity: _i, ...rest } = payload;
          return rest;
        })();

    const identity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;

    const data = await doVerb(resolved, action, args, { identity });
    return ackOk(ack, id, data);
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `DO failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }
}
