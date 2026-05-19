// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/websocket.js
// WebSocket server - handles socket events, delegates to conversation manager

import log from "../../seed/core/log.js";
import { WS, ERR } from "../../seed/core/protocol.js";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { getClientForBeing, beingHasLlm } from "../../seed/llm/llmClient.js";
import { hooks } from "../../seed/core/hooks.js";
import { mcpClients } from "./mcp.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import Node from "../../seed/models/node.js";
import { resolveTreeAccess } from "../../seed/tree/treeAccess.js";
import { enqueue } from "./requestQueue.js";
import {
  setRootId,
  getRootId,
  setCurrentNodeId,
  getCurrentNodeId,
} from "../../seed/being/position.js";

// URL → node-id extractor. Zones retired 2026-05-18 ([[zones-retired]]) —
// every URL is just a different view of the same nodes. `/root/<id>` and
// `/node/<id>` both name a node directly; `/user/<username>` and
// `/land/...` URLs don't name a node id at this layer (the user-being's
// home node and the land root are derived elsewhere on demand).
const _UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const _OBJECTID = "[a-f0-9]{24}";
const _NODE_URL_RE = new RegExp(`^(?:/api/v1)?/(?:root|node)/(${_UUID}|${_OBJECTID})`, "i");
function nodeIdFromUrl(url) {
  if (typeof url !== "string" || !url) return null;
  const path = url.split("?")[0];
  const m = path.match(_NODE_URL_RE);
  return m?.[1] || null;
}
import {
  ensureSession,
  rotateSession,
  setActiveSummon,
  clearActiveSummon,
  finalizeOpenSummon,
} from "../../seed/llm/summonTracker.js";
import {
  registerSession,
  endSession,
  canNavigate,
  touchSession,
  getActiveNavigator,
  setActiveNavigator,
  clearActiveNavigator,
  getSession,
  getSessionsForBeing,
  updateSessionMeta,
  SESSION_TYPES,
  registerSessionType,
  registeredSessionCount,
} from "./sessionRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

let io;

/**
 * Get the socket.io server instance.
 * Extensions use this to create separate namespaces (e.g. browser-bridge).
 * Returns null if WebSocket server hasn't been initialized yet.
 */
export function getIO() { return io || null; }

// Hold a direct reference to the http.Server instance so extensions can
// attach their own `upgrade` listeners (e.g. preview proxies that need
// to tunnel WebSocket connections to spawned child processes). Socket.IO
// stores it internally via io.httpServer but exposing it through a
// named helper is cleaner — the extension doesn't need to know about
// Socket.IO internals.
let _httpServerRef = null;
export function getHttpServer() { return _httpServerRef; }

// Socket tracking
const userSockets = new Map(); // clientSessionId → socket.id (1:1; each clientSessionId is unique per connection)
const authSessions = new Map(); // beingId → Set<socket.id> (N:1; a user can hold many concurrent sockets)

// Helpers for the N:1 authSessions map. Every emit-to-user function
// uses these so a single user's events fan out to all their clients
// (web tab, CLI shell, room agent, etc.) without the server having
// to disconnect any of them.
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

// ── Socket handler registry (extensions register event handlers) ──────
const _socketHandlers = new Map();

const RESERVED_SOCKET_EVENTS = new Set(["connect", "disconnect", "error", "connecting", "reconnect", "chat", "navigate"]);

