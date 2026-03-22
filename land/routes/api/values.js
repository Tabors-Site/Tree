import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import { findNodeById } from "../../db/utils.js";
import Node from "../../db/models/node.js";
import { resolveVersion } from "../../core/tree/treeFetch.js";
import authenticate from "../../middleware/authenticate.js";
import { setValueForNode, setGoalForNode } from "../../core/tree/values.js";
import {
  renderValues,
} from "./html/values.js";

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

async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
}

const allowedParams = ["token", "html"];

// SET VALUE
router.post("/node/:nodeId/:version/value", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const { key, value } = req.body;

    await setValueForNode({
      nodeId,
      version,
      key,
      value,
      userId: req.userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// SET GOAL
router.post("/node/:nodeId/:version/goal", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const { key, goal } = req.body;

    await setGoalForNode({
      nodeId,
      version,
      key,
      goal,
      userId: req.userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get("/node/:nodeId/:version/values", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;

    const parsedVersion = Number(version);
    if (isNaN(parsedVersion)) {
      return res.status(400).json({
        error: "Invalid version: must be a number",
      });
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const node = await findNodeById(nodeId);
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    const versionData = node.versions?.[parsedVersion];
    const nodeName = node.name || nodeId;
    const nodeVersion = node.prestige || 0;

    if (!versionData) {
      return res.status(404).json({
        error: `Version ${parsedVersion} not found`,
      });
    }

    const values = Object.fromEntries(versionData.values || []);
    const goals = Object.fromEntries(versionData.goals || []);

    const allKeys = Array.from(
      new Set([...Object.keys(values), ...Object.keys(goals)]),
    ).sort();

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        nodeId,
        version: parsedVersion,
        values,
        goals,
      });
    }

    return res.send(
      renderValues({
        nodeId,
        version: parsedVersion,
        nodeName,
        nodeVersion,
        allKeys,
        values,
        goals,
        queryString,
        token: req.query.token ?? "",
      }),
    );
  } catch (err) {
    console.error("Error in /node/:nodeId/:version/values:", err);
    res.status(500).json({ error: err.message });
  }
});

// Versionless aliases (protocol-compliant)
router.get("/node/:nodeId/values", urlAuth, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/values`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/value", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/value`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/goal", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/goal`;
  router.handle(req, res, next);
});

export default router;
