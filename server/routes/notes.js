// routes/notesRouter.js

const express = require("express");
const router = express.Router();
const  authenticate  = require("../middleware/authenticate");
const { upload, createNote, getNotes, getFile, deleteNoteAndFile } = require("../controllers/notes");

// Route to create a note
router.post("/create-Note", authenticate, upload.single("file"), createNote);

router.get("/uploads/:fileName", getFile)

// Route to get notes for a specific node
router.post("/get-Notes", authenticate, getNotes);

router.post("/delete-note", authenticate, deleteNoteAndFile);

module.exports = router;
