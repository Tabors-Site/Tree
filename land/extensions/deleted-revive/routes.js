import log from "../../core/log.js";
import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }
import {
  getDeletedBranchesForUser,
} from "../../core/tree/treeFetch.js";
import {
  reviveNodeBranch,
  reviveNodeBranchAsRoot,
} from "../../core/tree/treeManagement.js";
import User from "../../db/models/user.js";

export default function createRouter(core) {
  const router = express.Router();

  router.get("/user/:userId/deleted", urlAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const deleted = await getDeletedBranchesForUser(userId);

      if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res.json({ userId, deleted });
      }

      const user = await User.findById(userId).lean();
      const token = req.query.token ?? "";

      const renderDeletedBranches = html().renderDeletedBranches;
      if (!renderDeletedBranches) {
        return res.json({ userId, deleted });
      }

      return res.send(renderDeletedBranches({ userId, user, deleted, token }));
    } catch (err) {
 log.error("Deleted Revive", "Error in /user/:userId/deleted:", err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/user/:userId/deleted/:nodeId/revive", authenticate, async (req, res) => {
    try {
      const { userId, nodeId } = req.params;
      const { targetParentId } = req.body;

      if (!req.userId || req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (!targetParentId) {
        return res.status(400).json({ error: "targetParentId is required" });
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

      return res.json({ success: true, ...result });
    } catch (err) {
 log.error("Deleted Revive", "revive branch error:", err);
      return res.status(400).json({ error: err.message });
    }
  });

  router.post("/user/:userId/deleted/:nodeId/reviveAsRoot", authenticate, async (req, res) => {
    try {
      const { userId, nodeId } = req.params;

      if (!req.userId || req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
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

      return res.json({ success: true, ...result });
    } catch (err) {
 log.error("Deleted Revive", "revive root error:", err);
      return res.status(400).json({ error: err.message });
    }
  });

  return router;
}
