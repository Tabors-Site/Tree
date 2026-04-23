// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// ws/websocket.js
// WebSocket server - handles socket events, delegates to conversation manager

import log from "../log.js";
import { WS } from "../protocol.js";
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
// WEBSOCKET SERVER
// ============================================================================

export function initWebSocketServer(httpServer, allowedOrigins) {
  // Register transport-layer session types before any connections arrive
  registerSessionType("WEBSOCKET_CHAT", "websocket-chat");

  _httpServerRef = httpServer;

  io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        // Allow configured origins, Chrome extensions, and null origin (same-origin)
        if (!origin || (allowedOrigins && allowedOrigins.includes(origin)) || origin?.startsWith("chrome-extension://")) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
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

      // Per-connection visitorId. `client:instance` uniquely
      // identifies this socket within the user, so separate tabs /
      // CLI shells / room-agent dispatches each get their own
      // isolated session, MCP connection, and chat memory.
      // Dedupe still fires — but ONLY on exact-match visitorId, i.e.
      // a reload in the same tab or a re-exec of the same CLI pid.
      const visitorId = `user:${username}:${socket.clientKind || "web"}:${socket.clientInstance || socket.id.slice(0, 8)}`;
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
        socket.emit(WS.CHAT_ERROR, { error: err.message });
      }
    });

    /**
     * URL-based big mode detection from frontend.
     * Frontend sends this when the iframe URL changes.
     * Payload: { url: "/root/abc123", rootId?: "abc123" }
     */
    socket.on("urlChanged", async ({ url, rootId, nodeId } = {}) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;
      // Cap URL to prevent multi-MB payloads flowing through mode detection and session meta
      if (typeof url === "string" && url.length > 2000) url = url.slice(0, 2000);
      if (rootId && (typeof rootId !== "string" || rootId.length > 36)) rootId = null;
      if (nodeId && (typeof nodeId !== "string" || nodeId.length > 36)) nodeId = null;

      const newBigMode = bigModeFromUrl(url);
      const currentMode = getCurrentMode(visitorId);
      const currentBig = currentMode?.split(":")[0] || null;

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

      // Switch if big mode changed or no mode set yet
      // Only switch to HOME if the URL explicitly matches /user/ routes —
      // don't let bad/invalid tool URLs (which fall through to HOME default)
      // kill an active tree session.
      const isExplicitHome = /^(\/api\/v1)?\/user\//.test(
        (url || "").split("?")[0],
      );
      const shouldSwitch = currentBig !== newBigMode || !currentMode;
      if (
        shouldSwitch &&
        (newBigMode !== BIG_MODES.HOME || isExplicitHome || !currentMode)
      ) {
        // Finalize any in-flight chat
        await finalizeOpenChat(socket);

        // Abort any in-flight LLM request
        if (socket._chatAbort) {
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
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      let currentMode = getCurrentMode(visitorId);

      const urlBigMode = url ? bigModeFromUrl(url) : null;
      const currentBig = currentMode?.split(":")[0] || null;

      // Extract rootId from URL
      if (url) {
        const ID =
          "(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";
        const rootMatch = url.match(
          new RegExp(`(?:/api/v1)?/root/(${ID})`, "i"),
        );
        const bareMatch = url.match(
          new RegExp(`(?:/api/v1)?/(${ID})(?:[?/]|$)`, "i"),
        );
        if (rootMatch?.[1]) {
          setRootId(visitorId, rootMatch[1]);
        } else if (
          bareMatch?.[1] &&
          (currentBig !== urlBigMode || !getRootId(visitorId))
        ) {
          setRootId(visitorId, bareMatch[1]);
        }
        if (urlBigMode === BIG_MODES.HOME) {
          setRootId(visitorId, null);
        }
      }

      // If no mode, or big mode doesn't match URL → switch to correct big mode
      if (!currentMode || (urlBigMode && currentBig !== urlBigMode)) {
        // Finalize any in-flight chat
        await finalizeOpenChat(socket);

        if (socket._chatAbort) {
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

    // Named handler so extensions can call socket._chatHandler() for debounce
    const _chatHandler = async ({ message, username, generation, mode: chatMode, rootId: payloadRootId, currentNodeId: payloadNodeId, zone: payloadZone, sessionHandle: payloadHandle }) => {
      if (!message || typeof message !== "string" || !username || typeof username !== "string" || username.length > 200) {
        return socket.emit(WS.CHAT_ERROR, { error: "Missing or invalid message", generation });
      }

      // Snapshot the incoming payload context on the socket so the stream
      // extension's turn-end follow-up replay can reuse it (the CLI sends
      // rootId/nodeId/zone/handle on every chat; the browser uses socket
      // session state so this becomes a shallow copy without meaningful
      // fields — either way the replay path just spreads whatever's here
      // and falls through to the socket-state lookup for anything null).
      socket._lastChatCtx = {
        rootId: payloadRootId || null,
        currentNodeId: payloadNodeId || null,
        zone: payloadZone || null,
        sessionHandle: payloadHandle || null,
      };

      // Full context log lives AFTER state resolution (see "📨 chat"
      // further down). A bare arrival log here would show dashes for the
      // dashboard path because the browser never includes payload
      // context — it relies on the socket's persistent session state set
      // by navigate/switchMode. Logging payload values alone made it look
      // like context was missing when the socket actually had it.

      // Position override from the payload. The CLI is authoritative
      // about where the user is — a server restart wipes session
      // state, and without this override the orchestrator would fall
      // back to "home" zone for every first message after reboot. We
      // still validate tree access before trusting the IDs, and we
      // also flip bigMode to "tree" so the zone lookup at line ~667
      // (`currentMode?.split(":")[0] || "home"`) routes correctly.
      //
      // Per-position visitorId. Same scheme the HTTP path builds in
      // `runOrchestration` (see llm/conversation.js line ~2370):
      //
      //   tree,  no handle  → `${rootId}:${userId}`
      //   tree,  handle     → `${rootId}:${userId}:${handle}`
      //   home/land, no h   → `${zone}:${userId}`
      //   home/land, handle → `${zone}:${userId}:${handle}`
      //
      // This is load-bearing: without it, every CLI chat shares the
      // socket-level `user:${username}` visitorId, so switching roots
      // (cd /other-tree) inherits the previous tree's conversation
      // memory + mode + position. The HTTP path always gave per-tree
      // isolation; now WS matches.
      //
      // When no payload context is present (e.g. a browser socket
      // that still uses urlChanged for navigation), we fall back to
      // the socket-level visitorId so the existing website behavior
      // is preserved.
      const _handle = (payloadHandle && typeof payloadHandle === "string" && /^[a-z0-9_-]{1,40}$/i.test(payloadHandle))
        ? payloadHandle
        : null;
      let _pvId = socket.visitorId || `user:${socket.userId}`;
      if (payloadRootId && typeof payloadRootId === "string" && payloadRootId.length <= 36) {
        _pvId = _handle
          ? `${payloadRootId}:${socket.userId}:${_handle}`
          : `${payloadRootId}:${socket.userId}`;
      } else if (payloadZone === "home" || payloadZone === "land") {
        _pvId = _handle
          ? `${payloadZone}:${socket.userId}:${_handle}`
          : `${payloadZone}:${socket.userId}`;
      }
      if (payloadRootId && typeof payloadRootId === "string" && payloadRootId.length <= 36) {
        try {
          const access = await resolveTreeAccess(payloadRootId, socket.userId);
          if (access?.ok) {
            setRootId(_pvId, payloadRootId);
            const nId = payloadNodeId && typeof payloadNodeId === "string" && payloadNodeId.length <= 36
              ? payloadNodeId
              : payloadRootId;
            setCurrentNodeId(_pvId, nId);
            // Ensure the session is in tree mode. Without this the
            // chat handler below still sees `home:default` (or
            // whatever stuck from the prior message) and routes to
            // the home orchestrator. Use the base "tree:chat" mode;
            // the tree orchestrator classifier takes over from there.
            try {
              const curr = getCurrentMode(_pvId);
              const currBig = curr?.split(":")[0] || null;
              if (currBig !== "tree") {
                await switchMode(_pvId, "tree:converse", {
                  username, userId: socket.userId, rootId: payloadRootId,
                  currentNodeId: nId,
                });
                log.info("WS", `🌳 ${_pvId} → tree:converse (was ${curr || "unset"})`);
              }
            } catch (modeErr) {
              log.warn("WS", `tree-mode switch FAILED on ${_pvId}: ${modeErr.message}`);
            }
          } else {
            log.warn("WS", `tree access denied for root ${payloadRootId}: ok=${access?.ok}`);
          }
        } catch (e) {
          log.warn("WS", `resolveTreeAccess errored: ${e.message}`);
        }
      } else if (payloadNodeId && typeof payloadNodeId === "string" && payloadNodeId.length <= 36) {
        // Node-only update (same tree, different position).
        setCurrentNodeId(_pvId, payloadNodeId);
      } else if (payloadZone === "home" || payloadZone === "land") {
        // Non-tree zones: the CLI tells us which one. Clear any
        // stale tree position from a previous message and force the
        // matching big-mode so the chat handler below routes to the
        // right orchestrator. Zone → mode: home uses `home:default`
        // (treeos-base), land uses `land:manager` (land-manager). The
        // orchestrator treats the mode's zone prefix as the routing
        // key, so both entries land in the right orchestrator.
        setRootId(_pvId, null);
        setCurrentNodeId(_pvId, null);
        const zoneBaseMode = payloadZone === "land" ? "land:manager" : "home:default";
        try {
          const curr = getCurrentMode(_pvId);
          const currBig = curr?.split(":")[0] || null;
          if (currBig !== payloadZone) {
            await switchMode(_pvId, zoneBaseMode, {
              username, userId: socket.userId,
            });
            log.info("WS", `🏠 ${_pvId} → ${zoneBaseMode} (was ${curr || "unset"})`);
          }
        } catch (modeErr) {
          log.warn("WS", `${payloadZone}-mode switch FAILED on ${_pvId}: ${modeErr.message}`);
        }
      }
      const maxChatChars = Number(getLandConfigValue("maxChatMessageChars")) || 5000;
      if (message.length > maxChatChars) {
        return socket.emit(WS.CHAT_ERROR, { error: `Message must be under ${maxChatChars} characters.`, generation });
      }

      // Rate limit: sliding window per socket
      const now = Date.now();
      while (_chatTimestamps.length > 0 && _chatTimestamps[0] <= now - CHAT_RATE_WINDOW_MS) {
        _chatTimestamps.shift();
      }
      if (_chatTimestamps.length >= CHAT_RATE_LIMIT) {
        return socket.emit(WS.CHAT_ERROR, { error: "Too many messages. Please wait before sending another.", generation });
      }
      _chatTimestamps.push(now);

      const safeChatMode = ["chat", "place", "query", "be"].includes(chatMode) ? chatMode : "chat";
      // `_pvId` was computed above from the session-handle scheme.
      // Every downstream state read (position, mode, LLM access) uses
      // it so a @fitness chat doesn't touch @default's state.
      const visitorId = _pvId;

      // Inbound chat log: show the EFFECTIVE context (payload values OR
      // whatever the socket session already had pinned from prior navigate
      // events). The dashboard never sends payload context, so falling back
      // to state is the only way to see where messages are actually landing.
      const effRoot = payloadRootId || getRootId(visitorId) || null;
      const effNode = payloadNodeId || getCurrentNodeId(visitorId) || null;
      const effMode = getCurrentMode(visitorId) || null;
      const effZone = payloadZone || (effMode?.split(":")[0]) || null;
      const msgSnippet = message.length > 48 ? message.slice(0, 48) + "…" : message;
      log.info(
        "WS",
        `📨 chat: vid=${visitorId} root=${effRoot?.slice?.(0,8) || "-"} node=${effNode?.slice?.(0,8) || "-"} zone=${effZone || "-"} mode=${effMode || "-"} handle=${_handle || "-"} gen=${generation ?? "-"} · ${JSON.stringify(msgSnippet)}`,
      );

      // LLM access gate
      try {
        if (!(await checkLlmAccess(socket.userId, visitorId))) {
          return socket.emit(WS.CHAT_ERROR, {
            error: "You need to set up a custom LLM connection before chatting. Visit /setup to connect one.",
            generation,
          });
        }
      } catch (err) {
        return socket.emit(WS.CHAT_ERROR, { error: err.message, generation });
      }

      // Stream extension: two modes.
      // 1. In-flight (processing): accumulate for mid-tool-loop injection
      // 2. Idle: debounce callback decides whether to swallow or fall through
      if (socket._onStreamMessage) {
        if (socket._chatAbort) {
          // A turn is already running — this message merges into it rather
          // than spawning a new turn. Log the merge so operators can see
          // mid-flight accumulation instead of silently swallowing chat.
          log.info("WS", `↺ chat merged into running turn: vid=${visitorId} gen=${generation ?? "-"} · ${JSON.stringify(msgSnippet)}`);
          socket._onStreamMessage(message, safeChatMode, generation);
          return;
        }
        if (socket._onStreamIdle) {
          // Pass the full payload context so the stream extension's
          // debounced replay carries rootId/nodeId/zone/sessionHandle
          // forward. Without this, the replay re-enters _chatHandler
          // with bare args, _pvId falls back to the socket-level
          // visitor, and the session's tree-mode state is missed —
          // every debounced message lands in home:default.
          const handled = socket._onStreamIdle(message, safeChatMode, generation, {
            rootId: payloadRootId,
            currentNodeId: payloadNodeId,
            zone: payloadZone,
            sessionHandle: payloadHandle,
          });
          if (handled) return;
        }
      }

      // Serialize per visitorId. Previous message must finish before next starts.
      await enqueue(visitorId, async () => {
        if (socket._chatAbort) socket._chatAbort.abort();
        const abort = new AbortController();
        socket._chatAbort = abort;

        // Finalize any leftover in-flight chat from a previous interrupted message
        await finalizeOpenChat(socket);

        // Make sure the websocket has its persistent session
        ensureSession(socket);
        syncRegistrySession(socket);
        const sessionId = socket._registrySessionId;

        // Determine zone from the current conversation mode (defaults to home)
        const currentMode = getCurrentMode(visitorId);
        const bigMode = currentMode?.split(":")[0] || "home";

        try {
          const { runOrchestration } = await import("../llm/conversation.js");
          const result = await runOrchestration({
            zone: bigMode,
            userId: socket.userId,
            username,
            message,
            rootId: getRootId(visitorId),
            currentNodeId: getCurrentNodeId(visitorId),
            visitorId,
            sessionId,
            sessionHandle: payloadHandle || null,
            socket,
            signal: abort.signal,
            chatSource: "user",
            sourceType: safeChatMode === "place"
              ? "ws-tree-place"
              : safeChatMode === "query"
                ? "ws-tree-query"
                : safeChatMode === "be"
                  ? "ws-tree-be"
                  : "tree-chat",
            orchestrateFlags: {
              skipRespond: safeChatMode === "place",
              forceQueryOnly: safeChatMode === "query",
              behavioral: safeChatMode === "be",
            },
            onChatCreated: (chat) => {
              setActiveChat(socket, chat._id, chat.startMessage.time);
            },
            onToolResults: (results) => {
              if (!abort.signal.aborted) for (const r of results) socket.emit(WS.TOOL_RESULT, r);
            },
            onToolCalled: (call) => {
              if (!abort.signal.aborted) socket.emit(WS.TOOL_CALLED, call);
            },
            onThinking: (thought) => {
              if (!abort.signal.aborted) socket.emit(WS.THINKING, thought);
            },
            onToolLoopCheckpoint: socket._streamCheckpoint || null,
          });

          if (abort.signal.aborted) {
            clearActiveChat(socket);
            return;
          }

          if (safeChatMode === "place") {
            socket.emit(WS.PLACE_RESULT, {
              success: result.success,
              stepSummaries: result.stepSummaries || [],
              targetPath: result.lastTargetPath || null,
              generation,
            });
          } else {
            socket.emit(WS.CHAT_RESPONSE, {
              success: result.success,
              answer: result.answer,
              generation,
              targetNodeId: result.targetNodeId || null,
            });
          }

          // runOrchestration already finalized the Chat record. Just clear the
          // socket-level marker so finalizeOpenChat doesn't double-finalize.
          clearActiveChat(socket);
          clearChatContext(socket.visitorId);
        } catch (err) {
          if (abort.signal.aborted) {
            clearActiveChat(socket);
            clearChatContext(socket.visitorId);
            return;
          }
          log.error("WS", `Chat error: ${err.message}`);
          socket.emit(WS.CHAT_ERROR, { error: err.message, generation });
          // runOrchestration handles finalization on error too
          clearActiveChat(socket);
          clearChatContext(socket.visitorId);
        } finally {
          if (socket._chatAbort === abort) socket._chatAbort = null;
          // Turn ended. Let the stream extension drain any mid-flight
          // messages that never made it into a tool-loop checkpoint so
          // they don't bleed into the next chat (see stream/index.js
          // _onStreamTurnEnd). Fire-and-forget, guarded for backward
          // compat with sockets that lack the stream extension.
          try { socket._onStreamTurnEnd?.(); } catch {}
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

      // Finalize any in-flight chat
      await finalizeOpenChat(socket);

      // Clean up session registry
      if (socket._registrySessionId) {
        endSession(socket._registrySessionId);
      }

      // Abort any in-flight LLM request
      if (socket._chatAbort) {
        socket._chatAbort.abort();
        socket._chatAbort = null;
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
