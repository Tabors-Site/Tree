import { z } from "zod";
import { calculateFitness, getPatterns, getDormant, analyzeTree } from "./core.js";

export default [
  {
    name: "node-evolution",
    description: "Show structural fitness metrics for a node. Activity, cascade, revisit, growth, codebook, and dormancy scores.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const fitness = await calculateFitness(nodeId);
        if (!fitness) return { content: [{ type: "text", text: "Node not found." }] };
        return { content: [{ type: "text", text: JSON.stringify(fitness, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "evolution-patterns",
    description: "Show discovered structural patterns for this tree. What configurations correlate with high activity? What structures go dormant?",
    schema: {
      rootId: z.string().describe("The tree root."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId }) => {
      try {
        const patterns = await getPatterns(rootId);
        if (patterns.length === 0) {
          return { content: [{ type: "text", text: "No patterns discovered yet. Run evolution-analyze or wait for the periodic analysis." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ count: patterns.length, patterns }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "evolution-analyze",
    description: "Force a full structural analysis of this tree. Calculates fitness for every node and asks the AI to discover patterns. Token-intensive.",
    schema: {
      rootId: z.string().describe("The tree root to analyze."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ rootId, userId }) => {
      try {
        let username = null;
        try {
          const User = (await import("../../seed/models/user.js")).default;
          const user = await User.findById(userId).select("username").lean();
          username = user?.username;
        } catch {}
        const result = await analyzeTree(rootId, userId, username);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Analysis failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "evolution-suggest",
    description: "Ask the AI to recommend structural changes based on discovered patterns and the current node's fitness.",
    schema: {
      nodeId: z.string().describe("The node to get suggestions for."),
      rootId: z.string().describe("The tree root (for pattern context)."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ nodeId, rootId, userId }) => {
      try {
        const fitness = await calculateFitness(nodeId);
        const patterns = await getPatterns(rootId);
        if (!fitness) return { content: [{ type: "text", text: "Node not found." }] };

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Here is this node's fitness and the tree's structural patterns. Use these to suggest improvements.",
              fitness,
              patterns: patterns.slice(0, 10),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "evolution-dormant",
    description: "List dormant branches that stopped growing and might need pruning or compression.",
    schema: {
      rootId: z.string().describe("The tree root."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId }) => {
      try {
        const dormant = await getDormant(rootId);
        if (dormant.length === 0) {
          return { content: [{ type: "text", text: "No dormant branches found. Everything is active." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              dormantCount: dormant.length,
              branches: dormant.map((d) => ({
                name: d.nodeName,
                type: d.nodeType,
                dormantDays: d.dormancyDays,
                noteCount: d.noteCount,
                children: d.childCount,
              })),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
