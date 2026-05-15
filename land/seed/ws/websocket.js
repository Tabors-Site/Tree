// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/websocket.js
// WebSocket server - handles socket events, delegates to conversation manager

import log from "../log.js";
import { WS, ERR } from "../protocol.js";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { getClientForUser, userHasLlm } from "../llm/conversation.js";
import { hooks } from "../hooks.js";
import {
  connectToMCP,
  closeMCPClient,
  mcpClients,
  MCP_SERVER_URL,
} from "./mcp.js";
import { getNodeName } from "../tree/treeData.js";
import { getLandConfigValue } from "../landConfig.js";
import { getModeOwner, getBlockedExtensionsAtNode } from "../tree/extensionScope.js";
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
  switchMode,
  switchBigMode,
  injectContext,
  setRootId,
  getRootId,
  getCurrentMode,
  clearSession,
  resetConversation,
  sessionCount,
  setCurrentNodeId,
  getCurrentNodeId,
} from "../llm/conversation.js";
import {
  getSubModes,
  bigModeFromUrl,
  getDefaultMode,
  BIG_MODES,
} from "../modes/registry.js";
import {
  ensureSession,
  rotateSession,
  setActiveChat,
  clearActiveChat,
  finalizeOpenChat,
  clearChatContext,
} from "../llm/chatTracker.js";
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
  getSessionsForUser,
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
const userSockets = new Map(); // visitorId → socket.id (1:1; each visitorId is unique per connection)
const authSessions = new Map(); // userId → Set<socket.id> (N:1; a user can hold many concurrent sockets)

// Helpers for the N:1 authSessions map. Every emit-to-user function
// uses these so a single user's events fan out to all their clients
// (web tab, CLI shell, room agent, etc.) without the server having
// to disconnect any of them.
function addAuthSession(userId, socketId) {
  if (!userId || !socketId) return;
  let set = authSessions.get(userId);
  if (!set) { set = new Set(); authSessions.set(userId, set); }
  set.add(socketId);
}
function removeAuthSession(userId, socketId) {
  const set = authSessions.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) authSessions.delete(userId);
}
function getAuthSocketIds(userId) {
  const set = authSessions.get(userId);
  return set ? [...set] : [];
}

// ─────────────────────────────────────────────────────────────────────
// Mode-list filter: only surface modes actually relevant to this tree.
//
// The mode registry returns every registered mode for a big-zone
// (every `tree:*` mode, every `home:*` mode, etc.). Most trees only
// scaffold a handful of extensions — KB/Study/Fitness/etc. register
// their modes globally, but they aren't present in a pure code tree.
// Surfacing them in the dropdown gaslights the user into thinking
// the tree knows what "Study Session" means when it doesn't.
//
// Seed applies the always-safe filters (kernel baseline check,
// extension scope blocks). Richer presence heuristics — routing-index
// scaffolding, classifier vocab detection — live in the tree
// orchestrator extension, wired in via the `filterAvailableModes`
// hook (registered sequentially so each handler refines the list).
// ─────────────────────────────────────────────────────────────────────
async function _filterModesForPresence(modes, { nodeId, rootId, bigMode }) {
  if (!Array.isArray(modes) || modes.length === 0) return modes;

  // Seed-level pass: scope block filter + always keep kernel baseline.
  let filtered = modes;
  if (nodeId) {
    try {
      const { getBlockedExtensionsAtNode } = await import("../tree/extensionScope.js");
      const scope = await getBlockedExtensionsAtNode(nodeId);
      filtered = filtered.filter((m) => {
        const owner = getModeOwner(m.key);
        return !owner || !scope.blocked.has(owner);
      });
    } catch {}
  }

  // Extension-level pass: let subscribers (tree-orchestrator) shrink
  // the list further based on what's actually scaffolded in this
  // tree. Hook payload mutates in place — each handler reassigns
  // payload.modes with its filtered result.
  try {
    const payload = { modes: filtered, nodeId, rootId, bigMode };
    await hooks.run("filterAvailableModes", payload);
    if (Array.isArray(payload.modes)) filtered = payload.modes;
  } catch {}

  return filtered;
}

// ── Socket handler registry (extensions register event handlers) ──────
const _socketHandlers = new Map();

const RESERVED_SOCKET_EVENTS = new Set(["connect", "disconnect", "error", "connecting", "reconnect", "chat", "navigate", "switchMode"]);

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
  if (!sessionId || !socket.userId) return;
  if (socket._registrySessionId === sessionId) return; // no change
  if (socket._registrySessionId) endSession(socket._registrySessionId);
  registerSession({
    sessionId,
    userId: socket.userId,
    type: SESSION_TYPES.WEBSOCKET_CHAT,
    description: `Chat session for ${socket.username || "unknown"}`,
    meta: { visitorId: socket.visitorId },
  });
  socket._registrySessionId = sessionId;
  emitNavigatorStatus(socket);
}

