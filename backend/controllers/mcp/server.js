// controllers/mcpController.js
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { getTreeForAi } = require("../treeDataFetching.js"); // import from your real backend

// Create and configure the MCP server
function getMcpServer() {
  const server = new McpServer({ name: "tree-helper", version: "1.0.0" });

  server.tool(
    "ask-tree-question",
    "Ask a question about the user's tree",
    {
      question: { type: "string" },
      rootId: { type: "string" },
    },
    async (args) => {
      const { question, rootId } = args;
      const treeData = await getTreeForAi(rootId);

      if (!treeData) {
        return {
          content: [{ type: "text", text: "❌ Could not fetch tree data." }],
        };
      }

      return { content: [{ type: "text", text: JSON.stringify(treeData) }] };
    }
  );

  return server;
}

// Main handler that Express can mount
async function handleMcpRequest(req, res) {
  try {
    const server = getMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);


    res.on("close", () => {
      transport.close();
      server.close();
    });

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603 },
        id: req.body.id || null,
      });
    }
  }
}

module.exports = { getMcpServer, handleMcpRequest };
