import log from "../../seed/log.js";
import express from "express";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }
import {
  getDeletedBranchesForUser,
} from "../../seed/tree/treeFetch.js";
import {
  reviveNodeBranch,
  reviveNodeBranchAsRoot,
} from "../../seed/tree/treeManagement.js";
import User from "../../seed/models/user.js";

export default function createRouter(core) {
  const router = express.Router();

  router.get("/user/:userId/deleted", authenticateOptional, async (req, res) => {
    try {
      const { userId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const deleted = await getDeletedBranchesForUser(userId);

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { userId, deleted });
      }

      const user = await User.findById(userId).lean();
      const token = req.query.token ?? "";

      const renderDeletedBranches = html().renderDeletedBranches;
      if (!renderDeletedBranches) {
        return sendOk(res, { userId, deleted });
      }

      return res.send(renderDeletedBranches({ userId, user, deleted, token }));
    } catch (err) {
      log.error("Deleted Revive", "Error in /user/:userId/deleted:", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/user/:userId/deleted/:nodeId/revive", authenticate, async (req, res) => {
    try {
      const { userId, nodeId } = req.params;
      const { targetParentId } = req.body;

      if (!req.userId || req.userId.toString() !== userId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      if (!targetParentId) {
        return sendError(res, 400, ERR.INVALID_INPUT, "targetParentId is required");
      }

      const result = await reviveNodeBranch({
        deletedNodeId: nodeId,
        targetParentId,
        userId: req.userId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${nodeId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res, result);
    } catch (err) {
      log.error("Deleted Revive", "revive branch error:", err);
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  router.post("/user/:userId/deleted/:nodeId/reviveAsRoot", authenticate, async (req, res) => {
    try {
      const { userId, nodeId } = req.params;

      if (!req.userId || req.userId.toString() !== userId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      const result = await reviveNodeBranchAsRoot({
        deletedNodeId: nodeId,
        userId: req.userId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${nodeId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return sendOk(res, result);
    } catch (err) {
      log.error("Deleted Revive", "revive root error:", err);
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  return router;
}
