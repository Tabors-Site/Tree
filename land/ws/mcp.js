import log from "../core/log.js";
// ws/mcp.js
// MCP client lifecycle management

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

// key: visitorId → MCP Client instance
export const mcpClients = new Map();

export async function connectToMCP(serverUrl, visitorId, jwtToken) {
  const existing = mcpClients.get(visitorId);
  if (existing && existing._jwtToken === jwtToken) {
    log.debug("MCP", `Reusing MCP client for ${visitorId}`);
    return existing;
  }

  // Close stale client if token changed
  if (existing) {
    try {
      await existing.close();
    } catch (_) {}
    mcpClients.delete(visitorId);
  }

  log.verbose("MCP", `Connecting MCP client for ${visitorId}...`);

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers: {
        "x-internal-token": jwtToken, // ✅ just pass the string
        "x-internal-request": "mcp", // ⭐ recommended flag
      },
    },
  });

  const client = new Client(
    { name: `tree-chat-client-${visitorId}`, version: "1.0.0" },
    { capabilities: { sampling: {} } },
  );

  await client.connect(transport);
  log.verbose("MCP", ` client connected for ${visitorId}`);

  client._jwtToken = jwtToken; // tag for comparison
  mcpClients.set(visitorId, client);
  return client;
}

export async function closeMCPClient(visitorId) {
  const client = mcpClients.get(visitorId);
  if (!client) return;

  try {
    if (typeof client.close === "function") {
      await client.close();
    } else if (client.transport?.close) {
      await client.transport.close();
    }
    log.debug("MCP", `Closed MCP client for ${visitorId}`);
  } catch (err) {
    log.warn("MCP", `Error closing MCP client for ${visitorId}:`, err.message);
  }

  mcpClients.delete(visitorId);
}

export function getMCPClient(visitorId) {
  return mcpClients.get(visitorId) || null;
}

export { MCP_SERVER_URL };
