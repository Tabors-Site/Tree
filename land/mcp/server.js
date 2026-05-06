/**
 * MCP Server
 *
 * Per-session server architecture. Each MCP client gets its own
 * McpServer + StreamableHTTPServerTransport pair. Tool registrations
 * are stored in a replay array and applied to every new session.
 *
 * The security boundary (auth, tree access, spatial scoping) runs
 * in handleMcpRequest before the transport processes the request.
 * Every tool call goes through MCP. No bypass.
 */

import crypto from "crypto";
import log from "../seed/log.js";
import { resolveTreeAccess } from "../seed/tree/treeAccess.js";
import { getToolOwner, isExtensionBlockedAtNode, isToolReadOnly } from "../seed/tree/extensionScope.js";
import { getChatContext } from "../seed/llm/chatTracker.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// ============================================================================
// TOOL REGISTRATION REPLAY
// ============================================================================
// The loader calls mcpServerInstance.tool() at boot for each extension tool.
// We intercept those calls and store them. When a new session starts, we
// create a fresh McpServer and replay all registrations in order.

// Registrations are captured as { kind, name, ... } so replay can dispatch
// to either tool() (shorthand, raw shape) or registerTool() (config form
// with a pre-built zod schema including passthrough). Callers in the
// loader use registerTool so context fields like userId/rootId/nodeId
// survive the MCP SDK's zod strip.
const _toolRegistrations = []; // [{ kind: "tool"|"registerTool", ...fields }]

/**
 * Proxy McpServer that captures tool registrations for replay.
 * Extensions register tools on this during boot. The registrations
 * are stored and replayed on every new per-session server.
 */
class ToolRegistryProxy {
  constructor() {
    // Create a real server for the initial connect (SDK requires it)
    this._templateServer = new McpServer({
      name: "treeos-mcp",
      version: "1.0.0",
    });
  }

  /**
   * Shorthand-form registration. Preserved for backward compatibility;
   * new code in the loader should prefer registerTool() below.
   */
  tool(name, description, schema, handler) {
    _toolRegistrations.push({ kind: "tool", name, description, schema, handler });
    this._templateServer.tool(name, description, schema, handler);
  }

  /**
   * Config-form registration. Takes a { description, inputSchema,
   * annotations } config object and a handler. The inputSchema may be
   * a pre-built zod object (e.g. passthrough) so unknown fields survive
   * validation. This is how the loader registers extension tools so
   * every handler can see its MCP context (userId/rootId/nodeId).
   */
  registerTool(name, config, handler) {
    _toolRegistrations.push({ kind: "registerTool", name, config, handler });
    this._templateServer.registerTool(name, config, handler);
  }

  /**
   * Remove a tool from the replay array and all active sessions.
   * Called when an extension is disabled/uninstalled at runtime.
   */
  /**
   * Remove all tools owned by an extension from the replay array.
   * Invalidates all active sessions so they reinitialize with updated tools.
   */
  removeToolsByOwner(extName, getToolOwnerFn) {
    for (let i = _toolRegistrations.length - 1; i >= 0; i--) {
      if (getToolOwnerFn(_toolRegistrations[i].name) === extName) {
        _toolRegistrations.splice(i, 1);
      }
    }
    // Close all sessions. Next request creates fresh ones with updated tool set.
    for (const [, session] of _sessions) {
      try { session.transport.close?.(); } catch {}
    }
    _sessions.clear();
  }

  /**
   * Proxy connect() to the template server (for the initial boot connect).
   * Per-session servers connect their own transports.
   */
  async connect(_transport) {
    // No-op. Per-session servers handle their own connections.
  }
}

const mcpServerInstance = new ToolRegistryProxy();

// ============================================================================
// PER-SESSION SERVER FACTORY
// ============================================================================

const _sessions = new Map(); // sessionId -> { server, transport }

function createSessionServer() {
  const server = new McpServer({
    name: "treeos-mcp",
    version: "1.0.0",
    capabilities: {
      resources: { listChanged: true },
      tools: {},
      prompts: {},
    },
  });

  // Replay all tool registrations in order. Dispatch on kind so tools
  // registered via registerTool (config + passthrough schema) are re-
  // attached with the same API they were created with; legacy tool()
  // registrations still go through the shorthand path.
  for (const reg of _toolRegistrations) {
    if (reg.kind === "registerTool") {
      server.registerTool(reg.name, reg.config, reg.handler);
    } else {
      server.tool(reg.name, reg.description, reg.schema, reg.handler);
    }
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sessionId) => {
      log.debug("MCP", `Session initialized: ${sessionId.slice(0, 8)}...`);
      _sessions.set(sessionId, { server, transport });
    },
  });

  server.connect(transport);

  return { server, transport };
}

// Cap sessions to prevent unbounded growth
const MAX_MCP_SESSIONS = 1000;

function evictOldestSession() {
  if (_sessions.size < MAX_MCP_SESSIONS) return;
  const first = _sessions.keys().next().value;
  if (first) {
    try { _sessions.get(first)?.transport?.close?.(); } catch {}
    _sessions.delete(first);
  }
}

// Periodic cleanup of dead sessions
setInterval(() => {
  // Sessions are cleaned up by DELETE requests from clients.
  // This sweep is a safety net for orphaned sessions.
  if (_sessions.size > MAX_MCP_SESSIONS / 2) {
    const cutoff = _sessions.size - MAX_MCP_SESSIONS / 2;
    let removed = 0;
    for (const [id] of _sessions) {
      if (removed >= cutoff) break;
      try { _sessions.get(id)?.transport?.close?.(); } catch {}
      _sessions.delete(id);
      removed++;
    }
  }
}, 600000).unref(); // every 10 min

