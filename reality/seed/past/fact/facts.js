// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Facts. The reel of stamped acts.
//
// A being is its acts. The Being row in MongoDB is where the reel
// attaches; the reel itself, every Fact the being has stamped, is
// the identity. Without acts, the union of space and matter has
// nothing to be. The being is made of the acts unfolding.
//
// A Fact is a thing a being stamps in the Factory — one recorded
// change to matter, space, or being. `factum`, a thing done.
// A single fact is small but settled; a chain of facts, folded,
// is Truth.
//
// This file writes and reads that reel. logFact is called from the
// IBP verb dispatcher every time DO or BE places an act. The Fact
// row names the actor (beingId), the kind of act (verb, action), the
// target (space | matter | being | place | stance), and the input /
// output. getFacts and getFactsByBeing return the reel to readers.
//
// Universal over substrate. Facts attach to any target kind, so this
// file lives directly under place/ rather than inside one primitive's
// subfolder.
//
// Recorded by default. Operations opt out via `spec.skipAudit`; the
// dispatcher also accepts `opts.skipAudit` for seed-trusted batches.
//
// See seed/philosophy/MATERIALS.md "And the beings are the acts" for the
// philosophy behind why this reel is identity-load-bearing.

import log from "../../seedReality/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import Fact from "./fact.js";
import { hooks } from "../../hooks.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { getRealityConfigValue } from "../../realityConfig.js";
import { resolveSpaceAccess } from "../../materials/space/spaces.js";
import { allocSeq } from "../reel/reelHeads.js";
import { withReelLock } from "../reel/appendLock.js";

// Reel-bearing target kinds — those with their own seq counter. Other
// kinds (place, stance) and target-less facts carry seq:null and stay
// outside the fold model for now.
const REEL_KINDS = new Set(["being", "space", "matter"]);

// ─────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────

function MAX_PAYLOAD_BYTES() {
  const raw = Number(getInternalConfigValue("qualityNamespaceMaxBytes")) || 524288;
  return Math.max(1024, Math.min(raw, 2 * 1024 * 1024));
}
const MAX_ACTION_LENGTH = 100;
const VALID_VERBS = new Set(["do", "be"]);
const VALID_TARGET_KINDS = new Set([
  "space",
  "matter",
  "being",
  "place",
  "stance",
]);

/**
 * Act a Fact onto the reel.
 *
 * @param {object} params
 * @param {string} params.beingId   actor (I_AM for scaffold flows)
 * @param {string} params.action    operation or sub-event name
 * @param {string} [params.verb="do"]   "do" | "be"
 * @param {{kind:string,id:string}|null} [params.target]  what was acted on
 * @param {*} [params.params]       input payload (any JSON; clipped on cap)
 * @param {*} [params.result]       output payload (any JSON; clipped on cap)
 * @param {string|null} [params.actId]   correlation
 * @param {string|null} [params.sessionId]  correlation
 * @param {string|null} [params.homeReality]   federation provenance
 * @param {boolean} [params.wasRemote=false] federation provenance
 *
 * The `beforeFact` hook receives a mutable view of these fields and may
 * cancel the stamp or enrich the payload before insert.
 */
