import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getThesis, deriveThesis } from "./core.js";
import User from "../../seed/models/user.js";

const router = express.Router();

// GET /root/:rootId/thesis
router.get("/root/:rootId/thesis", authenticate, async (req, res) => {
  try {
    const data = await getThesis(req.params.rootId);
    if (!data) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");
    sendOk(res, data);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/thesis/rederive
router.post("/root/:rootId/thesis/rederive", authenticate, async (req, res) => {
  try {
    const thesis = await deriveThesis(req.params.rootId, req.userId);
    if (!thesis) return sendOk(res, { message: "Could not derive thesis" });
    sendOk(res, { thesis });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
