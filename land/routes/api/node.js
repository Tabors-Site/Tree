import log from "../../core/log.js";
import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";
import { createNewNode, editNodeName } from "../../core/tree/treeManagement.js";
import { editNodeType } from "../../core/tree/nodeTypes.js";
import {
  updateParentRelationship,
  deleteNodeBranch,
} from "../../core/tree/treeManagement.js";

import { editStatus } from "../../core/tree/statuses.js";

import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import { resolveVersion, buildPathString } from "../../core/tree/treeFetch.js";
import { getNodeAIChats } from "../../core/llms/aichat.js";

import { getExtension } from "../../extensions/loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }

const router = express.Router();

// Resolve "latest" to actual prestige number for any route with :version
router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

// Middleware for versionless routes: auto-resolve to latest prestige
async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
}

import getNodeName from "./helpers/getNameById.js";

// Allowed query params for HTML mode
const allowedParams = ["token", "html", "error"];

// Utility: keep only allowed query params
function filterQuery(req) {
  return Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
    .join("&");
}

// ─────────────────────────────────────────────────────────────────────────
// GET /node/:nodeId/chats
// AI chat history for a specific node (or its entire subtree)
// ─────────────────────────────────────────────────────────────────────────
router.get("/node/:nodeId/chats", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({ error: "Invalid limit" });
    }
    if (limit > 10) {
      limit = 10;
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    let sessionId = req.query.sessionId;

    if (typeof sessionId === "string") {
      sessionId = sessionId.replace(/^"+|"+$/g, "");
    }

    const node = await Node.findById(nodeId).select("name rootOwner").lean();
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    const { sessions } = await getNodeAIChats({
      nodeId,
      sessionLimit: limit || 10,
      sessionId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const allChats = sessions.flatMap((s) => s.chats);

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        nodeId,
        nodeName: node.name,
        count: allChats.length,
        sessions,
      });
    }

    const nodeName = node.name || "Unknown node";
    const nodePath = await buildPathString(nodeId);

    return res.send(
      html().renderNodeChats({
        nodeId,
        nodeName,
        nodePath,
        sessions,
        allChats,
        token,
        tokenQS,
      }),
    );
  } catch (err) {
    log.error("API", "Node chats error:", err);
    res.status(500).json({ error: err.message });
  }
});
const editStatusHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const status = req.body?.status || req.query?.status;
    const ALLOWED_STATUSES = ["active", "completed", "trimmed"];

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be active, completed, or trimmed.",
      });
    }
    const isInherited =
      req.body?.isInherited === "true" ||
      req.body?.isInherited === true ||
      req.query?.isInherited === "true";

    if (!status) {
      return res.status(400).json({ error: "status is required" });
    }

    const result = await editStatus({
      nodeId,
      status,
      isInherited,
      userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${version}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    log.error("API", "editStatus error:", err);
    res.status(400).json({ error: err.message });
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
      return res.status(400).json({
        error: "newParentId is required",
      });
    }

    const result = await updateParentRelationship(nodeId, newParentId, userId);

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({
      success: true,
      nodeChild: result.nodeChild,
      nodeNewParent: result.nodeNewParent,
    });
  } catch (err) {
    log.error("API", "updateParent error:", err);
    res.status(400).json({ error: err.message });
  }
});
// ── Per-node mode overrides ──
// Must be before /node/:nodeId/:version to avoid :version capturing "modes"
router.get("/node/:nodeId/modes", async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).select("name metadata").lean();
    if (!node) return res.status(404).json({ error: "Node not found" });
    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const modes = meta.modes || {};

    // List available modes from registry
    let availableModes = [];
    try {
      const { getSubModes } = await import("../../ws/modes/registry.js");
      availableModes = getSubModes("tree").map(m => m.key);
    } catch {}

    res.json({ nodeId, name: node.name, modes, availableModes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/node/:nodeId/modes", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { intent, modeKey, clear } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });
    if (node.systemRole) return res.status(400).json({ error: "Cannot modify system nodes" });

    const { getExtMeta, setExtMeta } = await import("../../core/tree/extensionMetadata.js");

    if (clear) {
      // Clear all mode overrides or a specific one
      const modes = getExtMeta(node, "modes") || {};
      if (intent) {
        delete modes[intent];
      }
      setExtMeta(node, "modes", Object.keys(modes).length > 0 ? modes : null);
    } else {
      if (!intent || !modeKey) return res.status(400).json({ error: "intent and modeKey required" });

      // Validate mode exists
      try {
        const { getMode } = await import("../../ws/modes/registry.js");
        if (!getMode(modeKey)) return res.status(400).json({ error: `Mode "${modeKey}" not registered` });
      } catch {}

      const modes = getExtMeta(node, "modes") || {};
      modes[intent] = modeKey;
      setExtMeta(node, "modes", modes);
    }

    await node.save();
    if ("html" in req.query) return res.redirect(`/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`);
    res.json({ success: true, modes: getExtMeta(node, "modes") || {} });
  } catch (err) {
    log.error("API", "editModes error:", err.message);
    res.status(400).json({ error: err.message });
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
      const { getAllToolNamesForBigMode } = await import("../../ws/modes/registry.js");
      baseTools = getAllToolNamesForBigMode("tree");
    } catch {}

    const effective = [...new Set([...baseTools, ...allAllowed])].filter(t => !allBlocked.has(t)).sort();

    res.json({ nodeId, baseTools, hasConfig: allAllowed.size > 0 || allBlocked.size > 0, added: [...allAllowed], blocked: [...allBlocked], effective, chain: chain.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/node/:nodeId/tools", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    let { allowed, blocked } = req.body;
    if (req.body.allowedRaw) allowed = req.body.allowedRaw.split(",").map(s => s.trim()).filter(Boolean);
    if (req.body.blockedRaw) blocked = req.body.blockedRaw.split(",").map(s => s.trim()).filter(Boolean);

    const node = await Node.findById(nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });
    if (node.systemRole) return res.status(400).json({ error: "Cannot modify system nodes" });

    const { setExtMeta } = await import("../../core/tree/extensionMetadata.js");
    const toolConfig = {};
    if (Array.isArray(allowed)) toolConfig.allowed = allowed.filter(t => typeof t === "string");
    if (Array.isArray(blocked)) toolConfig.blocked = blocked.filter(t => typeof t === "string");

    if (!toolConfig.allowed?.length && !toolConfig.blocked?.length) {
      setExtMeta(node, "tools", null);
    } else {
      setExtMeta(node, "tools", toolConfig);
    }
    await node.save();

    if ("html" in req.query) return res.redirect(`/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`);
    res.json({ success: true, tools: toolConfig });
  } catch (err) {
    log.error("API", "editTools error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /api/v1/node/:nodeId
// Returns the node (flat schema, no versions)
// Supports JSON or ?html mode
// -----------------------------------------------------------------------------
router.get("/node/:nodeId", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).lean();

    if (!node) return res.status(404).json({ error: "Node not found" });

    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";

    const children = await Node.find({ _id: { $in: node.children } })
      .select("name _id status")
      .lean();
    node.children = children;

    const wantHtml = req.query.html !== undefined;

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ node });
    }

    const parentName = node.parent
      ? (await Node.findById(node.parent, "name").lean())?.name
      : null;

    const rootUrl = `/api/v1/root/${nodeId}${qs}`;

    return res.send(
      html().renderNodeDetail({ node, nodeId, qs, parentName, rootUrl, isPublicAccess: !!req.isPublicAccess }),
    );
  } catch (err) {
    log.error("API", "Error fetching node:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// GET /api/v1/node/:nodeId/:version
// Returns a single version (includes Notes link)
// Supports JSON or ?html mode
// -----------------------------------------------------------------------------
router.get("/node/:nodeId/:version", urlAuth, async (req, res) => {
  try {
    const { nodeId, version, parent } = req.params;
    const v = Number(version);

    const node = await Node.findById(nodeId).lean();

    if (!node) return res.status(404).json({ error: "Node not found" });

    // Flat schema: version 0 = current state
    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const prestigeData = meta.prestige || { current: 0, history: [] };

    const data = (v === (prestigeData.current || 0))
      ? {
          status: node.status || "active",
          values: meta.values || {},
          goals: meta.goals || {},
          schedule: meta.schedule || null,
          reeffectTime: meta.reeffectTime || 0,
          dateCreated: node.dateCreated,
        }
      : (prestigeData.history?.find(h => h.version === v) || { status: "completed" });

    const ALL_STATUSES = ["active", "completed", "trimmed"];
    const STATUS_LABELS = {
      active: "Activate",
      completed: "Complete",
      trimmed: "Trim",
    };

    const showPrestige = v === (prestigeData.current || 0);

    const wantHtml = req.query.html !== undefined;

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        id: node._id,
        name: node.name,
        version: v,
        data,
      });
    }

    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";

    const backUrl = `/api/v1/node/${nodeId}${qs}`;
    const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;

    const createdDate = data.dateCreated
      ? new Date(data.dateCreated).toLocaleString()
      : "Unknown";

    const scheduleHtml = data.schedule
      ? new Date(data.schedule).toLocaleString()
      : "None";

    const reeffectTime =
      data.reeffectTime !== undefined ? data.reeffectTime : "<em>None</em>";

    return res.send(
      html().renderVersionDetail({
        node,
        nodeId,
        version: v,
        data,
        qs,
        backUrl,
        backTreeUrl,
        createdDate,
        scheduleHtml,
        reeffectTime,
        showPrestige,
        ALL_STATUSES,
        STATUS_LABELS,
      }),
    );
  } catch (err) {
    log.error("API", "Error fetching version:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.post("/node/:nodeId/createChild", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params; // parent id
    const { name, type, schedule, reeffectTime, values, goals, note } = req.body;
    const userId = req.userId;

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Load parent
    const parentNode = await Node.findById(nodeId);
    if (!parentNode) {
      return res.status(404).json({
        success: false,
        error: "Parent node not found",
      });
    }

    // Create child
    const childNode = await createNewNode(
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
      null, // aiChatId
      null, // sessionId
      type || null,
    );

    // HTML redirect support (same pattern)
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.status(201).json({
      success: true,
      childId: childNode._id,
      child: childNode,
    });
  } catch (err) {
    log.error("API", "createChild error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/node/:nodeId/delete", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.userId;

    const deletedNode = await deleteNodeBranch(nodeId, userId);

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/user/${userId}/deleted?token=${req.query.token ?? ""}&html`,
      );
    }

    return res.json({
      success: true,
      deletedNode: deletedNode._id,
    });
  } catch (err) {
    log.error("API", "delete node error:", err);
    return res.status(400).json({ error: err.message });
  }
});

const editNameHandler = async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.userId;

    const newName = req.body?.name || req.query?.name;

    if (!newName) {
      return res.status(400).json({ error: "newName is required" });
    }

    const result = await editNodeName({
      nodeId,
      newName,
      userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    log.error("API", "editName error:", err);
    res.status(400).json({ error: err.message });
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

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`,
        );
      }

      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      log.error("API", "editType error:", err);
      res.status(400).json({ error: err.message });
    }
  },
);

// Schedule routes moved to extensions/schedules
// Script routes moved to extensions/scripts
// Tool config routes moved above /node/:nodeId to avoid :version capture

// Schedule routes moved to extensions/schedules
// Script routes moved to extensions/scripts

export default router;
