// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import path from "path";
import fs from "fs";
import Note from "../models/note.js";
import User from "../models/user.js";
import Node from "../models/node.js";

import Contribution from "../models/contribution.js";
import { logContribution, escapeRegex } from "../utils.js";
import { hooks } from "../hooks.js";
import { getLandConfigValue } from "../landConfig.js";
import { fileURLToPath } from "url";
import { resolveRootNode } from "./treeFetch.js";
import { CONTENT_TYPE, DELETED, NODE_STATUS, ERR, ProtocolError } from "../protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../../uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}
function buildDateRange(startDate, endDate) {
  if (!startDate && !endDate) return null;

  const range = {};
  if (startDate) range.$gte = new Date(startDate);
  if (endDate) range.$lte = new Date(endDate);

  return range;
}

export let NOTE_TEXT_MAX_CHARS = 5000;
export function setNoteMaxChars(n) { NOTE_TEXT_MAX_CHARS = n; }

export async function assertNoteTextWithinLimit(content, userId) {
  if (!content) return;

  if (userId) {
    const user = await User.findById(userId).select("isAdmin").lean();
    if (user?.isAdmin) return;
  }

  if (content.length > NOTE_TEXT_MAX_CHARS) {
    throw new Error(
      `Note exceeds maximum length of ${NOTE_TEXT_MAX_CHARS} characters`,
    );
  }
}

async function createNote({
  contentType,
  content,
  userId,
  nodeId,
  file,
  wasAi = false,
  chatId = null,
  sessionId = null,
  metadata = {},
}) {
  if (!contentType || !Object.values(CONTENT_TYPE).includes(contentType)) {
    throw new Error("Invalid content type");
  }
  if (!userId || !nodeId) {
    throw new Error("Missing required fields");
  }

  // Check node exists, is not a system node, and has not been deleted.
  // parent: { $exists: true, $ne: null } ensures we reject nodes mid-deletion
  // (deleteNodeBranch nullifies parent before removing the node).
  const targetNode = await Node.findOne({
    _id: nodeId,
    parent: { $exists: true, $ne: null },
  }).select("systemRole parent").lean();
  if (!targetNode) throw new Error("Node not found or deleted");
  if (targetNode.systemRole) throw new Error("Cannot modify system nodes");

  // Note count cap: prevents runaway extensions from flooding a node
  const maxNotes = Number(getLandConfigValue("maxNotesPerNode")) || 1000;
  const noteCount = await Note.countDocuments({ nodeId });
  if (noteCount >= maxNotes) {
    throw new Error(`Node has reached the maximum of ${maxNotes} notes. Delete old notes before adding new ones.`);
  }

  let filePath = null;
  if (contentType === CONTENT_TYPE.FILE) {
    if (!file) throw new Error("File is required for file content type");
    filePath = file.filename;
  } else {
    await assertNoteTextWithinLimit(content || "", userId);
  }

  let finalContent = content;

  // ── HOOKS ────────────────────────────────────────
  const hookData = { nodeId, content: finalContent, userId, contentType, metadata: { ...metadata } };
  const hookResult = await hooks.run("beforeNote", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Note creation cancelled by extension");
  }

  // Extensions may rewrite content via beforeNote (e.g. @mention canonicalization)
  finalContent = hookData.content;

  // ── SAVE ────────────────────────────────────────
  const newNote = new Note({
    contentType,
    content: contentType === CONTENT_TYPE.FILE ? filePath : finalContent,
    userId,
    nodeId,
    metadata: hookData.metadata,
  });

  await newNote.save();

  // Storage tracking (core concern, per-user disk usage)
  const sizeKB = contentType === CONTENT_TYPE.FILE && file
    ? Math.ceil(file.size / 1024)
    : Math.ceil(Buffer.byteLength(finalContent || "", "utf8") / 1024);
  if (sizeKB > 0) {
    User.findByIdAndUpdate(userId, { $inc: { "metadata.storage.usageKB": sizeKB } }).catch(() => {});
  }

  // afterNote hook (fire-and-forget)
  hooks.run("afterNote", { note: newNote, nodeId, userId, contentType, sizeKB, action: "create" }).catch(() => {});

  // Cascade: if this node has metadata.cascade enabled, fire onCascade
  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(nodeId, { action: "note:create", contentType, sizeKB, userId })
  ).catch(() => {});

  // ── LOG ─────────────────────────────────────────
  await logContribution({
    userId,
    nodeId,
    wasAi,
    chatId,
    sessionId,
    action: "note",

    noteAction: {
      action: "add",
      noteId: newNote._id.toString(),
      content: contentType === CONTENT_TYPE.TEXT ? finalContent || "" : null,
    },
  });

  return { message: "Note created successfully", Note: newNote };
}

