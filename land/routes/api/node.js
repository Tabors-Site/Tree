import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";
import { createNewNode, editNodeName } from "../../core/tree/treeManagement.js";
import { editNodeType } from "../../core/tree/nodeTypes.js";
import {
  updateParentRelationship,
  deleteNodeBranch,
} from "../../core/tree/treeManagement.js";

import {
  updateScript,
  executeScript,
  getScript,
} from "../../core/tree/scripts.js";

import { editStatus, addPrestige } from "../../core/tree/statuses.js";
import { updateSchedule } from "../../core/tree/schedules.js";

import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import { resolveVersion, buildPathString } from "../../core/tree/treeFetch.js";
import { getNodeAIChats } from "../../core/llms/aichat.js";

import {
  renderNodeChats,
  renderNodeDetail,
  renderVersionDetail,
  renderScriptDetail,
  renderScriptHelp,
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

const prestigeHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const nextVersion = Number(version) + 1;

    if (Number.isNaN(nextVersion)) {
      return res.status(400).json({ error: "Invalid version" });
    }

    const result = await addPrestige({
      nodeId,
      userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${nextVersion}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("prestige error:", err);
    res.status(400).json({ error: err.message });
  }
};
router.post("/node/:nodeId/prestige", authenticate, useLatest, prestigeHandler);
router.post("/node/:nodeId/:version/prestige", authenticate, prestigeHandler);

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

const editScheduleHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const newSchedule = req.body?.newSchedule || req.query?.newSchedule;

    const reeffectTime = req.body?.reeffectTime ?? req.query?.reeffectTime;

    if (reeffectTime === undefined) {
      return res.status(400).json({
        error: "reeffectTime is required",
      });
    }

    const result = await updateSchedule({
      nodeId,
      versionIndex: Number(version),
      newSchedule,
      reeffectTime: Number(reeffectTime),
      userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${version}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("editSchedule error:", err);
    res.status(err.status || 400).json({ error: err.message });
  }
};
router.post("/node/:nodeId/editSchedule", authenticate, useLatest, editScheduleHandler);
router.post("/node/:nodeId/:version/editSchedule", authenticate, editScheduleHandler);

router.get("/node/:nodeId/script/:scriptId", urlAuth, async (req, res) => {
  try {
    const { nodeId, scriptId } = req.params;

    if (!nodeId || !scriptId) {
      return res.status(400).json({
        error: "Missing required fields: nodeId, scriptId",
      });
    }

    const { script, contributions } = await getScript({ nodeId, scriptId });

    // Preserve allowed query params (token, html)
    const qs = filterQuery(req);
    const qsWithQ = qs ? `?${qs}` : "";

    const wantHtml = "html" in req.query;

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ script, contributions });
    }

    return res.send(
      renderScriptDetail({ nodeId, script, contributions, qsWithQ }),
    );
  } catch (err) {
    console.error("Error fetching script:", err);

    if (
      err.message === "Node not found" ||
      err.message === "Script not found"
    ) {
      return res.status(404).json({ error: err.message });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/node/:nodeId/script/:scriptId/edit",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, scriptId } = req.params;
      const { name, script } = req.body;
      const userId = req.userId;

      await updateScript({
        nodeId,
        scriptId,
        name,
        script,
        userId,
      });
      const qs = filterQuery(req);

      return res.redirect(`/api/v1/node/${nodeId}/script/${scriptId}?${qs}`);
    } catch (err) {
      console.error("Error editing script:", err);
      return res.status(500).send("Failed to update script");
    }
  },
);

router.post(
  "/node/:nodeId/script/:scriptId/execute",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, scriptId } = req.params;
      const userId = req.userId;

      await executeScript({ nodeId, scriptId, userId });

      const qs = filterQuery(req);
      return res.redirect(`/api/v1/node/${nodeId}/script/${scriptId}?${qs}`);
    } catch (err) {
      console.error("Error executing script:", err);

      let qs = "";
      try {
        qs = filterQuery(req);
      } catch (e) {
        console.error("filterQuery failed:", e);
      }
      const { nodeId, scriptId } = req.params;

      return res.redirect(
        `/api/v1/node/${nodeId}/script/${scriptId}?${qs}&error=${encodeURIComponent(
          err.message,
        )}`,
      );
    }
  },
);

