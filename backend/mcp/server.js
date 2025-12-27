import { z } from "zod";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { setValueForNode, setGoalForNode } from "../core/values.js";

import {
  getContributionsByUser,
  getContributions,
} from "../core/contributions.js";

import { updateSchedule } from "../core/schedules.js";

import { editStatus, addPrestige } from "../core/statuses.js";
import {
  createNote,
  getNotes,
  getAllNotesByUser,
  getAllTagsForUser,
  deleteNoteAndFile,
  searchNotesByUser,
} from "../core/notes.js";
import { getRawIdeas, convertRawIdeaToNote } from "../core/rawIdea.js";
import {
  createNewNode,
  createNodesRecursive,
  deleteNodeBranch,
  updateParentRelationship,
  editNodeName,
} from "../core/treeManagement.js";

import { getRootNodesForUser } from "../core/treeFetch.js";

import { executeScript, updateScript } from "../core/scripts.js";

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getTreeForAi, getNodeForAi } from "../controllers/treeDataFetching.js"; // import from your real backend

const TimeWindowSchema = {
  startDate: z
    .string()
    .optional()
    .describe("ISO date/time. Include items created on or after this time."),
  endDate: z
    .string()
    .optional()
    .describe("ISO date/time. Include items created on or before this time."),
};
const server = getMcpServer();
const transport = new StreamableHTTPServerTransport({});
function getMcpServer() {
  const server = new McpServer({
    name: "tree-helper",
    protocolVersion: "2025-11-25",
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
      filters: z
        .object({
          active: z.boolean().optional(),
          trimmed: z.boolean().optional(),
          completed: z.boolean().optional(),
        })
        .optional()
        .describe(
          "Optional filtering: { active, trimmed, completed }.  call others false if only trying for one"
        ),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, filters }) => {
      const mergedFilter = !filters
        ? {
            active: true,
            trimmed: false,
            completed: true,
          }
        : {
            active: !!filters.active,
            trimmed: !!filters.trimmed,
            completed: !!filters.completed,
          };

      const treeData = await getTreeForAi(nodeId, mergedFilter);

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
    }
  );

  server.tool(
    "get-node",
    "Fetch detailed information for a specific node. READ-ONLY.",
    {
      nodeId: z.string().describe("Node ID to fetch."),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    }
  );

  server.tool(
    "tree-start",
    "Entry point for all tree-helper workflows. Loads tree + provides system instructions. READ-ONLY.",
    {
      rootId: z.string(),
      userId: z.string(),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ rootId, userId }) => {
      const systemInstructions = `
  Use get-tree(${rootId}) always before get-node(nodeId) to get initial data.
  Find the nodes for the user request based on the tree, and use get-node when deeper data is needed.
  Avoid presenting raw IDs when possible.


  Here are the available actions. 

  1️⃣ **Create or restructure the tree**
    - Create a new branch
    - Add child nodes
    - Move nodes
    - Discuss structure or placement

  2️⃣ **Modify existing data**
    - Change Node Names
    - View node data
    - Update values, goals, status, notes
    - Add prestige/version
    - Suggest nodes or improvements

  3️⃣ **Explore or ask about data**
    - View the tree
    - Inspect nodes
    - Understand progress or relationships

  4️⃣ **Create, edit, or run a node’s script**
    - Will trigger scripting-orchestrator(nodeId)

  5 **Examine User Profile**
    - Check your notes, mail, and contribution history


  6 **Initiate BE mode**
    - Guided real-time traversal of leaf nodes
    - Will trigger be-mode-orchestrator(nodeId)

    7️⃣ **Process raw ideas (Inbox → Tree)**
  - Review unplaced raw ideas
  - Decide where they belong
  - Place them into the tree with confirmation
  - Will trigger raw-idea-filter-orchestrator



  Call the tool get-tree(id) and tree-actions-menu and then present me the menu with a short paragraphed introductory summary of my tree so far.
  `;

      // IMPORTANT: This tool returns the context,
      // but does NOT itself call any tool.
      return {
        content: [{ type: "text", text: systemInstructions }],
      };
    }
  );

  server.tool(
    "tree-actions-menu",
    "Waits for decision on intensions menu. Read-only to decide next choice.",
    {
      rootId: z.string(),
      userId: z.string(),
      treeData: z.any(),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({}) => {
      return {
        content: [
          {
            type: "text",
            text: `Ask me what I want to do on Tree menu. Call these functions depending on my intent

                1️⃣ **Create or restructure the tree** = tree-structure-orchestrator

  2️⃣ **Modify existing data**
    - View tree/node data to understand where to place data = combinations of get-tree for structure, get-node for details,
    - Update values, goals, status, notes = edit-node-version-values, edit-node-version-goals, edit-node-or-branch-status,  create-node-version-note
    - Add prestige/version = add-node-prestige
    - Change a nods name = edit-node-name
    - Suggest nodes or improvements
    -(useful tool if you need to undo stuff) = get-node-contributions

  3️⃣ **Explore or ask about data**
    - View the tree = get-tree
    - Inspect nodes = get-node
    - Understand progress or relationships
    - see history of node actions = get-node-contributions

  4️⃣ **Create, edit, or run a node’s script** = scripting-orchestrator(nodeId)

  5 **Examine User Profile**
      - ensure you knw which I want
    - Check your recent notes = get-unsearched-notes-by-user,
    - search for notes based on content = get-searched-notes-by-user
    - check your mail = get-all-tags-by-user,
    - check your contribution history = get-contributions-by-user


  6. **Initiate BE mode**
    - Guided real-time traversal of leaf nodes
    - Will trigger be-mode-orchestrator(nodeId)

    7️⃣ **Process raw ideas**
  - Review raw ideas inbox
  - Decide correct node placement
  - Confirm before converting
  - = raw-idea-filter-orchestrator

  `,
          },
        ],
      };
    }
  );
  server.tool(
    "raw-idea-filter-orchestrator",
    "Guides filtering and placing raw ideas into the tree. READ-ONLY.",
    {
      userId: z
        .string()
        .describe("The user whose raw ideas will be processed."),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({}) => {
      const instructions = `
You are entering **Raw Idea Filtering Mode**.

GOAL  
Help the user take an unplaced raw idea and decide the *best hierarchical location* for it in their tree.
You must NEVER convert a raw idea automatically. Always wait for confirmation.

STEP-BY-STEP PROCESS  

1️⃣ **Load Raw Ideas**
- Call get-raw-ideas-by-user(userId)
- Present a short list (titles or summaries).
- Ask the user which raw idea they want to process.
- If only one exists, you may auto-select it.

2️⃣ **Load User Roots**
- Call get-root-nodes-by-user(userId)
- If multiple roots exist:
  - Choose the most relevant root based on the raw idea
  - Ask the user to confirm or override

3️⃣ **Inspect Tree Structure**
- Call get-tree(rootId)
- Analyze where the raw idea logically belongs:

4️⃣ **Determine Best Placement**
- Decide:
  - Target node ID
- Explain *why* this location fits:
  - Purpose
  - Scope
  - Hierarchical logic

5️⃣ **Present Placement Proposal**
- Clearly state:
  - Raw idea summary
  - Target node name
- Ask the user explicitly:

  “Would you like me to convert this raw idea into a note under <Node Name>?”

6️⃣ **Wait for Confirmation**
- DO NOT call transfer-raw-idea-to-note yet.
- Only proceed if the user explicitly agrees.
- If confirmed:
  → call transfer-raw-idea-to-note(rawIdeaId, userId, nodeId)

RULES  
- Never guess silently.
- Never place without consent.
- Never skip tree inspection.
- Prefer explaining structure over speed.
`;

      return {
        content: [{ type: "text", text: instructions }],
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

    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    "tree-structure-orchestrator",
    "Entry point for creating or modifying hierarchical tree structures.",
    {
      rootId: z
        .string()
        .describe("The ID of the root or starting node of the tree."),
      userId: z.string().describe("The user performing the operation."),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ rootId }) => {
      const instructions = `
  Inspect the structure of that tree.
  Ask me what action I want to take.


  1️⃣ **Create tree branches**
    - Create new branches (create-node-branch)
    - Add child nodes (create-node)
    
    if it is this one, please ensure I am placing it onto the structure properly, and if it doesn't fit, extend new branches from root nodes or tell me it doesnt fit root.
        We can discuss placement and branch structure before the tools are called.
  2️⃣ **Move nodes/restructure**
    - Change parent/child relationships (update-node-branch-parent-relationship)
    - Reorder hierarchyy
    - Relocate a subtree

  Ask for specifics, or give suggestions if none.
    just fix up the trees hierarchy so things are in proper logical parent-child order.



  Ask to reply with a number or figure out intent, and then start appropriate tools.`;

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
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId }) => {
      const instructions = `You are entering **Be Mode**.

  OVERVIEW
  - Guide the user through a branch of the tree **one active leaf node at a time**.
  - Present each node clearly so the user can understand its purpose and work with it directly.

  INITIAL STEP
  1. Use get-tree(${nodeId}) to view the full branch structure.
  2. Identify the first **active leaf node** to begin with. Do not present nodes that have a status as completed (skip).

  FOR EACH NODE (repeat this cycle):
  1. Use get-node(nodeId) to load full context for the current active node.
  2. Explain the node’s intention, purpose, and planned actions in a simple, focused way.
  3. Walk the user through the node so they can clearly see what it represents and what it asks of them.
  4. Use any relevant tools as needed to help them work with or update the node.

  OPTIONAL DURING THE NODE
  - If the user expresses something worth recording (you are their data tracker):
    • important wording or insights → create-node-version-note, and try to copy exact wording or idea without changing 
    • numerical or measurable details → update values/goals
  - If the user wants to expand or clarify the plan:
    • use create-node-branch to add deeper steps  
      then continue guiding through the newly created nodes.

  COMPLETION STEP (for the current node)
  5. When the node’s work is complete:
    - Write a brief summary as a reflection note  and/or ensure you fill all the values/goals data if it has any
      (use isReflection = true unless the node is trivial)
  6. Mark the node as completed.

  ADVANCE
  7. Move to the next active node in the branch.
  8. Continue until there are no active nodes remaining.

  OPTIONAL
  - If you need to restart or shift direction,
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
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, name, script }) => {
      const result = await updateScript({
        nodeId,
        name,
        script,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ nodeId, scriptName, userId }) => {
      const result = await executeScript({
        nodeId,
        scriptName,
        userId,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "edit-node-version-goal",
    "Calls setGoalForNode() to update a nodes goal. A goal represents the number a value needs to reach, and should always copy an exisiting value key.",
    {
      nodeId: z.string().describe("The unique ID of the node to edit."),
      key: z
        .string()
        .describe(
          "The key of the goal you want to modify on the node. It always matches an existing value in the nodes verion."
        ),
      goal: z
        .number()
        .describe(
          "The numeric goal value to assign to the given key. What the corresponding value needs to reach."
        ),
      prestige: z
        .number()
        .describe("Prestige value representing the node version."),
      userId: z
        .string()
        .describe("The ID of the user performing the goal edit (for logging)."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `❌ Failed to update goal: ${err.message}` },
          ],
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to update status: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "create-node-version-note",
    "Creates a new text note for a node. Please confirm exact wording of content and do not add anything unless asked",
    {
      content: z.string().describe("The text content of the note."),
      userId: z.string().describe("The ID of the user creating the note."),
      nodeId: z.string().describe("The ID of the node the note belongs to."),
      prestige: z
        .number()
        .optional()
        .describe("The prestige version of the node"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ content, userId, nodeId, prestige }) => {
      try {
        const result = await createNote({
          contentType: "text",
          content,
          userId,
          nodeId,
          version: prestige,
          isReflection: true, // 🔥 Always included, always true, backend safe
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Failed to create note: ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "get-node-notes",
    "Retrieves notes associated with a specific node's prestige.",
    {
      nodeId: z.string().describe("The ID of the node to fetch notes for."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit for the number of most recent notes"),

      prestige: z
        .number()
        .describe("Specific number prestige version to filter by"),
      ...TimeWindowSchema,
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, prestige, limit, startDate, endDate }) => {
      try {
        const result = await getNotes({
          nodeId,
          version: prestige,
          limit,
          startDate,
          endDate,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `❌ Failed to fetch notes: ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "get-unsearched-notes-by-user",
    "Fetches all notes written by a specific user (optionally limited to the most recent N). Recommend to use limit 10 or less. Use get-searched-notes-by-user... if looking for specifics.",
    {
      userId: z.string().describe("The ID of the user whose notes to fetch."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit: number of most recent notes to return."),
      ...TimeWindowSchema,
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ userId, limit, startDate, endDate }) => {
      if (typeof limit === "number" && limit > 20) {
        limit = 20;
      }

      try {
        const result = await getAllNotesByUser(
          userId,
          limit,
          startDate,
          endDate
        );
        const trimmedNotes = result.notes.slice(0, 20);

        return {
          content: [
            { type: "text", text: JSON.stringify(trimmedNotes, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to fetch user notes: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "get-all-tags-for-user",
    "Fetches all notes where a specific user was tagged (optionally limited to the most recent N). May be referenced as mail",
    {
      userId: z.string().describe("The ID of the user who was tagged."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit: number of most recent tagged notes."),
      ...TimeWindowSchema,
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ userId, limit, startDate, endDate }) => {
      if (typeof limit === "number" && limit > 20) {
        limit = 20;
      }

      try {
        const result = await getAllTagsForUser(
          userId,
          limit,
          startDate,
          endDate
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to fetch tagged notes: ${err.message}`,
            },
          ],
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
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ noteId }) => {
      try {
        const result = await deleteNoteAndFile({ noteId });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `❌ Failed to delete note: ${err.message}` },
          ],
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ nodeId, userId }) => {
      try {
        const result = await addPrestige({ nodeId, userId });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `❌ Failed to add prestige: ${err.message}` },
          ],
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to update schedule: ${err.message}`,
            },
          ],
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
          content: [{ type: "text", text: JSON.stringify(node, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `❌ Failed to create node: ${err.message}` },
          ],
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ nodeData, parentId, userId }) => {
      try {
        const { rootId, rootName, totalCreated } = await createNodesRecursive(
          nodeData,
          parentId,
          userId
        );
        return {
          content: [
            {
              type: "text",
              text:
                `Successfully created a new node branch!\n\n` +
                `• Root Node: "${rootName}"\n` +
                `• Root ID: ${rootId}\n` +
                `• Total Nodes Created: ${totalCreated}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to create recursive nodes: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "edit-node-name",
    "Renames an existing node and logs the name change.",
    {
      nodeId: z.string().describe("The ID of the node being renamed."),
      newName: z.string().describe("The new name to assign to the node."),
      userId: z.string().describe("The ID of the user performing the edit."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, newName, userId }) => {
      try {
        const { oldName, newName: updatedName } = await editNodeName({
          nodeId,
          newName,
          userId,
        });

        return {
          content: [
            {
              type: "text",
              text: `Node: ${nodeId} was renamed successfully from "${oldName}" to "${updatedName}".`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to rename node: ${err.message}`,
            },
          ],
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
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to update parent: ${err.message}`,
            },
          ],
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
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `❌ Failed to delete node: ${err.message}` }],
          };
        }
      }
    );
    */

  server.tool(
    "get-node-contributions",
    "Fetches contributions for a specific node and prestige version (optionally limited).",
    {
      nodeId: z
        .string()
        .describe("The ID of the node to fetch contributions for."),
      version: z.number().describe("Prestige version of the node."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit for number of most recent contributions."),
      ...TimeWindowSchema,
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, version, limit, startDate, endDate }) => {
      if (typeof limit === "number" && limit > 30) {
        limit = 30;
      }

      try {
        const result = await getContributions({
          nodeId,
          version,
          limit,
          startDate,
          endDate,
        });

        const trimmed = result.contributions.slice(0, 20);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to fetch contributions: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "get-contributions-by-user",
    "Fetches contributions made by a specific user (optionally limited).",
    {
      userId: z
        .string()
        .describe("The ID of the user to fetch contributions for."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit for number of most recent contributions."),
      ...TimeWindowSchema,
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ userId, limit, startDate, endDate }) => {
      if (typeof limit === "number" && limit > 30) {
        limit = 30;
      }

      try {
        const result = await getContributionsByUser(
          userId,
          limit,
          startDate,
          endDate
        );
        const trimmed = result.contributions.slice(0, limit);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to fetch user contributions: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // =====================================================================
  // 🔍 search-notes-by-user
  // =====================================================================
  server.tool(
    "get-searched-notes-by-user",
    "Search text notes by a user based on text matching.",
    {
      userId: z.string().describe("User whose notes should be searched."),
      query: z.string().describe("Search query string."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit for returned notes."),
      ...TimeWindowSchema,
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ userId, query, limit, startDate, endDate }) => {
      try {
        if (typeof limit === "number" && limit > 40) {
          limit = 40;
        }

        const result = await searchNotesByUser({
          userId,
          query,
          limit,
          startDate,
          endDate,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Search failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
  server.tool(
    "get-raw-ideas-by-user",
    "Fetches raw ideas (inbox) for a user. Read-only.",
    {
      userId: z.string().describe("User whose raw ideas to fetch."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit for number of raw ideas by most recent."),
      ...TimeWindowSchema,
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ userId, limit, startDate, endDate }) => {
      try {
        if (typeof limit === "number" && limit > 30) {
          limit = 30;
        }

        const result = await getRawIdeas({
          userId,
          limit,
          startDate,
          endDate,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rawIdeas, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to fetch raw ideas: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
  server.tool(
    "transfer-raw-idea-to-note",
    "Converts a raw idea into a note on a specific node/version.",
    {
      rawIdeaId: z.string().describe("ID of the raw idea to place."),
      userId: z.string().describe("User performing the action."),
      nodeId: z.string().describe("Target node ID."),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ rawIdeaId, userId, nodeId }) => {
      try {
        const result = await convertRawIdeaToNote({
          rawIdeaId,
          userId,
          nodeId,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to place raw idea: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get-root-nodes-by-user",
    "Fetches all root nodes owned by a user. READ-ONLY.",
    {
      userId: z
        .string()
        .describe("The ID of the user whose root nodes to fetch."),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ userId }) => {
      try {
        const roots = await getRootNodesForUser(userId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(roots, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to fetch root nodes: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
  server.tool(
    "batch-operations",
    "Apply the same operation to multiple nodes, supporting uniform or per-node payloads.",
    {
      operation: z.enum([
        "edit-status",
        "add-prestige",
        "set-value",
        "set-goal",
        "add-note",
        "update-schedule",
      ]),

      userId: z.string(),
      mode: z.enum(["uniform", "per-item"]),

      // uniform mode
      nodeIds: z.array(z.string()).optional(),
      payload: z
        .object({
          status: z.enum(["active", "trimmed", "completed"]).optional(),
          isInherited: z.boolean().optional(),

          key: z.string().optional(),
          value: z.number().optional(),
          goal: z.number().optional(),
          prestige: z.number().optional(),

          content: z.string().optional(),

          newSchedule: z.string().optional(),
          reeffectTime: z.number().optional(),
        })
        .optional(),

      // per-item mode
      items: z
        .array(
          z.object({
            nodeId: z.string(),
            payload: z.object({
              status: z.enum(["active", "trimmed", "completed"]).optional(),
              isInherited: z.boolean().optional(),

              key: z.string().optional(),
              value: z.number().optional(),
              goal: z.number().optional(),
              prestige: z.number().optional(),

              content: z.string().optional(),

              newSchedule: z.string().optional(),
              reeffectTime: z.number().optional(),
            }),
          })
        )
        .optional(),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ operation, userId, mode, nodeIds, payload, items }) => {
      const results = [];
      let tasks = [];

      // normalize tasks
      if (mode === "uniform") {
        if (!nodeIds || !payload) {
          throw new Error("Uniform mode requires nodeIds and payload");
        }
        tasks = nodeIds.map((nodeId) => ({ nodeId, payload }));
      }

      if (mode === "per-item") {
        if (!items || items.length === 0) {
          throw new Error("Per-item mode requires items");
        }
        tasks = items;
      }

      if (tasks.length > 50) {
        throw new Error("Batch size exceeds maximum of 50");
      }

      // execute batch
      for (const { nodeId, payload } of tasks) {
        try {
          let result;

          switch (operation) {
            case "edit-status":
              result = await editStatus({
                nodeId,
                status: payload.status,
                version: payload.prestige,
                isInherited: payload.isInherited ?? true,
                userId,
              });
              break;

            case "add-prestige":
              result = await addPrestige({ nodeId, userId });
              break;

            case "set-value":
              result = await setValueForNode({
                nodeId,
                key: payload.key,
                value: payload.value,
                version: payload.prestige,
                userId,
              });
              break;

            case "set-goal":
              result = await setGoalForNode({
                nodeId,
                key: payload.key,
                goal: payload.goal,
                version: payload.prestige,
                userId,
              });
              break;

            case "add-note":
              result = await createNote({
                contentType: "text",
                content: payload.content,
                userId,
                nodeId,
                isReflection: false,
              });
              break;

            case "update-schedule":
              result = await updateSchedule({
                nodeId,
                versionIndex: payload.prestige,
                newSchedule: payload.newSchedule,
                reeffectTime: payload.reeffectTime,
                userId,
              });
              break;

            default:
              throw new Error(`Unsupported batch operation: ${operation}`);
          }

          results.push({ nodeId, success: true, result });
        } catch (err) {
          results.push({
            nodeId,
            success: false,
            error: err.message,
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                operation,
                mode,
                total: results.length,
                succeeded: results.filter((r) => r.success).length,
                failed: results.filter((r) => !r.success).length,
                results,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

await server.connect(transport);

const pendingCalls = new Map();
const completedCalls = new Map();
const CACHE_MS = 2000;

// Helper to parse SSE format
function parseSseResponse(rawBody) {
  const lines = rawBody.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const jsonStr = line.substring(6); // Remove "data: " prefix
      return JSON.parse(jsonStr);
    }
  }
  throw new Error("No data found in SSE response");
}

// Helper to format as SSE
function formatSseResponse(jsonData) {
  return `event: message\ndata: ${JSON.stringify(jsonData)}\n\n`;
}

async function handleMcpRequest(req, res) {
  try {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`\n[${requestId}] ===== MCP IN =====`);

    const method = req.body?.method;
    const toolName = req.body?.params?.name;
    const args = req.body?.params?.arguments;

    if (method === "tools/call") {
      const callKey = `${toolName}:${JSON.stringify(args)}`;
      const now = Date.now();

      // Check completed cache
      const cached = completedCalls.get(callKey);
      if (cached && now - cached.timestamp < CACHE_MS) {
        console.log(`♻️ Returning cached response for: ${toolName}`);
        res.setHeader("Content-Type", "text/event-stream");
        return res.end(formatSseResponse(cached.response));
      }

      // Check pending requests
      const pending = pendingCalls.get(callKey);
      if (pending) {
        console.log(`⏳ Waiting for in-flight request: ${toolName}`);
        const response = await pending;
        res.setHeader("Content-Type", "text/event-stream");
        return res.end(formatSseResponse(response));
      }

      console.log(`→ Tool: ${toolName}`);
      console.log("→ Args:");
      console.log(JSON.stringify(args, null, 2));

      // Create promise for this request
      const requestPromise = new Promise((resolve, reject) => {
        const chunks = [];
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);

        res.write = (chunk, ...args) => {
          if (chunk) chunks.push(Buffer.from(chunk));
          return originalWrite(chunk, ...args);
        };

        res.end = (chunk, ...args) => {
          if (chunk) chunks.push(Buffer.from(chunk));

          const rawBody = Buffer.concat(chunks).toString("utf8");

          if (rawBody) {
            console.log("\n===== MCP OUT =====");

            try {
              // Parse SSE format
              const parsed = parseSseResponse(rawBody);

              const content =
                parsed?.result?.content?.[0]?.text ??
                parsed?.content?.[0]?.text ??
                null;

              if (typeof content === "string") {
                try {
                  const inner = JSON.parse(content);
                  console.log(JSON.stringify(inner, null, 2));
                } catch {
                  console.log(content.replace(/\\n/g, "\n"));
                }
              } else {
                console.log(JSON.stringify(parsed, null, 2));
              }

              // Cache the parsed response
              completedCalls.set(callKey, {
                timestamp: Date.now(),
                response: parsed,
              });

              pendingCalls.delete(callKey);

              if (completedCalls.size > 100) {
                const entries = [...completedCalls.entries()];
                entries
                  .slice(0, 50)
                  .forEach(([key]) => completedCalls.delete(key));
              }

              resolve(parsed);
            } catch (err) {
              console.log(rawBody);
              reject(err);
            }
          }

          return originalEnd(chunk, ...args);
        };
      });

      pendingCalls.set(callKey, requestPromise);
      await transport.handleRequest(req, res, req.body);
    } else {
      console.log(`→ Method: ${method}`);
      await transport.handleRequest(req, res, req.body);
    }
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
