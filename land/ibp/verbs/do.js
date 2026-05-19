// TreeOS IBP . DO verb handler.
//
// Envelope:
//   { id, action, position: "<position>", identity, payload }
//
// DO accepts `position` only. The world is data at positions; beings
// are not data targets. The requester's role, when relevant for
// authorization, lives in the identity token.
//
// This wire handler is now a thin envelope adapter. It does the
// protocol-level work (parse address, expand, resolve, authorize)
// then dispatches through `core.do` (seed/verbs.js) which:
//   - looks up the registered operation from seed/operations.js
//   - runs the handler
//   - auto-writes a Did
//   - returns the handler's result
//
// Action catalog (registered in seed/coreOperations.js):
//   - create-child     (structural: add a new child node)
//   - set-name         (field update: rename a node)
//   - set-status       (field update: change a node's status)
//   - set-meta         (metadata update: write to namespace, accepts
//                       node/being/artifact targets)
//
// Extensions can register additional operations through
// `core.do.registerOperation(...)` and they become reachable here
// automatically; no change to this dispatcher needed.
//
// See [[project_seed_four_verbs_only]] for the architectural framing.

import log from "../../seed/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { extractPosition, ackOk, ackError } from "../envelope.js";
import { authorize } from "../authorize.js";
import { doVerb } from "../../seed/verbs.js";
import { getOperation, listOperations } from "../../seed/operations.js";

export async function handleDo(socket, msg, ack) {
  const id = msg?.id || null;
  try {
    const action = typeof msg?.action === "string" ? msg.action : null;
    if (!action) {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "ibp:do requires an `action` field");
    }
    // Look up against the registry. Operations registered by extensions
    // are reachable here without this dispatcher knowing about them.
    if (!getOperation(action)) {
      throw new PortalError(
        PORTAL_ERR.ACTION_NOT_SUPPORTED,
        `Unknown DO action: "${action}"`,
        { action, available: listOperations().map(op => op.name) },
      );
    }

    const positionString = extractPosition(msg, "ibp:do");

    const parsed = parseFromSocket(socket, positionString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });
    const resolved = await resolveStance(expanded.right);

    // Stance Authorization gate. This runs at the wire layer; core.do
    // is called with { internal: true } to skip a second authorize when
    // Phase 2+ adds auth inside the dispatcher.
    const identity = socket.beingId ? { beingId: socket.beingId, username: socket.username } : null;
    const namespace = action === "set-meta" || action === "clear-meta"
      ? msg?.payload?.namespace
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
    // an audit Did is written automatically. `internal: true` reserves
    // the future-auth-skip flag for when the dispatcher learns to gate
    // calls itself; today both wire and extension callers are equally
    // unauthorized at the dispatcher layer.
    const data = await doVerb(resolved, action, msg.payload || {}, {
      identity,
      internal: true,
    });
    return ackOk(ack, id, data);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `ibp:do failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}
