// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/websocket.js
// WebSocket server - handles socket events, delegates to conversation manager

import log from "../log.js";
import { WS, ERR } from "../protocol.js";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { getClientForBeing, beingHasLlm } from "../llm/conversation.js";
import { hooks } from "../hooks.js";
import {
  connectToMCP,
  closeMCPClient,
  mcpClients,
  MCP_SERVER_URL,
} from "./mcp.js";
import { getNodeName } from "../tree/treeData.js";
import { getLandConfigValue } from "../landConfig.js";
import { getBlockedExtensionsAtNode } from "../tree/extensionScope.js";
import Node from "../models/node.js";
import { resolveTreeAccess } from "../tree/treeAccess.js";
// orchestrateTreeRequest loaded via registry (tree-orchestrator extension)
import { enqueue } from "./requestQueue.js";
import {
  registerInFlight,
  attachSocket as attachInFlight,
  detachSocket as detachInFlight,
  recordEvent as recordInFlightEvent,
  getInFlight,
  clearInFlight,
  deferSessionEnd,
} from "./inFlightChats.js";
import {
  injectContext,
  setRootId,
  getRootId,
  getCurrentRole,
  clearSession,
  resetConversation,
  sessionCount,
  setCurrentNodeId,
  getCurrentNodeId,
} from "../llm/conversation.js";

// Three top-level zones a socket can sit in. Used by the websocket
// layer to scope its session state and detect navigation crossings.
// Zone determines which beings are addressable at the position; the
// IBP layer handles which role each summoned being acts in.
const BIG_MODES = Object.freeze({
  TREE: "tree",
  HOME: "home",
  LAND: "land",
});

// Detect the zone from a URL path. Tree URLs match /root/<id> or
// /node/<id>; user/home URLs match /user/; everything else (admin,
// land config) is the land zone.
function bigModeFromUrl(url) {
  if (typeof url !== "string" || !url) return null;
  const path = url.split("?")[0];
  if (/^(\/api\/v1)?\/(root|node)\//.test(path)) return BIG_MODES.TREE;
  if (/^(\/api\/v1)?\/user(\/|$)/.test(path))    return BIG_MODES.HOME;
  if (/^(\/api\/v1)?\/land(\/|$)/.test(path))    return BIG_MODES.LAND;
  return null;
}
import {
  ensureSession,
  rotateSession,
  setActiveSummon,
  clearActiveSummon,
  finalizeOpenSummon,
} from "../llm/summonTracker.js";
// Provided by tree-orchestrator extension if installed. No-op without it.
let clearMemory = () => {};
export function setClearMemoryFn(fn) { if (typeof fn === "function") clearMemory = fn; }
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
const userSockets = new Map(); // aiSessionKey → socket.id (1:1; each aiSessionKey is unique per connection)
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
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { aiSessionKey: socket.aiSessionKey },
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

// "be" retired 2026-05-18 — extension territory shortcut, not a verb. The
// three survivors are tool-permission overlays on one SUMMON loop (see
// memory `intents-are-tool-permissions`).
const SAFE_CHAT_MODES = new Set(["chat", "place", "query"]);

// Reject chat payloads that don't carry the minimum required fields.
// Returns null on success or a string error to emit back to the client.
function validateChatPayload(args) {
  if (!args || typeof args !== "object") return "Missing or invalid message";
  const { message, username } = args;
  if (!message || typeof message !== "string") return "Missing or invalid message";
  if (!username || typeof username !== "string" || username.length > 200) {
    return "Missing or invalid message";
  }
  return null;
}

// Compose the per-position visitor id from the socket and chat payload.
// Tree messages get a tree-zone key; explicit zone payloads (home/land)
// get a zone-prefixed key; anything else falls back to the socket's
// transport-level visitor id. All inputs are length-checked at the
// boundary.
async function resolvePerPositionAiSessionKey(socket, payload) {
  const { buildUserAiSessionKey } = await import("../llm/sessionKeys.js");
  const handle = (typeof payload.sessionHandle === "string"
    && /^[a-z0-9_-]{1,40}$/i.test(payload.sessionHandle))
    ? payload.sessionHandle
    : null;
  const device = socket.clientKind || "web";
  const fallback = socket.aiSessionKey || `user:${socket.beingId}:transport:${device}`;

  if (typeof payload.rootId === "string" && payload.rootId.length > 0 && payload.rootId.length <= 36) {
    return buildUserAiSessionKey({
      beingId: socket.beingId,
      zone: "tree",
      rootId: payload.rootId,
      device,
      handle,
    });
  }
  if (payload.zone === "home" || payload.zone === "land") {
    return buildUserAiSessionKey({
      beingId: socket.beingId,
      zone: payload.zone,
      device,
      handle,
    });
  }
  return fallback;
}

// Apply position state writes (setRootId/setCurrentNodeId) from the
// chat payload. Tree access is verified before any state is written
// when a rootId is supplied. Errors are logged at warn level but
// never thrown — chat falls through with whatever state was applied.
// Role/behavior binding happens at SUMMON time, not here.
async function applyChatPositionFromPayload(aiSessionKey, socket, payload, _username) {
  const { rootId, nodeId, zone } = payload;

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
    return;
  }

  if (zone === "home" || zone === "land") {
    setRootId(socket.beingId, null);
    setCurrentNodeId(socket.beingId, null);
  }
}

