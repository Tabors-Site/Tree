import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getExtension } from "../loader.js";
import { renderDeletedBranches } from "./pages/deleted.js";
import {
  getDeletedBranchesForUser,
} from "../../seed/tree/treeFetch.js";
import {
  reviveNodeBranch,
  reviveNodeBranchAsRoot,
} from "../../seed/tree/treeManagement.js";
import Being from "../../seed/models/being.js";

export default function createRouter(core) {
  const htmlExt = getExtension("html-rendering");
  const htmlAuth = htmlExt?.exports?.urlAuth || authenticate;

  const router = express.Router();

  router.get("/user/:beingId/deleted", htmlAuth, async (req, res) => {
    try {
      const { beingId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const deleted = await getDeletedBranchesForUser(beingId);

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { beingId, deleted });
      }

      const user = await Being.findById(beingId).lean();
      const token = req.query.token ?? "";

      // renderDeletedBranches imported directly from pages/deleted.js
      if (!renderDeletedBranches) {
        return sendOk(res, { beingId, deleted });
      }

      return res.send(renderDeletedBranches({ beingId, user, deleted, token }));
    } catch (err) {
      log.error("Deleted Revive", "Error in /user/:beingId/deleted:", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/user/:beingId/deleted/:nodeId/revive", authenticate, async (req, res) => {
    try {
      const { beingId, nodeId } = req.params;
      const { targetParentId } = req.body;

      if (!req.beingId || req.beingId.toString() !== beingId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      if (!targetParentId) {
        return sendError(res, 400, ERR.INVALID_INPUT, "targetParentId is required");
      }

      const result = await reviveNodeBranch({
        deletedNodeId: nodeId,
        targetParentId,
        beingId: req.beingId,
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

  router.post("/user/:beingId/deleted/:nodeId/reviveAsRoot", authenticate, async (req, res) => {
    try {
      const { beingId, nodeId } = req.params;

      if (!req.beingId || req.beingId.toString() !== beingId.toString()) {
        return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
      }

      const result = await reviveNodeBranchAsRoot({
        deletedNodeId: nodeId,
        beingId: req.beingId,
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
