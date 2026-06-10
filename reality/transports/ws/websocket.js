// WebSocket transport.
//
// One of my senses. I open a socket.io server on the same HTTP server
// the rest of the host machinery rides on, accept incoming
// connections, authenticate them against the JWT they carry (cookie
// for browsers, handshake.auth.token for CLI / programmatic), and
// track one-or-many sockets per being so async emits fan out to every
// connected client (web tab, CLI process, room agent).
//
// I do not register IBP verb handlers from here. The dispatcher in
// protocols/ibp/protocol.js attaches to this io instance via
// attachIbpHandlers. I provide the socket; the dispatcher provides
// the verbs.
//
// At boot I also register myself as the push channel — emit-to-being
// calls from inside me (async SUMMON replies, live SEE patches) reach
// the wire through proxies that delegate here. Without that
// registration the proxies no-op and a CLI-only run still boots.

import log from "../../seed/seedReality/log.js";
import { getInternalConfigValue } from "../../seed/internalConfig.js";
import { Server } from "socket.io";
import { decodeToken } from "../../seed/materials/being/identity.js";
import { getRealityConfigValue } from "../../seed/realityConfig.js";
import { setPushChannel, IBP_EVENT } from "../../seed/ibp/pushChannel.js";

// Transport-private events. Not protocol surface — socket.io
// housekeeping. The IBP wire is a single event (`IBP_EVENT = "ibp"`);
// these sit alongside it for connect-ack and navigate coordination.
const WS_REGISTERED = "registered"; // post-connect ack to clients
const WS_NAVIGATE = "navigate"; // tell a client's iframe to navigate

let io;
let _httpServerRef = null;

export function getIO() {
  return io || null;
}
export function getHttpServer() {
  return _httpServerRef;
}

// ── Per-being socket tracking ──
// Two maps: clientSessionId → socket.id (one socket per tab / CLI
// process); beingId → Set<id> (many sockets per being). authSessions
// is the fanout backbone for emitNavigate / emitToBeing /
// emitToBeingRoom.

const userSockets = new Map();
const authSessions = new Map();