// Open the in-flight turn: cancel any prior abort on this socket, create
// a new abort controller, register the turn in the cross-socket
// in-flight registry, build the tee-emitter the orchestrator uses to
// fan out streaming events, and stamp the socket fields urlChanged /
// getAvailableModes consult. Symmetric tear-down lives in endChatTurn.
function beginChatTurn(socket, aiSessionKey, bigMode) {
  if (socket._chatAbort) socket._chatAbort.abort();
  const abort = new AbortController();
  socket._chatAbort = abort;

  const inFlightRootId = bigMode === "tree" ? (getRootId(socket.beingId) || null) : null;
  socket._inFlightStableKey = aiSessionKey;
  socket._inFlightZone = bigMode;
  socket._inFlightRootId = inFlightRootId;

  // Being-room broadcast: every socket the being has connected (web
  // tab + CLI + …) receives the streaming events. Single-context
  // being model — all of the being's open windows see the same
  // conversation as it unfolds. Falls back to the legacy in-flight
  // socket set when beingId is missing (anonymous flows, edge cases).
  const beingRoom = socket.beingId ? `being:${String(socket.beingId)}` : null;

  const inFlightEntry = registerInFlight(aiSessionKey, abort, socket);
  const teeEmit = (event, data) => {
    recordInFlightEvent(aiSessionKey, event, data);
    if (abort.signal.aborted) return;
    if (beingRoom && io) {
      try { io.to(beingRoom).emit(event, data); } catch {}
      return;
    }
    // Fallback (no beingId): emit to the legacy per-aiSessionKey socket
    // set. Snapshot to avoid concurrent attach/detach mutation.
    const sockets = inFlightEntry?.sockets;
    if (sockets && sockets.size) {
      for (const s of sockets) {
        try { s.emit(event, data); } catch {}
      }
    }
    // No socket attached (mid-disconnect): the event still landed
    // in the buffer above and replays on re-attach.
  };

  return { abort, teeEmit };
}

