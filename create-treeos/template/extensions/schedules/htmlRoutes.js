import express from "express";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS, tokenQS } from "../html-rendering/htmlHelpers.js";
import { getExtension } from "../loader.js";
import { renderCalendar } from "./pages/calendar.js";

export default function buildSchedulesHtmlRoutes() {
  const router = express.Router();

  router.get("/root/:rootId/calendar", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const now = new Date();
      const month = Math.max(1, Math.min(12, Number(req.query.month) || (now.getMonth() + 1)));
      const year = Math.max(2000, Math.min(2100, Number(req.query.year) || now.getFullYear()));
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      let calendar = [];
      try {
        const schedules = getExtension("schedules");
        if (schedules?.exports?.getCalendar) {
          calendar = await schedules.exports.getCalendar({ rootNodeId: rootId, startDate, endDate });
        }
      } catch {}

      const byDay = {};
      for (const item of calendar) {
        const d = new Date(item.scheduledDate);
        if (isNaN(d.getTime())) continue;
        const day = d.toISOString().split("T")[0];
        (byDay[day] = byDay[day] || []).push(item);
      }

      return res.send(renderCalendar({
        rootId, queryString: buildQS(req), month, year, byDay,
      }));
    } catch (err) {
      log.error("HTML", "Calendar render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
