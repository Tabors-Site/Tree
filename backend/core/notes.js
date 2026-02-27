import path from "path";
import fs from "fs";
import Note from "../db/models/notes.js";
import User from "../db/models/user.js";
import Node from "../db/models/node.js";
import Book from "../db/models/book.js";

import crypto from "crypto";

function hashBookSettings(settings) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(settings))
    .digest("hex");
}

import Contribution from "../db/models/contribution.js";
import { logContribution } from "../db/utils.js";
import { fileURLToPath } from "url";
import { resolveRootNode } from "./treeFetch.js";
import { useEnergy } from "../core/energy.js";

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

export function assertNoteTextWithinLimit(content) {
  if (!content) return;

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
  } else {
    // ⬅️ ADD HERE
    assertNoteTextWithinLimit(content || "");
  }

  // ── ENERGY ──────────────────────────────────────
  let payload;
  if (contentType === "file") {
    payload = { type: "file", sizeMB: Math.ceil(file.size / (1024 * 1024)) };
  } else {
    payload = (content || "").length; // char count for text scaling
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

  // ── STORAGE ─────────────────────────────────────
  if (contentType === "file" && file?.size) {
    const sizeKB = Math.ceil(file.size / 1024);
    await User.findByIdAndUpdate(userId, { $inc: { storageUsage: sizeKB } });
  }

  if (contentType === "text" && finalContent) {
    const sizeKB = Math.ceil(Buffer.byteLength(finalContent, "utf8") / 1024);
    if (sizeKB > 0) {
      await User.findByIdAndUpdate(userId, { $inc: { storageUsage: sizeKB } });
    }
  }

  // ── LOG ─────────────────────────────────────────
  await logContribution({
    userId,
    nodeId,
    wasAi,
    action: "note",
    nodeVersion: version,
    noteAction: { action: "add", noteId: newNote._id.toString(), content: contentType === "text" ? (finalContent || "") : null },
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

  assertNoteTextWithinLimit(newContent);

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
    await User.findByIdAndUpdate(userId, { $inc: { storageUsage: deltaKB } });
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
    action: "note",
    nodeVersion: note.version,
    noteAction: { action: "edit", noteId: note._id.toString(), content: finalContent || "" },
    energyUsed,
  });

  return { message: "Note updated successfully", Note: note, energyUsed };
}

async function getNotes({ nodeId, version, limit, startDate, endDate }) {
  try {
    if (!nodeId) {
      throw new Error("Missing required parameter: nodeId");
    }

    if (typeof version !== "number" || isNaN(version)) {
      throw new Error("Invalid or missing version: must be a number");
    }

    if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
      throw new Error("Invalid limit: must be a positive number");
    }

    const query = { nodeId, version };

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
    console.error("Error in getNotes:", err);

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

async function deleteNoteAndFile({ noteId, userId, wasAi = false }) {
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
      console.log(`File not found: ${filePath}`);
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
      console.error("Storage update failed", {
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
  const currentVersion = node.versions?.find(
    (v) => v.prestige === node.prestige,
  );

  const status = currentVersion?.status;
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

async function getBook({ nodeId, options = {} }) {
  if (!nodeId) throw new Error("Missing nodeId");

  const flags = {
    latestVersionOnly: false,
    lastNoteOnly: false,
    leafNotesOnly: false,
    filesOnly: false,
    textOnly: false,
    statusFilters: null,

    ...options, // ← opt-in only
  };

  //prevent glitches when both true
  if (flags.filesOnly && flags.textOnly) {
    flags.filesOnly = false;
    flags.textOnly = false;
  }

  // 1. collect subtree ids
  const subtreeIds = await collectSubtreeNodeIds(nodeId);

  // 2. load subtree nodes + notes
  const [nodes, notes] = await Promise.all([
    Node.find({ _id: { $in: subtreeIds } }).lean(),
    Note.find({ nodeId: { $in: subtreeIds } }).lean(),
  ]);

  // 3. build maps
  const nodeMap = new Map(nodes.map((n) => [n._id.toString(), n]));

  const notesByNode = new Map();
  for (const n of notes) {
    const key = n.nodeId.toString();
    if (!notesByNode.has(key)) notesByNode.set(key, []);
    notesByNode.get(key).push(n);
  }

  // 4. build tree
  const book = buildBookTree(
    nodeMap.get(nodeId.toString()),
    nodeMap,
    notesByNode,
    flags,
  );
  return {
    message: "Book generated successfully",
    book,
  };
}
function applyNoteFilters(notes, node, flags) {
  let result = notes;
  if (flags.latestVersionOnly && result.length > 0) {
    const maxVersion = Math.max(
      ...result.map((n) => Number(n.version)).filter((v) => !Number.isNaN(v)),
    );

    result = result.filter((n) => Number(n.version) === maxVersion);
  }

  if (flags.filesOnly) {
    result = result.filter((n) => n.contentType === "file");
  }

  if (flags.textOnly) {
    result = result.filter((n) => n.contentType === "text");
  }

  if (flags.lastNoteOnly) {
    result = result.length ? [result[result.length - 1]] : [];
  }

  return result;
}

function buildBookTree(node, nodeMap, notesByNode, flags = {}) {
  const nodeId = node._id.toString();

  // 🔴 STATUS FILTER CHECK
  const filteredChildren = [];

  for (const childId of node.children || []) {
    const child = nodeMap.get(childId.toString());
    if (!child) continue;

    const childTree = buildBookTree(child, nodeMap, notesByNode, flags);
    if (childTree) filteredChildren.push(childTree);
  }

  const nodePassesStatus = nodeMatchesStatus(node, flags.statusFilters);

  // If node fails AND has no surviving children → prune
  if (!nodePassesStatus && filteredChildren.length === 0) {
    return null;
  }

  // Notes logic (unchanged)
  const rawNotes = notesByNode.get(nodeId) || [];
  const filteredNotes = applyNoteFilters(rawNotes, node, flags).map((n) => ({
    noteId: n._id.toString(),
    version: n.version,
    userId: n.userId?.toString(),
    content: n.content,
    type: n.contentType,
  }));

  const isLeaf = filteredChildren.length === 0;
  const notes = flags.leafNotesOnly && !isLeaf ? [] : filteredNotes;

  return {
    nodeId,
    nodeName: node.name,
    notes,
    children: filteredChildren,
  };
}
function normalizeBookSettings(raw = {}) {
  return {
    latestVersionOnly: !!raw.latestVersionOnly,
    lastNoteOnly: !!raw.lastNoteOnly,
    leafNotesOnly: !!raw.leafNotesOnly,
    filesOnly: !!raw.filesOnly,
    textOnly: !!raw.textOnly,

    active: !!raw.active,
    completed: !!raw.completed,
    true: !!raw["true"],
  };
}
async function generateBook({ nodeId, settings, userId }) {
  if (!nodeId) {
    throw new Error("Missing nodeId");
  }
  // 1. normalize + hash
  const normalizedSettings = normalizeBookSettings(settings);
  const settingsHash = hashBookSettings(normalizedSettings);

  // 2. check for existing book
  let book = await Book.findOne({
    nodeId,
    settingsHash,
  });

  if (book) {
    return {
      shareId: book.shareId,
    };
  }

  // 3. create new book
  const shareId = crypto.randomBytes(8).toString("hex");

  book = await Book.create({
    nodeId,
    settings: normalizedSettings,
    settingsHash,
    shareId,
    createdBy: userId,
  });

  return {
    reused: false,
    shareId,
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
  getAllNotesByUser,
  getAllTagsForUser,
  searchNotesByUser,
  getBook,
  generateBook,
  getNoteEditHistory,
};
