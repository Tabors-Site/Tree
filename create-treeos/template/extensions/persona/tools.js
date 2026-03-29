import { z } from "zod";
import Node from "../../seed/models/node.js";
import { resolvePersonaFromChain, getAncestorChainFn } from "./index.js";

let _metadata = null;
export function setMetadata(metadata) { _metadata = metadata; }

export default [
  {
    name: "persona-get",
    description:
      "Show the effective persona at a node. Resolves inheritance from the ancestor chain. Shows who the AI is at this position, where the persona comes from, and whether it's inherited or locally defined.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      const getAncestorChain = getAncestorChainFn();
      if (!getAncestorChain) {
        return { content: [{ type: "text", text: "Ancestor cache not available." }] };
      }

      const chain = await getAncestorChain(nodeId);
      if (!chain) {
        return { content: [{ type: "text", text: "Node not found." }] };
      }

      const persona = resolvePersonaFromChain(chain);
      if (!persona) {
        return { content: [{ type: "text", text: "No persona defined at this position or any ancestor. The AI has no name here." }] };
      }

      // Find source
      let sourceId = null;
      let sourceName = null;
      for (const ancestor of chain) {
        if (ancestor.systemRole) continue;
        if (ancestor.metadata?.persona) {
          sourceId = ancestor._id;
          sourceName = ancestor.name;
          break;
        }
      }

      const isLocal = sourceId === nodeId;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            persona,
            source: { nodeId: sourceId, name: sourceName },
            inherited: !isLocal,
          }, null, 2),
        }],
      };
    },
  },

  {
    name: "persona-set",
    description:
      "Set the AI persona at a node. Provide the full persona object or update individual fields. The persona defines who the AI is at this position and everything below it. Fields: name (string), voice (string), traits (array), boundaries (array), greeting (string or null), pronoun (string), _inherit (boolean, merge with parent instead of replacing).",
    schema: {
      nodeId: z.string().describe("The node to set persona on."),
      name: z.string().optional().describe("The persona's name."),
      voice: z.string().optional().describe("How the persona speaks. Tone, style, attitude."),
      traits: z.array(z.string()).optional().describe("Character traits."),
      boundaries: z.array(z.string()).optional().describe("Things this persona never does."),
      greeting: z.string().nullable().optional().describe("Optional first-message behavior."),
      pronoun: z.string().optional().describe("How the persona refers to itself. Default: I."),
      inherit: z.boolean().optional().describe("If true, merge with parent persona instead of replacing."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId, name, voice, traits, boundaries, greeting, pronoun, inherit }) => {
      const node = await Node.findById(nodeId);
      if (!node) {
        return { content: [{ type: "text", text: "Node not found." }] };
      }
      if (node.systemRole) {
        return { content: [{ type: "text", text: "Cannot set persona on system nodes." }] };
      }

      // Build persona from provided fields
      const persona = {};
      if (name !== undefined) persona.name = name;
      if (voice !== undefined) persona.voice = voice;
      if (traits !== undefined) persona.traits = traits;
      if (boundaries !== undefined) persona.boundaries = boundaries;
      if (greeting !== undefined) persona.greeting = greeting;
      if (pronoun !== undefined) persona.pronoun = pronoun;
      if (inherit !== undefined) persona._inherit = inherit;

      if (Object.keys(persona).length === 0) {
        return { content: [{ type: "text", text: "No persona fields provided. Set at least name or voice." }] };
      }

      // Size check
      const size = Buffer.byteLength(JSON.stringify(persona), "utf8");
      if (size > 4096) {
        return { content: [{ type: "text", text: `Persona too large (${size} bytes, max 4096).` }] };
      }

      await _metadata.setExtMeta(node, "persona", persona);

      const display = persona.name ? `Persona "${persona.name}" set at this node.` : "Persona set at this node.";
      return {
        content: [{
          type: "text",
          text: `${display} Everything below inherits this identity unless overridden.\n\n${JSON.stringify(persona, null, 2)}`,
        }],
      };
    },
  },

  {
    name: "persona-clear",
    description:
      "Remove the persona at a node. The node will inherit persona from its parent. If no parent has a persona, the AI at this position has no name.",
    schema: {
      nodeId: z.string().describe("The node to clear persona from."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      const node = await Node.findById(nodeId);
      if (!node) {
        return { content: [{ type: "text", text: "Node not found." }] };
      }

      const meta = node.metadata instanceof Map ? node.metadata : (node.metadata || {});
      const existing = meta instanceof Map ? meta.get("persona") : meta.persona;
      if (!existing) {
        return { content: [{ type: "text", text: "No persona defined at this node. Nothing to clear." }] };
      }

      await _metadata.setExtMeta(node, "persona", null);

      return {
        content: [{ type: "text", text: "Persona removed. This node now inherits from its parent." }],
      };
    },
  },
];
