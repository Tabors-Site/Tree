// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Dids. The trail of acts.
//
// A being is its acts. The Being row in MongoDB is the place the
// trail attaches; the trail itself, every Did the being has
// emitted, is the identity. Without acts, the union of space and
// matter has nothing to be. The being is made of the acts unfolding.
//
// This file writes and reads that trail. logDid is called from the
// IBP verb dispatcher every time DO or BE lands an act. The Did row
// names the actor (beingId), the kind of act (verb, action), the
// target (space | matter | being | land | stance), and the input /
// output. getDids and getDidsByBeing return the trail to readers.
//
// Universal over substrate. Dids attach to any target kind, so this
// file lives directly under land/ rather than inside one primitive's
// subfolder.
//
// Recorded by default. Operations opt out via `spec.skipAudit`; the
// dispatcher also accepts `opts.skipAudit` for kernel-trusted batches.
//
// See seed/land/LAND.md "And the beings are the acts" for the
// philosophy behind why this trail is identity-load-bearing.

import log from "../system/log.js";
import Did from "../models/did.js";
import { hooks } from "../system/hooks.js";
import { IBP_ERR, IbpError } from "../ibp/protocol.js";
import { getLandConfigValue } from "../landConfig.js";
import { resolveSpaceAccess } from "./space/spaceFetch.js";

// ─────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────

function MAX_PAYLOAD_BYTES() {
  const raw = Number(getLandConfigValue("qualityNamespaceMaxBytes")) || 524288;
  return Math.max(1024, Math.min(raw, 2 * 1024 * 1024));
}
const MAX_ACTION_LENGTH = 100;
const VALID_VERBS = new Set(["do", "be"]);
const VALID_TARGET_KINDS = new Set([
  "space",
  "matter",
  "being",
  "land",
  "stance",
]);

/**
 * Log a Did record.
 *
 * @param {object} params
 * @param {string} params.beingId   actor (I_AM for scaffold flows)
 * @param {string} params.action    operation or sub-event name
 * @param {string} [params.verb="do"]   "do" | "be"
 * @param {{kind:string,id:string}|null} [params.target]  what was acted on
 * @param {*} [params.params]       input payload (any JSON; clipped on cap)
 * @param {*} [params.result]       output payload (any JSON; clipped on cap)
 * @param {string|null} [params.summonId]   correlation
 * @param {string|null} [params.sessionId]  correlation
 * @param {string|null} [params.homeLand]   federation provenance
 * @param {boolean} [params.wasRemote=false] federation provenance
 *
 * The `beforeDid` hook receives a mutable view of these fields and may
 * cancel the write or enrich the payload before insert.
 */
