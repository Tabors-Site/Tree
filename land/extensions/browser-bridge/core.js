/**
 * Browser Bridge Core
 *
 * Manages WebSocket connections to Chrome extensions.
 * Request/response correlation. Site scoping. Activity logging.
 */

import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";
import { createArtifact } from "../../seed/tree/artifacts.js";

let _metadata = null;
let _Node = null;

export function configure({ metadata, Node }) {
  _metadata = metadata;
  _Node = Node;
}

// Active browser connections: beingId -> socket
const _connections = new Map();

// Pending requests: requestId -> { resolve, reject, timer }
const _pending = new Map();

// Last known URL per user
const _currentUrls = new Map();

const REQUEST_TIMEOUT_MS = 15000;

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

export function registerConnection(beingId, socket) {
  // Disconnect previous browser connection for this user (if any)
  const existing = _connections.get(beingId);
  if (existing && existing.id !== socket.id) {
    existing.emit("browserDisconnected", { reason: "new connection" });
  }
  _connections.set(beingId, socket);
  log.info("BrowserBridge", `Browser connected for user ${beingId}`);

  socket.on("disconnect", () => {
    if (_connections.get(beingId)?.id === socket.id) {
      _connections.delete(beingId);
      _currentUrls.delete(beingId);
      // Reject all pending requests for this user
      for (const [id, pending] of _pending) {
        if (pending.beingId === beingId) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Browser disconnected"));
          _pending.delete(id);
        }
      }
      log.info("BrowserBridge", `Browser disconnected for user ${beingId}`);
    }
  });
}

export function isConnected(beingId) {
  return _connections.has(beingId);
}

export function getCurrentUrl(beingId) {
  return _currentUrls.get(beingId) || null;
}

export function setCurrentUrl(beingId, url) {
  _currentUrls.set(beingId, url);
}

// ─────────────────────────────────────────────────────────────────────────
// REQUEST / RESPONSE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Send a request to the Chrome extension and wait for a response.
 * Returns a Promise that resolves with the response data.
 */
export function sendRequest(beingId, event, data = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const socket = _connections.get(beingId);
  if (!socket) {
    return Promise.reject(new Error("No browser connected. Install the TreeOS Chrome extension and connect it."));
  }

  const requestId = uuidv4();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(requestId);
      reject(new Error("Browser request timed out (15s). The page may be unresponsive."));
    }, timeoutMs);

    _pending.set(requestId, { resolve, reject, timer, beingId });
    socket.emit(event, { ...data, requestId });
  });
}

/**
 * Resolve a pending request when the Chrome extension responds.
 */
export function resolveRequest(requestId, data) {
  const pending = _pending.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  _pending.delete(requestId);
  pending.resolve(data);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// SITE SCOPING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if the AI can access a URL from this node position.
 * Walks ancestor metadata for browserBridge.autoApprove/alwaysAsk/blocked.
 */
export async function checkSiteAccess(nodeId, url) {
  if (!url) return { allowed: true, needsApproval: true, blocked: false, reason: "no URL" };

  let domain;
  try {
    domain = new URL(url).hostname;
  } catch {
    return { allowed: false, blocked: true, reason: "invalid URL" };
  }

  // Walk ancestor chain for site scoping config
  const config = await collectSiteConfig(nodeId);

  // Check blocked first
  if (matchesDomain(domain, config.blocked)) {
    return { allowed: false, blocked: true, reason: `${domain} is blocked at this position` };
  }

  // Check auto-approve
  if (matchesDomain(domain, config.autoApprove)) {
    return { allowed: true, needsApproval: false, blocked: false, reason: "auto-approved" };
  }

  // Check always-ask
  if (matchesDomain(domain, config.alwaysAsk)) {
    return { allowed: true, needsApproval: true, blocked: false, reason: "requires approval" };
  }

  // Default: allowed but needs approval
  return { allowed: true, needsApproval: true, blocked: false, reason: "default: requires approval" };
}

async function collectSiteConfig(nodeId) {
  const config = { autoApprove: [], alwaysAsk: [], blocked: [] };
  if (!_Node) return config;

  let current = await _Node.findById(nodeId).select("parent metadata").lean();
  let depth = 0;

  while (current && depth < 20) {
    const meta = current.metadata instanceof Map
      ? current.metadata.get("browser-bridge")
      : current.metadata?.["browser-bridge"];

    if (meta) {
      if (Array.isArray(meta.autoApprove)) config.autoApprove.push(...meta.autoApprove);
      if (Array.isArray(meta.alwaysAsk)) config.alwaysAsk.push(...meta.alwaysAsk);
      if (Array.isArray(meta.blocked)) config.blocked.push(...meta.blocked);
    }

    if (!current.parent) break;
    current = await _Node.findById(current.parent).select("parent metadata").lean();
    depth++;
  }

  return config;
}

function matchesDomain(domain, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const lower = domain.toLowerCase();
  for (const pattern of patterns) {
    const p = pattern.toLowerCase();
    if (p === lower) return true;
    if (p.startsWith("*.") && lower.endsWith(p.slice(1))) return true;
    // Match with or without www
    if (lower === "www." + p || p === "www." + lower) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// ACTIVITY LOGGING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Log a browser action as a note on the node.
 */
export async function logAction(nodeId, beingId, action, url, result) {
  try {
    const summary = `[browser] ${action.type || action}${url ? " on " + url : ""}`;
    const detail = typeof result === "string" ? result : (result?.success ? "succeeded" : "failed");
    await createArtifact({
      origin: "ibp",
      content: `${summary}: ${detail}`,
      beingId: beingId || "SYSTEM",
      nodeId,
      wasAi: true,
    });
  } catch (err) {
    log.debug("BrowserBridge", `Activity log failed: ${err.message}`);
  }
}
