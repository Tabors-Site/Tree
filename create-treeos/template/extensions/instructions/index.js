/**
 * Instructions Extension
 *
 * Two layers of AI behavioral constraints, both injected via beforeLLMCall:
 *
 *   [User Instructions]   <- user-level, follows them across every tree
 *   [Instructions]        <- node-level, walks ancestor chain at current position
 *   <mode prompt>         <- the actual mode's system prompt
 *
 * Broadest scope first, narrowest last. Same pattern as the position/time
 * injection in modes/registry.js.
 *
 * User instructions are stored in user.metadata.instructions:
 *   {
 *     global: [{ id, text, addedAt }, ...],
 *     byExtension: {
 *       food: [{ id, text, addedAt }, ...],
 *       fitness: [{ id, text, addedAt }, ...],
 *     }
 *   }
 *
 * Node instructions are stored in node.metadata.llm.instructions (string).
 *
 * Capture happens via the add-instruction tool, which the AI calls when the
 * user says "remember to...", "I'm vegetarian", "always use kg", etc. The
 * tool is injected into the converse modes, the home modes, and every
 * domain coach mode so the AI can capture instructions from any context.
 */

import express from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import User from "../../seed/models/user.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";
import { getModeOwner } from "../../seed/tree/extensionScope.js";
import log from "../../seed/log.js";

// ─────────────────────────────────────────────────────────────────────────
// READ helper: load both layers for a given userId + nodeId + mode
// ─────────────────────────────────────────────────────────────────────────

async function loadUserInstructions(userId) {
  if (!userId) return { global: [], byExtension: {} };
  const user = await User.findById(userId).select("metadata").lean();
  if (!user) return { global: [], byExtension: {} };
  const inst = user.metadata instanceof Map
    ? user.metadata.get("instructions")
    : user.metadata?.instructions;
  return {
    global: Array.isArray(inst?.global) ? inst.global : [],
    byExtension: (inst?.byExtension && typeof inst.byExtension === "object") ? inst.byExtension : {},
  };
}

// Build the [User Instructions] block for the current mode.
function buildUserInstructionsBlock(userInst, mode) {
  const lines = [];

  for (const i of userInst.global) {
    if (i?.text) lines.push(i.text);
  }

  if (mode) {
    const owner = getModeOwner(mode);
    if (owner && Array.isArray(userInst.byExtension[owner])) {
      for (const i of userInst.byExtension[owner]) {
        if (i?.text) lines.push(i.text);
      }
    }
  }

  if (lines.length === 0) return "";
  return `[User Instructions]\n${lines.join("\n")}\n\n`;
}

