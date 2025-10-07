import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1", // Ollama endpoint
  apiKey: "ollama",
});

// === MCP Client Setup ===
const mcp = new Client({ name: "tree-helper-client", version: "1.0.0" });
let tools = [];

// ✅ Connect to MCP Server via HTTP Streamable
export async function connectToMCP(serverUrl = "http://127.0.0.1:3005/mcp") {
  console.log(`Connecting to MCP HTTP server at ${serverUrl}...`);

  const transport = new StreamableHTTPClientTransport(serverUrl);
  await mcp.connect(transport);

  const toolsResult = await mcp.listTools();
  tools = toolsResult.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  console.log("✅ Connected to MCP HTTP server with tools:", tools.map((t) => t.name));
}

// === Main Function ===
export const getAiResponse = async (req, res) => {
  const { message, rootId } = req.body;

  if (!message || !rootId) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: question and rootId",
    });
  }

  try {
    console.log(`🛠 Fetching tree data for rootId: ${rootId}...`);
    const treeResult = await mcp.callTool({
      name: "ask-tree-question",
      arguments: { question: message, rootId },
    });

    const treeData = treeResult.content?.[0]?.text || "No data returned.";
  console.log(treeData)

    // === Now feed it into the model and ask the question ===
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
};

// === Auto-connect MCP once when server starts ===
(async () => {
  try {
    await connectToMCP("http://127.0.0.1:3005/mcp");
    console.log("🌐 MCP auto-connect complete.");
  } catch (err) {
    console.error("❌ Failed to connect to MCP server:", err.message);
  }
})();
