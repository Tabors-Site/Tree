import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import dotenv from "dotenv";
import { emitToUserAtRoot } from "../ws/websocket.js";

import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";

async function handleServerMessagePrompt(message) {
  // Ensure message is text
  console.log(message, "gi");
  if (message.content.type !== "text") return;

  console.log(message.content.text);

  // Generate text using OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-oss:20b", // or "gpt-4o" for higher quality
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: message.content.text },
    ],
  });

  const text = completion.choices[0]?.message?.content || "(no output)";
  return text;
}

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

mcp.setRequestHandler(CreateMessageRequestSchema, async (request) => {
  const texts = [];
  for (const message of request.params.messages) {
    const text = await handleServerMessagePrompt(message);
    if (text != null) texts.push(text);
  }

  return {
    role: "user",
    model: "gpt-oss:20b",
    stopReason: "endTurn",
    content: {
      type: "text",
      text: texts.join("\n"),
    },
  };
});

// Connect to the local Express MCP endpoint
export async function connectToMCP(serverUrl) {
  console.log(`Connecting to MCP HTTP server at ${serverUrl}...`);

  const transport = new StreamableHTTPClientTransport(serverUrl);
  await mcp.connect(transport);

  const [toolsResult, promptsResult, resourcesResult, templatesResult] =
    await Promise.all([
      mcp.listTools(),
      mcp.listPrompts(),
      mcp.listResources(),
      mcp.listResourceTemplates(),
    ]);

  tools = toolsResult.tools || [];
  prompts = promptsResult.prompts || [];
  resources = resourcesResult.resources || [];
  resourceTemplates = templatesResult.resourceTemplates || [];

  console.log(
    "Connected to MCP HTTP server with tools:",
    tools.map((t) => t.name)
  );
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
  const { message, rootId, username, userId } = req.body;
  if (!message || !rootId)
    return res
      .status(400)
      .json({ success: false, error: "Missing message or rootId" });

  try {
    let conversation = conversations.get(rootId) || [];
    const TREEBUILDER_PROMPT = `
[System Identity]
You are the Tree Helper — an evolving AI that tends, grows, and edits the Tree.

[Purpose]
Your goal is to interpret the user’s intent, locate the correct node within the hierarchy, and call the appropriate structured tool.

You are helping the user build and organize a hierarchical tree of data. Each node in the tree has the following structure:

name: the main title of the node

contributions: a record of all actions made on this node

versions[]: an array of node versions, where each version contains:

values/goals: numeric data in key:value maps relating to node. A goal must correspond to an existing value.

notes: textual data

schedule: time-related data

status: one of active, trimmed, or completed. Usually only highest prestige version is active, while rest are completed.

trimmed means the branch has been cut or pruned.

When processing a user request:

Interpret the intent behind the request.

Search the existing tree to find the most relevant node or branch, and get further context as needed.

Maintain the correct hierarchy — never add or modify data arbitrarily.

Once the correct node is identified, call the appropriate structured tool to perform the operation. Edit values/goals for numbers, notes for strings, schedule for time.

Source from the tree's data to gain context, and act on the tree's data while preserving systematic hierarchy (act on appropriate nodes).

[Awareness]
- You can fetch a branchs names/id's (hierarchical structure) with get-tree-branch
- You can fetch a nodes data (details) with get-node
- If you don’t know a node's version's values, goals, schedule, or notes, fetch the node details
- Always include a name field in nodeData when calling create-new-node-branch:
--Use note to add extra details beyond the name (if needed or asked)
--Define hierarchy through parent–child name relationships, and use other fields for node-specific details.
--Create branches at the appropriate scope for the task. Suggest/find placement with user, rcreate/refine branch request, create.
- If any tool or resource fails (e.g., system message includes ⚠️), tell the user what went wrong and suggest what to do next.”
- Tree (sometimes branch if not rootId) refers to a branch from a nodeId
- Node refers to a single node object on the Tree
- Nodes placement in the tree should be used for systematic building, while the data inside the node is the details


[Data Presentation Policy]
- Treat all "_id" fields as **backend identifiers only** — keep them internal and never expose them directly to the user.
- When presenting data to the user, do not not raw JSON.
- Convert JSON objects into **natural language explanations** suitable for an average person.
    - Example: Instead of showing {"status": "active", "schedule": "2025-05-01"}, say “This branch is active and scheduled for May 2025.”
- Use human-readable formatting for arrays and nested objects (e.g., bullet points or short sentences).
- When describing nodes, emphasize meaning and hierarchy rather than JSON structure.
- Only include identifiers like "_id" if explicitly requested by the system or developer, not by the user.

[Output Style]
- Use concise, natural, human-like sentences.
- Avoid code or JSON formatting unless explicitly asked.
- Focus on clarity and comprehension for non-technical users.
- Always double check with the user before executing a script or creating new branches


[User Info]
username = ${username}
userId = ${userId}
`.trim();

    // Reset long convo
    if (conversation.length >= MAX_MESSAGES) {
      console.log(`🔄 Reset conversation for ${rootId}`);
      conversation = [];
    }

    // First setup
    if (conversation.length === 0) {
      conversation.push({ role: "system", content: TREEBUILDER_PROMPT });
      const promptResult = await mcp.getPrompt({
        name: "root-workflow",
        arguments: { rootId },
      });
      let introMessages = promptResult.messages || [];

      if (promptResult.resources?.length) {
        for (const uri of promptResult.resources) {
          try {
            const resource = await mcp.readResource({ uri });
            introMessages.push({
              role: "system",
              content: `Resource [${uri}]:\n${resource.contents[0].text}`,
            });
          } catch (err) {
            console.warn(`⚠️ Could not read ${uri}:`, err.message);
          }
        }
      }

      introMessages = introMessages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : m.content?.text || JSON.stringify(m.content),
      }));

      conversation.push(...introMessages);
    }

    // Add user input
    conversation.push({ role: "user", content: message });

    let response;
    let iteration = 0;
    let keepLooping = true;

    while (keepLooping) {
      iteration++;
      console.log(
        `\n🌀 [LOOP ${iteration}] Sending conversation (${conversation.length} messages)`
      );
      console.log(
        conversation
          .map((m, i) => {
            let summary = "";
            if (typeof m.content === "string") {
              summary = m.content.slice(0, 120);
            } else if (m.tool_calls) {
              summary = `[Tool call → ${m.tool_calls
                .map((t) => t.function.name)
                .join(", ")}]`;
            } else {
              summary = "(no text)";
            }
            return `${i}. [${m.role}] ${summary}`;
          })
          .join("\n")
      );

      response = await openai.chat.completions.create({
        model: "gpt-oss:20b",
        messages: conversation,
        tools: [
          {
            type: "function",
            function: {
              name: "get-node",
              description:
                "Fetch a node’s data to extract version or structure.",
              parameters: {
                type: "object",
                properties: { nodeId: { type: "string" } },
                required: ["nodeId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get-tree-branch",
              description:
                "Fetch a tree branch to see hierarchy. Provides names, _ids, and children.",
              parameters: {
                type: "object",
                properties: { nodeId: { type: "string" } },
                required: ["nodeId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get-node-notes",
              description:
                "Fetch a tree branch to see hierarchy. Provides names, _ids, and children.",
              parameters: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  prestige: { type: "number" },
                },
                required: ["nodeId", "prestige"],
              },
            },
          },
          /*{
            type: "function",
            function: {
              name: "node-edit-pipeline",
              description: "Edit or annotate a node (add note, edit value, edit goal, etc).",
              parameters: {
                type: "object",
                properties: {
                  prompt: { type: "string" },
                  nodeId: { type: "string" },
                },
                required: ["prompt"],
              },
            },
          },*/
          {
            type: "function",
            function: {
              name: "edit-node-version-value",
              description:
                "Set or update a node’s property using setValueForNodeHelper.",
              parameters: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  key: { type: "string" },
                  value: { type: "number" },
                  prestige: { type: "number" },
                  userId: { type: "string" },
                },
                required: ["nodeId", "key", "value", "prestige", "userId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "edit-node-version-goal",
              description:
                "Set or update a node’s goal using setGoalForNodeHelper.",
              parameters: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  key: { type: "string" },
                  goal: { type: "number" },
                  prestige: { type: "number" },
                  userId: { type: "string" },
                },
                required: ["nodeId", "key", "goal", "prestige", "userId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "edit-node-or-branch-status",
              description:
                "Update a node or branch’s status (e.g., active, trimmed, completed).",
              parameters: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["active", "trimmed", "completed"],
                    description: "The new status to set.",
                  },
                  prestige: { type: "number" },
                  isInherited: {
                    type: "boolean",
                    description:
                      "If true, cascade the status change to child nodes.",
                  },
                  userId: { type: "string" },
                },
                required: ["nodeId", "status", "prestige", "userId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "add-node-prestige",
              description:
                "Increment a node’s prestige level and create a new version using addPrestigeHelper.",
              parameters: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  userId: { type: "string" },
                },
                required: ["nodeId", "userId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "execute-node-script",
              description:
                "Executes a stored script attached to a specific node using the secure sandbox system.",
              parameters: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  scriptName: {
                    type: "string",
                    description:
                      "specific name. found inside get-node scripts[]",
                  },
                  userId: { type: "string" },
                },
                required: ["nodeId", "scriptName", "userId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "edit-node-version-schedule",
              description:
                "Update a node’s schedule and reeffect time for a specific version.",
              parameters: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  prestige: { type: "number" },
                  newSchedule: {
                    type: "string",
                    description: "ISO date string for the new schedule.",
                  },
                  reeffectTime: {
                    type: "number",
                    description: "Time (in hours) before the next reeffect.",
                  },
                  userId: { type: "string" },
                },
                required: [
                  "nodeId",
                  "prestige",
                  "newSchedule",
                  "reeffectTime",
                  "userId",
                ],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "create-node-version-note",
              description: "Creates a new text note for a node.",
              parameters: {
                type: "object",
                properties: {
                  content: {
                    type: "string",
                    description: "The text content of the note.",
                  },
                  userId: {
                    type: "string",
                    description: "The ID of the user creating the note.",
                  },
                  nodeId: {
                    type: "string",
                    description: "The ID of the node the note belongs to.",
                  },
                  prestige: {
                    type: "number",
                    description: "The prestige version of the node",
                  },
                  isReflection: {
                    type: ["boolean", "string"],
                    description:
                      "Whether the note is a reflection. Typically false unless note is applied on a completed version.",
                  },
                },
                required: [
                  "content",
                  "userId",
                  "nodeId",
                  "prestige",
                  "isReflection",
                ],
              },
            },
          },

          {
            type: "function",
            function: {
              name: "delete-node-note",
              description: "Deletes a text note by its ID.",
              parameters: {
                type: "object",
                properties: {
                  noteId: {
                    type: "string",
                    description: "The ID of the note to delete.",
                  },
                },
                required: ["noteId"],
              },
            },
          },
          /*
          {
            type: "function",
            function: {
              name: "create-new-node",
              description: "Creates a new node in the tree",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Name of the new node." },
                  schedule: {
                    type: ["string", "null"],
                    description: "Optional ISO date for node scheduling.",
                  },
                  reeffectTime: {
                    type: "number",
                    description: "Time interval before reschedule on prestige.",
                  },
                  parentNodeID: {
                    type: ["string"],
                    description: "Parent node ID to build from",
                  },
                  userId: { type: "string", description: "The ID of the user creating the node." },
                  values: {
                    type: ["objcet", "null"],
                    additionalProperties: { type: "number" },
                    description: "Key-value pairs representing node numeric values.",
                  },
                  goals: {
                    type: ["objcet", "null"],
                    additionalProperties: { type: "number" },
                    description: "Key-value pairs representing node goal values.",
                  },
                },
                required: ["name", "userId", "parentNodeId"],
              },
            },
          }, */
          {
            type: "function",
            function: {
              name: "create-new-node-branch",
              description:
                "Creates a recursive branch of nodes starting from a parent node",
              parameters: {
                type: "object",
                properties: {
                  nodeData: {
                    type: "object",
                    description: "JSON structure of the node branch to create.",
                    properties: {
                      name: { type: "string", description: "Node name." },
                      note: {
                        type: ["string", "null"],
                        description: "Optional note included on node creation",
                      },
                      schedule: {
                        type: ["string", "null"],
                        description:
                          "Optional date for node scheduling (ISO 8601 string).",
                      },
                      reeffectTime: {
                        type: ["number", "null"],
                        description: "Reeffect time in hours.",
                      },
                      values: {
                        type: ["object", "null"],
                        additionalProperties: { type: "number" },
                        description: "Numeric key-value pairs for node values.",
                      },
                      goals: {
                        type: ["object", "null"],
                        additionalProperties: { type: "number" },
                        description: "Goal key-value pairs for the node.",
                      },

                      children: {
                        type: ["array", "null"],
                        description: "List of child nodes.",
                        items: { $ref: "#/components/schemas/NodeSchema" },
                      },
                    },
                    required: ["name"],
                  },
                  parentId: {
                    type: "string",
                    description: "Parent node ID for the root of this subtree.",
                  },
                  userId: {
                    type: "string",
                    description: "ID of the user creating the nodes.",
                  },
                },
                required: ["nodeData", "parentId", "userId"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "update-node-branch-parent-relationship",
              description:
                "Moves a node to a new parent within the tree hierarchy.",
              parameters: {
                type: "object",
                properties: {
                  nodeChildId: {
                    type: "string",
                    description: "The ID of the child node to move.",
                  },
                  nodeNewParentId: {
                    type: "string",
                    description: "The ID of the new parent node.",
                  },
                  userId: {
                    type: "string",
                    description: "The user performing the operation.",
                  },
                },
                required: ["nodeChildId", "nodeNewParentId", "userId"],
              },
            },
          },
        ],
      });

      const choice = response.choices?.[0];
      const toolCalls = choice?.message?.tool_calls || [];
      keepLooping = false;

      if (!toolCalls.length) {
        console.log(`🧠 No tool calls in loop ${iteration}`);
        break;
      }
      conversation.push({
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        const fn = call.function.name;
        const args = JSON.parse(call.function.arguments);
        console.log(`\n🧰 [TOOL ${fn}] args:`, args);

        try {
          if (fn === "get-tree-branch") {
            const uri = `tree://${args.nodeId}`;
            const treeResource = await mcp.readResource({ uri });
            const treeText = treeResource.contents[0].text;
            console.log(`📗 Loaded tree resource ${uri}`);
            emitToUserAtRoot(rootId, username, "treeResource", {
              uri,
              text: treeText,
            });
            conversation.push({
              role: "system",
              content: `Resource [${uri}]:\n${treeText}`,
            });
            keepLooping = true;
          }

          if (fn === "get-node") {
            const uri = `node://${args.nodeId}`;
            const nodeResource = await mcp.readResource({ uri });
            const nodeText = nodeResource.contents[0].text;
            console.log(`📗 Loaded node resource ${uri}`);
            emitToUserAtRoot(rootId, username, "nodeResource", {
              uri,
              text: nodeText,
            });
            conversation.push({
              role: "system",
              content: `Resource [${uri}]:\n${nodeText}`,
            });
            keepLooping = true;
            continue;
          }
          if (fn === "get-node-notes") {
            const uri = `node://${args.nodeId}/${args.prestige}`;
            const nodeResource = await mcp.readResource({ uri });
            const nodeText = nodeResource.contents[0].text;
            console.log(`📗 Loaded node notes resource ${uri}`);
            conversation.push({
              role: "system",
              content: `Resource [${uri}]:\n${nodeText}`,
            });
            keepLooping = true;
            continue;
          }

          // === Core edit tools ===
          if (
            [
              "edit-node-version-value",
              "edit-node-version-goal",
              "edit-node-or-branch-status",
              "add-node-prestige",
              "edit-node-version-schedule",
              "create-node-version-note",
              "execute-node-script",
              "get-node-notes",
              "delete-node-note",
              "update-node-branch-parent-relationship",
              "create-new-node-branch",
              "create-new-node",
            ].includes(fn)
          ) {
            const result = await mcp.callTool({ name: fn, arguments: args });
            console.log(`✅ ${fn} result:`, result);
            emitToUserAtRoot(rootId, username, "toolCall", {
              fn,
              args,
              result,
            });

            conversation.push({
              role: "system",
              content:
                result?.structuredContent?.message ||
                `Tool [${fn}] result:\n${JSON.stringify(result, null, 2)}`,
            });
            keepLooping = true; // ADD THIS LINE

            // 🌀 loop again if model needs another step
            if (/version/i.test(result?.content?.[0]?.text || "")) {
              conversation.push({
                role: "user",
                content: `Fetch node ${args.nodeId} to get prestige version before editing again. Use node.prestige by default, or a earlier version if requested.`,
              });
              keepLooping = true;
            }
          }
        } catch (err) {
          console.error(`❌ Tool ${fn} failed:`, err);
          conversation.push({
            role: "system",
            content: `⚠️ Tool ${fn} failed: ${err.message}`,
          });
        }
      }
    }
    // After tool execution loop finishes, generate a final natural language response
    if (!response?.choices?.[0]?.message?.content) {
      const finalResponse = await openai.chat.completions.create({
        model: "gpt-oss:20b",
        messages: conversation,
      });

      const finalMessage =
        finalResponse.choices?.[0]?.message?.content || "Done.";
      conversation.push({ role: "assistant", content: finalMessage });
      conversations.set(rootId, conversation);

      console.log("\n💬 Final user message:", finalMessage);
      return res.json({ success: true, answer: finalMessage, rootId });
    }

    const finalAnswer =
      response?.choices?.[0]?.message?.content ||
      "(Waiting for user-facing reply)";
    conversation.push({ role: "assistant", content: finalAnswer });
    conversations.set(rootId, conversation);

    console.log("\n🧠 Final AI Answer:", finalAnswer);
    console.log("🗒️ Full conversation length:", conversation.length);

    res.json({ success: true, answer: finalAnswer, rootId });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
