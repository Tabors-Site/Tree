import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import dotenv from "dotenv";

dotenv.config();

const conversations = new Map();

// === OpenAI/Ollama Setup ===
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

// === MCP Client Setup ===
const mcp = new Client(
  { name: "tree-helper-client", version: "1.0.0" },
  { capabilities: { sampling: {} } }
);

let tools = [];
let resources = [];
let prompts = [];
let resourceTemplates = [];

// Connect to the local Express MCP endpoint
export async function connectToMCP(serverUrl) {
  console.log(`Connecting to MCP HTTP server at ${serverUrl}...`);

  const transport = new StreamableHTTPClientTransport(serverUrl);
  await mcp.connect(transport);

  const [/*toolsResult,*/ promptsResult, resourcesResult, templatesResult] =
    await Promise.all([
      // mcp.listTools(),
      mcp.listPrompts(),
      mcp.listResources(),
      mcp.listResourceTemplates(),
    ]);

  // tools = toolsResult.tools || [];
  prompts = promptsResult.prompts || [];
  resources = resourcesResult.resources || [];
  resourceTemplates = templatesResult.resourceTemplates || [];

  // console.log("Connected to MCP HTTP server with tools:", tools.map((t) => t.name));
  console.log(
    "Available MCP resources:",
    resources.map((r) => r.uri)
  );
  console.log(
    "Prompts:",
    prompts.map((p) => `${p.name}: ${p.description}`)
  );

  console.log(
    "Resource templates:",
    resourceTemplates.map((rt) => rt.uriTemplate)
  );
}

const MAX_MESSAGES = 20; // when reached, restart conversation

export async function getMCPResponse(req, res) {
  const { message, rootId } = req.body;

  if (!message || !rootId) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: message and rootId",
    });
  }

  try {
    let conversation = conversations.get(rootId) || [];

    // 🧹 Step 1: Reset conversation if too long
    if (conversation.length >= MAX_MESSAGES) {
      console.log(
        `🔄 Conversation for ${rootId} exceeded ${MAX_MESSAGES} messages. Resetting...`
      );
      conversation = [];
    }

    // 🌱 Step 2: If first message, fetch intro prompt + resources
    if (conversation.length === 0) {
      console.log(
        "🌱 First turn — fetching MCP intro prompt + tree resource..."
      );
      const promptResult = await mcp.getPrompt({
        name: "root-workflow",
        arguments: { user_request: message, rootId },
      });

      let introMessages = promptResult.messages || [];

      // Include tree/resource context only once
      if (promptResult.resources?.length) {
        console.log("📚 Found resources in prompt:", promptResult.resources);
        for (const uri of promptResult.resources) {
          try {
            const resource = await mcp.readResource({ uri });
            introMessages.push({
              role: "system",
              content: `Resource [${uri}]:\n${resource.contents[0].text}`,
            });
          } catch (err) {
            console.warn(`⚠️ Could not read resource ${uri}:`, err.message);
          }
        }
      }

      // Normalize content
      introMessages = introMessages.map((m) => {
        if (typeof m.content === "string")
          return { role: m.role, content: m.content };
        if (m.content?.type === "text")
          return { role: m.role, content: m.content.text };
        return { role: m.role, content: JSON.stringify(m.content) };
      });

      // Store intro messages as system context
      conversation.push(...introMessages);
    }

    // 🗣️ Step 3: Add new user message
    conversation.push({ role: "user", content: message });

    // 🧾 Step 4: Log current state
    console.log("\n===============================");
    console.log(
      `🗒️ Message array for rootId ${rootId} (${conversation.length} total):`
    );
    conversation.forEach((m, i) => {
      console.log(
        `${i}. [${m.role}] ${m.content.slice(0, 100).replace(/\n/g, " ")}${
          m.content.length > 100 ? "..." : ""
        }`
      );
    });
    console.log("===============================\n");

    // 🧠 Step 5: Send conversation to model with resource tool
    let response = await openai.chat.completions.create({
      model: "gpt-oss:20b",
      messages: conversation,
      tools: [
        {
          type: "function",
          function: {
            name: "get_tree_node",
            description:
              "Fetch a specific node within a tree when additional context is needed.",
            parameters: {
              type: "object",
              properties: {
                nodeId: {
                  type: "string",
                  description: "The ID of the node to fetch.",
                },
              },
              required: ["nodeId"],
            },
          },
        },
      ],
    });

    // 🧩 Step 6: Handle tool calls (assistant requests a node resource)
    const choice = response.choices?.[0];
    if (choice?.message?.tool_calls?.length) {
      for (const call of choice.message.tool_calls) {
        if (call.function.name === "get_tree_node") {
          const { nodeId } = JSON.parse(call.function.arguments);
          const uri = `tree://${rootId}/node/${nodeId}`;
          console.log(`🌿 Assistant requested resource: ${uri}`);

          try {
            const nodeResource = await mcp.readResource({ uri });
            const nodeContent = nodeResource.contents[0].text;

            // Add node resource as new system context
            conversation.push({
              role: "system",
              content: `Resource [${uri}]:\n${nodeContent}`,
            });

            // Re-run model with new resource context
            response = await openai.chat.completions.create({
              model: "gpt-oss:20b",
              messages: conversation,
            });
          } catch (err) {
            console.warn(
              `⚠️ Could not read node resource ${uri}:`,
              err.message
            );
            conversation.push({
              role: "system",
              content: `⚠️ Failed to fetch resource ${uri}: ${err.message}`,
            });
          }
        }
      }
    }

    // 🧠 Step 7: Get final answer
    const answer =
      response.choices?.[0]?.message?.content || "No response generated.";

    // 💾 Step 8: Append assistant reply & store
    conversation.push({ role: "assistant", content: answer });
    conversations.set(rootId, conversation);

    console.log("🧠 AI Answer:", answer);

    // ✅ Return to client
    res.json({ success: true, answer, rootId });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
