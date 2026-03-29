// treeos/handlers.js
// MCP tool handlers for the treeos extension.
// Extracted from the monolithic MCP server and adapted for the extension system.

import log from "../../seed/log.js";
import { getExtension } from "../loader.js";
import { z } from "zod";
import { getTreeForAi, getNodeForAi } from "../../seed/tree/treeData.js";
import {
  createNode,
  createNodeBranch,
  deleteNodeBranch,
  updateParentRelationship,
  editNodeName,
  editNodeType,
} from "../../seed/tree/treeManagement.js";
import {
  createNote,
  editNote,
  getNotes,
  deleteNoteAndFile,
  transferNote,
  getAllNotesByUser,
  searchNotesByUser,
} from "../../seed/tree/notes.js";
import { editStatus } from "../../seed/tree/statuses.js";
import {
  getContributions,
  getContributionsByUser,
} from "../../seed/tree/contributions.js";
import {
  getActiveLeafExecutionFrontier,
  getNavigationContext,
  getContextForAi,
} from "../../seed/tree/treeFetch.js";
import { DELETED } from "../../seed/protocol.js";

// Models wired from init via setModels
let Node = null;
let User = null;
let _getAvailableCommands = null;
export function setModels(models) { Node = models.Node; User = models.User; }
export function setCommandResolver(fn) { _getAvailableCommands = fn; }

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve prestige/version to a concrete number.
 * If a valid number is provided, use it. Otherwise look up the node's
 * current version from metadata (default 0).
 */
async function resolvePrestige({ nodeId, prestige }) {
  if (typeof prestige === "number" && prestige >= 0) {
    return prestige;
  }
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (node) {
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});
    return meta.prestige?.current || meta.version?.current || 0;
  }
  return 0;
}

function text(str) {
  return { content: [{ type: "text", text: str }] };
}

function json(data) {
  return text(JSON.stringify(data, null, 2));
}

function error(msg) {
  return { content: [{ type: "text", text: msg }], isError: true };
}

// ── TimeWindow shared schema fields ────────────────────────────────────────

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

// ── NodeSchema for create-new-node-branch ──────────────────────────────────

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
      .array(z.any())
      .nullable()
      .optional()
      .describe("List of child nodes."),
  }),
);

// ── Tool definitions with handlers ─────────────────────────────────────────

