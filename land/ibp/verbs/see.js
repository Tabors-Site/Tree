// TreeOS IBP — SEE verb handler.
//
// Envelope:
//   { id, position: "<position>", identity?, live?: boolean }
//   { id, stance:   "<stance>",   identity?, live?: boolean }
//
// Exactly one of `position` or `stance` is present. A position has no
// embodiment qualifier; a stance has one. The handler returns a Position
// Description (see portal/docs/position-description.md) describing what is at
// the addressed place, optionally augmented with embodiment-specific
// fields when the address is a stance.
//
// One-shot is wired below. Live mode (live: true) returns VERB_NOT_SUPPORTED
// until the subscription substrate is built.

import log from "../../seed/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { buildDescriptor } from "../descriptor.js";
import { buildDiscovery } from "../discovery.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { extractPositionOrStance, ackOk, ackError } from "../envelope.js";
import { authorize } from "../authorize.js";
import { subscribePosition } from "../live.js";

export async function handleSee(socket, msg, ack) {
  const id = msg?.id || null;
  try {
    const { addressString } = extractPositionOrStance(msg, "ibp:see");

    // Discovery short-circuit. `<land>/.discovery` is read by every client
    // right after socket open to learn capabilities and is implicitly
    // visible to arrivals (the bootstrap exception).
    if (isDiscoveryAddress(addressString)) {
      return ackOk(ack, id, buildDiscovery());
    }

    const parsed = parseFromSocket(socket, addressString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });

    const resolved = await resolveStance(expanded.right);

    // Stance Authorization gate.
    const identity = socket.beingId ? { beingId: socket.beingId, username: socket.username } : null;
    const decision = await authorize({
      identity,
      verb: "see",
      target: {
        kind: expanded.right.embodiment ? "stance" : "position",
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

    const descriptor = await buildDescriptor(resolved, {
      identity,
    });

    // Live mode: subscribe the socket to subsequent descriptor changes
    // for this position. Cleanup happens automatically on disconnect.
    if (msg.live === true && resolved.nodeId) {
      subscribePosition(socket, resolved.nodeId);
    }

    return ackOk(ack, id, descriptor);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("Portal", `ibp:see failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}

function isDiscoveryAddress(addressString) {
  return /\/\.discovery$/i.test(addressString);
}
