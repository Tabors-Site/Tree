import CanopyEvent from "../db/models/canopyEvent.js";
import { signCanopyToken } from "./identity.js";
import { getPeerByDomain, getPeerBaseUrl } from "./peers.js";

const OUTBOX_INTERVAL_MS = 60 * 1000; // Process outbox every 60 seconds
const MAX_RETRIES = 5;

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
    energy_report: "/canopy/energy/report",
    notification: "/canopy/notify",
    tree_update: "/canopy/notify",
    account_transfer: "/canopy/account/transfer-in",
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
      signal: AbortSignal.timeout(15000),
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
  const destCounts = new Map(); // Per-destination rate limit (max 10 per cycle)
  const DEST_LIMIT_PER_CYCLE = 10;

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

  outboxTimer = setInterval(async () => {
    try {
      const results = await processOutbox();
      if (results.processed > 0) {
        console.log(
          `[Canopy] Outbox: ${results.sent} sent, ${results.failed} failed out of ${results.processed}`
        );
      }
    } catch (err) {
      console.error("[Canopy] Outbox error:", err.message);
    }
  }, OUTBOX_INTERVAL_MS);

  console.log("[Canopy] Outbox job started (every 60s)");
}

/**
 * Stop the outbox processing job.
 */
export function stopOutboxJob() {
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
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