function addAuthSession(beingId, socketId) {
  if (!beingId || !socketId) return;
  let set = authSessions.get(beingId);
  if (!set) {
    set = new Set();
    authSessions.set(beingId, set);
  }
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

// ── Extension socket-handler registry ──
// Extensions can hook custom socket events (preview proxy, room
// agent control, etc.). The reserved set below stays mine.

const _socketHandlers = new Map();

const RESERVED_SOCKET_EVENTS = new Set([
  "connect",
  "disconnect",
  "error",
  "connecting",
  "reconnect",
  IBP_EVENT,
  WS_REGISTERED,
  WS_NAVIGATE,
]);

export function registerSocketHandler(event, handler) {
  if (typeof event !== "string" || !event || event.length > 100) {
    log.warn("WS", "Invalid socket-handler event name rejected");
    return;
  }
  if (RESERVED_SOCKET_EVENTS.has(event)) {
    log.warn("WS", `Cannot register handler for reserved event "${event}"`);
    return;
  }
  if (typeof handler !== "function") {
    log.warn("WS", `Socket handler for "${event}" must be a function`);
    return;
  }
  if (_socketHandlers.has(event)) {
    log.warn("WS", `Socket handler "${event}" already registered, overwriting`);
  }
  _socketHandlers.set(event, handler);
}

export function unregisterSocketHandler(event) {
  _socketHandlers.delete(event);
}

// ── Server initialization ──

export function initWebSocketServer(httpServer, originPolicy) {
  _httpServerRef = httpServer;

  // Register myself as the place's push channel. Callers inside the
  // seed reach the socket layer through pushChannel.js's proxies —
  // never by importing from this file directly. That keeps the
  // dependency direction transports → seed and lets a no-WS run
  // (CLI-only, tests) no-op cleanly.
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
    if (!origin) return cb(null, true);
    if (origin.startsWith("chrome-extension://")) return cb(null, true);
    if (typeof originPolicy === "function") return originPolicy(origin, cb);
    if (Array.isArray(originPolicy) && originPolicy.includes(origin))
      return cb(null, true);
    return cb(null, false);
  };

  io = new Server(httpServer, {
    cors: { origin: originCheck, methods: ["GET", "POST"], credentials: true },
    transports: ["websocket", "polling"],
    maxHttpBufferSize:
      Number(getInternalConfigValue("socketMaxBufferSize")) || 1048576,
    pingTimeout: Number(getInternalConfigValue("socketPingTimeout")) || 30000,
    pingInterval: Number(getInternalConfigValue("socketPingInterval")) || 25000,
    connectTimeout: Number(getInternalConfigValue("socketConnectTimeout")) || 10000,
  });

  // Per-IP connection limit
  const ipCounts = new Map();
  const MAX_PER_IP = Number(getInternalConfigValue("maxConnectionsPerIp")) || 20;

  // Auth + IP-rate gate. JWT comes from the `token` cookie (browser)
  // or handshake.auth.token (CLI / programmatic); cookie wins when
  // both are present. The handshake also carries client identity
  // tags so multiple sockets from the same being coexist cleanly.
  io.use(async (socket, next) => {
    const ip = socket.handshake.address || "unknown";
    const count = (ipCounts.get(ip) || 0) + 1;
    if (count > MAX_PER_IP)
      return next(new Error("Too many connections from this IP"));
    ipCounts.set(ip, count);
    socket.on("disconnect", () => {
      const c = ipCounts.get(ip) || 1;
      if (c <= 1) ipCounts.delete(ip);
      else ipCounts.set(ip, c - 1);
    });

    socket.beingId = null;
    const cookieToken =
      socket.request.headers.cookie?.match(/token=([^;]+)/)?.[1];
    const handshakeToken = socket.handshake.auth?.token;
    const token = cookieToken || handshakeToken;
    if (token) {
      const decoded = decodeToken(token);
      if (decoded) {
        socket.beingId = decoded.beingId;
        socket.name = decoded.name;
        socket.jwt = token;
      } else {
        log.debug("WS", `Invalid token from ${ip}`);
      }
    }
    // Anonymous binding (seed/RolesAreAuth.md "Anonymous arrival floor").
    // Connections without a valid token bind to the @arrival seed
    // delegate's identity. Arrival's role.canSee = ["arrival-view"]
    // gates raw SEE; canBe = ["birth","connect","release"] permits the
    // registration flow on @cherub. Verbs need identity to dispatch;
    // routing through arrival's beingId means the role-walk authorize
    // fires the same way for anon as for authenticated callers — same
    // gate, same shape.
    if (!socket.beingId) {
      try {
        const { findByName } = await import(
          "../../seed/materials/projections.js"
        );
        const arrivalSlot = await findByName("being", "arrival", "0");
        if (arrivalSlot?.id) {
          socket.beingId = String(arrivalSlot.id);
          socket.name    = "arrival";
        }
      } catch { /* arrival not yet materialized; verbs will refuse */ }
    }

    // First-person stance tracking. The wire layer reads these to know
    // which branch + position the caller is in (the left side of every
    // IBP bridge). SEE handlers update currentPath after each
    // successful live read; currentBranch is BE's alone — handlers
    // return seatBranch and handleBe seats it after the moment seals
    // (birth/connect/release/switch). Token-bound reconnects seat the
    // being's homeBranch right here, so a being born on #7a lands back
    // on #7a without re-running BE:connect. Anonymous sockets ride the
    // operator's default branch (the pointer registry — never literal
    // "0"; set-pointer can re-point main).
    socket.currentPath = "/";
    try {
      if (socket.jwt && socket.beingId) {
        const { findHomeBranchOfBeing } = await import(
          "../../seed/materials/being/identity/lookups.js"
        );
        socket.currentBranch = await findHomeBranchOfBeing(socket.beingId);
      } else {
        const { getDefaultBranch } = await import(
          "../../seed/materials/branch/branchRegistry.js"
        );
        socket.currentBranch = await getDefaultBranch();
      }
    } catch {
      // Registry not readable this early only on a half-bootstrapped
      // reality; main is the honest floor there.
      socket.currentBranch = "0";
    }

    // Client identity tags. Names like `socket.client` / `socket.conn`
    // are taken by Socket.IO internal getters — overwriting them
    // crashes the connection setup with cryptic errors. Use the
    // namespaced names below.
    const auth = socket.handshake.auth || {};
    socket.clientKind =
      typeof auth.client === "string" && /^[a-z0-9_-]{1,32}$/i.test(auth.client)
        ? auth.client
        : "web";
    socket.clientInstance =
      typeof auth.instance === "string" &&
      /^[a-z0-9_-]{1,40}$/i.test(auth.instance)
        ? auth.instance
        : socket.id.slice(0, 8);

    next();
  });

  io.on("connection", (socket) => {
    const beingId = socket.beingId;
    log.debug("WS", `connected: ${socket.id} (being: ${beingId || "anon"})`);

    if (beingId) addAuthSession(beingId, socket.id);

    // Auto-bind authenticated sockets. The stable
    // `${beingId}:${clientKind}:${clientInstance}` key gives each tab
    // / CLI process its own slot so reconnects don't kick siblings.
    // Joining the being-room enables async SUMMON-reply fanout.
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
          await handler({
            socket,
            beingId: socket.beingId,
            clientSessionId: socket.clientSessionId,
            data,
          });
        } catch (err) {
          log.error("WS", `Socket handler "${event}" error:`, err.message);
        }
      });
    }

    socket.on("disconnect", (reason) => {
      log.debug("WS", `disconnected: ${socket.id} (${reason})`);
      if (beingId) removeAuthSession(beingId, socket.id);
      if (
        socket.clientSessionId &&
        userSockets.get(socket.clientSessionId) === socket.id
      ) {
        userSockets.delete(socket.clientSessionId);
      }
    });
  });

  log.info("WS", "WebSocket server initialized");
  return io;
}

// ── Public emits — used by extensions and by the seed through the
// push channel proxies ──

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
 * Direct emit to every socket the being has connected. Extensions
 * reach this through the loader's scoped `reality.websocket.emitToBeing`
 * (which auto-namespaces the event name to the extension's prefix).
 */
export function emitToBeing(beingId, event, data) {
  if (!io) return;
  for (const id of getAuthSocketIds(beingId)) {
    io.to(id).emit(event, data);
  }
}

/**
 * Broadcast to the being-room — every socket that has joined the
 * `being:<id>` room receives the event. Used for SUMMON replies and
 * other being-scoped fanouts where socket.io's room semantics
 * (joined on register, automatic disconnect cleanup) are the right
 * shape.
 */
export function emitToBeingRoom(beingId, event, data) {
  if (!io || !beingId) return;
  io.to(`being:${String(beingId)}`).emit(event, data);
}
