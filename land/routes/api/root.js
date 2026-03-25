import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";

import { getAllNodeData, getTreeStructure } from "../../seed/tree/treeData.js";
import { getExtension } from "../../extensions/loader.js";

import Node from "../../seed/models/node.js";
import mongoose from "mongoose";
import { isValidRootLlmSlot, getAllRootLlmSlots } from "../../seed/llm/connections.js";
import { getNodeChats } from "../../seed/ws/chatHistory.js";

import { registerWithDirectory } from "../../canopy/directory.js";

const router = express.Router();

router.get("/root/:nodeId", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const allData = await getTreeStructure(nodeId, {
      active: req.query.active !== "false",
      trimmed: req.query.trimmed === "true",
      completed: req.query.completed !== "false",
    });

    const rootMeta = await Node.findById(nodeId)
      .populate("rootOwner", "username _id isAdmin metadata")
      .populate("contributors", "username _id isRemote homeLand")
      .select(
        "rootOwner contributors metadata llmDefault visibility",
      )
      .lean()
      .exec();
    const rootNode = await Node.findById(nodeId).select("parent rootOwner").lean();
    const isDeleted = rootNode.parent === "deleted";

    const isPublicAccess = !!req.isPublicAccess;
    const isOwner =
      rootMeta?.rootOwner?._id?.toString() === req.userId?.toString();
    const queryAvailable = isPublicAccess
      ? !!((rootMeta?.llmDefault && rootMeta.llmDefault !== "none") || req.canopyVisitor)
      : false;

    const json = {
      ...allData,
      rootOwner: rootMeta?.rootOwner || null,
      contributors: rootMeta?.contributors || [],
      dreamsEnabled: !!mongoose.models.ShortMemory,
    };

    if (isPublicAccess) {
      delete json.contributors;
      json.rootOwner = rootMeta?.rootOwner?.username
        ? { username: rootMeta.rootOwner.username }
        : null;
      json.isPublicAccess = true;
      json.queryAvailable = queryAvailable;
    }

    return sendOk(res, json);
  } catch (err) {
    log.error("API", "Error in /root/:nodeId:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get("/root/:rootId/all", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    const filters = {
      active: req.query.active === undefined ? true : req.query.active === "true",
      trimmed: req.query.trimmed === undefined ? false : req.query.trimmed === "true",
      completed: req.query.completed === undefined ? true : req.query.completed === "true",
    };

    const allData = await getAllNodeData(rootId, filters);
    if (!allData) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const stripContributions = (node) => {
      if (node.contributions) {
        node.contributions = node.contributions.map((c) => {
          const clean = { ...c._doc || c };
          delete clean.purchaseMeta;
          delete clean.transactionMeta;
          return clean;
        });
      }
      if (node.children) {
        node.children.forEach(stripContributions);
      }
    };
    stripContributions(allData);

    return sendOk(res, allData);
  } catch (err) {
    log.error("API", "Error in /root/:rootId/all:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/root/:rootId/visibility", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { visibility } = req.body;

    const validValues = ["private", "public"];
    if (!validValues.includes(visibility)) {
      return sendError(res, 400, ERR.INVALID_INPUT,
        `visibility must be one of: ${validValues.join(", ")}`);
    }

    const root = await Node.findById(rootId).select("rootOwner").lean();
    if (!root) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");
    }
    if (String(root.rootOwner) !== String(req.userId)) {
      return sendError(res, 403, ERR.FORBIDDEN, "Only the tree owner can change visibility");
    }

    await Node.findByIdAndUpdate(rootId, {
      $set: { visibility },
    });

    registerWithDirectory().catch((err) =>
      log.error("API", "[Land] Directory re-sync after visibility change failed:", err)
    );

    return sendOk(res, { visibility });
  } catch (err) {
    log.error("API", "Error in /root/:rootId/visibility:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/root/:rootId/llm-assign", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { slot, connectionId } = req.body;

    if (!isValidRootLlmSlot(slot)) {
      return sendError(res, 400, ERR.INVALID_INPUT,
        `Invalid slot. Must be one of: ${getAllRootLlmSlots().join(", ")}`);
    }

    const root = await Node.findById(rootId).select("rootOwner").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner)
      return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");
    if (root.rootOwner.toString() !== req.userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Only the root owner can assign LLM connections");
    }

    if (connectionId === "none" && slot === "default") {
    } else if (connectionId) {
      const { default: LlmConnection } =
        await import("../../seed/models/llmConnection.js");
      const conn = await LlmConnection.findOne({
        _id: connectionId,
        userId: req.userId,
      }).lean();
      if (!conn) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Connection not found");
    }

    if (slot === "default") {
      await Node.findByIdAndUpdate(rootId, {
        $set: { llmDefault: connectionId || null },
      });
    } else {
      await Node.findByIdAndUpdate(rootId, {
        $set: { [`metadata.llm.slots.${slot}`]: connectionId || null },
      });
    }

    const { clearUserClientCache } = await import("../../seed/ws/conversation.js");
    clearUserClientCache(req.userId);

    return sendOk(res, {
      slot,
      connectionId: connectionId || null,
    });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get("/root/:rootId/gateway", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    const root = await Node.findById(rootId)
      .select("name rootOwner contributors")
      .lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner)
      return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");

    const isOwner = root.rootOwner.toString() === req.userId.toString();
    if (!isOwner)
      return sendError(res, 403, ERR.FORBIDDEN, "Only the root owner can manage the gateway");

    const { getChannelsForRoot } =
      await import("../../extensions/gateway/core.js");
    const channels = await getChannelsForRoot(rootId);

    return sendOk(res, { rootId, channels });
  } catch (err) {
    log.error("API", "Error in /root/:rootId/gateway:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get(
  "/root/:rootId/gateway/vapid-key",
  authenticate,
  async (req, res) => {
    return sendOk(res, { key: process.env.VAPID_PUBLIC_KEY || null });
  },
);

router.get("/root/:rootId/gateway/channels", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    const root = await Node.findById(rootId)
      .select("rootOwner contributors")
      .lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner)
      return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");

    const isOwner = root.rootOwner.toString() === req.userId.toString();
    const isContributor = (root.contributors || []).some(
      (c) => c.toString() === req.userId.toString(),
    );
    if (!isOwner && !isContributor) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }

    const { getChannelsForRoot } =
      await import("../../extensions/gateway/core.js");
    const channels = await getChannelsForRoot(rootId);
    return sendOk(res, { channels });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post(
  "/root/:rootId/gateway/channels",
  authenticate,
  async (req, res) => {
    try {
      const { rootId } = req.params;
      const {
        name,
        type,
        direction,
        mode,
        config,
        notificationTypes,
        queueBehavior,
      } = req.body;

      const { addGatewayChannel } =
        await import("../../extensions/gateway/core.js");
      const channel = await addGatewayChannel(req.userId, rootId, {
        name,
        type,
        direction,
        mode,
        config,
        notificationTypes,
        queueBehavior,
      });

      return sendOk(res, { channel }, 201);
    } catch (err) {
      var status = err.message.includes("not found")
        ? 404
        : err.message.includes("Not authorized") ||
            err.message.includes("Only the root")
          ? 403
          : 400;
      var code = status === 404 ? ERR.NODE_NOT_FOUND : status === 403 ? ERR.FORBIDDEN : ERR.INVALID_INPUT;
      return sendError(res, status, code, err.message);
    }
  },
);

