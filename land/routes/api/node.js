import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR, NODE_STATUS } from "../../seed/protocol.js";

import { createNode, editNodeName } from "../../seed/tree/treeManagement.js";
import { editNodeType } from "../../seed/tree/treeManagement.js";
import {
  updateParentRelationship,
  deleteNodeBranch,
} from "../../seed/tree/treeManagement.js";

import { editStatus } from "../../seed/tree/statuses.js";

import Node from "../../seed/models/node.js";
import { getNodeChats } from "../../seed/ws/chatHistory.js";
import { getExtension } from "../../extensions/loader.js";

const router = express.Router();

// Resolve version via prestige extension. Without prestige, version is always 0.
async function resolveVersion(nodeId, version) {
  const resolve = getExtension("prestige")?.exports?.resolveVersion;
  if (resolve) return resolve(nodeId, version);
  return version === "latest" ? 0 : Number(version);
}

router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
});

async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET /node/:nodeId/chats
// AI chat history for a specific node (or its entire subtree)
// ─────────────────────────────────────────────────────────────────────────
router.get("/node/:nodeId/chats", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;

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

    const node = await Node.findById(nodeId).select("name rootOwner").lean();
    if (!node) {
      return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    }

    const { sessions } = await getNodeChats({
      nodeId,
      sessionLimit: limit || 10,
      sessionId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const allChats = sessions.flatMap((s) => s.chats);

    return sendOk(res, {
      nodeId,
      nodeName: node.name,
      count: allChats.length,
      sessions,
    });
  } catch (err) {
    log.error("API", "Node chats error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});
const editStatusHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const status = req.body?.status || req.query?.status;
    const ALLOWED_STATUSES = ["active", "completed", "trimmed"];

    if (!ALLOWED_STATUSES.includes(status)) {
      return sendError(res, 400, ERR.INVALID_STATUS, "Invalid status. Must be active, completed, or trimmed.");
    }
    const isInherited =
      req.body?.isInherited === "true" ||
      req.body?.isInherited === true ||
      req.query?.isInherited === "true";

    if (!status) {
      return sendError(res, 400, ERR.INVALID_INPUT, "status is required");
    }

    const result = await editStatus({
      nodeId,
      status,
      isInherited,
      userId,
    });

    sendOk(res, result);
  } catch (err) {
    log.error("API", "editStatus error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
};
router.post("/node/:nodeId/editStatus", authenticate, useLatest, editStatusHandler);
router.post("/node/:nodeId/:version/editStatus", authenticate, editStatusHandler);

// Prestige routes moved to extensions/prestige

router.post("/node/:nodeId/updateParent", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params; // child
    const userId = req.userId;

    // new parent can come from body OR query
    const newParentId =
      req.body?.newParentId ||
      req.query?.newParentId ||
      req.body?.parentId ||
      req.query?.parentId;

    if (!newParentId) {
      return sendError(res, 400, ERR.INVALID_INPUT, "newParentId is required");
    }

    const result = await updateParentRelationship(nodeId, newParentId, userId);

    sendOk(res, {
      nodeChild: result.nodeChild,
      nodeNewParent: result.nodeNewParent,
    });
  } catch (err) {
    log.error("API", "updateParent error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});
// ── Per-node mode overrides ──
// Must be before /node/:nodeId/:version to avoid :version capturing "modes"
router.get("/node/:nodeId/modes", async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).select("name metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const modes = meta.modes || {};

    // List available modes from registry
    let availableModes = [];
    try {
      const { getSubModes } = await import("../../seed/ws/modes/registry.js");
      availableModes = getSubModes("tree").map(m => m.key);
    } catch {}

    sendOk(res, { nodeId, name: node.name, modes, availableModes });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/node/:nodeId/modes", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { intent, modeKey, clear } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    if (node.systemRole) return sendError(res, 400, ERR.INVALID_INPUT, "Cannot modify system nodes");

    const { getExtMeta, setExtMeta } = await import("../../seed/tree/extensionMetadata.js");

    if (clear) {
      // Clear all mode overrides or a specific one
      const modes = getExtMeta(node, "modes") || {};
      if (intent) {
        delete modes[intent];
      }
      await setExtMeta(node, "modes", Object.keys(modes).length > 0 ? modes : null);
    } else {
      if (!intent || !modeKey) return sendError(res, 400, ERR.INVALID_INPUT, "intent and modeKey required");

      // Validate mode exists
      try {
        const { getMode } = await import("../../seed/ws/modes/registry.js");
        if (!getMode(modeKey)) return sendError(res, 400, ERR.INVALID_INPUT, `Mode "${modeKey}" not registered`);
      } catch {}

      const modes = getExtMeta(node, "modes") || {};
      modes[intent] = modeKey;
      await setExtMeta(node, "modes", modes);
    }

    await node.save();
    sendOk(res, { modes: getExtMeta(node, "modes") || {} });
  } catch (err) {
    log.error("API", "editModes error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// ── Per-node tool configuration ──
// Must be before /node/:nodeId/:version to avoid :version capturing "tools"
router.get("/node/:nodeId/tools", async (req, res) => {
  try {
    const { nodeId } = req.params;
    const chain = [];
    const allAllowed = new Set();
    const allBlocked = new Set();
    let cursor = nodeId;
    const visited = new Set();

    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const n = await Node.findById(cursor).select("name metadata parent systemRole").lean();
      if (!n || n.systemRole) break;
      const meta = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
      const nodeTools = meta.tools || null;
      if (nodeTools) {
        chain.push({ nodeId: n._id, name: n.name, allowed: nodeTools.allowed || [], blocked: nodeTools.blocked || [] });
        if (nodeTools.allowed) for (const t of nodeTools.allowed) allAllowed.add(t);
        if (nodeTools.blocked) for (const t of nodeTools.blocked) allBlocked.add(t);
      }
      cursor = n.parent;
    }

    let baseTools = [];
    try {
      const { getAllToolNamesForBigMode } = await import("../../seed/ws/modes/registry.js");
      baseTools = getAllToolNamesForBigMode("tree");
    } catch {}

    const effective = [...new Set([...baseTools, ...allAllowed])].filter(t => !allBlocked.has(t)).sort();

    sendOk(res, { nodeId, baseTools, hasConfig: allAllowed.size > 0 || allBlocked.size > 0, added: [...allAllowed], blocked: [...allBlocked], effective, chain: chain.reverse() });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/node/:nodeId/tools", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    let { allowed, blocked } = req.body;
    if (req.body.allowedRaw) allowed = req.body.allowedRaw.split(",").map(s => s.trim()).filter(Boolean);
    if (req.body.blockedRaw) blocked = req.body.blockedRaw.split(",").map(s => s.trim()).filter(Boolean);

    const node = await Node.findById(nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    if (node.systemRole) return sendError(res, 400, ERR.INVALID_INPUT, "Cannot modify system nodes");

    const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
    const toolConfig = {};
    if (Array.isArray(allowed)) toolConfig.allowed = allowed.filter(t => typeof t === "string");
    if (Array.isArray(blocked)) toolConfig.blocked = blocked.filter(t => typeof t === "string");

    if (!toolConfig.allowed?.length && !toolConfig.blocked?.length) {
      await setExtMeta(node, "tools", null);
    } else {
      await setExtMeta(node, "tools", toolConfig);
    }
    await node.save();

    sendOk(res, { tools: toolConfig });
  } catch (err) {
    log.error("API", "editTools error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// -----------------------------------------------------------------------------
// GET /api/v1/node/:nodeId/extensions
// Shows blocked extensions at this position (with inheritance chain)
// Shows which extensions are active vs blocked from the land's installed set
// -----------------------------------------------------------------------------
router.get("/node/:nodeId/extensions", async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { getBlockedExtensionsAtNode, getConfinedExtensions } = await import("../../seed/tree/extensionScope.js");
    const scope = await getBlockedExtensionsAtNode(nodeId);

    const node = await Node.findById(nodeId).select("name metadata").lean();
    const meta = node?.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node?.metadata || {});
    const localBlocked = meta.extensions?.blocked || [];
    const localAllowed = meta.extensions?.allowed || [];

    const { getLoadedExtensionNames } = await import("../../extensions/loader.js");
    const installed = getLoadedExtensionNames();
    const confined = getConfinedExtensions();

    // Walk chain for inheritance detail
    const chain = [];
    let cursor = nodeId;
    const visited = new Set();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const n = await Node.findById(cursor).select("name metadata parent systemRole").lean();
      if (!n || n.systemRole) break;
      const m = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
      const entry = { nodeId: n._id, name: n.name };
      if (m.extensions?.blocked?.length) entry.blocked = m.extensions.blocked;
      if (m.extensions?.allowed?.length) entry.allowed = m.extensions.allowed;
      if (entry.blocked || entry.allowed) chain.push(entry);
      cursor = n.parent;
    }

    // Separate global from confined in the response
    const globalExts = installed.filter(e => !confined.has(e));
    const confinedExts = installed.filter(e => confined.has(e));

    sendOk(res, {
      nodeId,
      nodeName: node?.name || "",
      global: globalExts.map(e => ({
        name: e,
        status: scope.blocked.has(e) ? "blocked" : scope.restricted.has(e) ? `restricted (${scope.restricted.get(e)})` : "active",
      })),
      confined: confinedExts.map(e => ({
        name: e,
        status: scope.allowed.has(e) ? (scope.blocked.has(e) ? "blocked" : "allowed") : "not allowed",
      })),
      localBlocked,
      localAllowed,
      chain: chain.reverse(),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// -----------------------------------------------------------------------------
// POST /api/v1/node/:nodeId/extensions
// Block or restrict extensions at a node. Inherits to children.
// Body: { blocked: ["solana"], restricted: { "food": "read" } }
// Pass empty to clear.
// -----------------------------------------------------------------------------
router.post("/node/:nodeId/extensions", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    let { blocked, restricted, allowed } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    if (node.systemRole) return sendError(res, 400, ERR.INVALID_INPUT, "Cannot modify system nodes");

    const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
    const { clearScopeCache, notifyScopeChange } = await import("../../seed/tree/extensionScope.js");

    const config = {};
    if (Array.isArray(blocked) && blocked.length > 0) {
      config.blocked = blocked.filter(b => typeof b === "string");
    }
    if (restricted && typeof restricted === "object" && Object.keys(restricted).length > 0) {
      config.restricted = restricted;
    }
    if (Array.isArray(allowed) && allowed.length > 0) {
      config.allowed = allowed.filter(a => typeof a === "string");
    }

    if (Object.keys(config).length === 0) {
      await setExtMeta(node, "extensions", null);
    } else {
      await setExtMeta(node, "extensions", config);
    }
    await node.save();
    notifyScopeChange({ nodeId, blocked: config.blocked, restricted: config.restricted, allowed: config.allowed, userId: req.userId });

    sendOk(res, { blocked: config.blocked || [], allowed: config.allowed || [] });
  } catch (err) {
    log.error("API", "editExtensions error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// -----------------------------------------------------------------------------
// GET /api/v1/node/:nodeId
// Returns the node (flat schema, no versions)
// -----------------------------------------------------------------------------
router.get("/node/:nodeId", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).lean();

    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const children = await Node.find({ _id: { $in: node.children } })
      .select("name _id status")
      .lean();
    node.children = children;

    return sendOk(res, { node });
  } catch (err) {
    log.error("API", "Error fetching node:", err);
    sendError(res, 500, ERR.INTERNAL, "Internal server error");
  }
});

// -----------------------------------------------------------------------------
// GET /api/v1/node/:nodeId/:version
// Returns a single version (includes Notes link)
// -----------------------------------------------------------------------------
router.get("/node/:nodeId/:version", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const v = Number(version);

    const node = await Node.findById(nodeId).lean();

    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    // Flat schema: version 0 = current state
    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const prestigeData = meta.prestige || { current: 0, history: [] };

    const data = (v === (prestigeData.current || 0))
      ? {
          status: node.status || NODE_STATUS.ACTIVE,
          values: meta.values || {},
          goals: meta.goals || {},
          schedule: meta.schedule || null,
          reeffectTime: meta.reeffectTime || 0,
          dateCreated: node.dateCreated,
        }
      : (prestigeData.history?.find(h => h.version === v) || { status: NODE_STATUS.COMPLETED });

    return sendOk(res, {
      id: node._id,
      name: node.name,
      version: v,
      data,
    });
  } catch (err) {
    log.error("API", "Error fetching version:", err);
    sendError(res, 500, ERR.INTERNAL, "Internal server error");
  }
});
router.post("/node/:nodeId/createChild", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params; // parent id
    const { name, type, schedule, reeffectTime, values, goals, note } = req.body;
    const userId = req.userId;

    if (!name || typeof name !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "Name is required");
    }

    // Load parent
    const parentNode = await Node.findById(nodeId);
    if (!parentNode) {
      return sendError(res, 404, ERR.NODE_NOT_FOUND, "Parent node not found");
    }

    // Create child
    const childNode = await createNode(
      name,
      schedule || null,
      reeffectTime || null,
      parentNode._id, // parentNodeID
      false, // isRoot
      userId,
      values || {},
      goals || {},
      note || null,
      null, // validatedUser
      false, // wasAi
      null, // chatId
      null, // sessionId
      type || null,
    );

    sendOk(res, {
      childId: childNode._id,
      child: childNode,
    }, 201);
  } catch (err) {
    log.error("API", "createChild error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

router.post("/node/:nodeId/delete", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.userId;

    const deletedNode = await deleteNodeBranch(nodeId, userId);

    return sendOk(res, {
      deletedNode: deletedNode._id,
    });
  } catch (err) {
    log.error("API", "delete node error:", err);
    return sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

const editNameHandler = async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.userId;

    const newName = req.body?.name || req.query?.name;

    if (!newName) {
      return sendError(res, 400, ERR.INVALID_INPUT, "newName is required");
    }

    const result = await editNodeName({
      nodeId,
      newName,
      userId,
    });

    sendOk(res, result);
  } catch (err) {
    log.error("API", "editName error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
};
router.post("/node/:nodeId/editName", authenticate, editNameHandler);
router.post("/node/:nodeId/:version/editName", authenticate, editNameHandler);

router.post(
  "/node/:nodeId/editType",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId } = req.params;
      const userId = req.userId;

      // customType (free text) takes priority over select dropdown
      const customType = req.body?.customType?.trim();
      let newType = customType || req.body?.type || req.query?.type || null;
      if (newType === "") newType = null;

      const result = await editNodeType({
        nodeId,
        newType,
        userId,
      });

      sendOk(res, result);
    } catch (err) {
      log.error("API", "editType error:", err);
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

export default router;
