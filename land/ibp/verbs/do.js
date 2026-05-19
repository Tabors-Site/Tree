// TreeOS IBP — DO verb handler.
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
// This handler does protocol-level work (parse, expand, resolve, authorize)
// then dispatches through `core.do` (seed/verbs.js) which:
//   - looks up the registered operation from seed/operations.js
//   - runs the handler
//   - auto-writes a Did
//   - returns the result
//
// See [[project_seed_four_verbs_only]] + [[project_ibp_universal_grammar]].

import log from "../../seed/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { ackOk, ackError, stripBeingQualifier } from "../envelope.js";
import { authorize } from "../authorize.js";
import { doVerb } from "../../seed/verbs.js";
import { getOperation, listOperations } from "../../seed/operations.js";

export async function handleDo(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, payload } = env;
    const action = typeof payload?.action === "string" ? payload.action : null;
    if (!action) {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "ibp DO payload must include `action`");
    }
    if (!getOperation(action)) {
      throw new PortalError(
        PORTAL_ERR.ACTION_NOT_SUPPORTED,
        `Unknown DO action: "${action}"`,
        { action, available: listOperations().map(op => op.name) },
      );
    }

    // DO targets positions; strip any @being qualifier on stance addresses.
    const positionString = stripBeingQualifier(address);

    const parsed = parseFromSocket(socket, positionString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
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

    // Stance Authorization gate.
    const identity = socket.beingId ? { beingId: socket.beingId, username: socket.username } : null;
    const namespace = (action === "set-meta" || action === "clear-meta")
      ? args?.namespace
      : undefined;
    const decision = await authorize({
      identity,
      verb: "do",
      target: { kind: "position", nodeId: resolved.nodeId },
      action,
      namespace,
    });
    if (!decision.ok) {
      throw new PortalError(
        identity ? PORTAL_ERR.FORBIDDEN : PORTAL_ERR.UNAUTHORIZED,
        `DO denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance, action },
      );
    }

    // Dispatch through the seed verb. The registered handler runs and
    // an audit Did is written automatically.
    const data = await doVerb(resolved, action, args, {
      identity,
      internal: true,
    });
    return ackOk(ack, id, data);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `ibp DO failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}
