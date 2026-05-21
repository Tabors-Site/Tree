import { z } from "zod";
import { exportTreeSeed, plantTreeSeed, analyzeSeed } from "./core.js";

export default [
  {
    name: "seed-export",
    description:
      "Export the current tree as a seed file. Captures the node hierarchy and structural " +
      "metadata (cascade, scoping, tools, modes, personas, perspectives, purpose) without " +
      "any content. The DNA of the tree.",
    schema: {
      rootId: z.string().describe("Tree root to export."),
      cascade: z.boolean().optional().default(false).describe("Include cascade topology summary."),
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId, cascade, beingId }) => {
      try {
        const seed = await exportTreeSeed(rootId, beingId, { cascade });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sourceTreeName: seed.sourceTreeName,
              nodeCount: seed.stats.nodeCount,
              maxDepth: seed.stats.maxDepth,
              requiredExtensions: seed.requiredExtensions,
              cascadeTopology: seed.cascadeTopology?.length || 0,
              message: "Seed exported. Use seed-plant to plant it on another tree, or seed-analyze to inspect it.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Export failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "seed-analyze",
    description:
      "Analyze a seed file before planting. Reports node count, depth, required extensions, " +
      "and which are missing on this land.",
    schema: {
      seedJson: z.string().describe("The seed file JSON as a string."),
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ seedJson }) => {
      try {
        const seedData = JSON.parse(seedJson);
        const analysis = await analyzeSeed(seedData);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(analysis, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Analysis failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "seed-plant",
    description:
      "Plant a seed file to create a new tree with the exported structure. " +
      "Creates the full node hierarchy with structural metadata applied.",
    schema: {
      seedJson: z.string().describe("The seed file JSON as a string."),
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ seedJson, beingId }) => {
      try {
        const Being = (await import("../../seed/models/being.js")).default;
        const user = await Being.findById(beingId).select("username").lean();
        const seedData = JSON.parse(seedJson);
        const result = await plantTreeSeed(seedData, beingId, user?.username || "system");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              rootId: result.rootId,
              rootName: result.rootName,
              nodeCount: result.nodeCount,
              warnings: result.warnings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Plant failed: ${err.message}` }] };
      }
    },
  },
];
