/**
 * Retry Job
 *
 * Background job that periodically scans .flow for failed cascade hops
 * and retries them. Respects the propagationRetries config.
 */

import log from "../../seed/log.js";
import { retryFailedHops } from "./core.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let jobTimer = null;

async function run() {
  try {
    const { retried, succeeded } = await retryFailedHops();
    if (retried > 0) {
      log.verbose("Propagation", `Retry sweep: ${succeeded}/${retried} recovered`);
    }
  } catch (err) {
    log.error("Propagation", `Retry job error: ${err.message}`);
  }
}

export function startRetryJob({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(run, intervalMs);
  log.info("Propagation", `Retry job started (interval: ${intervalMs / 1000}s)`);
  return jobTimer;
}

export function stopRetryJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    log.info("Propagation", "Retry job stopped");
  }
}
