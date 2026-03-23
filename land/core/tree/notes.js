import log from "../log.js";
import path from "path";
import fs from "fs";
import Note from "../../db/models/notes.js";
import User from "../../db/models/user.js";
import Node from "../../db/models/node.js";
import crypto from "crypto";

import Contribution from "../../db/models/contribution.js";
import { logContribution } from "../../db/utils.js";
import { hooks } from "../hooks.js";
import { fileURLToPath } from "url";
import { resolveRootNode } from "./treeFetch.js";
// Energy: dynamic import, no-op if extension not installed
let useEnergy = async () => ({ energyUsed: 0 });
try { ({ useEnergy } = await import("../../extensions/energy/core.js")); } catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../uploads");

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

async function extractTaggedUsersAndRewrite(content) {
  const mentionRegex = /@([\w-]+)/g;
  const matches = [...content.matchAll(mentionRegex)];

  if (matches.length === 0) {
    return { tagged: [], rewrittenContent: content };
  }

  // normalize mentions to lowercase
  const identifiers = matches.map((m) => m[1].toLowerCase());

  // fetch all users once
  const users = await User.find({
    username: { $in: identifiers },
  }).collation({ locale: "en", strength: 2 }); // case-insensitive

  // build lookup maps
  const usernameToUser = {};
  users.forEach((u) => {
    usernameToUser[u.username.toLowerCase()] = u;
  });

  const taggedUserIds = [...new Set(users.map((u) => u._id.toString()))];

  // rewrite mentions using canonical username
  const rewrittenContent = content.replace(mentionRegex, (full, raw) => {
    const user = usernameToUser[raw.toLowerCase()];
    if (!user) return full;
    return `@${user.username}`;
  });

  return {
    tagged: taggedUserIds,
    rewrittenContent,
  };
}
export const NOTE_TEXT_MAX_CHARS = 5000;

export async function assertNoteTextWithinLimit(content, userId) {
  if (!content) return;

  if (userId) {
    const user = await User.findById(userId).select("profileType").lean();
    if (user?.profileType === "god") return;
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
  version,
  isReflection,
  file,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  if (!contentType || !["file", "text"].includes(contentType)) {
    throw new Error("Invalid content type");
  }
  if (!userId || !nodeId) {
    throw new Error("Missing required fields");
  }

  const targetNode = await Node.findById(nodeId).select("isSystem").lean();
  if (targetNode?.isSystem) throw new Error("Cannot modify system nodes");

  let filePath = null;
  if (contentType === "file") {
    if (!file) throw new Error("File is required for file content type");
    filePath = file.filename;
  } else {
    // ⬅️ ADD HERE
    await assertNoteTextWithinLimit(content || "", userId);
  }

  // ── ENERGY ──────────────────────────────────────
  let payload;
  if (contentType === "file") {
    payload = { type: "file", sizeMB: Math.ceil(file.size / (1024 * 1024)) };
  } else {
    payload = (content || "").length;
  }

  const { energyUsed } = await useEnergy({
    userId,
    action: "note",
    payload,
    file,
  });

  // ── TAG EXTRACTION ──────────────────────────────
  const isReflectionBool = isReflection === "true" || isReflection === true;
  let taggedUserIds = [];
  let finalContent = content;

  if (contentType === "text" && content) {
    const { tagged, rewrittenContent } =
      await extractTaggedUsersAndRewrite(content);
    taggedUserIds = tagged;
    finalContent = rewrittenContent;
  }

  // ── HOOKS ────────────────────────────────────────
  const hookData = { nodeId, version, content: finalContent, userId, contentType };
  const hookResult = await hooks.run("beforeNote", hookData);
  if (hookResult.cancelled) return { error: hookResult.reason || "Note creation cancelled by extension" };
  // Extensions may have modified version (e.g. prestige sets it to current level)
  version = hookData.version;

  // ── SAVE ────────────────────────────────────────
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

  // afterNote hook (fire-and-forget)
  hooks.run("afterNote", { note: newNote, nodeId, userId }).catch(() => {});

  // ── STORAGE ─────────────────────────────────────
  if (contentType === "file" && file?.size) {
    const sizeKB = Math.ceil(file.size / 1024);
    await User.findByIdAndUpdate(userId, { $inc: { "metadata.energy.storageUsage": sizeKB } });
  }

  if (contentType === "text" && finalContent) {
    const sizeKB = Math.ceil(Buffer.byteLength(finalContent, "utf8") / 1024);
    if (sizeKB > 0) {
      await User.findByIdAndUpdate(userId, { $inc: { "metadata.energy.storageUsage": sizeKB } });
    }
  }

  // ── LOG ─────────────────────────────────────────
  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "note",
    nodeVersion: version,
    noteAction: {
      action: "add",
      noteId: newNote._id.toString(),
      content: contentType === "text" ? finalContent || "" : null,
    },
    energyUsed,
  });

  return { message: "Note created successfully", Note: newNote, energyUsed };
}

