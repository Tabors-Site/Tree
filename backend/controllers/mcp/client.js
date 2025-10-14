// controllers/mcp/client.js
const OpenAI = require("openai/index.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const dotenv = require("dotenv");

dotenv.config();



// === OpenAI/Ollama Setup ===
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1", // Ollama endpoint
  apiKey: "ollama",
});

// === MCP Client Setup ===
const mcp = new Client({ name: "tree-helper-client", version: "1.0.0" });
let tools = [];

//Connect to the local Express MCP endpoint (same server)
async function connectToMCP(serverUrl) {
  console.log(`Connecting to MCP HTTP server at ${serverUrl}...`);

  const transport = new StreamableHTTPClientTransport(serverUrl);
  await mcp.connect(transport);

  const toolsResult = await mcp.listTools();
  tools = toolsResult.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  console.log("Connected to MCP HTTP server with tools:", tools.map((t) => t.name));
}

// === Main Function ===
async function getMCPResponse(req, res) {
  const { message, rootId } = req.body;

  if (!message || !rootId) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: message and rootId",
    });
  }

  try {
    console.log(`🛠 Fetching tree data for rootId: ${rootId}...`);
    const treeResult = await mcp.callTool({
      name: "ask-tree-question",
      arguments: { question: message, rootId },
    });

    const treeData = treeResult.content?.[0]?.text || "No data returned.";
    console.log("🌳 Tree Data:", treeData);

    // === Pass the tree data into the AI model ===
    const messages = [
      {
        role: "system",
        content: `
          You are a reasoning assistant that helps answer questions about hierarchical tree data.
          The user will ask a question about the data, and you should answer based only on it.
        `,
      },
      {
        role: "system",
        content: `Tree data:\n${treeData}`,
      },
      {
        role: "user",
        content: message,
      },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-oss:20b",
      messages,
    });

    const answer = response.choices?.[0]?.message?.content || "No response generated.";
    console.log("🧠 AI Answer:", answer);

    res.json({ success: true, answer });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}



module.exports = { getMCPResponse, connectToMCP };
