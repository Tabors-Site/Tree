// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Matter CRUD operations.
 *
 * Matter is stuff that lives inside a space. The kernel does not
 * distinguish notes, files, and metadata-only objects as separate
 * categories. Instead matter has an `origin` field that names the
 * system its underlying representation comes from:
 *
 *   ibp        : TreeOS-native content. content is a string (text) or
 *                null (metadata-only object).
 *   filesystem : Bridges to a file on disk. content is { path, size,
 *                mimeType }.
 *   web        : Bridges to a URL. content is { url, fetchedAt?, cache? }.
 *   cross-land : Bridges to matter on another TreeOS land.
 *                content is { land, matterRef }.
 *
 * beforeMatter/afterMatter hooks fire on every write. Extensions tag
 * matter via hookData.metadata using their own namespace.
 *
 * File uploads (origin "filesystem") store the file in the uploads/
 * directory. Soft-deleted matter has spaceId and beingId set to the
 * DELETED sentinel.
 */

import log from "../system/log.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Matter from "../models/matter.js";
import Space from "../models/space.js";
import Did from "../models/did.js";
import { incBeingMeta } from "../being/beingMetadata.js";
import { escapeRegex } from "../system/utils.js";
import { getLandConfigValue } from "../landConfig.js";
import { resolveRootSpace } from "../space/spaceFetch.js";
import { hooks } from "../system/hooks.js";
import { MATTER_ORIGIN } from "./origins.js";
import { DELETED } from "../space/seedSpaces.js";
import { ERR, ProtocolError } from "../ibp/protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIG (all readable via land .config node)
// ─────────────────────────────────────────────────────────────────────────

function matterMaxChars()    { return Math.max(100, Number(getLandConfigValue("matterMaxChars"))    || 5000); }
function maxMatterPerNode()  { return Math.max(1,   Number(getLandConfigValue("maxMatterPerNode")) || 1000); }
function matterQueryLimit()  { return Math.max(1,   Math.min(Number(getLandConfigValue("matterQueryLimit"))  || 5000, 50000)); }
function searchQueryLimit()  { return Math.max(1,   Math.min(Number(getLandConfigValue("matterSearchLimit")) || 500, 10000)); }

// ─────────────────────────────────────────────────────────────────────────
// CONTENT SHAPE HELPERS
// ─────────────────────────────────────────────────────────────────────────

function isIbpOrigin(origin) {
  return origin === MATTER_ORIGIN.IBP;
}

function isFilesystemOrigin(origin) {
  return origin === MATTER_ORIGIN.FILESYSTEM;
}

