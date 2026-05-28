// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Space-tree circuit breaker.
//
// Throughout this file "tree" is shorthand for **space-tree**: an
// owned subtree of spaces, the connected descendants of a space
// whose `rootOwner` is set. Not a single space. (The place root is
// the singular root of the whole place; an owned space-tree's anchor
// is an ownership boundary, not a root.)
//
// When the spaces in an owned space-tree exceed health thresholds, I
// trip its circuit. No SUMMON-driven cognition runs there. No tool
// calls place. No writes proceed. The data stays intact; the
// space-tree is sleeping, not dead.
//
// Health equation:
//
//   treeHealth = (spaceCount       / maxTreeSpaces)         * spaceWeight
//              + (qualitiesDensity  / maxTreeQualityBytes)   * densityWeight
//              + (errorRate         / maxTreeErrorRate)      * errorWeight
//
// When treeHealth > 1.0, the tree trips. I write
// qualities.circuit = { tripped: true, reason, timestamp, scores } on
// the tree's anchor space. One quality write.
//
// I trip; extensions heal; I do not auto-revive. Callers invoke
// reviveTree(treeId, beingId) when satisfied. The owner is the only
// being who can revive — the same being whose authority defines the
// tree in the first place.
//
// Defaults to OFF (treeCircuitEnabled: false). A reality that never
// turns this on lives without it.

import log from "../../seedReality/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import Space from "./space.js";
import Fact from "../../past/fact/fact.js";
import { hooks } from "../../hooks.js";
import { getRealityConfigValue } from "../../realityConfig.js";
import { invalidateSpace } from "./ancestorCache.js";
import { resolveSpaceAccess } from "./spaces.js";
import { I_AM } from "../being/seedBeings.js";
import { emitFact } from "../../past/fact/facts.js";

/**
 * Is the tree-circuit feature enabled on this reality?
 */
function isEnabled() {
  const val = getInternalConfigValue("treeCircuitEnabled");
  return val === true || val === "true";
}

/**
 * Is the tree alive (not tripped)? Fast check: reads the anchor
 * space's qualities.circuit.tripped field.
 *
 * @param {string} treeId - id of the tree's anchor space (rootOwner-bearing)
 * @returns {Promise<boolean>} true if alive, false if tripped
 */
export async function isTreeAlive(treeId) {
  if (!treeId) return true;
  if (!isEnabled()) return true;

  const anchor = await Space.findById(treeId).select("qualities").lean();
  if (!anchor) return true;

  const meta = anchor.qualities instanceof Map
    ? anchor.qualities.get("circuit")
    : anchor.qualities?.circuit;

  return !meta?.tripped;
}

/**
 * Compute the tree's health score. Total > 1.0 means it should trip.
 *
 * Error rate reads from the Fact reel: rows whose `params.error` is
 * set, targeting a space in this tree.
 *
 * @param {string} treeId
 * @returns {Promise<{ total, spaceCount, qualitiesDensity, errorRate, raw }>}
 */
export async function checkTreeHealth(treeId) {
  const maxSpaces     = parseInt(getInternalConfigValue("maxTreeSpaces")        || "10000",      10);
  const maxQualBytes  = parseInt(getInternalConfigValue("maxTreeQualityBytes") || "1073741824", 10);
  const maxErrors     = parseInt(getInternalConfigValue("maxTreeErrorRate")     || "100",        10);
  const spaceWeight   = parseFloat(getInternalConfigValue("circuitSpaceWeight")   || "0.4");
  const densityWeight = parseFloat(getInternalConfigValue("circuitDensityWeight") || "0.3");
  const errorWeight   = parseFloat(getInternalConfigValue("circuitErrorWeight")   || "0.3");

  // 1. Space count in this tree.
  const spaceCount = await Space.countDocuments({ rootOwner: treeId });

  // 2. Quality density (estimate total qualities-map size). Sample up to
  //    100 spaces, average, multiply. Random sample — sequential
  //    underestimates because newer spaces accumulate extension data.
  const sampleSize = Math.min(spaceCount, 100);
  let qualitiesDensity = 0;
  if (sampleSize > 0) {
    const sample = await Space.aggregate([
      { $match: { rootOwner: treeId } },
      { $sample: { size: sampleSize } },
      { $project: { qualities: 1 } },
    ]);

    let totalSampleSize = 0;
    for (const s of sample) {
      try {
        const quals = s.qualities instanceof Map ? Object.fromEntries(s.qualities) : (s.qualities || {});
        totalSampleSize += Buffer.byteLength(JSON.stringify(quals), "utf8");
      } catch {
        totalSampleSize += 1024; // estimate 1KB on serialization failure
      }
    }
    qualitiesDensity = (totalSampleSize / sampleSize) * spaceCount;
  }

  // 3. Error rate. Fact reel failures on spaces in this tree.
  // Aggregation with $lookup so we don't load the descendant id list
  // into memory.
  const checkInterval = parseInt(getInternalConfigValue("circuitCheckInterval") || "3600000", 10);
  const since = new Date(Date.now() - checkInterval);

  let factErrors = 0;
  try {
    const errResult = await Fact.aggregate([
      {
        $match: {
          date: { $gte: since },
          "target.kind": "space",
          "params.error": { $exists: true },
        },
      },
      { $lookup: { from: "spaces", localField: "target.id", foreignField: "_id", as: "_space" } },
      { $unwind: "$_space" },
      { $match: { "_space.rootOwner": treeId } },
      { $count: "total" },
    ]);
    factErrors = errResult[0]?.total || 0;
  } catch {
    // Aggregation failure isn't itself an error to count.
  }

  const totalErrors = factErrors;

  const spaceScore   = maxSpaces    > 0 ? (spaceCount       / maxSpaces)    * spaceWeight   : 0;
  const densityScore = maxQualBytes > 0 ? (qualitiesDensity  / maxQualBytes) * densityWeight : 0;
  const errorScore   = maxErrors    > 0 ? (totalErrors      / maxErrors)    * errorWeight   : 0;
  const total = spaceScore + densityScore + errorScore;

  return {
    total,
    spaceCount:      spaceScore,
    qualitiesDensity: densityScore,
    errorRate:       errorScore,
    raw: {
      spaceCount,
      qualitiesDensityBytes: Math.round(qualitiesDensity),
      factErrors,
      totalErrors,
    },
  };
}

