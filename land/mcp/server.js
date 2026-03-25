import log from "../seed/log.js";
import { z } from "zod";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileTypeFromBuffer } from "file-type";
import User from "../seed/models/user.js";
import { getUserMeta } from "../seed/tree/userMetadata.js";
import Node from "../seed/models/node.js";

import { emitNavigate } from "../seed/ws/websocket.js";

import path from "path";
import fs from "fs";

import { fileURLToPath } from "url";

import { getLandUrl } from "../canopy/identity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MUST match the rest of your app
const uploadsFolder = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

// Values tools moved to extensions/values/tools.js

import {
  getContributionsByUser,
  getContributions,
} from "../seed/tree/contributions.js";

// Schedules: dynamic import, stub if extension not installed
let updateSchedule = async () => { throw new Error("Schedules extension not installed"); };
try { ({ updateSchedule } = await import("../extensions/schedules/core.js")); } catch {}
import { editStatus } from "../seed/tree/statuses.js";
import {
  createNote,
  getNotes,
  editNote,
  getAllNotesByUser,
  deleteNoteAndFile,
  transferNote,
  searchNotesByUser,
} from "../seed/tree/notes.js";
import {
  createNode,
  createNodeBranch,
  deleteNodeBranch,
  updateParentRelationship,
  editNodeName,
} from "../seed/tree/treeManagement.js";
import { editNodeType } from "../seed/tree/nodeTypes.js";

import {
  getRootNodesForUser,
  getActiveLeafExecutionFrontier,
  getContextForAi,
  getNavigationContext,
} from "../seed/tree/treeFetch.js";


import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getTreeForAi, getNodeForAi } from "../seed/tree/treeData.js"; // import from your real backend
import { resolveTreeAccess } from "../seed/authenticate.js";
import { getChatContext } from "../seed/ws/chatTracker.js";

