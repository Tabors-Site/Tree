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
// Defaults to OFF (treeCircuitEnabled: false). A story that never
// turns this on lives without it.

import log from "../../seedStory/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import Space from "./space.js";
import Fact from "../../past/fact/fact.js";
import { hooks } from "../../hooks.js";
import { getStoryConfigValue } from "../../storyConfig.js";
import { invalidateSpace } from "./ancestorCache.js";
import { resolveSpaceAccess } from "./spaces.js";
import { I_AM } from "../being/seedBeings.js";
import { emitFact } from "../../past/fact/facts.js";

/**
 * Is the tree-circuit feature enabled on this story?
 */
function isEnabled() {
  const val = getInternalConfigValue("treeCircuitEnabled");
  return val === true || val === "true";
}

/**
 * Is the tree alive (not tripped)? Fast check: reads the anchor
 * space's qualities.circuit.tripped field.
 *
 * @param {string} treeId - id of the tree's anchor space (owner-bearing)
 * @returns {Promise<boolean>} true if alive, false if tripped
 */
export async function isTreeAlive(treeId) {
  if (!treeId) return true;
  if (!isEnabled()) return true;

  const { loadProjection } = await import("../projections.js");
  const slot = await loadProjection("space", treeId, "0");
  if (!slot) return true;

  const quals = slot.state?.qualities;
  const meta = quals instanceof Map ? quals.get("circuit") : quals?.circuit;

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
  const spaceCount = await Space.countDocuments({ owner: treeId });

  // 2. Quality density (estimate total qualities-map size). Sample up to
  //    100 spaces, average, multiply. Random sample — sequential
  //    underestimates because newer spaces accumulate extension data.
  const sampleSize = Math.min(spaceCount, 100);
  let qualitiesDensity = 0;
  if (sampleSize > 0) {
    const sample = await Space.aggregate([
      { $match: { owner: treeId } },
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
          "of.kind": "space",
          "params.error": { $exists: true },
        },
      },
      { $lookup: { from: "spaces", localField: "of.id", foreignField: "_id", as: "_space" } },
      { $unwind: "$_space" },
      { $match: { "_space.owner": treeId } },
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
 * Trip a tree's circuit breaker on a specific history.
 *
 * Each history has its own circuit state — a tree that goes haywire
 * on a history trips ONLY that history's view, leaving other histories
 * untouched. Callers MUST pass the history they're operating in;
 * there's no silent main-bias.
 *
 * @param {string} treeId
 * @param {string} reason
 * @param {object} [opts]
 * @param {string} opts.history - history the trip lands on (required)
 * @param {object} [opts.scores] - health scores at time of trip
 */
export async function tripTree(treeId, reason, opts = {}) {
  if (!reason || typeof reason !== "string") reason = "Unknown";
  if (reason.length > 500) reason = reason.slice(0, 500);

  const history = opts.history;
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      "tripTree: opts.history is required. Each history tracks its own circuit; no silent main-bias.",
    );
  }
  const scores = opts.scores || {};

  const circuit = {
    tripped:   true,
    reason,
    timestamp: new Date().toISOString(),
    scores,
  };

  // Wrap in withIAmAct so the trip Fact rides an Act on the I-Am's
  // chain. "Every fact comes from an act" (MOMENT.md) — even
  // substrate-internal health-monitor writes. The I-Am is the
  // structural actor for background substrate housekeeping.
  const { withIAmAct } = await import("../../sprout.js");
  await withIAmAct(`Circuit: trip tree ${String(treeId).slice(0, 8)} on #${history}`, async (ctx) => {
    await emitFact({
      verb:    "do",
      act:     "set-space",
      through: I_AM,
      of:      { kind: "space", id: String(treeId) },
      params:  { field: "qualities.circuit", value: circuit, merge: false },
      // Each history carries its own circuit state. A tree that goes
      // haywire on history #4 stays alive on main; operators see the
      // circuit on the history they're inhabiting. Cross-history
      // contamination would defeat the whole point of branching.
      history: history,
    }, ctx);
  });
  invalidateSpace(treeId, history);

  log.warn("Circuit", `Tree ${treeId} tripped on #${history}: ${reason}`);

  hooks.run("onTreeTripped", { treeId, history, reason, scores, timestamp: circuit.timestamp })
    .catch(err => log.debug("Circuit", `onTreeTripped hook error: ${err.message}`));
}

/**
 * Revive a tripped tree. Only the tree's owner can revive.
 *
 * @param {string} treeId
 * @param {string} beingId - the caller (required for authorization)
 */
export async function reviveTree(treeId, beingId, history) {
  if (!treeId)  throw new Error("treeId is required");
  if (!beingId) throw new Error("beingId is required");
  if (typeof history !== "string" || !history) throw new Error("reviveTree: history is required");

  const access = await resolveSpaceAccess(treeId, beingId, history);
  if (!access.ok || !access.isOwner) {
    // Admin bypass retired 2026-05-18; able-walk gates
    // non-owner revival policies. For now: owner only.
    throw new Error("Only the tree's owner can revive a tripped tree");
  }

  const { loadProjection: _lP2 } = await import("../projections.js");
  const _slot2 = await _lP2("space", treeId, "0");
  if (!_slot2) throw new Error("Tree not found");
  const _q2 = _slot2.state?.qualities;
  const anchor = { _id: _slot2.id, qualities: _q2 };
  const circuit = _q2 instanceof Map ? _q2.get("circuit") : _q2?.circuit;
  if (!circuit?.tripped) return; // already alive, no-op

  // Wrap the revive Fact in the operator's own moment via
  // withBeingAct so it rides their Act-chain. "Every fact comes from
  // an act" (MOMENT.md) — the operator's intentional revive is a
  // moment in their biography. The revive lands on the SAME history
  // the trip was on (the operator only sees the tripped state for
  // the history they're inhabiting); cross-history revives would
  // accidentally clear other histories' circuits.
  const { withBeingAct } = await import("../../sprout.js");
  await withBeingAct(String(beingId), `Circuit: revive tree ${String(treeId).slice(0, 8)} on #${history}`, history, async (ctx) => {
    await emitFact({
      verb:    "do",
      act:     "set-space",
      through: String(beingId),
      of:      { kind: "space", id: String(treeId) },
      params:  { field: "qualities.circuit", value: { tripped: false }, merge: false },
      history: history,
    }, ctx);
  });
  invalidateSpace(treeId, history);

  log.info("Circuit", `Tree ${treeId} revived by ${beingId} on #${history}`);

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
      const { default: Projection } = await import("../history/projection.js");
      // Filter to non-system owners: owner set AND not the I_AM
      // sentinel string (system-owned spaces).
      const rows = await Projection.find({
        history: "0", type: "space",
        "state.owner": { $exists: true, $ne: I_AM, $nin: [null] },
        tombstoned: { $ne: true },
      }).lean();
      const anchors = rows.map((s) => ({ _id: s.id, ...(s.state || {}) }));

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
