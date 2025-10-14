const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Note = require("../db/models/notes");

const uploadsFolder = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

// Generate a unique ID for file names
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsFolder);
  },
  filename: (req, file, cb) => {
    const uniqueId = generateId();
    const extension = path.extname(file.originalname);
    const fileName = `${uniqueId}${extension}`;
    cb(null, fileName);
  },
});

const upload = multer({ storage });

const createNote = async (req, res) => {
  try {
    const { contentType, content, userId, nodeId, version, isReflection } =
      req.body;

    // Validation
    if (!contentType || !["file", "text"].includes(contentType)) {
      return res.status(400).json({ message: "Invalid content type" });
    }
    if (!userId || !nodeId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    let filePath = null;

    if (contentType === "file") {
      // Ensure file is uploaded
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "File is required for file content type" });
      }
      filePath = req.file.filename; // Save the file name (or path) to the database
    }

    // Convert isReflection to a boolean if it is sent as a string
    const isReflectionBool = isReflection === "true" || isReflection === true;

    // Create Note entry
    const newNote = new Note({
      contentType,
      content: contentType === "file" ? filePath : content,
      userId,
      nodeId,
      version,
      isReflection: isReflectionBool, // Save the boolean value
    });

    await newNote.save();
    res.status(201).json({
      message: "Note created successfully",
      Note: newNote,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating Note" });
  }
};

const getNotes = async (req, res) => {
  try {
    const { nodeId, version } = req.body;


    let query = { nodeId };

    if (version && version !== "all") {
      query.version = version; // Only fetch notes for the specific version if it's not "all"
    }

    
    const notes = await Note.find(query)
      .populate("userId", "username") // Only populate the username field
      .populate("nodeId");

    if (!notes || notes.length === 0) {
      return res.status(404).json({ message: "No notes found for this node" });
    }

    // Map through the notes to send back only the username and other necessary data
    const notesWithUsername = notes.map((note) => {
      return {
        _id: note._id,
        contentType: note.contentType,
        content: note.content, // Could be filename for file content
        username: note.userId ? note.userId.username : null, // Attach username instead of userId
        nodeId: note.nodeId._id, // If nodeId needs to be included
        version: note.version,
        isReflection: note.isReflection,
        createdAt: note.createdAt,
      };
    });

    // Return the list of notes with the username included
    res.status(200).json({
      message: "Notes retrieved successfully",
      notes: notesWithUsername,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error retrieving notes" });
  }
};

// Example endpoint to serve uploaded files
const getFile = (req, res) => {
  const filePath = path.join(uploadsFolder, req.params.fileName);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: "File not found" });
  }
};

const deleteNoteAndFile = async (req, res) => {
  try {
    const { noteId } = req.body;  // Retrieve the noteId from the request parameters

    // Find the note by its ID
    const note = await Note.findById(noteId);

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    // If the note has a file, delete it from the file system
    if (note.contentType === "file" && note.content) {
      const filePath = path.join(uploadsFolder, note.content);  // Get the full path to the file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);  // Delete the file from the filesystem
        console.log(`Deleted file: ${filePath}`);
      } else {
        console.log(`File not found: ${filePath}`);
      }
    }

    // Delete the note from the database
    await Note.findByIdAndDelete(noteId);

    res.status(200).json({
      message: "Note and associated file deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting note and file" });
  }
};


module.exports = { upload, createNote, getNotes, getFile, deleteNoteAndFile };
