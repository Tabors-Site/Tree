import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat, getNodeValues, getNodeGoals } from "./core.js";
import { renderValues } from "./html.js";
import { getExtension } from "../loader.js";

let htmlAuth = authenticate;
export function resolveHtmlAuth() {
  const htmlExt = getExtension("html-rendering");
  if (htmlExt?.exports?.urlAuth) htmlAuth = htmlExt.exports.urlAuth;
}

// Node model is wired via setServices() in core.js before routes are used.
// Import here for the findNodeById helper used in GET routes.
let _Node = null;
export function setNodeModel(Node) { _Node = Node; }
async function findNodeById(id) { return _Node.findById(id).populate("children"); }

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

// Shared handler for both /node/:nodeId/values and /node/:nodeId/:version/values.
// Values/goals are stored on the node itself, not version-snapshotted, so the
// version segment is consumed but unused. It exists for URL consistency with
// notes/contributions on the version detail page.
async function nodeValuesHandler(req, res) {
  try {
    const { nodeId } = req.params;
    const version = req.params.version ?? 0;

    const node = await findNodeById(nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const values = getNodeValues(node);
    const goals = getNodeGoals(node);

    const allKeys = Array.from(new Set([...Object.keys(values), ...Object.keys(goals)])).sort();

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || !getExtension("html-rendering")) {
      return sendOk(res, { nodeId, values, goals });
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => ["token", "html"].includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");
    const queryString = filtered ? `?${filtered}` : "";

    return res.send(renderValues({
      nodeId,
      version,
      nodeName: node.name || nodeId,
      nodeVersion: version,
      allKeys,
      values,
      goals,
      queryString,
      token: req.query.token ?? "",
    }));
  } catch (err) {
    log.error("Values", "Error in node values handler:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
}

router.get("/node/:nodeId/values", htmlAuth, nodeValuesHandler);
router.get("/node/:nodeId/:version/values", htmlAuth, nodeValuesHandler);

router.get("/root/:rootId/values", authenticate, async (req, res) => {
  try {
    const result = await getGlobalValuesTreeAndFlat(req.params.rootId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
