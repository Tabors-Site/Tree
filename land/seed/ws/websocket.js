// ws/websocket.js
// WebSocket server - handles socket events, delegates to conversation manager

import log from "../log.js";
import { WS } from "../protocol.js";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getClientForUser, userHasLlm } from "../ws/conversation.js";
import { hooks } from "../hooks.js";
import {
  connectToMCP,
  closeMCPClient,
  mcpClients,
  MCP_SERVER_URL,
} from "./mcp.js";
// Energy: dynamic import, no-op if extension not installed
import { getNodeName } from "../tree/treeData.js";
import Node from "../models/node.js";
// orchestrateTreeRequest loaded via registry (tree-orchestrator extension)
import { getOrchestrator } from "../orchestratorRegistry.js";
import { enqueue } from "./requestQueue.js";
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
  setCurrentNodeId,
  getCurrentNodeId,
} from "./conversation.js";
import {
  getSubModes,
  bigModeFromUrl,
  getDefaultMode,
  BIG_MODES,
} from "./modes/registry.js";
import {
  ensureSession,
  rotateSession,
  startChat,
  finalizeChat,
  setActiveChat,
  clearActiveChat,
  finalizeOpenChat,
  setChatContext,
  clearChatContext,
} from "./chatTracker.js";
const clearMemory = () => {}; // provided by tree-orchestrator extension if installed
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
  onSessionChange,
  SESSION_TYPES,
  registeredSessionCount,
} from "./sessionRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

let io;

// Socket tracking
const userSockets = new Map(); // visitorId → socket.id
const authSessions = new Map(); // userId → socket.id

// ── Socket handler registry (extensions register event handlers) ──────
const _socketHandlers = new Map();