router.put(
  "/root/:rootId/gateway/channels/:channelId",
  authenticate,
  async (req, res) => {
    try {
      const { channelId } = req.params;
      const { name, enabled, config, notificationTypes } = req.body;

      const { updateGatewayChannel } =
        await import("../../extensions/gateway/core.js");
      const channel = await updateGatewayChannel(req.userId, channelId, {
        name,
        enabled,
        config,
        notificationTypes,
      });

      return sendOk(res, { channel });
    } catch (err) {
      var status = err.message.includes("not found") ? 404 : 400;
      var code = status === 404 ? ERR.NODE_NOT_FOUND : ERR.INVALID_INPUT;
      return sendError(res, status, code, err.message);
    }
  },
);

router.delete(
  "/root/:rootId/gateway/channels/:channelId",
  authenticate,
  async (req, res) => {
    try {
      const { channelId } = req.params;

      const { deleteGatewayChannel } =
        await import("../../extensions/gateway/core.js");
      await deleteGatewayChannel(req.userId, channelId);

      return sendOk(res, { removed: true });
    } catch (err) {
      var status = err.message.includes("not found") ? 404 : 400;
      var code = status === 404 ? ERR.NODE_NOT_FOUND : ERR.INVALID_INPUT;
      return sendError(res, status, code, err.message);
    }
  },
);

