/**
 * Todo Tools
 *
 * MCP tools for managing todos as tree nodes.
 */

import { z } from "zod";

export default function getTools({ Node, metadata }) {
  return [
    {
      name: "todo-add",
      description:
        "Add a new todo node under a root. The todo appears as a child node " +
        "with its text as the node name and completed=false in metadata.",
      schema: {
        rootId: z.string().describe("Root node ID to add the todo under."),
        text: z.string().describe("Todo text (becomes the node name)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ rootId, text }) => {
        try {
          const node = await Node.create({
            name: text,
            parent: rootId,
            metadata: { todo: { completed: false, createdAt: new Date().toISOString() } },
          });
          return {
            content: [{ type: "text", text: `Created todo "${text}" (${String(node._id).slice(0, 8)})` }],
          };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "todo-toggle",
      description:
        "Toggle the completion status of a todo node. " +
        "Reads current status from metadata.todo.completed and flips it.",
      schema: {
        nodeId: z.string().describe("Todo node ID to toggle."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ nodeId }) => {
        try {
          const node = await Node.findById(nodeId).select("name metadata").lean();
          if (!node) {
            return { content: [{ type: "text", text: "Todo not found." }] };
          }
          const currentMeta = node.metadata instanceof Map
            ? node.metadata.get("todo")
            : node.metadata?.todo;
          const wasCompleted = currentMeta?.completed || false;
          const newStatus = !wasCompleted;
          await metadata.setExtMeta(nodeId, "todo", { completed: newStatus });
          return {
            content: [
              { type: "text", text: `Toggled "${node.name}" to ${newStatus ? "completed" : "pending"}.` },
            ],
          };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "todo-remove",
      description:
        "Remove a todo node from the tree permanently.",
      schema: {
        nodeId: z.string().describe("Todo node ID to remove."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async ({ nodeId }) => {
        try {
          const result = await Node.findByIdAndDelete(nodeId);
          if (!result) {
            return { content: [{ type: "text", text: "Todo not found." }] };
          }
          return { content: [{ type: "text", text: "Todo removed." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "todo-list",
      description:
        "List all todos under a root node with their completion status.",
      schema: {
        rootId: z.string().describe("Root node ID to list todos under."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId }) => {
        try {
          const todos = await Node.find({ parent: rootId, "metadata.todo.completed": { $exists: true } })
            .select("name metadata")
            .sort({ "metadata.todo.createdAt": 1 })
            .lean();

          if (todos.length === 0) {
            return { content: [{ type: "text", text: "No todos found." }] };
          }

          const pending = todos
            .filter((t) => { const m = t.metadata?.todo || {}; return !m.completed; })
            .map((t) => `◻ ${t.name}`);
          const completed = todos
            .filter((t) => { const m = t.metadata?.todo || {}; return m.completed; })
            .map((t) => `✓ ${t.name}`);

          const parts = [];
          if (pending.length > 0) parts.push(`Pending (${pending.length}):`); 
          parts.push(...pending);
          if (completed.length > 0) { parts.push(`\nCompleted (${completed.length}):`); parts.push(...completed); }
          
          return { content: [{ type: "text", text: parts.join("\n") }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
  ];
}