// ============================================================================
// REQUEST HANDLER
// ============================================================================

async function handleMcpRequest(req, res) {
  try {
    // Route to existing session or create new one
    const sessionId = req.headers["mcp-session-id"];
    let session = sessionId ? _sessions.get(sessionId) : null;

    // DELETE: session cleanup
    if (req.method === "DELETE") {
      if (session) {
        try { session.transport.close?.(); } catch {}
        _sessions.delete(sessionId);
      }
      res.status(200).end();
      return;
    }

    // GET: SSE stream for server-initiated messages
    if (req.method === "GET") {
      if (!session) {
        res.status(404).json({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found" }, id: null });
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    // POST: initialize or tool call
    const method = req.body?.method;
    const isInit = method === "initialize";

    // Session expired: client sent a non-init request without a valid session.
    // Return error so the MCP client reconnects and re-initializes.
    if (!session && !isInit) {
      return res.status(404).json({
        jsonrpc: "2.0", id: req.body?.id,
        error: { code: -32000, message: "Session expired. Send initialize to start a new session." },
      });
    }

    // New session for initialize requests
    if (isInit) {
      evictOldestSession();
      session = createSessionServer();
    }

    const toolName = req.body?.params?.name;

    if (method === "tools/call") {
      const requestArgs = req.body?.params?.arguments ?? {};

      if (!req.userId) {
        return res.status(401).json({
          jsonrpc: "2.0", id: req.body.id,
          error: { code: -32602, message: "You are not authorized as this user" },
        });
      }
      requestArgs.userId = req.userId;
      // Visitor identity. Tools that maintain per-conversation
      // transient state (governing's Ruler/Foreman decision registers)
      // need this to key writes that runRulerTurn/runForemanTurn read
      // back after the LLM call resolves. Falls back to userId for
      // backwards compatibility with non-WebSocket callers.
      if (req.visitorId) requestArgs.visitorId = req.visitorId;

      // Inject AI chat context
      const contextKey = req.visitorId || req.userId;
      const aiCtx = getChatContext(contextKey);
      requestArgs.chatId = aiCtx.chatId;
      requestArgs.sessionId = aiCtx.sessionId;

      // Inject position context from the conversation session.
      // These are primitives: where the action is coming from.
      // Tools can override nodeId for specific actions (navigate elsewhere),
      // but the default is always the current position.
      if (req.visitorId) {
        try {
          const { getCurrentNodeId, getRootId } = await import("../seed/llm/conversation.js");
          const sessionRootId = getRootId(req.visitorId);
          const sessionNodeId = getCurrentNodeId(req.visitorId);
          if (!requestArgs.rootId && sessionRootId) requestArgs.rootId = sessionRootId;
          if (!requestArgs.nodeId && sessionNodeId) requestArgs.nodeId = sessionNodeId;
        } catch {}
      }

      const nodeId = requestArgs.nodeId ?? requestArgs.rootId ?? requestArgs.parentNodeID ?? requestArgs.parentId ?? requestArgs.rootNodeId;

      // Tree access check. Read-only tools (annotation readOnlyHint: true)
      // only need canRead; write tools need canWrite. Without this split a
      // read-only tool like get-node-notes was being rejected with
      // "Invalid nodeId, or you are not in this tree" whenever the user had
      // read-only access to the tree — which is wrong and spammed the log.
      if (nodeId && req.userId) {
        const access = await resolveTreeAccess(nodeId, req.userId);
        const readOnly = toolName ? isToolReadOnly(toolName) : false;
        const allowed = readOnly ? (access.canRead || access.canWrite) : access.canWrite;
        if (!allowed) {
          return res.status(403).json({
            jsonrpc: "2.0", id: req.body.id,
            error: {
              code: -32602,
              message: readOnly
                ? `Read access denied for node ${nodeId}.`
                : `Write access denied for node ${nodeId} (tool "${toolName}" requires write).`,
            },
          });
        }
      }

      // Spatial scoping check
      if (nodeId && toolName) {
        const ownerExt = getToolOwner(toolName);
        if (ownerExt) {
          const blocked = await isExtensionBlockedAtNode(ownerExt, nodeId);
          if (blocked) {
            return res.status(403).json({
              jsonrpc: "2.0", id: req.body.id,
              error: { code: -32602, message: `Tool "${toolName}" is blocked at this position (extension "${ownerExt}" is scoped out).` },
            });
          }
        }
      }
    } else if (method !== "initialize" && method !== "notifications/initialized") {
      // Non-tool, non-init methods: auth check
      if (!req.userId) {
        return res.status(401).json({
          jsonrpc: "2.0", id: req.body.id,
          error: { code: -32602, message: "You are not authorized as this user" },
        });
      }
    }

    // Delegate to the session's transport
    await session.transport.handleRequest(req, res, req.body);
  } catch (err) {
    log.error("MCP", "[MCP] Error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: err.message },
        id: req.body?.id || null,
      });
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

async function connectMcpTransport() {
  // No-op. Per-session servers connect their own transports.
  // This function exists for backward compatibility with the boot sequence.
  log.verbose("MCP", `Tool registry: ${_toolRegistrations.length} tools registered`);
}

function getMcpServer() {
  // Return the proxy so the loader can register tools
  return mcpServerInstance;
}

export { mcpServerInstance, getMcpServer, handleMcpRequest, connectMcpTransport };