async function editNote({
  noteId,
  content,
  userId,
  lineStart = null,
  lineEnd = null,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (!noteId || !userId) {
    throw new Error("Missing required fields");
  }

  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");

  if (note.userId.toString() !== userId.toString()) {
    throw new Error("Unauthorized");
  }

  if (note.contentType !== CONTENT_TYPE.TEXT) {
    throw new Error("File notes cannot be edited");
  }

  const oldContent = note.content || "";

  // ── LINE-RANGE EDITING ──────────────────────────
  let newContent;

  if (lineStart !== null && lineEnd !== null) {
    // Replace specific line range
    const lines = oldContent.split("\n");

    // Clamp to valid range
    const start = Math.max(0, lineStart);
    const end = Math.min(lines.length, lineEnd);

    if (start > end) {
      throw new Error(`Invalid line range: ${start}-${end}`);
    }

    // Split replacement content into lines
    const replacementLines = (content ?? "").split("\n");

    // Splice: remove lines [start, end), insert replacement
    lines.splice(start, end - start, ...replacementLines);

    newContent = lines.join("\n");
  } else if (lineStart !== null && lineEnd === null) {
    // Insert at a specific line (no lines removed)
    const lines = oldContent.split("\n");
    const start = Math.max(0, Math.min(lineStart, lines.length));
    const replacementLines = (content ?? "").split("\n");

    lines.splice(start, 0, ...replacementLines);

    newContent = lines.join("\n");
  } else {
    // Full replacement (default behavior)
    newContent = content ?? "";
  }

  await assertNoteTextWithinLimit(newContent, userId);

  if (oldContent === newContent) {
    return { message: "No changes", Note: note };
  }

  // ── HOOKS (rewrite content, e.g. @mention canonicalization) ────────
  let finalContent = newContent;
  {
    const hookData = { nodeId: note.nodeId, content: newContent, userId, contentType: note.contentType, metadata: {} };
    await hooks.run("beforeNote", hookData);
    finalContent = hookData.content;
  }

  // ── SIZE DELTA ──────────────────────────────────
  const oldSizeKB = Math.ceil(Buffer.byteLength(oldContent, "utf8") / 1024);
  const newSizeKB = Math.ceil(
    Buffer.byteLength(finalContent || "", "utf8") / 1024,
  );
  const deltaKB = newSizeKB - oldSizeKB;

  // ── APPLY ───────────────────────────────────────
  note.content = finalContent;
  note.sizeKB = newSizeKB;

  await note.save();

  // Storage tracking (core concern)
  if (deltaKB !== 0) {
    User.findByIdAndUpdate(userId, { $inc: { "metadata.storage.usageKB": deltaKB } }).catch(() => {});
  }

  // afterNote hook (fire-and-forget)
  hooks.run("afterNote", { note, nodeId: note.nodeId, userId, contentType: note.contentType, sizeKB: newSizeKB, deltaKB, action: "edit" }).catch(() => {});

  // Cascade
  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(note.nodeId, { action: "note:edit", contentType: note.contentType, deltaKB, userId })
  ).catch(() => {});

  // ── LOG ─────────────────────────────────────────
  await logContribution({
    userId,
    nodeId: note.nodeId,
    wasAi,
    chatId,
    sessionId,
    action: "note",

    noteAction: {
      action: "edit",
      noteId: note._id.toString(),
      content: finalContent || "",
    },
  });

  return { message: "Note updated successfully", Note: note };
}

async function getNotes({ nodeId, limit, startDate, endDate }) {
  try {
    if (!nodeId) {
      throw new Error("Missing required parameter: nodeId");
    }

    if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
      throw new Error("Invalid limit: must be a positive number");
    }

    const query = { nodeId };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    let noteQuery = Note.find(query)
      .sort({ createdAt: -1 })
      .populate("userId", "username")
      .populate("nodeId")
      .lean();

    if (typeof limit === "number") {
      noteQuery = noteQuery.limit(limit);
    }

    const notes = await noteQuery;

    if (!notes || notes.length === 0) {
      return {
        message: `No notes found for node ${nodeId}`,
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
      metadata: note.metadata,
      createdAt: note.createdAt,
    }));

    return {
      message: "Notes retrieved successfully",
      notes: notesWithUsername,
    };
  } catch (err) {
    log.error("Notes", "getNotes:", err);

    throw new Error(
      err.message || "Database error occurred while retrieving notes.",
    );
  }
}