export async function logDid(input) {
  if (!input || typeof input !== "object") {
    throw new Error("logDid requires a params object");
  }
  const {
    beingId,
    verb = "do",
    action,
    target = null,
    params = null,
    result = null,
    summonId = null,
    sessionId = null,
    homeLand = null,
    wasRemote = false,
  } = input;

  if (!beingId || !action) {
    throw new Error("logDid requires beingId and action");
  }
  if (typeof action !== "string" || action.length > MAX_ACTION_LENGTH) {
    throw new Error(
      `logDid: action must be a string under ${MAX_ACTION_LENGTH} chars`,
    );
  }
  if (!VALID_VERBS.has(verb)) {
    throw new Error(
      `logDid: verb must be one of ${[...VALID_VERBS].join("|")}`,
    );
  }

  let normalizedTarget = null;
  if (target && typeof target === "object") {
    if (target.kind && !VALID_TARGET_KINDS.has(target.kind)) {
      throw new Error(
        `logDid: target.kind must be one of ${[...VALID_TARGET_KINDS].join("|")}`,
      );
    }
    if (target.kind || target.id) {
      normalizedTarget = {
        kind: target.kind || null,
        id: target.id != null ? String(target.id) : null,
      };
    }
  }

  // beforeDid hook . extensions can modify or cancel. The hook sees a
  // mutable view; only `params` and `result` are conventionally mutated
  // for enrichment. Cancellations short-circuit the write.
  const hookData = {
    beingId,
    verb,
    action,
    target: normalizedTarget,
    params,
    result,
    summonId,
    sessionId,
    homeLand,
    wasRemote,
  };
  const hookResult = await hooks.run("beforeDid", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? IBP_ERR.HOOK_TIMEOUT : IBP_ERR.HOOK_CANCELLED;
    throw new IbpError(code,
      `Did cancelled: ${hookResult.reason || "extension"}`,
    );
  }

  const cappedParams = capPayload(hookData.params, "params");
  const cappedResult = capPayload(hookData.result, "result");
  const truncated = cappedParams.truncated || cappedResult.truncated;

  const doc = {
    beingId,
    verb,
    action,
    target: hookData.target || normalizedTarget,
    params: cappedParams.value,
    result: cappedResult.value,
    truncated,
    summonId,
    sessionId,
    homeLand: hookData.homeLand ?? homeLand,
    wasRemote: Boolean(hookData.wasRemote ?? wasRemote),
    date: new Date(),
  };

  try {
    await Did.create(doc);
  } catch (err) {
    log.error("DB", `Did save failed (${action}): ${err.message}`);
    throw new Error("Failed to log Did");
  }
}

function capPayload(value, label) {
  if (value == null) return { value: null, truncated: false };
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { value: { _unserializable: true, _label: label }, truncated: true };
  }
  const max = MAX_PAYLOAD_BYTES();
  if (Buffer.byteLength(serialized, "utf8") <= max) {
    return { value, truncated: false };
  }
  return {
    value: {
      _truncated: true,
      _bytes: Buffer.byteLength(serialized, "utf8"),
      preview: serialized.slice(0, Math.floor(max * 0.9)),
    },
    truncated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

function MAX_QUERY_LIMIT() {
  return Math.max(
    1,
    Math.min(Number(getLandConfigValue("didQueryLimit")) || 5000, 50000),
  );
}
const MAX_DATE_SPAN_MS = 365 * 24 * 60 * 60 * 1000;

function buildDateFilter(startDate, endDate) {
  const filter = {};
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;

  if (startDate && isNaN(start)) throw new Error("Invalid startDate format");
  if (endDate && isNaN(end)) throw new Error("Invalid endDate format");
  if (!isNaN(start) && !isNaN(end) && end < start)
    throw new Error("endDate must be after startDate");
  if (!isNaN(start) && !isNaN(end) && end - start > MAX_DATE_SPAN_MS) {
    throw new Error("Date range cannot exceed 365 days");
  }

  if (!isNaN(start)) filter.$gte = new Date(start);
  if (!isNaN(end)) filter.$lte = new Date(end);
  return Object.keys(filter).length > 0 ? { date: filter } : {};
}

/**
 * Get the Did log for a space.
 * If beingId is provided, verifies the caller has access to the space's tree.
 * Kernel-internal callers (hooks, migrations) can omit beingId.
 */
export async function getDids({
  spaceId,
  limit,
  offset,
  startDate,
  endDate,
  beingId,
}) {
  if (!spaceId) throw new Error("Missing required parameter: spaceId");

  if (beingId) {
    const access = await resolveSpaceAccess(spaceId, beingId);
    if (!access.ok)
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
  }

  const query = {
    "target.kind": "space",
    "target.id": String(spaceId),
    ...buildDateFilter(startDate, endDate),
  };
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );
  const safeOffset = Math.max(0, Number(offset) || 0);

  const dids = await Did.find(query)
    .populate("beingId", "name")
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
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );

  const dids = await Did.find(query)
    .populate("beingId", "name")
    .sort({ date: -1 })
    .limit(safeLimit)
    .lean();

  return { dids };
}