router.post(
  "/root/:rootId/gateway/channels/:channelId/test",
  authenticate,
  async (req, res) => {
    try {
      const { rootId, channelId } = req.params;

      const root = await Node.findById(rootId)
        .select("rootOwner contributors")
        .lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
      if (!root.rootOwner)
        return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");

      const isOwner = root.rootOwner.toString() === req.userId.toString();
      const isContributor = (root.contributors || []).some(
        (c) => c.toString() === req.userId.toString(),
      );
      if (!isOwner && !isContributor) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      const { dispatchTestNotification } =
        await import("../../extensions/gateway/dispatch.js");
      var result = await dispatchTestNotification(channelId);

      return sendOk(res, result);
    } catch (err) {
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

router.get("/root/:rootId/extensions", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { getBlockedExtensionsAtNode } = await import("../../seed/tree/extensionScope.js");
    const blocked = await getBlockedExtensionsAtNode(rootId);

    const root = await Node.findById(rootId).select("name metadata children").lean();
    const meta = root?.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root?.metadata || {});
    const local = meta.extensions?.blocked || [];

    const { getLoadedExtensionNames } = await import("../../extensions/loader.js");
    const installed = getLoadedExtensionNames();

    const tree = [];
    async function walkTree(nodeId, depth) {
      if (depth > 10) return;
      const n = await Node.findById(nodeId).select("name metadata children systemRole").lean();
      if (!n || n.systemRole) return;
      const m = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
      const nodeBlocked = m.extensions?.blocked || [];
      if (nodeBlocked.length > 0) {
        tree.push({ nodeId: n._id, name: n.name, depth, blocked: nodeBlocked });
      }
      if (n.children) {
        for (const childId of n.children) await walkTree(childId, depth + 1);
      }
    }
    if (req.query.tree === "true" || req.query.tree === "1") {
      await walkTree(rootId, 0);
    }

    sendOk(res, {
      rootId,
      rootName: root?.name || "",
      blocked: [...blocked],
      localBlocked: local,
      installed,
      active: installed.filter(e => !blocked.has(e)),
      ...(tree.length ? { tree } : {}),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/root/:rootId/extensions", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    let { blocked, restricted } = req.body;

    const node = await Node.findById(rootId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
    const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");

    const config = {};
    if (Array.isArray(blocked) && blocked.length > 0) {
      config.blocked = blocked.filter(b => typeof b === "string");
    }
    if (restricted && typeof restricted === "object" && Object.keys(restricted).length > 0) {
      config.restricted = restricted;
    }

    if (Object.keys(config).length === 0) {
      await setExtMeta(node, "extensions", null);
    } else {
      await setExtMeta(node, "extensions", config);
    }
    await node.save();
    clearScopeCache();

    sendOk(res, config);
  } catch (err) {
    log.error("API", "Extension scoping error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

router.post("/root/:rootId/dream-time", authenticate, async (req, res) => {
  try {
    if (!!!mongoose.models.ShortMemory) {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Dreams extension is not enabled on this land");
    }

    const { rootId } = req.params;
    const { dreamTime } = req.body;

    const root = await Node.findById(rootId).select("rootOwner").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    if (!root.rootOwner)
      return sendError(res, 400, ERR.INVALID_INPUT, "Node is not a root");
    if (root.rootOwner.toString() !== req.userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Only the root owner can set dream time");
    }

    if (dreamTime) {
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.test(dreamTime);
      if (!match) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid time format. Use HH:MM (24h)");
      }
    }

    await Node.findByIdAndUpdate(rootId, {
      $set: { "metadata.dreams.dreamTime": dreamTime || null },
    });

    return sendOk(res, { dreamTime: dreamTime || null });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get("/root/:rootId/calendar", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    const now = new Date();

    let month = Number(req.query.month);
    let year = Number(req.query.year);

    if (!Number.isInteger(month) || month < 0 || month > 11) {
      month = now.getMonth();
    }

    if (!Number.isInteger(year) || year < 1970 || year > 3000) {
      year = now.getFullYear();
    }

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const getCalendar = getExtension("schedules")?.exports?.getCalendar || (async () => ({ nodes: [] }));
    const calendar = await getCalendar({
      rootNodeId: rootId,
      startDate,
      endDate,
    });

    return sendOk(res, { calendar });
  } catch (err) {
    log.error("API", "Calendar error:", err);
    sendError(res, err.status || 500, ERR.INTERNAL, err.message);
  }
});

router.get("/root/:nodeId/values", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const getGlobalValuesTreeAndFlat = getExtension("values")?.exports?.getGlobalValuesTreeAndFlat || (async () => ({ flat: {}, tree: {} }));
    const result = await getGlobalValuesTreeAndFlat(nodeId);

    return sendOk(res, result);
  } catch (err) {
    log.error("API", "Error in /root/:nodeId/values:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get("/root/:rootId/chats", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit");
    }
    if (limit > 10) {
      limit = 10;
    }

    let sessionId = req.query.sessionId;

    if (typeof sessionId === "string") {
      sessionId = sessionId.replace(/^"+|"+$/g, "");
    }

    const node = await Node.findById(rootId).select("name rootOwner").lean();
    if (!node) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Root not found");
    }

    const { sessions } = await getNodeChats({
      nodeId: rootId,
      sessionLimit: limit || 10,
      sessionId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      includeChildren: true,
    });

    return sendOk(res, {
      rootId,
      rootName: node.name,
      count: sessions.flatMap((s) => s.chats).length,
      sessions,
    });
  } catch (err) {
    log.error("API", "Root chats error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