export async function init(core) {
  // ─────────────────────────────────────────────────────────────────────
  // beforeLLMCall: stack user-level + node-level instructions
  // ONE handler from this extension. The hook registry keys by
  // ${hookName}:${extName}, so re-registering would replace this.
  // ─────────────────────────────────────────────────────────────────────
  core.hooks.register("beforeLLMCall", async (hookData) => {
    const { messages, mode, userId, nodeId } = hookData;
    if (!messages?.[0] || messages[0].role !== "system") return;

    // ── User-level layer (broadest) ──
    let userBlock = "";
    if (userId) {
      try {
        const userInst = await loadUserInstructions(userId);
        userBlock = buildUserInstructionsBlock(userInst, mode);
      } catch (err) {
        log.debug("Instructions", `Failed to load user instructions: ${err.message}`);
      }
    }

    // ── Node-level layer (narrowest) ──
    let nodeBlock = "";
    if (nodeId) {
      try {
        const chain = await core.tree.getAncestorChain(nodeId);
        if (chain && chain.length > 0) {
          const lines = [];
          // chain is current-to-root; walk root-to-current so closest wins last
          for (let i = chain.length - 1; i >= 0; i--) {
            const inst = chain[i].metadata?.llm?.instructions;
            if (inst && typeof inst === "string" && inst.trim()) {
              lines.push(inst.trim());
            }
          }
          if (lines.length > 0) {
            nodeBlock = `[Instructions]\n${lines.join("\n")}\n\n`;
          }
        }
      } catch (err) {
        log.debug("Instructions", `Failed to walk ancestor chain: ${err.message}`);
      }
    }

    // Order: user (broadest) -> node (narrowest) -> existing system prompt.
    // Guard against double-injection in chain steps (same session, multiple LLM calls).
    if (userBlock || nodeBlock) {
      const alreadyInjected = messages[0].content.startsWith("[User Instructions]") || messages[0].content.startsWith("[Instructions]");
      if (!alreadyInjected) {
        messages[0].content = userBlock + nodeBlock + messages[0].content;
        log.verbose("Instructions", `beforeLLMCall injected: ${userBlock ? "[User Instructions]" : ""}${nodeBlock ? " [Node Instructions]" : ""} for mode ${mode || "?"}`);
      }
    }
  }, "instructions");

  // ─────────────────────────────────────────────────────────────────────
  // MCP tools for conversational capture / read / remove
  // ─────────────────────────────────────────────────────────────────────

  const tools = [
    {
      name: "add-instruction",
      description:
        "Save a user instruction that will apply to future conversations forever. " +
        "Call this when the user says something like 'remember to...', 'always...', " +
        "'I'm <something>', 'never...', 'from now on...', or otherwise expresses a " +
        "lasting preference. Pick the right scope: 'global' for things that apply " +
        "everywhere (tone, language, identity, units), or an extension name (food, " +
        "fitness, study, recovery, kb, finance, investor, market-researcher, " +
        "relationships) for things specific to that domain. If you're already inside " +
        "a domain conversation (food coach, fitness coach, etc.), prefer that " +
        "domain's name as the scope unless the instruction is clearly cross-cutting.",
      schema: {
        text: z.string().describe("The instruction in second person, e.g. 'use kg for weights' or 'never suggest meat'. Be brief and direct."),
        scope: z.string().describe("'global' for everywhere, or an extension name like 'food', 'fitness', 'study'."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ text, scope, userId }) => {
        if (!userId) return { content: [{ type: "text", text: "No user context." }] };
        if (!text || typeof text !== "string" || !text.trim()) {
          return { content: [{ type: "text", text: "text is required." }] };
        }
        const cleanText = text.trim().slice(0, 500);
        const cleanScope = (scope || "global").trim().toLowerCase();

        try {
          const user = await User.findById(userId);
          if (!user) return { content: [{ type: "text", text: "User not found." }] };

          const current = getUserMeta(user, "instructions") || {};
          if (!Array.isArray(current.global)) current.global = [];
          if (!current.byExtension || typeof current.byExtension !== "object") current.byExtension = {};

          const entry = { id: uuidv4(), text: cleanText, addedAt: new Date().toISOString() };

          if (cleanScope === "global" || cleanScope === "*") {
            current.global.push(entry);
          } else {
            if (!Array.isArray(current.byExtension[cleanScope])) current.byExtension[cleanScope] = [];
            current.byExtension[cleanScope].push(entry);
          }

          setUserMeta(user, "instructions", current);
          await user.save();

          log.info("Instructions", `Added [${cleanScope}] for user ${String(userId).slice(0, 8)}: "${cleanText.slice(0, 60)}"`);
          return {
            content: [{
              type: "text",
              text: `Saved (${cleanScope}): "${cleanText}"`,
            }],
          };
        } catch (err) {
          log.warn("Instructions", `add-instruction failed: ${err.message}`);
          return { content: [{ type: "text", text: `Failed to save: ${err.message}` }] };
        }
      },
    },

    {
      name: "list-instructions",
      description:
        "Show all of the user's saved personal instructions. Use this when the user " +
        "asks 'what do you remember about me' or 'what are my instructions' or wants " +
        "to review what's been saved.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async ({ userId }) => {
        if (!userId) return { content: [{ type: "text", text: "No user context." }] };
        try {
          const userInst = await loadUserInstructions(userId);
          const lines = [];
          if (userInst.global.length > 0) {
            lines.push("Global:");
            for (const i of userInst.global) lines.push(`  [${i.id?.slice(0, 8) || "?"}] ${i.text}`);
          }
          for (const [ext, items] of Object.entries(userInst.byExtension)) {
            if (!Array.isArray(items) || items.length === 0) continue;
            lines.push(`${ext}:`);
            for (const i of items) lines.push(`  [${i.id?.slice(0, 8) || "?"}] ${i.text}`);
          }
          if (lines.length === 0) {
            return { content: [{ type: "text", text: "No personal instructions saved yet." }] };
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed to read instructions: ${err.message}` }] };
        }
      },
    },

    {
      name: "remove-instruction",
      description:
        "Remove a saved personal instruction by id. Use this when the user says " +
        "'forget that' or 'never mind that one' or asks to remove a specific " +
        "instruction. The id is shown when listing instructions; users can refer " +
        "to it by the short prefix (first 8 chars).",
      schema: {
        id: z.string().describe("The instruction id (or its first 8 chars) to remove."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: async ({ id, userId }) => {
        if (!userId) return { content: [{ type: "text", text: "No user context." }] };
        if (!id) return { content: [{ type: "text", text: "id is required." }] };
        try {
          const user = await User.findById(userId);
          if (!user) return { content: [{ type: "text", text: "User not found." }] };

          const current = getUserMeta(user, "instructions") || {};
          let removed = null;
          const matches = (entryId) => entryId === id || entryId?.startsWith(id);

          if (Array.isArray(current.global)) {
            const idx = current.global.findIndex(i => matches(i.id));
            if (idx >= 0) {
              removed = current.global[idx];
              current.global.splice(idx, 1);
            }
          }
          if (!removed && current.byExtension) {
            for (const [ext, items] of Object.entries(current.byExtension)) {
              if (!Array.isArray(items)) continue;
              const idx = items.findIndex(i => matches(i.id));
              if (idx >= 0) {
                removed = items[idx];
                items.splice(idx, 1);
                if (items.length === 0) delete current.byExtension[ext];
                break;
              }
            }
          }

          if (!removed) {
            return { content: [{ type: "text", text: `No instruction found matching "${id}".` }] };
          }

          setUserMeta(user, "instructions", current);
          await user.save();

          log.info("Instructions", `Removed for user ${String(userId).slice(0, 8)}: "${removed.text?.slice(0, 60)}"`);
          return { content: [{ type: "text", text: `Removed: "${removed.text}"` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed to remove: ${err.message}` }] };
        }
      },
    },
  ];

  // ─────────────────────────────────────────────────────────────────────
  // Tool injection: every mode where the user might talk freely
  // ─────────────────────────────────────────────────────────────────────
  const modeTools = [
    // Top-level conversation modes get all three (capture + read + remove)
    { modeKey: "tree:converse", toolNames: ["add-instruction", "list-instructions", "remove-instruction"] },
    { modeKey: "home:default",  toolNames: ["add-instruction", "list-instructions", "remove-instruction"] },
    { modeKey: "home:fallback", toolNames: ["add-instruction", "list-instructions", "remove-instruction"] },
    // Domain coaches get add only (the user can list/remove from converse/home)
    { modeKey: "tree:food-coach",         toolNames: ["add-instruction"] },
    { modeKey: "tree:fitness-coach",      toolNames: ["add-instruction"] },
    { modeKey: "tree:fitness-plan",       toolNames: ["add-instruction"] },
    { modeKey: "tree:study-coach",        toolNames: ["add-instruction"] },
    { modeKey: "tree:study-plan",         toolNames: ["add-instruction"] },
    { modeKey: "tree:recovery-plan",      toolNames: ["add-instruction"] },
    { modeKey: "tree:relationships-coach", toolNames: ["add-instruction"] },
    { modeKey: "tree:finance-coach",      toolNames: ["add-instruction"] },
    { modeKey: "tree:investor-coach",     toolNames: ["add-instruction"] },
    { modeKey: "tree:market-coach",       toolNames: ["add-instruction"] },
  ];

  // ─────────────────────────────────────────────────────────────────────
  // HTTP routes
  // ─────────────────────────────────────────────────────────────────────
  const router = express.Router();

  // ── Node-level (existing) ────────────────────────────────────────────

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

  // ── User-level (new) ─────────────────────────────────────────────────

  // HTML page (must be registered BEFORE the JSON handler on the same path
  // so ?html requests get the rendered page instead of raw JSON).
  router.get("/user/:userId/instructions", authenticate, async (req, res, next) => {
    if (!("html" in req.query)) return next();
    try {
      const { renderInstructionsPage } = await import("./pages/instructionsPage.js");
      const { userId } = req.params;
      const user = await User.findById(userId).select("username metadata").lean();
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      const inst = user.metadata instanceof Map
        ? user.metadata.get("instructions")
        : user.metadata?.instructions;

      res.send(renderInstructionsPage({
        userId,
        username: user.username,
        instructions: inst || { global: [], byExtension: {} },
        token: req.query.token || null,
        inApp: !!req.query.inApp,
      }));
    } catch (err) {
      log.warn("Instructions", `HTML page error: ${err.message}`);
      sendError(res, 500, ERR.INTERNAL, "Failed to load instructions page");
    }
  });

  // JSON API
  router.get("/user/:userId/instructions", authenticate, async (req, res) => {
    try {
      if (req.userId !== req.params.userId) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not your account");
      }
      const userInst = await loadUserInstructions(req.params.userId);
      sendOk(res, userInst);
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/user/:userId/instructions", authenticate, async (req, res) => {
    try {
      if (req.userId !== req.params.userId) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not your account");
      }
      const { text, scope } = req.body;
      if (!text || typeof text !== "string" || !text.trim()) {
        return sendError(res, 400, ERR.INVALID_INPUT, "text must be a non-empty string");
      }
      const cleanText = text.trim().slice(0, 500);
      const cleanScope = ((scope || "global") + "").trim().toLowerCase();

      const user = await User.findById(req.params.userId);
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      const current = getUserMeta(user, "instructions") || {};
      if (!Array.isArray(current.global)) current.global = [];
      if (!current.byExtension || typeof current.byExtension !== "object") current.byExtension = {};

      const entry = { id: uuidv4(), text: cleanText, addedAt: new Date().toISOString() };
      if (cleanScope === "global" || cleanScope === "*") {
        current.global.push(entry);
      } else {
        if (!Array.isArray(current.byExtension[cleanScope])) current.byExtension[cleanScope] = [];
        current.byExtension[cleanScope].push(entry);
      }

      setUserMeta(user, "instructions", current);
      await user.save();

      sendOk(res, { added: entry, scope: cleanScope });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.delete("/user/:userId/instructions/:id", authenticate, async (req, res) => {
    try {
      if (req.userId !== req.params.userId) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not your account");
      }
      const { id } = req.params;
      const user = await User.findById(req.params.userId);
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      const current = getUserMeta(user, "instructions") || {};
      let removed = null;
      const matches = (entryId) => entryId === id || entryId?.startsWith(id);

      if (Array.isArray(current.global)) {
        const idx = current.global.findIndex(i => matches(i.id));
        if (idx >= 0) {
          removed = current.global[idx];
          current.global.splice(idx, 1);
        }
      }
      if (!removed && current.byExtension) {
        for (const [ext, items] of Object.entries(current.byExtension)) {
          if (!Array.isArray(items)) continue;
          const idx = items.findIndex(i => matches(i.id));
          if (idx >= 0) {
            removed = items[idx];
            items.splice(idx, 1);
            if (items.length === 0) delete current.byExtension[ext];
            break;
          }
        }
      }

      if (!removed) {
        return sendError(res, 404, ERR.INVALID_INPUT, `No instruction found matching "${id}"`);
      }

      setUserMeta(user, "instructions", current);
      await user.save();

      sendOk(res, { removed });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Quick-link slot on profile page (optional, depends on treeos-base)
  // ─────────────────────────────────────────────────────────────────────
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("user-quick-links", "instructions", ({ userId, queryString }) =>
      `<li><a href="/api/v1/user/${userId}/instructions${queryString}">Instructions</a></li>`,
      { priority: 55 }
    );
  } catch {}

  log.info("Instructions", "Loaded. Two layers: per-node and per-user.");

  return { router, tools, modeTools };
}
