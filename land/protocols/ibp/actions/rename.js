// TreeOS IBP — DO action: rename.
//
// Envelope (via the DO dispatcher):
//   { verb: "do", action: "rename", position | stance, payload: { name } }
//
// Renames the node at the addressed place. Land and home zones cannot be
// renamed (they are reserved roots). Returns { nodeId, name }.

import { editNodeName } from "../../../seed/tree/treeManagement.js";
import { resolveTreeAccess } from "../../../seed/tree/treeAccess.js";
import { PortalError, PORTAL_ERR } from "../errors.js";

export async function rename(ctx) {
  const { beingId, resolved, payload } = ctx;
  const { name } = payload || {};

  if (!name || typeof name !== "string") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`name` is required");
  }

  // Zones retired 2026-05-18 — rename needs a nodeId. Stance
  // authorization decides whether the actor can rename at this position.
  if (!resolved.nodeId) {
    throw new PortalError(PORTAL_ERR.NODE_NOT_FOUND, "Resolved address has no nodeId");
  }

  // Authorization: the kernel's editNodeName does not currently check tree
  // access on its own. Guard with resolveTreeAccess to fail fast.
  const access = await resolveTreeAccess(resolved.nodeId, beingId);
  if (!access?.ok || access.write !== true) {
    throw new PortalError(PORTAL_ERR.FORBIDDEN, "Not authorized to rename at this place");
  }

  try {
    await editNodeName({
      nodeId: resolved.nodeId,
      newName: name,
      beingId,
    });
    return { nodeId: String(resolved.nodeId), name };
  } catch (err) {
    throw mapKernelError(err);
  }
}

function mapKernelError(err) {
  const msg = err?.message || "rename failed";
  if (/system nodes/i.test(msg)) {
    return new PortalError(PORTAL_ERR.FORBIDDEN, msg);
  }
  if (/not found/i.test(msg)) {
    return new PortalError(PORTAL_ERR.NODE_NOT_FOUND, msg);
  }
  if (/cannot|reserved|invalid|characters|empty|HTML/i.test(msg)) {
    return new PortalError(PORTAL_ERR.INVALID_INPUT, msg);
  }
  return new PortalError(PORTAL_ERR.INTERNAL, msg);
}
