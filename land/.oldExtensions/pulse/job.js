/**
 * Pulse Background Job
 *
 * Runs on a configurable interval (default 60 seconds).
 * Queries .flow for all results since the last check,
 * builds a health snapshot, and writes it to .pulse.
 */

import log from "../../seed/log.js";
import { buildHealthSnapshot, writeSnapshot, getPulseConfig } from "./core.js";

let jobTimer = null;

async function tick() {
  try {
    const snapshot = await buildHealthSnapshot();

    // Only write if there's any activity (avoid spamming empty notes on quiet lands)
    if (snapshot.results > 0 || snapshot.elevated) {
      await writeSnapshot(snapshot);
    }
  } catch (err) {
    log.error("Pulse", `Health check failed: ${err.message}`);
  }
}

export async function startPulseJob() {
  if (jobTimer) clearInterval(jobTimer);

  const config = await getPulseConfig();
  const interval = config.intervalMs;

  jobTimer = setInterval(tick, interval);
  log.info("Pulse", `Health check started (interval: ${interval / 1000}s)`);

  // Run once immediately on startup
  tick();

  return jobTimer;
}

export function stopPulseJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    log.info("Pulse", "Health check stopped");
  }
}
