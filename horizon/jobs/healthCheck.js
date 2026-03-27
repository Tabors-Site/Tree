import Land from "../db/models/land.js";

const HEALTH_CHECK_INTERVAL =
  parseInt(process.env.HEALTH_CHECK_INTERVAL) || 600000; // 10 minutes

const DEGRADED_THRESHOLD = 3;
const UNREACHABLE_THRESHOLD = 12;
const DEAD_DAYS = 30;

let intervalId = null;

/**
 * Ping a single land and update its status based on the response.
 */
async function checkLand(land) {
  const url = `${land.baseUrl}/canopy/info`;

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
          land.seedVersion = info.seedVersion;
          const [maj, min, pat] = info.seedVersion.split(".").map(Number);
          land.seedVersionNumeric = maj * 10000 + min * 100 + (pat || 0);
        }
      } catch {
        // Response body parse failure is non-fatal for health check
      }

      land.lastSeenAt = new Date();
      land.lastHealthCheck = new Date();
      land.failedChecks = 0;
      land.status = "active";
      await land.save();
      return;
    }

    // Non-ok response counts as a failure
    await recordFailure(land);
  } catch {
    await recordFailure(land);
  }
}

/**
 * Record a health check failure and update land status accordingly.
 */
async function recordFailure(land) {
  land.failedChecks += 1;
  land.lastHealthCheck = new Date();

  if (land.failedChecks >= UNREACHABLE_THRESHOLD) {
    land.status = "unreachable";
  } else if (land.failedChecks >= DEGRADED_THRESHOLD) {
    land.status = "degraded";
  }

  await land.save();
}

/**
 * Run a full health check cycle across all active and degraded lands.
 * Also marks lands that have been unreachable for 30+ days as dead.
 */
async function runHealthChecks() {
  try {
    // Mark long-unreachable lands as dead
    const deadCutoff = new Date(Date.now() - DEAD_DAYS * 24 * 60 * 60 * 1000);
    await Land.updateMany(
      {
        status: "unreachable",
        lastSeenAt: { $lt: deadCutoff },
      },
      { $set: { status: "dead" } }
    );

    // Check all active and degraded lands
    const lands = await Land.find({
      status: { $in: ["active", "degraded", "unreachable"] },
    });

    console.log(`[Horizon] Health check starting for ${lands.length} lands`);

    // Run checks in parallel with a concurrency limit
    const batchSize = 10;
    for (let i = 0; i < lands.length; i += batchSize) {
      const batch = lands.slice(i, i + batchSize);
      await Promise.allSettled(batch.map((land) => checkLand(land)));
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
