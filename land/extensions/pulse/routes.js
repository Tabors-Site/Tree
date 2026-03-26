import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getLatestSnapshot } from "./core.js";

const router = express.Router();

// GET /pulse - latest health snapshot (CLI endpoint)
router.get("/pulse", authenticate, async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    if (!snapshot) {
      return sendOk(res, { message: "No pulse data yet. Health check has not run." });
    }
    sendOk(res, snapshot);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
