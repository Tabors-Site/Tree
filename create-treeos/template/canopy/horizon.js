import log from "../seed/log.js";
import { getLandInfoPayload, signCanopyToken } from "./identity.js";
import Node from "../seed/models/node.js";

// Support comma-separated list of directory URLs
const HORIZON_URLS = (process.env.HORIZON_URL || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const RE_REGISTER_INTERVAL = 60 * 60 * 1000; // 1 hour

let reRegisterTimer = null;

/**
 * Gather public trees (visibility: "public") for this land.
 */
async function getPublicTrees() {
  try {
    const publicNodes = await Node.find({
      visibility: "public",
      rootOwner: { $nin: [null, "SYSTEM"] },
    })
      .select("_id name description rootOwner llmAssignments")
      .populate("rootOwner", "username")
      .lean();

    return publicNodes.map((n) => ({
      rootId: n._id,
      name: n.name || "",
      description: n.description || "",
      ownerUsername: n.rootOwner?.username || "",
      queryAvailable: !!(n.llmDefault && n.llmDefault !== "none"),
    }));
  } catch {
    return [];
  }
}

/**
 * Register this land with a single directory URL.
 */
async function registerWithDirectory(url) {
  try {
    const info = getLandInfoPayload();
    const publicTrees = await getPublicTrees();
    const token = await signCanopyToken("horizon-registration", "horizon");

    const res = await fetch(`${url}/horizon/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `CanopyToken ${token}`,
      },
      body: JSON.stringify({
        landId: info.landId,
        domain: info.domain,
        name: info.name,
        baseUrl: info.baseUrl,
        publicKey: info.publicKey,
        protocolVersion: info.protocolVersion,
        siteUrl: info.siteUrl,
        seedVersion: info.seedVersion,
        publicTrees,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();

    if (data.success || data.status === "ok") {
      log.verbose("Canopy", `Registered with directory at ${url}`);
    } else {
      const reason = (data.error && data.error.message) || data.error || "unknown";
      if (/localhost|private/.test(reason)) {
        log.verbose("Canopy", `Directory registration skipped (localhost/private address). Federation requires a public domain.`);
      } else {
        log.error("Canopy", `Directory registration failed at ${url}: ${reason}`);
      }
    }
  } catch (err) {
    log.error("Canopy", `Could not reach directory at ${url}: ${err.message}`);
  }
}

/**
 * Register this land with all configured directories.
 * Each directory is contacted in parallel. Failures are isolated per URL.
 */
export async function registerWithHorizon() {
  if (HORIZON_URLS.length === 0) return;

  await Promise.allSettled(HORIZON_URLS.map((url) => registerWithDirectory(url)));
}

/**
 * Start periodic re-registration (updates public tree list, refreshes lastSeenAt).
 */
export function startHorizonRegistration() {
  if (HORIZON_URLS.length === 0) {
    log.verbose("Land", "No HORIZON_URL set, skipping directory registration");
    return;
  }

  log.verbose("Canopy", `Registering with ${HORIZON_URLS.length} director${HORIZON_URLS.length === 1 ? "y" : "ies"}: ${HORIZON_URLS.join(", ")}`);

  // Register immediately
  registerWithHorizon();

  // Re-register every hour
  reRegisterTimer = setInterval(registerWithHorizon, RE_REGISTER_INTERVAL);
}

/**
 * Stop re-registration.
 */
export function stopHorizonRegistration() {
  if (reRegisterTimer) {
    clearInterval(reRegisterTimer);
    reRegisterTimer = null;
  }
}

/**
 * Look up a land by domain through the directories.
 * Queries all configured directories, returns the first match.
 */
export async function lookupLandByDomain(domain) {
  if (HORIZON_URLS.length === 0) return null;

  const results = await Promise.allSettled(
    HORIZON_URLS.map(async (url) => {
      const res = await fetch(
        `${url}/horizon/land/${encodeURIComponent(domain)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const result = data.data || data;
      if (data.status === "error" || !result.land) return null;
      return result.land;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) return r.value;
  }
  return null;
}

/**
 * Search lands by name or domain through the directories.
 * Queries all directories and merges/deduplicates by domain.
 */
export async function searchLands(query) {
  if (HORIZON_URLS.length === 0) return [];

  const results = await Promise.allSettled(
    HORIZON_URLS.map(async (url) => {
      const res = await fetch(
        `${url}/horizon/lands?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.lands || [];
    })
  );

  // Merge and deduplicate by domain
  const seen = new Set();
  const merged = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const land of r.value) {
      if (!seen.has(land.domain)) {
        seen.add(land.domain);
        merged.push(land);
      }
    }
  }
  return merged;
}

/**
 * Search public trees across the network through the directories.
 * Queries all directories and merges/deduplicates by rootId+landDomain.
 */
export async function searchPublicTrees(query) {
  if (HORIZON_URLS.length === 0) return [];

  const results = await Promise.allSettled(
    HORIZON_URLS.map(async (url) => {
      const res = await fetch(
        `${url}/horizon/search/trees?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.trees || [];
    })
  );

  const seen = new Set();
  const merged = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const tree of r.value) {
      const key = `${tree.landDomain}:${tree.rootId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(tree);
      }
    }
  }
  return merged;
}
