import { getNodeName } from "./../controllers/treeDataFetching.js";
// ws/websocket.js
// WebSocket server - handles socket events, delegates to conversation manager

import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

import { connectToMCP, closeMCPClient, mcpClients, MCP_SERVER_URL } from "./mcp.js";
import { useEnergy } from "../core/energy.js";
import {
  switchMode,
  switchBigMode,
  processMessage,
  injectContext,
  setRootId,
  getRootId,
  getCurrentMode,
  clearSession,
  resetConversation,
  getConversation,
  sessionCount,
} from "./conversation.js";
import {
  getSubModes,
  bigModeFromUrl,
  getDefaultMode,
  BIG_MODES,
} from "./modes/registry.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

let io;

// Socket tracking
const userSockets = new Map();  // visitorId → socket.id
const authSessions = new Map(); // userId → socket.id

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

export function initWebSocketServer(httpServer, allowedOrigins) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Auth middleware
  io.use((socket, next) => {
    const cookie = socket.request.headers.cookie;
    socket.userId = null;

    if (cookie) {
      const tokenMatch = cookie.match(/token=([^;]+)/);
      if (tokenMatch) {
        try {
          const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
          socket.userId = decoded.id || decoded.userId || decoded._id;
        } catch (_) {}
      }
    }

    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    console.log(`🔗 Socket connected: ${socket.id} (user: ${userId || "anon"})`);

    // Track auth session
    if (userId) {
      const oldSocketId = authSessions.get(userId);
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }
      authSessions.set(userId, socket.id);
    }

    socket.on("ready", () => {
      console.log(`✅ App ready for user: ${userId}`);
    });

    // ── REGISTER ──────────────────────────────────────────────────────
    socket.on("register", async ({ username }) => {
      if (!username) {
        socket.emit("registered", { success: false, error: "Missing username" });
        return;
      }

      const visitorId = `user:${username}`;
      const oldSocketId = userSockets.get(visitorId);
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }

      userSockets.set(visitorId, socket.id);
      socket.visitorId = visitorId;
      socket.username = username;

      try {
        await connectToMCP(MCP_SERVER_URL, visitorId, username, socket.userId);
        socket.emit("registered", { success: true, visitorId });
      } catch (err) {
        console.error(`❌ MCP connection failed for ${visitorId}:`, err.message);
        socket.emit("registered", { success: false, error: err.message });
      }

      logStats();
    });

    // ── MODE SWITCHING ────────────────────────────────────────────────

    /**
     * Manual mode switch from UI mode bar.
     * Payload: { modeKey: "tree:build" }
     */
    socket.on("switchMode", ({ modeKey }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      try {
        const result = switchMode(visitorId, modeKey, {
          username: socket.username,
          userId: socket.userId,
        });
        socket.emit("modeSwitched", result);
      } catch (err) {
        socket.emit("chatError", { error: err.message });
      }
    });

    /**
     * URL-based big mode detection from frontend.
     * Frontend sends this when the iframe URL changes.
     * Payload: { url: "/root/abc123", rootId?: "abc123" }
     */
    socket.on("urlChanged", async ({ url, rootId, nodeId }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const newBigMode = bigModeFromUrl(url);
      const currentMode = getCurrentMode(visitorId);
      const currentBig = currentMode?.split(":")[0] || null;

      // Update rootId based on URL
      // /root/:id always wins
      if (rootId) {
        setRootId(visitorId, rootId);
      } else if (nodeId && (currentBig !== newBigMode || !getRootId(visitorId))) {
        // Accept bare nodeId when big mode is changing OR no rootId set
        setRootId(visitorId, nodeId);
      }

      // Clear rootId when going to home
      if (newBigMode === BIG_MODES.HOME) {
        setRootId(visitorId, null);
      }

      // Switch if big mode changed or no mode set yet
      if (currentBig !== newBigMode || !currentMode) {
        try {
          const result = switchBigMode(visitorId, newBigMode, {
            username: socket.username,
            userId: socket.userId,
            rootId: getRootId(visitorId),
          });
          socket.emit("modeSwitched", result);
        } catch (err) {
          console.error(`❌ Big mode switch failed:`, err.message);
        }
      }

      // Look up root name for tree modes
      const activeRootId = getRootId(visitorId);
      let rootName = null;
      if (newBigMode === BIG_MODES.TREE && activeRootId) {
        try { rootName = await getNodeName(activeRootId); } catch(e) {}
      }

      // Always send available modes so frontend stays in sync
      const activeMode = getCurrentMode(visitorId);
      const bigMode = activeMode?.split(":")[0] || newBigMode;
      const subModes = getSubModes(bigMode);
      socket.emit("availableModes", {
        bigMode,
        modes: subModes,
        currentMode: activeMode,
        rootName,
      });
    });

    /**
     * Request available modes for current big mode (e.g., on page load).
     */
    socket.on("getAvailableModes", async ({ url } = {}) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      let currentMode = getCurrentMode(visitorId);

      // Determine correct big mode from URL (source of truth)
      const urlBigMode = url ? bigModeFromUrl(url) : null;
      const currentBig = currentMode?.split(":")[0] || null;

      // Extract rootId from URL
      if (url) {
        const ID = '(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})';
        const rootMatch = url.match(new RegExp(`(?:/api)?/root/(${ID})`, 'i'));
        const bareMatch = url.match(new RegExp(`(?:/api)?/(${ID})(?:[?/]|$)`, 'i'));
        if (rootMatch?.[1]) {
          setRootId(visitorId, rootMatch[1]);
        } else if (bareMatch?.[1] && (currentBig !== urlBigMode || !getRootId(visitorId))) {
          setRootId(visitorId, bareMatch[1]);
        }
        // Clear rootId when on home
        if (urlBigMode === BIG_MODES.HOME) {
          setRootId(visitorId, null);
        }
      }

      // If no mode, or big mode doesn't match URL → switch to correct big mode
      if (!currentMode || (urlBigMode && currentBig !== urlBigMode)) {
        try {
          const targetBigMode = urlBigMode || BIG_MODES.HOME;
          const result = switchBigMode(visitorId, targetBigMode, {
            username: socket.username,
            userId: socket.userId,
            rootId: getRootId(visitorId),
          });
          currentMode = result.modeKey;
          socket.emit("modeSwitched", result);
        } catch (err) {
          console.error("❌ Failed to initialize/correct mode:", err.message);
        }
      }

      const bigMode = currentMode?.split(":")[0] || BIG_MODES.HOME;
      const subModes = getSubModes(bigMode);

      // Look up root name for tree modes
      const activeRootId = getRootId(visitorId);
      let rootName = null;
      if (bigMode === BIG_MODES.TREE && activeRootId) {
        try { rootName = await getNodeName(activeRootId); } catch(e) {}
      }

      socket.emit("availableModes", {
        bigMode,
        modes: subModes,
        currentMode,
        rootName,
      });
    });

    // ── CHAT ──────────────────────────────────────────────────────────
    socket.on("chat", async ({ message, username, generation }) => {
      if (!message || !username) {
        socket.emit("chatError", { error: "Missing message or username", generation });
        return;
      }

      const visitorId = socket.visitorId || `user:${socket.userId}`;

      // Charge energy upfront (non-refundable even if cancelled)
      try {
        await useEnergy({ userId: socket.userId, action: "chat" });
      } catch (err) {
        socket.emit("chatError", { error: err.message, generation });
        return;
      }

      // Abort any previous in-flight request
      if (socket._chatAbort) {
        socket._chatAbort.abort();
      }
      const abort = new AbortController();
      socket._chatAbort = abort;

      try {
        const response = await processMessage(visitorId, message, {
          username,
          userId: socket.userId,
          rootId: getRootId(visitorId),
          signal: abort.signal,
          onToolResults(results) {
            if (abort.signal.aborted) return;
            // Real-time tool result emission
            for (const r of results) {
              socket.emit("toolResult", r);
            }
          },
        });

        if (!abort.signal.aborted) {
          socket.emit("chatResponse", { ...response, generation });
        }
      } catch (err) {
        if (abort.signal.aborted) return; // cancelled, don't emit error
        console.error("❌ Chat error:", err);
        socket.emit("chatError", { error: err.message, generation });
      } finally {
        if (socket._chatAbort === abort) {
          socket._chatAbort = null;
        }
      }
    });

    // ── CANCEL REQUEST ────────────────────────────────────────────────
    socket.on("cancelRequest", () => {
      if (socket._chatAbort) {
        console.log(`⏹ Cancel request for ${socket.visitorId}`);
        socket._chatAbort.abort();
        socket._chatAbort = null;
      }
    });

    // ── ACTIVE ROOT ───────────────────────────────────────────────────
    socket.on("setActiveRoot", ({ rootId }) => {
      const visitorId = socket.visitorId;
      if (visitorId && rootId) {
        setRootId(visitorId, rootId);
        console.log(`🌳 Set active root for ${visitorId}: ${rootId}`);
      }
    });

    // ── FRONTEND SYNC (context injection) ─────────────────────────────
    socket.on("nodeUpdated", ({ nodeId, changes }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(visitorId, `[Frontend Update] User modified node ${nodeId}. Changes: ${JSON.stringify(changes)}`);
      }
    });

    socket.on("nodeNavigated", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(visitorId, `[Frontend Navigation] User navigated to node "${nodeName}" (${nodeId}).`);
      }
    });

    socket.on("nodeSelected", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(visitorId, `[Frontend Selection] User is now focusing on node "${nodeName}" (${nodeId}).`);
      }
    });

    socket.on("nodeCreated", ({ nodeId, nodeName, parentId }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(visitorId, `[Frontend Action] User created node "${nodeName}" (${nodeId}) under ${parentId}.`);
      }
    });

    socket.on("nodeDeleted", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(visitorId, `[Frontend Action] User deleted node "${nodeName}" (${nodeId}).`);
      }
    });

    socket.on("noteCreated", ({ nodeId, noteContent }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        const preview = String(noteContent ?? "").slice(0, 100);
        injectContext(visitorId, `[Frontend Action] User added note to node ${nodeId}: "${preview}${noteContent?.length > 100 ? "..." : ""}"`);
      }
    });

    // ── CLEAR / DISCONNECT ────────────────────────────────────────────
    socket.on("clearConversation", () => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        resetConversation(visitorId, {
          username: socket.username,
          userId: socket.userId,
        });
        socket.emit("conversationCleared", { success: true });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔌 Disconnected: ${socket.id} (${reason})`);

      // Abort any in-flight LLM request
      if (socket._chatAbort) {
        socket._chatAbort.abort();
        socket._chatAbort = null;
      }

      if (userId && authSessions.get(userId) === socket.id) {
        authSessions.delete(userId);
      }

      if (socket.visitorId) {
        const visitorId = socket.visitorId;
        if (userSockets.get(visitorId) === socket.id) {
          userSockets.delete(visitorId);
          // Clean up MCP client
          closeMCPClient(visitorId).catch(err =>
            console.error(`❌ MCP cleanup failed for ${visitorId}:`, err.message)
          );
          // Clean up conversation session
          clearSession(visitorId);
        }
      }

      logStats();
    });
  });

  console.log("🚀 WebSocket server initialized");
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

export function emitNavigate({ userId, url, replace = false }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) {
    io.to(socketId).emit("navigate", { url, replace });
    console.log(`📍 Navigated user ${userId} to ${url}`);
  }
}

export function emitReload({ userId }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) io.to(socketId).emit("reload");
}

export function emitBroadcast(event, data) {
  if (io) io.emit(event, data);
}

export function emitToUser(userId, event, data) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) io.to(socketId).emit(event, data);
}

export function notifyTreeChange({ userId, nodeId, changeType, details }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) io.to(socketId).emit("treeChanged", { nodeId, changeType, details });
}

function logStats() {
  console.log(
    `📊 Auth: ${authSessions.size} | Visitors: ${userSockets.size} | MCP: ${mcpClients.size} | Sessions: ${sessionCount()}`
  );
}