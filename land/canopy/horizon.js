import log from "../seed/log.js";
import { getLandInfoPayload, signCanopyToken } from "./identity.js";
import Node from "../seed/models/node.js";

const HORIZON_URL = process.env.HORIZON_URL;
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
 * Register this land with the Horizon service.
 * Sends land identity + public trees. Authenticates with a CanopyToken.
 */
export async function registerWithHorizon() {
  if (!HORIZON_URL) return;

  try {
    const info = getLandInfoPayload();
    const publicTrees = await getPublicTrees();

    // Sign a token targeting the Horizon
    const token = await signCanopyToken("horizon-registration", "horizon");

    const res = await fetch(`${HORIZON_URL}/horizon/register`, {
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
        publicTrees,
      }),
    });

    const data = await res.json();

    if (data.status === "ok") {
      log.verbose("Canopy", `Registered with Horizon at ${HORIZON_URL}`);
    } else {
      log.error("Canopy", `[Land] Horizon registration failed: ${(data.error && data.error.message) || data.error}`);
    }
  } catch (err) {
    log.error("Canopy", `[Land] Could not reach Horizon at ${HORIZON_URL}: ${err.message}`);
  }
}

/**
 * Start periodic re-registration (updates public tree list, refreshes lastSeenAt).
 */
export function startHorizonRegistration() {
  if (!HORIZON_URL) {
    log.verbose("Land", "No HORIZON_URL set, skipping Horizon registration");
    return;
  }

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
 * Look up a land by domain through the Horizon service.
 * Returns { domain, name, baseUrl, publicKey, ... } or null.
 */
export async function lookupLandByDomain(domain) {
  if (!HORIZON_URL) return null;

  try {
    const res = await fetch(
      `${HORIZON_URL}/horizon/land/${encodeURIComponent(domain)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const result = data.data || data;
    if (data.status === "error" || !result.land) return null;

    return result.land;
  } catch {
    return null;
  }
}

/**
 * Search lands by name or domain through the Horizon.
 */
export async function searchLands(query) {
  if (!HORIZON_URL) return [];

  try {
    const res = await fetch(
      `${HORIZON_URL}/horizon/lands?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return [];

    const data = await res.json();
    return data.lands || [];
  } catch {
    return [];
  }
}

/**
 * Search public trees across the network through the Horizon.
 */
export async function searchPublicTrees(query) {
  if (!HORIZON_URL) return [];

  try {
    const res = await fetch(
      `${HORIZON_URL}/horizon/search/trees?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return [];

    const data = await res.json();
    return data.trees || [];
  } catch {
    return [];
  }
}
