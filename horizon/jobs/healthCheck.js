import Place from "../db/models/place.js";

const HEALTH_CHECK_INTERVAL =
  parseInt(process.env.HEALTH_CHECK_INTERVAL) || 600000; // 10 minutes

const DEGRADED_THRESHOLD = 3;
const UNREACHABLE_THRESHOLD = 12;
const DEAD_DAYS = 30;

let intervalId = null;

/**
 * Ping a single place and update its status based on the response.
 */
async function checkPlace(place) {
  const url = `${place.baseUrl}/canopy/info`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      // Extract seedVersion from the /canopy/info response
      try {
        const info = await response.json();
        if (info.seedVersion) {
          place.seedVersion = info.seedVersion;
          const [maj, min, pat] = info.seedVersion.split(".").map(Number);
          place.seedVersionNumeric = maj * 10000 + min * 100 + (pat || 0);
        }
      } catch {
        // Response body parse failure is non-fatal for health check
      }

      place.lastSeenAt = new Date();
      place.lastHealthCheck = new Date();
      place.failedChecks = 0;
      place.status = "active";
      await place.save();
      return;
    }

    // Non-ok response counts as a failure
    await recordFailure(place);
  } catch {
    await recordFailure(place);
  }
}

/**
 * Record a health check failure and update place status accordingly.
 */
async function recordFailure(place) {
  place.failedChecks += 1;
  place.lastHealthCheck = new Date();

  if (place.failedChecks >= UNREACHABLE_THRESHOLD) {
    place.status = "unreachable";
  } else if (place.failedChecks >= DEGRADED_THRESHOLD) {
    place.status = "degraded";
  }

  await place.save();
}

/**
 * Run a full health check cycle across all active and degraded places.
 * Also marks places that have been unreachable for 30+ days as dead.
 */
async function runHealthChecks() {
  try {
    // Mark long-unreachable places as dead
    const deadCutoff = new Date(Date.now() - DEAD_DAYS * 24 * 60 * 60 * 1000);
    await Place.updateMany(
      {
        status: "unreachable",
        lastSeenAt: { $lt: deadCutoff },
      },
      { $set: { status: "dead" } }
    );

    // Check all active and degraded places
    const places = await Place.find({
      status: { $in: ["active", "degraded", "unreachable"] },
    });

    console.log(`[Horizon] Health check starting for ${places.length} places`);

    // Run checks in parallel with a concurrency limit
    const batchSize = 10;
    for (let i = 0; i < places.length; i += batchSize) {
      const batch = places.slice(i, i + batchSize);
      await Promise.allSettled(batch.map((place) => checkPlace(place)));
    }

    console.log("[Horizon] Health check complete");
  } catch (err) {
    console.error("[Horizon] Health check error:", err.message);
  }
}

/**
 * Start the periodic health check job.
 */
export function startHealthCheckJob() {
  if (intervalId) return;
  console.log(
    `[Horizon] Health check job started. Interval: ${HEALTH_CHECK_INTERVAL / 1000}s`
  );
  intervalId = setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop the periodic health check job.
 */
export function stopHealthCheckJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[Horizon] Health check job stopped");
  }
}
