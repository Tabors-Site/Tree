import log from "../../core/log.js";
import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import { findNodeById } from "../../db/utils.js";
import authenticate from "../../middleware/authenticate.js";
import { setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat, getNodeValues, getNodeGoals } from "./core.js";

let renderValues;
try {
  ({ renderValues } = await import("../../routes/api/html/values.js"));
} catch {}

const router = express.Router();

router.post("/node/:nodeId/value", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { key, value } = req.body;

    await setValueForNode({ nodeId, key, value, userId: req.userId });

    if ("html" in req.query) {
      return res.redirect(`/api/v1/node/${nodeId}/values?token=${req.query.token ?? ""}&html`);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/node/:nodeId/goal", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { key, goal } = req.body;

    await setGoalForNode({ nodeId, key, goal, userId: req.userId });

    if ("html" in req.query) {
      return res.redirect(`/api/v1/node/${nodeId}/values?token=${req.query.token ?? ""}&html`);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get("/node/:nodeId/values", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const node = await findNodeById(nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });

    const values = getNodeValues(node);
    const goals = getNodeGoals(node);

    const allKeys = Array.from(new Set([...Object.keys(values), ...Object.keys(goals)])).sort();

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true" || !renderValues) {
      return res.json({ nodeId, values, goals });
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => ["token", "html"].includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");
    const queryString = filtered ? `?${filtered}` : "";

    return res.send(renderValues({
      nodeId,
      version: 0,
      nodeName: node.name || nodeId,
      nodeVersion: 0,
      allKeys,
      values,
      goals,
      queryString,
      token: req.query.token ?? "",
    }));
  } catch (err) {
 log.error("Values", "Error in /node/:nodeId/values:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/root/:rootId/values", urlAuth, async (req, res) => {
  try {
    const result = await getGlobalValuesTreeAndFlat(req.params.rootId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
