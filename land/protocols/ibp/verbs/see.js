// TreeOS IBP — SEE verb handler.
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "see", address, payload: { live?: boolean }, identity? }
//
// `address` is a position (no @being) or a stance (with @being). A stance
// resolves to its position for descriptor building, augmented with
// being-specific fields when an @being qualifier is present.
//
// Returns a Position Description (see portal/docs/position-description.md).
// `payload.live: true` subscribes the socket to subsequent descriptor
// changes for this position; cleanup fires automatically on disconnect.

import log from "../../../seed/core/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { buildDescriptor } from "../descriptor.js";
import { buildDiscovery } from "../discovery.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { ackOk, ackError } from "../envelope.js";
import { authorize } from "../authorize.js";
import { subscribePosition } from "../live.js";

export async function handleSee(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, addressKind, payload } = env;

    // Discovery short-circuit. `<land>/.discovery` is read by every client
    // right after socket open to learn capabilities; the bootstrap
    // exception permits unauthenticated readers.
    if (isDiscoveryAddress(address)) {
      return ackOk(ack, id, buildDiscovery());
    }

    const parsed = parseFromSocket(socket, address);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.name,
    });

    const resolved = await resolveStance(expanded.right);

    // Stance Authorization gate.
    const identity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;
    const decision = await authorize({
      identity,
      verb: "see",
      target: {
        kind: addressKind === "stance" ? "stance" : "position",
        nodeId: resolved.nodeId,
        visibility: resolved.leafNode?.visibility,
        isDiscovery: false,
      },
    });
    if (!decision.ok) {
      throw new PortalError(
        identity ? PORTAL_ERR.FORBIDDEN : PORTAL_ERR.UNAUTHORIZED,
        `SEE denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
      );
    }

    const descriptor = await buildDescriptor(resolved, { identity });

    // Live subscription. The socket receives subsequent ibp:update events
    // for this position while subscribed.
    if (payload?.live === true && resolved.nodeId) {
      subscribePosition(socket, resolved.nodeId);
    }

    return ackOk(ack, id, descriptor);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `ibp SEE failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}

function isDiscoveryAddress(addressString) {
  return /\/\.discovery$/i.test(addressString);
}