// For ibp matter the textual content (if any) lives directly in
// `content` as a string. For other origins, callers must derive a
// human-readable representation from the structured content. This
// helper returns the searchable / loggable text for matter, or
// an empty string when there is no text representation.
function ibpText(matter) {
  if (!matter) return "";
  if (matter.origin !== MATTER_ORIGIN.IBP) return "";
  return typeof matter.content === "string" ? matter.content : "";
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

async function assertMatterTextWithinLimit(content, _beingId) {
  if (!content || typeof content !== "string") return;
  // Admin bypass retired 2026-05-18. Size cap applies to every being;
  // stance-authorization-based exemptions can land here later if needed.
  const max = matterMaxChars();
  if (content.length > max) {
    throw new Error(`Matter exceeds maximum length of ${max} characters`);
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

async function createMatter({
  origin = MATTER_ORIGIN.IBP,
  content = null,
  beingId,
  spaceId,
  file,
  summonId = null,
  sessionId = null,
  metadata = {},
}) {
  if (!Object.values(MATTER_ORIGIN).includes(origin)) {
    throw new Error(`Invalid matter origin: ${origin}`);
  }
  if (!beingId || !spaceId) {
    throw new Error("Missing required fields: beingId, spaceId");
  }

  const targetSpace = await Space.findOne({
    _id: spaceId,
    parent: { $exists: true, $ne: null },
  }).select("seedSpace parent").lean();
  if (!targetSpace) throw new Error("Space not found or deleted");
  if (targetSpace.seedSpace) throw new Error("Cannot modify land seed spaces");

  const max = maxMatterPerNode();
  const count = await Matter.countDocuments({ spaceId });
  if (count >= max) {
    throw new Error(`Space has reached the maximum of ${max} matter entries. Delete old matter before adding new ones.`);
  }

  // Build the content payload per-origin. Validates required structure
  // and produces the storage shape.
  let finalContent = content;
  if (isFilesystemOrigin(origin)) {
    if (!file) throw new Error("File is required for filesystem origin");
    finalContent = {
      path:     file.filename,
      size:     typeof file.size === "number" ? file.size : null,
      mimeType: file.mimetype || null,
      originalName: file.originalname || null,
    };
  } else if (isIbpOrigin(origin)) {
    if (typeof finalContent === "string") {
      await assertMatterTextWithinLimit(finalContent, beingId);
    }
    // null is allowed: metadata-only object.
  }
  // web / cross-land: content shape is the caller's responsibility.

  // ── HOOKS ────────────────────────────────────────
  const hookData = { spaceId, content: finalContent, beingId, origin, metadata: { ...metadata } };
  const hookResult = await hooks.run("beforeMatter", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Matter creation cancelled by extension");
  }
  finalContent = hookData.content;

  // ── SAVE ────────────────────────────────────────
  const newMatter = new Matter({
    origin,
    content: finalContent,
    beingId,
    spaceId,
    metadata: hookData.metadata,
  });
  await newMatter.save();

  // Storage tracking. Size in KB attributed to the matter owner.
  let sizeKB = 0;
  if (isFilesystemOrigin(origin) && file?.size) {
    sizeKB = Math.ceil(file.size / 1024);
  } else if (isIbpOrigin(origin) && typeof finalContent === "string") {
    sizeKB = Math.ceil(Buffer.byteLength(finalContent, "utf8") / 1024);
  }
  if (sizeKB > 0) {
    incBeingMeta(beingId, "storage", "usageKB", sizeKB).catch(() => {});
  }

  // Await the hook chain so reactive work (syntax validation, contract
  // signaling, cascade fan-out) completes BEFORE the caller returns.
  // Without this, the tool handler returns success to the LLM's tool
  // loop while the validator is still running, and the next turn's
  // context read misses freshly-written signals — a race that lets
  // the AI walk past blocking errors. After hooks run parallel so
  // awaiting the Promise.all adds no serialization latency beyond
  // the slowest single handler.
  await hooks.run("afterMatter", { matter: newMatter, spaceId, beingId, origin, sizeKB, action: "create", summonId, sessionId }).catch((err) => {
    log.warn("Matter", `afterMatter hook chain failed: ${err?.message}`);
  });

  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(spaceId, { action: "matter:create", origin, sizeKB, beingId })
  ).catch(() => {});

  // Did audit is the dispatcher's job. The op handler (create-matter)
  // returns _didTarget pointing at this matter so one Did per op call
  // names the substrate event.
  return { message: "Matter created successfully", matter: newMatter };
}

// ─────────────────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────────────────

async function editMatter({
  matterId, content, beingId,
  lineStart = null, lineEnd = null,
  summonId = null, sessionId = null,
}) {
  if (!matterId || !beingId) throw new Error("Missing required fields");

  const matter = await Matter.findById(matterId);
  if (!matter) throw new Error("Matter not found");
  if (matter.beingId.toString() !== beingId.toString()) throw new Error("Unauthorized");
  if (!isIbpOrigin(matter.origin)) {
    throw new Error(`Cannot edit matter with origin "${matter.origin}". Only ibp-origin matter has editable text content.`);
  }

  const oldContent = ibpText(matter);
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

  await assertMatterTextWithinLimit(newContent, beingId);

  if (oldContent === newContent) {
    return { message: "No changes", matter };
  }

  let finalContent = newContent;
  {
    const hookData = { spaceId: matter.spaceId, content: newContent, beingId, origin: matter.origin, metadata: {} };
    await hooks.run("beforeMatter", hookData);
    finalContent = hookData.content;
  }

  const oldSizeKB = Math.ceil(Buffer.byteLength(oldContent, "utf8") / 1024);
  const newSizeKB = Math.ceil(Buffer.byteLength(typeof finalContent === "string" ? finalContent : "", "utf8") / 1024);
  const deltaKB = newSizeKB - oldSizeKB;

  matter.content = finalContent;
  await matter.save();

  if (deltaKB !== 0) {
    incBeingMeta(beingId, "storage", "usageKB", deltaKB).catch(() => {});
  }

  // Awaited: see comment in createMatter above. Callers (tool handlers
  // on the LLM path) need the syntax validator + cascade signaling
  // complete before they return, or the next turn reads stale state.
  await hooks.run("afterMatter", { matter, spaceId: matter.spaceId, beingId, origin: matter.origin, sizeKB: newSizeKB, deltaKB, action: "edit", summonId, sessionId }).catch((err) => {
    log.warn("Matter", `afterMatter hook chain failed: ${err?.message}`);
  });

  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(matter.spaceId, { action: "matter:edit", origin: matter.origin, deltaKB, beingId })
  ).catch(() => {});

  return { message: "Matter updated successfully", matter };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

async function getMatters({ spaceId, limit, offset, startDate, endDate }) {
  if (!spaceId) throw new Error("Missing required parameter: spaceId");

  const query = { spaceId, ...validateDateRange(startDate, endDate) };
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), matterQueryLimit());
  const safeOffset = Math.max(0, Number(offset) || 0);

  const matters = await Matter.find(query)
    .sort({ createdAt: -1 })
    .populate("beingId", "name")
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return {
    matters: matters.map(m => ({
      _id:        m._id,
      origin:     m.origin,
      content:    m.content,
      name:       m.name ?? null,                       // matter's own name
      authorName: m.beingId?.name ?? null,              // populated from beingId
      beingId:    m.beingId?._id ? String(m.beingId._id) : null,
      spaceId:     m.spaceId,
      metadata:   m.metadata,
      createdAt:  m.createdAt,
      updatedAt:  m.updatedAt,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────

async function deleteMatterAndFile({
  matterId, beingId,
  summonId = null, sessionId = null,
}) {
  const matter = await Matter.findById(matterId);
  if (!matter) throw new Error("Matter not found");

  const rootSpace = await resolveRootSpace(matter.spaceId);
  const isAuthor = matter.beingId?.toString() === beingId.toString();
  const isRootOwner = rootSpace.rootOwner?.toString() === beingId.toString();

  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the matter author or the tree owner can delete this matter");
  }

  const fileOwnerId = matter.beingId?.toString();
  const { spaceId } = matter;
  let fileDeleted = false;
  let fileSizeKB = 0;

  if (isFilesystemOrigin(matter.origin) && matter.content?.path) {
    const filePath = path.resolve(uploadsFolder, path.basename(matter.content.path));
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
          log.warn("Matter", `File delete failed: ${fsErr.message}`);
        }
      }
    }
    matter.content = { ...matter.content, path: null, deleted: true };
  }
  matter.spaceId = DELETED;
  matter.beingId = DELETED;
  await matter.save();

  if (fileDeleted && fileSizeKB > 0 && fileOwnerId && fileOwnerId !== DELETED) {
    incBeingMeta(fileOwnerId, "storage", "usageKB", -fileSizeKB).catch(() => {});
  }

  if (fileOwnerId && fileOwnerId !== DELETED) {
    hooks.run("afterMatter", {
      matter, spaceId, beingId: fileOwnerId,
      origin: matter.origin, fileSizeKB,
      action: "delete", fileDeleted,
      summonId, sessionId,
    }).catch(() => {});

    import("./cascade.js").then(({ checkCascade }) =>
      checkCascade(spaceId, { action: "matter:delete", origin: matter.origin, fileSizeKB, beingId: fileOwnerId })
    ).catch(() => {});
  }

  return {
    message: isFilesystemOrigin(matter.origin)
      ? "File matter removed and underlying file deleted."
      : "Matter removed.",
  };
}

async function transferMatter({
  matterId, targetSpace, beingId,
  summonId = null, sessionId = null,
}) {
  if (!matterId || !targetSpace || !beingId) {
    throw new Error("Missing required fields: matterId, targetSpace, beingId");
  }

  const matter = await Matter.findById(matterId);
  if (!matter) throw new Error("Matter not found");
  if (matter.spaceId === DELETED) throw new Error("Cannot transfer deleted matter");

  const rootSpace = await resolveRootSpace(matter.spaceId);
  const isAuthor = matter.beingId?.toString() === beingId.toString();
  const isRootOwner = rootSpace.rootOwner?.toString() === beingId.toString();
  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the matter author or the tree owner can transfer this matter");
  }

  const targetSpaceDoc = await Space.findById(targetSpace).select("_id").lean();
  if (!targetSpaceDoc) throw new Error("Target Space not found");

  const targetRoot = await resolveRootSpace(targetSpace);
  if (targetRoot._id.toString() !== rootSpace._id.toString()) {
    throw new Error("Cannot transfer matter between different trees");
  }

  const sourceSpaceId = matter.spaceId;
  matter.spaceId = targetSpace;
  await matter.save();

  return { message: "Matter transferred successfully", matterId: matterId.toString(), from: { spaceId: sourceSpaceId }, to: { spaceId: targetSpace } };
}

