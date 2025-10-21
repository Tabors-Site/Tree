import multer from "multer";
import path from "path";
import fs from "fs";

import { fileURLToPath } from "url";
import {
  createNoteHelper,
  getNotesHelper,
  deleteNoteAndFileHelper,
} from "./helpers/notesHelper.js";

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
    const result = await createNoteHelper({
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
    const result = await getNotesHelper({
      nodeId: req.body.nodeId,
      version: req.body.version,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function deleteNoteAndFile(req, res) {
  try {
    const result = await deleteNoteAndFileHelper({
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
export { upload, createNote, getNotes, deleteNoteAndFile, getFile };
