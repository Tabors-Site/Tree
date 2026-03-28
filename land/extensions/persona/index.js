import log from "../../seed/log.js";
import router, { setMetadata as setRouteMetadata } from "./routes.js";
import tools, { setMetadata as setToolMetadata } from "./tools.js";

/**
 * Resolve the effective persona at a position by walking the ancestor chain.
 * Returns the merged persona object, or null if none defined.
 *
 * Resolution: root-to-node. Each node's metadata.persona either replaces
 * the accumulated persona (default) or merges over it (_inherit: true).
 * Closest node wins for overridden fields. Parent fields carry through on inherit.
 */
export function resolvePersonaFromChain(chain) {
  if (!chain || chain.length === 0) return null;

  let effective = null;

  // Walk root-to-node (chain is node-to-root, so reverse)
  for (let i = chain.length - 1; i >= 0; i--) {
    const ancestor = chain[i];
    if (ancestor.systemRole) continue;
    const persona = ancestor.metadata?.persona;
    if (!persona) continue;

    if (persona._inherit && effective) {
      effective = { ...effective, ...persona };
    } else {
      effective = { ...persona };
    }
  }

  if (effective) delete effective._inherit;
  return effective;
}

/**
 * Format a resolved persona as prompt text.
 */
function formatPersona(persona) {
  if (!persona) return "";
  const lines = [];

  if (persona.name) lines.push(`You are ${persona.name}.`);
  if (persona.voice) lines.push(persona.voice);
  if (Array.isArray(persona.traits) && persona.traits.length > 0) {
    lines.push(`You are ${persona.traits.join(", ")}.`);
  }
  if (Array.isArray(persona.boundaries) && persona.boundaries.length > 0) {
    for (const b of persona.boundaries) lines.push(b.endsWith(".") ? b : `${b}.`);
  }

  return lines.length > 0 ? lines.join("\n") + "\n\n" : "";
}

// Store reference to core.tree.getAncestorChain for use in routes/tools
let _getAncestorChain = null;
export function getAncestorChainFn() { return _getAncestorChain; }

export async function init(core) {
  _getAncestorChain = core.tree.getAncestorChain;
  setRouteMetadata(core.metadata);
  setToolMetadata(core.metadata);

  // beforeLLMCall: resolve persona from ancestor chain and prepend to system message.
  // Identity before location. The persona block goes before the position block.
  core.hooks.register("beforeLLMCall", async (hookData) => {
    const { messages, nodeId } = hookData;
    if (!messages || !messages[0] || messages[0].role !== "system") return;
    if (!nodeId) return;

    let chain;
    try {
      chain = await core.tree.getAncestorChain(nodeId);
    } catch (err) {
      log.debug("Persona", `Ancestor chain failed: ${err.message}`);
      return;
    }

    const persona = resolvePersonaFromChain(chain);
    if (!persona) return;

    const block = formatPersona(persona);
    if (!block) return;

    // Prepend persona to system message. Identity first.
    messages[0].content = block + messages[0].content;
  }, "persona");

  // enrichContext: inject resolved persona into the structured context object.
  // Used by tools (persona-get) and by any extension that wants to read
  // the effective persona at a position.
  core.hooks.register("enrichContext", async ({ context, node, meta, userId }) => {
    if (!node?._id) return;

    let chain;
    try {
      chain = await core.tree.getAncestorChain(String(node._id));
    } catch { return; }

    const persona = resolvePersonaFromChain(chain);
    if (persona) context.persona = persona;
  }, "persona");

  return {
    router,
    tools,
    exports: {
      resolvePersonaFromChain,
      formatPersona,
    },
  };
}