// ─────────────────────────────────────────────────────────────────────────
// BEING-FACING QUERIES
// ─────────────────────────────────────────────────────────────────────────
//
// Read primitives keyed by being rather than by node. Substrate surface
// for "my matter" / "search my matter" / "edit history of this matter."
// Wire these through IBP DO operations or extension tools when a UI
// needs them.

/**
 * Every matter authored by a being, newest first.
 *
 * @param {object} opts
 * @param {string} opts.beingId   author id (required)
 * @param {number} [opts.limit]
 * @param {Date|string} [opts.startDate]
 * @param {Date|string} [opts.endDate]
 * @returns {Promise<{ matters }>}
 */
async function getAllMatterByBeing({ beingId, limit, startDate, endDate } = {}) {
  if (!beingId) throw new Error("getAllMatterByBeing: `beingId` is required");
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), matterQueryLimit());
  const matters = await Matter
    .find({ beingId, ...validateDateRange(startDate, endDate) })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  return { matters };
}

/**
 * Full-text search across a being's ibp-origin matter. Phrases in
 * "double quotes" match as substrings; bare words match whole-word.
 * Other origins (filesystem, web) carry structured content and need
 * origin-specific search through the bridging extension.
 *
 * @param {object} opts
 * @param {string} opts.beingId   author id (required)
 * @param {string} opts.query     search expression (required)
 * @param {number} [opts.limit]
 * @param {Date|string} [opts.startDate]
 * @param {Date|string} [opts.endDate]
 * @returns {Promise<{ matters }>}
 */
