// Prune Job
//
// Runs on a configurable interval. For each tree with autoPrune enabled,
// scans for dead nodes and trims them. The seasonal cycle.
//
// Trees opt in via metadata.prune.autoPrune = true on the root.
// Default off. The tree doesn't shed leaves unless the operator says so.

import log from "../../seed/log.js";
import { scanForCandidates, confirmPrune } from "./core.js";

let Node = null;
let User = null;
let _metadata = null;
export function setModels(models) { Node = models.Node; User = models.User; }
export function setMetadata(metadata) { _metadata = metadata; }

let _timer = null;

async function getIntervalMs() {
  try {
    const { getLandConfigValue } = await import("../../seed/landConfig.js");
    return Number(getLandConfigValue("pruneIntervalMs")) || 7 * 24 * 60 * 60 * 1000; // weekly default
  } catch {
    return 7 * 24 * 60 * 60 * 1000;
  }
}

export async function startPruneJob() {
  if (_timer) return;
  const interval = await getIntervalMs();
  _timer = setInterval(runPruneCycle, interval);
  if (_timer.unref) _timer.unref();
  log.info("Prune", `Prune job started (checking every ${Math.round(interval / (24 * 60 * 60 * 1000))}d)`);
}

export function stopPruneJob() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

async function runPruneCycle() {
  try {
    // Find trees with autoPrune enabled
    const roots = await Node.find({
      rootOwner: { $nin: [null, "SYSTEM"] },
      "metadata.prune.autoPrune": true,
    }).select("_id name rootOwner metadata").lean();

    if (roots.length === 0) return;

    log.verbose("Prune", `Prune cycle: ${roots.length} tree(s) opted in for auto-prune`);

    for (const root of roots) {
      try {
        const pruneMeta = _metadata.getExtMeta(root, "prune");
        if (pruneMeta.paused) continue;

        const userId = root.rootOwner?.toString();
        if (!userId) continue;

        const user = await User.findById(userId).select("username").lean();
        if (!user) continue;

        // Scan
        const candidates = await scanForCandidates(root._id.toString(), userId);
        if (candidates.length === 0) continue;

        log.verbose("Prune", `Auto-pruning ${candidates.length} node(s) from ${root.name}`);

        // Confirm (absorb + trim)
        await confirmPrune(root._id.toString(), userId, user.username);
      } catch (err) {
        log.warn("Prune", `Auto-prune failed for tree ${root.name}: ${err.message}`);
      }
    }
  } catch (err) {
    log.error("Prune", `Prune cycle error: ${err.message}`);
  }
}
