import log from "../seed/log.js";
import CanopyEvent from "./models/canopyEvent.js";
import { signCanopyToken } from "./identity.js";
import { getPeerByDomain, getPeerBaseUrl } from "./peers.js";
import { getLandConfigValue } from "../seed/landConfig.js";

let OUTBOX_INTERVAL_MS = 60 * 1000; // Process outbox every 60 seconds
let MAX_RETRIES = 5;
let EVENT_DELIVERY_TIMEOUT_MS = 15000;
let DEST_LIMIT_PER_CYCLE = 10;

let outboxTimer = null;

/**
 * Queue a canopy event for delivery to a remote land.
 * Events are stored in the database and processed by the outbox worker.
 */
export async function queueCanopyEvent(targetLand, type, payload) {
  return CanopyEvent.create({
    targetLand,
    type,
    payload,
    status: "pending",
  });
}

/**
 * Process a single event. Attempts delivery to the target land.
 */
async function processEvent(event) {
  const peer = await getPeerByDomain(event.targetLand);

  if (!peer) {
    event.status = "failed";
    event.lastAttemptAt = new Date();
    await event.save();
    return false;
  }

  if (peer.status === "blocked") {
    event.status = "failed";
    event.lastAttemptAt = new Date();
    await event.save();
    return false;
  }

  // Map event type to canopy endpoint
  const endpointMap = {
    invite_offer: "/canopy/invite/offer",
    invite_accept: "/canopy/invite/accept",
    invite_decline: "/canopy/invite/decline",
    notification: "/canopy/notify",
    tree_update: "/canopy/notify",
  };

  const endpoint = endpointMap[event.type];
  if (!endpoint) {
    event.status = "failed";
    await event.save();
    return false;
  }

  const baseUrl = getPeerBaseUrl(peer);
  const url = `${baseUrl}${endpoint}`;

  // Sign with a generic system token (no specific user)
  const token = await signCanopyToken("system", event.targetLand);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `CanopyToken ${token}`,
      },
      body: JSON.stringify(event.payload),
      signal: AbortSignal.timeout(EVENT_DELIVERY_TIMEOUT_MS),
    });

    event.lastAttemptAt = new Date();

    if (res.ok) {
      event.status = "sent";
      await event.save();
      return true;
    }

    // Non-retryable errors
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      event.status = "failed";
      await event.save();
      return false;
    }

    // Retryable error
    event.retryCount += 1;
    if (event.retryCount >= event.maxRetries) {
      event.status = "failed";
    }
    await event.save();
    return false;
  } catch {
    event.lastAttemptAt = new Date();
    event.retryCount += 1;
    if (event.retryCount >= event.maxRetries) {
      event.status = "failed";
    }
    await event.save();
    return false;
  }
}

/**
 * Process all pending events in the outbox.
 */
export async function processOutbox() {
  const events = await CanopyEvent.find({
    status: "pending",
    retryCount: { $lt: MAX_RETRIES },
  })
    .sort({ createdAt: 1 })
    .limit(50);

  if (events.length === 0) return { processed: 0, sent: 0, failed: 0 };

  const results = { processed: 0, sent: 0, failed: 0 };
  const destCounts = new Map(); // Per-destination rate limit

  for (const event of events) {
    // Exponential backoff: wait 1min, 2min, 4min, 8min, 16min between retries
    if (event.retryCount > 0 && event.lastAttemptAt) {
      const backoffMs = Math.min(60000 * Math.pow(2, event.retryCount - 1), 16 * 60000);
      if (Date.now() - event.lastAttemptAt.getTime() < backoffMs) continue;
    }

    // Per-destination rate limit to prevent flooding any single land
    const destCount = destCounts.get(event.targetLand) || 0;
    if (destCount >= DEST_LIMIT_PER_CYCLE) continue;
    destCounts.set(event.targetLand, destCount + 1);

    results.processed++;
    const sent = await processEvent(event);
    if (sent) results.sent++;
    else results.failed++;
  }

  return results;
}

/**
 * Start the outbox processing job.
 */
export function startOutboxJob() {
  if (outboxTimer) return;

  // Read canopy event config from land config at job start time
  OUTBOX_INTERVAL_MS        = Number(getLandConfigValue("canopyOutboxInterval"))        || OUTBOX_INTERVAL_MS;
  MAX_RETRIES               = Number(getLandConfigValue("canopyMaxRetries"))             || MAX_RETRIES;
  EVENT_DELIVERY_TIMEOUT_MS = Number(getLandConfigValue("canopyEventDeliveryTimeout"))   || EVENT_DELIVERY_TIMEOUT_MS;
  DEST_LIMIT_PER_CYCLE      = Number(getLandConfigValue("canopyDestLimitPerCycle"))      || DEST_LIMIT_PER_CYCLE;

  outboxTimer = setInterval(async () => {
    try {
      const results = await processOutbox();
      if (results.processed > 0) {
        log.verbose("Canopy",
          `[Canopy] Outbox: ${results.sent} sent, ${results.failed} failed out of ${results.processed}`
        );
      }
    } catch (err) {
      log.error("Canopy", "Outbox error:", err.message);
    }
  }, OUTBOX_INTERVAL_MS);

  log.verbose("Canopy", "Outbox job started (every 60s)");
}

/**
 * Get pending event count (for admin/status display).
 */
export async function getPendingEventCount() {
  return CanopyEvent.countDocuments({ status: "pending" });
}

/**
 * Get failed events for review.
 */
export async function getFailedEvents(limit = 20) {
  return CanopyEvent.find({ status: "failed" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Retry a specific failed event.
 */
export async function retryEvent(eventId) {
  const event = await CanopyEvent.findById(eventId);
  if (!event) return null;

  event.status = "pending";
  event.retryCount = 0;
  await event.save();

  return processEvent(event);
}

/**
 * Canopy event retention cleanup.
 * Deletes sent/acked/failed events older than configured days.
 * Runs daily alongside the kernel retention job.
 */
let retentionTimer = null;

export async function runCanopyRetention() {
  const { getLandConfigValue } = await import("../seed/landConfig.js");
  const days = Number(getLandConfigValue("canopyEventRetentionDays")) || 30;
  if (days <= 0) return;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const result = await CanopyEvent.deleteMany({
      status: { $in: ["sent", "acked", "failed"] },
      createdAt: { $lt: cutoff },
    });
    if (result.deletedCount > 0) {
      log.info("Canopy", `Deleted ${result.deletedCount} canopy events older than ${days} days`);
    }
  } catch (err) {
    log.error("Canopy", "Event retention cleanup failed:", err.message);
  }
}

export function startCanopyRetentionJob() {
  runCanopyRetention().catch(() => {});
  retentionTimer = setInterval(() => {
    runCanopyRetention().catch(() => {});
  }, 24 * 60 * 60 * 1000);
  retentionTimer.unref();
}
