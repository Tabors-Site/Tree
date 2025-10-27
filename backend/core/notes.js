import path from "path";
import fs from "fs";
import Note from "../db/models/notes.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadsFolder)) {
    fs.mkdirSync(uploadsFolder);
}

async function createNote({ contentType, content, userId, nodeId, version, isReflection, file }) {
    if (!contentType || !["file", "text"].includes(contentType)) {
        throw new Error("Invalid content type");
    }
    if (!userId || !nodeId) {
        throw new Error("Missing required fields");
    }

    let filePath = null;
    if (contentType === "file") {
        if (!file) throw new Error("File is required for file content type");
        filePath = file.filename;
    }

    const isReflectionBool = isReflection === "true" || isReflection === true;

    const newNote = new Note({
        contentType,
        content: contentType === "file" ? filePath : content,
        userId,
        nodeId,
        version,
        isReflection: isReflectionBool,
    });

    await newNote.save();

    return {
        message: "Note created successfully",
        Note: newNote,
    };
}

async function getNotes({ nodeId, version }) {
    try {
        if (!nodeId) {
            throw new Error("Missing required parameter: nodeId");
        }

        if (typeof version !== "number" || isNaN(version)) {
            throw new Error("Invalid or missing version: must be a number");
        }

        const query = { nodeId, version };

        const notes = await Note.find(query)
            .populate("userId", "username")
            .populate("nodeId")
            .lean();

        if (!notes || notes.length === 0) {
            return {
                message: `No notes found for node ${nodeId} (version ${version})`,
                notes: [],
            };
        }

        const notesWithUsername = notes.map((note) => ({
            _id: note._id,
            contentType: note.contentType,
            content: note.content,
            username: note.userId ? note.userId.username : null,
            nodeId: note.nodeId?._id,
            version: note.version,
            isReflection: note.isReflection,
            createdAt: note.createdAt,
        }));

        return {
            message: "Notes retrieved successfully",
            notes: notesWithUsername,
        };
    } catch (err) {
        console.error("Error in getNotes:", err);

        throw new Error(
            err.message || "Database error occurred while retrieving notes."
        );
    }
}


async function deleteNoteAndFile({ noteId }) {
    const note = await Note.findById(noteId);
    if (!note) throw new Error("Note not found");

    if (note.contentType === "file" && note.content) {
        const filePath = path.join(uploadsFolder, note.content);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted file: ${filePath}`);
        } else {
            console.log(`File not found: ${filePath}`);
        }
    }

    await Note.findByIdAndDelete(noteId);

    return { message: "Note and associated file deleted successfully" };
}

export { createNote, getNotes, deleteNoteAndFile };
