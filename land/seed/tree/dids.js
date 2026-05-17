// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// Did read and write. The audit trail of IBP DO emissions.
//
// Replaces the older contributions.js. `logDid` is now `logDid`;
// hook `beforeContribution` is now `beforeDid`. The `wasAi` field is gone —
// derive from `Being.findById(beingId).operatingMode === "ai"` when needed.

import log from "../log.js";
import Did from "../models/did.js";
import { hooks } from "../hooks.js";
import { ERR, ProtocolError } from "../protocol.js";
import { getLandConfigValue } from "../landConfig.js";
import { resolveTreeAccess } from "./treeAccess.js";

// ─────────────────────────────────────────────────────────────────────────
// WRITE (audit trail recording)
// ─────────────────────────────────────────────────────────────────────────

function MAX_EXTENSION_DATA_BYTES() { return Math.max(1024, Math.min(Number(getLandConfigValue("metadataNamespaceMaxBytes")) || 524288, 2 * 1024 * 1024)); }
const MAX_ACTION_LENGTH = 100;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Log a Did record (audit trail of a DO verb emission).
 * Core action shapes are typed fields. Everything else goes to extensionData.
 * The `beforeDid` hook lets extensions modify or cancel.
 */
export async function logDid(params) {
  const {
    beingId, nodeId, action,
    chatId = null,
    sessionId = null,
    statusEdited, editName, editType, artifactAction,
    updateChild, updateParent, branchLifecycle,
    wasRemote = false, homeLand = null,
    ...extensionRest
  } = params;

  if (!beingId || !nodeId || !action) {
    throw new Error("logDid requires beingId, nodeId, and action");
  }
  if (typeof action !== "string" || action.length > MAX_ACTION_LENGTH) {
    throw new Error(`logDid: action must be a string under ${MAX_ACTION_LENGTH} chars`);
  }

  // beforeDid hook: extensions can modify or cancel
  const hookData = { nodeId, action, beingId, ...extensionRest };
  const hookResult = await hooks.run("beforeDid", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, `Did cancelled: ${hookResult.reason || "extension"}`);
  }

  // Build extensionData from rest params + hook additions
  const extData = {};
  let hasExtData = false;
  const coreKeys = new Set(["nodeId", "action", "beingId"]);

  for (const [k, v] of Object.entries(extensionRest)) {
    if (v == null || DANGEROUS_KEYS.has(k)) continue;
    extData[k] = v;
    hasExtData = true;
  }
  for (const [k, v] of Object.entries(hookData)) {
    if (coreKeys.has(k) || v == null || DANGEROUS_KEYS.has(k)) continue;
    if (!(k in extData)) {
      extData[k] = v;
      hasExtData = true;
    }
  }

  const extensionData = hasExtData ? extData : undefined;

  // Size guard (catches circular refs too)
  if (extensionData) {
    let size;
    try {
      size = Buffer.byteLength(JSON.stringify(extensionData), "utf8");
    } catch {
      throw new Error("Did extensionData is not serializable");
    }
    if (size > MAX_EXTENSION_DATA_BYTES()) {
      throw new Error(`Did extensionData exceeds ${MAX_EXTENSION_DATA_BYTES() / 1024}KB limit (${Math.round(size / 1024)}KB)`);
    }
  }

  // Build doc with only defined fields (avoids storing nulls in MongoDB)
  const doc = { beingId, nodeId, action, date: new Date() };
  if (chatId) doc.chatId = chatId;
  if (sessionId) doc.sessionId = sessionId;
  if (statusEdited) doc.statusEdited = statusEdited;
  if (editName) doc.editName = editName;
  if (editType) doc.editType = editType;
  if (artifactAction) doc.artifactAction = artifactAction;
  if (updateChild) doc.updateChild = updateChild;
  if (updateParent) doc.updateParent = updateParent;
  if (branchLifecycle) doc.branchLifecycle = branchLifecycle;
  if (wasRemote) doc.wasRemote = true;
  if (homeLand) doc.homeLand = homeLand;
  if (extensionData) doc.extensionData = extensionData;

  try {
    await Did.create(doc);
  } catch (err) {
    log.error("DB", `Did save failed (${action} on ${nodeId}): ${err.message}`);
    throw new Error("Failed to log Did");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// READ (audit trail queries)
// ─────────────────────────────────────────────────────────────────────────

function MAX_QUERY_LIMIT() { return Math.max(1, Math.min(Number(getLandConfigValue("didQueryLimit")) || 5000, 50000)); }
const MAX_DATE_SPAN_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Validate and clamp a date range. Returns the query filter object or {}.
 */
function buildDateFilter(startDate, endDate) {
  const filter = {};
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;

  if (startDate && isNaN(start)) throw new Error("Invalid startDate format");
  if (endDate && isNaN(end)) throw new Error("Invalid endDate format");
  if (!isNaN(start) && !isNaN(end) && end < start) throw new Error("endDate must be after startDate");
  if (!isNaN(start) && !isNaN(end) && (end - start) > MAX_DATE_SPAN_MS) {
    throw new Error("Date range cannot exceed 365 days");
  }

  if (!isNaN(start)) filter.$gte = new Date(start);
  if (!isNaN(end)) filter.$lte = new Date(end);
  return Object.keys(filter).length > 0 ? { date: filter } : {};
}

/**
 * Get the Did log for a node.
 * If actorId is provided, verifies the caller has access to the node's tree.
 * Kernel-internal callers (hooks, migrations) can omit actorId.
 */
export async function getDids({ nodeId, limit, offset, startDate, endDate, actorId }) {
  if (!nodeId) throw new Error("Missing required parameter: nodeId");

  if (actorId) {
    const access = await resolveTreeAccess(nodeId, actorId);
    if (!access.ok) throw new ProtocolError(404, ERR.NODE_NOT_FOUND, "Node not found");
  }

  const query = { nodeId, ...buildDateFilter(startDate, endDate) };
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), MAX_QUERY_LIMIT());
  const safeOffset = Math.max(0, Number(offset) || 0);

  const dids = await Did.find(query)
    .populate("beingId", "username")
    .populate("nodeId", "name")
    .sort({ date: -1 })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return { dids, limit: safeLimit };
}

/**
 * Get a being's Did history.
 */
export async function getDidsByBeing(beingId, limit, startDate, endDate) {
  if (!beingId) throw new Error("Missing required parameter: beingId");

  const query = { beingId, ...buildDateFilter(startDate, endDate) };
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), MAX_QUERY_LIMIT());

  const dids = await Did.find(query)
    .populate("beingId", "username")
    .populate("nodeId", "name")
    .sort({ date: -1 })
    .limit(safeLimit)
    .lean();

  return { dids };
}