// Close the in-flight turn. Clears the socket-level abort marker (only
// if we still own it — a later turn may have replaced it), drops the
// cross-socket registry entry, clears the zone/rootId stamps, and lets
// the stream extension drain mid-flight messages so they don't bleed
// into the next chat.
function endChatTurn(socket, abort, aiSessionKey) {
  if (socket._chatAbort === abort) socket._chatAbort = null;
  clearInFlight(aiSessionKey);
  if (socket._inFlightStableKey === aiSessionKey) {
    socket._inFlightStableKey = null;
    socket._inFlightZone = null;
    socket._inFlightRootId = null;
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
          socket.username = decoded.username;
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
          socket.username = decoded.username;
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
    // the set grows, nothing gets disconnected. CLI + browser + mobile
    // all coexist under the same beingId.
    if (beingId) {
      addAuthSession(beingId, socket.id);
    }

    socket.on("ready", () => {
      log.verbose("WS", `App ready: ${beingId}`);
    });

    // ── REGISTER ──────────────────────────────────────────────────────
    socket.on("register", async () => {
      const beingId = socket.beingId;
      const username = socket.username;

      if (!socket.jwt) {
        socket.emit(WS.REGISTERED, { success: false, error: "Unauthorized" });
        return;
      }
      if (!socket.username || !socket.beingId) {
        socket.emit(WS.REGISTERED, {
          success: false,
          error: "Invalid token claims",
        });
        return;
      }

      // Per-connection transport key. `clientKind:clientInstance`
      // uniquely identifies this socket within the user, so separate
      // tabs / CLI shells / room-agent dispatches each get their own
      // isolated session, MCP connection, and chat memory. Dedupe at
      // line 374 fires only on exact-match aiSessionKey — a reload in the
      // same tab or a re-exec of the same CLI pid.
      //
      // Shape matches `buildUserAiSessionKey` in seed/llm/sessionKeys.js:
      //   user:${beingId}:transport:${clientKind}:${clientInstance}
      // The `transport:` segment distinguishes this tab-level fallback
      // key from the zone-specific user keys (`user:${beingId}:${rootId}:${device}`)
      // that every chat builds via buildUserAiSessionKey. This fallback
      // is only reached when the client hasn't yet sent payload context
      // (urlChanged / first chat). It should eventually be deletable.
      const aiSessionKey = `user:${beingId}:transport:${socket.clientKind || "web"}:${socket.clientInstance || socket.id.slice(0, 8)}`;
      const oldSocketId = userSockets.get(aiSessionKey);
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }

      userSockets.set(aiSessionKey, socket.id);
      socket.aiSessionKey = aiSessionKey;
      socket.username = username;

      // Join the being-room so async chat events (chat-response,
      // tool-result, thinking, descriptor patches, SUMMON replies) reach
      // every socket the being has connected. Single-context being
      // model: Tabor on web and Tabor on CLI share the same room and
      // see the same conversation state. Per-socket emits (registered,
      // navigator-session, command responses) stay direct.
      if (beingId) {
        socket.join(`being:${String(beingId)}`);
      }

      // Initialize AI session for this connection
      ensureSession(socket);
      syncRegistrySession(socket);

      // MCP connection happens lazily inside runChat / runOrchestration
      // under the canonical conversation key (IBP Address for
      // being-to-being, pipeline key for stanceless). Pre-connecting
      // here under `aiSessionKey` would orphan that client the moment
      // the first runChat opens a new one under ibpAddress — see
      // the two-client trace from before Slice 5 cleanup.
      socket.emit(WS.REGISTERED, { success: true, aiSessionKey });

      logStats();
    });

    // Mode-switching socket events retired 2026-05-18. Role is the unit
    // of behavior; it's bound at SUMMON time via the envelope's activeRole.
    // The client never tells the server "switch to mode X" — instead it
    // navigates (urlChanged) and the next SUMMON carries the role.

    /**
     * URL-based zone detection from frontend.
     * Frontend sends this when the iframe URL changes.
     * Payload: { url: "/root/abc123", rootId?: "abc123" }
     */
    socket.on("urlChanged", async ({ url, rootId, nodeId } = {}) => {
      if (!socket.aiSessionKey) return;
      // Cap URL to prevent multi-MB payloads flowing through mode detection and session meta
      if (typeof url === "string" && url.length > 2000) url = url.slice(0, 2000);
      if (rootId && (typeof rootId !== "string" || rootId.length > 36)) rootId = null;
      if (nodeId && (typeof nodeId !== "string" || nodeId.length > 36)) nodeId = null;

      const newBigMode = bigModeFromUrl(url);

      // Compute the chat-relevant ai-chat session key for the destination.
      // This matches what the chat handler will build from payload context,
      // so state we set here (rootId, currentNodeId, mode) is the state the
      // next chat reads, and switchBigMode clears the right session.
      // Without this, urlChanged operates on socket.aiSessionKey (tab-level)
      // while chat operates on the per-zone key — a mode switch clears the
      // wrong session and the next chat in the new zone inherits old history.
      const { buildUserAiSessionKey } = await import("../llm/sessionKeys.js");
      const _device = socket.clientKind || "web";
      let aiSessionKey;
      if (newBigMode === BIG_MODES.TREE && rootId) {
        aiSessionKey = buildUserAiSessionKey({
          beingId: socket.beingId, zone: "tree", rootId, device: _device,
        });
      } else if (newBigMode === BIG_MODES.HOME || newBigMode === BIG_MODES.LAND) {
        aiSessionKey = buildUserAiSessionKey({
          beingId: socket.beingId, zone: newBigMode, device: _device,
        });
      } else {
        // Unknown/transitional URL — keep the old fallback.
        aiSessionKey = socket.aiSessionKey;
      }

      // Detect zone transition at the SOCKET level. Tracking the socket's
      // last big mode forces the abort/reset on any tab-level navigation
      // between zones.
      const prevSocketBig = socket._lastBigMode || null;
      const socketZoneTransition = !!newBigMode && prevSocketBig !== newBigMode;

      // Validate tree access before accepting rootId/nodeId from the client.
      // Without this, a crafted WebSocket message could point the AI at another user's tree.
      // Only check for tree navigation (not home/land which have no tree context).
      const targetId = rootId || nodeId;
      if (targetId && socket.beingId && newBigMode === BIG_MODES.TREE) {
        try {
          const access = await resolveTreeAccess(targetId, socket.beingId);
          if (!access.ok || !access.canWrite) {
            log.warn("WS", `Access denied: ${socket.beingId} tried to navigate to ${targetId}`);
            rootId = null;
            nodeId = null;
          }
        } catch {
          rootId = null;
          nodeId = null;
        }
      }

      // Update rootId when viewing a root URL
      if (rootId) {
        setRootId(socket.beingId,rootId);
        setCurrentNodeId(socket.beingId,rootId); // root is also current node
        if (socket.beingId) {
          hooks.run("afterNavigate", { beingId: socket.beingId, rootId, nodeId: rootId, socket }).catch(() => {});
        }
      } else if (nodeId) {
        // Viewing a non-root node — update currentNodeId only
        setCurrentNodeId(socket.beingId,nodeId);
        // Only set rootId if we don't have one yet (first load via /node/ URL)
        if (!getRootId(socket.beingId)) {
          setRootId(socket.beingId,nodeId);
        }
        // In-tree navigation hook (distinct from afterNavigate which fires on root load)
        if (socket.beingId) {
          hooks.run("onNodeNavigate", { beingId: socket.beingId, rootId: getRootId(socket.beingId), nodeId, socket }).catch(() => {});
        }
      }

      // Update session registry meta for dashboard tracking
      if (socket._registrySessionId) {
        updateSessionMeta(socket._registrySessionId, {
          rootId: rootId || getRootId(socket.beingId) || null,
          nodeId: nodeId || rootId || getCurrentNodeId(socket.beingId) || null,
        });
      }

      // Clear both when going home
      if (newBigMode === BIG_MODES.HOME) {
        setRootId(socket.beingId,null);
        setCurrentNodeId(socket.beingId,null);
        clearMemory(aiSessionKey);
      }

      // Abort the in-flight chat only when the user has truly left
      // its home: zone changed (tree → home/land) or rootId differs
      // (tree A → tree B). Within-tree node nav lands here with
      // rootId=null, which is treated as "stay" not "abort".
      const shouldAbort = !!newBigMode
        && socket._inFlightZone
        && (
          newBigMode !== socket._inFlightZone
          || (newBigMode === BIG_MODES.TREE && rootId && socket._inFlightRootId && rootId !== socket._inFlightRootId)
        );

      if (socketZoneTransition) {
        await finalizeOpenSummon(socket);
        if (shouldAbort && socket._chatAbort) {
          socket._chatAbort.abort();
          socket._chatAbort = null;
        }
        // Rotate session when returning to home — a fresh visit gets a
        // fresh session id.
        if (newBigMode === BIG_MODES.HOME) {
          rotateSession(socket);
          syncRegistrySession(socket);
        }
      }

      // Remember the zone the socket is currently in.
      if (newBigMode) socket._lastBigMode = newBigMode;
    });

    /**
     * Request available modes for current big mode (e.g., on page load).
     */
    socket.on("getAvailableModes", async ({ url } = {}) => {
      if (!socket.aiSessionKey) return;

      const urlBigMode = url ? bigModeFromUrl(url) : null;

      // Extract rootId from URL first so we can build the chat key.
      let urlRootId = null;
      if (url) {
        const ID =
          "(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";
        const rootMatch = url.match(new RegExp(`(?:/api/v1)?/root/(${ID})`, "i"));
        const bareMatch = url.match(new RegExp(`(?:/api/v1)?/(${ID})(?:[?/]|$)`, "i"));
        urlRootId = rootMatch?.[1] || bareMatch?.[1] || null;
      }

      // Key on the chat-relevant ai-chat session key so state matches
      // what the chat handler reads. See urlChanged above.
      const { buildUserAiSessionKey } = await import("../llm/sessionKeys.js");
      const _device = socket.clientKind || "web";
      let aiSessionKey;
      if (urlBigMode === BIG_MODES.TREE && urlRootId) {
        aiSessionKey = buildUserAiSessionKey({
          beingId: socket.beingId, zone: "tree", rootId: urlRootId, device: _device,
        });
      } else if (urlBigMode === BIG_MODES.HOME || urlBigMode === BIG_MODES.LAND) {
        aiSessionKey = buildUserAiSessionKey({
          beingId: socket.beingId, zone: urlBigMode, device: _device,
        });
      } else {
        aiSessionKey = socket.aiSessionKey;
      }

      if (url) {
        if (urlRootId) setRootId(socket.beingId, urlRootId);
        if (urlBigMode === BIG_MODES.HOME) setRootId(socket.beingId, null);
      }

      // Zone-transition detector (socket-level, not session-level).
      const prevSocketBig = socket._lastBigMode || null;
      const socketZoneTransition = !!urlBigMode && prevSocketBig !== urlBigMode;

      // Re-attach to an in-flight chat for this URL's stable key
      // (refresh path). Bind the new socket, replay buffered events,
      // share the abort controller.
      const inFlightForKey = getInFlight(aiSessionKey);
      if (inFlightForKey) {
        attachInFlight(aiSessionKey, socket);
        socket._inFlightStableKey = aiSessionKey;
        socket._inFlightZone = urlBigMode || null;
        socket._inFlightRootId = (urlBigMode === BIG_MODES.TREE) ? (urlRootId || null) : null;
        socket._chatAbort = inFlightForKey.abort;
        for (const ev of inFlightForKey.buffer) {
          try { socket.emit(ev.event, ev.data); } catch {}
        }
      }

      // Abort the in-flight chat when the socket actually left its
      // home (zone changed or rootId differs).
      const shouldAbort = !!urlBigMode
        && socket._inFlightZone
        && (
          urlBigMode !== socket._inFlightZone
          || (urlBigMode === BIG_MODES.TREE && urlRootId && socket._inFlightRootId && urlRootId !== socket._inFlightRootId)
        );

      if (socketZoneTransition) {
        await finalizeOpenSummon(socket);
        if (shouldAbort && socket._chatAbort) {
          socket._chatAbort.abort();
          socket._chatAbort = null;
        }
        if (urlBigMode === BIG_MODES.HOME || !urlBigMode) {
          rotateSession(socket);
          syncRegistrySession(socket);
        }
      }

      if (urlBigMode) socket._lastBigMode = urlBigMode;
    });

    // ── CHAT ──────────────────────────────────────────────────────────

    /** Check if user has LLM access (own connection or tree owner's). */
    async function checkLlmAccess(beingId, aiSessionKey) {
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
    //   2. Snapshot last chat context so the stream extension's
    //      turn-end replay can carry it forward.
    //   3. Resolve the per-position visitor id (`aiSessionKey` below).
    //   4. Apply position state side effects (setRootId, switchMode, etc).
    //   5. Enforce length + rate limits.
    //   6. Effective-context log line.
    //   7. Authorize (LLM access gate).
    //   8. Route to stream extension if it claims the message.
    //   9. Enqueue the orchestration turn (begin → run → end).
    const _chatHandler = async (rawArgs) => {
      const args = rawArgs || {};
      const {
        message, username, generation, mode: chatMode,
        rootId: payloadRootId, currentNodeId: payloadNodeId,
        zone: payloadZone, sessionHandle: payloadHandle,
      } = args;

      // 1. Validate.
      const validationError = validateChatPayload(args);
      if (validationError) {
        return emitChatError(socket, ERR.INVALID_INPUT, validationError, generation);
      }

      // 2. Snapshot the incoming payload context. The stream extension's
      //    turn-end follow-up replay reuses this when re-entering the
      //    handler so position state survives the debounce hop.
      socket._lastChatCtx = {
        rootId: payloadRootId || null,
        currentNodeId: payloadNodeId || null,
        zone: payloadZone || null,
        sessionHandle: payloadHandle || null,
      };

      // 3. Compute per-position visitor id. This is the per-zone /
      //    per-tree session key (e.g. user:<uid>:tree:<rootId>:web).
      //    Every downstream state read uses it so a @fitness chat
      //    doesn't touch @default's state.
      const aiSessionKey = await resolvePerPositionAiSessionKey(socket, {
        rootId: payloadRootId,
        zone: payloadZone,
        sessionHandle: payloadHandle,
      });

      // 4. Apply position state writes + switchMode side effects. Tree
      //    access is verified before any writes when a rootId is given.
      await applyChatPositionFromPayload(aiSessionKey, socket, {
        rootId: payloadRootId,
        nodeId: payloadNodeId,
        zone: payloadZone,
      }, username);

      // 5. Length cap + sliding-window rate limit.
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

      const safeChatMode = SAFE_CHAT_MODES.has(chatMode) ? chatMode : "chat";

      // 6. Effective-context log.
      const effRoot = payloadRootId || getRootId(socket.beingId) || null;
      const effNode = payloadNodeId || getCurrentNodeId(socket.beingId) || null;
      const activeRole = getCurrentRole(aiSessionKey);
      const effRole = activeRole?.name || null;
      const effZone = payloadZone || socket._lastBigMode || null;
      const handleTag = (typeof payloadHandle === "string" && /^[a-z0-9_-]{1,40}$/i.test(payloadHandle))
        ? payloadHandle
        : "-";
      const msgSnippet = message.length > 48 ? message.slice(0, 48) + "…" : message;
      log.info(
        "WS",
        `📨 chat: vid=${aiSessionKey} root=${effRoot?.slice?.(0, 8) || "-"} node=${effNode?.slice?.(0, 8) || "-"} zone=${effZone || "-"} role=${effRole || "-"} handle=${handleTag} gen=${generation ?? "-"} · ${JSON.stringify(msgSnippet)}`,
      );

      // 7. LLM access gate.
      try {
        if (!(await checkLlmAccess(socket.beingId, aiSessionKey))) {
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

      // 8. Serialize per aiSessionKey. Previous message must finish first.
      await enqueue(aiSessionKey, async () => {
        // Resolve bigMode once at the top of the turn from the socket's
        // last-known zone (set by urlChanged). "home" is the safe
        // default for the unset case.
        const bigMode = socket._lastBigMode || payloadZone || "home";
        const { abort, teeEmit } = beginChatTurn(socket, aiSessionKey, bigMode);

        // Finalize any leftover chat from a prior interrupted message.
        await finalizeOpenSummon(socket);

        // Persistent session + chat-record context.
        ensureSession(socket);
        syncRegistrySession(socket);
        const sessionId = socket._registrySessionId;

        // ─────────────────────────────────────────────────────────────
        // Tree-zone chat/place/query: route via SUMMON. The Ruler being
        // at the tree's root receives the user's message in its inbox;
        // the per-being scheduler invokes rulerRole.summon; the reply
        // routes back via emitReplyToStance to the user-being's inbox,
        // and the cognition-aware wake() broadcasts `ibp:summon`
        // to `being:<userBeingId>` so the user's browser observers
        // render it. No orchestrator in the path.
        //
        // intent carries the chat-mode flavor (chat | place | query).
        // chat/place/query are tool-permission overlays on the same
        // loop, not separate dispatch paths (see memory
        // `intents-are-tool-permissions`). "be" retired entirely.
        if (bigMode === "tree") {
          try {
            const summonRootId = getRootId(socket.beingId);
            if (!summonRootId) {
              throw new Error("Tree-zone chat requires a rootId on the socket session.");
            }
            const NodeModel = (await import("../models/node.js")).default;
            const BeingModel = (await import("../models/being.js")).default;
            const { appendToInbox } = await import("../../ibp/inbox.js");
            const { wake } = await import("../../ibp/scheduler.js");
            const { getLandDomain } = await import("../../ibp/address.js");

            // Resolve the Ruler being at the tree root. The flip
            // depends on governing having promoted root → Ruler at
            // tree creation / extension boot (afterBoot backfill).
            const rootNode = await NodeModel.findById(summonRootId)
              .select("metadata").lean();
            const rootBeings = rootNode?.metadata instanceof Map
              ? rootNode.metadata.get("beings")
              : rootNode?.metadata?.beings;
            const rulerBeingId = rootBeings?.ruler?.beingId || null;
            if (!rulerBeingId) {
              throw new Error(
                `Tree root ${String(summonRootId).slice(0, 8)} has no Ruler being. ` +
                `Governance not initialized at this scope.`,
              );
            }
            const rulerBeing = await BeingModel.findById(rulerBeingId)
              .select("username defaultRole").lean();
            const rulerUsername = rulerBeing?.username || "ruler";

            // Resolve the user-being's home stance for the SUMMON
            // `from` field. Used by rulerRole.summon's chain-initial-
            // caller resolution to route the reply back here.
            const userBeing = await BeingModel.findById(socket.beingId)
              .select("username homePositionId").lean();
            const userHomeId = userBeing?.homePositionId
              ? String(userBeing.homePositionId)
              : String(socket.beingId); // fallback so the stance parses
            const userUsername = userBeing?.username || username || "user";

            const landDomain = getLandDomain() || "land";
            const userStance = `${landDomain}/${userHomeId}@${userUsername}`;

            const { randomUUID } = await import("crypto");
            const correlation = randomUUID();
            // intent field retired as permission overlay (see memory
            // `role-permissions-not-envelope`). The Ruler's role.permissions
            // gates tool surface; envelope just carries content.
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
              `📨→SUMMON tree-zone chat: vid=${aiSessionKey} ` +
              `user=${userUsername} → ruler=${rulerUsername} ` +
              `at ${String(summonRootId).slice(0, 8)} ` +
              `(correlation=${correlation.slice(0, 8)})`);

            // No immediate CHAT_RESPONSE — the Ruler's reply will
            // arrive asynchronously via `ibp:summon` on the
            // user-being's room. Clear in-flight tracking so the
            // socket isn't stuck in a "still running" state; the
            // scheduler runs independently from here.
            clearActiveSummon(socket);
            return;
          } catch (err) {
            log.error("WS", `Tree-zone SUMMON dispatch failed: ${err.message}`);
            teeEmit(WS.CHAT_ERROR, {
              code: ERR.INTERNAL,
              error: err.message,
              generation,
            });
            clearActiveSummon(socket);
            return;
          }
        }

        // Home/land zones don't route through SUMMON yet — those beings
        // haven't been registered. Surface a clear error instead of the
        // legacy runOrchestration fallback (deleted 2026-05-18 with the
        // central orchestrator). Tree-zone (above) is the only working
        // chat path under the queue model today.
        log.warn("WS",
          `Chat in ${bigMode}-zone: no being registered to receive it. ` +
          `Plant a seed at a node first (e.g. coder:governing-coder).`);
        teeEmit(WS.CHAT_ERROR, {
          code: ERR.INTERNAL,
          error: `Chat is only supported in tree-zone right now. ${bigMode}-zone beings haven't been registered.`,
          generation,
        });
        clearActiveSummon(socket);
        endChatTurn(socket, abort, aiSessionKey);
      });
    };
    socket.on("chat", _chatHandler);
    socket._chatHandler = _chatHandler;

    // ── CANCEL REQUEST ────────────────────────────────────────────────
    socket.on("cancelRequest", async () => {
      if (socket._chatAbort) {
        log.debug("WS", `Cancel request: ${socket.aiSessionKey}`);
        socket._chatAbort.abort();
        socket._chatAbort = null;
      }

      // SUMMON-era cascade cancel. Every chain the user originated is
      // identified by a rootCorrelation; the scheduler holds an abort
      // controller per being currently running a Summon in that chain.
      // Sweep both: abort the in-flight Summons and cancel pending
      // inbox entries downstream.
      if (socket.beingId) {
        try {
          const beingId = String(socket.beingId);
          const Summon = (await import("../models/summon.js")).default;
          const { abortByRootCorrelations } = await import("../../ibp/scheduler.js");
          const { cancelByRootCorrelation } = await import("../../ibp/inbox.js");

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
                const Being = (await import("../models/being.js")).default;
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
            aiSessionKey: socket.aiSessionKey || null,
            socketId: socket.id || null,
          }).catch(() => {});
        } catch (err) {
          log.debug("WS", `request:cancelled hook fire skipped: ${err.message}`);
        }
      }
      // Active chat finalization is handled by the abort path in the chat handler
    });

    // ── ACTIVE ROOT ───────────────────────────────────────────────────
    socket.on("setActiveRoot", ({ rootId } = {}) => {
      const aiSessionKey = socket.aiSessionKey;
      if (!aiSessionKey || !rootId || typeof rootId !== "string") return;
      // Basic format check: must look like a UUID or ObjectId
      if (rootId.length > 36) return;
      setRootId(socket.beingId,rootId);
      log.debug("WS", `Set root: ${aiSessionKey}: ${rootId}`);
    });
    // ── FRONTEND SYNC (context injection) ─────────────────────────────
    // All payloads are capped. The frontend can send arbitrary data.
    // injectContext already caps at 32KB, but we sanitize here too to
    // prevent JSON.stringify on a multi-MB changes object.

    function safeStr(val, max = 200) {
      if (val == null) return "";
      return String(val).slice(0, max);
    }

    socket.on("nodeUpdated", ({ nodeId, changes } = {}) => {
      const aiSessionKey = socket.aiSessionKey;
      if (!aiSessionKey || !nodeId) return;
      const changesStr = typeof changes === "object" ? JSON.stringify(changes).slice(0, 500) : safeStr(changes, 500);
      injectContext(aiSessionKey, `[Frontend Update] User modified node ${safeStr(nodeId)}. Changes: ${changesStr}`);
    });

    socket.on("nodeNavigated", ({ nodeId, nodeName } = {}) => {
      const aiSessionKey = socket.aiSessionKey;
      if (!aiSessionKey || !nodeId) return;
      injectContext(aiSessionKey, `[Frontend Navigation] User navigated to node "${safeStr(nodeName)}" (${safeStr(nodeId)}).`);
    });

    socket.on("nodeSelected", ({ nodeId, nodeName } = {}) => {
      const aiSessionKey = socket.aiSessionKey;
      if (!aiSessionKey || !nodeId) return;
      injectContext(aiSessionKey, `[Frontend Selection] User is now focusing on node "${safeStr(nodeName)}" (${safeStr(nodeId)}).`);
    });

    socket.on("nodeCreated", ({ nodeId, nodeName, parentId } = {}) => {
      const aiSessionKey = socket.aiSessionKey;
      if (!aiSessionKey || !nodeId) return;
      injectContext(aiSessionKey, `[Frontend Action] User created node "${safeStr(nodeName)}" (${safeStr(nodeId)}) under ${safeStr(parentId)}.`);
    });

    socket.on("nodeDeleted", ({ nodeId, nodeName } = {}) => {
      const aiSessionKey = socket.aiSessionKey;
      if (!aiSessionKey || !nodeId) return;
      injectContext(aiSessionKey, `[Frontend Action] User deleted node "${safeStr(nodeName)}" (${safeStr(nodeId)}).`);
    });

    socket.on("noteCreated", ({ nodeId, noteContent } = {}) => {
      const aiSessionKey = socket.aiSessionKey;
      if (!aiSessionKey || !nodeId) return;
      const preview = safeStr(noteContent, 100);
      injectContext(aiSessionKey, `[Frontend Action] User added note to node ${safeStr(nodeId)}: "${preview}${noteContent?.length > 100 ? "..." : ""}"`);
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
      // If it was the user's own chat abort, cancel in-flight request
      if (sessionId === socket._registrySessionId) {
        if (socket._chatAbort) {
          socket._chatAbort.abort();
          socket._chatAbort = null;
        }
        socket._registrySessionId = null;
        // Tell every connected window for this being to reset its
        // sending state — the cancel applies to the conversation,
        // not just the socket that issued it.
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
          await handler({ socket, beingId: socket.beingId, aiSessionKey: socket.aiSessionKey, data });
        } catch (err) {
          log.error("WS", `Socket handler "${event}" error:`, err.message);
        }
      });
    }

    // ── CLEAR / DISCONNECT ────────────────────────────────────────────
    socket.on("clearConversation", async () => {
      const aiSessionKey = socket.aiSessionKey;
      if (aiSessionKey) {
        // Finalize any in-flight chat
        await finalizeOpenSummon(socket);

        await resetConversation(aiSessionKey, {
          username: socket.username,
          beingId: socket.beingId,
        });

        rotateSession(socket);
        syncRegistrySession(socket);

        socket.emit(WS.CONVERSATION_CLEARED, { success: true });
      }
      clearMemory(socket.aiSessionKey);
    });

    socket.on("disconnect", async (reason) => {
      log.debug("WS", `Disconnected: ${socket.id} (${reason})`);

      const inFlightKey = socket._inFlightStableKey || null;
      const hadInFlight = !!inFlightKey;

      // Detach from the in-flight chat registry instead of aborting.
      // The chat keeps running so a refreshed/reconnected client can
      // re-attach and replay the buffered tail. If no socket
      // re-attaches within the orphan TTL (60s), the registry's own
      // timer aborts the controller and clears the entry.
      if (hadInFlight) {
        detachInFlight(inFlightKey, socket);
        socket._inFlightStableKey = null;
        socket._inFlightZone = null;
        socket._inFlightRootId = null;
      }

      // Finalize any in-flight chat — but only when no chat is actually
      // still running. finalizeOpenSummon writes `stopped: true` to the
      // Chat record, which mis-labels a chat we left running on
      // purpose. When the chat completes naturally, runOrchestration
      // finalizes the record itself.
      if (!hadInFlight) {
        await finalizeOpenSummon(socket);
      }

      // Drop the per-socket abort handle. The controller still lives
      // in the registry entry so cancelRequest from a re-attached
      // socket still works.
      socket._chatAbort = null;

      // Clean up session registry. endSession() unconditionally aborts
      // the AbortController that runOrchestration registered against
      // this session, which is the same controller the in-flight chat
      // is using. When a chat IS in flight, we hand the sessionId to
      // the in-flight registry instead — clearInFlight (chat completes)
      // or the orphan timer (no reconnect) will end it then. Either
      // way the session is cleaned up promptly without killing the
      // chat we want to keep alive.
      if (socket._registrySessionId) {
        if (hadInFlight) {
          deferSessionEnd(inFlightKey, socket._registrySessionId);
        } else {
          endSession(socket._registrySessionId);
        }
      }

      if (beingId) {
        removeAuthSession(beingId, socket.id);
      }

      if (socket.aiSessionKey) {
        const aiSessionKey = socket.aiSessionKey;
        if (userSockets.get(aiSessionKey) === socket.id) {
          userSockets.delete(aiSessionKey);
          closeMCPClient(aiSessionKey).catch((err) =>
            log.error("WS",
              `❌ MCP cleanup failed for ${aiSessionKey}:`,
              err.message,
            ),
          );
          clearSession(aiSessionKey);
        }
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

export function emitToVisitor(aiSessionKey, event, data) {
  if (!io) return;
  const socketId = userSockets.get(aiSessionKey);
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
    `📊 Users: ${authSessions.size} (${totalSockets} sockets) | Visitors: ${userSockets.size} | MCP: ${mcpClients.size} | Sessions: ${sessionCount()} | Registry: ${registeredSessionCount()}`,
  );
}
