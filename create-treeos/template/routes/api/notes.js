import log from "../../seed/log.js";
import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
  editNote,
  deleteNoteAndFile as coreDeleteNoteAndFile,
  transferNote as coreTransferNote,
  getNoteEditHistory,
} from "../../seed/tree/notes.js";

import authenticate from "../../seed/middleware/authenticate.js";
import preUploadCheck from "../../seed/middleware/preUploadCheck.js";
import { getExtension } from "../../extensions/loader.js";

const router = express.Router();

async function resolveVersion(nodeId, version) {
  const resolve = getExtension("prestige")?.exports?.resolveVersion;
  if (resolve) return resolve(nodeId, version);
  return version === "latest" ? 0 : Number(version);
}

router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
});

async function useLatest(req, res, next) {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
}

import { fileURLToPath } from "url";
const __notesDir = path.dirname(fileURLToPath(import.meta.url));
const uploadsFolder = path.join(__notesDir, "../../uploads");

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

// Multer fileSize must match maxUploadBytes config. The pre-upload check only
// validates Content-Length (which can be spoofed). This is the real enforcement.
const upload = multer({
  storage,
  limits: { fileSize: Number(getLandConfigValue("maxUploadBytes")) || 104857600 },
});

router.get(
  "/node/:nodeId/:version/notes/:noteId/history",
  authenticate,
  async (req, res) => {
    try {
      const { noteId } = req.params;
      const rawLimit = Number(req.query.limit) || 100;
      const limit = Math.min(Math.max(1, rawLimit), 1000);
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const history = await getNoteEditHistory(noteId, limit, offset);
      return sendOk(res, { history, limit, offset });
    } catch (err) {
      log.error("API", "Note history error:", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

router.get("/node/:nodeId/:version/notes", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const rawLimit = req.query.limit;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit: must be a positive number");
    }

    // Date range validation
    if (startDate && isNaN(Date.parse(startDate))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid startDate format");
    }
    if (endDate && isNaN(Date.parse(endDate))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid endDate format");
    }
    if (startDate && endDate) {
      const span = Date.parse(endDate) - Date.parse(startDate);
      if (span < 0) return sendError(res, 400, ERR.INVALID_INPUT, "endDate must be after startDate");
      if (span > 365 * 24 * 60 * 60 * 1000) return sendError(res, 400, ERR.INVALID_INPUT, "Date range cannot exceed 365 days");
    }

    const rawOffset = req.query.offset;
    const offset = rawOffset !== undefined ? Math.max(0, Number(rawOffset) || 0) : 0;

    const result = await coreGetNotes({
      nodeId,
      limit,
      offset,
      startDate,
      endDate,
    });

    const notes = [...result.notes].reverse().map((n) => ({
      ...n,
      content:
        n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
    }));

    return sendOk(res, { notes, offset });
  } catch (err) {
    return sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

router.post(
  "/node/:nodeId/:version/notes",
  authenticate,
  preUploadCheck,
  upload.single("file"),

  async (req, res) => {
    try {
      const { nodeId, version } = req.params;

      const contentType = req.file ? "file" : "text";

      const result = await coreCreateNote({
        contentType,
        content: contentType === "file" ? req.file.filename : req.body.content,
        userId: req.userId,
        nodeId,
        file: req.file,
      });

      return sendOk(res, { note: result.Note });
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

router.put(
  "/node/:nodeId/:version/notes/:noteId",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version, noteId } = req.params;
      const { content } = req.body;
      const userId = req.userId || req.body.userId;

      if (!userId) return sendError(res, 401, ERR.UNAUTHORIZED, "Unauthorized");

      const result = await editNote({
        noteId,
        content: content ?? "",
        userId,
        wasAi: false,
      });

      return sendOk(res, {
        _id: result.Note._id,
        message: result.message,
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
      const code =
        err.message === "Unauthorized"
          ? ERR.FORBIDDEN
          : err.message === "Note not found"
            ? ERR.NOTE_NOT_FOUND
            : err.name === "EnergyError"
              ? ERR.FORBIDDEN
              : ERR.INVALID_INPUT;
      return sendError(res, status, code, err.message);
    }
  },
);

router.get("/node/:nodeId/:version/notes/:noteId", authenticate, async (req, res) => {
  try {
    const { nodeId, version, noteId } = req.params;

    const Note = (await import("../../seed/models/note.js")).default;
    const note = await Note.findById(noteId)
      .populate("userId", "username")
      .lean();

    if (!note) {
      return sendError(res, 404, ERR.NOTE_NOT_FOUND, "This note doesn't exist or may have been removed.");
    }

    if (
      note.nodeId !== nodeId ||
      note.version !== version ||
      ["deleted", "empty", "null", "system"].includes(
        note.userId?._id?.toString?.() ?? note.userId,
      )
    ) {
      return sendError(res, 404, ERR.NOTE_NOT_FOUND, "This note doesn't exist or may have been removed.");
    }

    if (note.contentType === "text") {
      return sendOk(res, { text: note.content });
    }

    if (note.contentType === "file") {
      const filePath = path.join(uploadsFolder, note.content);
      if (!fs.existsSync(filePath)) {
        return sendError(res, 404, ERR.NOTE_NOT_FOUND, "File not found");
      }
      return res.sendFile(filePath);
    }

    sendError(res, 400, ERR.INVALID_INPUT, "Unknown note type");
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
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

      sendOk(res, result);
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

router.post(
  "/node/:nodeId/:version/notes/:noteId/transfer",
  authenticate,
  async (req, res) => {
    try {
      const { noteId } = req.params;
      const { targetNodeId, prestige } = req.body;

      if (!targetNodeId) {
        return sendError(res, 400, ERR.INVALID_INPUT, "targetNodeId is required");
      }

      const result = await coreTransferNote({
        noteId,
        targetNodeId,
        userId: req.userId,
        prestige: typeof prestige === "number" ? prestige : null,
      });

      sendOk(res, result);
    } catch (err) {
      sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }
  },
);

router.get("/node/:nodeId/notes", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes`;
  router.handle(req, res, next);
});

router.post("/node/:nodeId/notes", authenticate, useLatest, (req, res, next) => {
  req.url = `/node/${req.params.nodeId}/${req.params.version}/notes`;
  router.handle(req, res, next);
});

router.get("/node/:nodeId/notes/:noteId", authenticate, useLatest, (req, res, next) => {
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
    return sendError(res, 413, ERR.UPLOAD_TOO_LARGE, "File exceeds maximum size of 4 GB");
  }
  next(err);
});

export default router;
