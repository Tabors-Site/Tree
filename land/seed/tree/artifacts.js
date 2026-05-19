// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Artifact CRUD operations.
 *
 * Artifacts are things that live inside a node. The kernel does not
 * distinguish notes, files, and metadata-only objects as separate
 * categories. Instead an artifact has an `origin` field that names the
 * system its underlying representation comes from:
 *
 *   ibp        : TreeOS-native content. content is a string (text) or
 *                null (metadata-only object).
 *   filesystem : Bridges to a file on disk. content is { path, size,
 *                mimeType }.
 *   web        : Bridges to a URL. content is { url, fetchedAt?, cache? }.
 *   cross-land : Bridges to an artifact on another TreeOS land.
 *                content is { land, artifactRef }.
 *
 * beforeArtifact/afterArtifact hooks fire on every write. Extensions tag
 * artifacts via hookData.metadata using their own namespace.
 *
 * File uploads (origin "filesystem") store the file in the uploads/
 * directory. Soft-deleted artifacts have nodeId and beingId set to the
 * DELETED sentinel.
 */

import log from "../core/log.js";
import path from "path";
import fs from "fs";
import Artifact from "../models/artifact.js";
import Node from "../models/node.js";
import Did from "../models/did.js";
import { logDid } from "./dids.js";
import { escapeRegex } from "../core/utils.js";
import { hooks } from "../core/hooks.js";
import { getLandConfigValue } from "../landConfig.js";
import { fileURLToPath } from "url";
import { resolveRootNode } from "./treeFetch.js";
import { ARTIFACT_ORIGIN, DELETED, ERR, ProtocolError } from "../core/protocol.js";
import { incBeingMeta } from "./beingMetadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIG (all readable via land .config node)
// ─────────────────────────────────────────────────────────────────────────

function artifactMaxChars()    { return Math.max(100, Number(getLandConfigValue("artifactMaxChars"))    || 5000); }
function maxArtifactsPerNode() { return Math.max(1,   Number(getLandConfigValue("maxArtifactsPerNode")) || 1000); }
function artifactQueryLimit()  { return Math.max(1,   Math.min(Number(getLandConfigValue("artifactQueryLimit"))  || 5000, 50000)); }
function searchQueryLimit()    { return Math.max(1,   Math.min(Number(getLandConfigValue("artifactSearchLimit")) || 500, 10000)); }

// ─────────────────────────────────────────────────────────────────────────
// CONTENT SHAPE HELPERS
// ─────────────────────────────────────────────────────────────────────────

function isIbpOrigin(origin) {
  return origin === ARTIFACT_ORIGIN.IBP;
}

function isFilesystemOrigin(origin) {
  return origin === ARTIFACT_ORIGIN.FILESYSTEM;
}

