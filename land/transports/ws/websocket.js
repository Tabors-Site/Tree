// WebSocket transport.
//
// Sets up the socket.io server, authenticates incoming connections (JWT
// via cookie or handshake.auth.token), tracks one or many sockets per
// being, and joins the being-room so async emits fan out to every
// connected client (web tab, CLI, room agent, …).
//
// The IBP verb dispatcher is wired on top of the io instance by
// `attachIbpHandlers` in protocols/ibp/protocol.js — this file does NOT
// register any verb handlers. Legacy chat / urlChanged / navigator /
// stopSession handlers retired 2026-05-19 along with the orchestrator
// era ([[project_tree_orchestrator_deleted]]).

import log from "../../seed/system/log.js";
import { Server } from "socket.io";
import { decodeToken } from "../../seed/land/being/identity.js";
import { hooks as _hooks } from "../../seed/system/hooks.js";  // reserved for future
import { getLandConfigValue } from "../../seed/landConfig.js";
import { setPushChannel, IBP_EVENT } from "../../seed/ibp/pushChannel.js";

// Transport-private socket events. These are NOT protocol surface —
// they're socket.io handshake / UI-side coordination that lives at the
// transport layer. The kernel doesn't know about them. The IBP wire
// surface is a single event (`IBP_EVENT = "ibp"`); these sit alongside it
// for socket.io housekeeping only.
const WS_REGISTERED = "registered"; // post-connect ack to clients
const WS_NAVIGATE   = "navigate";   // tell a client's iframe to navigate

let io;
let _httpServerRef = null;

export function getIO()         { return io || null; }
export function getHttpServer() { return _httpServerRef; }

// ────────────────────────────────────────────────────────────────────
// Per-being socket tracking
// ────────────────────────────────────────────────────────────────────
//
// clientSessionId → socket.id   (one socket per tab / CLI process)
// beingId         → Set<id>     (many sockets per being)
//
// authSessions is the fanout backbone for emitNavigate / emitToBeing.

const userSockets  = new Map();
const authSessions = new Map();

function addAuthSession(beingId, socketId) {
  if (!beingId || !socketId) return;
  let set = authSessions.get(beingId);
  if (!set) { set = new Set(); authSessions.set(beingId, set); }
  set.add(socketId);
}
function removeAuthSession(beingId, socketId) {
  const set = authSessions.get(beingId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) authSessions.delete(beingId);
}
function getAuthSocketIds(beingId) {
  const set = authSessions.get(beingId);
  return set ? [...set] : [];
}

// ────────────────────────────────────────────────────────────────────
// Extension socket-handler registry
// ────────────────────────────────────────────────────────────────────
//
// Extensions can hook custom socket events (e.g. preview proxy, room
// agent control). Reserved IBP / lifecycle events are protected.

const _socketHandlers = new Map();

const RESERVED_SOCKET_EVENTS = new Set([
  "connect", "disconnect", "error", "connecting", "reconnect",
  IBP_EVENT, WS_REGISTERED, WS_NAVIGATE,
]);

export function registerSocketHandler(event, handler) {
  if (typeof event !== "string" || !event || event.length > 100) {
    log.warn("WS", "Invalid socket-handler event name rejected"); return;
  }
  if (RESERVED_SOCKET_EVENTS.has(event)) {
    log.warn("WS", `Cannot register handler for reserved event "${event}"`); return;
  }
  if (typeof handler !== "function") {
    log.warn("WS", `Socket handler for "${event}" must be a function`); return;
  }
  if (_socketHandlers.has(event)) {
    log.warn("WS", `Socket handler "${event}" already registered, overwriting`);
  }
  _socketHandlers.set(event, handler);
}

export function unregisterSocketHandler(event) {
  _socketHandlers.delete(event);
}

// ────────────────────────────────────────────────────────────────────
// Server initialization
// ────────────────────────────────────────────────────────────────────

