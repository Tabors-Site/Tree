import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import { checkCascade, getCascadeResults, getAllCascadeResults } from "../../seed/tree/cascade.js";
import { retryFailedHops, getPropagationConfig } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/cascade/status - cascade status at this node
router.get("/node/:nodeId/cascade/status", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId).select("name metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const cascadeConfig = meta.cascade || {};
    const globalEnabled = getLandConfigValue("cascadeEnabled");
    const propConfig = await getPropagationConfig();

    sendOk(res, {
      nodeId: req.params.nodeId,
      nodeName: node.name,
      cascadeEnabled: globalEnabled === true || globalEnabled === "true",
      nodeEnabled: !!cascadeConfig.enabled,
      mode: cascadeConfig.mode || propConfig.defaultCascadeMode,
      crossLand: !!cascadeConfig.crossLand,
      filters: cascadeConfig.filters || [],
      acceptSealed: !!cascadeConfig.acceptSealed,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/cascade/trigger - manually fire checkCascade
router.post("/node/:nodeId/cascade/trigger", authenticate, async (req, res) => {
  try {
    const result = await checkCascade(req.params.nodeId, {
      action: "manual-cascade",
      triggeredBy: req.userId,
    });
    if (!result) {
      return sendOk(res, { message: "Cascade did not fire. Check cascadeEnabled and node config." });
    }
    sendOk(res, { signalId: result.signalId, status: result.result?.status });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/cascade/retry - retry failed hops from this node
router.post("/node/:nodeId/cascade/retry", authenticate, async (req, res) => {
  try {
    const result = await retryFailedHops();
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/cascade/config - show cascade config
router.get("/node/:nodeId/cascade/config", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId).select("metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const propConfig = await getPropagationConfig();
    sendOk(res, { cascadeConfig: meta.cascade || {}, propagationConfig: propConfig });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
