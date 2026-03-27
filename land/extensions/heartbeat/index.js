/**
 * Heartbeat
 *
 * The tree knows it's alive.
 */

import log from "../../seed/log.js";

// In-memory only. Resets on restart. That's the point.
let lastInteraction = 0;
const activeSessions = new Set();

const ALIVE_THRESHOLD = 5 * 60 * 1000;    // 5 min
const QUIET_THRESHOLD = 30 * 60 * 1000;   // 30 min

export async function init(core) {
  core.hooks.register("afterLLMCall", async ({ userId, sessionId }) => {
    if (!userId || userId === "SYSTEM") return;
    lastInteraction = Date.now();
    if (sessionId) activeSessions.add(sessionId);
  }, "heartbeat");

  core.hooks.register("afterNavigate", async ({ userId, sessionId }) => {
    if (!userId) return;
    lastInteraction = Date.now();
    if (sessionId) activeSessions.add(sessionId);
  }, "heartbeat");

  // Prune stale sessions every 5 min
  const pruneTimer = setInterval(() => {
    if (Date.now() - lastInteraction > QUIET_THRESHOLD) {
      activeSessions.clear();
    }
  }, ALIVE_THRESHOLD);
  if (pruneTimer.unref) pruneTimer.unref();

  core.hooks.register("enrichContext", async ({ context }) => {
    if (lastInteraction === 0) return; // never had a heartbeat

    const age = Date.now() - lastInteraction;

    if (age < ALIVE_THRESHOLD) {
      context.landHeartbeat = "alive";
    } else if (age < QUIET_THRESHOLD) {
      context.landHeartbeat = "quiet";
    } else {
      context.landHeartbeat = "dormant";
    }
  }, "heartbeat");

  log.verbose("Heartbeat", "Heartbeat loaded");

  return {
    stop: () => clearInterval(pruneTimer),
  };
}
