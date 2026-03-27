import { z } from "zod";
import { getWatchlist, watchTool, unwatchTool, getPendingRequests, resolveRequest } from "./core.js";

export default [
  {
    name: "approve-watch",
    description: "Add a tool to the approval watchlist. The AI will pause and wait for operator approval before executing this tool.",
    schema: {
      nodeId: z.string().describe("The node to set the watchlist on (inherits to children)."),
      toolName: z.string().describe("The tool name to watch (e.g. delete-node-branch, execute-shell)."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async ({ nodeId, toolName }) => {
      try {
        const list = await watchTool(nodeId, toolName);
        return { content: [{ type: "text", text: `Watching "${toolName}". AI will pause for approval before executing. Watchlist: ${list.join(", ")}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "approve-unwatch",
    description: "Remove a tool from the approval watchlist.",
    schema: {
      nodeId: z.string().describe("The node to modify."),
      toolName: z.string().describe("The tool name to stop watching."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async ({ nodeId, toolName }) => {
      try {
        const list = await unwatchTool(nodeId, toolName);
        return { content: [{ type: "text", text: `Unwatched "${toolName}". Remaining: ${list.length > 0 ? list.join(", ") : "(none)"}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "approve-pending",
    description: "Show pending approval requests. Tools waiting for operator decision.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async () => {
      try {
        const requests = getPendingRequests();
        if (requests.length === 0) {
          return { content: [{ type: "text", text: "No pending approval requests." }] };
        }
        const lines = requests.map(r =>
          `[${r.id.slice(0, 8)}] ${r.toolName} at ${r.nodeId?.slice(0, 8)} -- ${JSON.stringify(r.args).slice(0, 150)}`
        );
        return { content: [{ type: "text", text: `${requests.length} pending:\n${lines.join("\n")}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "approve-resolve",
    description: "Approve or reject a pending tool call. Decision: 'approved' or 'rejected'.",
    schema: {
      requestId: z.string().describe("The request ID to resolve."),
      decision: z.enum(["approved", "rejected"]).describe("Approve or reject the tool call."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async ({ requestId, decision, userId }) => {
      try {
        const result = resolveRequest(requestId, decision, userId);
        if (!result) return { content: [{ type: "text", text: "Request not found or already resolved." }] };
        return { content: [{ type: "text", text: `${decision === "approved" ? "Approved" : "Rejected"}: ${result.toolName}. The AI will ${decision === "approved" ? "proceed" : "adapt"}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
