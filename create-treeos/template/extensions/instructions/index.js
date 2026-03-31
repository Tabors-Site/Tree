/**
 * Instructions Extension
 *
 * Per-node AI behavioral constraints via metadata.llm.instructions.
 * Walks ancestor chain root-to-current, concatenates, prepends to system prompt.
 * Same pattern as persona. Extension, not kernel. The AI works without it.
 */

import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";

export async function init(core) {
  // beforeLLMCall: collect instructions from ancestor chain, prepend to system prompt
  core.hooks.register("beforeLLMCall", async (hookData) => {
    const { messages, nodeId } = hookData;
    if (!messages?.[0] || messages[0].role !== "system" || !nodeId) return;

    const chain = await core.tree.getAncestorChain(nodeId);
    if (!chain || chain.length === 0) return;

    const instructions = [];
    // Walk root-to-current (chain is current-to-root, so reverse)
    for (let i = chain.length - 1; i >= 0; i--) {
      const inst = chain[i].metadata?.llm?.instructions;
      if (inst && typeof inst === "string" && inst.trim()) {
        instructions.push(inst.trim());
      }
    }

    if (instructions.length > 0) {
      messages[0].content = `[Instructions]\n${instructions.join("\n")}\n\n${messages[0].content}`;
    }
  }, "instructions");

  // Routes for CLI
  const router = express.Router();

  // GET: show instructions at node (including inherited)
  router.get("/node/:nodeId/instructions", authenticate, async (req, res) => {
    try {
      const chain = await core.tree.getAncestorChain(req.params.nodeId);
      if (!chain) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const layers = [];
      for (let i = chain.length - 1; i >= 0; i--) {
        const inst = chain[i].metadata?.llm?.instructions;
        if (inst && typeof inst === "string" && inst.trim()) {
          layers.push({ nodeId: chain[i]._id, name: chain[i].name, instructions: inst.trim() });
        }
      }

      const local = chain[0]?.metadata?.llm?.instructions || null;
      sendOk(res, { local, inherited: layers, effective: layers.map(l => l.instructions).join("\n") || null });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // POST: set instructions at node
  router.post("/node/:nodeId/instructions", authenticate, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const text = req.body.instructions;
      if (!text || typeof text !== "string" || !text.trim()) {
        return sendError(res, 400, ERR.INVALID_INPUT, "instructions must be a non-empty string");
      }

      const node = await core.models.Node.findById(nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const llmMeta = core.metadata.getExtMeta(node, "llm");
      llmMeta.instructions = text.trim();
      await core.metadata.setExtMeta(node, "llm", llmMeta);

      sendOk(res, { nodeId, instructions: llmMeta.instructions });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // DELETE: clear instructions at node
  router.delete("/node/:nodeId/instructions", authenticate, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await core.models.Node.findById(nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const llmMeta = core.metadata.getExtMeta(node, "llm");
      delete llmMeta.instructions;
      if (Object.keys(llmMeta).length > 0) {
        await core.metadata.setExtMeta(node, "llm", llmMeta);
      } else {
        await core.metadata.unsetExtMeta(nodeId, "llm");
      }

      sendOk(res, { nodeId, cleared: true });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return { router };
}
