import LandPeer from "../db/models/landPeer.js";
import { getLandIdentity, getLandInfoPayload } from "./identity.js";
import { isCompatibleVersion } from "./protocol.js";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEGRADED_THRESHOLD = 2;
const UNREACHABLE_THRESHOLD = 12; // ~1 hour of missed heartbeats
const DEAD_THRESHOLD_DAYS = 30;

let heartbeatTimer = null;

/**
 * Register a new peer land by URL.
 * Fetches the remote land's /canopy/info to get its identity.
 */
export async function registerPeer(peerUrl) {
  const url = peerUrl.replace(/\/+$/, "");
  const identity = getLandIdentity();

  let infoRes;
  try {
    infoRes = await fetch(`${url}/canopy/info`);
  } catch (err) {
    throw new Error(`Could not reach land at ${url}: ${err.message}`);
  }

  if (!infoRes.ok) {
    throw new Error(`Land at ${url} returned ${infoRes.status}`);
  }

  const info = await infoRes.json();

  if (!info.landId || !info.publicKey || !info.domain) {
    throw new Error("Invalid canopy info response from remote land");
  }

  if (!isCompatibleVersion(info.protocolVersion)) {
    throw new Error(
      `Incompatible protocol version: remote has v${info.protocolVersion}, we require v${identity.protocolVersion}`
    );
  }

  // Check if peer already exists
  let peer = await LandPeer.findOne({ domain: info.domain });

  if (peer) {
    peer.landId = info.landId;
    peer.publicKey = info.publicKey;
    peer.protocolVersion = info.protocolVersion;
    peer.name = info.name || "";
    peer.baseUrl = url;
    peer.lastSeenAt = new Date();
    peer.lastSuccessAt = new Date();
    peer.status = "active";
    peer.consecutiveFailures = 0;
    peer.firstFailureAt = null;
    await peer.save();
  } else {
    peer = await LandPeer.create({
      domain: info.domain,
      baseUrl: url,
      landId: info.landId,
      publicKey: info.publicKey,
      protocolVersion: info.protocolVersion,
      name: info.name || "",
      status: "active",
    });
  }

  // Introduce ourselves to the remote land
  try {
    await fetch(`${url}/canopy/peer/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getLandInfoPayload()),
    });
  } catch {
    // Not critical if this fails. They can register us later.
  }

  return peer;
}

/**
 * Remove a peer by domain.
 */
export async function removePeer(domain) {
  return LandPeer.deleteOne({ domain });
}

/**
 * Block a peer land. Blocked peers are rejected on all canopy endpoints.
 */
export async function blockPeer(domain) {
  const peer = await LandPeer.findOneAndUpdate(
    { domain },
    { status: "blocked" },
    { new: true }
  );

  if (peer) {
    // Remove all ghost users from this land from all tree contributor arrays
    const { default: User } = await import("../db/models/user.js");
    const { default: Node } = await import("../db/models/node.js");

    const ghostUsers = await User.find({ isRemote: true, homeLand: domain }).select("_id").lean();
    const ghostIds = ghostUsers.map((g) => g._id);

    if (ghostIds.length > 0) {
      await Node.updateMany(
        { contributors: { $in: ghostIds } },
        { $pullAll: { contributors: ghostIds } }
      );
      console.log(`[Canopy] Blocked ${domain}: removed ${ghostIds.length} ghost users from all trees`);
    }
  }

  return peer;
}

/**
 * Unblock a peer land.
 */
export async function unblockPeer(domain) {
  return LandPeer.findOneAndUpdate(
    { domain },
    { status: "active", consecutiveFailures: 0, firstFailureAt: null },
    { new: true }
  );
}

/**
 * Get a peer by domain.
 */
export async function getPeerByDomain(domain) {
  return LandPeer.findOne({ domain });
}

/**
 * Get all active (non-blocked, non-dead) peers.
 */
export async function getActivePeers() {
  return LandPeer.find({ status: { $in: ["active", "degraded"] } });
}

/**
 * Get all peers regardless of status.
 */
export async function getAllPeers() {
  return LandPeer.find({});
}

/**
 * Get the base URL for a peer. Falls back to https:// if baseUrl not stored.
 */
export function getPeerBaseUrl(peer) {
  if (peer.baseUrl) return peer.baseUrl.replace(/\/+$/, "");
  return `https://${peer.domain}`;
}

/**
 * Ping a single peer and update its status.
 */
export async function pingPeer(peer) {
  const url = `${getPeerBaseUrl(peer)}/canopy/info`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const info = await res.json();

    // Check for domain redirect. Verify the new domain before trusting it.
    if (info.redirect && info.newDomain && info.newDomain !== peer.domain) {
      try {
        const verifyRes = await fetch(
          `${info.newDomain.startsWith("http") ? info.newDomain : "https://" + info.newDomain}/canopy/info`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (verifyRes.ok) {
          const newInfo = await verifyRes.json();
          // Only accept redirect if the new domain has the same landId and publicKey
          if (newInfo.landId === peer.landId && newInfo.publicKey === peer.publicKey) {
            console.log(`[Canopy] Peer ${peer.domain} verified redirect to ${info.newDomain}`);
            peer.domain = info.newDomain;
            peer.baseUrl = newInfo.baseUrl || peer.baseUrl;
          } else {
            console.warn(`[Canopy] Peer ${peer.domain} redirect to ${info.newDomain} REJECTED: identity mismatch`);
          }
        }
      } catch {
        console.warn(`[Canopy] Could not verify redirect for ${peer.domain} to ${info.newDomain}`);
      }
    }

    peer.lastSeenAt = new Date();
    peer.lastSuccessAt = new Date();
    peer.consecutiveFailures = 0;
    peer.firstFailureAt = null;
    peer.status = "active";
    peer.protocolVersion = info.protocolVersion || peer.protocolVersion;
    // SECURITY: Never update publicKey from heartbeat. Keys are only set during
    // initial peering. To rotate keys, the peer must re-peer.

    // Update uptime history for today
    let todayEntry = peer.uptimeHistory.find(
      (e) => e.date.getTime() === today.getTime()
    );
    if (!todayEntry) {
      peer.uptimeHistory.push({ date: today, checks: 1, successes: 1 });
      // Trim to 30 days
      if (peer.uptimeHistory.length > 30) {
        peer.uptimeHistory = peer.uptimeHistory.slice(-30);
      }
    } else {
      todayEntry.checks += 1;
      todayEntry.successes += 1;
    }

    await peer.save();
    return true;
  } catch (err) {
    peer.consecutiveFailures += 1;
    if (!peer.firstFailureAt) {
      peer.firstFailureAt = new Date();
    }

    // Update uptime history for today (failed check)
    let todayEntry = peer.uptimeHistory.find(
      (e) => e.date.getTime() === today.getTime()
    );
    if (!todayEntry) {
      peer.uptimeHistory.push({ date: today, checks: 1, successes: 0 });
      if (peer.uptimeHistory.length > 30) {
        peer.uptimeHistory = peer.uptimeHistory.slice(-30);
      }
    } else {
      todayEntry.checks += 1;
    }

    // Status progression
    if (peer.consecutiveFailures >= UNREACHABLE_THRESHOLD) {
      const daysSinceFirst =
        (Date.now() - peer.firstFailureAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceFirst >= DEAD_THRESHOLD_DAYS) {
        peer.status = "dead";
        console.log(`[Canopy] Peer ${peer.domain} marked as dead (${DEAD_THRESHOLD_DAYS}+ days unreachable)`);
      } else {
        peer.status = "unreachable";
      }
    } else if (peer.consecutiveFailures >= DEGRADED_THRESHOLD) {
      peer.status = "degraded";
    }

    await peer.save();
    return false;
  }
}

/**
 * Run heartbeat check on all non-blocked peers.
 */
export async function runHeartbeat() {
  const peers = await LandPeer.find({ status: { $ne: "blocked" } });

  const results = { total: peers.length, alive: 0, failed: 0 };

  for (const peer of peers) {
    const alive = await pingPeer(peer);
    if (alive) results.alive++;
    else results.failed++;
  }

  return results;
}

/**
 * Start the periodic heartbeat job.
 */
export function startHeartbeatJob() {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(async () => {
    try {
      const results = await runHeartbeat();
      if (results.total > 0) {
        console.log(
          `[Canopy] Heartbeat: ${results.alive}/${results.total} peers alive`
        );
      }
    } catch (err) {
      console.error("[Canopy] Heartbeat error:", err.message);
    }
  }, HEARTBEAT_INTERVAL_MS);

  console.log("[Canopy] Heartbeat job started (every 5 min)");
}

/**
 * Stop the heartbeat job.
 */
export function stopHeartbeatJob() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
