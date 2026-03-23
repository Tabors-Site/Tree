import path from "path";
import fs from "fs";
import RawIdea from "./model.js";
import Node from "../../db/models/node.js";
import Note from "../../db/models/notes.js";
import User from "../../db/models/user.js";
import { logContribution } from "../../db/utils.js";
let useEnergy = async () => ({ energyUsed: 0 });
try { ({ useEnergy } = await import("../energy/core.js")); } catch {}

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../../uploads");

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

const NOTE_TEXT_MAX_CHARS = 5000;

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

async function createRawIdea({
  contentType,
  content,
  userId,
  file,
  wasAi = false,
}) {
  if (!contentType || !["file", "text"].includes(contentType)) {
    throw new Error("Invalid content type");
  }

  if (!userId) {
    throw new Error("Missing required field: userId");
  }

  let finalContent = content;
  let taggedUserIds = [];

  // ── FILE ───────────────────────────────────────
  if (contentType === "file") {
    if (!file) throw new Error("File is required for file content type");
    finalContent = file.filename;
  }

  // ── TEXT ───────────────────────────────────────
  if (contentType === "text") {
    if (!content || typeof content !== "string") {
      throw new Error("Content is required for text content type");
    }

    const { tagged, rewrittenContent } =
      await extractTaggedUsersAndRewrite(content);

    taggedUserIds = tagged;
    finalContent = rewrittenContent;
    await assertNoteTextWithinLimit(rewrittenContent, userId);
  }

  // ── ENERGY ─────────────────────────────────────
  let payload;
  if (contentType === "file") {
    payload = { type: "file", sizeMB: Math.ceil(file.size / (1024 * 1024)) };
  } else {
    payload = content.length;
  }

  const { energyUsed } = await useEnergy({
    userId,
    action: "rawIdea",
    payload,
    file,
  });

  // ── SAVE ───────────────────────────────────────
  const rawIdea = new RawIdea({
    contentType,
    content: finalContent,
    userId,
    tagged: taggedUserIds,
  });

  await rawIdea.save();

  // ── STORAGE ────────────────────────────────────
  if (contentType === "file" && file?.size) {
    const sizeKB = Math.ceil(file.size / 1024);
    await User.findByIdAndUpdate(userId, {
      $inc: { storageUsage: sizeKB },
    });
  }

  if (contentType === "text" && finalContent) {
    const sizeKB = Math.ceil(Buffer.byteLength(finalContent, "utf8") / 1024);
    if (sizeKB > 0) {
      await User.findByIdAndUpdate(userId, {
        $inc: { storageUsage: sizeKB },
      });
    }
  }

  // ── LOG ────────────────────────────────────────
  await logContribution({
    userId,
    nodeId: "deleted",
    wasAi,
    action: "rawIdea",
    nodeVersion: "0",
    rawIdeaAction: {
      action: "add",
      rawIdeaId: rawIdea._id.toString(),
    },
    energyUsed,
  });

  return {
    message: "Raw idea captured",
    rawIdea,
    energyUsed,
  };
}

async function convertRawIdeaToNote({
  rawIdeaId,
  userId,
  nodeId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  if (!rawIdeaId || !userId || !nodeId) {
    throw new Error("Missing or invalid required fields");
  }

  // 1️⃣ Load raw idea
  const rawIdea = await RawIdea.findById(rawIdeaId);
  if (!rawIdea) {
    throw new Error("Raw idea not found");
  }
  if (rawIdea.status === "deleted" || rawIdea.status === "succeeded") {
    throw new Error("Raw idea already placed or deleted");
  }

  if (rawIdea.userId.toString() !== userId) {
    throw new Error("You do not own this raw idea");
  }

  // 2️⃣ Load node
  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }

  // 5️⃣ Create note from raw idea
  const newNote = new Note({
    contentType: rawIdea.contentType,
    content: rawIdea.content,
    userId,
    nodeId,
    version: 0,
    tagged: rawIdea.tagged || [],
    isReflection: false,
    createdAt: rawIdea.createdAt,
  });

  await newNote.save();

  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "rawIdea",
    nodeVersion: 0,
    rawIdeaAction: {
      action: "placed",
      rawIdeaId: rawIdeaId.toString(),
      targetNodeId: nodeId,
      noteId: newNote._id.toString(),
    },
  });
  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "note",
    nodeVersion: 0,
    noteAction: {
      action: "add",
      noteId: newNote._id.toString(),
    },
  });

  rawIdea.status = "deleted";
  await rawIdea.save();

  return {
    message: "Raw idea converted to note",
    note: newNote,
  };
}