export async function logFact(input) {
  if (!input || typeof input !== "object") {
    throw new Error("logFact requires a params object");
  }
  const {
    beingId,
    verb = "do",
    action,
    target = null,
    params = null,
    result = null,
    actId = null,
    sessionId = null,
    homeReality = null,
    wasRemote = false,
  } = input;

  if (!beingId || !action) {
    throw new Error("logFact requires beingId and action");
  }
  if (typeof action !== "string" || action.length > MAX_ACTION_LENGTH) {
    throw new Error(
      `logFact: action must be a string under ${MAX_ACTION_LENGTH} chars`,
    );
  }
  if (!VALID_VERBS.has(verb)) {
    throw new Error(
      `logFact: verb must be one of ${[...VALID_VERBS].join("|")}`,
    );
  }

  let normalizedTarget = null;
  if (target && typeof target === "object") {
    if (target.kind && !VALID_TARGET_KINDS.has(target.kind)) {
      throw new Error(
        `logFact: target.kind must be one of ${[...VALID_TARGET_KINDS].join("|")}`,
      );
    }
    if (target.kind || target.id) {
      normalizedTarget = {
        kind: target.kind || null,
        id: target.id != null ? String(target.id) : null,
      };
    }
  }

  // beforeFact hook . extensions can modify or cancel. The hook sees a
  // mutable view; only `params` and `result` are conventionally mutated
  // for enrichment. Cancellations short-circuit the stamp.
  const hookData = {
    beingId,
    verb,
    action,
    target: normalizedTarget,
    params,
    result,
    actId,
    sessionId,
    homeReality,
    wasRemote,
  };
  const hookResult = await hooks.run("beforeFact", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? IBP_ERR.HOOK_TIMEOUT : IBP_ERR.HOOK_CANCELLED;
    throw new IbpError(code,
      `Fact cancelled: ${hookResult.reason || "extension"}`,
    );
  }

  const cappedParams = capPayload(hookData.params, "params");
  const cappedResult = capPayload(hookData.result, "result");
  const truncated = cappedParams.truncated || cappedResult.truncated;

  const finalTarget = hookData.target || normalizedTarget;

  const baseDoc = {
    beingId,
    verb,
    action,
    target: finalTarget,
    params: cappedParams.value,
    result: cappedResult.value,
    truncated,
    actId,
    sessionId,
    homeReality: hookData.homeReality ?? homeReality,
    wasRemote: Boolean(hookData.wasRemote ?? wasRemote),
    date: new Date(),
  };

  // Reel-bearing path: allocate seq + insert under the per-reel append
  // lock. Per STAMPER.md, pairing them eliminates the transient-gap
  // window where a slow inserter could leave its seq stranded behind
  // the fold marker. The critical section is microscopic: one $inc and
  // one insert. Different reels run in parallel; only same-reel writes
  // serialize at this instant.
  //
  // Target-less or place/stance facts skip the lock — they have no
  // reel and stay outside the fold model.
  if (finalTarget && REEL_KINDS.has(finalTarget.kind) && finalTarget.id) {
    try {
      await withReelLock(finalTarget.kind, finalTarget.id, async () => {
        const seq = await allocSeq(finalTarget.kind, finalTarget.id);
        await Fact.create({ ...baseDoc, seq });
      });
    } catch (err) {
      log.error("DB", `Fact append failed (${action} on ${finalTarget.kind}:${finalTarget.id}): ${err.message}`);
      throw new Error("Failed to stamp Fact");
    }

    // Eager-fold. Per STAMPER.md Decision: "eager-fold is an inline
    // call to `fold(target)`. Not a second projection-writer." The
    // fold engine's compare-and-set handles concurrency; failure here
    // is harmless — the next fold round self-heals.
    //
    // Dynamic import to avoid a hard cycle at module load time
    // (foldEngine imports from materials/, past/fact/facts is in
    // materials/ — keeping the dependency lazy keeps boot order clean).
    try {
      const { fold } = await import("../../present/fold/foldEngine.js");
      await fold(finalTarget.kind, finalTarget.id);
    } catch (err) {
      // Self-healing: the next fold catches up. Log but don't throw —
      // the fact is the source of truth and is already on disk.
      log.debug("Fold", `eager-fold failed for ${finalTarget.kind}:${finalTarget.id}: ${err.message}`);
    }
  } else {
    // Non-reel-bearing path: simple insert, seq stays null.
    try {
      await Fact.create({ ...baseDoc, seq: null });
    } catch (err) {
      log.error("DB", `Fact save failed (${action}): ${err.message}`);
      throw new Error("Failed to stamp Fact");
    }
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
    Math.min(Number(getInternalConfigValue("factQueryLimit")) || 5000, 50000),
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
 * Get the Fact reel for a space.
 * If beingId is provided, verifies the caller has access to the space's tree.
 * Seed-internal callers (hooks, migrations) can omit beingId.
 */
export async function getFacts({
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

  const facts = await Fact.find(query)
    .populate("beingId", "name")
    .sort({ date: -1 })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return { facts, limit: safeLimit };
}

/**
 * Get a being's Fact reel.
 */
export async function getFactsByBeing(beingId, limit, startDate, endDate) {
  if (!beingId) throw new Error("Missing required parameter: beingId");

  const query = { beingId, ...buildDateFilter(startDate, endDate) };
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );

  const facts = await Fact.find(query)
    .populate("beingId", "name")
    .sort({ date: -1 })
    .limit(safeLimit)
    .lean();

  return { facts };
}
