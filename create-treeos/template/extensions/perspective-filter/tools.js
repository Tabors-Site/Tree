import { z } from "zod";
import { resolvePerspective, setPerspective, clearPerspective } from "./core.js";
import Node from "../../seed/models/node.js";

export default [
  {
    name: "get-perspective",
    description:
      "Get the effective perspective filter for a node. Shows what cascade signals this node accepts, including rules inherited from parent nodes.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      try {
        const node = await Node.findById(nodeId).select("name metadata parent systemRole").lean();
        if (!node) {
          return { content: [{ type: "text", text: "Node not found." }] };
        }

        const perspective = await resolvePerspective(node);

        const meta = node.metadata instanceof Map
          ? Object.fromEntries(node.metadata)
          : (node.metadata || {});
        const hasOwn = !!(meta.perspective?.accept?.length || meta.perspective?.reject?.length);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              nodeId,
              nodeName: node.name,
              hasOwnPerspective: hasOwn,
              effectivePerspective: perspective || { accept: [], reject: [] },
              inherited: !hasOwn && perspective !== null,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "set-perspective",
    description:
      "Set the perspective filter on a node. Controls which cascade signals are accepted. Overrides any inherited perspective. Pass accept and/or reject arrays of topic tags.",
    schema: {
      nodeId: z.string().describe("The node to configure."),
      accept: z.array(z.string()).optional().describe("Accept signals tagged with these topics. If set, only matching signals pass."),
      reject: z.array(z.string()).optional().describe("Reject signals tagged with these topics. Checked before accept list."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId, accept, reject }) => {
      try {
        if (!accept?.length && !reject?.length) {
          return { content: [{ type: "text", text: "Provide at least one of accept or reject arrays." }] };
        }

        const result = await setPerspective(nodeId, { accept, reject });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Perspective set",
              nodeId,
              perspective: result,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "clear-perspective",
    description:
      "Clear the perspective filter on a node so it inherits from its parent again.",
    schema: {
      nodeId: z.string().describe("The node to clear."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      try {
        await clearPerspective(nodeId);
        return {
          content: [{ type: "text", text: `Perspective cleared on ${nodeId}. Node now inherits from parent.` }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
