/**
 * Approve Core
 *
 * beforeToolCall hook checks if the tool is on the watchlist.
 * If yes, freezes the call, creates a pending request, notifies
 * the operator, and returns a Promise that resolves when the
 * operator approves or rejects.
 *
 * The freeze is a Promise stored in memory. The resolve/reject
 * functions are held in a Map. When the operator hits the
 * approve/reject endpoint, the Promise resolves and the tool
 * call either proceeds or gets cancelled.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { v4 as uuidv4 } from "uuid";

// In-memory pending requests. Map<requestId, { resolve, reject, request }>
const pending = new Map();
const MAX_PENDING = 100;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min default, configurable

let _emitToUser = null;
let _notify = null;

export function setServices({ websocket, notifications, gateway }) {
  if (websocket?.emitToUser) _emitToUser = websocket.emitToUser;
  if (notifications) _notify = notifications;
}

// ─────────────────────────────────────────────────────────────────────────
// WATCHLIST
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the watchlist for a node (inherits from ancestors via metadata).
 */
export async function getWatchlist(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return [];
  const meta = node.metadata instanceof Map
    ? node.metadata.get("approve")
    : node.metadata?.approve;
  return meta?.watchlist || [];
}

/**
 * Get the effective watchlist by walking ancestors.
 * A tool watched at any ancestor applies to all descendants.
 */
export async function getEffectiveWatchlist(nodeId) {
  const watched = new Set();
  try {
    const { getAncestorChain } = await import("../../seed/tree/ancestorCache.js");
    const ancestors = await getAncestorChain(nodeId);
    if (ancestors) {
      for (const ancestor of ancestors) {
        const meta = ancestor.metadata instanceof Map
          ? ancestor.metadata.get("approve")
          : ancestor.metadata?.approve;
        if (meta?.watchlist) {
          for (const tool of meta.watchlist) watched.add(tool);
        }
      }
    }
  } catch {
    // Fallback: just check this node
    const local = await getWatchlist(nodeId);
    for (const tool of local) watched.add(tool);
  }
  return watched;
}

/**
 * Add a tool to the watchlist at a node.
 */
export async function watchTool(nodeId, toolName) {
  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");

  const meta = getExtMeta(node, "approve") || {};
  if (!meta.watchlist) meta.watchlist = [];
  if (meta.watchlist.includes(toolName)) return meta.watchlist;

  meta.watchlist.push(toolName);
  await setExtMeta(node, "approve", meta);
  await node.save();
  return meta.watchlist;
}

/**
 * Remove a tool from the watchlist at a node.
 */
export async function unwatchTool(nodeId, toolName) {
  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");

  const meta = getExtMeta(node, "approve") || {};
  if (!meta.watchlist) return [];

  meta.watchlist = meta.watchlist.filter(t => t !== toolName);
  await setExtMeta(node, "approve", meta);
  await node.save();
  return meta.watchlist;
}

// ─────────────────────────────────────────────────────────────────────────
// REQUEST LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a pending approval request. Returns a Promise that resolves
 * when the operator decides.
 */
export function createRequest({ toolName, args, nodeId, userId, rootId }) {
  if (pending.size >= MAX_PENDING) {
    throw new Error("Too many pending approval requests. Approve or reject existing ones first.");
  }

  const id = uuidv4();
  const request = {
    id,
    toolName,
    args: sanitizeArgs(args),
    nodeId,
    userId,
    rootId,
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  pending.set(id, { resolve, reject, request });

  // Timeout: auto-reject after configurable duration
  const timer = setTimeout(() => {
    if (pending.has(id)) {
      const entry = pending.get(id);
      entry.request.status = "timeout";
      entry.reject(new Error(`Approval request timed out after ${DEFAULT_TIMEOUT_MS / 60000} minutes`));
      pending.delete(id);
    }
  }, DEFAULT_TIMEOUT_MS);
  if (timer.unref) timer.unref();

  // Notify operator
  notifyOperator(request);

  return { id, promise, request };
}

/**
 * Resolve a pending request (approve or reject).
 */
export function resolveRequest(requestId, decision, userId) {
  const entry = pending.get(requestId);
  if (!entry) return null;

  entry.request.status = decision;
  entry.request.resolvedBy = userId;
  entry.request.resolvedAt = new Date().toISOString();

  if (decision === "approved") {
    entry.resolve({ approved: true, request: entry.request });
  } else {
    entry.reject(new Error(`Tool call rejected by operator: ${entry.request.toolName}`));
  }

  pending.delete(requestId);
  return entry.request;
}

/**
 * Get all pending requests.
 */
export function getPendingRequests() {
  return [...pending.values()].map(e => e.request);
}

// ─────────────────────────────────────────────────────────────────────────
// NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────

function notifyOperator(request) {
  const message = `Tool "${request.toolName}" needs approval at node ${request.nodeId}. ` +
    `Args: ${JSON.stringify(request.args).slice(0, 200)}`;

  // WebSocket: real-time if operator is connected
  if (_emitToUser && request.userId) {
    try {
      _emitToUser(request.userId, "approvalRequired", {
        id: request.id,
        toolName: request.toolName,
        args: request.args,
        nodeId: request.nodeId,
        createdAt: request.createdAt,
      });
    } catch {}
  }

  // Notifications extension: persistent
  if (_notify) {
    try {
      const Notification = _notify;
      Notification.create({
        userId: request.userId,
        rootId: request.rootId,
        type: "approve",
        title: `Approval needed: ${request.toolName}`,
        content: message,
      }).catch(() => {});
    } catch {}
  }

  // Gateway: push to external channel if configured
  try {
    import("../loader.js").then(({ getExtension }) => {
      const gw = getExtension("gateway");
      if (gw?.exports?.dispatchNotifications) {
        gw.exports.dispatchNotifications(request.rootId, [{
          type: "approval",
          title: `Approval needed: ${request.toolName}`,
          content: message,
        }]).catch(() => {});
      }
    }).catch(() => {});
  } catch {}

  log.verbose("Approve", `Approval requested: ${request.toolName} (${request.id.slice(0, 8)})`);
}

/**
 * Sanitize tool args for display. Remove sensitive fields, truncate large values.
 */
function sanitizeArgs(args) {
  if (!args || typeof args !== "object") return {};
  const safe = {};
  for (const [key, val] of Object.entries(args)) {
    if (key === "userId" || key === "chatId" || key === "sessionId") continue;
    if (typeof val === "string" && val.length > 500) {
      safe[key] = val.slice(0, 497) + "...";
    } else {
      safe[key] = val;
    }
  }
  return safe;
}
