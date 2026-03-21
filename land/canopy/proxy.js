import { signCanopyToken } from "./identity.js";
import { getPeerByDomain, getPeerBaseUrl } from "./peers.js";

/**
 * Proxy a request from a local user to a remote land.
 * Used when a local user accesses a tree that lives on another land.
 *
 * The proxy adds a CanopyToken header so the remote land can verify
 * the user's identity without having them in its local database.
 */
export async function proxyToRemoteLand({
  userId,
  targetLandDomain,
  method,
  path,
  body,
  query,
}) {
  const peer = await getPeerByDomain(targetLandDomain);

  if (!peer) {
    throw new Error(`Unknown land: ${targetLandDomain}. Register it as a peer first.`);
  }

  if (peer.status === "blocked") {
    throw new Error(`Land ${targetLandDomain} is blocked`);
  }

  if (peer.status === "unreachable" || peer.status === "dead") {
    throw new Error(`Land ${targetLandDomain} is currently ${peer.status}`);
  }

  const token = await signCanopyToken(userId, targetLandDomain);

  // Build the URL
  let url = `${getPeerBaseUrl(peer)}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const fetchOptions = {
    method: method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `CanopyToken ${token}`,
    },
    signal: AbortSignal.timeout(30000),
  };

  if (body && method !== "GET" && method !== "HEAD") {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOptions);
    const data = await res.json();

    // Don't pass through 500 errors verbatim (could leak internal details)
    if (res.status >= 500) {
      return {
        status: 502,
        data: { success: false, error: "Remote land returned an internal error" },
        headers: {},
      };
    }

    return {
      status: res.status,
      data,
      headers: {
        protocolVersion: res.headers.get("X-Canopy-Protocol-Version"),
        landId: res.headers.get("X-Canopy-Land-Id"),
      },
    };
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(`Request to ${targetLandDomain} timed out`);
    }
    throw new Error(`Failed to reach ${targetLandDomain}: ${err.message}`);
  }
}

/**
 * Report energy usage to a remote user's home land.
 * Fire and forget. If it fails, the CanopyEvent outbox will retry.
 */
export async function reportEnergyToHomeLand({
  userId,
  homeLandDomain,
  energyUsed,
  action,
  nodeId,
}) {
  const peer = await getPeerByDomain(homeLandDomain);
  if (!peer || peer.status === "blocked") return false;

  const token = await signCanopyToken(userId, homeLandDomain);

  try {
    const baseUrl = getPeerBaseUrl(peer);
    const res = await fetch(`${baseUrl}/canopy/energy/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `CanopyToken ${token}`,
      },
      body: JSON.stringify({
        userId,
        energyUsed,
        action,
        nodeId,
      }),
      signal: AbortSignal.timeout(10000),
    });

    return res.ok;
  } catch {
    return false;
  }
}
