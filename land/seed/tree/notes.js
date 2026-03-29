// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Note CRUD operations.
 *
 * Notes are content attached to nodes. Two content types: text and file.
 * beforeNote/afterNote hooks fire on every write. Extensions tag notes
 * via hookData.metadata (prestige writes version, treeos writes isReflection).
 *
 * File uploads stored in uploads/ directory. Soft-deleted notes have
 * nodeId and userId set to DELETED sentinel.
 */

import log from "../log.js";
import path from "path";
import fs from "fs";
import Note from "../models/note.js";
import User from "../models/user.js";
import Node from "../models/node.js";
import Contribution from "../models/contribution.js";
import { logContribution } from "./contributions.js";
import { escapeRegex } from "../utils.js";
import { hooks } from "../hooks.js";
import { getLandConfigValue } from "../landConfig.js";
import { fileURLToPath } from "url";
import { resolveRootNode } from "./treeFetch.js";
import { CONTENT_TYPE, DELETED, NODE_STATUS, ERR, ProtocolError } from "../protocol.js";
import { incUserMeta } from "./userMetadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIG (all readable via land .config node)
// ─────────────────────────────────────────────────────────────────────────

function noteMaxChars() { return Math.max(100, Number(getLandConfigValue("noteMaxChars")) || 5000); }
function maxNotesPerNode() { return Math.max(1, Number(getLandConfigValue("maxNotesPerNode")) || 1000); }
function noteQueryLimit() { return Math.max(1, Math.min(Number(getLandConfigValue("noteQueryLimit")) || 5000, 50000)); }
function searchQueryLimit() { return Math.max(1, Math.min(Number(getLandConfigValue("noteSearchLimit")) || 500, 10000)); }
function subtreeNodeCap() { return Math.max(100, Math.min(Number(getLandConfigValue("subtreeNodeCap")) || 10000, 100000)); }

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

async function assertNoteTextWithinLimit(content, userId) {
  if (!content) return;
  if (userId) {
    const user = await User.findById(userId).select("isAdmin").lean();
    if (user?.isAdmin) return;
  }
  const max = noteMaxChars();
  if (content.length > max) {
    throw new Error(`Note exceeds maximum length of ${max} characters`);
  }
}

function validateDateRange(startDate, endDate) {
  if (!startDate && !endDate) return {};
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;
  if (startDate && isNaN(start)) throw new Error("Invalid startDate format");
  if (endDate && isNaN(end)) throw new Error("Invalid endDate format");
  if (!isNaN(start) && !isNaN(end) && end < start) throw new Error("endDate must be after startDate");
  if (!isNaN(start) && !isNaN(end) && (end - start) > 365 * 24 * 60 * 60 * 1000) {
    throw new Error("Date range cannot exceed 365 days");
  }
  const range = {};
  if (!isNaN(start)) range.$gte = new Date(start);
  if (!isNaN(end)) range.$lte = new Date(end);
  return Object.keys(range).length > 0 ? { createdAt: range } : {};
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────

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

  const targetNode = await Node.findOne({
    _id: nodeId,
    parent: { $exists: true, $ne: null },
  }).select("systemRole parent").lean();
  if (!targetNode) throw new Error("Node not found or deleted");
  if (targetNode.systemRole) throw new Error("Cannot modify system nodes");

  const max = maxNotesPerNode();
  const count = await Note.countDocuments({ nodeId });
  if (count >= max) {
    throw new Error(`Node has reached the maximum of ${max} notes. Delete old notes before adding new ones.`);
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

  // Storage tracking
  const sizeKB = contentType === CONTENT_TYPE.FILE && file
    ? Math.ceil(file.size / 1024)
    : Math.ceil(Buffer.byteLength(finalContent || "", "utf8") / 1024);
  if (sizeKB > 0) {
    incUserMeta(userId, "storage", "usageKB", sizeKB).catch(() => {});
  }

  hooks.run("afterNote", { note: newNote, nodeId, userId, contentType, sizeKB, action: "create" }).catch(() => {});

  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(nodeId, { action: "note:create", contentType, sizeKB, userId })
  ).catch(() => {});

  await logContribution({
    userId, nodeId, wasAi, chatId, sessionId,
    action: "note",
    noteAction: { action: "add", noteId: newNote._id.toString(), content: contentType === CONTENT_TYPE.TEXT ? finalContent || "" : null },
  });

  return { message: "Note created successfully", Note: newNote };
}

// ─────────────────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────────────────