/**
 * Trip a tree's circuit breaker.
 *
 * @param {string} treeId
 * @param {string} reason
 * @param {object} [scores] - health scores at time of trip
 */
export async function tripTree(treeId, reason, scores = {}) {
  if (!reason || typeof reason !== "string") reason = "Unknown";
  if (reason.length > 500) reason = reason.slice(0, 500);

  const circuit = {
    tripped:   true,
    reason,
    timestamp: new Date().toISOString(),
    scores,
  };

  await emitFact({
    verb:    "do",
    action:  "set",
    beingId: I_AM,
    target:  { kind: "space", id: String(treeId) },
    params:  { field: "qualities.circuit", value: circuit, merge: false },
  }, null);
  invalidateSpace(treeId);

  log.warn("Circuit", `Tree ${treeId} tripped: ${reason}`);

  hooks.run("onTreeTripped", { treeId, reason, scores, timestamp: circuit.timestamp })
    .catch(err => log.debug("Circuit", `onTreeTripped hook error: ${err.message}`));
}

/**
 * Revive a tripped tree. Only the tree's owner can revive.
 *
 * @param {string} treeId
 * @param {string} beingId - the caller (required for authorization)
 */
export async function reviveTree(treeId, beingId) {
  if (!treeId)  throw new Error("treeId is required");
  if (!beingId) throw new Error("beingId is required");

  const access = await resolveSpaceAccess(treeId, beingId);
  if (!access.ok || !access.isOwner) {
    // Admin bypass retired 2026-05-18; stance authorization gates
    // non-owner revival policies. For now: owner only.
    throw new Error("Only the tree's owner can revive a tripped tree");
  }

  const anchor = await Space.findById(treeId).select("qualities").lean();
  if (!anchor) throw new Error("Tree not found");
  const circuit = anchor.qualities instanceof Map
    ? anchor.qualities.get("circuit")
    : anchor.qualities?.circuit;
  if (!circuit?.tripped) return; // already alive, no-op

  await emitFact({
    verb:    "do",
    action:  "set",
    beingId: String(beingId),
    target:  { kind: "space", id: String(treeId) },
    params:  { field: "qualities.circuit", value: { tripped: false }, merge: false },
  }, null);
  invalidateSpace(treeId);

  log.info("Circuit", `Tree ${treeId} revived by ${beingId}`);

  hooks.run("onTreeRevived", { treeId, timestamp: new Date().toISOString() })
    .catch(err => log.debug("Circuit", `onTreeRevived hook error: ${err.message}`));
}

/**
 * Start the background health-check job. No-op if treeCircuitEnabled
 * is false.
 */
export function startCircuitJob() {
  if (!isEnabled()) return null;

  const interval = parseInt(getInternalConfigValue("circuitCheckInterval") || "3600000", 10);

  const timer = setInterval(async () => {
    try {
      const anchors = await Space.find({
        rootOwner: { $nin: [null, I_AM] },
      }).select("_id name qualities").lean();

      for (const anchor of anchors) {
        const meta = anchor.qualities instanceof Map
          ? anchor.qualities.get("circuit")
          : anchor.qualities?.circuit;
        if (meta?.tripped) continue;

        const health = await checkTreeHealth(String(anchor._id));
        if (health.total > 1.0) {
          const reason =
            `Health score ${health.total.toFixed(2)}: ` +
            `spaces ${health.spaceCount.toFixed(2)}, ` +
            `density ${health.qualitiesDensity.toFixed(2)}, ` +
            `errors ${health.errorRate.toFixed(2)}`;
          await tripTree(String(anchor._id), reason, {
            spaceCount:      health.spaceCount,
            qualitiesDensity: health.qualitiesDensity,
            errorRate:       health.errorRate,
            total:           health.total,
          });
        }
      }
    } catch (err) {
      log.error("Circuit", "Health check job failed:", err.message);
    }
  }, interval);

  if (timer.unref) timer.unref();
  log.verbose("Circuit", `Tree health checks every ${Math.round(interval / 60000)}m`);
  return timer;
}
