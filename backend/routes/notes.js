import express from "express";

import authenticate from "../middleware/authenticate.js";

import {
  upload,
  createNote,
  getNotes,
  getFile,
  deleteNoteAndFile,
} from "../controllers/notes.js";

const router = express.Router();

router.post("/create-Note", authenticate, upload.single("file"), createNote);

router.get("/uploads/:fileName", getFile);

router.post("/get-Notes", authenticate, getNotes);

router.post("/delete-note", authenticate, deleteNoteAndFile);

export default router;
