import express from "express";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS, tokenQS } from "../html-rendering/htmlHelpers.js";
import { getExtension } from "../loader.js";
import { renderNotifications } from "./pages/notifications.js";

export default function buildNotificationsHtmlRoutes() {
  const router = express.Router();

  router.get("/user/:userId/notifications", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId).select("username").lean();
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      const notifExt = getExtension("notifications");
      if (!notifExt?.exports?.getNotifications) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Notifications extension not loaded");

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const { notifications, total } = await notifExt.exports.getNotifications({ userId, limit, offset });

      return res.send(renderNotifications({
        userId,
        notifications,
        total,
        username: user.username,
        token: req.query.token ?? "",
      }));
    } catch (err) {
      log.error("HTML", "Notifications render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
