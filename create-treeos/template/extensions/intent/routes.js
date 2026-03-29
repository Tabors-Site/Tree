import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";

let Node = null;
let Note = null;
let Contribution = null;
let _metadata = null;
export function setModels(models) {
  Node = models.Node;
  Note = models.Note;
  Contribution = models.Contribution;
}
export function setMetadata(metadata) { _metadata = metadata; }

function validateRootId(req, res) {
  const rootId = req.params.rootId;
  if (!rootId || rootId === "undefined" || rootId === "null") {
    sendError(res, 400, ERR.INVALID_INPUT, "rootId is required");
    return null;
  }
  return rootId;
}

const router = express.Router();

// GET /root/:rootId/intent - Show current queue and recent executions
router.get("/root/:rootId/intent", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const root = await Node.findById(rootId).select("metadata name").lean();
    if (!root) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

    const intentMeta = _metadata.getExtMeta(root, "intent");

    // Find .intent node and its recent notes
    const intentNode = await Node.findOne({ parent: rootId, name: ".intent" }).select("_id").lean();
    let recentExecutions = [];
    if (intentNode) {
      recentExecutions = await Note.find({ nodeId: intentNode._id })
        .sort({ dateCreated: -1 })
        .limit(20)
        .select("content dateCreated")
        .lean();
    }

    sendOk(res, {
      rootId,
      enabled: !!intentMeta.enabled,
      paused: !!intentMeta.paused,
      rejections: intentMeta.rejections || [],
      recentExecutions: recentExecutions.map(n => ({
        content: n.content,
        executedAt: n.dateCreated,
      })),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/intent/pause - Pause autonomous behavior
router.post("/root/:rootId/intent/pause", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const root = await Node.findById(rootId);
    if (!root) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

    const meta = _metadata.getExtMeta(root, "intent");
    meta.paused = true;
    await _metadata.setExtMeta(root, "intent", meta);

    log.verbose("Intent", `Autonomous intent paused for tree ${root.name}`);
    sendOk(res, { paused: true });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/intent/resume - Resume autonomous behavior
router.post("/root/:rootId/intent/resume", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const root = await Node.findById(rootId);
    if (!root) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

    const meta = _metadata.getExtMeta(root, "intent");
    meta.paused = false;
    await _metadata.setExtMeta(root, "intent", meta);

    log.verbose("Intent", `Autonomous intent resumed for tree ${root.name}`);
    sendOk(res, { paused: false });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /root/:rootId/intent/history - Full history of autonomous actions
router.get("/root/:rootId/intent/history", authenticate, async (req, res) => {
  try {
    const rootId = req.params.rootId;

    // Get contributions logged by intent
    const contributions = await Contribution.find({
      action: "intent:executed",
    })
      .sort({ date: -1 })
      .limit(50)
      .lean();

    // Filter to this tree's nodes
    const nodeIds = new Set();
    const nodes = await Node.find({ rootOwner: rootId }).select("_id").lean();
    for (const n of nodes) nodeIds.add(n._id.toString());

    const treeContributions = contributions
      .filter(c => nodeIds.has(c.nodeId?.toString()))
      .map(c => ({
        action: c.extensionData?.intent?.action,
        reason: c.extensionData?.intent?.reason,
        priority: c.extensionData?.intent?.priority,
        targetNodeId: c.extensionData?.intent?.targetNodeId,
        result: c.extensionData?.intent?.result,
        executedAt: c.date,
      }));

    sendOk(res, { history: treeContributions });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/intent/reject - Tell the tree not to do that again
router.post("/root/:rootId/intent/reject", authenticate, async (req, res) => {
  try {
    const { id, description } = req.body;
    if (!id && !description) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Provide an intent id or description to reject");
    }

    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const root = await Node.findById(rootId);
    if (!root) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

    const meta = _metadata.getExtMeta(root, "intent");
    if (!meta.rejections) meta.rejections = [];

    // Cap rejections list to prevent unbounded growth
    if (meta.rejections.length >= 100) {
      meta.rejections = meta.rejections.slice(-50);
    }

    meta.rejections.push({
      pattern: description || id,
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.userId,
    });

    await _metadata.setExtMeta(root, "intent", meta);

    log.verbose("Intent", `Intent rejected for tree ${root.name}: ${description || id}`);
    sendOk(res, { rejected: true, totalRejections: meta.rejections.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