async function editNote({
  noteId, content, userId,
  lineStart = null, lineEnd = null,
  wasAi = false, chatId = null, sessionId = null,
}) {
  if (!noteId || !userId) throw new Error("Missing required fields");

  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");
  if (note.userId.toString() !== userId.toString()) throw new Error("Unauthorized");
  if (note.contentType !== CONTENT_TYPE.TEXT) throw new Error("File notes cannot be edited");

  const oldContent = note.content || "";
  let newContent;

  if (lineStart !== null && lineEnd !== null) {
    const lines = oldContent.split("\n");
    const start = Math.max(0, lineStart);
    const end = Math.min(lines.length, lineEnd);
    if (start > end) throw new Error(`Invalid line range: ${start}-${end}`);
    lines.splice(start, end - start, ...(content ?? "").split("\n"));
    newContent = lines.join("\n");
  } else if (lineStart !== null && lineEnd === null) {
    const lines = oldContent.split("\n");
    const start = Math.max(0, Math.min(lineStart, lines.length));
    lines.splice(start, 0, ...(content ?? "").split("\n"));
    newContent = lines.join("\n");
  } else {
    newContent = content ?? "";
  }

  await assertNoteTextWithinLimit(newContent, userId);

  if (oldContent === newContent) {
    return { message: "No changes", Note: note };
  }

  let finalContent = newContent;
  {
    const hookData = { nodeId: note.nodeId, content: newContent, userId, contentType: note.contentType, metadata: {} };
    await hooks.run("beforeNote", hookData);
    finalContent = hookData.content;
  }

  const oldSizeKB = Math.ceil(Buffer.byteLength(oldContent, "utf8") / 1024);
  const newSizeKB = Math.ceil(Buffer.byteLength(finalContent || "", "utf8") / 1024);
  const deltaKB = newSizeKB - oldSizeKB;

  note.content = finalContent;
  await note.save();

  if (deltaKB !== 0) {
    incUserMeta(userId, "storage", "usageKB", deltaKB).catch(() => {});
  }

  hooks.run("afterNote", { note, nodeId: note.nodeId, userId, contentType: note.contentType, sizeKB: newSizeKB, deltaKB, action: "edit" }).catch(() => {});

  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(note.nodeId, { action: "note:edit", contentType: note.contentType, deltaKB, userId })
  ).catch(() => {});

  await logContribution({
    userId, nodeId: note.nodeId, wasAi, chatId, sessionId,
    action: "note",
    noteAction: { action: "edit", noteId: note._id.toString(), content: finalContent || "" },
  });

  return { message: "Note updated successfully", Note: note };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

async function getNotes({ nodeId, limit, offset, startDate, endDate }) {
  if (!nodeId) throw new Error("Missing required parameter: nodeId");

  const query = { nodeId, ...validateDateRange(startDate, endDate) };
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), noteQueryLimit());
  const safeOffset = Math.max(0, Number(offset) || 0);

  const notes = await Note.find(query)
    .sort({ createdAt: -1 })
    .populate("userId", "username")
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return {
    message: notes.length > 0 ? "Notes retrieved successfully" : `No notes found for node ${nodeId}`,
    notes: notes.map(note => ({
      _id: note._id,
      contentType: note.contentType,
      content: note.content,
      username: note.userId ? note.userId.username : null,
      userId: note.userId?._id?.toString(),
      nodeId: note.nodeId,
      metadata: note.metadata,
      createdAt: note.createdAt,
    })),
  };
}

async function getAllNotesByUser(userId, limit, startDate, endDate) {
  if (!userId) throw new Error("Missing required parameter: userId");

  const query = { userId, ...validateDateRange(startDate, endDate) };
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), noteQueryLimit());

  const notes = await Note.find(query)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return { notes };
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────

async function deleteNoteAndFile({
  noteId, userId,
  wasAi = false, chatId = null, sessionId = null,
}) {
  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");

  const rootNode = await resolveRootNode(note.nodeId);
  const isAuthor = note.userId?.toString() === userId.toString();
  const isRootOwner = rootNode.rootOwner?.toString() === userId.toString();

  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the note author or the tree owner can delete this note");
  }

  const fileOwnerId = note.userId?.toString();
  const { nodeId } = note;
  let fileDeleted = false;
  let fileSizeKB = 0;

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
          fileDeleted = true;
        } else {
          log.warn("Notes", `File delete failed: ${fsErr.message}`);
        }
      }
    }
    note.content = "File was deleted";
    note.nodeId = DELETED;
    note.userId = DELETED;
  } else {
    note.nodeId = DELETED;
    note.userId = DELETED;
  }
  await note.save();

  if (fileDeleted && fileSizeKB > 0 && fileOwnerId && fileOwnerId !== DELETED) {
    incUserMeta(fileOwnerId, "storage", "usageKB", -fileSizeKB).catch(() => {});
  }

  if (fileOwnerId && fileOwnerId !== DELETED) {
    hooks.run("afterNote", {
      note, nodeId, userId: fileOwnerId,
      contentType: note.contentType, fileSizeKB,
      action: "delete", fileDeleted,
    }).catch(() => {});

    import("./cascade.js").then(({ checkCascade }) =>
      checkCascade(nodeId, { action: "note:delete", contentType: note.contentType, fileSizeKB, userId: fileOwnerId })
    ).catch(() => {});
  }

  await logContribution({
    userId, nodeId, wasAi, chatId, sessionId,
    action: "note",
    noteAction: { action: "remove", noteId: noteId.toString(), fileDeleted: fileDeleted || undefined },
  });

  return {
    message: fileDeleted
      ? "File note removed and file deleted."
      : "Text note removed and moved to deleted.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────

function wordify(str) {
  return str.replace(/-/g, " ").replace(/[^\w\s]/g, "").trim();
}

async function searchNotesByUser({ userId, query, limit, startDate, endDate }) {
  if (!userId) throw new Error("Missing required parameter: userId");
  if (!query || typeof query !== "string") throw new Error("Query must be a non-empty string");

  const conditions = [];

  const phraseMatch = query.match(/"(.*?)"/);
  if (phraseMatch) {
    conditions.push({ content: new RegExp(escapeRegex(phraseMatch[1]), "i") });
  }

  const cleaned = query.replace(/"(.*?)"/, "").trim();
  if (cleaned.length > 0) {
    const words = wordify(cleaned).split(/\s+/).filter(Boolean);
    for (const w of words) {
      conditions.push({ content: new RegExp(`\\b${escapeRegex(w)}\\b`, "i") });
    }
  }

  if (query.includes("-")) {
    conditions.push({ content: new RegExp(escapeRegex(query), "i") });
  }

  if (conditions.length === 0) {
    return { message: "Search completed", notes: [] };
  }

  const mongoQuery = {
    userId,
    contentType: CONTENT_TYPE.TEXT,
    $and: conditions,
    ...validateDateRange(startDate, endDate),
  };

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), searchQueryLimit());

  const notes = await Note.find(mongoQuery).sort({ createdAt: -1 }).limit(safeLimit).lean();
  return { message: "Search completed", notes };
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

