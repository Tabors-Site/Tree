// routes/notesRouter.js

import express from 'express';

const router = express.Router();
import authenticate from '../middleware/authenticate.js';
import { upload, createNote, getNotes, getFile, deleteNoteAndFile } from '../controllers/notes.js';

// Route to create a note
router.post("/create-Note", authenticate, upload.single("file"), createNote);

router.get("/uploads/:fileName", getFile)

// Route to get notes for a specific node
router.post("/get-Notes", authenticate, getNotes);

router.post("/delete-note", authenticate, deleteNoteAndFile);

export default router;
