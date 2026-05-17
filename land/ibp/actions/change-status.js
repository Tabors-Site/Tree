// TreeOS IBP — DO action: change-status.
//
// Envelope (via the DO dispatcher):
//   { verb: "do", action: "change-status", position | stance,
//     payload: { status, isInherited? } }
//
// Changes the status of the addressed tree node. Land and home zones are
// not status-bearing; only tree-zone nodes accept this action. Returns
// { nodeId, status }.

import { editStatus } from "../../seed/tree/statuses.js";
import { resolveTreeAccess } from "../../seed/tree/treeAccess.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";

export async function changeStatus(ctx) {
  const { userId, resolved, payload } = ctx;
  const { status, isInherited } = payload || {};

  if (!status || typeof status !== "string") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`status` is required");
  }

  if (resolved.zone !== "tree") {
    throw new PortalError(
      PORTAL_ERR.VERB_NOT_SUPPORTED,
      `change-status is not supported in zone "${resolved.zone}"`,
    );
  }
  if (!resolved.nodeId) {
    throw new PortalError(PORTAL_ERR.NODE_NOT_FOUND, "Resolved address has no nodeId");
  }

  const access = await resolveTreeAccess(resolved.nodeId, userId);
  if (!access?.ok || access.write !== true) {
    throw new PortalError(PORTAL_ERR.FORBIDDEN, "Not authorized to change status at this place");
  }

  try {
    await editStatus({
      nodeId: resolved.nodeId,
      status,
      isInherited: isInherited === true,
      userId,
    });
    return { nodeId: String(resolved.nodeId), status };
  } catch (err) {
    if (isPortalError(err)) throw err;
    throw mapKernelError(err);
  }
}

function mapKernelError(err) {
  const msg = err?.message || "change-status failed";
  // ProtocolError thrown by the hook system carries err.errCode (see seed/protocol.js).
  if (err && err.name === "ProtocolError" && err.errCode) {
    return new PortalError(err.errCode, msg);
  }
  if (/Invalid status/i.test(msg)) {
    return new PortalError(PORTAL_ERR.INVALID_STATUS, msg);
  }
  if (/system nodes/i.test(msg)) {
    return new PortalError(PORTAL_ERR.FORBIDDEN, msg);
  }
  if (/not found/i.test(msg)) {
    return new PortalError(PORTAL_ERR.NODE_NOT_FOUND, msg);
  }
  return new PortalError(PORTAL_ERR.INTERNAL, msg);
}