// For ibp artifacts the textual content (if any) lives directly in
// `content` as a string. For other origins, callers must derive a
// human-readable representation from the structured content. This
// helper returns the searchable / loggable text for an artifact, or
// an empty string when there is no text representation.
function ibpText(artifact) {
  if (!artifact) return "";
  if (artifact.origin !== ARTIFACT_ORIGIN.IBP) return "";
  return typeof artifact.content === "string" ? artifact.content : "";
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

async function assertArtifactTextWithinLimit(content, _beingId) {
  if (!content || typeof content !== "string") return;
  // Admin bypass retired 2026-05-18. Size cap applies to every being;
  // stance-authorization-based exemptions can land here later if needed.
  const max = artifactMaxChars();
  if (content.length > max) {
    throw new Error(`Artifact exceeds maximum length of ${max} characters`);
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

async function createArtifact({
  origin = ARTIFACT_ORIGIN.IBP,
  content = null,
  beingId,
  nodeId,
  file,
  summonId = null,
  sessionId = null,
  metadata = {},
}) {
  if (!Object.values(ARTIFACT_ORIGIN).includes(origin)) {
    throw new Error(`Invalid artifact origin: ${origin}`);
  }
  if (!beingId || !nodeId) {
    throw new Error("Missing required fields: beingId, nodeId");
  }

  const targetNode = await Node.findOne({
    _id: nodeId,
    parent: { $exists: true, $ne: null },
  }).select("systemRole parent").lean();
  if (!targetNode) throw new Error("Node not found or deleted");
  if (targetNode.systemRole) throw new Error("Cannot modify system nodes");

  const max = maxArtifactsPerNode();
  const count = await Artifact.countDocuments({ nodeId });
  if (count >= max) {
    throw new Error(`Node has reached the maximum of ${max} artifacts. Delete old artifacts before adding new ones.`);
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
      await assertArtifactTextWithinLimit(finalContent, beingId);
    }
    // null is allowed: metadata-only object.
  }
  // web / cross-land: content shape is the caller's responsibility.

  // ── HOOKS ────────────────────────────────────────
  const hookData = { nodeId, content: finalContent, beingId, origin, metadata: { ...metadata } };
  const hookResult = await hooks.run("beforeArtifact", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Artifact creation cancelled by extension");
  }
  finalContent = hookData.content;

  // ── SAVE ────────────────────────────────────────
  const newArtifact = new Artifact({
    origin,
    content: finalContent,
    beingId,
    nodeId,
    metadata: hookData.metadata,
  });
  await newArtifact.save();

  // Storage tracking. Size in KB attributed to the artifact owner.
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
  await hooks.run("afterArtifact", { artifact: newArtifact, nodeId, beingId, origin, sizeKB, action: "create", summonId, sessionId }).catch((err) => {
    log.warn("Artifacts", `afterArtifact hook chain failed: ${err?.message}`);
  });

  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(nodeId, { action: "artifact:create", origin, sizeKB, beingId })
  ).catch(() => {});

  await logDid({
    beingId, nodeId, summonId, sessionId,
    action: "artifact",
    artifactAction: { action: "add", artifactId: newArtifact._id.toString(), content: isIbpOrigin(origin) ? ibpText(newArtifact) : null },
  });

  return { message: "Artifact created successfully", artifact: newArtifact };
}

// ─────────────────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────────────────

async function editArtifact({
  artifactId, content, beingId,
  lineStart = null, lineEnd = null,
  summonId = null, sessionId = null,
}) {
  if (!artifactId || !beingId) throw new Error("Missing required fields");

  const artifact = await Artifact.findById(artifactId);
  if (!artifact) throw new Error("Artifact not found");
  if (artifact.beingId.toString() !== beingId.toString()) throw new Error("Unauthorized");
  if (!isIbpOrigin(artifact.origin)) {
    throw new Error(`Cannot edit artifact with origin "${artifact.origin}". Only ibp-origin artifacts have editable text content.`);
  }

  const oldContent = ibpText(artifact);
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

  await assertArtifactTextWithinLimit(newContent, beingId);

  if (oldContent === newContent) {
    return { message: "No changes", artifact };
  }

  let finalContent = newContent;
  {
    const hookData = { nodeId: artifact.nodeId, content: newContent, beingId, origin: artifact.origin, metadata: {} };
    await hooks.run("beforeArtifact", hookData);
    finalContent = hookData.content;
  }

  const oldSizeKB = Math.ceil(Buffer.byteLength(oldContent, "utf8") / 1024);
  const newSizeKB = Math.ceil(Buffer.byteLength(typeof finalContent === "string" ? finalContent : "", "utf8") / 1024);
  const deltaKB = newSizeKB - oldSizeKB;

  artifact.content = finalContent;
  await artifact.save();

  if (deltaKB !== 0) {
    incBeingMeta(beingId, "storage", "usageKB", deltaKB).catch(() => {});
  }

  // Awaited: see comment in createArtifact above. Callers (tool handlers
  // on the LLM path) need the syntax validator + cascade signaling
  // complete before they return, or the next turn reads stale state.
  await hooks.run("afterArtifact", { artifact, nodeId: artifact.nodeId, beingId, origin: artifact.origin, sizeKB: newSizeKB, deltaKB, action: "edit", summonId, sessionId }).catch((err) => {
    log.warn("Artifacts", `afterArtifact hook chain failed: ${err?.message}`);
  });

  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(artifact.nodeId, { action: "artifact:edit", origin: artifact.origin, deltaKB, beingId })
  ).catch(() => {});

  await logDid({
    beingId, nodeId: artifact.nodeId, summonId, sessionId,
    action: "artifact",
    artifactAction: { action: "edit", artifactId: artifact._id.toString(), content: typeof finalContent === "string" ? finalContent : "" },
  });

  return { message: "Artifact updated successfully", artifact };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

async function getArtifacts({ nodeId, limit, offset, startDate, endDate }) {
  if (!nodeId) throw new Error("Missing required parameter: nodeId");

  const query = { nodeId, ...validateDateRange(startDate, endDate) };
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), artifactQueryLimit());
  const safeOffset = Math.max(0, Number(offset) || 0);

  const artifacts = await Artifact.find(query)
    .sort({ createdAt: -1 })
    .populate("beingId", "name")
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return {
    artifacts: artifacts.map(a => ({
      _id:        a._id,
      origin:     a.origin,
      content:    a.content,
      name:       a.name ?? null,                       // artifact's own name
      authorName: a.beingId?.name ?? null,              // populated from beingId
      beingId:    a.beingId?._id ? String(a.beingId._id) : null,
      nodeId:     a.nodeId,
      metadata:   a.metadata,
      createdAt:  a.createdAt,
      updatedAt:  a.updatedAt,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────

async function deleteArtifactAndFile({
  artifactId, beingId,
  summonId = null, sessionId = null,
}) {
  const artifact = await Artifact.findById(artifactId);
  if (!artifact) throw new Error("Artifact not found");

  const rootNode = await resolveRootNode(artifact.nodeId);
  const isAuthor = artifact.beingId?.toString() === beingId.toString();
  const isRootOwner = rootNode.rootOwner?.toString() === beingId.toString();

  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the artifact author or the tree owner can delete this artifact");
  }

  const fileOwnerId = artifact.beingId?.toString();
  const { nodeId } = artifact;
  let fileDeleted = false;
  let fileSizeKB = 0;

  if (isFilesystemOrigin(artifact.origin) && artifact.content?.path) {
    const filePath = path.resolve(uploadsFolder, path.basename(artifact.content.path));
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
          log.warn("Artifacts", `File delete failed: ${fsErr.message}`);
        }
      }
    }
    artifact.content = { ...artifact.content, path: null, deleted: true };
  }
  artifact.nodeId = DELETED;
  artifact.beingId = DELETED;
  await artifact.save();

  if (fileDeleted && fileSizeKB > 0 && fileOwnerId && fileOwnerId !== DELETED) {
    incBeingMeta(fileOwnerId, "storage", "usageKB", -fileSizeKB).catch(() => {});
  }

  if (fileOwnerId && fileOwnerId !== DELETED) {
    hooks.run("afterArtifact", {
      artifact, nodeId, beingId: fileOwnerId,
      origin: artifact.origin, fileSizeKB,
      action: "delete", fileDeleted,
      summonId, sessionId,
    }).catch(() => {});

    import("./cascade.js").then(({ checkCascade }) =>
      checkCascade(nodeId, { action: "artifact:delete", origin: artifact.origin, fileSizeKB, beingId: fileOwnerId })
    ).catch(() => {});
  }

  await logDid({
    beingId, nodeId, summonId, sessionId,
    action: "artifact",
    artifactAction: { action: "remove", noteId: artifactId.toString(), fileDeleted: fileDeleted || undefined },
  });

  return {
    message: isFilesystemOrigin(artifact.origin)
      ? "File artifact removed and underlying file deleted."
      : "Artifact removed.",
  };
}

