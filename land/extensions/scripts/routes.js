import log from "../../core/log.js";
import express from "express";
import Node from "../../db/models/node.js";
import authenticate from "../../middleware/authenticate.js";
import urlAuth from "../../middleware/urlAuth.js";
import {
  updateScript,
  executeScript,
  getScript,
} from "./core.js";
import {
  renderScriptDetail,
  renderScriptHelp,
} from "../../routes/api/html/node.js";

const router = express.Router();

const allowedParams = ["token", "html", "error"];

function filterQuery(req) {
  return Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
    .join("&");
}

// GET script detail
router.get("/node/:nodeId/script/:scriptId", urlAuth, async (req, res) => {
  try {
    const { nodeId, scriptId } = req.params;

    if (!nodeId || !scriptId) {
      return res.status(400).json({
        error: "Missing required fields: nodeId, scriptId",
      });
    }

    const { script, contributions } = await getScript({ nodeId, scriptId });

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
 log.error("Scripts", "Error fetching script:", err);

    if (
      err.message === "Node not found" ||
      err.message === "Script not found"
    ) {
      return res.status(404).json({ error: err.message });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
});

// Edit script
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
 log.error("Scripts", "Error editing script:", err);
      return res.status(500).send("Failed to update script");
    }
  },
);

// Execute script
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
 log.error("Scripts", "Error executing script:", err);

      let qs = "";
      try {
        qs = filterQuery(req);
      } catch (e) {
 log.error("Scripts", "filterQuery failed:", e);
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

// Script help/reference page
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
          { property: "node.status", description: "Node status (active, completed, trimmed)" },
        ],
        metadata: [
          {
            property: "metadata.values",
            description: "Object mapping string keys to numeric values",
            example: '{ "health": 100, "gold": 50 }',
          },
          {
            property: "metadata.goals",
            description: "Object mapping string keys to numeric goals",
            example: '{ "health": 200, "gold": 100 }',
          },
          {
            property: "metadata.schedule",
            description: "Timestamp (ISO string) for scheduled execution",
          },
          {
            property: "metadata.reeffectTime",
            description: "Repeat interval in hours for recurring scripts",
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
          name: "setValueForNode(nodeId, key, value)",
          description: "Sets a value in metadata.values[key]",
        },
        {
          name: "setGoalForNode(nodeId, key, goal)",
          description: "Sets a goal in metadata.goals[key]",
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
let waitTime = metadata.values.waitTime;
const newWaitTime = waitTime * 1.05;

// Update the value
setValueForNode(node._id, "waitTime", newWaitTime);

// Schedule the script to run again after waitTime hours
const now = new Date();
const newSchedule = new Date(now.getTime() + waitTime * 3600 * 1000);
updateScheduleForNode(node._id, newSchedule, 0);

// Update the waitTime value in the new version
setValueForNode(node._id, "waitTime", newWaitTime, 0 + 1);`,
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
 log.error("Scripts", "Error loading script help:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create new script
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
 log.error("Scripts", "Create script error:", err);
    return res.status(500).send("Failed to create script");
  }
});

export default router;