async function collectSubtreeNodeIds(rootId) {
  const ids = [];
  const stack = [rootId];
  const cap = subtreeNodeCap();

  while (stack.length && ids.length < cap) {
    const currentId = stack.pop();
    ids.push(currentId);

    const node = await Node.findById(currentId, "children").lean();
    if (!node) continue;

    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
  }

  if (ids.length >= cap) {
    log.warn("Notes", `collectSubtreeNodeIds capped at ${cap} for root ${rootId}`);
  }

  return ids;
}

function nodeMatchesStatus(node, filters) {
  const status = node.status || NODE_STATUS.ACTIVE;
  if (!status) return false;
  if (!filters) return status === NODE_STATUS.ACTIVE || status === NODE_STATUS.COMPLETED;
  if (filters[status] === true) return true;
  if (filters[status] === false) return false;
  return status === NODE_STATUS.ACTIVE || status === NODE_STATUS.COMPLETED;
}

async function transferNote({
  noteId, targetNodeId, userId,
  wasAi = false, chatId = null, sessionId = null,
}) {
  if (!noteId || !targetNodeId || !userId) {
    throw new Error("Missing required fields: noteId, targetNodeId, userId");
  }

  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");
  if (note.nodeId === DELETED) throw new Error("Cannot transfer a deleted note");

  const rootNode = await resolveRootNode(note.nodeId);
  const isAuthor = note.userId?.toString() === userId.toString();
  const isRootOwner = rootNode.rootOwner?.toString() === userId.toString();
  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the note author or the tree owner can transfer this note");
  }

  const targetNode = await Node.findById(targetNodeId).select("_id").lean();
  if (!targetNode) throw new Error("Target node not found");

  const targetRoot = await resolveRootNode(targetNodeId);
  if (targetRoot._id.toString() !== rootNode._id.toString()) {
    throw new Error("Cannot transfer notes between different trees");
  }

  const sourceNodeId = note.nodeId;
  note.nodeId = targetNodeId;
  await note.save();

  await logContribution({
    userId, nodeId: sourceNodeId, wasAi, chatId, sessionId,
    action: "note",
    noteAction: { action: "remove", noteId: noteId.toString() },
  });

  await logContribution({
    userId, nodeId: targetNodeId, wasAi, chatId, sessionId,
    action: "note",
    noteAction: { action: "add", noteId: noteId.toString(), content: note.contentType === CONTENT_TYPE.TEXT ? note.content || "" : null },
  });

  return { message: "Note transferred successfully", noteId: noteId.toString(), from: { nodeId: sourceNodeId }, to: { nodeId: targetNodeId } };
}

async function getNoteEditHistory(noteId, limit = 100, offset = 0) {
  if (!noteId) throw new Error("Missing required parameter: noteId");

  const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 1000);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const contributions = await Contribution.find({
    action: "note",
    "noteAction.noteId": noteId,
    "noteAction.action": { $in: ["add", "edit"] },
  })
    .populate("userId", "username")
    .sort({ date: 1 })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return contributions.map(c => ({
    _id: c._id,
    username: c.userId?.username ?? "Unknown",
    date: c.date,
    content: c.noteAction.content,
    action: c.noteAction.action,
  }));
}

export {
  createNote, editNote, getNotes, deleteNoteAndFile,
  transferNote, getAllNotesByUser, searchNotesByUser,
  collectSubtreeNodeIds, nodeMatchesStatus, getNoteEditHistory,
  assertNoteTextWithinLimit,
};
