// TreeOS IBP — DO verb handler.
//
// Envelope:
//   { id, action, position: "<position>", identity, payload }
//
// DO accepts `position` only. The world is data at positions; embodiments
// are not data targets. The requester's role, when relevant for
// authorization, lives in the identity token.
//
// Dispatches the named action against the resolved position. The action
// itself owns its payload schema and the call into the kernel mutation
// primitive. See portal/docs/do-actions.md for the catalog.
//
// Phase 3 wires four actions:
//   - create-child
//   - rename
//   - change-status
//   - set-meta

import log from "../../seed/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { extractPosition, ackOk, ackError } from "../envelope.js";
import { authorize } from "../authorize.js";

import { createChild } from "../actions/create-child.js";
import { rename } from "../actions/rename.js";
import { changeStatus } from "../actions/change-status.js";
import { setMeta } from "../actions/set-meta.js";

const ACTIONS = Object.freeze({
  "create-child":  createChild,
  "rename":        rename,
  "change-status": changeStatus,
  "set-meta":      setMeta,
});

export async function handleDo(socket, msg, ack) {
  const id = msg?.id || null;
  try {
    const action = typeof msg?.action === "string" ? msg.action : null;
    if (!action) {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "portal:do requires an `action` field");
    }
    const handler = ACTIONS[action];
    if (!handler) {
      throw new PortalError(
        PORTAL_ERR.ACTION_NOT_SUPPORTED,
        `Unknown DO action: "${action}"`,
        { action, available: Object.keys(ACTIONS) },
      );
    }

    const positionString = extractPosition(msg, "portal:do");

    const parsed = parseFromSocket(socket, positionString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });
    const resolved = await resolveStance(expanded.right);

    // Stance Authorization gate.
    const identity = socket.userId ? { userId: socket.userId, username: socket.username } : null;
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

    const ctx = {
      socket,
      userId: socket.userId,
      username: socket.username,
      resolved,
      payload: msg.payload || {},
    };

    const data = await handler(ctx);
    return ackOk(ack, id, data);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("Portal", `portal:do failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}
