import express from "express";
import Being from "../../seed/models/being.js";
import Node from "../../seed/models/node.js";
import LlmConnection from "../../seed/models/llmConnection.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getBeingMeta, setBeingMeta } from "../../seed/tree/beingMetadata.js";

const router = express.Router();
const MAX_STACK = 10;

// ── User-Level Failover ──────────────────────────────────────────────────

router.get("/user/:beingId/llm-failover", authenticate, async (req, res) => {
  try {
    const user = await Being.findById(req.beingId).select("metadata").lean();
    const meta = user?.metadata instanceof Map ? Object.fromEntries(user.metadata) : (user?.metadata || {});
    const stack = meta.llm?.failoverStack || [];
    sendOk(res, { stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:beingId/llm-failover", authenticate, async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) return sendError(res, 400, ERR.INVALID_INPUT, "connectionId required");

    const user = await Being.findById(req.beingId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    const conn = await LlmConnection.findOne({ _id: connectionId, beingId: req.beingId }).lean();
    if (!conn) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Connection not found or not yours");

    if (user.llmDefault === connectionId) {
      return sendError(res, 400, ERR.INVALID_INPUT, "That is already your default connection. Failover is for backups.");
    }

    const llmMeta = getBeingMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];

    if (stack.includes(connectionId)) return sendError(res, 400, ERR.INVALID_INPUT, "Already in failover stack");
    if (stack.length >= MAX_STACK) return sendError(res, 400, ERR.INVALID_INPUT, `Failover stack full (max ${MAX_STACK})`);
    stack.push(connectionId);

    llmMeta.failoverStack = stack;
    setBeingMeta(user, "llm", llmMeta);
    await user.save();

    sendOk(res, { stack, added: conn.name || connectionId });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete("/user/:beingId/llm-failover/:connectionId", authenticate, async (req, res) => {
  try {
    const user = await Being.findById(req.beingId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    const llmMeta = getBeingMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];
    const idx = stack.indexOf(req.params.connectionId);
    if (idx === -1) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Not in stack");
    stack.splice(idx, 1);

    llmMeta.failoverStack = stack;
    setBeingMeta(user, "llm", llmMeta);
    await user.save();

    sendOk(res, { removed: req.params.connectionId, stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete("/user/:beingId/llm-failover", authenticate, async (req, res) => {
  try {
    const user = await Being.findById(req.beingId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    const llmMeta = getBeingMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];
    const removed = stack.pop();

    llmMeta.failoverStack = stack;
    setBeingMeta(user, "llm", llmMeta);
    await user.save();

    sendOk(res, { removed, stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── Tree-Level Failover ──────────────────────────────────────────────────

router.get("/root/:rootId/llm-failover", authenticate, async (req, res) => {
  try {
    const root = await Node.findById(req.params.rootId).select("rootOwner metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner) return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");

    const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});
    const stack = meta.llm?.failoverStack || [];
    sendOk(res, { stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/root/:rootId/llm-failover", authenticate, async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) return sendError(res, 400, ERR.INVALID_INPUT, "connectionId required");

    const root = await Node.findById(req.params.rootId).select("rootOwner llmDefault metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner) return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");
    if (root.rootOwner.toString() !== req.beingId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Only the root owner can manage tree failover");
    }

    const conn = await LlmConnection.findOne({ _id: connectionId, beingId: req.beingId }).lean();
    if (!conn) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Connection not found or not yours");

    if (root.llmDefault === connectionId) {
      return sendError(res, 400, ERR.INVALID_INPUT, "That is already the tree default. Failover is for backups.");
    }

    const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});
    const llmMeta = meta.llm || {};
    const stack = llmMeta.failoverStack || [];

    if (stack.includes(connectionId)) return sendError(res, 400, ERR.INVALID_INPUT, "Already in tree failover stack");
    if (stack.length >= MAX_STACK) return sendError(res, 400, ERR.INVALID_INPUT, `Tree failover stack full (max ${MAX_STACK})`);
    stack.push(connectionId);

    await Node.findByIdAndUpdate(req.params.rootId, {
      $set: { "metadata.llm.failoverStack": stack },
    });

    const { clearUserClientCache } = await import("../../seed/llm/conversation.js");
    clearUserClientCache(req.beingId);

    sendOk(res, { stack, added: conn.name || connectionId });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete("/root/:rootId/llm-failover/:connectionId", authenticate, async (req, res) => {
  try {
    const root = await Node.findById(req.params.rootId).select("rootOwner metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner) return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");
    if (root.rootOwner.toString() !== req.beingId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Only the root owner can manage tree failover");
    }

    const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});
    const llmMeta = meta.llm || {};
    const stack = llmMeta.failoverStack || [];
    const idx = stack.indexOf(req.params.connectionId);
    if (idx === -1) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Not in tree failover stack");
    stack.splice(idx, 1);

    await Node.findByIdAndUpdate(req.params.rootId, {
      $set: { "metadata.llm.failoverStack": stack },
    });

    const { clearUserClientCache } = await import("../../seed/llm/conversation.js");
    clearUserClientCache(req.beingId);

    sendOk(res, { removed: req.params.connectionId, stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete("/root/:rootId/llm-failover", authenticate, async (req, res) => {
  try {
    const root = await Node.findById(req.params.rootId).select("rootOwner metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner) return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");
    if (root.rootOwner.toString() !== req.beingId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Only the root owner can manage tree failover");
    }

    const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});
    const llmMeta = meta.llm || {};
    const stack = llmMeta.failoverStack || [];
    const removed = stack.pop();

    await Node.findByIdAndUpdate(req.params.rootId, {
      $set: { "metadata.llm.failoverStack": stack },
    });

    const { clearUserClientCache } = await import("../../seed/llm/conversation.js");
    clearUserClientCache(req.beingId);

    sendOk(res, { removed, stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