export function buildTools() {
  return [
    // ────────────────────────────────────────────────────────────────────────
    // READ tools
    // ────────────────────────────────────────────────────────────────────────

    {
      name: "get-tree",
      description:
        "Fetch a branching tree outline (structure only). READ-ONLY.",
      schema: {
        nodeId: z.string().describe("Root node ID to fetch the tree from."),
        filters: z
          .object({
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ nodeId, filters }) => {
        let status;
        if (Array.isArray(filters?.status)) {
          status = filters.status;
        } else if (typeof filters?.status === "string") {
          status = [filters.status];
        } else {
          status = ["active", "completed"];
        }
        status = [...new Set(status)].filter(
          (s) => s === "active" || s === "trimmed" || s === "completed",
        );
        if (status.length === 0) {
          status = ["active", "completed"];
        }
        const mergedFilter = {
          active: status.includes("active"),
          trimmed: status.includes("trimmed"),
          completed: status.includes("completed"),
        };
        const treeData = await getTreeForAi(nodeId, mergedFilter);
        if (treeData == null) {
          return error(
            JSON.stringify({ error: "Tree not found", nodeId }, null, 2),
          );
        }

        // Append active extension CLI commands for this tree so the AI
        // can give specific directions ("fitness 'pushups 20'" not "note ...")
        if (_getAvailableCommands) {
          try {
            const cmds = await _getAvailableCommands(nodeId);
            if (cmds?.length > 0) {
              // treeData is a JSON string from getTreeForAi. Parse, add commands, pass object to json().
              const parsed = JSON.parse(treeData);
              parsed.availableCommands = cmds;
              return json(parsed);
            }
          } catch (cmdErr) {
            log.warn("TreeOS", `get-tree commands failed: ${cmdErr.message}`);
          }
        }

        return json(treeData);
      },
    },

    {
      name: "get-node",
      description:
        "Fetch detailed information for a specific node. READ-ONLY.",
      schema: {
        nodeId: z.string().describe("Node ID to fetch."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ nodeId }) => {
        const nodeData = await getNodeForAi(nodeId);
        if (nodeData == null) {
          return error(
            JSON.stringify({ error: "Node not found", nodeId }, null, 2),
          );
        }
        return json(nodeData);
      },
    },

    {
      name: "get-node-notes",
      description:
        "Retrieves notes associated with a specific node's prestige.",
      schema: {
        nodeId: z
          .string()
          .describe("The ID of the node to fetch notes for."),
        limit: z
          .number()
          .optional()
          .describe(
            "Optional limit for the number of most recent notes",
          ),
        prestige: z
          .number()
          .describe("Specific number prestige version to filter by"),
        ...TimeWindowSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ nodeId, prestige, limit, startDate, endDate }) => {
        try {
          const result = await getNotes({
            nodeId,
            version:
              typeof prestige === "number" ? prestige : undefined,
            limit,
            startDate,
            endDate,
          });
          return json(result);
        } catch (err) {
          return text(`Failed to fetch notes: ${err.message}`);
        }
      },
    },

    {
      name: "get-node-contributions",
      description:
        "Fetches contributions for a specific node and prestige version (optionally limited).",
      schema: {
        nodeId: z
          .string()
          .describe("The ID of the node to fetch contributions for."),
        version: z.number().describe("Prestige version of the node."),
        limit: z
          .number()
          .optional()
          .describe(
            "Optional limit for number of most recent contributions.",
          ),
        ...TimeWindowSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ nodeId, version, limit, startDate, endDate }) => {
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
          return json(result);
        } catch (err) {
          return text(
            `Failed to fetch contributions: ${err.message}`,
          );
        }
      },
    },

    {
      name: "get-unsearched-notes-by-user",
      description:
        "Fetches all notes written by a specific user (optionally limited to the most recent N). Recommend limit 10 or less. Use get-searched-notes-by-user if looking for specifics.",
      schema: {
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
          .describe(
            "Optional limit: number of most recent notes to return.",
          ),
        ...TimeWindowSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ userId, limit, startDate, endDate }) => {
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
          return json(trimmedNotes);
        } catch (err) {
          return text(
            `Failed to fetch user notes: ${err.message}`,
          );
        }
      },
    },

    {
      name: "get-searched-notes-by-user",
      description: "Search text notes by a user based on text matching.",
      schema: {
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ userId, query, limit, startDate, endDate }) => {
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
          return json(result);
        } catch (err) {
          return error(`Search failed: ${err.message}`);
        }
      },
    },

    {
      name: "get-all-tags-for-user",
      description:
        "Fetches all notes where a specific user was tagged (optionally limited to the most recent N). May be referenced as mail.",
      schema: {
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
          .describe(
            "Optional limit: number of most recent tagged notes.",
          ),
        ...TimeWindowSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ userId, limit, startDate, endDate }) => {
        if (typeof limit === "number" && limit > 20) {
          limit = 20;
        }
        try {
          const { getAllTagsForUser } = await import(
            "../../extensions/team/tags.js"
          );
          const Note = (await import("../../seed/models/note.js")).default;
          const result = await getAllTagsForUser(
            userId,
            limit,
            startDate,
            endDate,
            Note,
          );
          return json(result);
        } catch (err) {
          return text(
            `Failed to fetch tagged notes: ${err.message}`,
          );
        }
      },
    },

    {
      name: "get-contributions-by-user",
      description:
        "Fetches contributions made by a specific user (optionally limited).",
      schema: {
        userId: z
          .string()
          .describe(
            "The ID of the user to fetch contributions for.",
          ),
        limit: z
          .number()
          .optional()
          .describe(
            "Optional limit for number of most recent contributions.",
          ),
        ...TimeWindowSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ userId, limit, startDate, endDate }) => {
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
          return json(result);
        } catch (err) {
          return text(
            `Failed to fetch user contributions: ${err.message}`,
          );
        }
      },
    },

    {
      name: "get-root-nodes",
      description:
        "Fetches all root nodes (roots, trees) owned by a user. READ-ONLY.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ userId }) => {
        try {
          // Roots live in metadata.nav.roots, managed by the navigation extension.
          const nav = getExtension("navigation");
          if (nav?.exports?.getUserRootsWithNames) {
            const roots = await nav.exports.getUserRootsWithNames(userId);
            return json(roots);
          }
          // Fallback: query nodes directly by rootOwner (works without navigation extension)
          const roots = await Node.find({ rootOwner: userId })
            .select("_id name status type dateCreated visibility")
            .lean();
          return json(roots);
        } catch (err) {
          return error(
            `Failed to fetch root nodes: ${err.message}`,
          );
        }
      },
    },

    {
      name: "get-active-leaf-execution-frontier",
      description: "Get the next executable leaf node for focused work. Starts from the given node, not necessarily the tree root. Pass the current position to find leaves within that branch.",
      schema: {
        rootNodeId: z
          .string()
          .describe("Node to start from. Use current position for branch-scoped work, or tree root for whole-tree scan."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({ rootNodeId }) => {
        const frontier =
          await getActiveLeafExecutionFrontier(rootNodeId);

        if (!frontier.leaves?.length) {
          return json({ done: true });
        }

        const primary = frontier.leaves.find((l) => l.next);
        if (!primary) {
          return json({
            error: "Frontier returned no primary leaf.",
          });
        }

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

        return json({
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
          instructions:
            "You are in BE mode.\n\nThis is where we are right now.\n\nStay with this step.\nHelp the user move it forward.\nHandle all system updates quietly.\n\nWhen the work here feels complete,\npause and ask if it's ready to move on.",
        });
      },
    },

    {
      name: "navigate-tree",
      description:
        "Returns structural context for tree navigation. Optionally searches by name or shows deeper children.",
      schema: {
        nodeId: z.string().describe("Node ID to inspect from."),
        search: z
          .string()
          .optional()
          .describe(
            "Search node names across the tree. Returns up to 10 matches with paths.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ nodeId, search }) => {
        try {
          const context = await getNavigationContext(nodeId, {
            search,
          });
          return json(context);
        } catch (err) {
          return error(
            `Failed to load navigation context: ${err.message}`,
          );
        }
      },
    },

    {
      name: "get-tree-context",
      description:
        "Reads node data with configurable scope. Returns current version, notes, and optionally siblings, parent chain, scripts.",
      schema: {
        nodeId: z.string().describe("Node ID to read."),
        includeNotes: z
          .boolean()
          .optional()
          .describe(
            "Include notes for current version. Default true.",
          ),
        includeSiblings: z
          .boolean()
          .optional()
          .describe("Include sibling node names. Default false."),
        includeParentChain: z
          .boolean()
          .optional()
          .describe(
            "Include full path from root. Default false.",
          ),
        includeChildren: z
          .boolean()
          .optional()
          .describe("Include children names. Default true."),
        includeValues: z
          .boolean()
          .optional()
          .describe(
            "Include version values and goals. Default true.",
          ),
        includeScripts: z
          .boolean()
          .optional()
          .describe("Include script names. Default false."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({ nodeId, ...flags }) => {
        try {
          const context = await getContextForAi(nodeId, flags);
          return json(context);
        } catch (err) {
          return error(
            `Failed to load context: ${err.message}`,
          );
        }
      },
    },

    // ────────────────────────────────────────────────────────────────────────
    // WRITE tools
    // ────────────────────────────────────────────────────────────────────────

    {
      name: "edit-node-or-branch-status",
      description:
        "Calls editStatus() to update a node's status (optionally recursively).",
      schema: {
        nodeId: z
          .string()
          .describe(
            "The unique ID of the node whose status will be edited.",
          ),
        status: z
          .enum(["active", "trimmed", "completed"])
          .describe("The new status to set for the node."),
        prestige: z
          .number()
          .describe(
            "Prestige version number of the node to modify.",
          ),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({
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
          return json(result);
        } catch (err) {
          return text(
            `Failed to update status: ${err.message}`,
          );
        }
      },
    },

    {
      name: "create-node-version-note",
      description:
        "Creates a new text note for a node. Please confirm exact wording of content and do not add anything unless asked.",
      schema: {
        content: z
          .string()
          .describe("The text content of the note."),
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
        nodeId: z
          .string()
          .describe("The ID of the node the note belongs to."),
        prestige: z
          .number()
          .describe("The prestige version of the node"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({
        content,
        userId,
        nodeId,
        prestige,
        chatId,
        sessionId,
      }) => {
        try {
          const result = await createNote({
            contentType: "text",
            content,
            userId,
            nodeId,
            wasAi: true,
            chatId,
            sessionId,
            metadata: { treeos: { isReflection: true } },
          });
          return json(result);
        } catch (err) {
          return text(
            `Failed to create note: ${err.message}`,
          );
        }
      },
    },

    {
      name: "edit-node-note",
      description:
        "Edit an existing text note. Replaces all content by default. Specify lineStart/lineEnd to replace a specific range, or lineStart alone to insert.",
      schema: {
        nodeId: z
          .string()
          .describe(
            "The unique ID of the node whose note will be edited.",
          ),
        prestige: z
          .number()
          .describe(
            "Prestige version number of the node to modify.",
          ),
        noteId: z
          .string()
          .describe("The ID of the note to edit."),
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
            "ID of the user making the edit (for contribution logging).",
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({
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
          return json(result);
        } catch (err) {
          return error(
            `Failed to edit note: ${err.message}`,
          );
        }
      },
    },

    {
      name: "transfer-node-note",
      description:
        "Transfers a note from its current node to a different node in the same tree. Logs contributions on both source and target nodes.",
      schema: {
        noteId: z
          .string()
          .describe("The ID of the note to transfer."),
        targetNodeId: z
          .string()
          .describe("The destination node ID."),
        prestige: z
          .number()
          .optional()
          .describe(
            "Target version (defaults to latest).",
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({
        noteId,
        targetNodeId,
        prestige,
        userId,
        chatId,
        sessionId,
      }) => {
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
          return json(result);
        } catch (err) {
          return text(
            `Failed to transfer note: ${err.message}`,
          );
        }
      },
    },

    {
      name: "delete-node-note",
      description: "Deletes a text note by its ID.",
      schema: {
        noteId: z
          .string()
          .describe("The ID of the note to delete."),
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
        nodeId: z
          .string()
          .describe("The ID of the node the note belongs to."),
        prestige: z
          .number()
          .describe("The prestige version of the node"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({ noteId, userId, chatId, sessionId }) => {
        try {
          const result = await deleteNoteAndFile({
            noteId,
            userId,
            wasAi: true,
            chatId,
            sessionId,
          });
          return json(result);
        } catch (err) {
          return text(
            `Failed to delete note: ${err.message}`,
          );
        }
      },
    },

    {
      name: "create-new-node",
      description: "Create a single new node under an existing parent.",
      schema: {
        name: z.string().describe("Name of the new node."),
        parentId: z
          .string()
          .describe("ID of the parent node."),
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
        note: z
          .string()
          .nullable()
          .optional()
          .describe("Optional initial note"),
        type: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Optional semantic type. Core types: goal, plan, task, knowledge, resource, identity. Custom types valid.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({
        name,
        parentId,
        userId,
        note,
        type,
        chatId,
        sessionId,
      }) => {
        try {
          const newNode = await createNode({
            name,
            parentId,
            userId,
            type: type ?? null,
            note: note ?? null,
            wasAi: true,
            chatId: chatId ?? null,
            sessionId: sessionId ?? null,
          });
          return json(newNode);
        } catch (err) {
          return error(
            `Failed to create node: ${err.message}`,
          );
        }
      },
    },

    {
      name: "create-tree",
      description: "Creates a new tree by creating a root node.",
      schema: {
        name: z
          .string()
          .describe("Name of the new tree (root node)."),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({
        name,
        note,
        type,
        userId,
        chatId,
        sessionId,
      }) => {
        try {
          const rootNode = await createNode({
            name,
            isRoot: true,
            userId,
            type: type ?? null,
            note: note ?? null,
            wasAi: true,
            chatId: chatId ?? null,
            sessionId: sessionId ?? null,
          });
          return json(rootNode);
        } catch (err) {
          return error(
            `Failed to create tree: ${err.message}`,
          );
        }
      },
    },

    {
      name: "create-new-node-branch",
      description:
        "Used to create new node branch off a current node to extend its structure.",
      schema: {
        nodeData: NodeSchema.describe(
          "JSON structure of the node branch to create.",
        ),
        parentId: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Parent node ID for the root of this subtree.",
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({
        nodeData,
        parentId,
        userId,
        chatId,
        sessionId,
      }) => {
        try {
          const { rootId, rootName, totalCreated } =
            await createNodeBranch(
              nodeData,
              parentId,
              userId,
              true, // wasAi
              chatId,
              sessionId,
            );
          return text(
            `Successfully created a new node branch!\n\n` +
              `Root Node: "${rootName}"\n` +
              `Root ID: ${rootId}\n` +
              `Total Nodes Created: ${totalCreated}`,
          );
        } catch (err) {
          return text(
            `Failed to create recursive nodes: ${err.message}`,
          );
        }
      },
    },

    {
      name: "delete-node-branch",
      description:
        "Used to retire (delete) a node branch and detach it from its parent.",
      schema: {
        nodeId: z
          .string()
          .describe("ID of the node branch to delete."),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      handler: async ({ nodeId, userId, chatId, sessionId }) => {
        try {
          const deletedNode = await deleteNodeBranch(
            nodeId,
            userId,
            true, // wasAi
            chatId,
            sessionId,
          );
          return text(
            `Node branch retired successfully.\n\n` +
              `Node ID: ${deletedNode._id.toString()}\n` +
              `Previous Parent: ${deletedNode.parent === DELETED ? "N/A" : deletedNode.parent}`,
          );
        } catch (err) {
          return text(
            `Failed to delete node branch: ${err.message}`,
          );
        }
      },
    },

    {
      name: "edit-node-name",
      description:
        "Renames an existing node and logs the name change.",
      schema: {
        nodeId: z
          .string()
          .describe("The ID of the node being renamed."),
        newName: z
          .string()
          .describe("The new name to assign to the node."),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({
        nodeId,
        newName,
        userId,
        chatId,
        sessionId,
      }) => {
        try {
          const { oldName, newName: updatedName } =
            await editNodeName({
              nodeId,
              newName,
              userId,
              wasAi: true,
              chatId,
              sessionId,
            });
          return text(
            `Node: ${nodeId} was renamed successfully from "${oldName}" to "${updatedName}".`,
          );
        } catch (err) {
          return text(
            `Failed to rename node: ${err.message}`,
          );
        }
      },
    },

    {
      name: "edit-node-type",
      description: "Set or clear a node's semantic type.",
      schema: {
        nodeId: z
          .string()
          .describe("The ID of the node to update."),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({
        nodeId,
        newType,
        userId,
        chatId,
        sessionId,
      }) => {
        try {
          const { oldType, newType: updatedType } =
            await editNodeType({
              nodeId,
              newType,
              userId,
              wasAi: true,
              chatId,
              sessionId,
            });
          return text(
            `Node ${nodeId} type changed from "${oldType}" to "${updatedType}".`,
          );
        } catch (err) {
          return error(
            `Failed to update node type: ${err.message}`,
          );
        }
      },
    },

    {
      name: "update-node-branch-parent-relationship",
      description:
        "Moves a node to a new parent within the tree hierarchy.",
      schema: {
        nodeChildId: z
          .string()
          .describe("The ID of the child node to move."),
        nodeNewParentId: z
          .string()
          .describe("The ID of the new parent node."),
        userId: z
          .string()
          .describe(
            "The user performing the operation (optional).",
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async ({
        nodeChildId,
        nodeNewParentId,
        userId,
        chatId,
        sessionId,
      }) => {
        try {
          const { nodeChild, nodeNewParent } =
            await updateParentRelationship(
              nodeChildId,
              nodeNewParentId,
              userId,
              true, // wasAi
              chatId,
              sessionId,
            );
          return text(
            `Node '${nodeChild.name}' successfully moved under '${nodeNewParent.name}'.`,
          );
        } catch (err) {
          return text(
            `Failed to update parent: ${err.message}`,
          );
        }
      },
    },
  ];
}
