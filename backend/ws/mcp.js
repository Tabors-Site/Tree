// ws/mcp.js
// MCP client lifecycle management

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import dotenv from "dotenv";

dotenv.config();

const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

// key: visitorId → MCP Client instance
export const mcpClients = new Map();

export async function connectToMCP(serverUrl, visitorId, username, userId) {
  if (mcpClients.has(visitorId)) {
    console.log(`♻️  Reusing MCP client for ${visitorId}`);
    return mcpClients.get(visitorId);
  }

  console.log(`🔌 Connecting MCP client for ${visitorId}...`);

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers: {
        "X-User-Id": userId || "",
        "X-Username": username || "",
      },
    },
  });

  const client = new Client(
    { name: `tree-chat-client-${visitorId}`, version: "1.0.0" },
    { capabilities: { sampling: {} } },
  );

  await client.connect(transport);
  console.log(`✅ MCP client connected for ${visitorId}`);

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
    console.log(`🔒 Closed MCP client for ${visitorId}`);
  } catch (err) {
    console.warn(`⚠️  Error closing MCP client for ${visitorId}:`, err.message);
  }

  mcpClients.delete(visitorId);
}

export function getMCPClient(visitorId) {
  return mcpClients.get(visitorId) || null;
}

export { MCP_SERVER_URL };
