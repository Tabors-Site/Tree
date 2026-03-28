import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import User from "../../seed/models/user.js";
import { getChats } from "../../seed/ws/chatHistory.js";
import { getExtension } from "../loader.js";
import {
  getAllNotesByUser,
  searchNotesByUser,
} from "../../seed/tree/notes.js";
import { getContributionsByUser } from "../../seed/tree/contributions.js";
import getNodeName from "../../routes/api/helpers/getNameById.js";
import { renderUserNotes } from "./pages/userNotes.js";
import { renderChats } from "./pages/userChats.js";
import { renderUserContributions } from "./pages/userContributions.js";
function html() { return getExtension("html-rendering")?.exports || {}; }

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function createRouter(core) {
  const router = express.Router();

  router.get("/user/:userId/notes", urlAuth, async (req, res) => {
    try {
      const userId = req.params.userId;
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      const query = req.query.q || "";

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const token = req.query.token ?? "";
      const tokenQS = token ? `?token=${token}&html` : `?html`;

      const rawLimit = req.query.limit;
      let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

      if (limit >= 200 || limit == undefined) {
        limit = 200;
      }
      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit: must be a positive number");
      }

      let result;
      if (query.trim() !== "") {
        result = await searchNotesByUser({ userId, query, limit, startDate, endDate });
      } else {
        result = await getAllNotesByUser(userId, limit, startDate, endDate);
      }

      const notes = result.notes.map((n) => ({
        ...n,
        _id: n._id || n.id,
        content: n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
      }));

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { notes, query });
      }

      const user = await User.findById(userId).lean();

      const processedNotes = await Promise.all(
        notes.map(async (n) => {
          const noteId = n._id || n.id;
          const preview =
            n.contentType === "text"
              ? n.content.length > 120
                ? n.content.substring(0, 120) + "..."
                : n.content
              : n.content.split("/").pop();

          const nodeName = await getNodeName(n.nodeId);

          return `
    <li class="note-card" data-note-id="${noteId}" data-node-id="${n.nodeId}" data-version="${n.version}">
      <div class="card-actions">
        ${n.contentType === "text"
            ? `<a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}/editor${tokenQS}" class="edit-button" title="Edit note">✎</a>`
            : ""}
        <button class="delete-button" title="Delete note">✕</button>
      </div>
      <div class="note-content">
        <div class="note-author">${escapeHtml(user.username)}</div>
        <a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}${tokenQS}" class="note-link">
          ${n.contentType === "file" ? `<span class="file-badge">FILE</span>` : ""}${escapeHtml(preview)}
        </a>
      </div>
      <div class="note-meta">
        ${new Date(n.createdAt).toLocaleString()}
        <span class="meta-separator">•</span>
        <a href="/api/v1/node/${n.nodeId}/${n.version}${tokenQS}">${escapeHtml(nodeName)} v${n.version}</a>
        <span class="meta-separator">•</span>
        <a href="/api/v1/node/${n.nodeId}/${n.version}/notes${tokenQS}">View Notes</a>
      </div>
    </li>`;
        }),
      );

      return res.send(renderUserNotes({ userId, user, notes, processedNotes, query, token }));
    } catch (err) {
 log.error("User Queries", "Error in /user/:userId/notes:", err);
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  // Tags route moved to extensions/team

  router.get("/user/:userId/contributions", urlAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

      const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit");
      }

      const token = req.query.token ?? "";
      const tokenQS = token ? `?token=${token}&html` : `?html`;

      const { contributions = [] } = await getContributionsByUser(userId, limit, req.query.startDate, req.query.endDate);

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { userId, contributions });
      }

      const user = await User.findById(userId).lean();
      return res.send(await renderUserContributions({ userId, user, contributions, username: user?.username, getNodeName, token }));
    } catch (err) {
 log.error("User Queries", "Error in /user/:userId/contributions:", err);
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  router.get("/user/:userId/chats", urlAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

      const rawLimit = req.query.limit;
      let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit");
      }
      if (limit > 10) limit = 10;

      const token = req.query.token ?? "";
      let sessionId = req.query.sessionId;
      if (typeof sessionId === "string") {
        sessionId = sessionId.replace(/^"+|"+$/g, "");
      }

      const { sessions } = await getChats({
        userId,
        sessionLimit: limit || 10,
        sessionId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      const allChats = sessions.flatMap((s) => s.chats);

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { userId, count: allChats.length, sessions });
      }

      const user = await User.findById(userId).lean();
      const username = user?.username || "Unknown user";

      return res.send(renderChats({ userId, chats: allChats, sessions, username, token, sessionId }));
    } catch (err) {
 log.error("User Queries", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Notifications route moved to extensions/notifications

  return router;
}
