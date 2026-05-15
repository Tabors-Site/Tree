// Portal Protocol — WebSocket message handlers.
//
// Registers Socket.IO event handlers on each authenticated connection for
// the portal:* ops. Pass 1 Slice 1 implements portal:fetch and
// portal:discover. Other ops (resolve, speak, cancel, subscribe) are
// scaffolded for future slices.
//
// Coexists with the legacy `op:"chat"` handlers in seed/ws/websocket.js —
// zero shared event names, zero shared constants.

import log from "../seed/log.js";
import { parseFromSocket, expand, format, getLandDomain } from "./address.js";
import { resolveStance } from "./resolver.js";
import { buildDescriptor } from "./descriptor.js";
import { buildDiscovery } from "./discovery.js";
import { PortalError, PORTAL_ERR, isPortalError } from "./errors.js";

/**
 * Register portal:* handlers on a freshly connected socket.
 *
 * Called from initPortalWs(io) below, once per connection. The socket has
 * already been authenticated by the WS auth middleware; socket.userId and
 * socket.username are populated (or null for unauthenticated connections).
 */
function registerSocketHandlers(socket) {
  socket.on("portal:fetch", (msg, ack) => handlePortalFetch(socket, msg, ack));
  socket.on("portal:discover", (_msg, ack) => handlePortalDiscover(socket, ack));
  socket.on("portal:resolve", (msg, ack) => handlePortalResolve(socket, msg, ack));

  // Stubs for future ops — respond with PA_UNSUPPORTED so clients get a
  // clear "not yet" signal instead of a silent timeout.
  socket.on("portal:speak", (msg) => emitUnsupportedEvent(socket, msg, "portal:speak"));
  socket.on("portal:cancel", (msg, ack) => ackUnsupported(ack, msg, "portal:cancel"));
  socket.on("portal:subscribe", (msg, ack) => ackUnsupported(ack, msg, "portal:subscribe"));
  socket.on("portal:unsubscribe", (msg, ack) => ackUnsupported(ack, msg, "portal:unsubscribe"));
}

// ─────────────────────────────────────────────────────────────────────
// portal:fetch — given a PA, return its Position Descriptor
// ─────────────────────────────────────────────────────────────────────

async function handlePortalFetch(socket, msg, ack) {
  const id = msg?.id;
  try {
    if (!socket.userId) {
      throw new PortalError(PORTAL_ERR.PA_UNAUTHORIZED, "Socket not authenticated");
    }
    if (!msg || typeof msg.address !== "string") {
      throw new PortalError(PORTAL_ERR.PA_PARSE, "portal:fetch requires { id, address }");
    }

    const parsed = parseFromSocket(socket, msg.address, msg.ctx || {});
    // For fetch, we only resolve the RIGHT stance (the addressed position).
    // The left stance, if present, is informational (who's asking) — Pass 1
    // doesn't act on it for fetches.
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });

    const resolved = await resolveStance(expanded.right);
    const descriptor = await buildDescriptor(resolved, {
      identity: { userId: socket.userId, username: socket.username },
    });

    if (typeof ack === "function") ack({ ok: true, id, descriptor });
  } catch (err) {
    if (isPortalError(err)) {
      if (typeof ack === "function") {
        ack({ ok: false, id, error: { code: err.code, message: err.message, detail: err.detail } });
      }
      return;
    }
    log.error("Portal", `portal:fetch failed: ${err.message}`);
    if (typeof ack === "function") {
      ack({
        ok: false,
        id,
        error: { code: PORTAL_ERR.PA_INTERNAL, message: err.message || "Internal portal error" },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// portal:resolve — canonicalize a PA + return its chain (no descriptor)
// ─────────────────────────────────────────────────────────────────────
//
// Lighter than portal:fetch — used by the address bar to autocomplete /
// canonicalize what the user typed. Returns:
//   - canonical: fully-qualified PA string
//   - left/right: parsed Stance shapes
//   - rightResolved: { zone, chain, leafName, leafId } — only the right side
//     is resolved server-side; left is just parsed.
// No notes, children, artifacts, governance — those come from portal:fetch.

async function handlePortalResolve(socket, msg, ack) {
  const id = msg?.id;
  try {
    if (!socket.userId) {
      throw new PortalError(PORTAL_ERR.PA_UNAUTHORIZED, "Socket not authenticated");
    }
    if (!msg || typeof msg.address !== "string") {
      throw new PortalError(PORTAL_ERR.PA_PARSE, "portal:resolve requires { id, address }");
    }

    const parsed = parseFromSocket(socket, msg.address, msg.ctx || {});
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });
    const resolved = await resolveStance(expanded.right);

    if (typeof ack === "function") {
      ack({
        ok: true,
        id,
        canonical: format(expanded),
        left: expanded.left,
        right: expanded.right,
        rightResolved: {
          zone: resolved.zone,
          chain: resolved.chain,
          leafName: resolved.leafName,
          leafId: resolved.leafId,
          rootId: resolved.rootId,
          nodeId: resolved.nodeId,
          userId: resolved.userId || null,
          embodiment: resolved.embodiment || null,
        },
      });
    }
  } catch (err) {
    if (isPortalError(err)) {
      if (typeof ack === "function") {
        ack({ ok: false, id, error: { code: err.code, message: err.message, detail: err.detail } });
      }
      return;
    }
    log.error("Portal", `portal:resolve failed: ${err.message}`);
    if (typeof ack === "function") {
      ack({
        ok: false,
        id,
        error: { code: PORTAL_ERR.PA_INTERNAL, message: err.message || "Internal portal error" },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// portal:discover — return capabilities object
// ─────────────────────────────────────────────────────────────────────

function handlePortalDiscover(_socket, ack) {
  if (typeof ack === "function") ack({ ok: true, discovery: buildDiscovery() });
}

// ─────────────────────────────────────────────────────────────────────
// Unsupported op responses
// ─────────────────────────────────────────────────────────────────────

function ackUnsupported(ack, msg, op) {
  if (typeof ack !== "function") return;
  ack({
    ok: false,
    id: msg?.id || null,
    error: { code: PORTAL_ERR.PA_UNSUPPORTED, message: `${op} not implemented yet` },
  });
}

function emitUnsupportedEvent(socket, msg, op) {
  socket.emit("portal:event", {
    id: msg?.id || null,
    kind: "error",
    data: { code: PORTAL_ERR.PA_UNSUPPORTED, message: `${op} not implemented yet` },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Wire registration
// ─────────────────────────────────────────────────────────────────────

/**
 * Hook portal handlers onto every new socket connection.
 * Called by initPortalWs in index.js.
 */
export function attachPortalHandlers(io) {
  io.on("connection", (socket) => {
    registerSocketHandlers(socket);
  });
  log.info("Portal", "Portal Protocol handlers attached to WebSocket server");
}
