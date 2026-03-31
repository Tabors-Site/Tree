import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { findDestination, listPositions } from "./core.js";

const router = express.Router();

router.get("/go", authenticate, async (req, res) => {
  try {
    const query = req.query.q || req.query.destination || "";
    const result = query.trim()
      ? await findDestination(query, req.userId)
      : await listPositions(req.userId);

    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
