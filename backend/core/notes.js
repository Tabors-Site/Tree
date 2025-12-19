import path from "path";
import fs from "fs";
import Note from "../db/models/notes.js";
import User from "../db/models/user.js";
import { logContribution } from "../db/utils.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

async function extractTaggedUsersAndRewrite(content) {
  const mentionRegex = /@([\w-]+)/g;
  const matches = [...content.matchAll(mentionRegex)];

  if (matches.length === 0) {
    return { tagged: [], rewrittenContent: content };
  }

  const identifiers = matches.map((m) => m[1]);

  const users = await User.find({
    $or: [{ username: { $in: identifiers } }, { _id: { $in: identifiers } }],
  });

  const idToUser = {};
  users.forEach((u) => {
    idToUser[u._id] = u;
    idToUser[u.username] = u;
  });

  const uniqueTagged = [...new Set(users.map((u) => u._id))];

  const rewrittenContent = content.replace(mentionRegex, (full, ident) => {
    const user = idToUser[ident];
    if (!user) return full;
    return "@" + user.username;
  });

  return { tagged: uniqueTagged, rewrittenContent };
}

async function createNote({
  contentType,
  content,
  userId,
  nodeId,
  version,
  isReflection,
  file,
}) {
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
  let taggedUserIds = [];
  let finalContent = content;

  if (contentType === "text" && content) {
    const { tagged, rewrittenContent } = await extractTaggedUsersAndRewrite(
      content
    );

    taggedUserIds = tagged;
    finalContent = rewrittenContent;
  }

  const newNote = new Note({
    contentType,
    content: contentType === "file" ? filePath : finalContent,
    userId,
    nodeId,
    version,
    isReflection: isReflectionBool,
    tagged: taggedUserIds,
  });

  await newNote.save();
  await logContribution({
    userId,
    nodeId,
    action: "note",
    nodeVersion: version,
    noteAction: {
      action: "add",
      noteId: newNote._id.toString(),
    },
  });
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
      userId: note.userId?._id?.toString(),
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

async function getAllNotesByUser(userId) {
  if (!userId) {
    throw new Error("Missing required parameter: userId");
  }

  const notes = await Note.find({ userId: userId })
    .sort({ createdAt: -1 })
    .lean();

  return {
    notes,
  };
}

async function getAllTagsForUser(userId) {
  if (!userId) {
    throw new Error("Missing required parameter: userId");
  }

  const notes = await Note.find({ tagged: userId })
    .populate("userId", "username") // author
    .lean();

  const notesWithTaggedBy = notes.map((n) => ({
    ...n,
    authorId: n.userId?._id?.toString(),
    authorUsername: n.userId?.username,
    taggedBy: n.userId?._id?.toString(), // user who wrote the note
  }));

  return { notes: notesWithTaggedBy };
}

async function deleteNoteAndFile({ noteId, userId }) {
  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");

  const { nodeId, version } = note; // original nodeId for logging
  let fileDeleted = false;

  // If it's a file, delete it and modify content
  if (note.contentType === "file" && note.content) {
    const filePath = path.join(uploadsFolder, note.content);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      fileDeleted = true;
      console.log(`Deleted file: ${filePath}`);
    } else {
      console.log(`File not found: ${filePath}`);
    }

    // update note fields
    note.content = "File was deleted";
    note.nodeId = "deleted";
  } else {
    // text note: keep content, just move nodeId
    note.nodeId = "deleted";
  }

  await note.save();

  await logContribution({
    userId,
    nodeId, // original nodeId
    action: "note",
    nodeVersion: version,
    noteAction: {
      action: "remove",
      noteId: noteId.toString(),
      fileDeleted: fileDeleted || undefined,
    },
  });

  return {
    message: fileDeleted
      ? "File note removed and file deleted."
      : "Text note removed and moved to deleted.",
  };
}

export {
  createNote,
  getNotes,
  deleteNoteAndFile,
  getAllNotesByUser,
  getAllTagsForUser,
};
