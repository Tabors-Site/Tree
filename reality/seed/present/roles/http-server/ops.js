// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// http-server ops. One SEE op: http-stats — the live in-memory
// request counters (seed/materials/host/requestLog.js). Pure read,
// no facts; the role-walk gates by canSee (infra roles + angel).

import { registerSeeOperation } from "../../../ibp/seeOps.js";

export function registerHttpServerOps() {
  // Registrations below run at module load; this is the explicit
  // entry point genesis.js calls, same pattern as federation-manager.
}

registerSeeOperation("http-stats", {
  description:
    "Live HTTP counters: totals, per-route counts (uuid segments " +
    "collapsed), status classes, bytes, queue depth, since.",
  args: {},
  handler: async () => {
    const { getHttpStats } = await import("../../../materials/host/requestLog.js");
    return getHttpStats();
  },
});