export function registerSocketHandler(event, handler) {
  if (typeof event !== "string" || event.length === 0 || event.length > 100) {
    log.warn("WS", `Invalid socket handler event name rejected`);
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

// ── Session registry sync helper ────────────────────────────────────────
function syncRegistrySession(socket) {
  const sessionId = socket._aiSession?.id;
  if (!sessionId || !socket.beingId) return;
  if (socket._registrySessionId === sessionId) return; // no change
  if (socket._registrySessionId) endSession(socket._registrySessionId);
  registerSession({
    sessionId,
    beingId: socket.beingId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    description: `Chat session for ${socket.name || "unknown"}`,
    meta: { clientSessionId: socket.clientSessionId },
  });
  socket._registrySessionId = sessionId;
  emitNavigatorStatus(socket);
}

function emitNavigatorStatus(socket) {
  if (!socket.beingId) return;
  const navId = getActiveNavigator(socket.beingId);
  if (navId) {
    const session = getSession(navId);
    socket.emit(WS.NAVIGATOR_SESSION, {
      sessionId: navId,
      type: session?.type || null,
      description: session?.description || null,
    });
  } else {
    socket.emit(WS.NAVIGATOR_SESSION, null);
  }
}


// ============================================================================
// CHAT-HANDLER HELPERS
//
// These factor the websocket "chat" event handler into pure-ish steps with
// clear ownership. The handler runs as: validate → resolve session →
// enforce limits → route to stream extension → enqueue (begin turn →
// orchestrate → end turn). Each helper does one thing; behavior matches
// the pre-refactor inline code.
// ============================================================================

// Reject chat payloads that don't carry the minimum required fields.
// Returns null on success or a string error to emit back to the client.
function validateChatPayload(args) {
  if (!args || typeof args !== "object") return "Missing or invalid message";
  const { message } = args;
  const name = args.name ?? args.username; // legacy alias
  if (!message || typeof message !== "string") return "Missing or invalid message";
  if (!name || typeof name !== "string" || name.length > 200) {
    return "Missing or invalid message";
  }
  return null;
}

// Apply position state writes (setRootId/setCurrentNodeId) from the
// chat payload. Tree access is verified before any state is written
// when a rootId is supplied. Errors are logged at warn level but
// never thrown — chat falls through with whatever state was applied.
// Role/behavior binding happens at SUMMON time, not here.
async function applyChatPositionFromPayload(clientSessionId, socket, payload, _username) {
  const { rootId, nodeId } = payload;

  if (typeof rootId === "string" && rootId.length > 0 && rootId.length <= 36) {
    let access = null;
    try {
      access = await resolveTreeAccess(rootId, socket.beingId);
    } catch (err) {
      log.warn("WS", `resolveTreeAccess errored: ${err.message}`);
      return;
    }
    if (!access?.ok) {
      log.warn("WS", `tree access denied for root ${rootId}: ok=${access?.ok}`);
      return;
    }
    setRootId(socket.beingId, rootId);
    const resolvedNode = (typeof nodeId === "string" && nodeId.length > 0 && nodeId.length <= 36)
      ? nodeId
      : rootId;
    setCurrentNodeId(socket.beingId, resolvedNode);
    return;
  }

  if (typeof nodeId === "string" && nodeId.length > 0 && nodeId.length <= 36) {
    setCurrentNodeId(socket.beingId, nodeId);
  }
}

// Emit a chat error matching the seed's HTTP error contract. Carries
// a semantic ERR code (so consumers can branch / telemetry can group)
// alongside the human-readable message that legacy listeners read as
// `error`. Field order:
//   code       — ERR.* semantic identifier (e.g. "RATE_LIMITED")
//   error      — human-readable message (legacy field; existing
//                consumers in chat.js, app.js, cli/ws.js destructure
//                this and keep working unchanged)
//   detail     — optional structured payload (caps, retry hints, etc.)
//   generation — echoed from the client for response correlation
function emitChatError(socket, code, message, generation, detail) {
  const payload = { code, error: message, generation };
  if (detail !== undefined) payload.detail = detail;
  // Broadcast chat errors to every socket the being has connected so
  // all of their open windows see the failure (Tabor's CLI sees a chat
  // error from his web tab and vice versa). Fall back to per-socket
  // emit for anonymous or pre-register sockets.
  if (socket?.beingId && io) {
    try { io.to(`being:${String(socket.beingId)}`).emit(WS.CHAT_ERROR, payload); return; } catch {}
  }
  socket.emit(WS.CHAT_ERROR, payload);
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

export function initWebSocketServer(httpServer, originPolicy) {
  // Register transport-layer session types before any connections arrive
  registerSessionType("WEBSOCKET_CHAT", "websocket-chat");

  _httpServerRef = httpServer;

  // originPolicy can be either:
  //   - a function (origin, cb) => cb(null, ok)  — caller controls the check
  //   - an array of allowed origin strings       — legacy callers
  // Both are normalized here. Chrome extensions and no-origin (CLI / same-
  // origin) are always allowed for parity with the rest of the system.
  const originCheck = (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origin.startsWith("chrome-extension://")) return cb(null, true);
    if (typeof originPolicy === "function") {
      return originPolicy(origin, cb);
    }
    if (Array.isArray(originPolicy) && originPolicy.includes(origin)) {
      return cb(null, true);
    }
    cb(null, false);
  };

  io = new Server(httpServer, {
    cors: {
      origin: originCheck,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: Number(getLandConfigValue("socketMaxBufferSize")) || 1048576,
    pingTimeout:       Number(getLandConfigValue("socketPingTimeout"))   || 30000,
    pingInterval:      Number(getLandConfigValue("socketPingInterval"))  || 25000,
    connectTimeout:    Number(getLandConfigValue("socketConnectTimeout"))|| 10000,
  });

  // Per-IP connection limit
  const ipConnectionCounts = new Map();
  const MAX_CONNECTIONS_PER_IP = Number(getLandConfigValue("maxConnectionsPerIp")) || 20;

  // Auth middleware
  io.use((socket, next) => {
    const ip = socket.handshake.address || "unknown";
    const count = (ipConnectionCounts.get(ip) || 0) + 1;
    if (count > MAX_CONNECTIONS_PER_IP) {
      return next(new Error("Too many connections from this IP"));
    }
    ipConnectionCounts.set(ip, count);
    socket.on("disconnect", () => {
      const c = ipConnectionCounts.get(ip) || 1;
      if (c <= 1) ipConnectionCounts.delete(ip);
      else ipConnectionCounts.set(ip, c - 1);
    });
    const cookie = socket.request.headers.cookie;
    socket.beingId = null;

    // 1. Browser path: JWT in the `token` cookie. This is how the website
    //    has always authenticated its socket.
    if (cookie) {
      const tokenMatch = cookie.match(/token=([^;]+)/);
      if (tokenMatch) {
        try {
          const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
          socket.beingId = decoded.beingId;
          socket.name = decoded.name;
          socket.jwt = tokenMatch[1];
        } catch (tokenErr) {
          log.debug("WS", `Invalid token from ${ip}: ${tokenErr.message}`);
        }
      }
    }

    // 2. CLI / programmatic path: socket.io `handshake.auth.token`
    //    carries a JWT. Cookie auth still wins when both are present
    //    (the browser session is the source of truth). API keys are
    //    not accepted here — clients without a JWT should exchange
    //    their API key via /auth/exchange first.
    if (!socket.beingId) {
      const auth = socket.handshake.auth || {};
      if (auth.token) {
        try {
          const decoded = jwt.verify(auth.token, JWT_SECRET);
          socket.beingId = decoded.beingId;
          socket.name = decoded.name;
          socket.jwt = auth.token;
        } catch (tokenErr) {
          log.debug("WS", `Invalid handshake.auth token from ${ip}: ${tokenErr.message}`);
        }
      }
    }

    // Client identity tags. `clientKind` names the source (web, cli,
    // room-agent, mobile, …); `clientInstance` names the specific
    // copy (a browser tab uuid, a CLI process pid, a room
    // subscription id). Together with beingId they uniquely identify
    // this connection, so two sockets from the same user coexist
    // without kicking each other. Fall back to web/socket.id so
    // unpatched clients still work.
    //
    // CAREFUL: do NOT name these `socket.client` or `socket.conn` —
    // those are Socket.IO's internal getters (client = Engine.IO
    // client, conn = this.client.conn). Overwriting `socket.client`
    // breaks the internal getter and crashes _onconnect with
    // "Cannot read properties of undefined (reading 'protocol')".
    const auth = socket.handshake.auth || {};
    socket.clientKind = (typeof auth.client === "string" && /^[a-z0-9_-]{1,32}$/i.test(auth.client)) ? auth.client : "web";
    socket.clientInstance = (typeof auth.instance === "string" && /^[a-z0-9_-]{1,40}$/i.test(auth.instance)) ? auth.instance : socket.id.slice(0, 8);

    next();
  });

  io.on("connection", (socket) => {
    const beingId = socket.beingId;
    log.debug("WS",
      `🔗 Socket connected: ${socket.id} (user: ${beingId || "anon"})`,
    );

    // Track auth session. Multiple sockets per user are supported:
    // CLI + browser + mobile all coexist under the same beingId.
    if (beingId) {
      addAuthSession(beingId, socket.id);
    }

    // ── Auto-bind authenticated sockets ──
    // The handshake middleware already verified the JWT (cookie or
    // handshake.auth.token). If identity resolved, do the post-auth
    // binding immediately and emit `registered` so clients can start
    // sending verbs without a manual `register` round-trip.
    //
    // Per-connection transport key. `${beingId}:${clientKind}:${clientInstance}`
    // uniquely identifies this socket within the being so separate tabs /
    // CLI shells / room-agent dispatches each get their own isolated
    // session, MCP connection, and chat memory. Survives socket reconnect
    // because `clientInstance` is client-stable across refresh, where
    // `socket.id` rotates.
    if (beingId && socket.name) {
      const clientSessionId = `${beingId}:${socket.clientKind || "web"}:${socket.clientInstance || socket.id.slice(0, 8)}`;

      // Dedupe: a fresh socket from the same tab/CLI pid kicks the prior one.
      const oldSocketId = userSockets.get(clientSessionId);
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }
      userSockets.set(clientSessionId, socket.id);
      socket.clientSessionId = clientSessionId;

      // Join the being-room so async events (SUMMON replies via
      // `ibp:update`, in-flight tool progress, descriptor patches)
      // reach every socket the being has connected. Single-context
      // being model: web + CLI share the same room and see the same
      // conversation state. Per-socket emits stay direct.
      socket.join(`being:${String(beingId)}`);

      ensureSession(socket);
      syncRegistrySession(socket);

      // MCP connection happens lazily inside runChat under the
      // canonical conversation key (IBP Address for being-to-being,
      // pipeline key for stanceless). Pre-connecting under
      // clientSessionId would orphan that client the moment the first
      // runChat opens a new one under ibpAddress.
      socket.emit(WS.REGISTERED, { success: true, clientSessionId });
      logStats();
    } else {
      // Unauthenticated arrival socket. The client can claim an
      // identity via `ibp:be {op:"claim"}` or `{op:"register"}` and
      // then reconnect with the new cookie/token to bind.
      socket.emit(WS.REGISTERED, { success: false, error: "Unauthorized" });
    }

    socket.on("ready", () => {
      log.verbose("WS", `App ready: ${beingId}`);
    });

    /**
     * URL-based position update from frontend. Sent when the iframe URL
     * changes; the URL resolves to a node id that becomes the being's
     * currentPositionId. Role is bound at SUMMON time via the envelope's
     * activeRole — the client doesn't request role switches here.
     * Payload: { url: "/root/abc123", rootId?: "abc123", nodeId?: "..." }
     */
    socket.on("urlChanged", async ({ url, rootId, nodeId } = {}) => {
      if (!socket.clientSessionId) return;
      if (typeof url === "string" && url.length > 2000) url = url.slice(0, 2000);
      if (rootId && (typeof rootId !== "string" || rootId.length > 36)) rootId = null;
      if (nodeId && (typeof nodeId !== "string" || nodeId.length > 36)) nodeId = null;

      // URL + payload resolve to a node id. The being's
      // currentPositionId is the single source of truth for "where am I."
      const urlNodeId = nodeIdFromUrl(url);
      let targetNodeId = nodeId || rootId || urlNodeId || null;

      // Tree-access check on the destination node (don't let a crafted
      // message point the being at another's tree).
      if (targetNodeId && socket.beingId) {
        try {
          const access = await resolveTreeAccess(targetNodeId, socket.beingId);
          if (!access.ok || !access.canWrite) {
            log.warn("WS", `Access denied: ${socket.beingId} → ${targetNodeId}`);
            targetNodeId = null;
            rootId = null;
            nodeId = null;
          }
        } catch {
          targetNodeId = null;
          rootId = null;
          nodeId = null;
        }
      }

      const prevNodeId = getCurrentNodeId(socket.beingId);
      const positionChanged = !!targetNodeId && targetNodeId !== prevNodeId;

      if (targetNodeId) {
        setCurrentNodeId(socket.beingId, targetNodeId);
        // First load via /node/ URL bootstraps rootId if missing; an
        // explicit `rootId` payload always wins.
        if (rootId) setRootId(socket.beingId, rootId);
        else if (!getRootId(socket.beingId)) setRootId(socket.beingId, targetNodeId);

        if (socket.beingId) {
          const r = rootId || getRootId(socket.beingId);
          // afterNavigate when arriving at a root URL; onNodeNavigate for
          // within-tree node moves. Hook handlers care about the distinction.
          const hookName = (rootId || urlNodeId === r) ? "afterNavigate" : "onNodeNavigate";
          hooks.run(hookName, { beingId: socket.beingId, rootId: r, nodeId: targetNodeId, socket }).catch(() => {});
        }
      }

      // Update session registry meta for dashboard tracking.
      if (socket._registrySessionId) {
        updateSessionMeta(socket._registrySessionId, {
          rootId: rootId || getRootId(socket.beingId) || null,
          nodeId: targetNodeId || null,
        });
      }

      // Position transition: rotate session so a new conversation
      // starts fresh at the new position. Any in-flight Summons spawned
      // from a prior position get cancelled at scheduler level via
      // cancelRequest's rootCorrelation sweep; nothing to abort here.
      if (positionChanged) {
        await finalizeOpenSummon(socket);
        rotateSession(socket);
        syncRegistrySession(socket);
      }
    });

    /**
     * Page-load / refresh handler. Updates position tracking and rotates
     * the session if the URL points to a new node. Per-tab refresh state
     * (history, "what's running now") rebuilds from substrate: the being
     * is in a being-room broadcast; the scheduler keeps emitting
     * `ibp:summon` events to that room as Summons progress.
     */
    socket.on("getAvailableModes", async ({ url } = {}) => {
      if (!socket.clientSessionId) return;

      const urlNodeId = url ? nodeIdFromUrl(url) : null;
      if (urlNodeId) setRootId(socket.beingId, urlNodeId);

      const prevNodeId = getCurrentNodeId(socket.beingId);
      const positionChanged = !!urlNodeId && urlNodeId !== prevNodeId;

      if (positionChanged) {
        await finalizeOpenSummon(socket);
        rotateSession(socket);
        syncRegistrySession(socket);
      }
    });

    // ── CHAT ──────────────────────────────────────────────────────────

    /** Check if user has LLM access (own connection or tree owner's). */
    async function checkLlmAccess(beingId, clientSessionId) {
      if (await beingHasLlm(beingId)) return true;
      const activeRootId = getRootId(socket.beingId);
      if (!activeRootId) return false;
      const rootNode = await Node.findById(activeRootId).select("rootOwner llmDefault").lean();
      return rootNode
        && rootNode.rootOwner.toString() !== beingId.toString()
        && rootNode.llmDefault && rootNode.llmDefault !== "none";
    }

    // ── Per-socket message rate limiter ──────────────────────────────────
    const CHAT_RATE_LIMIT = Number(getLandConfigValue("chatRateLimit")) || 10; // msgs per window
    const CHAT_RATE_WINDOW_MS = Number(getLandConfigValue("chatRateWindowMs")) || 60000; // 1 min
    const _chatTimestamps = [];

    // Named handler so extensions can call socket._chatHandler() for debounce.
    //
    // Pipeline:
    //   1. Validate payload (boundary check; reject malformed input).
    //   2. clientSessionId = socket.clientSessionId (transport-only).
    //   3. Apply position state side effects (setRootId, setCurrentNodeId).
    //   4. Enforce length + rate limits.
    //   5. Effective-context log line.
    //   6. LLM access gate.
    //   7. Enqueue the turn (begin → SUMMON to ruler at position → end).
    const _chatHandler = async (rawArgs) => {
      const args = rawArgs || {};
      const {
        message, generation,
        rootId: payloadRootId, currentNodeId: payloadNodeId,
      } = args;
      const payloadName = args.name ?? args.username; // legacy alias

      // 1. Validate.
      const validationError = validateChatPayload(args);
      if (validationError) {
        return emitChatError(socket, ERR.INVALID_INPUT, validationError, generation);
      }

      // 2. Transport session key = socket.clientSessionId (per-tab/CLI,
      //    set at connect). Conversation identity flows through IBP
      //    Address on the SUMMON envelope; this key is transport-only.
      //    See [[stance-authorization]] / sessionKeys.js header.
      const clientSessionId = socket.clientSessionId;

      // 4. Apply position state writes to the being. The chat lands at
      //    the being's currentPositionId; if the payload carries an
      //    explicit rootId/nodeId, it shifts position before dispatch.
      await applyChatPositionFromPayload(clientSessionId, socket, {
        rootId: payloadRootId,
        nodeId: payloadNodeId,
      }, payloadName);

      // 4. Length cap + sliding-window rate limit.
      const maxChatChars = Number(getLandConfigValue("maxChatMessageChars")) || 5000;
      if (message.length > maxChatChars) {
        return emitChatError(
          socket,
          ERR.INVALID_INPUT,
          `Message must be under ${maxChatChars} characters.`,
          generation,
          { maxChars: maxChatChars, actualChars: message.length },
        );
      }
      const now = Date.now();
      while (_chatTimestamps.length > 0 && _chatTimestamps[0] <= now - CHAT_RATE_WINDOW_MS) {
        _chatTimestamps.shift();
      }
      if (_chatTimestamps.length >= CHAT_RATE_LIMIT) {
        return emitChatError(
          socket,
          ERR.RATE_LIMITED,
          "Too many messages. Please wait before sending another.",
          generation,
          { limit: CHAT_RATE_LIMIT, windowMs: CHAT_RATE_WINDOW_MS },
        );
      }
      _chatTimestamps.push(now);

      // 5. Effective-context log. Role isn't a transport concern under
      //    SUMMON — it binds at envelope time per the ruler being at the
      //    position, not on this socket.
      const effRoot = payloadRootId || getRootId(socket.beingId) || null;
      const effNode = payloadNodeId || getCurrentNodeId(socket.beingId) || null;
      const msgSnippet = message.length > 48 ? message.slice(0, 48) + "…" : message;
      log.info(
        "WS",
        `📨 chat: vid=${clientSessionId} root=${effRoot?.slice?.(0, 8) || "-"} node=${effNode?.slice?.(0, 8) || "-"} gen=${generation ?? "-"} · ${JSON.stringify(msgSnippet)}`,
      );

      // 6. LLM access gate.
      try {
        if (!(await checkLlmAccess(socket.beingId, clientSessionId))) {
          return emitChatError(
            socket,
            ERR.LLM_NOT_CONFIGURED,
            "You need to set up a custom LLM connection before chatting. Visit /setup to connect one.",
            generation,
          );
        }
      } catch (err) {
        return emitChatError(socket, ERR.INTERNAL, err.message, generation);
      }

      // 7. Serialize per clientSessionId so two fast messages from the
      //    same tab don't race the inbox/wake calls. Each call is
      //    fire-and-forget downstream — the SUMMON runs in the scheduler.
      await enqueue(clientSessionId, async () => {
        await finalizeOpenSummon(socket);

        ensureSession(socket);
        syncRegistrySession(socket);

        // ─────────────────────────────────────────────────────────────
        // Position-based chat dispatch. The user is at a position; a
        // ruler-role being lives there (planted by a seed such as
        // coder:governing-coder); the chat becomes a SUMMON to that
        // being's inbox. Zones (home/land/tree) retired 2026-05-18 —
        // position determines what's there; stance authorization
        // ([[stance-authorization]]) decides what's allowed. The
        // Ruler's reply broadcasts via `ibp:summon` on the user-being's
        // room from the scheduler; nothing further runs at this layer.
        try {
          const summonRootId = getCurrentNodeId(socket.beingId) || getRootId(socket.beingId);
          if (!summonRootId) {
            throw new Error("Chat requires a position on the socket session.");
          }
          const NodeModel = (await import("../../seed/models/node.js")).default;
          const BeingModel = (await import("../../seed/models/being.js")).default;
          const { appendToInbox } = await import("../../seed/scheduler/inbox.js");
          const { wake } = await import("../../seed/scheduler/scheduler.js");
          const { getLandDomain } = await import("../../seed/addressing/address.js");

          // Resolve the Ruler being at this position. Planted by a
          // seed such as coder:governing-coder. If no ruler-role
          // being lives here, the chat fails with a clear message.
          const rootNode = await NodeModel.findById(summonRootId)
            .select("metadata").lean();
          const rootBeings = rootNode?.metadata instanceof Map
            ? rootNode.metadata.get("beings")
            : rootNode?.metadata?.beings;
          const rulerBeingId = rootBeings?.ruler?.beingId || null;
          if (!rulerBeingId) {
            throw new Error(
              `Position ${String(summonRootId).slice(0, 8)} has no ruler-role being. ` +
              `Plant a seed at this position first (e.g. coder:governing-coder).`,
            );
          }
          const rulerBeing = await BeingModel.findById(rulerBeingId)
            .select("name defaultRole").lean();
          const rulerName = rulerBeing?.name || "ruler";

          // Resolve the user-being's home stance for the SUMMON
          // `from` field. Used by rulerRole.summon's chain-initial-
          // caller resolution to route the reply back here.
          const userBeing = await BeingModel.findById(socket.beingId)
            .select("name homePositionId").lean();
          const userHomeId = userBeing?.homePositionId
            ? String(userBeing.homePositionId)
            : String(socket.beingId); // fallback so the stance parses
          const userName = userBeing?.name || payloadName || "user";

          const landDomain = getLandDomain() || "land";
          const userStance = `${landDomain}/${userHomeId}@${userName}`;

          const { randomUUID } = await import("crypto");
          const correlation = randomUUID();
          const envelope = {
            from:            userStance,
            content:         message,
            correlation,
            rootCorrelation: correlation,  // chain origin
            activeRole:      "ruler",
            priority:        1,            // HUMAN
            sentAt:          new Date().toISOString(),
          };

          await appendToInbox(String(summonRootId), String(rulerBeingId), envelope);
          wake(String(rulerBeingId), String(summonRootId));

          log.info("WS",
            `📨→SUMMON chat: vid=${clientSessionId} ` +
            `user=${userName} → ruler=${rulerName} ` +
            `at ${String(summonRootId).slice(0, 8)} ` +
            `(correlation=${correlation.slice(0, 8)})`);

          clearActiveSummon(socket);
        } catch (err) {
          log.error("WS", `SUMMON dispatch failed: ${err.message}`);
          emitChatError(socket, ERR.INTERNAL, err.message, generation);
          clearActiveSummon(socket);
        }
      });
    };
    socket.on("chat", _chatHandler);
    socket._chatHandler = _chatHandler;

    // ── CANCEL REQUEST ────────────────────────────────────────────────
    // Every chain the being originated is identified by a rootCorrelation;
    // the scheduler holds an abort controller per being currently running
    // a Summon in that chain. Sweep both: abort the in-flight Summons and
    // cancel pending inbox entries downstream.
    socket.on("cancelRequest", async () => {
      log.debug("WS", `Cancel request: ${socket.clientSessionId}`);
      if (socket.beingId) {
        try {
          const beingId = String(socket.beingId);
          const Summon = (await import("../../seed/models/summon.js")).default;
          const { abortByRootCorrelations } = await import("../../seed/scheduler/scheduler.js");
          const { cancelByRootCorrelation } = await import("../../seed/scheduler/inbox.js");

          // 1. Find every active root chain originated by this user.
          const openRoots = await Summon.distinct("rootCorrelation", {
            beingIn: beingId,
            "endMessage.time": null,
          });

          if (openRoots.length) {
            // 2. Abort in-flight Summons whose currentRoot matches.
            const aborted = abortByRootCorrelations(openRoots, "user-cancel");

            // 3. Walk every Summon under those roots to find the
            // downstream beings + positions, then cancel pending
            // inbox entries for each chain. This drops queued work
            // before any wake fires.
            const downstream = await Summon.find({
              rootCorrelation: { $in: openRoots },
            }).select("beingOut ibpAddress rootCorrelation").lean();
            const seen = new Set();
            for (const s of downstream) {
              if (!s.beingOut) continue;
              // ibpAddress encodes the position; cancel sweep is
              // (nodeId, beingId, rootCorrelation). We don't trivially
              // recover the nodeId from ibpAddress here, but the
              // inbox-side cancelByRootCorrelation walks by
              // (nodeId, beingId) — see follow-up issue: derive nodeId
              // from the addressee stance or store it on Summon.
              const key = `${s.beingOut}:${s.rootCorrelation}`;
              if (seen.has(key)) continue;
              seen.add(key);
              // Best-effort: try the being's homePositionId as the
              // inbox node (most non-tree Summons land there).
              try {
                const Being = (await import("../../seed/models/being.js")).default;
                const b = await Being.findById(s.beingOut).select("homePositionId").lean();
                if (b?.homePositionId) {
                  cancelByRootCorrelation(
                    String(b.homePositionId), String(s.beingOut), s.rootCorrelation,
                  ).catch(() => {});
                }
              } catch {}
            }

            if (aborted > 0 || downstream.length > 0) {
              log.info("WS",
                `🛑 user-cancel: ${aborted} Summon${aborted === 1 ? "" : "s"} aborted, ` +
                `${openRoots.length} chain${openRoots.length === 1 ? "" : "s"} swept (${beingId.slice(0, 8)})`);
            }
          }
        } catch (err) {
          log.debug("WS", `SUMMON cancel sweep skipped: ${err.message}`);
        }

        // Fire `request:cancelled` for any extension that still wants to
        // hook the cancel event (gateway cleanup, custom abort registries).
        // The SUMMON sweep above covers governance/inbox cancellation.
        try {
          hooks.run("request:cancelled", {
            beingId: String(socket.beingId),
            clientSessionId: socket.clientSessionId || null,
            socketId: socket.id || null,
          }).catch(() => {});
        } catch (err) {
          log.debug("WS", `request:cancelled hook fire skipped: ${err.message}`);
        }
      }
      // Active chat finalization is handled by the abort path in the chat handler
    });

    // ── NAVIGATOR CONTROL ──────────────────────────────────────────────
    socket.on("detachNavigator", () => {
      if (socket.beingId) {
        clearActiveNavigator(socket.beingId);
        emitNavigatorStatus(socket);
      }
    });

    socket.on("attachNavigator", ({ sessionId }) => {
      if (!socket.beingId || !sessionId) return;
      setActiveNavigator(socket.beingId, sessionId);
      emitNavigatorStatus(socket);
    });

    // ── STOP SESSION ──────────────────────────────────────────────────
    socket.on("stopSession", ({ sessionId }) => {
      if (!socket.beingId || !sessionId) return;
      const session = getSession(sessionId);
      if (!session || session.beingId !== String(socket.beingId)) return;
      log.debug("WS",
        `🛑 Session stopped by user: ${session.type} [${sessionId.slice(0, 8)}]`,
      );
      endSession(sessionId);
      // Tell every connected window for this being to reset its
      // sending state — the cancel applies to the conversation,
      // not just the socket that issued it.
      if (sessionId === socket._registrySessionId) {
        socket._registrySessionId = null;
        if (socket.beingId && io) {
          try { io.to(`being:${String(socket.beingId)}`).emit(WS.CHAT_CANCELLED); }
          catch { socket.emit(WS.CHAT_CANCELLED); }
        } else {
          socket.emit(WS.CHAT_CANCELLED);
        }
      }
    });

    // ── EXTENSION SOCKET HANDLERS ────────────────────────────────────
    for (const [event, handler] of _socketHandlers) {
      socket.on(event, async (data) => {
        try {
          await handler({ socket, beingId: socket.beingId, clientSessionId: socket.clientSessionId, data });
        } catch (err) {
          log.error("WS", `Socket handler "${event}" error:`, err.message);
        }
      });
    }

    // ── DISCONNECT ────────────────────────────────────────────────────
    // The being's Summons keep running in the scheduler — disconnect is
    // a transport-only event. Re-register reclaims the same being-room;
    // every still-running Summon's `ibp:summon` updates land on the new
    // socket. Nothing here aborts work or closes MCP clients.
    socket.on("disconnect", async (reason) => {
      log.debug("WS", `Disconnected: ${socket.id} (${reason})`);

      // Finalize any open Summon record this socket owned (so the
      // record doesn't sit with endMessage.time === null forever).
      await finalizeOpenSummon(socket);

      if (socket._registrySessionId) {
        endSession(socket._registrySessionId);
      }

      if (beingId) {
        removeAuthSession(beingId, socket.id);
      }

      // Drop the reach's transport-key entry so a re-register can claim
      // it. MCP clients are NOT closed here — they're keyed by
      // ibpAddress (or pipeline key) and shared across every socket the
      // being has connected; closing on one disconnect would orphan
      // still-running conversations. The mcp.js stale sweep reaps idle
      // clients on the configured TTL.
      if (socket.clientSessionId
          && userSockets.get(socket.clientSessionId) === socket.id) {
        userSockets.delete(socket.clientSessionId);
      }

      logStats();
    });
  });

  // Subscribe to session changes → sync navigator badge on every
  // active socket for this user (web tabs, CLIs, etc. all get the
  // refresh so the navigator indicator stays consistent).
  function syncNavigatorOnSessionChange({ beingId }) {
    for (const socketId of getAuthSocketIds(beingId)) {
      const s = io.sockets.sockets.get(socketId);
      if (s) emitNavigatorStatus(s);
    }
  }
  hooks.register("afterSessionCreate", syncNavigatorOnSessionChange, "_kernel-ws");
  hooks.register("afterSessionEnd", syncNavigatorOnSessionChange, "_kernel-ws");

  log.info("WS", "WebSocket server initialized");
  return io;
}

// ============================================================================
// PUBLIC EMIT FUNCTIONS
// ============================================================================

export function emitToVisitor(clientSessionId, event, data) {
  if (!io) return;
  const socketId = userSockets.get(clientSessionId);
  if (socketId) io.to(socketId).emit(event, data);
}

export function emitNavigate({
  beingId,
  url,
  replace = false,
  sessionId = null,
}) {
  if (!io) return;

  // If sessionId provided, only allow if this session is the active navigator
  if (sessionId && !canNavigate(sessionId)) {
    log.debug("WS",
      `🚫 Nav blocked: session ${sessionId.slice(0, 8)} is not active navigator for user ${beingId}`,
    );
    return;
  }

  // Fan out to every active socket for this user (web tab, CLI, …).
  // Each client chooses whether to react to the navigate event — the
  // CLI currently ignores it, the browser follows it.
  const socketIds = getAuthSocketIds(beingId);
  if (socketIds.length === 0) return;
  for (const socketId of socketIds) {
    io.to(socketId).emit(WS.NAVIGATE, { url, replace });
  }
  log.debug("WS",
    `📍 Navigated user ${beingId} to ${url} (session: ${sessionId ? sessionId.slice(0, 8) : "ungated"}, fanout: ${socketIds.length})`,
  );
}

export function emitReload({ beingId }) {
  if (!io) return;
  for (const socketId of getAuthSocketIds(beingId)) {
    io.to(socketId).emit(WS.RELOAD);
  }
}

/**
 * Broadcast to ALL connected sockets. Use with extreme caution.
 * Every connected user receives this event. Never send user-specific data.
 * Safe for: extension reload signals, land-wide announcements, config changes.
 *
 * Payload capped at 64KB to prevent network storms. A 64KB broadcast to
 * 10,000 clients is 640MB of I/O. Anything larger must use targeted emits.
 */
const MAX_BROADCAST_BYTES = 65536;

export function emitBroadcast(event, data) {
  if (!io) return;
  if (!event || typeof event !== "string") return;
  try {
    const size = Buffer.byteLength(JSON.stringify(data), "utf8");
    if (size > MAX_BROADCAST_BYTES) {
      log.error("WS", `Broadcast "${event}" rejected: payload ${Math.round(size / 1024)}KB exceeds ${MAX_BROADCAST_BYTES / 1024}KB cap. Use targeted emits for large payloads.`);
      return;
    }
  } catch {
    log.error("WS", `Broadcast "${event}" rejected: payload not serializable.`);
    return;
  }
  io.emit(event, data);
}

export function emitToBeing(beingId, event, data) {
  if (!io) return;
  for (const socketId of getAuthSocketIds(beingId)) {
    io.to(socketId).emit(event, data);
  }
}

export function isUserOnline(beingId) {
  const set = authSessions.get(String(beingId));
  return !!(set && set.size > 0);
}

export function notifyTreeChange({ beingId, nodeId, changeType, details }) {
  if (!io) return;
  for (const socketId of getAuthSocketIds(beingId)) {
    io.to(socketId).emit(WS.TREE_CHANGED, { nodeId, changeType, details });
  }
}

function logStats() {
  let totalSockets = 0;
  for (const set of authSessions.values()) totalSockets += set.size;
  log.debug("WS",
    `📊 Beings: ${authSessions.size} (${totalSockets} sockets) | Reaches: ${userSockets.size} | MCP: ${mcpClients.size} | Registry: ${registeredSessionCount()}`,
  );
}