export function initWebSocketServer(httpServer, originPolicy) {
  _httpServerRef = httpServer;

  // Register this transport as the land's push channel. Seed callers
  // (services bundle, IBP verbs, async SUMMON reply path) reach the
  // socket layer through seed/ibp/pushChannel.js rather than importing
  // from this file — that keeps the dependency direction
  // transports → seed and lets a no-WS run (CLI-only, tests) no-op
  // cleanly.
  setPushChannel({
    emitToBeing,
    emitToBeingRoom,
    emitNavigate,
    getIO,
    getHttpServer,
    registerSocketHandler,
    unregisterSocketHandler,
  });

  // originPolicy: function `(origin, cb) => cb(null, ok)` OR array of
  // allowed origin strings. Chrome extensions and no-origin (CLI /
  // same-origin) are always allowed.
  const originCheck = (origin, cb) => {
    if (!origin)                                 return cb(null, true);
    if (origin.startsWith("chrome-extension://")) return cb(null, true);
    if (typeof originPolicy === "function")      return originPolicy(origin, cb);
    if (Array.isArray(originPolicy) && originPolicy.includes(origin)) return cb(null, true);
    return cb(null, false);
  };

  io = new Server(httpServer, {
    cors: { origin: originCheck, methods: ["GET", "POST"], credentials: true },
    transports:        ["websocket", "polling"],
    maxHttpBufferSize: Number(getLandConfigValue("socketMaxBufferSize")) || 1048576,
    pingTimeout:       Number(getLandConfigValue("socketPingTimeout"))   || 30000,
    pingInterval:      Number(getLandConfigValue("socketPingInterval"))  || 25000,
    connectTimeout:    Number(getLandConfigValue("socketConnectTimeout"))|| 10000,
  });

  // Per-IP connection limit
  const ipCounts = new Map();
  const MAX_PER_IP = Number(getLandConfigValue("maxConnectionsPerIp")) || 20;

  // Auth middleware. JWT comes from the `token` cookie (browser) or
  // handshake.auth.token (CLI / programmatic). Cookie wins when both
  // are present. The handshake also carries client identity tags so
  // multiple sockets from the same being coexist cleanly.
  io.use((socket, next) => {
    const ip = socket.handshake.address || "unknown";
    const count = (ipCounts.get(ip) || 0) + 1;
    if (count > MAX_PER_IP) return next(new Error("Too many connections from this IP"));
    ipCounts.set(ip, count);
    socket.on("disconnect", () => {
      const c = ipCounts.get(ip) || 1;
      if (c <= 1) ipCounts.delete(ip); else ipCounts.set(ip, c - 1);
    });

    // JWT comes from the browser cookie or the handshake auth token
    // (CLI / programmatic). Cookie wins when both are present.
    socket.beingId = null;
    const cookieToken = socket.request.headers.cookie?.match(/token=([^;]+)/)?.[1];
    const handshakeToken = socket.handshake.auth?.token;
    const token = cookieToken || handshakeToken;
    if (token) {
      const decoded = decodeToken(token);
      if (decoded) {
        socket.beingId = decoded.beingId;
        socket.name    = decoded.name;
        socket.jwt     = token;
      } else {
        log.debug("WS", `Invalid token from ${ip}`);
      }
    }

    // CAREFUL: do NOT name these `socket.client` or `socket.conn` —
    // those are Socket.IO's internal getters; overwriting them crashes
    // the connection setup with cryptic errors.
    const auth = socket.handshake.auth || {};
    socket.clientKind = (typeof auth.client === "string" && /^[a-z0-9_-]{1,32}$/i.test(auth.client))
      ? auth.client : "web";
    socket.clientInstance = (typeof auth.instance === "string" && /^[a-z0-9_-]{1,40}$/i.test(auth.instance))
      ? auth.instance : socket.id.slice(0, 8);

    next();
  });

  io.on("connection", (socket) => {
    const beingId = socket.beingId;
    log.debug("WS", `connected: ${socket.id} (being: ${beingId || "anon"})`);

    if (beingId) addAuthSession(beingId, socket.id);

    // Auto-bind authenticated sockets: derive a stable
    // `${beingId}:${clientKind}:${clientInstance}` key so reconnects
    // and parallel tabs each get their own slot without kicking each
    // other. Join the being-room for async ibp:update fanout.
    if (beingId && socket.name) {
      const clientSessionId = `${beingId}:${socket.clientKind}:${socket.clientInstance}`;
      const oldId = userSockets.get(clientSessionId);
      if (oldId && oldId !== socket.id) {
        io.sockets.sockets.get(oldId)?.disconnect(true);
      }
      userSockets.set(clientSessionId, socket.id);
      socket.clientSessionId = clientSessionId;
      socket.join(`being:${String(beingId)}`);
      socket.emit(WS_REGISTERED, { success: true, clientSessionId });
    } else {
      // Anonymous arrival socket. Clients can register / claim via
      // `ibp:be` and then reconnect with the new cookie to bind.
      socket.emit(WS_REGISTERED, { success: false, error: "Unauthorized" });
    }

    // Extension-registered socket handlers
    for (const [event, handler] of _socketHandlers) {
      socket.on(event, async (data) => {
        try {
          await handler({ socket, beingId: socket.beingId, clientSessionId: socket.clientSessionId, data });
        } catch (err) {
          log.error("WS", `Socket handler "${event}" error:`, err.message);
        }
      });
    }

    socket.on("disconnect", (reason) => {
      log.debug("WS", `disconnected: ${socket.id} (${reason})`);
      if (beingId) removeAuthSession(beingId, socket.id);
      if (socket.clientSessionId && userSockets.get(socket.clientSessionId) === socket.id) {
        userSockets.delete(socket.clientSessionId);
      }
    });
  });

  log.info("WS", "WebSocket server initialized");
  return io;
}

// ────────────────────────────────────────────────────────────────────
// Public emits — used by extensions and the kernel services bundle
// ────────────────────────────────────────────────────────────────────

/**
 * Tell every connected socket for `beingId` to navigate to `url`.
 * Each client decides whether to follow (the browser does; the CLI
 * ignores). Used by extensions that route a being into a workspace.
 */
export function emitNavigate({ beingId, url, replace = false }) {
  if (!io) return;
  const socketIds = getAuthSocketIds(beingId);
  if (socketIds.length === 0) return;
  for (const id of socketIds) {
    io.to(id).emit(WS_NAVIGATE, { url, replace });
  }
}

/**
 * Direct emit to every socket the being has connected. The kernel
 * services bundle exposes this as `core.ws.emitToBeing` so extensions
 * (e.g. governing) can push being-scoped events.
 */
export function emitToBeing(beingId, event, data) {
  if (!io) return;
  for (const id of getAuthSocketIds(beingId)) {
    io.to(id).emit(event, data);
  }
}

/**
 * Broadcast to the being-room — every socket that has joined the
 * `being:<id>` room receives the event. Use for SUMMON replies and
 * other being-scoped fanouts where socket.io's room semantics are
 * the canonical fanout (joined on register, automatic disconnect
 * cleanup).
 */
export function emitToBeingRoom(beingId, event, data) {
  if (!io || !beingId) return;
  io.to(`being:${String(beingId)}`).emit(event, data);
}
