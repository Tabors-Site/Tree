import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { ingest, getStatus, searchCode } from "./core.js";

const router = express.Router();

// POST /code/ingest - ingest a codebase
router.post("/code/ingest", authenticate, async (req, res) => {
  try {
    const { rootId, path: dirPath, ignore } = req.body;
    if (!rootId || !dirPath) return sendError(res, 400, ERR.INVALID_INPUT, "rootId and path required");

    const stats = await ingest(rootId, dirPath, req.userId, { ignore });

    const Node = (await import("../../seed/models/node.js")).default;
    await Node.updateOne({ _id: rootId }, {
      $set: {
        "metadata.code": {
          initialized: true,
          ingestedAt: new Date().toISOString(),
          path: dirPath,
          fileCount: stats.files,
          dirCount: stats.dirs,
          totalLines: stats.lines,
        },
        "metadata.modes.respond": "tree:code-browse",
      },
    });

    sendOk(res, { stats });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /code/status - code tree status
router.get("/code/status", authenticate, async (req, res) => {
  try {
    const nodeId = req.query.nodeId || req.query.rootId;
    if (!nodeId) return sendError(res, 400, ERR.INVALID_INPUT, "nodeId required");
    const status = await getStatus(nodeId);
    sendOk(res, status || { initialized: false });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /code/search - search codebase
router.get("/code/search", authenticate, async (req, res) => {
  try {
    const { rootId, query } = req.query;
    if (!rootId || !query) return sendError(res, 400, ERR.INVALID_INPUT, "rootId and query required");
    const results = await searchCode(rootId, query);
    sendOk(res, { results });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
