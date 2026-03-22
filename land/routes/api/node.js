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

import {
  renderNodeChats,
  renderNodeDetail,
  renderVersionDetail,
} from "./html/node.js";

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
      renderNodeChats({
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
    console.error("Node chats error:", err);
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
      version: Number(version),
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
    console.error("editStatus error:", err);
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
    console.error("updateParent error:", err);
    res.status(400).json({ error: err.message });
  }
});
// -----------------------------------------------------------------------------
// GET /api/v1/node/:nodeId
// Returns the node + all versions (no notes)
// Supports JSON or ?html mode
// Shows full node data, parent + children clickable
// -----------------------------------------------------------------------------
router.get("/node/:nodeId", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).lean();

    if (!node) return res.status(404).json({ error: "Node not found" });

    // Strip sensitive wallet info
    if (Array.isArray(node.versions)) {
      node.versions = node.versions.map((v) => ({
        ...v,
        wallet: v.wallet
          ? {
              publicKey: v.wallet.publicKey ?? null,
            }
          : null,
      }));
    }

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
      renderNodeDetail({ node, nodeId, qs, parentName, rootUrl, isPublicAccess: !!req.isPublicAccess }),
    );
  } catch (err) {
    console.error("Error fetching node:", err);
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

    // Strip sensitive wallet info
    if (Array.isArray(node.versions)) {
      node.versions = node.versions.map((v) => ({
        ...v,
        wallet: v.wallet
          ? {
              publicKey: v.wallet.publicKey ?? null,
            }
          : null,
      }));
    }

    if (isNaN(v) || v < 0 || v >= node.versions.length)
      return res.status(400).json({ error: "Invalid version index" });

    const data = node.versions[v];

    const ALL_STATUSES = ["active", "completed", "trimmed"];
    const STATUS_LABELS = {
      active: "Activate",
      completed: "Complete",
      trimmed: "Trim",
    };

    const showPrestige = v === node.prestige;

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
      renderVersionDetail({
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
    console.error("Error fetching version:", err);
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
    console.error("createChild error:", err);
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
    console.error("delete node error:", err);
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
    console.error("editName error:", err);
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
      console.error("editType error:", err);
      res.status(400).json({ error: err.message });
    }
  },
);

// Schedule routes moved to extensions/schedules
// Script routes moved to extensions/scripts

export default router;
