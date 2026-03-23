import log from "../core/log.js";
import { getLandInfoPayload, signCanopyToken } from "./identity.js";
import Node from "../db/models/node.js";

const DIRECTORY_URL = process.env.DIRECTORY_URL;
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
 * Register this land with the directory service.
 * Sends land identity + public trees. Authenticates with a CanopyToken.
 */
export async function registerWithDirectory() {
  if (!DIRECTORY_URL) return;

  try {
    const info = getLandInfoPayload();
    const publicTrees = await getPublicTrees();

    // Sign a token targeting the directory
    const token = await signCanopyToken("directory-registration", "directory");

    const res = await fetch(`${DIRECTORY_URL}/directory/register`, {
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

    if (data.success) {
      console.log(`[Land] Registered with directory at ${DIRECTORY_URL}`);
    } else {
      log.error("Canopy", `[Land] Directory registration failed: ${data.error}`);
    }
  } catch (err) {
    log.error("Canopy", `[Land] Could not reach directory at ${DIRECTORY_URL}: ${err.message}`);
  }
}

/**
 * Start periodic re-registration (updates public tree list, refreshes lastSeenAt).
 */
export function startDirectoryRegistration() {
  if (!DIRECTORY_URL) {
    log.verbose("Land", "No DIRECTORY_URL set, skipping directory registration");
    return;
  }

  // Register immediately
  registerWithDirectory();

  // Re-register every hour
  reRegisterTimer = setInterval(registerWithDirectory, RE_REGISTER_INTERVAL);
}

/**
 * Stop re-registration.
 */
export function stopDirectoryRegistration() {
  if (reRegisterTimer) {
    clearInterval(reRegisterTimer);
    reRegisterTimer = null;
  }
}

/**
 * Look up a land by domain through the directory service.
 * Returns { domain, name, baseUrl, publicKey, ... } or null.
 */
export async function lookupLandByDomain(domain) {
  if (!DIRECTORY_URL) return null;

  try {
    const res = await fetch(
      `${DIRECTORY_URL}/directory/land/${encodeURIComponent(domain)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.success || !data.land) return null;

    return data.land;
  } catch {
    return null;
  }
}

/**
 * Search lands by name or domain through the directory.
 */
export async function searchLands(query) {
  if (!DIRECTORY_URL) return [];

  try {
    const res = await fetch(
      `${DIRECTORY_URL}/directory/lands?q=${encodeURIComponent(query)}`,
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
 * Search public trees across the network through the directory.
 */
export async function searchPublicTrees(query) {
  if (!DIRECTORY_URL) return [];

  try {
    const res = await fetch(
      `${DIRECTORY_URL}/directory/search/trees?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return [];

    const data = await res.json();
    return data.trees || [];
  } catch {
    return [];
  }
}
