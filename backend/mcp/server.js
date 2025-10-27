import { z } from "zod";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  setValueForNode,
  setGoalForNode,
} from "../core/values.js"

import {
  updateSchedule
} from "../core/schedules.js"

import {
  editStatus,
  addPrestige,
} from "../core/statuses.js"
import { createNote, getNotes, deleteNoteAndFile } from "../core/notes.js";
import {
  createNewNode,
  createNodesRecursive,
  deleteNodeBranch,
  updateParentRelationship,
} from "../core/treeManagement.js";

import {
  executeScript,
} from "../core/scripts.js"

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getTreeForAi, getNodeForAi } from '../controllers/treeDataFetching.js'; // import from your real backend

// Create and configure the MCP server
function getMcpServer() {


  const server = new McpServer({
    name: "tree-helper", version: "1.0.0", capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    }
  });


  server.resource(
    "tree",
    new ResourceTemplate("tree://{rootId}", { list: undefined }),
    {
      description: "Get a trees structure from the database",
      title: "Tree Data",
      mimeType: "application/json",
    },
    async (uri, { rootId }) => {
      const treeData = await getTreeForAi(rootId);

      if (treeData == null) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({ error: "Tree not found", rootId }),
              mimeType: "application/json",
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(treeData, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );

  server.resource(
    "node-notes",
    new ResourceTemplate("node://{nodeId}/{prestige}", { list: undefined }),
    {
      description:
        "Retrieves notes associated with a specific node and prestige version.",
      title: "Node Notes",
      mimeType: "application/json",
    },
    async (uri, { nodeId, prestige }) => {
      try {
        const result = await getNotes({ nodeId, version: prestige });

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(result, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                { error: `❌ Failed to fetch notes: ${err.message}`, nodeId, prestige },
                null,
                2
              ),
              mimeType: "application/json",
            },
          ],
        };
      }
    }
  );


  /*
    server.tool(
      "node-edit-pipeline",
      "Edit or annotate a node. If nodeId is not given, routes to add-note, edit-value, or edit-goal.",
      {
        prompt: z.string(),
        nodeId: z.string(),
      },
      {
        title: "Node Edit",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      async params => {
        let { prompt, nodeId } = params
        console.log("🛠 node-edit called with:", params)
   
        if (!prompt || typeof prompt !== "string") {
          return {
            content: [{ type: "text", text: "❌ Error: Missing or invalid prompt." }],
            isError: true,
          }
        }
   
        // Infer action from the prompt
        let action = "add-note"
        const lower = prompt.toLowerCase()
        if (lower.includes("value")) action = "edit-value"
        else if (lower.includes("goal")) action = "edit-goal"
        else {
          try {
            const res = await server.server.request(
              {
                method: "sampling/createMessage",
                params: {
                  messages: [
                    {
                      role: "user",
                      content: {
                        type: "text",
                        text: `Given this user request: "${prompt}", determine which function to call.
                        add-note = if they want to add a string property
                        edit-value = if they want to add or edit a number property
                        edit-goal = if they want to edit a number property attached to a value
                        edit-schedule if they want to edit time value
                        Return exactly the name of one function key`,
                      },
                    },
                  ],
                  maxTokens: 400,
                },
              },
              CreateMessageResultSchema
            )
   
            if (res?.content?.type === "text") {
              const val = res.content.text.trim().toLowerCase()
              if (["add-note", "edit-value", "edit-goal"].includes(val)) action = val
            }
          } catch (err) {
            console.error("⚠️ decideAction failed:", err)
          }
        }
   
        const message = `use ${action} on node ${nodeId} based on: "${prompt}"`
        console.log("✅ node-edit result:", { nodeId, action, message })
   
        return {
          content: [
            {
              type: "resource_link",
              uri: `node://${nodeId}`,
              name: `Node ${nodeId}`,
              mimeType: "application/json",
              description: `Node involved in ${action}`,
            },
            { type: "text", text: message },
   
          ],
          structuredContent: { nodeId, action, message },
        }
      }
    ) */


  server.tool(
    "execute-node-script",
    "Executes a stored script attached to a specific node using the secure sandbox system.",
    {
      nodeId: z.string().describe("The ID of the node containing the script."),
      scriptName: z.string().describe("The name of the script to execute. Found inside of get-node"),
      userId: z.string().describe("The ID of the user executing the script."),
    },
    async ({ nodeId, scriptName, userId }) => {
      const result = await executeScript({
        nodeId,
        scriptName,
        userId,
      });


      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: result,
      };
    }
  );



  server.tool(
    "edit-node-version-value",
    "Calls setValueForNode() to update a node value.",
    {
      nodeId: z.string().describe("The unique ID of the node to edit."),
      key: z.string().describe("The key of the value you want to modify on the node."),
      value: z.number().describe("The numeric value to assign to the given key."),
      prestige: z.number().describe("Prestige value in largest node version."),
      userId: z.string().describe("The ID of the user performing the edit. Used for contribution logging."),
    },
    async ({ nodeId, key, value, prestige, userId }) => {
      const result = await setValueForNode({
        nodeId,
        key,
        value,
        version: prestige,
        userId,
      });

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: result,
      };
    }
  );

  server.tool(
    "edit-node-version-goal",
    "Calls setGoalForNode() to update a node goal. Goal must correspond to existing value.",
    {
      nodeId: z.string().describe("The unique ID of the node to edit."),
      key: z.string().describe("The key of the goal you want to modify on the node."),
      goal: z.number().describe("The numeric goal value to assign to the given key."),
      prestige: z.number().describe("Prestige value representing the node version."),
      userId: z.string().describe("The ID of the user performing the goal edit (for logging)."),
    },
    async ({ nodeId, key, goal, prestige, userId }) => {
      try {
        const result = await setGoalForNode({
          nodeId,
          key,
          goal,
          version: prestige,
          userId,
        });

        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to update goal: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "edit-node-or-branch-status",
    "Calls editStatus() to update a node's status (optionally recursively).",
    {
      nodeId: z.string().describe("The unique ID of the node whose status will be edited."),
      status: z.enum(["active", "trimmed", "completed"]).describe(
        "The new status to set for the node."
      ),
      prestige: z.number().describe("Prestige version number of the node to modify."),
      isInherited: z
        .boolean()
        .describe(
          "If true, propagate the status to child nodes recursively. Typically true unless otherwise specified."
        ),
      userId: z.string().describe("ID of the user making the status edit (for contribution logging)."),
    },
    async ({ nodeId, status, prestige, isInherited, userId }) => {
      try {
        const result = await editStatus({
          nodeId,
          status,
          version: prestige,
          isInherited,
          userId,
        });

        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to update status: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );


  // 🧠 Tool: Create Note (text-only)
  server.tool(
    "create-node-version-note",
    "Creates a new text note for a node.",
    {
      content: z.string().describe("The text content of the note."),
      userId: z.string().describe("The ID of the user creating the note."),
      nodeId: z.string().describe("The ID of the node the note belongs to."),
      prestige: z.number().optional().describe("The prestige version of the node"),
      isReflection: z
        .union([z.boolean(), z.string()])
        .optional()
        .describe("Whether the note is a reflection. Typically false unless note is applied on a completed version."),
    },
    async ({ content, userId, nodeId, prestige, isReflection }) => {
      try {
        const result = await createNote({
          contentType: "text",
          content,
          userId,
          nodeId,
          version: prestige,
          isReflection,
        });

        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to create note: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  // 📜 Tool: Get Notes
  server.tool(
    "get-node-notes",
    "Retrieves notes associated with a specific node (and prestige version if provided).",
    {
      nodeId: z.string().describe("The ID of the node to fetch notes for."),
      prestige: z.string().describe("Specific number prestige version to filter by"),
    },
    async ({ nodeId, prestige }) => {
      try {
        const result = await getNotes({ nodeId, version: prestige });

        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to fetch notes: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  // 🗑️ Tool: Delete Note
  server.tool(
    "delete-node-note",
    "Deletes a text note by its ID.",
    {
      noteId: z.string().describe("The ID of the note to delete."),
    },
    async ({ noteId }) => {
      try {
        const result = await deleteNoteAndFile({ noteId });

        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to delete note: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "add-node-prestige",
    "Calls addPrestige() to increment a node's prestige level and create a new version.",
    {
      nodeId: z.string().describe("The unique ID of the node to add prestige to."),
      userId: z.string().describe("The ID of the user performing the prestige action (for logging)."),
    },
    async ({ nodeId, userId }) => {
      try {
        const result = await addPrestige({ nodeId, userId });

        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to add prestige: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "edit-node-version-schedule",
    "Calls updateSchedule() to modify a node version's schedule and reeffect time for a specific version.",
    {
      nodeId: z.string().describe("The unique ID of the node whose schedule should be updated."),
      prestige: z.number().describe(
        "The prestige of the version to update within the node's version history."
      ),
      newSchedule: z.string().describe("The new schedule date/time (in ISO 8601 format)."),
      reeffectTime: z
        .number()
        .describe(
          "The reeffect time in hours (must be below 1,000,000). Added to schedule when prestiging for new version."
        ),
      userId: z.string().describe("The ID of the user making the schedule update (for contribution logging)."),
    },
    async ({ nodeId, prestige, newSchedule, reeffectTime, userId }) => {
      try {
        const result = await updateSchedule({
          nodeId,
          versionIndex: prestige,
          newSchedule,
          reeffectTime,
          userId,
        });

        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to update schedule: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.resource(
    "node",
    new ResourceTemplate("node://{nodeId}", { list: undefined }),
    {
      description: "Fetch a specific node (with notes and versions) within a tree for more context.",
      title: "Node Resource",
      mimeType: "application/json",
    },
    async (uri, { nodeId }) => {
      try {
        const nodeData = await getNodeForAi(nodeId);

        if (nodeData == null) {
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify({ error: "Node not found", nodeId }),
                mimeType: "application/json",
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(nodeData, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      } catch (error) {
        console.error("Error fetching node resource:", error);

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({
                error: "Server error while fetching node",
                nodeId,
              }),
              mimeType: "application/json",
            },
          ],
        };
      }
    }
  );





  // 🧩 Create a single new node
  server.tool(
    "create-new-node",
    "Creates a new node in the tree and logs a contribution entry.",
    {
      name: z.string().describe("Name of the new node."),
      schedule: z.date().nullable().optional().describe("Optional date for node scheduling."),
      reeffectTime: z.number().optional().describe("Time interval before reeschedule on prestife."),
      parentNodeID: z.string().describe("Parent node ID ."),
      userId: z.string().describe("The ID of the user creating the node."),
      values: z.record(z.number()).default({}).nullable().optional().describe("Key-value pairs representing node number values."),
      goals: z.record(z.number()).default({}).nullable().optional().describe("Key-value pairs representing node number goals attached to values."),
      note: z.string().optional().describe("The text content of the optional note."),

    },
    async ({ name, schedule, reeffectTime, parentNodeID, userId, values, goals }) => {
      try {
        const node = await createNewNode(
          name,
          schedule,
          reeffectTime,
          parentNodeID,
          false,
          userId,
          values,
          goals,
          note
        );

        return {
          content: [{ type: "text", text: `✅ Node '${name}' created successfully.` }],
          structuredContent: node,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to create node: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );



  const NodeSchema = z.lazy(() =>
    z.object({
      name: z.string().describe("Node name."),
      schedule: z.string().nullable().optional()
        .describe("Optional scheduling date/time (in ISO 8601 format)."),
      reeffectTime: z.number().nullable().optional()
        .describe("Reeffect time in hours."),
      values: z.record(z.number()).nullable().optional()
        .describe("Numeric key-value pairs for node values."),
      goals: z.record(z.number()).nullable().optional()
        .describe("Goal key-value pairs for the node."),
      note: z.string().nullable().optional()
        .describe("Optional note for new node made on creation."),
      children: z.array(NodeSchema).nullable().optional()
        .describe("List of child nodes."),
    })
  );

  // 🌳 Create a full recursive node tree
  server.tool(
    "create-new-node-branch",
    "Used to create new node branch off a current node to extend its structure",
    {
      nodeData: NodeSchema.describe("JSON structure of the node branch to create."),
      parentId: z.string().nullable().optional().describe("Parent node ID for the root of this subtree."),
      userId: z.string().describe("ID of the user creating the nodes."),
    },
    async ({ nodeData, parentId, userId }) => {
      try {
        const rootId = await createNodesRecursive(nodeData, parentId, userId);
        return {
          content: [{ type: "text", text: `✅ Recursive nodes created. Root ID: ${rootId}` }],
          structuredContent: { rootId },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to create recursive nodes: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );



  // 🔁 Update a node’s parent relationship
  server.tool(
    "update-node-branch-parent-relationship",
    "Moves a node to a new parent within the tree hierarchy.",
    {
      nodeChildId: z.string().describe("The ID of the child node to move."),
      nodeNewParentId: z.string().describe("The ID of the new parent node."),
      userId: z.string().describe("The user performing the operation (optional)."),
    },
    async ({ nodeChildId, nodeNewParentId, userId }) => {
      try {
        const { nodeChild, nodeNewParent } = await updateParentRelationship(
          nodeChildId,
          nodeNewParentId,
          userId
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Node '${nodeChild.name}' successfully moved under '${nodeNewParent.name}'.`,
            },
          ],
          structuredContent: { nodeChild, nodeNewParent },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to update parent: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  /*
  // 🗑️ Delete a node branch
  server.tool(
    "delete-node-branch",
    "Deletes a node and removes all references from its parent and children.",
    {
      nodeId: z.string().describe("The ID of the node to delete."),
      userId: z.string().optional().describe("The user performing the deletion (optional)."),
    },
    async ({ nodeId, userId }) => {
      try {
        const deleted = await deleteNodeBranch(nodeId, userId);
        return {
          content: [{ type: "text", text: `🗑️ Node '${deleted.name}' deleted successfully.` }],
          structuredContent: deleted,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Failed to delete node: ${err.message}` }],
          structuredContent: { error: err.message },
        };
      }
    }
  );
  */


  server.prompt(
    "root-workflow",
    "Main workflow for root perspective operations",
    {
      rootId: z.string(),
    },
    ({ rootId }) => ({
      resources: [
        `tree://${rootId}`,              // main root tree
      ],
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `
- **Root ID:** ${rootId}

Now, handle this request:
`,
          },
        },

      ],
    })
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

export { getMcpServer, handleMcpRequest };