async function searchMatterByBeing({ beingId, query, limit, startDate, endDate } = {}) {
  if (!beingId) throw new Error("searchMatterByBeing: `beingId` is required");
  if (!query || typeof query !== "string") {
    throw new Error("searchMatterByBeing: `query` must be a non-empty string");
  }

  const conditions = buildSearchConditions(query);
  if (conditions.length === 0) return { matters: [] };

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), searchQueryLimit());
  const matters = await Matter
    .find({
      beingId,
      origin: MATTER_ORIGIN.IBP,
      $and: conditions,
      ...validateDateRange(startDate, endDate),
    })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  return { matters };
}

// Parse a search expression into a list of mongo content-regex
// conditions. Quoted phrase = substring match; bare words = whole-word
// match; literal hyphen = substring match against the whole query.
function buildSearchConditions(expression) {
  const conditions = [];
  const phrase = expression.match(/"(.*?)"/)?.[1];
  if (phrase) {
    conditions.push({ content: new RegExp(escapeRegex(phrase), "i") });
  }
  const bare = expression.replace(/"(.*?)"/, "")
    .replace(/-/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
  for (const w of bare.split(/\s+/).filter(Boolean)) {
    conditions.push({ content: new RegExp(`\\b${escapeRegex(w)}\\b`, "i") });
  }
  if (expression.includes("-")) {
    conditions.push({ content: new RegExp(escapeRegex(expression), "i") });
  }
  return conditions;
}

/**
 * Lifecycle history for matter, derived from the Did audit trail.
 * Returns create / edit / remove Dids oldest-first. Edit and create
 * rows carry content; remove rows carry null content.
 *
 * @param {object} opts
 * @param {string} opts.matterId  required
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 */
async function getMatterHistory({ matterId, limit = 100, offset = 0 } = {}) {
  if (!matterId) throw new Error("getMatterHistory: `matterId` is required");
  const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 1000);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const dids = await Did
    .find({
      "target.kind": "matter",
      "target.id":   String(matterId),
      action:        { $in: ["create", "edit", "remove"] },
    })
    .populate("beingId", "name")
    .sort({ date: 1 })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return dids.map((d) => ({
    _id:        d._id,
    authorName: d.beingId?.name ?? null,
    beingId:    d.beingId?._id ? String(d.beingId._id) : null,
    date:       d.date,
    content:    d.params?.content ?? null,
    action:     d.action,
  }));
}

export {
  createMatter, editMatter, getMatters, deleteMatterAndFile,
  transferMatter,
  getAllMatterByBeing, searchMatterByBeing, getMatterHistory,
};
