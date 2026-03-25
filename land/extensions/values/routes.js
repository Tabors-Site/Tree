import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { findNodeById } from "../../seed/utils.js";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import { setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat, getNodeValues, getNodeGoals } from "./core.js";
import { renderValues } from "./html.js";

const router = express.Router();

router.post("/node/:nodeId/value", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { key, value } = req.body;

    await setValueForNode({ nodeId, key, value, userId: req.userId });

    if ("html" in req.query) {
      return res.redirect(`/api/v1/node/${nodeId}/values?token=${req.query.token ?? ""}&html`);
    }
    sendOk(res);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
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
    sendOk(res);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

router.get("/node/:nodeId/values", authenticateOptional, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const node = await findNodeById(nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const values = getNodeValues(node);
    const goals = getNodeGoals(node);

    const allKeys = Array.from(new Set([...Object.keys(values), ...Object.keys(goals)])).sort();

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return sendOk(res, { nodeId, values, goals });
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
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get("/root/:rootId/values", authenticateOptional, async (req, res) => {
  try {
    const result = await getGlobalValuesTreeAndFlat(req.params.rootId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
