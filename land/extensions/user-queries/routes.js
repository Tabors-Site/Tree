import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Being from "../../seed/models/being.js";
import { getChats } from "../../seed/llm/chatHistory.js";
import { getExtension } from "../loader.js";
import {
  getAllArtifactsByUser,
  searchArtifactsByUser,
} from "../../seed/tree/artifacts.js";
import { getDidsByBeing } from "../seed/tree/dids.js";
import getNodeName from "../../routes/api/helpers/getNameById.js";
import { renderUserNotes } from "./pages/userNotes.js";
import { renderChats } from "./pages/userChats.js";
import { renderUserContributions } from "./pages/userContributions.js";
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function createRouter(core) {
  const htmlExt = getExtension("html-rendering");
  const htmlAuth = htmlExt?.exports?.urlAuth || authenticate;

  const router = express.Router();

  router.get("/user/:beingId/notes", htmlAuth, async (req, res) => {
    try {
      const beingId = req.params.beingId;
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
        result = await searchArtifactsByUser({ beingId, query, limit, startDate, endDate });
      } else {
        result = await getAllArtifactsByUser(beingId, limit, startDate, endDate);
      }

      const notes = (result.artifacts || []).map((n) => ({
        ...n,
        _id: n._id || n.id,
        content: n.origin === "filesystem" ? `/api/v1/uploads/${n.content}` : n.content,
      }));

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { notes, query });
      }

      const user = await Being.findById(beingId).lean();

      const processedNotes = await Promise.all(
        notes.map(async (n) => {
          const noteId = n._id || n.id;
          const preview =
            n.origin === "ibp"
              ? n.content.length > 120
                ? n.content.substring(0, 120) + "..."
                : n.content
              : n.content.split("/").pop();

          const nodeName = await getNodeName(n.nodeId);

          return `
    <li class="note-card" data-note-id="${noteId}" data-node-id="${n.nodeId}" data-version="${n.version}">
      <div class="card-actions">
        ${n.origin === "ibp"
            ? `<a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}/editor${tokenQS}" class="edit-button" title="Edit note">✎</a>`
            : ""}
        <button class="delete-button" title="Delete note">✕</button>
      </div>
      <div class="note-content">
        <div class="note-author">${escapeHtml(user.username)}</div>
        <a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}${tokenQS}" class="note-link">
          ${n.origin === "filesystem" ? `<span class="file-badge">FILE</span>` : ""}${escapeHtml(preview)}
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

      return res.send(renderUserNotes({ beingId, user, notes, processedNotes, query, token }));
    } catch (err) {
 log.error("User Queries", "Error in /user/:beingId/notes:", err);
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  // Tags route moved to extensions/team

  router.get("/user/:beingId/contributions", htmlAuth, async (req, res) => {
    try {
      const { beingId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

      const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit");
      }

      const token = req.query.token ?? "";
      const tokenQS = token ? `?token=${token}&html` : `?html`;

      const { contributions = [] } = await getDidsByBeing(beingId, limit, req.query.startDate, req.query.endDate);

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { beingId, contributions });
      }

      const user = await Being.findById(beingId).lean();
      return res.send(await renderUserContributions({ beingId, user, contributions, username: user?.username, getNodeName, token }));
    } catch (err) {
 log.error("User Queries", "Error in /user/:beingId/contributions:", err);
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  });

  router.get("/user/:beingId/chats", htmlAuth, async (req, res) => {
    try {
      const { beingId } = req.params;
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
        beingId,
        sessionLimit: limit || 10,
        sessionId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      const allChats = sessions.flatMap((s) => s.chats);

      if (!wantHtml || !getExtension("html-rendering")) {
        return sendOk(res, { beingId, count: allChats.length, sessions });
      }

      const user = await Being.findById(beingId).lean();
      const username = user?.username || "Unknown user";

      return res.send(renderChats({ beingId, chats: allChats, sessions, username, token, sessionId }));
    } catch (err) {
 log.error("User Queries", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Notifications route moved to extensions/notifications

  return router;
}