router.get("/node/:nodeId/scripts/help", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const node = await Node.findById(nodeId).lean();
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    const data = {
      nodeProperties: {
        basic: [
          { property: "node._id", description: "Node ID (UUID)" },
          { property: "node.name", description: "Node name" },
          { property: "node.type", description: "Node type (nullable)" },
          {
            property: "node.prestige",
            description: "Highest version index (current generation)",
          },
        ],
        version: [
          {
            property: "node.versions[i].values",
            description: "Object mapping string keys to numeric values",
            example: '{ "health": 100, "gold": 50 }',
          },
          {
            property: "node.versions[i].goals",
            description: "Object mapping string keys to numeric goals",
            example: '{ "health": 200, "gold": 100 }',
          },
          {
            property: "node.versions[i].schedule",
            description: "Timestamp (ISO string) for scheduled execution",
          },
          {
            property: "node.versions[i].prestige",
            description: "Version number (generation index)",
          },
          {
            property: "node.versions[i].reeffectTime",
            description: "Repeat interval in hours for recurring scripts",
          },
          {
            property: "node.versions[i].status",
            description: 'Status: "active", "completed", or "trimmed"',
          },
          {
            property: "node.versions[i].dateCreated",
            description: "Creation timestamp for this version",
          },
        ],
        other: [
          {
            property: "node.scripts",
            description: "Array of scripts attached to this node",
            example: "[{ name, script }, ...]",
          },
          {
            property: "node.children",
            description: "Array of child node IDs (UUIDs)",
          },
          {
            property: "node.parent",
            description: "Parent node ID (UUID) or null if root",
          },
          {
            property: "node.rootOwner",
            description: "Root owner user ID (UUID) or null",
          },
        ],
      },
      builtInFunctions: [
        {
          name: "getApi()",
          description: "Fetches data from API with GET. Returns a promise.",
        },
        {
          name: "setValueForNode(nodeId, key, value, version)",
          description: "Sets a value in node.versions[version].values[key]",
        },
        {
          name: "setGoalForNode(nodeId, key, goal, version)",
          description: "Sets a goal in node.versions[version].goals[key]",
        },
        {
          name: "editStatusForNode(nodeId, status, version, isInherited)",
          description:
            'Updates status: "active", "completed", "trimmed". Can propagate to children.',
        },
        {
          name: "addPrestigeForNode(nodeId)",
          description: "Prestiges the node by one generation",
        },
        {
          name: "updateScheduleForNode(nodeId, versionIndex, newSchedule, reeffectTime)",
          description: "Sets schedule timestamp and repeat interval (hours)",
        },
      ],
      exampleScript: `// This script tapers a value over time
let waitTime = node.versions[node.prestige].values.waitTime;
const newWaitTime = waitTime * 1.05;

// Create a new version (prestige)
addPrestigeForNode(node._id);

// Schedule the script to run again after waitTime hours
const now = new Date();
const newSchedule = new Date(now.getTime() + waitTime * 3600 * 1000);
updateScheduleForNode(node._id, node.prestige + 1, newSchedule, 0);

// Update the waitTime value in the new version
setValueForNode(node._id, "waitTime", newWaitTime, node.prestige + 1);`,
      importantNote:
        "The node object does not auto-update during script execution. Be careful using it after transactions unless you manually refresh it.",
    };

    const wantHtml = "html" in req.query;

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json(data);
    }

    const qs = filterQuery(req);
    const qsWithQ = qs ? `?${qs}` : "";

    return res.send(
      renderScriptHelp({ nodeId, nodeName: node.name, data, qsWithQ }),
    );
  } catch (err) {
    console.error("Error loading script help:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/node/:nodeId/script/create", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { name } = req.body;
    const userId = req.userId;

    if (!name) {
      return res.status(400).send("Script name is required");
    }

    const result = await updateScript({
      nodeId,
      name,
      userId,
    });

    const qs = filterQuery(req);

    return res.redirect(
      `/api/v1/node/${nodeId}/script/${result.scriptId}?${qs}`,
    );
  } catch (err) {
    console.error("Create script error:", err);
    return res.status(500).send("Failed to create script");
  }
});

export default router;