async function transferArtifact({
  artifactId, targetNodeId, beingId,
  summonId = null, sessionId = null,
}) {
  if (!artifactId || !targetNodeId || !beingId) {
    throw new Error("Missing required fields: artifactId, targetNodeId, beingId");
  }

  const artifact = await Artifact.findById(artifactId);
  if (!artifact) throw new Error("Artifact not found");
  if (artifact.nodeId === DELETED) throw new Error("Cannot transfer a deleted artifact");

  const rootNode = await resolveRootNode(artifact.nodeId);
  const isAuthor = artifact.beingId?.toString() === beingId.toString();
  const isRootOwner = rootNode.rootOwner?.toString() === beingId.toString();
  if (!isAuthor && !isRootOwner) {
    throw new Error("Only the artifact author or the tree owner can transfer this artifact");
  }

  const targetNode = await Node.findById(targetNodeId).select("_id").lean();
  if (!targetNode) throw new Error("Target node not found");

  const targetRoot = await resolveRootNode(targetNodeId);
  if (targetRoot._id.toString() !== rootNode._id.toString()) {
    throw new Error("Cannot transfer artifacts between different trees");
  }

  const sourceNodeId = artifact.nodeId;
  artifact.nodeId = targetNodeId;
  await artifact.save();

  await logDid({
    beingId, nodeId: sourceNodeId, summonId, sessionId,
    action: "artifact",
    artifactAction: { action: "remove", noteId: artifactId.toString() },
  });

  await logDid({
    beingId, nodeId: targetNodeId, summonId, sessionId,
    action: "artifact",
    artifactAction: { action: "add", artifactId: artifactId.toString(), content: isIbpOrigin(artifact.origin) ? ibpText(artifact) : null },
  });

  return { message: "Artifact transferred successfully", artifactId: artifactId.toString(), from: { nodeId: sourceNodeId }, to: { nodeId: targetNodeId } };
}

