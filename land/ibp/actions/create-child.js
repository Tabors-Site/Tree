// TreeOS IBP — DO action: create-child.
//
// Envelope (via the DO dispatcher):
//   { verb: "do", action: "create-child", position | stance, payload: { name, type? } }
//
// Creates a child node under the addressed place. The parent is determined
// from the resolved address:
//   - land zone: cannot create-child at the land root (use a tree root via
//     a separate flow); INVALID_INPUT
//   - home zone: parent is the user's home; the new child is a tree root
//     under that user
//   - tree zone: parent is the resolved node
//
// Returns { nodeId, position } pointing at the new child.

import { createNode } from "../../seed/tree/treeManagement.js";
import { getLandDomain } from "../address.js";
import { PortalError, PORTAL_ERR } from "../errors.js";

export async function createChild(ctx) {
  const { userId, resolved, payload } = ctx;
  const { name, type = null } = payload || {};

  if (!name || typeof name !== "string") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`name` is required");
  }

  if (resolved.zone === "land") {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      "Cannot create-child at the land root. Create a tree root via the home zone instead.",
    );
  }

  // Home zone: the new child is a tree root for that user.
  if (resolved.zone === "home") {
    if (String(resolved.userId) !== String(userId)) {
      throw new PortalError(
        PORTAL_ERR.FORBIDDEN,
        "Cannot create a tree root in another user's home",
      );
    }
    try {
      const newNode = await createNode({
        name,
        type,
        isRoot: true,
        userId,
      });
      return shape(newNode);
    } catch (err) {
      throw mapKernelError(err);
    }
  }

  // Tree zone: the addressed node is the parent.
  if (resolved.zone === "tree") {
    if (!resolved.nodeId) {
      throw new PortalError(PORTAL_ERR.NODE_NOT_FOUND, "Resolved tree-zone parent has no nodeId");
    }
    try {
      const newNode = await createNode({
        name,
        type,
        parentId: resolved.nodeId,
        userId,
      });
      return shape(newNode);
    } catch (err) {
      throw mapKernelError(err);
    }
  }

  throw new PortalError(PORTAL_ERR.VERB_NOT_SUPPORTED, `create-child is not supported in zone "${resolved.zone}"`);
}

function shape(newNode) {
  // The createNode return is a Mongoose doc-ish object. We return the
  // canonical ids and the kernel-known land path so the client can navigate.
  const land = getLandDomain();
  return {
    nodeId: String(newNode._id),
    name: newNode.name,
    // The full position string is most accurately built by walking the
    // ancestor chain. For now we return the bare nodeId form, which the
    // client can resolve via a follow-up SEE to learn the canonical path.
    position: `${land}/${String(newNode._id)}`,
  };
}

function mapKernelError(err) {
  const msg = err?.message || "create-child failed";
  // The kernel's createNode throws plain Errors with descriptive messages.
  // Map common cases to IBP error codes.
  if (/cancelled by extension/i.test(msg)) {
    return new PortalError(PORTAL_ERR.FORBIDDEN, msg);
  }
  if (/system nodes|reserved|invalid/i.test(msg)) {
    return new PortalError(PORTAL_ERR.INVALID_INPUT, msg);
  }
  if (/not found/i.test(msg)) {
    return new PortalError(PORTAL_ERR.NODE_NOT_FOUND, msg);
  }
  return new PortalError(PORTAL_ERR.INTERNAL, msg);
}
