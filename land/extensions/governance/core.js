import { SEED_VERSION } from "../../seed/version.js";

// Cache governance state in memory. TTL 1 hour.
let cachedState = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Parse comma-separated HORIZON_URL into an array of directory URLs.
 */
function getDirectoryUrls() {
  return (process.env.HORIZON_URL || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Returns 0 if either string is not valid semver.
 */
export function compareSemver(a, b) {
  const pa = String(a).match(/^(\d+)\.(\d+)\.(\d+)/);
  const pb = String(b).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!pa || !pb) return 0;

  for (let i = 1; i <= 3; i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Compute compatibility status for a directory's governance policy.
 */
function computeStatus(currentVersion, gov) {
  if (!gov.minimumSeedVersion && !gov.recommendedSeedVersion) {
    return "no_policy";
  }

  if (gov.minimumSeedVersion) {
    if (compareSemver(currentVersion, gov.minimumSeedVersion) < 0) {
      return "non_compliant";
    }
  }

  if (gov.recommendedSeedVersion) {
    if (compareSemver(currentVersion, gov.recommendedSeedVersion) < 0) {
      return "advisory";
    }
  }

  return "compliant";
}

/**
 * Fetch governance data from all configured directories.
 * Returns the governance state object.
 */
export async function refreshGovernance() {
  const urls = getDirectoryUrls();
  const directories = [];

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(`${url}/horizon/governance`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { url, status: "unreachable", lastChecked: new Date().toISOString() };
      const data = await res.json();
      const gov = data.governance || {};
      return {
        url,
        minimumSeedVersion: gov.minimumSeedVersion || null,
        recommendedSeedVersion: gov.recommendedSeedVersion || null,
        status: computeStatus(SEED_VERSION, gov),
        lastChecked: new Date().toISOString(),
      };
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      directories.push(r.value);
    } else {
      // Promise rejected (network error)
      directories.push({
        url: "unknown",
        status: "unreachable",
        lastChecked: new Date().toISOString(),
      });
    }
  }

  // Compute summary: worst status across all directories
  const statusPriority = { non_compliant: 0, advisory: 1, unreachable: 2, no_policy: 3, compliant: 4 };
  let worst = "compliant";
  for (const d of directories) {
    if ((statusPriority[d.status] ?? 5) < (statusPriority[worst] ?? 5)) {
      worst = d.status;
    }
  }

  cachedState = {
    currentSeedVersion: SEED_VERSION,
    directories,
    summary: worst,
  };
  cacheTimestamp = Date.now();

  return cachedState;
}

/**
 * Get the cached governance state. Returns null if never fetched.
 */
export function getGovernanceState() {
  if (cachedState && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedState;
  }
  return cachedState; // Return stale data rather than null. Refresh happens in background.
}