// ─────────────────────────────────────────────────────────────────────────
// BEING-FACING QUERIES
// ─────────────────────────────────────────────────────────────────────────
//
// Read primitives keyed by being rather than by node. Substrate surface
// for "my artifacts" / "search my artifacts" / "edit history of this
// artifact." Wire these through IBP DO operations or extension tools
// when a UI needs them.

/**
 * Every artifact authored by a being, newest first.
 *
 * @param {object} opts
 * @param {string} opts.beingId   author id (required)
 * @param {number} [opts.limit]
 * @param {Date|string} [opts.startDate]
 * @param {Date|string} [opts.endDate]
 * @returns {Promise<{ artifacts }>}
 */
async function getAllArtifactsByBeing({ beingId, limit, startDate, endDate } = {}) {
  if (!beingId) throw new Error("getAllArtifactsByBeing: `beingId` is required");
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), artifactQueryLimit());
  const artifacts = await Artifact
    .find({ beingId, ...validateDateRange(startDate, endDate) })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  return { artifacts };
}

/**
 * Full-text search across a being's ibp-origin artifacts. Phrases in
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
 * @returns {Promise<{ artifacts }>}
 */
async function searchArtifactsByBeing({ beingId, query, limit, startDate, endDate } = {}) {
  if (!beingId) throw new Error("searchArtifactsByBeing: `beingId` is required");
  if (!query || typeof query !== "string") {
    throw new Error("searchArtifactsByBeing: `query` must be a non-empty string");
  }

  const conditions = buildSearchConditions(query);
  if (conditions.length === 0) return { artifacts: [] };

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), searchQueryLimit());
  const artifacts = await Artifact
    .find({
      beingId,
      origin: ARTIFACT_ORIGIN.IBP,
      $and: conditions,
      ...validateDateRange(startDate, endDate),
    })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  return { artifacts };
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
 * Edit history for an artifact, derived from the Did audit trail.
 * Returns `add` + `edit` Dids oldest-first, each with the editor's
 * being id and name as separate fields (no shadowing).
 *
 * @param {object} opts
 * @param {string} opts.artifactId  required
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 */
async function getArtifactEditHistory({ artifactId, limit = 100, offset = 0 } = {}) {
  if (!artifactId) throw new Error("getArtifactEditHistory: `artifactId` is required");
  const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 1000);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const dids = await Did
    .find({
      action: "artifact",
      "artifactAction.artifactId": artifactId,
      "artifactAction.action": { $in: ["add", "edit"] },
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
    content:    d.artifactAction?.content ?? null,
    action:     d.artifactAction?.action ?? null,
  }));
}

export {
  createArtifact, editArtifact, getArtifacts, deleteArtifactAndFile,
  transferArtifact,
  getAllArtifactsByBeing, searchArtifactsByBeing, getArtifactEditHistory,
};
