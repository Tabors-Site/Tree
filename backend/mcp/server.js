import { z } from "zod";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { setValueForNode, setGoalForNode } from "../core/values.js";

import { updateSchedule } from "../core/schedules.js";

import { editStatus, addPrestige } from "../core/statuses.js";
import { createNote, getNotes, deleteNoteAndFile } from "../core/notes.js";
import {
  createNewNode,
  createNodesRecursive,
  deleteNodeBranch,
  updateParentRelationship,
} from "../core/treeManagement.js";

import { executeScript, updateScript } from "../core/scripts.js";

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getTreeForAi, getNodeForAi } from "../controllers/treeDataFetching.js"; // import from your real backend

function getMcpServer() {
  const server = new McpServer({
    name: "tree-helper",
    version: "1.0.0",
    capabilities: {
      resources: { listChanged: true },
      tools: {},
      prompts: {},
    },
  });

  server.tool(
    "get-tree",
    "Fetch a branching tree outline (structure only). READ-ONLY.",
    {
      nodeId: z.string().describe("Node ID to fetch the tree branch from."),
    },
    async ({ nodeId }) => {
      const treeData = await getTreeForAi(nodeId);

      if (treeData == null) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Tree not found", nodeId },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(treeData, null, 2),
          },
        ],
      };
    },
    { readOnly: true }
  );

  server.tool(
    "get-node",
    "Fetch detailed information for a specific node. READ-ONLY.",
    {
      nodeId: z.string().describe("Node ID to fetch."),
    },
    async ({ nodeId }) => {
      const nodeData = await getNodeForAi(nodeId);

      if (nodeData == null) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Node not found", nodeId },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(nodeData, null, 2),
          },
        ],
      };
    },
    { readOnly: true }
  );

  server.tool(
    "entry-orchestrator",
    "Entry point for all tree-helper workflows. Presents available actions and establishes scope. READ-ONLY.",
    {
      rootId: z.string().describe("Root tree ID for context grounding."),
      userId: z.string().describe("User ID performing the operation."),
    },
    async ({ rootId, userId }) => {
      const treeData = await getTreeForAi(rootId);

      const instructions = `Use get-tree(${rootId}) always before get-node(nodeId) to get initial data.
      Find the nodes for them based on tree, and get-node to get deeper data. Try to not presend id's.
Wait for the user to choose an intent before proceeding. Do not call any other tools yet.

Here's what I can do. Please choose **one**:

1️⃣ **Create or restructure the tree**
   - Create a new branch
   - Add child nodes
   - Move nodes to a different parent
   - Discuss plans and proper tree placement

2️⃣ **Modify existing data**
   - Use get-node(id) to view current data
   - Usually use latest prestige version unless specified
   - Edit values or goals
   - Add or edit notes
   - Update status or schedule
   - Add a new prestige/version
   - Examine tree and offer node suggestions

3️⃣ **Explore or ask about data**
   - View the tree structure
   - Inspect a specific node
   - Understand progress, history, or relationships

4️⃣ **create, edit, or run a node's script**
   - if you call this, run the tool scripting-orchestrator(nodeid)

   5 **initiate be mode**
   -be guided through your tree in real time through the leaf nodes
   - if you call this, run the tool be-mode-orchestrator(nodeid)


Reply with the number, or describe what you want to do in words.`;

      return {
        content: [
          {
            type: "text",
            text: instructions,
          },
        ],
      };
    }
  );

  server.tool(
    "scripting-orchestrator",
    "Entry point for node script workflows. Establishes intent before any script actions.",
    {
      nodeId: z.string().describe("Node ID where scripts are stored."),
      userId: z.string().describe("User ID performing the operation."),
    },
    async ({ nodeId }) => {
      const instructions = `
     
      Use get-node(${nodeId}) to inspect existing scripts and node state.
Wait for the user to choose an intent before proceeding.
Do not call any other tools yet.

Here’s what I can help with. Choose **one**:

1️⃣ **Create a new script**
   - I will ask what behavior you want
   - I will use node-script-runtime-environment() to learn the functions/tools
   - I will write the script with you
   - Then save it using update-node-script

2️⃣ **Modify an existing script**
   - View current scripts on the node
   - Revise logic together
   - Save changes

3️⃣ **Execute a script**
   - Review what the script will do
   - Ask for confirmation
   - Run execute-node-script

Reply with the number, or describe what you want to do.`;

      return {
        content: [{ type: "text", text: instructions }],
      };
    }
  );

  server.tool(
    "be-mode-orchestrator",
    "Entry point for guided 'be mode' traversal of a node branch.",
    {
      nodeId: z.string().describe("Root node ID for the guided branch."),
      userId: z.string().describe("User ID performing the operation."),
    },
    async ({ nodeId }) => {
      const instructions = `
You are entering **Be Mode**.

OVERVIEW
- You will guide the user through a branch of the tree **one leaf node at a time**.
- The user experiences each node in **first person**.

INITIAL STEP
1. Use get-tree(${nodeId}) to inspect the full branch structure.
2. Identify the first **active leaf node** to guide.

FOR EACH NODE (repeat this cycle):
1. Use get-node(nodeId) to gain full context for the current node, and get-node-notes.
2. Explain the node's intention and plan to the user in **first-person language**.
3. Guide the user through *being* the node (reflection, action, embodiment).

OPTIONAL DURING THE NODE
- If the user asks for:
  • important wording or realizations → use create-node-version-note
  • numeric tracking → use values / goals
- If the user requests more explanation:
  1) Add more instructions via create-node-version-note, OR
  2) If deeper structure is needed, use create-node-branch to expand the tree,
     then continue guiding through the new nodes.

COMPLETION STEP (for the current node)
4. Upon completion:
   - Write a brief summary as a reflection note
     (use isReflection = true unless the node is trivial)
5. Change the node status to completed.

ADVANCE
6. Move to the next active node in the branch.
7. Repeat the cycle until no active nodes remain.

OPTIONAL
- If the process needs to restart or branch further,
  re-enter be-mode-orchestrator with a new nodeId or branchId.
`;

      return {
        content: [{ type: "text", text: instructions }],
      };
    }
  );

  server.tool(
    "node-script-runtime-environment",
    "Returns the execution environment, APIs, and rules for node scripts. READ-ONLY.",
    {
      nodeId: z.string().describe("Node ID whose runtime environment applies."),
    },
    async ({ nodeId }) => {
      const runtimeDocs = `
Node Script Runtime Environment

Node Object (Snapshot)

The \`node\` object represents the node state at script start.
It does NOT auto-update after mutations.
You must reason manually about state changes.

Core Properties

node._id
node.name
node.type
node.prestige
node.globalValues

Versions

node.versions[i]

i = 0 → first generation  
i = node.prestige → most recent

Version Properties

values
goals
schedule (ISO timestamp)
prestige
reeffectTime (hours)
status ("active" | "completed" | "trimmed")
dateCreated

Structure

node.scripts → [{ name, script }]
node.children → child node objects
node.parent → parent node ID or null
node.rootOwner → root owner ID or null

Built-in Functions

All functions run sequentially.
Failures do NOT stop later calls.

API

getApi() → Performs a GET request

Node Mutation

setValueForNode(nodeId, key, value, version)
setGoalForNode(nodeId, key, goal, version)
editStatusForNode(nodeId, status, version, isInherited)
addPrestigeForNode(nodeId)
updateScheduleForNode(nodeId, versionIndex, newSchedule, reeffectTime)

Example Pattern

// Increase wait time each prestige
let waitTime = node.versions[node.prestige].values.waitTime;
const newWaitTime = waitTime * 1.05;

addPrestigeForNode(node._id);

const now = new Date();
const newSchedule = new Date(
  now.getTime() + waitTime * 3600 * 1000
);

updateScheduleForNode(
  node._id,
  node.prestige + 1,
  newSchedule,
  0
);

setValueForNode(
  node._id,
  "waitTime",
  newWaitTime,
  node.prestige + 1
);

Execution Notes

• node reflects initial state only  
• After addPrestigeForNode, use node.prestige + 1  
• Time units are hours  
• Side effects still occur even if earlier calls fail
`;

      return {
        content: [
          {
            type: "text",
            text: runtimeDocs,
          },
        ],
      };
    }
  );

  server.tool(
    "update-node-script",
    "Creates or updates a script attached to a specific node.",
    {
      nodeId: z.string().describe("The ID of the node to update."),
      name: z.string().describe("The name of the script."),
      script: z
        .string()
        .max(2000)
        .describe("The script content (max 2000 characters)."),
    },
    async ({ nodeId, name, script }) => {
      const result = await updateScript({
        nodeId,
        name,
        script,
      });

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: result,
      };
    }
  );

  server.tool(
    "execute-node-script",
    "Always run scripting-orchestrator before to initiate. Executes a stored script attached to a specific node using the secure sandbox system.",
    {
      nodeId: z.string().describe("The ID of the node containing the script."),
      scriptName: z
        .string()
        .describe(
          "The name of the script to execute. Found inside of get-node"
        ),
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
      key: z
        .string()
        .describe("The key of the value you want to modify on the node."),
      value: z
        .number()
        .describe("The numeric value to assign to the given key."),
      prestige: z.number().describe("Prestige value in largest node version."),
      userId: z
        .string()
        .describe(
          "The ID of the user performing the edit. Used for contribution logging."
        ),
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
      key: z
        .string()
        .describe("The key of the goal you want to modify on the node."),
      goal: z
        .number()
        .describe("The numeric goal value to assign to the given key."),
      prestige: z
        .number()
        .describe("Prestige value representing the node version."),
      userId: z
        .string()
        .describe("The ID of the user performing the goal edit (for logging)."),
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
          content: [
            { type: "text", text: `❌ Failed to update goal: ${err.message}` },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "edit-node-or-branch-status",
    "Calls editStatus() to update a node's status (optionally recursively).",
    {
      nodeId: z
        .string()
        .describe("The unique ID of the node whose status will be edited."),
      status: z
        .enum(["active", "trimmed", "completed"])
        .describe("The new status to set for the node."),
      prestige: z
        .number()
        .describe("Prestige version number of the node to modify."),
      isInherited: z
        .boolean()
        .describe(
          "If true, propagate the status to child nodes recursively. Typically true unless otherwise specified."
        ),
      userId: z
        .string()
        .describe(
          "ID of the user making the status edit (for contribution logging)."
        ),
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
          content: [
            {
              type: "text",
              text: `❌ Failed to update status: ${err.message}`,
            },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "create-node-version-note",
    "Creates a new text note for a node.",
    {
      content: z.string().describe("The text content of the note."),
      userId: z.string().describe("The ID of the user creating the note."),
      nodeId: z.string().describe("The ID of the node the note belongs to."),
      prestige: z
        .number()
        .optional()
        .describe("The prestige version of the node"),
      isReflection: z
        .union([z.boolean(), z.string()])
        .optional()
        .describe(
          "Whether the note is a reflection. Typically false unless note is applied on a completed version."
        ),
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
          content: [
            { type: "text", text: `❌ Failed to create note: ${err.message}` },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "get-node-notes",
    "Retrieves notes associated with a specific node (and prestige version if provided).",
    {
      nodeId: z.string().describe("The ID of the node to fetch notes for."),
      prestige: z
        .number()
        .describe("Specific number prestige version to filter by"),
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
          content: [
            { type: "text", text: `❌ Failed to fetch notes: ${err.message}` },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

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
          content: [
            { type: "text", text: `❌ Failed to delete note: ${err.message}` },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "add-node-prestige",
    "Calls addPrestige() to increment a node's prestige level and create a new version.",
    {
      nodeId: z
        .string()
        .describe("The unique ID of the node to add prestige to."),
      userId: z
        .string()
        .describe(
          "The ID of the user performing the prestige action (for logging)."
        ),
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
          content: [
            { type: "text", text: `❌ Failed to add prestige: ${err.message}` },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "edit-node-version-schedule",
    "Calls updateSchedule() to modify a node version's schedule and reeffect time for a specific version.",
    {
      nodeId: z
        .string()
        .describe(
          "The unique ID of the node whose schedule should be updated."
        ),
      prestige: z
        .number()
        .describe(
          "The prestige of the version to update within the node's version history."
        ),
      newSchedule: z
        .string()
        .describe("The new schedule date/time (in ISO 8601 format)."),
      reeffectTime: z
        .number()
        .describe(
          "The reeffect time in hours (must be below 1,000,000). Added to schedule when prestiging for new version."
        ),
      userId: z
        .string()
        .describe(
          "The ID of the user making the schedule update (for contribution logging)."
        ),
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
          content: [
            {
              type: "text",
              text: `❌ Failed to update schedule: ${err.message}`,
            },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "create-new-node",
    "Creates a new node in the tree and logs a contribution entry.",
    {
      name: z.string().describe("Name of the new node."),
      schedule: z
        .date()
        .nullable()
        .optional()
        .describe("Optional date for node scheduling."),
      reeffectTime: z
        .number()
        .optional()
        .describe("Time interval before reeschedule on prestife."),
      parentNodeID: z.string().describe("Parent node ID ."),
      userId: z.string().describe("The ID of the user creating the node."),
      values: z
        .record(z.number())
        .default({})
        .nullable()
        .optional()
        .describe("Key-value pairs representing node number values."),
      goals: z
        .record(z.number())
        .default({})
        .nullable()
        .optional()
        .describe(
          "Key-value pairs representing node number goals attached to values."
        ),
      note: z
        .string()
        .optional()
        .describe("The text content of the optional note."),
    },
    async ({
      name,
      schedule,
      reeffectTime,
      parentNodeID,
      userId,
      values,
      goals,
      note,
    }) => {
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
          content: [
            { type: "text", text: `✅ Node '${name}' created successfully.` },
          ],
          structuredContent: node,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `❌ Failed to create node: ${err.message}` },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  const NodeSchema = z.lazy(() =>
    z.object({
      name: z.string().describe("Node name."),
      schedule: z
        .string()
        .nullable()
        .optional()
        .describe("Optional scheduling date/time (in ISO 8601 format)."),
      reeffectTime: z
        .number()
        .nullable()
        .optional()
        .describe("Reeffect time in hours."),
      values: z
        .record(z.number())
        .nullable()
        .optional()
        .describe("Numeric key-value pairs for node values."),
      goals: z
        .record(z.number())
        .nullable()
        .optional()
        .describe("Goal key-value pairs for the node."),
      note: z
        .string()
        .nullable()
        .optional()
        .describe("Optional note for new node made on creation."),
      children: z
        .array(NodeSchema)
        .nullable()
        .optional()
        .describe("List of child nodes."),
    })
  );

  server.tool(
    "create-new-node-branch",
    "Used to create new node branch off a current node to extend its structure",
    {
      nodeData: NodeSchema.describe(
        "JSON structure of the node branch to create."
      ),
      parentId: z
        .string()
        .nullable()
        .optional()
        .describe("Parent node ID for the root of this subtree."),
      userId: z.string().describe("ID of the user creating the nodes."),
    },
    async ({ nodeData, parentId, userId }) => {
      try {
        const rootId = await createNodesRecursive(nodeData, parentId, userId);
        return {
          content: [
            {
              type: "text",
              text: `✅ Recursive nodes created. Root ID: ${rootId}`,
            },
          ],
          structuredContent: { rootId },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to create recursive nodes: ${err.message}`,
            },
          ],
          structuredContent: { error: err.message },
        };
      }
    }
  );

  server.tool(
    "update-node-branch-parent-relationship",
    "Moves a node to a new parent within the tree hierarchy.",
    {
      nodeChildId: z.string().describe("The ID of the child node to move."),
      nodeNewParentId: z.string().describe("The ID of the new parent node."),
      userId: z
        .string()
        .describe("The user performing the operation (optional)."),
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
          content: [
            {
              type: "text",
              text: `❌ Failed to update parent: ${err.message}`,
            },
          ],
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

  return server;
}

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
