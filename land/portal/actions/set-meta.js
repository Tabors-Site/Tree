// TreeOS IBP — DO action: set-meta.
//
// Envelope (via the DO dispatcher):
//   { verb: "do", action: "set-meta", position | stance,
//     payload: { namespace, data, merge?: boolean } }
//
// Writes (or merges) data into a metadata namespace at the addressed tree
// node. The same shape covers every kind of namespace:
//
//   - extension namespaces: `values`, `codebook`, `governance`, etc.
//     carry extension-specific data.
//   - embodiment namespaces: `ruler`, `archivist`, ..., carry embodiment
//     configuration (system instructions, tools, permissions) that the
//     embodiment will read when summoned at this position.
//   - kernel-aware namespaces: `tools`, `modes`, `scope`, `llm`. These are
//     CORE_NAMESPACES in seed; the kernel allows direct writes to them.
//
// Reserved namespaces NOT writable through set-meta:
//   - `inbox`: written through TALK (per-being-per-position inbox).
//
// Returns { written: true, nodeId, namespace }.

import { setExtMeta, mergeExtMeta } from "../../seed/tree/extensionMetadata.js";
import { resolveTreeAccess } from "../../seed/tree/treeAccess.js";
import Node from "../../seed/models/node.js";
import { PortalError, PORTAL_ERR } from "../errors.js";

const RESERVED_FROM_SET_META = new Set(["inbox"]);

export async function setMeta(ctx) {
  const { userId, resolved, payload } = ctx;
  const { namespace, data, merge = true } = payload || {};

  if (!namespace || typeof namespace !== "string") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`namespace` is required");
  }
  if (RESERVED_FROM_SET_META.has(namespace)) {
    throw new PortalError(
      PORTAL_ERR.FORBIDDEN,
      `Namespace "${namespace}" is not writable through set-meta (write through the appropriate verb instead)`,
    );
  }
  if (data === undefined || data === null || typeof data !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`data` must be an object");
  }

  if (resolved.zone !== "tree") {
    throw new PortalError(
      PORTAL_ERR.VERB_NOT_SUPPORTED,
      `set-meta is not supported in zone "${resolved.zone}"`,
    );
  }
  if (!resolved.nodeId) {
    throw new PortalError(PORTAL_ERR.NODE_NOT_FOUND, "Resolved address has no nodeId");
  }

  const access = await resolveTreeAccess(resolved.nodeId, userId);
  if (!access?.ok || access.write !== true) {
    throw new PortalError(PORTAL_ERR.FORBIDDEN, "Not authorized to write metadata at this place");
  }

  const node = await Node.findById(resolved.nodeId);
  if (!node) {
    throw new PortalError(PORTAL_ERR.NODE_NOT_FOUND, "Node disappeared between resolve and write");
  }

  try {
    if (merge === false) {
      await setExtMeta(node, namespace, data);
    } else {
      await mergeExtMeta(node, namespace, data);
    }
    return { written: true, nodeId: String(node._id), namespace };
  } catch (err) {
    throw mapKernelError(err);
  }
}

function mapKernelError(err) {
  const msg = err?.message || "set-meta failed";
  if (/blocked/i.test(msg)) {
    return new PortalError(PORTAL_ERR.EXTENSION_BLOCKED, msg);
  }
  if (/Namespace violation/i.test(msg) || /reserved/i.test(msg)) {
    return new PortalError(PORTAL_ERR.FORBIDDEN, msg);
  }
  if (/Invalid extension name|reserved key|nested too|too large/i.test(msg)) {
    return new PortalError(PORTAL_ERR.INVALID_INPUT, msg);
  }
  if (/document size/i.test(msg)) {
    return new PortalError(PORTAL_ERR.DOCUMENT_SIZE_EXCEEDED, msg);
  }
  return new PortalError(PORTAL_ERR.INTERNAL, msg);
}