export function registerSocketHandler(event, handler) {
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
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e6,       // 1MB max message size
    pingTimeout: 30000,           // 30s ping timeout
    pingInterval: 25000,          // 25s ping interval
    connectTimeout: 10000,        // 10s connection timeout
  });

  // Per-IP connection limit
  const ipConnectionCounts = new Map();
  const MAX_CONNECTIONS_PER_IP = 20;

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

    if (cookie) {
      const tokenMatch = cookie.match(/token=([^;]+)/);
      if (tokenMatch) {
        try {
          const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
          socket.userId = decoded.id || decoded.userId || decoded._id;
          socket.username = decoded.username;
          socket.jwt = tokenMatch[1];
        } catch (_) {}
      }
    }

    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    log.debug("WS",
      `🔗 Socket connected: ${socket.id} (user: ${userId || "anon"})`,
    );

    // Track auth session
    if (userId) {
      const oldSocketId = authSessions.get(userId);
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }
      authSessions.set(userId, socket.id);
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

      const visitorId = `user:${username}`;
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
    socket.on("urlChanged", async ({ url, rootId, nodeId }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const newBigMode = bigModeFromUrl(url);
      const currentMode = getCurrentMode(visitorId);
      const currentBig = currentMode?.split(":")[0] || null;

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
        } catch (e) {}
      }

      // Always send available modes so frontend stays in sync
      const activeMode = getCurrentMode(visitorId);
      const bigMode = activeMode?.split(":")[0] || newBigMode;
      const subModes = getSubModes(bigMode);
      socket.emit(WS.AVAILABLE_MODES, {
        bigMode,
        modes: subModes,
        currentMode: activeMode,
        rootName,
        rootId: activeRootId, // <-- add this
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
      const subModes = getSubModes(bigMode);

      const activeRootId = getRootId(visitorId);
      let rootName = null;
      if (bigMode === BIG_MODES.TREE && activeRootId) {
        try {
          rootName = await getNodeName(activeRootId);
        } catch (e) {}
      }

      socket.emit(WS.AVAILABLE_MODES, {
        bigMode,
        modes: subModes,
        currentMode,
        rootName,
        rootId: activeRootId, // <-- add this
      });
    });

    // ── CHAT ──────────────────────────────────────────────────────────
    socket.on(
      "chat",
      async ({ message, username, generation, mode: chatMode }) => {
        if (!message || !username) {
          socket.emit(WS.CHAT_ERROR, {
            error: "Missing message or username",
            generation,
          });
          return;
        }

        if (typeof message !== "string" || message.length > 5000) {
          socket.emit(WS.CHAT_ERROR, {
            error: "Message must be under 5000 characters.",
            generation,
          });
          return;
        }

        // Validate chat mode
        const validModes = ["chat", "place", "query"];
        const safeChatMode = validModes.includes(chatMode) ? chatMode : "chat";

        const visitorId = socket.visitorId || `user:${socket.userId}`;

        // Check if user has LLM access
        try {
          let hasLlmAccess = await userHasLlm(socket.userId);
          if (!hasLlmAccess) {
            const activeRootId = getRootId(visitorId);
            if (activeRootId) {
              const rootNode = await Node.findById(activeRootId)
                .select("rootOwner llmDefault metadata")
                .lean();
              if (
                rootNode &&
                rootNode.rootOwner.toString() !== socket.userId.toString() &&
                rootNode.llmDefault && rootNode.llmDefault !== "none"
              ) {
                hasLlmAccess = true;
              }
            }
          }
          if (!hasLlmAccess) {
            socket.emit(WS.CHAT_ERROR, {
              error:
                "You need to set up a custom LLM connection before chatting. Visit /setup to connect one.",
              generation,
            });
            return;
          }
        } catch (err) {
          socket.emit(WS.CHAT_ERROR, { error: err.message, generation });
          return;
        }

        // Serialize messages per visitorId — wait for previous message to finish
        await enqueue(visitorId, async () => {
          // Abort any previous in-flight request
          if (socket._chatAbort) {
            socket._chatAbort.abort();
          }
          const abort = new AbortController();
          socket._chatAbort = abort;

          // ── Session + Chat tracking ──────────────────────────────────
          // Finalize any leftover chat from a previous turn
          await finalizeOpenChat(socket);

          const sessionId = ensureSession(socket);
          syncRegistrySession(socket);
          const preMode = getCurrentMode(visitorId) || "home:default";

          // Resolve client info for tracking (include root override if present)
          const trackingRootId = getRootId(visitorId);
          let rootLlmOverride = null;
          if (trackingRootId) {
            const rn = await Node.findById(trackingRootId)
              .select("llmDefault metadata")
              .lean();
            rootLlmOverride = (rn?.llmDefault && rn.llmDefault !== "none") ? rn.llmDefault : null;
          }
          const clientInfo = await getClientForUser(
            socket.userId,
            undefined,
            rootLlmOverride,
          );

          let chat = null;
          try {
            const activeRootId = trackingRootId;
            chat = await startChat({
              userId: socket.userId,
              sessionId,
              message: message.slice(0, 5000),
              source: "user",
              modeKey: preMode,
              llmProvider: {
                isCustom: clientInfo.isCustom,
                model: clientInfo.model,
                connectionId: clientInfo.connectionId || null,
              },
              ...(activeRootId
                ? { treeContext: { targetNodeId: activeRootId } }
                : {}),
            });
            setActiveChat(socket, chat._id, chat.startMessage.time);
            setChatContext(socket.visitorId, sessionId, chat._id);
          } catch (err) {
            log.warn("WS", "Failed to create Chat:", err.message);
          }

          try {
            const currentMode = getCurrentMode(visitorId);
            const bigMode = currentMode?.split(":")[0] || null;
            let response;

            if (bigMode === "tree") {
              const orchArgs = {
                visitorId,
                message,
                socket,
                username,
                userId: socket.userId,
                signal: abort.signal,
                sessionId,
                skipRespond: safeChatMode === "place",
                forceQueryOnly: safeChatMode === "query",
                rootChatId: chat?._id || null,
                sourceType:
                  safeChatMode === "place"
                    ? "ws-tree-place"
                    : safeChatMode === "query"
                      ? "ws-tree-query"
                      : "tree-chat",
              };

              // Orchestrator loaded from extension registry
              const orch = getOrchestrator("tree");
              if (!orch) {
                throw new Error("No tree orchestrator installed. Install the tree-orchestrator extension.");
              }
              response = await orch.handle(orchArgs);
            } else {
              response = await processMessage(visitorId, message, {
                username,
                userId: socket.userId,
                rootId: getRootId(visitorId),
                signal: abort.signal,
                onToolResults(results) {
                  if (abort.signal.aborted) return;
                  for (const r of results) {
                    socket.emit(WS.TOOL_RESULT, r);
                  }
                },
              });
            }

            if (response && !abort.signal.aborted) {
              // Only send public data to client
              if (safeChatMode === "place") {
                socket.emit(WS.PLACE_RESULT, {
                  success: response.success,
                  stepSummaries: response.stepSummaries || [],
                  targetPath: response.lastTargetPath || null,
                  generation,
                });
              } else {
                socket.emit(WS.CHAT_RESPONSE, {
                  success: response.success,
                  answer: response.content || response.answer || null,
                  generation,
                });
              }

              // ── Finalize Chat (success) ────────────────────────────
              if (chat) {
                const internal = response._internal || {};
                finalizeChat({
                  chatId: chat._id,
                  content: response.content || response.answer || null,
                  stopped: false,
                  modeKey: internal.modeKey || getCurrentMode(visitorId),
                }).catch((err) =>
                  log.warn("WS", "Chat finalize failed:", err.message),
                );
              }
              clearChatContext(socket.visitorId);
              clearActiveChat(socket);
            } else if (abort.signal.aborted) {
              // ── Finalize Chat (cancelled mid-flight) ───────────────
              if (chat) {
                finalizeChat({
                  chatId: chat._id,
                  content: null,
                  stopped: true,
                }).catch((err) =>
                  log.error("WS",
                    "⚠️ Chat cancel finalize failed:",
                    err.message,
                  ),
                );
              }
              clearChatContext(socket.visitorId);
              clearActiveChat(socket);
            }
          } catch (err) {
            if (abort.signal.aborted) {
              if (chat) {
                finalizeChat({
                  chatId: chat._id,
                  content: null,
                  stopped: true,
                }).catch((e) =>
                  log.warn("WS", "Chat abort finalize failed:", e.message),
                );
              }
              clearActiveChat(socket);
              return;
            }

            log.error("WS", "Chat error:", err);

            // Energy metering handled by energy extension hooks if installed

            socket.emit(WS.CHAT_ERROR, { error: err.message, generation });

            // ── Finalize Chat (error) ────────────────────────────────
            if (chat) {
              finalizeChat({
                chatId: chat._id,
                content: `Error: ${err.message}`,
                stopped: false,
              }).catch((e) =>
                log.warn("WS", "Chat error finalize failed:", e.message),
              );
            }
            clearActiveChat(socket);
          } finally {
            if (socket._chatAbort === abort) {
              socket._chatAbort = null;
            }
          }
        });
      },
    );

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
    socket.on("setActiveRoot", ({ rootId }) => {
      const visitorId = socket.visitorId;
      if (visitorId && rootId) {
        setRootId(visitorId, rootId);
        log.debug("WS", `Set root: ${visitorId}: ${rootId}`);
      }
    });
    // ── FRONTEND SYNC (context injection) ─────────────────────────────
    socket.on("nodeUpdated", ({ nodeId, changes }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(
          visitorId,
          `[Frontend Update] User modified node ${nodeId}. Changes: ${JSON.stringify(changes)}`,
        );
      }
    });

    socket.on("nodeNavigated", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(
          visitorId,
          `[Frontend Navigation] User navigated to node "${nodeName}" (${nodeId}).`,
        );
      }
    });

    socket.on("nodeSelected", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(
          visitorId,
          `[Frontend Selection] User is now focusing on node "${nodeName}" (${nodeId}).`,
        );
      }
    });

    socket.on("nodeCreated", ({ nodeId, nodeName, parentId }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(
          visitorId,
          `[Frontend Action] User created node "${nodeName}" (${nodeId}) under ${parentId}.`,
        );
      }
    });

    socket.on("nodeDeleted", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        injectContext(
          visitorId,
          `[Frontend Action] User deleted node "${nodeName}" (${nodeId}).`,
        );
      }
    });

    socket.on("noteCreated", ({ nodeId, noteContent }) => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        const preview = String(noteContent ?? "").slice(0, 100);
        injectContext(
          visitorId,
          `[Frontend Action] User added note to node ${nodeId}: "${preview}${noteContent?.length > 100 ? "..." : ""}"`,
        );
      }
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

      if (userId && authSessions.get(userId) === socket.id) {
        authSessions.delete(userId);
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

  // Subscribe to session registry changes → sync navigator badge
  onSessionChange((userId) => {
    const socketId = authSessions.get(userId);
    const userSocket = socketId ? io.sockets.sockets.get(socketId) : null;
    if (userSocket) emitNavigatorStatus(userSocket);
  });

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

  const socketId = authSessions.get(userId);
  if (socketId) {
    io.to(socketId).emit(WS.NAVIGATE, { url, replace });
    log.debug("WS",
      `📍 Navigated user ${userId} to ${url} (session: ${sessionId ? sessionId.slice(0, 8) : "ungated"})`,
    );
  }
}

export function emitReload({ userId }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) io.to(socketId).emit(WS.RELOAD);
}

export function emitBroadcast(event, data) {
  if (io) io.emit(event, data);
}

export function emitToUser(userId, event, data) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) io.to(socketId).emit(event, data);
}

export function isUserOnline(userId) {
  return authSessions.has(String(userId));
}

export function notifyTreeChange({ userId, nodeId, changeType, details }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId)
    io.to(socketId).emit(WS.TREE_CHANGED, { nodeId, changeType, details });
}

function logStats() {
  log.debug("WS",
    `📊 Auth: ${authSessions.size} | Visitors: ${userSockets.size} | MCP: ${mcpClients.size} | Sessions: ${sessionCount()} | Registry: ${registeredSessionCount()}`,
  );
}
