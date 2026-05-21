import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getCompetence } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/competence
router.get("/node/:nodeId/competence", authenticate, async (req, res) => {
  try {
    const comp = await getCompetence(req.params.nodeId);
    if (!comp || comp.totalQueries === 0) {
      return sendOk(res, { message: "No competence data yet.", totalQueries: 0 });
    }
    sendOk(res, comp);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
