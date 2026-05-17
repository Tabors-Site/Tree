import { z } from "zod";
import log from "../../seed/log.js";
import { compressTree, compressBranch, compressToBudget, decompressNode, getCompressStatus } from "./core.js";

export default [
  {
    name: "compress-tree",
    description:
      "Start a full compression run on the current tree. Walks from leaves to root, compressing " +
      "notes into essence summaries and fact dictionaries. Nodes are marked trimmed. Crown stays readable.",
    schema: {
      rootId: z.string().describe("The tree root to compress."),
      targetSizeBytes: z.number().optional().describe("If set, stop when tree is under this size (budget mode)."),
      beingId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ rootId, targetSizeBytes, beingId }) => {
      try {
        let username = null;
        try {
          const User = (await import("../../seed/models/being.js")).default;
          const user = await Being.findById(beingId).select("username").lean();
          username = user?.username;
        } catch (err) {
          log.debug("TreeCompress", "Username lookup failed:", err.message);
        }

        let result;
        if (targetSizeBytes) {
          result = await compressToBudget(rootId, beingId, username, targetSizeBytes);
        } else {
          result = await compressTree(rootId, beingId, username);
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Compression failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "compress-branch",
    description: "Compress from this node downward only. Does not affect the rest of the tree.",
    schema: {
      nodeId: z.string().describe("The node to start compressing from."),
      beingId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ nodeId, beingId }) => {
      try {
        let username = null;
        try {
          const User = (await import("../../seed/models/being.js")).default;
          const user = await Being.findById(beingId).select("username").lean();
          username = user?.username;
        } catch (err) {
          log.debug("TreeCompress", "Username lookup failed:", err.message);
        }

        const result = await compressBranch(nodeId, beingId, username);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Branch compression failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "compress-status",
    description: "Show compression state of a tree. Compressed, absorbed, uncompressed counts. History of runs.",
    schema: {
      rootId: z.string().describe("The tree root to check."),
      beingId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ rootId }) => {
      try {
        const status = await getCompressStatus(rootId);
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Status check failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "decompress-node",
    description: "Restore a trimmed node to active. Its notes become visible again. Its essence stays as a bonus.",
    schema: {
      nodeId: z.string().describe("The node to decompress."),
      beingId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId, beingId }) => {
      try {
        const result = await decompressNode(nodeId, beingId);
        return { content: [{ type: "text", text: result.message }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Decompress failed: ${err.message}` }] };
      }
    },
  },
];
