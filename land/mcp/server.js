import log from "../seed/log.js";
import User from "../seed/models/user.js";
import { getUserMeta } from "../seed/tree/userMetadata.js";
import { resolveTreeAccess } from "../seed/tree/treeAccess.js";
import { getChatContext } from "../seed/ws/chatTracker.js";

import {
  McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// ============================================================================
// MCP SERVER (empty pipe, extensions register tools via loader)
// ============================================================================

function getMcpServer() {
  return new McpServer({
    name: "treeos-mcp",
    protocolVersion: "2025-11-25",
    version: "1.0.0",
    capabilities: {
      resources: { listChanged: true },
      tools: {},
      prompts: {},
    },
  });
}

const server = getMcpServer();
const transport = new StreamableHTTPServerTransport({});
// NOTE: server.connect(transport) is called AFTER extensions register tools.
// The MCP SDK locks capabilities after connect. Extensions must register first.
// Call connectMcpTransport() after loadExtensions() completes.

// ============================================================================
// REQUEST HANDLER (pipe: auth, tree access, context injection, dispatch)
// ============================================================================

const pendingCalls = new Map();
const completedCalls = new Map();

function parseSseResponse(rawBody) {
  const lines = rawBody.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.substring(6));
    }
  }
  throw new Error("No data found in SSE response");
}

function formatSseResponse(jsonData) {
  return `event: message\ndata: ${JSON.stringify(jsonData)}\n\n`;
}

async function handleMcpRequest(req, res) {
  try {
    const method = req.body?.method;
    const toolName = req.body?.params?.name;
    const args = req.body?.params?.arguments;

    if (method === "tools/call") {
      const requestArgs = req.body?.params?.arguments ?? {};
      if (!req.userId) {
        res.setHeader("Content-Type", "text/event-stream");
        res.end(
          formatSseResponse({
            jsonrpc: "2.0",
            id: req.body.id,
            error: {
              code: -32602,
              message: "You are not authorized as this user",
            },
          }),
        );
        return;
      }
      requestArgs.userId = req.userId;

      // Inject AI chat context so contributions are tracked per-chat
      const contextKey = req.visitorId || req.userId;
      const aiCtx = getChatContext(contextKey);
      requestArgs.chatId = aiCtx.chatId;
      requestArgs.sessionId = aiCtx.sessionId;

      const user = await User.findById(req.userId).select("metadata");
      const htmlShareToken = getUserMeta(user, "html")?.shareToken ?? null;
      if (args && htmlShareToken) {
        args.htmlShareToken = htmlShareToken;
      }

      const nodeId = requestArgs.nodeId ?? requestArgs.rootId ?? requestArgs.parentNodeID ?? requestArgs.parentId ?? requestArgs.rootNodeId;

      if (nodeId && req.userId) {
        const access = await resolveTreeAccess(nodeId, req.userId);
        if (!access.canWrite) {
          res.setHeader("Content-Type", "text/event-stream");
          res.end(
            formatSseResponse({
              jsonrpc: "2.0",
              id: req.body.id,
              error: {
                code: -32602,
                message: "Invalid nodeId, or you are not in this tree.",
              },
            }),
          );
          return;
        }
      }

      const callKey = `${toolName}:${JSON.stringify(args)}`;

      // Check pending requests (dedup concurrent identical calls)
      res.setHeader("Content-Type", "text/event-stream");

      const pending = pendingCalls.get(callKey);
      if (pending) {
        log.debug("MCP", `Waiting for in-flight request: ${toolName}`);
        try {
          const response = await pending;
          res.end(formatSseResponse(response));
        } catch (err) {
          res.end(
            formatSseResponse({
              jsonrpc: "2.0",
              id: req.body.id,
              error: err,
            }),
          );
        }
        return;
      }

      log.debug("MCP", `Tool: ${toolName}`);

      // Create promise for this request
      const requestPromise = new Promise((resolve, reject) => {
        const chunks = [];
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);

        res.write = (chunk, ...writeArgs) => {
          if (chunk) chunks.push(Buffer.from(chunk));
          return originalWrite(chunk, ...writeArgs);
        };

        res.end = (chunk, ...endArgs) => {
          if (chunk) chunks.push(Buffer.from(chunk));

          const rawBody = Buffer.concat(chunks).toString("utf8");
          if (rawBody) {
            try {
              const parsed = parseSseResponse(rawBody);
              completedCalls.set(callKey, { timestamp: Date.now(), response: parsed });
              pendingCalls.delete(callKey);

              if (completedCalls.size > 100) {
                const entries = [...completedCalls.entries()];
                entries.slice(0, 50).forEach(([key]) => completedCalls.delete(key));
              }

              resolve(parsed);
            } catch (err) {
              reject(err);
            }
          }

          return originalEnd(chunk, ...endArgs);
        };
      });

      pendingCalls.set(callKey, requestPromise);
      await transport.handleRequest(req, res, req.body);
    } else {
      // Non-tool methods (tools/list, etc.)
      const requestArgs = req.body?.params?.arguments ?? {};
      if (!req.userId) {
        res.setHeader("Content-Type", "text/event-stream");
        res.end(
          formatSseResponse({
            jsonrpc: "2.0",
            id: req.body.id,
            error: {
              code: -32602,
              message: "You are not authorized as this user",
            },
          }),
        );
        return;
      }
      requestArgs.userId = req.userId;

      const contextKey = req.visitorId || req.userId;
      const aiCtx = getChatContext(contextKey);
      requestArgs.chatId = aiCtx.chatId;
      requestArgs.sessionId = aiCtx.sessionId;

      await transport.handleRequest(req, res, req.body);
    }
  } catch (err) {
    log.error("MCP", "[MCP] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603 },
        id: req.body.id || null,
      });
    }
  }
}

async function connectMcpTransport() {
  await server.connect(transport);
}

export { server as mcpServerInstance, getMcpServer, handleMcpRequest, connectMcpTransport };
