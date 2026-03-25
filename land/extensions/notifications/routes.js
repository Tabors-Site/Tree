import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getNotifications } from "./core.js";
import { getExtension } from "../loader.js";

function readAuth(req, res, next) {
  const handler = getExtension("html-rendering")?.exports?.urlAuth;
  if (handler) return handler(req, res, next);
  return authenticate(req, res, next);
}

const router = express.Router();

router.get("/user/:userId/notifications", readAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const { notifications, total } = await getNotifications({
      userId,
      rootId: req.query.rootId,
      limit,
      offset,
    });

    return sendOk(res, { notifications, total, limit, offset });
  } catch (err) {
    log.error("Notifications", "Route error:", err);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
