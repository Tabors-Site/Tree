import { z } from "zod";
import { runExplore, getExploreMap, getExploreGaps } from "./core.js";

export default [
  {
    name: "explore-branch",
    description:
      "Explore the branch below a node to find specific information. Scans structure first, " +
      "probes metadata signals, samples notes from top candidates, drills deeper if needed. " +
      "Returns a navigation map showing what was found and what wasn't.",
    schema: {
      nodeId: z.string().describe("The node to explore from."),
      query: z.string().describe("What to find. Natural language."),
      deep: z.boolean().optional().default(false).describe("More iterations, lower confidence threshold."),
      userId: z.string().describe("Injected by server. Ignore."),
      username: z.string().optional().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ nodeId, query, deep, userId, username }) => {
      try {
        const map = await runExplore(nodeId, query, userId, username || "system", { deep });
        if (map.error) {
          return { content: [{ type: "text", text: map.error }] };
        }

        // Human-readable output for AI to relay
        const parts = [`Explored ${map.nodesExplored} nodes, read ${map.notesRead}/${map.totalNotesInBranch} notes (${map.coverage} coverage).`];
        if (map.map?.length > 0) {
          parts.push(`\nFindings:`);
          for (const f of map.map.slice(0, 10)) {
            parts.push(`  ${f.nodeName || f.nodeId}: ${f.summary || f.content?.slice(0, 100) || "found"} (relevance: ${f.relevance || "?"})`);
          }
          if (map.map.length > 10) parts.push(`  ...and ${map.map.length - 10} more`);
        }
        if (map.gaps?.length > 0) parts.push(`\nGaps: ${map.gaps.join("; ")}`);
        if (map.unexplored?.length > 0) {
          parts.push(`\nUnexplored: ${map.unexplored.slice(0, 5).map(u => u.name || u.nodeId).join(", ")}`);
        }

        return {
          content: [{ type: "text", text: parts.join("\n") }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Exploration failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "explore-map",
    description: "Read the last exploration map at a position. Shows what was found without re-exploring.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const map = await getExploreMap(nodeId);
        if (!map) return { content: [{ type: "text", text: "No exploration map at this position. Run explore-branch first." }] };
        return { content: [{ type: "text", text: JSON.stringify(map, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "explore-drill",
    description: "Drill into a specific unexplored node from a previous exploration. Continues where the last explore stopped.",
    schema: {
      nodeId: z.string().describe("The unexplored node to drill into."),
      query: z.string().describe("The same query or a refined one."),
      userId: z.string().describe("Injected by server. Ignore."),
      username: z.string().optional().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ nodeId, query, userId, username }) => {
      try {
        const map = await runExplore(nodeId, query, userId, username || "system", {});
        if (map.error) {
          return { content: [{ type: "text", text: map.error }] };
        }

        const parts = [`Drilled into ${map.rootNode}. Explored ${map.nodesExplored} nodes, read ${map.notesRead} notes (${map.coverage} coverage).`];
        if (map.map?.length > 0) {
          parts.push(`\nFindings:`);
          for (const f of map.map.slice(0, 10)) {
            parts.push(`  ${f.nodeName || f.nodeId}: ${f.summary || f.content?.slice(0, 100) || "found"} (relevance: ${f.relevance || "?"})`);
          }
        }
        if (map.gaps?.length > 0) parts.push(`\nGaps: ${map.gaps.join("; ")}`);

        return {
          content: [{ type: "text", text: parts.join("\n") }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Drill failed: ${err.message}` }] };
      }
    },
  },
];