async function getAllNotesByUser(userId, limit, startDate, endDate) {
  if (!userId) {
    throw new Error("Missing required parameter: userId");
  }

  if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
    throw new Error("Invalid limit: must be a positive number");
  }

  const queryObj = { userId };

  if (startDate || endDate) {
    queryObj.createdAt = {};
    if (startDate) queryObj.createdAt.$gte = new Date(startDate);
    if (endDate) queryObj.createdAt.$lte = new Date(endDate);
  }

  let query = Note.find(queryObj).sort({ createdAt: -1 }).lean();

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const notes = await query;
  return { notes };
}

async function deleteNoteAndFile({
  noteId,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");

  const rootNode = await resolveRootNode(note.nodeId);

  const isAuthor = note.userId?.toString() === userId.toString();

  const isRootOwner = rootNode.rootOwner?.toString() === userId.toString();

  if (!isAuthor && !isRootOwner) {
    if (!note.userId) {
      throw new Error("This note has no author and cannot be deleted by you");
    }

    throw new Error(
      "Only the note author or the tree owner can delete this note",
    );
  }
  const fileOwnerId = note.userId?.toString();

  const { nodeId } = note; // original nodeId for logging
  let fileDeleted = false;
  let fileSizeKB = 0;

  // If it's a file, delete it and modify content
  if (note.contentType === CONTENT_TYPE.FILE && note.content) {
    const filePath = path.resolve(uploadsFolder, path.basename(note.content));

    if (filePath.startsWith(uploadsFolder) && fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        fileSizeKB = Math.ceil(stats.size / 1024);
        fs.unlinkSync(filePath);
        fileDeleted = true;
      } catch (fsErr) {
        if (fsErr.code === "ENOENT") {
          fileDeleted = true; // already gone, treat as success
        } else {
          log.warn("Notes", `File delete failed: ${fsErr.message}`);
        }
      }
    } else {
      log.warn("Notes", `File not found: ${filePath}`);
    }

    // update note fields
    note.content = "File was deleted";
    note.nodeId = DELETED;
    note.userId = DELETED;
  } else {
    // text note: keep content, just move nodeId
    note.nodeId = DELETED;
    note.userId = DELETED;
  }
  await note.save();

  // Storage tracking (core concern, decrement on file delete)
  if (fileDeleted && fileSizeKB > 0 && fileOwnerId && fileOwnerId !== DELETED) {
    User.findByIdAndUpdate(fileOwnerId, [
      { $set: { "metadata.storage.usageKB": { $max: [{ $subtract: [{ $ifNull: ["$metadata.storage.usageKB", 0] }, fileSizeKB] }, 0] } } },
    ]).catch(() => {});
  }

  // afterNote hook for delete (fire-and-forget)
  if (fileOwnerId && fileOwnerId !== DELETED) {
    hooks.run("afterNote", {
      note, nodeId, userId: fileOwnerId,
      contentType: note.contentType, fileSizeKB,
      action: "delete", fileDeleted,
    }).catch(() => {});

    // Cascade
    import("./cascade.js").then(({ checkCascade }) =>
      checkCascade(nodeId, { action: "note:delete", contentType: note.contentType, fileSizeKB, userId: fileOwnerId })
    ).catch(() => {});
  }

  await logContribution({
    userId,
    nodeId, // original nodeId
    wasAi,
    chatId,
    sessionId,
    action: "note",

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

function wordify(str) {
  return str
    .replace(/-/g, " ") // hyphen becomes space
    .replace(/[^\w\s]/g, "") // remove punctuation
    .trim();
}

async function searchNotesByUser({ userId, query, limit, startDate, endDate }) {
  if (!userId) throw new Error("Missing required parameter: userId");
  if (!query || typeof query !== "string") {
    throw new Error("Query must be a non-empty string");
  }

  let conditions = [];

  // --- 1. Exact phrase: "some phrase"
  const phraseMatch = query.match(/"(.*?)"/);
  if (phraseMatch) {
    const phrase = escapeRegex(phraseMatch[1]);
    conditions.push({
      content: new RegExp(phrase, "i"),
    });
  }

  // Remove the phrase part and split rest
  const cleaned = query.replace(/"(.*?)"/, "").trim();
  if (cleaned.length > 0) {
    // --- 2. Hyphen handling ---
    // Convert hyphens to separate words
    const processed = wordify(cleaned);
    const words = processed.split(/\s+/).filter(Boolean);

    for (const w of words) {
      const wEsc = escapeRegex(w);
      const regex = new RegExp(`\\b${wEsc}\\b`, "i");
      conditions.push({ content: regex });
    }
  }

  // --- 3. If query has a hyphen, allow exact hyphen match as backup ---
  if (query.includes("-")) {
    const escaped = escapeRegex(query);
    conditions.push({
      content: new RegExp(escaped, "i"),
    });
  }

  const mongoQueryObj = {
    userId,
    contentType: CONTENT_TYPE.TEXT,
    $and: conditions,
  };

  if (startDate || endDate) {
    mongoQueryObj.createdAt = {};
    if (startDate) mongoQueryObj.createdAt.$gte = new Date(startDate);
    if (endDate) mongoQueryObj.createdAt.$lte = new Date(endDate);
  }
  let mongoQuery = Note.find(mongoQueryObj).sort({ createdAt: -1 }).lean();

  if (limit && limit > 0) mongoQuery = mongoQuery.limit(limit);

  const notes = await mongoQuery;

  return {
    message: "Search completed",
    notes,
  };
}

async function collectSubtreeNodeIds(rootId) {
  const ids = [];
  const stack = [rootId];

  while (stack.length) {
    const currentId = stack.pop();
    ids.push(currentId);

    const node = await Node.findById(currentId, "children").lean();
    if (!node) continue;

    // push children in reverse so order is preserved
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
  }

  return ids;
}
function nodeMatchesStatus(node, filters) {
  const status = node.status || NODE_STATUS.ACTIVE;
  if (!status) return false;

  // DEFAULTS (only when no filters provided)
  if (!filters) {
    return status === NODE_STATUS.ACTIVE || status === NODE_STATUS.COMPLETED;
  }

  // EXPLICIT OVERRIDES
  if (filters[status] === true) return true;
  if (filters[status] === false) return false;

  // FALLBACK TO DEFAULTS
  return status === NODE_STATUS.ACTIVE || status === NODE_STATUS.COMPLETED;
}


async function transferNote({
  noteId,
  targetNodeId,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (!noteId || !targetNodeId || !userId) {
    throw new Error("Missing required fields: noteId, targetNodeId, userId");
  }

  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");

  if (note.nodeId === DELETED) {
    throw new Error("Cannot transfer a deleted note");
  }

  // Authorization: must be note author or tree owner
  const rootNode = await resolveRootNode(note.nodeId);
  const isAuthor = note.userId?.toString() === userId.toString();
  const isRootOwner = rootNode.rootOwner?.toString() === userId.toString();

  if (!isAuthor && !isRootOwner) {
    throw new Error(
      "Only the note author or the tree owner can transfer this note",
    );
  }

  // Verify target node exists and is in the same tree
  const targetNode = await Node.findById(targetNodeId)
    .select("_id metadata")
    .lean();
  if (!targetNode) throw new Error("Target node not found");

  const targetRoot = await resolveRootNode(targetNodeId);
  if (targetRoot._id.toString() !== rootNode._id.toString()) {
    throw new Error("Cannot transfer notes between different trees");
  }

  // Save original location for contribution logging
  const sourceNodeId = note.nodeId;

  // Move the note
  note.nodeId = targetNodeId;
  await note.save();

  // Log "remove" contribution on source node
  await logContribution({
    userId,
    nodeId: sourceNodeId,
    wasAi,
    chatId,
    sessionId,
    action: "note",

    noteAction: {
      action: "remove",
      noteId: noteId.toString(),
    },
  });

  // Log "add" contribution on target node
  await logContribution({
    userId,
    nodeId: targetNodeId,
    wasAi,
    chatId,
    sessionId,
    action: "note",

    noteAction: {
      action: "add",
      noteId: noteId.toString(),
      content: note.contentType === CONTENT_TYPE.TEXT ? note.content || "" : null,
    },
  });

  return {
    message: "Note transferred successfully",
    noteId: noteId.toString(),
    from: { nodeId: sourceNodeId },
    to: { nodeId: targetNodeId },
  };
}

async function getNoteEditHistory(noteId) {
  if (!noteId) throw new Error("Missing required parameter: noteId");

  const contributions = await Contribution.find({
    action: "note",
    "noteAction.noteId": noteId,
    "noteAction.action": { $in: ["add", "edit"] },
  })
    .populate("userId", "username")
    .sort({ date: 1 })
    .lean();

  return contributions.map((c) => ({
    _id: c._id,
    username: c.userId?.username ?? "Unknown",
    date: c.date,
    content: c.noteAction.content,
    action: c.noteAction.action,
  }));
}

export {
  createNote,
  editNote,
  getNotes,
  deleteNoteAndFile,
  transferNote,
  getAllNotesByUser,
  searchNotesByUser,
  collectSubtreeNodeIds,
  nodeMatchesStatus,
  getNoteEditHistory,
};
