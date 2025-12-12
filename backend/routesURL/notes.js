import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";

import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
} from "../core/notes.js";

import urlAuth from "../middleware/urlAuth.js";

const router = express.Router();

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

const upload = multer({ storage });

router.get("/:nodeId/:version/notes", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;

    const result = await coreGetNotes({
      nodeId,
      version: Number(version),
    });

    // Convert file-based notes into URLs
    const notes = result.notes.map((n) => ({
      ...n,
      content:
        n.contentType === "file"
          ? `${req.protocol}://${req.get("host")}/uploads/${n.content}`
          : n.content,
    }));

    res.json({ success: true, notes });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// POST /:nodeId/:version/notes   create a text or file note
// -------------------------------------------------------------
router.post(
  "/:nodeId/:version/notes",
  urlAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;

      const contentType = req.file ? "file" : "text";

      const isReflection = req.body.isReflection === "true";

      const result = await coreCreateNote({
        contentType,
        content: req.body.content,
        userId: req.userId,
        nodeId,
        version: Number(version),
        isReflection,
        file: req.file,
      });

      res.json({ success: true, note: result.Note });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// -------------------------------------------------------------
// GET /:nodeId/:version/notes/:noteId  download or return text
// -------------------------------------------------------------
router.get("/:nodeId/:version/notes/:noteId", async (req, res) => {
  try {
    const { noteId } = req.params;

    const Note = (await import("../db/models/notes.js")).default;
    const note = await Note.findById(noteId).lean();

    if (!note) return res.status(404).json({ error: "Note not found" });

    if (note.contentType === "text") {
      return res.json({ text: note.content });
    }

    if (note.contentType === "file") {
      const filePath = path.join(uploadsFolder, note.content);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.download(filePath);
    }

    res.status(400).json({ error: "Unknown note type" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