// services/editNote.js
// Updated with line-range editing support

async function editNote({
  noteId,
  content,
  userId,
  lineStart = null,
  lineEnd = null,
  wasAi = false,
  isReflection = false,
  aiChatId = null,
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

  if (note.contentType !== "text") {
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
    return {
      message: "No changes",
      Note: note,
      energyUsed: 0,
    };
  }

  // ── ENERGY — charge on net growth using same formula as create ──
  const oldChars = oldContent.length;
  const newChars = newContent.length;
  const deltaChars = Math.max(0, newChars - oldChars);

  let energyUsed = 0;

  if (deltaChars > 0) {
    const energyResult = await useEnergy({
      userId,
      action: "note",
      payload: deltaChars,
    });
    energyUsed = energyResult.energyUsed;
  }

  // ── TAG EXTRACTION ──────────────────────────────
  let finalContent = newContent;
  let taggedUserIds = [];

  if (newContent) {
    const { tagged, rewrittenContent } =
      await extractTaggedUsersAndRewrite(newContent);
    taggedUserIds = tagged;
    finalContent = rewrittenContent;
  }

  // ── STORAGE DELTA ───────────────────────────────
  const oldSizeKB = Math.ceil(Buffer.byteLength(oldContent, "utf8") / 1024);
  const newSizeKB = Math.ceil(
    Buffer.byteLength(finalContent || "", "utf8") / 1024,
  );
  const deltaKB = newSizeKB - oldSizeKB;

  if (deltaKB !== 0) {
    await User.findByIdAndUpdate(userId, { $inc: { "metadata.energy.storageUsage": deltaKB } });
  }

  // ── APPLY ───────────────────────────────────────
  note.content = finalContent;
  note.tagged = taggedUserIds;
  note.isReflection = isReflection === "true" || isReflection === true;
  note.sizeKB = newSizeKB;

  await note.save();

  // ── LOG ─────────────────────────────────────────
  await logContribution({
    userId,
    nodeId: note.nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "note",
    nodeVersion: note.version,
    noteAction: {
      action: "edit",
      noteId: note._id.toString(),
      content: finalContent || "",
    },
    energyUsed,
  });

  return { message: "Note updated successfully", Note: note, energyUsed };
}

async function getNotes({ nodeId, version, limit, startDate, endDate }) {
  try {
    if (!nodeId) {
      throw new Error("Missing required parameter: nodeId");
    }

    if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
      throw new Error("Invalid limit: must be a positive number");
    }

    const query = { nodeId };
    // Only filter by version if explicitly provided (prestige extension sets this)
    if (version !== undefined && version !== null) {
      query.version = version;
    }

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

async function getAllTagsForUser(userId, limit, startDate, endDate) {
  if (!userId) {
    throw new Error("Missing required parameter: userId");
  }

  if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
    throw new Error("Invalid limit: must be a positive number");
  }

  const queryObj = { tagged: userId };

  if (startDate || endDate) {
    queryObj.createdAt = {};
    if (startDate) queryObj.createdAt.$gte = new Date(startDate);
    if (endDate) queryObj.createdAt.$lte = new Date(endDate);
  }

  let query = Note.find(queryObj)
    .populate("userId", "username") // author
    .sort({ createdAt: -1 })
    .lean();

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const notes = await query;

  const notesWithTaggedBy = notes.map((n) => ({
    ...n,
    authorId: n.userId?._id?.toString(),
    authorUsername: n.userId?.username,
    taggedBy: n.userId?._id?.toString(), // user who wrote the note
  }));

  return { notes: notesWithTaggedBy };
}

async function deleteNoteAndFile({
  noteId,
  userId,
  wasAi = false,
  aiChatId = null,
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
  let energyUsed = null;

  if (note.contentType === "text") {
    const energyResult = await useEnergy({
      userId,
      action: "removeNote",
    });
    energyUsed = energyResult.energyUsed;
  }
  const fileOwnerId = note.userId?.toString();

  const { nodeId, version } = note; // original nodeId for logging
  let fileDeleted = false;
  let fileSizeKB = 0;

  // If it's a file, delete it and modify content
  if (note.contentType === "file" && note.content) {
    const filePath = path.join(uploadsFolder, note.content);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      fileSizeKB = Math.ceil(stats.size / 1024);
      fs.unlinkSync(filePath);
      fileDeleted = true;
    } else {
      log.warn("Notes", `File not found: ${filePath}`);
    }

    // update note fields
    note.content = "File was deleted";
    note.nodeId = "deleted";
    note.userId = "deleted";
  } else {
    // text note: keep content, just move nodeId
    note.nodeId = "deleted";
    note.userId = "deleted";
  }
  note.tagged = [];

  await note.save();

  if (
    fileDeleted &&
    fileSizeKB > 0 &&
    fileOwnerId &&
    fileOwnerId !== "deleted"
  ) {
    try {
      await User.findByIdAndUpdate(fileOwnerId, [
        {
          $set: {
            storageUsage: {
              $max: [{ $subtract: ["$storageUsage", fileSizeKB] }, 0],
            },
          },
        },
      ]);
    } catch (err) {
      log.error("Notes", "Storage update failed", {
        fileOwnerId,
        fileSizeKB,
        noteId,
      });
    }
  }

  await logContribution({
    userId,
    nodeId, // original nodeId
    wasAi,
    aiChatId,
    sessionId,
    action: "note",
    nodeVersion: version,
    noteAction: {
      action: "remove",
      noteId: noteId.toString(),
      fileDeleted: fileDeleted || undefined,
    },
    energyUsed,
  });

  return {
    message: fileDeleted
      ? "File note removed and file deleted."
      : "Text note removed and moved to deleted.",
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    contentType: "text",
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
  const status = node.status || "active";
  if (!status) return false;

  // ✅ DEFAULTS (only when no filters provided)
  if (!filters) {
    return status === "active" || status === "completed";
  }

  // ✅ EXPLICIT OVERRIDES
  if (filters[status] === true) return true;
  if (filters[status] === false) return false;

  // ✅ FALLBACK TO DEFAULTS
  return status === "active" || status === "completed";
}


async function transferNote({
  noteId,
  targetNodeId,
  userId,
  prestige = null,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  if (!noteId || !targetNodeId || !userId) {
    throw new Error("Missing required fields: noteId, targetNodeId, userId");
  }

  const note = await Note.findById(noteId);
  if (!note) throw new Error("Note not found");

  if (note.nodeId === "deleted") {
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
    .select("_id prestige")
    .lean();
  if (!targetNode) throw new Error("Target node not found");

  const targetRoot = await resolveRootNode(targetNodeId);
  if (targetRoot._id.toString() !== rootNode._id.toString()) {
    throw new Error("Cannot transfer notes between different trees");
  }

  // Resolve target version
  let targetVersion;
  if (typeof prestige === "number" && prestige >= 0) {
    targetVersion = prestige;
  } else {
    targetVersion = targetNode.prestige ?? 0;
  }

  // Save original location for contribution logging
  const sourceNodeId = note.nodeId;
  const sourceVersion = note.version;

  // Move the note
  note.nodeId = targetNodeId;
  note.version = String(targetVersion);
  await note.save();

  // Log "remove" contribution on source node
  await logContribution({
    userId,
    nodeId: sourceNodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "note",
    nodeVersion: Number(sourceVersion),
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
    aiChatId,
    sessionId,
    action: "note",
    nodeVersion: targetVersion,
    noteAction: {
      action: "add",
      noteId: noteId.toString(),
      content: note.contentType === "text" ? note.content || "" : null,
    },
  });

  return {
    message: "Note transferred successfully",
    noteId: noteId.toString(),
    from: { nodeId: sourceNodeId, version: Number(sourceVersion) },
    to: { nodeId: targetNodeId, version: targetVersion },
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
  getAllTagsForUser,
  searchNotesByUser,
  collectSubtreeNodeIds,
  nodeMatchesStatus,
  getNoteEditHistory,
};