async function deleteRawIdeaAndFile({ rawIdeaId, userId, wasAi = false }) {
  const rawIdea = await RawIdea.findById(rawIdeaId);
  if (!rawIdea) {
    throw new Error("Raw idea not found");
  }

  // ownership check
  if (rawIdea.userId.toString() !== userId) {
    throw new Error("You do not own this raw idea");
  }
  let energyUsed = null;

  if (rawIdea.contentType === "text") {
    const energyResult = await useEnergy({
      userId,
      action: "removeNote",
    });
    energyUsed = energyResult.energyUsed;
  }

  let fileDeleted = false;

  // --- FILE CLEANUP ---
  let fileSizeKB = 0;

  if (rawIdea.contentType === "file" && rawIdea.content) {
    const filePath = path.join(process.cwd(), "uploads", rawIdea.content);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      fileSizeKB = Math.ceil(stats.size / 1024);

      fs.unlinkSync(filePath);
      fileDeleted = true;
    }
  }

  // --- SOFT DELETE via status ---
  rawIdea.status = "deleted";
  rawIdea.content = fileDeleted
    ? "File was deleted"
    : rawIdea.contentType === "text"
      ? rawIdea.content
      : "File was deleted";

  await rawIdea.save();

  await User.findByIdAndUpdate(userId, [
    {
      $set: {
        storageUsage: {
          $max: [{ $subtract: ["$storageUsage", fileSizeKB] }, 0],
        },
      },
    },
  ]);

  // --- LOG CONTRIBUTION ---
  await logContribution({
    userId,
    nodeId: "deleted",
    wasAi,
    action: "rawIdea",
    nodeVersion: "deleted",
    rawIdeaAction: {
      action: "delete",
      rawIdeaId: rawIdeaId.toString(),
    },
    ...(energyUsed ? { energyUsed } : {}),
  });

  return {
    message: fileDeleted
      ? "Raw idea deleted and file removed"
      : "Raw idea deleted",
  };
}

/**
 * @param {string} [status="pending"] - "pending"|"processing"|"succeeded"|"stuck"|"deleted"|"all"
 *   "pending" also includes legacy docs with no status field.
 */
async function getRawIdeas({
  userId,
  limit,
  startDate,
  endDate,
  status = "pending",
}) {
  if (!userId) {
    throw new Error("Missing required parameter: userId");
  }

  if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
    throw new Error("Invalid limit: must be a positive number");
  }

  const queryObj = { userId };

  if (!status || status === "all") {
    // no status filter — return everything for this user
  } else if (status === "pending") {
    // include legacy docs that predate the status field
    queryObj.$or = [
      { status: "pending" },
      { status: null },
      { status: { $exists: false } },
    ];
  } else {
    queryObj.status = status;
  }

  if (startDate || endDate) {
    queryObj.createdAt = {};
    if (startDate) queryObj.createdAt.$gte = new Date(startDate);
    if (endDate) queryObj.createdAt.$lte = new Date(endDate);
  }

  const sortField =
    status === "succeeded" ? { placedAt: -1 } : { createdAt: -1 };

  let query = RawIdea.find(queryObj)
    .sort(sortField)
    .populate("tagged", "username")
    .lean();

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const rawIdeas = await query;

  return {
    message: "Raw ideas retrieved successfully",
    rawIdeas,
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
async function searchRawIdeasByUser({
  userId,
  query,
  limit,
  startDate,
  endDate,
  status = "pending",
}) {
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
    const processed = wordify(cleaned);
    const words = processed.split(/\s+/).filter(Boolean);

    for (const w of words) {
      const wEsc = escapeRegex(w);
      const regex = new RegExp(`\\b${wEsc}\\b`, "i");
      conditions.push({ content: regex });
    }
  }

  // --- 3. Hyphen exact fallback
  if (query.includes("-")) {
    const escaped = escapeRegex(query);
    conditions.push({
      content: new RegExp(escaped, "i"),
    });
  }

  const mongoQueryObj = {
    userId, // inbox only
    contentType: "text", // files have no searchable text
    $and: conditions,
  };

  if (!status || status === "all") {
    // no status filter
  } else if (status === "pending") {
    mongoQueryObj.$or = [
      { status: "pending" },
      { status: null },
      { status: { $exists: false } },
    ];
  } else {
    mongoQueryObj.status = status;
  }

  if (startDate || endDate) {
    mongoQueryObj.createdAt = {};
    if (startDate) mongoQueryObj.createdAt.$gte = new Date(startDate);
    if (endDate) mongoQueryObj.createdAt.$lte = new Date(endDate);
  }

  let mongoQuery = RawIdea.find(mongoQueryObj)
    .sort({ createdAt: -1 })
    .populate("tagged", "username")
    .lean();

  if (limit && limit > 0) {
    mongoQuery = mongoQuery.limit(limit);
  }

  const rawIdeas = await mongoQuery;

  return {
    message: "Raw idea search completed",
    rawIdeas,
  };
}

const AUTO_PLACE_ELIGIBLE = ["standard", "premium", "god"];

async function toggleAutoPlace({ userId, enabled }) {
  if (!userId) throw new Error("Missing required parameter: userId");
  if (typeof enabled !== "boolean")
    throw new Error("enabled must be a boolean");

  const user = await User.findById(userId).select(
    "profileType rawIdeaAutoPlace",
  );
  if (!user) throw new Error("User not found");

  if (!AUTO_PLACE_ELIGIBLE.includes(user.profileType)) {
    throw new Error(
      "Auto-place is only available on Standard, Premium, and God plans.",
    );
  }

  user.rawIdeaAutoPlace = enabled;
  await user.save();

  return { message: `Auto-place ${enabled ? "enabled" : "disabled"}`, enabled };
}

export {
  createRawIdea,
  convertRawIdeaToNote,
  deleteRawIdeaAndFile,
  getRawIdeas,
  searchRawIdeasByUser,
  toggleAutoPlace,
  AUTO_PLACE_ELIGIBLE,
};
