import log from "../../core/log.js";
import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";
import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
  editNote,
  deleteNoteAndFile as coreDeleteNoteAndFile,
  transferNote as coreTransferNote,
  getNoteEditHistory,
} from "../../core/tree/notes.js";

import urlAuth from "../../middleware/urlAuth.js";
import getNodeName from "./helpers/getNameById.js";
import authenticate from "../../middleware/authenticate.js";
import preUploadCheck from "../../middleware/preUploadCheck.js";
import { notFoundPage } from "../../middleware/notFoundPage.js";
import { resolveVersion } from "../../core/tree/treeFetch.js";
import { getExtension } from "../../extensions/loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }
import { getLandUrl } from "../../canopy/identity.js";

const router = express.Router();

// Resolve "latest" to actual prestige number for any route with :version
router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

// Middleware for versionless routes: auto-resolve to latest prestige
async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
}

const uploadsFolder = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, name + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

router.get("/node/:nodeId/:version/notes/editor", urlAuth, async (req, res) => {
  try {
    if (process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res
        .status(404)
        .json({ error: "Server-rendered HTML is disabled" });
    }

    const { nodeId, version } = req.params;
    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : "?html";

    return res.send(
      html().renderEditorPage({
        nodeId,
        version,
        noteId: null,
        noteContent: "",
        qs,
        tokenQS,
        originalLength: 0,
      }),
    );
  } catch (err) {
    log.error("API", "Editor page error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── EDIT EXISTING NOTE EDITOR (GET) ───────────────────────────────────
router.get(
  "/node/:nodeId/:version/notes/:noteId/editor",
  urlAuth,
  async (req, res) => {
    try {
      if (process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res
          .status(404)
          .json({ error: "Server-rendered HTML is disabled" });
      }

      const { nodeId, version, noteId } = req.params;
      const queryString = filterQuery(req);
      const qs = queryString ? `?${queryString}` : "";
      const token = req.query.token ?? "";
      const tokenQS = token ? `?token=${token}&html` : "?html";

      const Note = (await import("../../db/models/notes.js")).default;
      const note = await Note.findById(noteId).lean();

      if (!note)
        return notFoundPage(
          req,
          res,
          "This note doesn't exist or may have been removed.",
        );

      // File notes can't be edited — redirect to view
      if (note.contentType !== "text") {
        return res.redirect(
          `/api/v1/node/${nodeId}/${version}/notes/${noteId}${tokenQS}`,
        );
      }

      return res.send(
        html().renderEditorPage({
          nodeId,
          version,
          noteId,
          noteContent: note.content || "",
          qs,
          tokenQS,
          originalLength: (note.content || "").length,
        }),
      );
    } catch (err) {
      log.error("API", "Editor page error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── NOTE EDIT HISTORY ───────────────────────────
router.get(
  "/node/:nodeId/:version/notes/:noteId/history",
  urlAuth,
  async (req, res) => {
    try {
      const { noteId } = req.params;
      const history = await getNoteEditHistory(noteId);
      return res.json({ history });
    } catch (err) {
      log.error("API", "Note history error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// Book routes moved to extensions/book

/* ------------------------------------------------------------------
   GET /:nodeId/:version/notes 
   - JSON (default)
   - HTML (when ?html is used)
------------------------------------------------------------------- */
router.get("/node/:nodeId/:version/notes", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const rawLimit = req.query.limit;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const result = await coreGetNotes({
      nodeId,
      version: Number(version),
      limit,
      startDate,
      endDate,
    });

    const notes = [...result.notes].reverse().map((n) => ({
      ...n,
      content:
        n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
    }));

    // ---------- OPTIONAL HTML MODE ----------
    const wantHtml = req.query.html !== undefined;
    if (wantHtml && process.env.ENABLE_FRONTEND_HTML === "true") {
      const token = req.query.token || "";
      const nodeName = await getNodeName(nodeId);

      // Check if we have the current user's ID (from cookie/session)
      const currentUserId = req.userId ? req.userId.toString() : null;

      return res.send(
        html().renderNotesList({
          nodeId,
          version: Number(version),
          token,
          nodeName,
          notes,
          currentUserId,
        }),
      );
    }

    // ---------- NORMAL OLD JSON MODE ----------
    return res.json({ success: true, notes });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------------------------
   POST /node/:nodeId/:version/notes
------------------------------------------------------------------- */
router.post(
  "/node/:nodeId/:version/notes",
  authenticate,
  preUploadCheck,
  upload.single("file"),

  async (req, res) => {
    try {
      const { nodeId, version } = req.params;

      const contentType = req.file ? "file" : "text";
      const isReflection = req.body.isReflection === "true";

      const result = await coreCreateNote({
        contentType,
        content: contentType === "file" ? req.file.filename : req.body.content,
        userId: req.userId,
        nodeId,
        version: Number(version),
        isReflection,
        file: req.file,
      });

      const wantHtml = "html" in req.query;

      if (wantHtml) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${version}/notes?token=${req.query.token ?? ""}&html`,
        );
      }

      // otherwise JSON (for API clients)
      return res.json({ success: true, note: result.Note });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

// ── UPDATE EXISTING NOTE (editor PUT) ─────────────────────────────────
router.put(
  "/node/:nodeId/:version/notes/:noteId",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version, noteId } = req.params;
      const { content } = req.body;
      const userId = req.userId || req.body.userId;

      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const result = await editNote({
        noteId,
        content: content ?? "",
        userId,
        version,
        isReflection: false,
        wasAi: false,
      });

      return res.json({
        _id: result.Note._id,
        message: result.message,
        energyUsed: result.energyUsed,
      });
    } catch (err) {
      const status =
        err.message === "Unauthorized"
          ? 403
          : err.message === "Note not found"
            ? 404
            : err.name === "EnergyError"
              ? 403
              : 400;
      return res.status(status).json({ error: err.message });
    }
  },
);
const allowedParams = ["token", "html", "error"];

function filterQuery(req) {
  return Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
    .join("&");
}
/* ------------------------------------------------------------------
   GET /node/:nodeId/:version/notes/:noteId
   - JSON (old behavior)
   - raw file download (old behavior)
   - HTML viewer (optional)
------------------------------------------------------------------- */
router.get("/node/:nodeId/:version/notes/:noteId", async (req, res) => {
  try {
    const { nodeId, version, noteId } = req.params;

    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";

    // Check if token exists in query
    const hasToken = req.query.token !== undefined;

    const Note = (await import("../../db/models/notes.js")).default;
    const note = await Note.findById(noteId)
      .populate("userId", "username")
      .lean();

    if (!note)
      return notFoundPage(
        req,
        res,
        "This note doesn't exist or may have been removed.",
      );

    // Chain validation: every URL segment must match the actual record
    if (
      note.nodeId !== nodeId ||
      note.version !== version ||
      ["deleted", "empty", "null", "system"].includes(
        note.userId?._id?.toString?.() ?? note.userId,
      )
    ) {
      return notFoundPage(
        req,
        res,
        "This note doesn't exist or may have been removed.",
      );
    }

    const back = hasToken
      ? `/api/v1/node/${nodeId}/${version}/notes${qs}`
      : getLandUrl();
    const backText = hasToken ? "← Back to Notes" : "← Back to Home";
    const nodeUrl = `/api/v1/node/${nodeId}${qs}`;
    const editorUrl = `/api/v1/node/${nodeId}/${version}/notes/${noteId}/editor${qs}`;
    const editorButton = !hasToken
      ? ""
      : `
    <a
      href="${editorUrl}"
      class="copy-btn editor-btn"
      title="Open editor"
    >
      ✏️
    </a>
  `;

    const userLink = note.userId
      ? `<a href="/api/v1/user/${note.userId._id}${qs}">
     ${html().escapeHtml(note.userId.username ?? "Unknown user")}
   </a>`
      : html().escapeHtml(note.username ?? "Unknown user");

    const wantHtml = req.query.html !== undefined;
    if (wantHtml && process.env.ENABLE_FRONTEND_HTML === "true") {
      if (note.contentType === "text") {
        return res.send(
          html().renderTextNote({
            back,
            backText,
            userLink,
            editorButton,
            note,
          }),
        );
      }

      const fileDeleted = note.content === "File was deleted";
      const fileUrl = fileDeleted ? "" : `/api/v1/uploads/${note.content}`;
      const filePath = fileDeleted
        ? ""
        : path.join(uploadsFolder, note.content);
      const mimeType = fileDeleted
        ? ""
        : mime.lookup(filePath) || "application/octet-stream";
      const mediaHtml = fileDeleted
        ? ""
        : html().renderMedia(fileUrl, mimeType, { lazy: false });
      const fileName = fileDeleted
        ? "File was deleted"
        : path.basename(note.content);

      return res.send(
        html().renderFileNote({
          back,
          backText,
          userLink,
          note,
          fileName,
          fileUrl,
          mediaHtml,
          fileDeleted,
        }),
      );
    }

    // ---------- DATA BEHAVIOR (NO HTML) ----------
    if (note.contentType === "text") {
      return res.json({ text: note.content });
    }

    if (note.contentType === "file") {
      const filePath = path.join(uploadsFolder, note.content);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.sendFile(filePath);
    }

    res.status(400).json({ error: "Unknown note type" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.delete(
  "/node/:nodeId/:version/notes/:noteId",
  authenticate,
  async (req, res) => {
    try {
      const { noteId } = req.params;

      const result = await coreDeleteNoteAndFile({
        noteId,
        userId: req.userId,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

// ── TRANSFER NOTE TO ANOTHER NODE ─────────────────────────────────────
router.post(
  "/node/:nodeId/:version/notes/:noteId/transfer",
  authenticate,
  async (req, res) => {
    try {
      const { noteId } = req.params;
      const { targetNodeId, prestige } = req.body;

      if (!targetNodeId) {
        return res
          .status(400)
          .json({ success: false, error: "targetNodeId is required" });
      }

      const result = await coreTransferNote({
        noteId,
        targetNodeId,
        userId: req.userId,
        prestige: typeof prestige === "number" ? prestige : null,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

// NEW NOTE EDITOR

// ─────────────────────────────────────────────────────────────────────────
// Versionless aliases (protocol-compliant, auto-resolve to latest prestige)
// These forward to the versioned route handlers by injecting the version.
// ─────────────────────────────────────────────────────────────────────────

router.get("/node/:nodeId/notes", urlAuth, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/notes", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes`;
  router.handle(req, res, next);
});

router.get("/node/:nodeId/notes/:noteId", useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes/${req.params.noteId}`;
  router.handle(req, res, next);
});

router.put("/node/:nodeId/notes/:noteId", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes/${req.params.noteId}`;
  router.handle(req, res, next);
});

router.delete("/node/:nodeId/notes/:noteId", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes/${req.params.noteId}`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/notes/:noteId/transfer", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes/${req.params.noteId}/transfer`;
  router.handle(req, res, next);
});

router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ success: false, error: "File exceeds maximum size of 4 GB" });
  }
  next(err);
});

export default router;