function emitNavigatorStatus(socket) {
  if (!socket.userId) return;
  const navId = getActiveNavigator(socket.userId);
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

const SAFE_CHAT_MODES = new Set(["chat", "place", "query", "be"]);

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
async function resolvePerPositionVisitorId(socket, payload) {
  const { buildUserAiSessionKey } = await import("../llm/sessionKeys.js");
  const handle = (typeof payload.sessionHandle === "string"
    && /^[a-z0-9_-]{1,40}$/i.test(payload.sessionHandle))
    ? payload.sessionHandle
    : null;
  const device = socket.clientKind || "web";
  const fallback = socket.visitorId || `user:${socket.userId}:transport:${device}`;

  if (typeof payload.rootId === "string" && payload.rootId.length > 0 && payload.rootId.length <= 36) {
    return buildUserAiSessionKey({
      userId: socket.userId,
      zone: "tree",
      rootId: payload.rootId,
      device,
      handle,
    });
  }
  if (payload.zone === "home" || payload.zone === "land") {
    return buildUserAiSessionKey({
      userId: socket.userId,
      zone: payload.zone,
      device,
      handle,
    });
  }
  return fallback;
}

// Apply position state writes (setRootId/setCurrentNodeId) and any
// big-mode switchMode side effects implied by the payload. Tree access
// is verified before any state is written when a rootId is supplied.
// Errors are logged at warn level but never thrown — chat falls through
// with whatever state was successfully applied.
async function applyChatPositionFromPayload(visitorId, socket, payload, username) {
  const { rootId, nodeId, zone } = payload;

  if (typeof rootId === "string" && rootId.length > 0 && rootId.length <= 36) {
    let access = null;
    try {
      access = await resolveTreeAccess(rootId, socket.userId);
    } catch (err) {
      log.warn("WS", `resolveTreeAccess errored: ${err.message}`);
      return;
    }
    if (!access?.ok) {
      log.warn("WS", `tree access denied for root ${rootId}: ok=${access?.ok}`);
      return;
    }
    setRootId(visitorId, rootId);
    const resolvedNode = (typeof nodeId === "string" && nodeId.length > 0 && nodeId.length <= 36)
      ? nodeId
      : rootId;
    setCurrentNodeId(visitorId, resolvedNode);
    try {
      const curr = getCurrentMode(visitorId);
      if ((curr?.split(":")[0] || null) !== "tree") {
        await switchMode(visitorId, "tree:converse", {
          username, userId: socket.userId, rootId, currentNodeId: resolvedNode,
        });
        log.info("WS", `🌳 ${visitorId} → tree:converse (was ${curr || "unset"})`);
      }
    } catch (modeErr) {
      log.warn("WS", `tree-mode switch FAILED on ${visitorId}: ${modeErr.message}`);
    }
    return;
  }

  if (typeof nodeId === "string" && nodeId.length > 0 && nodeId.length <= 36) {
    setCurrentNodeId(visitorId, nodeId);
    return;
  }

  if (zone === "home" || zone === "land") {
    setRootId(visitorId, null);
    setCurrentNodeId(visitorId, null);
    const zoneBaseMode = zone === "land" ? "land:manager" : "home:default";
    try {
      const curr = getCurrentMode(visitorId);
      if ((curr?.split(":")[0] || null) !== zone) {
        await switchMode(visitorId, zoneBaseMode, { username, userId: socket.userId });
        log.info("WS", `🏠 ${visitorId} → ${zoneBaseMode} (was ${curr || "unset"})`);
      }
    } catch (err) {
      log.warn("WS", `${zone}-mode switch FAILED on ${visitorId}: ${err.message}`);
    }
  }
}

// Open the in-flight turn: cancel any prior abort on this socket, create
// a new abort controller, register the turn in the cross-socket
// in-flight registry, build the tee-emitter the orchestrator uses to
// fan out streaming events, and stamp the socket fields urlChanged /
// getAvailableModes consult. Symmetric tear-down lives in endChatTurn.
function beginChatTurn(socket, visitorId, bigMode) {
  if (socket._chatAbort) socket._chatAbort.abort();
  const abort = new AbortController();
  socket._chatAbort = abort;

  const inFlightRootId = bigMode === "tree" ? (getRootId(visitorId) || null) : null;
  socket._inFlightStableKey = visitorId;
  socket._inFlightZone = bigMode;
  socket._inFlightRootId = inFlightRootId;

  const inFlightEntry = registerInFlight(visitorId, abort, socket);
  const teeEmit = (event, data) => {
    recordInFlightEvent(visitorId, event, data);
    if (abort.signal.aborted) return;
    // Snapshot the socket set on each emit so a concurrent
    // attach/detach can't mutate during iteration. The set is small
    // (typically 1 socket) so the copy cost is negligible.
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
function endChatTurn(socket, abort, visitorId) {
  if (socket._chatAbort === abort) socket._chatAbort = null;
  clearInFlight(visitorId);
  if (socket._inFlightStableKey === visitorId) {
    socket._inFlightStableKey = null;
    socket._inFlightZone = null;
    socket._inFlightRootId = null;
  }
  try { socket._onStreamTurnEnd?.(); } catch {}
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
  socket.emit(WS.CHAT_ERROR, payload);
}

// Map a chat mode to the orchestrator's source-type tag. Defaults to
// "tree-chat" so an unrecognized mode still routes correctly.
function chatSourceTypeFor(safeChatMode) {
  switch (safeChatMode) {
    case "place": return "ws-tree-place";
    case "query": return "ws-tree-query";
    case "be":    return "ws-tree-be";
    default:      return "tree-chat";
  }
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
    socket.userId = null;

    // 1. Browser path: JWT in the `token` cookie. This is how the website
    //    has always authenticated its socket.
    if (cookie) {
      const tokenMatch = cookie.match(/token=([^;]+)/);
      if (tokenMatch) {
        try {
          const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
          socket.userId = decoded.userId;
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
    if (!socket.userId) {
      const auth = socket.handshake.auth || {};
      if (auth.token) {
        try {
          const decoded = jwt.verify(auth.token, JWT_SECRET);
          socket.userId = decoded.userId;
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
    // subscription id). Together with userId they uniquely identify
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
    const userId = socket.userId;
    log.debug("WS",
      `🔗 Socket connected: ${socket.id} (user: ${userId || "anon"})`,
    );

    // Track auth session. Multiple sockets per user are supported:
    // the set grows, nothing gets disconnected. CLI + browser + mobile
    // all coexist under the same userId.
    if (userId) {
      addAuthSession(userId, socket.id);
    }

    socket.on("ready", () => {
      log.verbose("WS", `App ready: ${userId}`);
    });

    // ── REGISTER ──────────────────────────────────────────────────────
    socket.on("register", async () => {
      const userId = socket.userId;
      const username = socket.username;

      if (!socket.jwt) {
        socket.emit(WS.REGISTERED, { success: false, error: "Unauthorized" });
        return;
      }
      if (!socket.username || !socket.userId) {
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
      // line 374 fires only on exact-match visitorId — a reload in the
      // same tab or a re-exec of the same CLI pid.
      //
      // Shape matches `buildUserAiSessionKey` in seed/llm/sessionKeys.js:
      //   user:${userId}:transport:${clientKind}:${clientInstance}
      // The `transport:` segment distinguishes this tab-level fallback
      // key from the zone-specific user keys (`user:${userId}:${rootId}:${device}`)
      // that every chat builds via buildUserAiSessionKey. This fallback
      // is only reached when the client hasn't yet sent payload context
      // (urlChanged / first chat). It should eventually be deletable.
      const visitorId = `user:${userId}:transport:${socket.clientKind || "web"}:${socket.clientInstance || socket.id.slice(0, 8)}`;
      const oldSocketId = userSockets.get(visitorId);
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }

      userSockets.set(visitorId, socket.id);
      socket.visitorId = visitorId;
      socket.username = username;

      // Initialize AI session for this connection
      ensureSession(socket);
      syncRegistrySession(socket);

      try {
        // Create internal JWT with visitorId so MCP can route contribution context
        const mcpJwt = jwt.sign(
          { userId: String(userId), username, visitorId },
          JWT_SECRET,
          { expiresIn: "24h" },
        );
        await connectToMCP(MCP_SERVER_URL, visitorId, mcpJwt);
        socket.emit(WS.REGISTERED, { success: true, visitorId });
      } catch (err) {
        log.error("WS",
          `❌ MCP connection failed for ${visitorId}:`,
          err.message,
        );
        socket.emit(WS.REGISTERED, { success: false, error: err.message });
      }

      logStats();
    });

    // ── MODE SWITCHING ────────────────────────────────────────────────

    /**
     * Manual mode switch from UI mode bar.
     * Payload: { modeKey: "tree:build" }
     */
    socket.on("switchMode", async ({ modeKey }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      // Finalize any in-flight chat before switching
      await finalizeOpenChat(socket);

      try {
        const result = await switchMode(visitorId, modeKey, {
          username: socket.username,
          userId: socket.userId,
          rootId: getRootId(visitorId),
        });
        socket.emit(WS.MODE_SWITCHED, result);
      } catch (err) {
        // switchMode failures are user-facing config issues (unknown
        // mode key, missing extension, etc.) — surface as INVALID_INPUT
        // so consumers can group them with other client-side errors.
        emitChatError(socket, ERR.INVALID_INPUT, err.message, undefined);
      }
    });

    /**
     * URL-based big mode detection from frontend.
     * Frontend sends this when the iframe URL changes.
     * Payload: { url: "/root/abc123", rootId?: "abc123" }
     */
    socket.on("urlChanged", async ({ url, rootId, nodeId } = {}) => {
      if (!socket.visitorId) return;
      // Cap URL to prevent multi-MB payloads flowing through mode detection and session meta
      if (typeof url === "string" && url.length > 2000) url = url.slice(0, 2000);
      if (rootId && (typeof rootId !== "string" || rootId.length > 36)) rootId = null;
      if (nodeId && (typeof nodeId !== "string" || nodeId.length > 36)) nodeId = null;

      const newBigMode = bigModeFromUrl(url);

      // Compute the chat-relevant ai-chat session key for the destination.
      // This matches what the chat handler will build from payload context,
      // so state we set here (rootId, currentNodeId, mode) is the state the
      // next chat reads, and switchBigMode clears the right session.
      // Without this, urlChanged operates on socket.visitorId (tab-level)
      // while chat operates on the per-zone key — a mode switch clears the
      // wrong session and the next chat in the new zone inherits old history.
      const { buildUserAiSessionKey } = await import("../llm/sessionKeys.js");
      const _device = socket.clientKind || "web";
      let visitorId;
      if (newBigMode === BIG_MODES.TREE && rootId) {
        visitorId = buildUserAiSessionKey({
          userId: socket.userId, zone: "tree", rootId, device: _device,
        });
      } else if (newBigMode === BIG_MODES.HOME || newBigMode === BIG_MODES.LAND) {
        visitorId = buildUserAiSessionKey({
          userId: socket.userId, zone: newBigMode, device: _device,
        });
      } else {
        // Unknown/transitional URL — keep the old fallback.
        visitorId = socket.visitorId;
      }

      const currentMode = getCurrentMode(visitorId);
      const currentBig = currentMode?.split(":")[0] || null;

      // Detect zone transition at the SOCKET level. Under the per-zone
      // session keying model, `currentBig` reads off the destination key —
      // returning to a previously-visited zone would see its own prior
      // mode still set and `shouldSwitch` would be false, leaving stale
      // history in place. Tracking the socket's last big mode forces the
      // reset on any tab-level navigation between zones, matching the
      // old single-visitor behavior.
      const prevSocketBig = socket._lastBigMode || currentBig || null;
      const socketZoneTransition = !!newBigMode && prevSocketBig !== newBigMode;

      // Validate tree access before accepting rootId/nodeId from the client.
      // Without this, a crafted WebSocket message could point the AI at another user's tree.
      // Only check for tree navigation (not home/land which have no tree context).
      const targetId = rootId || nodeId;
      if (targetId && socket.userId && newBigMode === BIG_MODES.TREE) {
        try {
          const access = await resolveTreeAccess(targetId, socket.userId);
          if (!access.ok || !access.canWrite) {
            log.warn("WS", `Access denied: ${socket.userId} tried to navigate to ${targetId}`);
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
        setRootId(visitorId, rootId);
        setCurrentNodeId(visitorId, rootId); // root is also current node
        if (socket.userId) {
          hooks.run("afterNavigate", { userId: socket.userId, rootId, nodeId: rootId, socket }).catch(() => {});
        }
      } else if (nodeId) {
        // Viewing a non-root node — update currentNodeId only
        setCurrentNodeId(visitorId, nodeId);
        // Only set rootId if we don't have one yet (first load via /node/ URL)
        if (!getRootId(visitorId)) {
          setRootId(visitorId, nodeId);
        }
        // In-tree navigation hook (distinct from afterNavigate which fires on root load)
        if (socket.userId) {
          hooks.run("onNodeNavigate", { userId: socket.userId, rootId: getRootId(visitorId), nodeId, socket }).catch(() => {});
        }
      }

      // Update session registry meta for dashboard tracking
      if (socket._registrySessionId) {
        updateSessionMeta(socket._registrySessionId, {
          rootId: rootId || getRootId(visitorId) || null,
          nodeId: nodeId || rootId || getCurrentNodeId(visitorId) || null,
        });
      }

      // Clear both when going home
      if (newBigMode === BIG_MODES.HOME) {
        setRootId(visitorId, null);
        setCurrentNodeId(visitorId, null);
        clearMemory(visitorId);
      }

      // Switch if big mode changed at the destination key OR the socket
      // just crossed a zone boundary (see socketZoneTransition above).
      // Only switch to HOME if the URL explicitly matches /user/ routes —
      // don't let bad/invalid tool URLs (which fall through to HOME default)
      // kill an active tree session.
      const isExplicitHome = /^(\/api\/v1)?\/user\//.test(
        (url || "").split("?")[0],
      );
      const shouldSwitch = socketZoneTransition || currentBig !== newBigMode || !currentMode;

      // Abort decoupled from mode-switch. The chat dies only when the
      // user has truly left the chat's home: zone changed (tree →
      // home/land) or rootId differs (tree A → tree B). Within-tree
      // node nav lands here with rootId=null (frontend doesn't always
      // know the rootId for a /node/ URL), so a missing rootId is
      // treated as "stay" not "abort". Transitional URLs with null
      // newBigMode are ignored.
      const shouldAbort = !!newBigMode
        && socket._inFlightZone
        && (
          newBigMode !== socket._inFlightZone
          || (newBigMode === BIG_MODES.TREE && rootId && socket._inFlightRootId && rootId !== socket._inFlightRootId)
        );

      if (
        shouldSwitch &&
        (newBigMode !== BIG_MODES.HOME || isExplicitHome || !currentMode)
      ) {
        // Finalize any in-flight chat
        await finalizeOpenChat(socket);

        if (shouldAbort && socket._chatAbort) {
          socket._chatAbort.abort();
          socket._chatAbort = null;
        }

        // Rotate session when returning to home
        if (newBigMode === BIG_MODES.HOME) {
          rotateSession(socket);
          syncRegistrySession(socket);
        }

        try {
          const result = await switchBigMode(visitorId, newBigMode, {
            username: socket.username,
            userId: socket.userId,
            rootId: getRootId(visitorId),
          });
          socket.emit(WS.MODE_SWITCHED, { ...result, carriedMessages: [] });
        } catch (err) {
          log.error("WS", `Big mode switch failed:`, err.message);
        }
      }

      // Remember the zone the socket is currently in, so the next
      // urlChanged can detect a boundary crossing at the tab level.
      if (newBigMode) socket._lastBigMode = newBigMode;

      // Look up root name for tree modes
      const activeRootId = getRootId(visitorId);
      let rootName = null;
      if (newBigMode === BIG_MODES.TREE && activeRootId) {
        try {
          rootName = await getNodeName(activeRootId);
        } catch {}
      }


      // Always send available modes so frontend stays in sync
      const activeMode = getCurrentMode(visitorId);
      const bigMode = activeMode?.split(":")[0] || newBigMode;
      let subModes = getSubModes(bigMode);

      const activeNodeId = getCurrentNodeId(visitorId) || activeRootId;
      subModes = await _filterModesForPresence(subModes, {
        nodeId: activeNodeId,
        rootId: activeRootId,
        bigMode,
      });

      socket.emit(WS.AVAILABLE_MODES, {
        bigMode,
        modes: subModes,
        currentMode: activeMode,
        rootName,
        rootId: activeRootId,
      });
    });

    /**
     * Request available modes for current big mode (e.g., on page load).
     */
    socket.on("getAvailableModes", async ({ url } = {}) => {
      if (!socket.visitorId) return;

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
      let visitorId;
      if (urlBigMode === BIG_MODES.TREE && urlRootId) {
        visitorId = buildUserAiSessionKey({
          userId: socket.userId, zone: "tree", rootId: urlRootId, device: _device,
        });
      } else if (urlBigMode === BIG_MODES.HOME || urlBigMode === BIG_MODES.LAND) {
        visitorId = buildUserAiSessionKey({
          userId: socket.userId, zone: urlBigMode, device: _device,
        });
      } else {
        visitorId = socket.visitorId;
      }

      let currentMode = getCurrentMode(visitorId);
      const currentBig = currentMode?.split(":")[0] || null;

      if (url) {
        if (urlRootId) {
          setRootId(visitorId, urlRootId);
        }
        if (urlBigMode === BIG_MODES.HOME) {
          setRootId(visitorId, null);
        }
      }

      // Same zone-transition detector as urlChanged (see above). Without
      // this the destination key's own prior mode would make the switch
      // look unnecessary and old history would resume on re-entry.
      const prevSocketBig = socket._lastBigMode || currentBig || null;
      const socketZoneTransition = !!urlBigMode && prevSocketBig !== urlBigMode;

      // Re-attach to an in-flight chat for this URL's stable key (refresh
      // path). When a browser refresh lands here with a tree URL whose
      // chat is still running on the server, bind the new socket to the
      // existing entry, replay the buffered tail so the user sees the
      // running log, and share the abort controller so the Stop button
      // still works through the freshly mounted page.
      const inFlightForKey = getInFlight(visitorId);
      if (inFlightForKey) {
        attachInFlight(visitorId, socket);
        socket._inFlightStableKey = visitorId;
        socket._inFlightZone = urlBigMode || null;
        socket._inFlightRootId = (urlBigMode === BIG_MODES.TREE) ? (urlRootId || null) : null;
        socket._chatAbort = inFlightForKey.abort;
        for (const ev of inFlightForKey.buffer) {
          try { socket.emit(ev.event, ev.data); } catch {}
        }
      }

      // Abort decoupled from mode-switch (same logic as urlChanged):
      // compare zone + rootId structurally instead of relying on
      // visitorId-string equality. Within-tree node nav lands here
      // with urlRootId=null, which under string compare would falsely
      // abort. Treating missing rootId as "stay" keeps the chat alive.
      const shouldAbort = !!urlBigMode
        && socket._inFlightZone
        && (
          urlBigMode !== socket._inFlightZone
          || (urlBigMode === BIG_MODES.TREE && urlRootId && socket._inFlightRootId && urlRootId !== socket._inFlightRootId)
        );

      // If no mode, big mode doesn't match URL, or socket crossed a zone boundary → switch
      if (!currentMode || (urlBigMode && currentBig !== urlBigMode) || socketZoneTransition) {
        // Finalize any in-flight chat
        await finalizeOpenChat(socket);

        if (shouldAbort && socket._chatAbort) {
          socket._chatAbort.abort();
          socket._chatAbort = null;
        }

        // Rotate session when landing on home
        if (urlBigMode === BIG_MODES.HOME || !urlBigMode) {
          rotateSession(socket);
          syncRegistrySession(socket);
        }

        try {
          const targetBigMode = urlBigMode || BIG_MODES.HOME;
          const result = await switchBigMode(visitorId, targetBigMode, {
            username: socket.username,
            userId: socket.userId,
            rootId: getRootId(visitorId),
          });
          currentMode = result.modeKey;
          socket.emit(WS.MODE_SWITCHED, { ...result, carriedMessages: [] });
        } catch (err) {
          log.error("WS", "Failed to initialize/correct mode:", err.message);
        }
      }

      // Track the socket's current zone for boundary detection on future events.
      if (urlBigMode) socket._lastBigMode = urlBigMode;

      const bigMode = currentMode?.split(":")[0] || BIG_MODES.HOME;
      let subModes = getSubModes(bigMode);

      const activeRootId = getRootId(visitorId);
      let rootName = null;
      if (bigMode === BIG_MODES.TREE && activeRootId) {
        try {
          rootName = await getNodeName(activeRootId);
        } catch {}
      }

      const activeNodeId2 = getCurrentNodeId(visitorId) || activeRootId;
      subModes = await _filterModesForPresence(subModes, {
        nodeId: activeNodeId2,
        rootId: activeRootId,
        bigMode,
      });

      socket.emit(WS.AVAILABLE_MODES, {
        bigMode,
        modes: subModes,
        currentMode,
        rootName,
        rootId: activeRootId,
      });
    });

    // ── CHAT ──────────────────────────────────────────────────────────

    /** Check if user has LLM access (own connection or tree owner's). */
    async function checkLlmAccess(userId, visitorId) {
      if (await userHasLlm(userId)) return true;
      const activeRootId = getRootId(visitorId);
      if (!activeRootId) return false;
      const rootNode = await Node.findById(activeRootId).select("rootOwner llmDefault").lean();
      return rootNode
        && rootNode.rootOwner.toString() !== userId.toString()
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
    //   3. Resolve the per-position visitor id (`visitorId` below).
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
      const visitorId = await resolvePerPositionVisitorId(socket, {
        rootId: payloadRootId,
        zone: payloadZone,
        sessionHandle: payloadHandle,
      });

      // 4. Apply position state writes + switchMode side effects. Tree
      //    access is verified before any writes when a rootId is given.
      await applyChatPositionFromPayload(visitorId, socket, {
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

      // 6. Effective-context log. Shows what state the orchestrator will
      //    actually run with — a mix of payload values and socket
      //    session state pinned by prior navigate events.
      const effRoot = payloadRootId || getRootId(visitorId) || null;
      const effNode = payloadNodeId || getCurrentNodeId(visitorId) || null;
      const effMode = getCurrentMode(visitorId) || null;
      const effZone = payloadZone || (effMode?.split(":")[0]) || null;
      const handleTag = (typeof payloadHandle === "string" && /^[a-z0-9_-]{1,40}$/i.test(payloadHandle))
        ? payloadHandle
        : "-";
      const msgSnippet = message.length > 48 ? message.slice(0, 48) + "…" : message;
      log.info(
        "WS",
        `📨 chat: vid=${visitorId} root=${effRoot?.slice?.(0, 8) || "-"} node=${effNode?.slice?.(0, 8) || "-"} zone=${effZone || "-"} mode=${effMode || "-"} handle=${handleTag} gen=${generation ?? "-"} · ${JSON.stringify(msgSnippet)}`,
      );

      // 7. LLM access gate.
      try {
        if (!(await checkLlmAccess(socket.userId, visitorId))) {
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

      // 8. Stream extension routing. Two modes:
      //    in-flight (processing) → merge into the running turn,
      //    idle → debounce callback may swallow the message.
      if (socket._onStreamMessage) {
        if (socket._chatAbort) {
          log.info("WS",
            `↺ chat merged into running turn: vid=${visitorId} gen=${generation ?? "-"} · ${JSON.stringify(msgSnippet)}`);
          socket._onStreamMessage(message, safeChatMode, generation);
          return;
        }
        if (socket._onStreamIdle) {
          const handled = socket._onStreamIdle(message, safeChatMode, generation, {
            rootId: payloadRootId,
            currentNodeId: payloadNodeId,
            zone: payloadZone,
            sessionHandle: payloadHandle,
          });
          if (handled) return;
        }
      }

      // 9. Serialize per visitorId. Previous message must finish first.
      await enqueue(visitorId, async () => {
        // Resolve bigMode once at the top of the turn. Used by both
        // beginChatTurn (in-flight registry zone stamp) and the
        // orchestrator (zone arg). getCurrentMode is a session-keyed
        // read that returns undefined for fresh sessions; "home" is
        // the safe default for the unset case.
        const bigMode = (getCurrentMode(visitorId)?.split(":")[0]) || "home";
        const { abort, teeEmit } = beginChatTurn(socket, visitorId, bigMode);

        // Finalize any leftover chat from a prior interrupted message.
        await finalizeOpenChat(socket);

        // Persistent session + chat-record context.
        ensureSession(socket);
        syncRegistrySession(socket);
        const sessionId = socket._registrySessionId;

        try {
          const { runOrchestration } = await import("../llm/conversation.js");
          const result = await runOrchestration({
            zone: bigMode,
            userId: socket.userId,
            username,
            message,
            rootId: getRootId(visitorId),
            currentNodeId: getCurrentNodeId(visitorId),
            device: socket.clientKind || "web",
            handle: payloadHandle || null,
            aiSessionKey: visitorId,
            sessionId,
            socket,
            signal: abort.signal,
            chatSource: "user",
            sourceType: chatSourceTypeFor(safeChatMode),
            orchestrateFlags: {
              skipRespond: safeChatMode === "place",
              forceQueryOnly: safeChatMode === "query",
              behavioral: safeChatMode === "be",
            },
            onChatCreated: (chat) => {
              setActiveChat(socket, chat._id, chat.startMessage.time);
            },
            onToolResults: (results) => {
              for (const r of results) teeEmit(WS.TOOL_RESULT, r);
            },
            onToolCalled: (call) => { teeEmit(WS.TOOL_CALLED, call); },
            onThinking:   (thought) => { teeEmit(WS.THINKING,    thought); },
            onToolLoopCheckpoint: socket._streamCheckpoint || null,
          });

          if (abort.signal.aborted) {
            clearActiveChat(socket);
            return;
          }

          if (safeChatMode === "place") {
            teeEmit(WS.PLACE_RESULT, {
              success: result.success,
              stepSummaries: result.stepSummaries || [],
              targetPath: result.lastTargetPath || null,
              generation,
            });
          } else {
            teeEmit(WS.CHAT_RESPONSE, {
              success: result.success,
              answer: result.answer,
              generation,
              targetNodeId: result.targetNodeId || null,
            });
          }

          // runOrchestration finalized the Chat record. Clear the
          // socket-level marker so finalizeOpenChat doesn't re-finalize.
          clearActiveChat(socket);
          clearChatContext(socket.visitorId);
        } catch (err) {
          if (abort.signal.aborted) {
            clearActiveChat(socket);
            clearChatContext(socket.visitorId);
            return;
          }
          log.error("WS", `Chat error: ${err.message}`);
          // Route through teeEmit so the error replays to any
          // reconnecting client too (the in-flight ring buffer keeps
          // it). Same {code, error, generation} shape as emitChatError.
          // Choose code by the error name when the orchestrator stamps
          // one; default to INTERNAL.
          const errCode = (err && typeof err.errCode === "string" && err.errCode)
            || (err && err.name === "AbortError" ? ERR.HOOK_CANCELLED : ERR.INTERNAL);
          teeEmit(WS.CHAT_ERROR, { code: errCode, error: err.message, generation });
          clearActiveChat(socket);
          clearChatContext(socket.visitorId);
        } finally {
          endChatTurn(socket, abort, visitorId);
        }
      });
    };
    socket.on("chat", _chatHandler);
    socket._chatHandler = _chatHandler;

    // ── CANCEL REQUEST ────────────────────────────────────────────────
    socket.on("cancelRequest", () => {
      if (socket._chatAbort) {
        log.debug("WS", `Cancel request: ${socket.visitorId}`);
        socket._chatAbort.abort();
        socket._chatAbort = null;
      }
      // Fire `request:cancelled` so extensions that own background
      // spawn-and-await chains (governing's planner/contractor/
      // dispatch, etc.) can drain their per-user abort registries.
      // The kernel can't import extension state directly (seed never
      // reaches into extensions); the hook is the contracted surface.
      const userIdForCancel = socket.visitorId || socket.userId;
      if (userIdForCancel) {
        try {
          hooks.run("request:cancelled", {
            userId: String(userIdForCancel),
            visitorId: socket.visitorId || null,
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
      const visitorId = socket.visitorId;
      if (!visitorId || !rootId || typeof rootId !== "string") return;
      // Basic format check: must look like a UUID or ObjectId
      if (rootId.length > 36) return;
      setRootId(visitorId, rootId);
      log.debug("WS", `Set root: ${visitorId}: ${rootId}`);
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
      const visitorId = socket.visitorId;
      if (!visitorId || !nodeId) return;
      const changesStr = typeof changes === "object" ? JSON.stringify(changes).slice(0, 500) : safeStr(changes, 500);
      injectContext(visitorId, `[Frontend Update] User modified node ${safeStr(nodeId)}. Changes: ${changesStr}`);
    });

    socket.on("nodeNavigated", ({ nodeId, nodeName } = {}) => {
      const visitorId = socket.visitorId;
      if (!visitorId || !nodeId) return;
      injectContext(visitorId, `[Frontend Navigation] User navigated to node "${safeStr(nodeName)}" (${safeStr(nodeId)}).`);
    });

    socket.on("nodeSelected", ({ nodeId, nodeName } = {}) => {
      const visitorId = socket.visitorId;
      if (!visitorId || !nodeId) return;
      injectContext(visitorId, `[Frontend Selection] User is now focusing on node "${safeStr(nodeName)}" (${safeStr(nodeId)}).`);
    });

    socket.on("nodeCreated", ({ nodeId, nodeName, parentId } = {}) => {
      const visitorId = socket.visitorId;
      if (!visitorId || !nodeId) return;
      injectContext(visitorId, `[Frontend Action] User created node "${safeStr(nodeName)}" (${safeStr(nodeId)}) under ${safeStr(parentId)}.`);
    });

    socket.on("nodeDeleted", ({ nodeId, nodeName } = {}) => {
      const visitorId = socket.visitorId;
      if (!visitorId || !nodeId) return;
      injectContext(visitorId, `[Frontend Action] User deleted node "${safeStr(nodeName)}" (${safeStr(nodeId)}).`);
    });

    socket.on("noteCreated", ({ nodeId, noteContent } = {}) => {
      const visitorId = socket.visitorId;
      if (!visitorId || !nodeId) return;
      const preview = safeStr(noteContent, 100);
      injectContext(visitorId, `[Frontend Action] User added note to node ${safeStr(nodeId)}: "${preview}${noteContent?.length > 100 ? "..." : ""}"`);
    });

    // ── NAVIGATOR CONTROL ──────────────────────────────────────────────
    socket.on("detachNavigator", () => {
      if (socket.userId) {
        clearActiveNavigator(socket.userId);
        emitNavigatorStatus(socket);
      }
    });

    socket.on("attachNavigator", ({ sessionId }) => {
      if (!socket.userId || !sessionId) return;
      setActiveNavigator(socket.userId, sessionId);
      emitNavigatorStatus(socket);
    });

    // ── STOP SESSION ──────────────────────────────────────────────────
    socket.on("stopSession", ({ sessionId }) => {
      if (!socket.userId || !sessionId) return;
      const session = getSession(sessionId);
      if (!session || session.userId !== String(socket.userId)) return;
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
        // Tell the client UI to reset sending state
        socket.emit(WS.CHAT_CANCELLED);
      }
    });

    // ── EXTENSION SOCKET HANDLERS ────────────────────────────────────
    for (const [event, handler] of _socketHandlers) {
      socket.on(event, async (data) => {
        try {
          await handler({ socket, userId: socket.userId, visitorId: socket.visitorId, data });
        } catch (err) {
          log.error("WS", `Socket handler "${event}" error:`, err.message);
        }
      });
    }

    // ── CLEAR / DISCONNECT ────────────────────────────────────────────
    socket.on("clearConversation", async () => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        // Finalize any in-flight chat
        await finalizeOpenChat(socket);

        await resetConversation(visitorId, {
          username: socket.username,
          userId: socket.userId,
        });

        rotateSession(socket);
        syncRegistrySession(socket);

        socket.emit(WS.CONVERSATION_CLEARED, { success: true });
      }
      clearMemory(socket.visitorId);
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
      // still running. finalizeOpenChat writes `stopped: true` to the
      // Chat record, which mis-labels a chat we left running on
      // purpose. When the chat completes naturally, runOrchestration
      // finalizes the record itself.
      if (!hadInFlight) {
        await finalizeOpenChat(socket);
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

      if (userId) {
        removeAuthSession(userId, socket.id);
      }

      if (socket.visitorId) {
        const visitorId = socket.visitorId;
        if (userSockets.get(visitorId) === socket.id) {
          userSockets.delete(visitorId);
          closeMCPClient(visitorId).catch((err) =>
            log.error("WS",
              `❌ MCP cleanup failed for ${visitorId}:`,
              err.message,
            ),
          );
          clearSession(visitorId);
        }
      }

      logStats();
    });
  });

  // Subscribe to session changes → sync navigator badge on every
  // active socket for this user (web tabs, CLIs, etc. all get the
  // refresh so the navigator indicator stays consistent).
  function syncNavigatorOnSessionChange({ userId }) {
    for (const socketId of getAuthSocketIds(userId)) {
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

export function emitToVisitor(visitorId, event, data) {
  if (!io) return;
  const socketId = userSockets.get(visitorId);
  if (socketId) io.to(socketId).emit(event, data);
}

export function emitNavigate({
  userId,
  url,
  replace = false,
  sessionId = null,
}) {
  if (!io) return;

  // If sessionId provided, only allow if this session is the active navigator
  if (sessionId && !canNavigate(sessionId)) {
    log.debug("WS",
      `🚫 Nav blocked: session ${sessionId.slice(0, 8)} is not active navigator for user ${userId}`,
    );
    return;
  }

  // Fan out to every active socket for this user (web tab, CLI, …).
  // Each client chooses whether to react to the navigate event — the
  // CLI currently ignores it, the browser follows it.
  const socketIds = getAuthSocketIds(userId);
  if (socketIds.length === 0) return;
  for (const socketId of socketIds) {
    io.to(socketId).emit(WS.NAVIGATE, { url, replace });
  }
  log.debug("WS",
    `📍 Navigated user ${userId} to ${url} (session: ${sessionId ? sessionId.slice(0, 8) : "ungated"}, fanout: ${socketIds.length})`,
  );
}

export function emitReload({ userId }) {
  if (!io) return;
  for (const socketId of getAuthSocketIds(userId)) {
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

export function emitToUser(userId, event, data) {
  if (!io) return;
  for (const socketId of getAuthSocketIds(userId)) {
    io.to(socketId).emit(event, data);
  }
}

export function isUserOnline(userId) {
  const set = authSessions.get(String(userId));
  return !!(set && set.size > 0);
}

export function notifyTreeChange({ userId, nodeId, changeType, details }) {
  if (!io) return;
  for (const socketId of getAuthSocketIds(userId)) {
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