// Legacy prestige resolution. Without prestige extension, always returns 0.
async function resolvePrestige({ nodeId, prestige }) {
  if (typeof prestige === "number" && prestige >= 0) {
    return prestige;
  }
  // Check metadata for prestige extension data
  const Node = mongoose.models.Node;
  if (Node) {
    const node = await Node.findById(nodeId).select("metadata").lean();
    if (node) {
      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      return meta.prestige?.current || 0;
    }
  }
  return 0;
}

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
      nodeId: z.string().describe("Root node ID to fetch the tree from."),

      filters: z
        .object({
          // keep schema LLM-friendly but permissive
          status: z
            .union([
              z.array(z.enum(["active", "trimmed", "completed"])),
              z.enum(["active", "trimmed", "completed"]),
            ])
            .optional()
            .describe(
              "Statuses to include. ALWAYS prefer array form. Example: ['active'] or ['active','completed']",
            ),
        })
        .optional()
        .describe(
          "Optional filters. If omitted, defaults to ['active', 'completed'].",
        ),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, filters }) => {
      // ---------- NORMALIZATION ----------
      let status;

      if (Array.isArray(filters?.status)) {
        status = filters.status;
      } else if (typeof filters?.status === "string") {
        status = [filters.status];
      } else {
        status = ["active", "completed"];
      }

      // sanitize + dedupe
      status = [...new Set(status)].filter(
        (s) => s === "active" || s === "trimmed" || s === "completed",
      );

      // final safety net
      if (status.length === 0) {
        status = ["active", "completed"];
      }

      const mergedFilter = {
        active: status.includes("active"),
        trimmed: status.includes("trimmed"),
        completed: status.includes("completed"),
      };

      // ---------- FETCH ----------
      const treeData = await getTreeForAi(nodeId, mergedFilter);

      if (treeData == null) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Tree not found", nodeId },
                null,
                2,
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
                2,
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
  );

  server.tool(
    "tree-start",
    "Entry point for all tree-helper workflows. Loads tree + provides system instructions. READ-ONLY.",
    {
      rootId: z.string(),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ rootId }) => {
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
    },
  );

  server.tool(
    "tree-actions-menu",
    "Waits for decision on intensions menu. Read-only to decide next choice.",
    {
      rootId: z.string(),
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
    - Set/clear node type = edit-node-type
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
    },
  );
  /*
  server.tool(
    "tree-structure-orchestrator",
    "Entry point for creating or modifying hierarchical tree structures.",
    {
      rootId: z
        .string()
        .describe("The ID of the root or starting node of the tree."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
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
    },
  );

  server.tool(
    "be-mode-orchestrator",
    "Entry point for guided 'be mode' traversal of a node branch.",
    {
      nodeId: z.string().describe("Root node ID for the guided branch."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
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
    },
  );*/

  /*server.tool(
    "create-node-version-image-note",
    "Creates a new image note for a node version by uploading a base64 image.",
    {
      userId: z.string().describe("The ID of the user creating the note."),
      nodeId: z.string().describe("The ID of the node the note belongs to."),
      prestige: z
        .number()
        .optional()
        .describe("The prestige version of the node"),

      imageBase64: z
        .string()
        .describe("Base64-encoded image data (no data URL prefix)"),

      extension: z
        .enum(["jpg", "jpeg", "png", "webp"])
        .describe("Image file extension"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ userId, nodeId, prestige, imageBase64, extension }) => {
      try {
        if (!userId || !nodeId) {
          throw new Error("Missing required fields");
        }

        if (!imageBase64) {
          throw new Error("imageBase64 is required");
        }
        if (imageBase64.length < 100) {
          throw new Error("imageBase64 too short — likely truncated");
        }
        const version = typeof prestige === "number"
            ? prestige
            : await resolvePrestige({ nodeId });

        const type = await fileTypeFromBuffer(buffer);

        if (!type || type.ext !== extension) {
          throw new Error("Invalid or corrupted image data");
        }
        // 🔐 Generate safe filename
        const filename = `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${extension}`;
        const absolutePath = path.join(uploadsFolder, filename);

        // 🧠 Decode + write image
        const buffer = Buffer.from(imageBase64, "base64");
        await fs.promises.writeFile(absolutePath, buffer);

        // 📝 Create file-backed note
        const result = await createNote({
          contentType: "file",
          content: null, // ignored for file notes
          userId,
          nodeId,
          version,
          isReflection: true,
          file: {
            filename,
          },
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
              text: `Failed to create image note: ${err.message}`,
            },
          ],
        };
      }
    }
  );*/

  // edit-node-version-value and edit-node-version-goal moved to extensions/values/tools.js

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
          "If true, propagate the status to child nodes recursively. Typically true unless otherwise specified.",
        ),
      userId: z
        .string()
        .describe(
          "ID of the user making the status edit (for contribution logging).",
        ),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({
      nodeId,
      status,
      prestige,
      isInherited,
      userId,
      chatId,
      sessionId,
    }) => {
      try {
        const result = await editStatus({
          nodeId,
          status,
          isInherited,
          userId,
          wasAi: true,
          chatId,
          sessionId,
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
    },
  );

  server.tool(
    "create-node-version-note",
    "Creates a new text note for a node. Please confirm exact wording of content and do not add anything unless asked",
    {
      content: z.string().describe("The text content of the note."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      nodeId: z.string().describe("The ID of the node the note belongs to."),
      prestige: z.number().describe("The prestige version of the node"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ content, userId, nodeId, prestige, chatId, sessionId }) => {
      const version = await resolvePrestige({ nodeId, prestige });
      try {
        const result = await createNote({
          contentType: "text",
          content,
          userId,
          nodeId,
          version,
          isReflection: true,
          wasAi: true,
          chatId,
          sessionId,
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
    },
  );
  server.tool(
    "edit-node-note",
    "Edit an existing text note. Replaces all content by default. Specify lineStart/lineEnd to replace a specific range, or lineStart alone to insert.",
    {
      nodeId: z
        .string()
        .describe("The unique ID of the node whose status will be edited."),
      prestige: z
        .number()
        .describe("Prestige version number of the node to modify."),
      noteId: z.string().describe("The ID of the note to edit."),
      content: z
        .string()
        .describe(
          "New content. Replaces entire note or the specified line range.",
        ),
      lineStart: z
        .number()
        .optional()
        .describe(
          "Start line (0-indexed). With lineEnd: replaces range. Alone: inserts at line.",
        ),
      lineEnd: z
        .number()
        .optional()
        .describe(
          "End line (0-indexed, exclusive). Lines [lineStart, lineEnd) are replaced.",
        ),
      userId: z
        .string()
        .describe(
          "ID of the user making the status edit (for contribution logging).",
        ),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({
      noteId,
      content,
      lineStart,
      lineEnd,
      userId,
      chatId,
      sessionId,
    }) => {
      try {
        const result = await editNote({
          noteId,
          content,
          userId,
          lineStart: lineStart ?? null,
          lineEnd: lineEnd ?? null,
          wasAi: true,
          chatId,
          sessionId,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to edit note: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
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
          version: typeof prestige === "number" ? prestige : undefined,
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
    },
  );

  server.tool(
    "get-unsearched-notes-by-user",
    "Fetches all notes written by a specific user (optionally limited to the most recent N). Recommend to use limit 10 or less. Use get-searched-notes-by-user... if looking for specifics.",
    {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
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
          endDate,
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
    },
  );

  server.tool(
    "get-all-tags-for-user",
    "Fetches all notes where a specific user was tagged (optionally limited to the most recent N). May be referenced as mail",
    {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
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
        const { getAllTagsForUser } = await import("../extensions/team/tags.js");
        const Note = (await import("../seed/models/note.js")).default;
        const result = await getAllTagsForUser(
          userId,
          limit,
          startDate,
          endDate,
          Note,
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
    },
  );

  server.tool(
    "delete-node-note",
    "Deletes a text note by its ID.",
    {
      noteId: z.string().describe("The ID of the note to delete."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      nodeId: z.string().describe("The ID of the node the note belongs to."),
      prestige: z.number().describe("The prestige version of the node"),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ noteId, userId, chatId, sessionId }) => {
      try {
        const result = await deleteNoteAndFile({
          noteId,
          userId,
          wasAi: true,
          chatId,
          sessionId,
        });

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
    },
  );

  server.tool(
    "transfer-node-note",
    "Transfers a note from its current node to a different node in the same tree. Logs contributions on both source and target nodes.",
    {
      noteId: z.string().describe("The ID of the note to transfer."),
      targetNodeId: z.string().describe("The destination node ID."),
      prestige: z
        .number()
        .optional()
        .describe("Target version (defaults to latest)."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ noteId, targetNodeId, prestige, userId, chatId, sessionId }) => {
      try {
        const result = await transferNote({
          noteId,
          targetNodeId,
          userId,
          prestige: prestige ?? null,
          wasAi: true,
          chatId,
          sessionId,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to transfer note: ${err.message}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "create-tree",
    "Creates a new tree by creating a root node.",
    {
      name: z.string().describe("Name of the new tree (root node)."),

      note: z
        .string()
        .nullable()
        .optional()
        .describe("Optional note for the root node."),

      type: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Optional semantic type. Core types: goal, plan, task, knowledge, resource, identity. Custom types are valid.",
        ),

      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ name, note, type, userId, chatId, sessionId }) => {
      try {
        const rootNode = await createNode(
          name,
          null, // schedule
          0, // reeffectTime
          null, // parentNodeID
          true, // isRoot
          userId,
          {}, // values (forced empty)
          {}, // goals (forced empty)
          note ?? null,
          null,
          true,
          chatId,
          sessionId,
          type ?? null,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rootNode, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to create tree: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
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
      type: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Optional semantic type. Core types: goal, plan, task, knowledge, resource, identity. Custom types are valid.",
        ),
      children: z
        .array(NodeSchema)
        .nullable()
        .optional()
        .describe("List of child nodes."),
    }),
  );

  server.tool(
    "create-new-node-branch",
    "Used to create new node branch off a current node to extend its structure",
    {
      nodeData: NodeSchema.describe(
        "JSON structure of the node branch to create.",
      ),
      parentId: z
        .string()
        .nullable()
        .optional()
        .describe("Parent node ID for the root of this subtree."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ nodeData, parentId, userId, chatId, sessionId }) => {
      try {
        const { rootId, rootName, totalCreated } = await createNodeBranch(
          nodeData,
          parentId,
          userId,
          true,
          chatId,
          sessionId,
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
    },
  );
  server.tool(
    "delete-node-branch",
    "Used to retire (delete) a node branch and detach it from its parent",
    {
      nodeId: z.string().describe("ID of the node branch to delete."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ nodeId, userId, chatId, sessionId }) => {
      try {
        const deletedNode = await deleteNodeBranch(
          nodeId,
          userId,
          true,
          chatId,
          sessionId,
        );

        return {
          content: [
            {
              type: "text",
              text:
                `🗑️ Node branch retired successfully.\n\n` +
                `• Node ID: ${deletedNode._id.toString()}\n` +
                `• Previous Parent: ${deletedNode.parent === "deleted" ? "N/A" : deletedNode.parent}\n` +
                `• Prestige Version: ${deletedNode.prestige.toString()}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to delete node branch: ${err.message}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "edit-node-name",
    "Renames an existing node and logs the name change.",
    {
      nodeId: z.string().describe("The ID of the node being renamed."),
      newName: z.string().describe("The new name to assign to the node."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, newName, userId, chatId, sessionId }) => {
      try {
        const { oldName, newName: updatedName } = await editNodeName({
          nodeId,
          newName,
          userId,
          wasAi: true,
          chatId,
          sessionId,
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
    },
  );

  server.tool(
    "edit-node-type",
    "Set or clear a node's semantic type.",
    {
      nodeId: z.string().describe("The ID of the node to update."),
      newType: z
        .string()
        .nullable()
        .describe(
          "Type label or null to clear. Core types: goal, plan, task, knowledge, resource, identity. Custom types are valid.",
        ),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, newType, userId, chatId, sessionId }) => {
      try {
        const { oldType, newType: updatedType } = await editNodeType({
          nodeId,
          newType,
          userId,
          wasAi: true,
          chatId,
          sessionId,
        });

        return {
          content: [
            {
              type: "text",
              text: `Node ${nodeId} type changed from "${oldType}" to "${updatedType}".`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update node type: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
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
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeChildId, nodeNewParentId, userId, chatId, sessionId }) => {
      try {
        const { nodeChild, nodeNewParent } = await updateParentRelationship(
          nodeChildId,
          nodeNewParentId,
          userId,
          true,
          chatId,
          sessionId,
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
    },
  );

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
      const ensuredVersion = await resolvePrestige({
        nodeId,
        prestige: version,
      });
      if (typeof limit === "number" && limit > 30) {
        limit = 30;
      }

      try {
        const result = await getContributions({
          nodeId,
          version: ensuredVersion,
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
    },
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
          endDate,
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
    },
  );

  // =====================================================================
  // 🔍 search-notes-by-user
  // =====================================================================
  server.tool(
    "get-searched-notes-by-user",
    "Search text notes by a user based on text matching.",
    {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
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
    },
  );
  server.tool(
    "get-root-nodes",
    "Fetches all root nodes (roots, trees) owned by a user. READ-ONLY.",
    { userId: z.string().describe("Injected by server. Ignore.") },
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
    },
  );

  server.tool(
    "get-active-leaf-execution-frontier",
    "Get the next executable leaf node for BE mode.",
    {
      rootNodeId: z.string().describe("Root node of the active tree"),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ rootNodeId }) => {
      const frontier = await getActiveLeafExecutionFrontier(rootNodeId);

      if (!frontier.leaves?.length) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ done: true }, null, 2),
            },
          ],
        };
      }

      const primary = frontier.leaves.find((l) => l.next);

      if (!primary) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Frontier returned no primary leaf." },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ---- build capped, depth-aware alternates ----

      const MAX_ALTERNATES = 4;
      const alternates = [];

      const byDepth = new Map();
      for (const leaf of frontier.leaves) {
        if (leaf.next) continue;
        if (!byDepth.has(leaf.depth)) {
          byDepth.set(leaf.depth, []);
        }
        byDepth.get(leaf.depth).push(leaf);
      }

      const candidateDepths = [
        primary.depth,
        primary.depth - 1,
        primary.depth + 1,
      ];

      for (const depth of candidateDepths) {
        const group = byDepth.get(depth);
        if (!group) continue;

        for (const leaf of group) {
          if (alternates.length >= MAX_ALTERNATES) break;
          alternates.push({
            nodeId: leaf.nodeId,
            name: leaf.name,
            path: leaf.path,
            depth: leaf.depth,
            versionPrestige: leaf.versionPrestige,
            versionStatus: leaf.versionStatus,
          });
        }

        if (alternates.length >= MAX_ALTERNATES) break;
      }

      // ---- return MCP payload ----

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                primary: {
                  nodeId: primary.nodeId,
                  name: primary.name,
                  path: primary.path,
                  depth: primary.depth,
                  versionPrestige: primary.versionPrestige,
                  versionStatus: primary.versionStatus,
                },
                alternates,
                execution: {
                  status: "active",
                  isLeaf: true,
                },
                instructions: `
You are in BE mode.

This is where we are right now.

Stay with this step.
Help the user move it forward.
Handle all system updates quietly.

When the work here feels complete,
pause and ask if it’s ready to move on.
`.trim(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "navigate-tree",
    "Returns structural context for tree navigation. Optionally searches by name or shows deeper children.",
    {
      nodeId: z.string().describe("Node ID to inspect from."),
      search: z
        .string()
        .optional()
        .describe(
          "Search node names across the tree. Returns up to 10 matches with paths.",
        ),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, search }) => {
      try {
        const context = await getNavigationContext(nodeId, { search });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(context, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to load navigation context: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get-tree-context",
    "Reads node data with configurable scope. Returns current version, notes, and optionally siblings, parent chain, scripts.",
    {
      nodeId: z.string().describe("Node ID to read."),
      includeNotes: z
        .boolean()
        .optional()
        .describe("Include notes for current version. Default true."),
      includeSiblings: z
        .boolean()
        .optional()
        .describe("Include sibling node names. Default false."),
      includeParentChain: z
        .boolean()
        .optional()
        .describe("Include full path from root. Default false."),
      includeChildren: z
        .boolean()
        .optional()
        .describe("Include children names. Default true."),
      includeValues: z
        .boolean()
        .optional()
        .describe("Include version values and goals. Default true."),
      includeScripts: z
        .boolean()
        .optional()
        .describe("Include script names. Default false."),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ nodeId, ...flags }) => {
      try {
        const context = await getContextForAi(nodeId, flags);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(context, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to load context: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
  return server;
}

await server.connect(transport);

const pendingCalls = new Map();
const completedCalls = new Map();
const CACHE_MS = 7000;

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
    log.debug("MCP", `[${requestId}] ===== MCP IN =====`);

    const method = req.body?.method;
    const toolName = req.body?.params?.name;
    const args = req.body?.params?.arguments;

    if (method === "tools/call") {
      const requestArgs = req.body?.params?.arguments ?? {};
      if (!req.userId) {
        res.setHeader("Content-Type", "text/event-stream");
        res.end(
          formatSseResponse({
            jsonrpc: "2.0",
            id: req.body.id,
            error: {
              code: -32602,
              message: "You are not authorized as this user",
            },
          }),
        );
        return;
      }
      requestArgs.userId = req.userId;

      // Inject AI chat context so contributions are tracked per-chat
      // Key by visitorId (unique per MCP connection) to avoid collisions
      // between concurrent sessions for the same user
      const contextKey = req.visitorId || req.userId;
      const aiCtx = getChatContext(contextKey);
      requestArgs.chatId = aiCtx.chatId;
      requestArgs.sessionId = aiCtx.sessionId;

      const user = await User.findById(req.userId).select("metadata");
      const htmlShareToken = getUserMeta(user, "html")?.shareToken ?? null;

      // inject into args so mapper can use it
      if (args && htmlShareToken) {
        args.htmlShareToken = htmlShareToken;
      }

      const nodeId = requestArgs.nodeId ?? requestArgs.rootId ?? requestArgs.parentNodeID ?? requestArgs.parentId ?? requestArgs.rootNodeId;

      if (nodeId && req.userId) {
        const access = await resolveTreeAccess(nodeId, req.userId);

        if (!access.canWrite) {
          res.setHeader("Content-Type", "text/event-stream");
          res.end(
            formatSseResponse({
              jsonrpc: "2.0",
              id: req.body.id,
              error: {
                code: -32602,
                message: "Invalid nodeId, or you are not in this tree.",
              },
            }),
          );
          return;
        }
      }
      const apiPath = mapToolCallToApiUrl(toolName, args);

      if (apiPath) {
        emitNavigate({
          userId: req.userId,
          url: `${getLandUrl()}${apiPath}`,
          sessionId: aiCtx.sessionId,
        });
      }

      const callKey = `${toolName}:${JSON.stringify(args)}`;
      const now = Date.now();

      /*
      // Check completed cache
      const cached = completedCalls.get(callKey);
      if (cached && now - cached.timestamp < CACHE_MS) {
        log.debug("MCP", `Returning cached response for: ${toolName}`);
        res.setHeader("Content-Type", "text/event-stream");
        return res.end(formatSseResponse(cached.response));
      }*/

      // Check pending requests
      res.setHeader("Content-Type", "text/event-stream");

      const pending = pendingCalls.get(callKey);
      if (pending) {
        log.debug("MCP", `Waiting for in-flight request: ${toolName}`);
        try {
          const response = await pending;
          res.end(formatSseResponse(response));
        } catch (err) {
          res.end(
            formatSseResponse({
              jsonrpc: "2.0",
              id: req.body.id,
              error: err,
            }),
          );
        }
        return;
      }

      log.debug("MCP", `Tool: ${toolName}`);
      log.debug("MCP", "Args:");
      log.debug("MCP", JSON.stringify(args, null, 2));

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
            log.debug("MCP", "===== MCP OUT =====");

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
                  log.debug("MCP", JSON.stringify(inner, null, 2));
                } catch {
                  log.debug("MCP", content.replace(/\\n/g, "\n"));
                }
              } else {
                log.debug("MCP", JSON.stringify(parsed, null, 2));
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
              log.debug("MCP", rawBody);
              reject(err);
            }
          }

          return originalEnd(chunk, ...args);
        };
      });

      pendingCalls.set(callKey, requestPromise);

      await transport.handleRequest(req, res, req.body);
    } else {
      log.debug("MCP", `Method: ${method}`);
      const requestArgs = req.body?.params?.arguments ?? {};
      if (!req.userId) {
        res.setHeader("Content-Type", "text/event-stream");
        res.end(
          formatSseResponse({
            jsonrpc: "2.0",
            id: req.body.id,
            error: {
              code: -32602,
              message: "You are not authorized as this user",
            },
          }),
        );
        return;
      }
      requestArgs.userId = req.userId;

      // Inject AI chat context so contributions are tracked per-chat
      const contextKey2 = req.visitorId || req.userId;
      const aiCtx2 = getChatContext(contextKey2);
      requestArgs.chatId = aiCtx2.chatId;
      requestArgs.sessionId = aiCtx2.sessionId;

      const user = await User.findById(req.userId).select("metadata");
      const htmlShareToken = getUserMeta(user, "html")?.shareToken ?? null;

      // inject into args so mapper can use it
      if (args && htmlShareToken) {
        args.htmlShareToken = htmlShareToken;
      }

      const nodeId = requestArgs.nodeId ?? requestArgs.rootId ?? requestArgs.parentNodeID ?? requestArgs.parentId ?? requestArgs.rootNodeId;

      if (nodeId && req.userId) {
        const access = await resolveTreeAccess(nodeId, req.userId);

        if (!access.canWrite) {
          res.setHeader("Content-Type", "text/event-stream");
          res.end(
            formatSseResponse({
              jsonrpc: "2.0",
              id: req.body.id,
              error: {
                code: -32602,
                message:
                  "Invalid nodeId, or you are not in this tree. Use get-roots-for-user to find rootId's, and then present them to me so I can choose one.",
              },
            }),
          );
          return;
        }
      }
      if (args?.nodeId && "prestige" in args) {
        args.prestige = await resolvePrestige({
          nodeId: args.nodeId,
          prestige: args.prestige,
        });
      }

      const apiPath = mapToolCallToApiUrl(toolName, args);

      if (apiPath) {
        emitNavigate({
          userId: req.userId,
          url: `${getLandUrl()}${apiPath}`,
          sessionId: aiCtx2.sessionId,
        });
      }

      await transport.handleRequest(req, res, req.body);
    }
  } catch (err) {
    log.error("MCP", "[MCP] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603 },
        id: req.body.id || null,
      });
    }
  }
}

function mapToolCallToApiUrl(toolName, args) {
  const {
    nodeId,
    rootId,
    rootNodeId,
    userId,
    noteId,
    prestige,
    version,
    htmlShareToken,
    understandingRunId,
    understandingNodeId,
    parentId,
  } = args ?? {};

  // 🔑 normalize root once (THIS FIXES THE BREAK)
  const resolvedRootId = rootId ?? rootNodeId ?? nodeId;
  const resolvedUnderstandingNodeId =
    understandingNodeId ?? args?.previousResult?.understandingNodeId;

  // helper: always append token safely; returns null if URL has undefined/null segments
  const withToken = (path) => {
    if (/undefined|null/.test(path)) return null;
    if (!htmlShareToken) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}token=${htmlShareToken}`;
  };

  switch (toolName) {
    /* ---------------- TREE / ROOT ---------------- */

    case "tree-start":
    case "get-tree":
      return withToken(`/api/v1/root/${resolvedRootId}?html`);

    case "tree-actions-menu":
      return withToken(`/api/v1/root/${resolvedRootId}?html`);

    case "tree-structure-orchestrator":
      return withToken(`/api/v1/root/${resolvedRootId}?html`);

    /* ---------------- NODE ---------------- */

    case "get-node":
    case "be-mode-orchestrator":
    case "scripting-orchestrator":
    case "node-script-runtime-environment":
      return withToken(`/api/v1/node/${nodeId}?html`);

    /* ---------------- UNDERSTANDINGS ---------------- */

    case "understanding-create":
      if (!resolvedRootId) return null;
      return withToken(`/api/v1/root/${resolvedRootId}/understandings?html`);
    case "understanding-list":
      if (!rootNodeId) return null;
      return withToken(`/api/v1/root/${rootNodeId}/understandings?html`);

    case "understanding-process": {
      if (!rootNodeId || !understandingRunId) return null;

      const resolvedUnderstandingNodeId =
        understandingNodeId ?? args?.previousResult?.understandingNodeId;

      if (resolvedUnderstandingNodeId != null) {
        return withToken(
          `/api/v1/root/${rootNodeId}/understandings/run/${understandingRunId}/${resolvedUnderstandingNodeId}?html`,
        );
      }

      return withToken(
        `/api/v1/root/${rootNodeId}/understandings/run/${understandingRunId}?html`,
      );
    }

    /* ---------------- NODE VERSION ---------------- */

    case "edit-node-version-value":
    case "edit-node-version-goal":
    case "edit-node-or-branch-status":
    case "edit-node-version-schedule":
    case "add-node-prestige":
      return withToken(`/api/v1/node/${nodeId}/${prestige}?html`);

    case "create-new-node":
      if (!nodeId) return null;
      return withToken(`/api/v1/node/${nodeId}?html`);

    case "create-new-node-branch":
      if (!parentId) return null;
      return withToken(`/api/v1/node/${parentId}?html`);
    case "get-active-leaf-execution-frontier":
      if (!nodeId || prestige == null) return null;
      return withToken(`/api/v1/node/${nodeId}/${prestige}?html`);

    /* ---------------- NOTES ---------------- */

    case "get-node-notes":
    case "create-node-version-note":
    case "create-node-version-image-note":
    case "delete-node-note":
    case "transfer-node-note":
      return withToken(`/api/v1/node/${nodeId}/${prestige}/notes?html`);
    case "get-node-notes":
    case "edit-node-note":
      return withToken(
        `/api/v1/node/${nodeId}/${prestige}/notes/${noteId}/editor?html`,
      );

    /* ---------------- CONTRIBUTIONS ---------------- */

    case "get-node-contributions":
      return withToken(`/api/v1/node/${nodeId}/${version}/contributions?html`);

    case "get-contributions-by-user":
      return withToken(`/api/v1/user/${userId}/contributions?html`);

    /* ---------------- USER ---------------- */

    case "get-root-nodes-by-user":
      return withToken(`/api/v1/user/${userId}?html`);

    case "get-unsearched-notes-by-user":
    case "get-searched-notes-by-user":
      return withToken(`/api/v1/user/${userId}/notes?html`);

    case "get-all-tags-for-user":
      return withToken(`/api/v1/user/${userId}/tags?html`);

    /* ---------------- RAW IDEAS ---------------- */

    case "get-raw-ideas-by-user":
    case "raw-idea-filter-orchestrator":
      return withToken(`/api/v1/user/${userId}/raw-ideas?html`);

    /* ---------------- SCRIPTS ---------------- */

    case "update-node-script":
    case "execute-node-script":
    case "edit-node-name":
    case "edit-node-type":
      return withToken(`/api/v1/node/${nodeId}?html`);

    /* ---------------- BATCH ---------------- */

    case "batch-operations":
      return withToken(`/api/v1/user/${userId}/contributions?html`);

    /* ---------------- DEFAULT ---------------- */
    case "navigate-tree":
      return withToken(`/api/v1/node/${nodeId}?html`);

    default:
      return null;
  }
}

export { server as mcpServerInstance, getMcpServer, handleMcpRequest };
