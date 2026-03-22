import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import User from "../../db/models/user.js";
import { getAIChats } from "../../core/llms/aichat.js";
import {
  getAllNotesByUser,
  getAllTagsForUser,
  searchNotesByUser,
} from "../../core/tree/notes.js";
import { getNotifications } from "../../core/tree/notifications.js";
import { getContributionsByUser } from "../../core/tree/contributions.js";
import getNodeName from "../../routes/api/helpers/getNameById.js";
import {
  renderUserNotes,
  renderUserTags,
  renderUserContributions,
  renderChats,
  renderNotifications,
} from "../../routes/api/html/user.js";

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

  // GET /user/:userId/notes
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
        return res.status(400).json({
          success: false,
          error: "Invalid limit: must be a positive number",
        });
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

      if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res.json({ success: true, notes, query });
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
      console.error("Error in /user/:userId/notes:", err);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // GET /user/:userId/tags
  router.get("/user/:userId/tags", urlAuth, async (req, res) => {
    try {
      const userId = req.params.userId;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;

      const token = req.query.token ?? "";
      const rawLimit = req.query.limit;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return res.status(400).json({ success: false, error: "Invalid limit: must be a positive number" });
      }

      const result = await getAllTagsForUser(userId, limit, startDate, endDate);

      const notes = result.notes.map((n) => ({
        ...n,
        content: n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
      }));

      if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res.json({ success: true, taggedBy: result.taggedBy, notes });
      }

      const user = await User.findById(userId).lean();
      return res.send(await renderUserTags({ userId, user, notes, getNodeName, token }));
    } catch (err) {
      console.error("Error in /user/:userId/tags:", err);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // GET /user/:userId/contributions
  router.get("/user/:userId/contributions", urlAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

      const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return res.status(400).json({ error: "Invalid limit" });
      }

      const token = req.query.token ?? "";
      const tokenQS = token ? `?token=${token}&html` : `?html`;

      const { contributions = [] } = await getContributionsByUser(userId, limit, req.query.startDate, req.query.endDate);

      if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res.json({ userId, contributions });
      }

      const user = await User.findById(userId).lean();
      return res.send(renderUserContributions({ userId, user, contributions, token }));
    } catch (err) {
      console.error("Error in /user/:userId/contributions:", err);
      res.status(400).json({ error: err.message });
    }
  });

  // GET /user/:userId/chats
  router.get("/user/:userId/chats", urlAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

      const rawLimit = req.query.limit;
      let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return res.status(400).json({ error: "Invalid limit" });
      }
      if (limit > 10) limit = 10;

      const token = req.query.token ?? "";
      let sessionId = req.query.sessionId;
      if (typeof sessionId === "string") {
        sessionId = sessionId.replace(/^"+|"+$/g, "");
      }

      const { sessions } = await getAIChats({
        userId,
        sessionLimit: limit || 10,
        sessionId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      const allChats = sessions.flatMap((s) => s.chats);

      if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res.json({ userId, count: allChats.length, sessions });
      }

      const user = await User.findById(userId).lean();
      const username = user?.username || "Unknown user";

      return res.send(renderChats({ userId, chats: allChats, sessions, username, token, sessionId }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /user/:userId/notifications
  router.get("/user/:userId/notifications", urlAuth, async (req, res) => {
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

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res.json({ notifications, total, limit, offset });
      }

      const user = await User.findById(userId).lean();
      const username = user?.username || "Unknown user";
      const token = req.query.token ?? "";

      return res.send(renderNotifications({ userId, notifications, total, username, token }));
    } catch (err) {
      console.error("Notifications route error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
