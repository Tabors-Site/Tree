// Boundary Job
//
// Runs on a configurable interval. For each tree with autoBoundary enabled,
// re-analyzes structural cohesion if the previous report is marked stale.
//
// Trees opt in via metadata.boundary.autoBoundary = true on the root.
// Default off. Trees don't need boundary analysis on a schedule unless
// the operator decides they do.

import log from "../../seed/log.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import { analyze } from "./core.js";

let Node = null;
let User = null;
export function setModels(models) { Node = models.Node; User = models.User; }

let _timer = null;

async function getIntervalMs() {
  try {
    const { getLandConfigValue } = await import("../../seed/landConfig.js");
    return Number(getLandConfigValue("boundaryIntervalMs")) || 7 * 24 * 60 * 60 * 1000; // weekly
  } catch {
    return 7 * 24 * 60 * 60 * 1000;
  }
}

export async function startBoundaryJob() {
  if (_timer) return;
  const interval = await getIntervalMs();
  _timer = setInterval(runBoundaryCycle, interval);
  if (_timer.unref) _timer.unref();
  log.info("Boundary", `Boundary job started (checking every ${Math.round(interval / (24 * 60 * 60 * 1000))}d)`);
}

export function stopBoundaryJob() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

async function runBoundaryCycle() {
  try {
    // Find trees with autoBoundary enabled
    const roots = await Node.find({
      rootOwner: { $nin: [null, "SYSTEM"] },
      "metadata.boundary.autoBoundary": true,
    }).select("_id name rootOwner metadata").lean();

    if (roots.length === 0) return;

    log.verbose("Boundary", `Boundary cycle: ${roots.length} tree(s) opted in for auto-analysis`);

    for (const root of roots) {
      try {
        const boundaryMeta = getExtMeta(root, "boundary");
        if (boundaryMeta.paused) continue;

        // Only re-analyze if stale or never analyzed
        if (!boundaryMeta.stale && boundaryMeta.lastAnalysis) continue;

        const userId = root.rootOwner?.toString();
        if (!userId) continue;

        const user = await User.findById(userId).select("username").lean();
        if (!user) continue;

        log.verbose("Boundary", `Auto-analyzing boundary for tree ${root.name}`);
        await analyze(root._id.toString(), userId, user.username);
      } catch (err) {
        log.warn("Boundary", `Auto-boundary failed for tree ${root.name}: ${err.message}`);
      }
    }
  } catch (err) {
    log.error("Boundary", `Boundary cycle error: ${err.message}`);
  }
}
