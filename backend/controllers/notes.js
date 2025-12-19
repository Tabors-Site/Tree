import multer from "multer";
import path from "path";
import fs from "fs";

import { fileURLToPath } from "url";
import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
  deleteNoteAndFile as coreDeleteNoteAndFile,
  getAllNotesByUser as coreGetAllNotesByUser,
  getAllTagsForUser as coreGetAllTagsForUser,
} from "../core/notes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../uploads");

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const uniqueId = generateId();
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueId}${extension}`);
  },
});

const upload = multer({ storage });

async function createNote(req, res) {
  try {
    const result = await coreCreateNote({
      contentType: req.body.contentType,
      content: req.body.content,
      userId: req.body.userId,
      nodeId: req.body.nodeId,
      version: req.body.version,
      isReflection: req.body.isReflection,
      file: req.file,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getNotes(req, res) {
  try {
    const result = await coreGetNotes({
      nodeId: req.body.nodeId,
      version: req.body.version,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}
async function getAllNotesByUser(req, res) {
  try {
    const userId = req.body.userId || req.params.userId;

    const result = await coreGetAllNotesByUser(userId);

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}
async function getAllTagsForUser(req, res) {
  try {
    const userId = req.body.userId || req.params.userId;

    const result = await coreGetAllTagsForUser(userId);

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function deleteNoteAndFile(req, res) {
  try {
    const result = await coreDeleteNoteAndFile({
      userId: req.userId,
      noteId: req.body.noteId,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

function getFile(req, res) {
  const filePath = path.join(uploadsFolder, req.params.fileName);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: "File not found" });
  }
}
export {
  upload,
  createNote,
  getNotes,
  getAllNotesByUser,
  getAllTagsForUser,
  deleteNoteAndFile,
  getFile,
};
