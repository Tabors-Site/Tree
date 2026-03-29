/**
 * Mycelium Core
 *
 * Intelligent cross-land signal routing.
 * Reads signal metadata + destination land profiles.
 * Routes where signals would be useful. Ignores where they wouldn't.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { SYSTEM_ROLE } from "../../seed/protocol.js";
import { getLandIdentity } from "../../canopy/identity.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
export function setRunChat(fn) { _runChat = fn; }

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  routingThreshold: 0.5,
  maxHopsPerSignal: 3,
  routingMode: "selective",
  routingInterval: 60000,
  maxSignalsPerCycle: 100,
  maxRoutingLogEntries: 200,
};

export async function getMyceliumConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };
  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("mycelium") || {}
    : configNode.metadata?.mycelium || {};
  return { ...DEFAULTS, ...meta };
}

export function getThisLandId() {
  try {
    return getLandIdentity().landId;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL BUFFER
// ─────────────────────────────────────────────────────────────────────────

const _signalBuffer = [];

export function bufferSignal(signal) {
  _signalBuffer.push(signal);
}

export function drainBuffer(max) {
  return _signalBuffer.splice(0, max);
}

export function bufferSize() {
  return _signalBuffer.length;
}

// ─────────────────────────────────────────────────────────────────────────
// PEER PROFILING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a routing profile for a peer from its LandPeer document.
 * Zero network calls. Reads what heartbeat already cached.
 */
export function buildPeerProfile(peer) {
  return {
    domain: peer.domain,
    landId: peer.landId,
    baseUrl: peer.baseUrl || `https://${peer.domain}`,
    extensions: new Set(peer.extensions || []),
    status: peer.status,
    healthy: peer.status === "active" || peer.status === "degraded",
    lastSeen: peer.lastSeenAt || peer.lastSuccessAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL SCORING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract extension namespaces from a signal payload.
 * Same logic as gap-detection but we're matching, not reporting.
 */
function extractSignalNamespaces(payload) {
  const namespaces = new Set();
  if (payload?.metadata && typeof payload.metadata === "object") {
    for (const key of Object.keys(payload.metadata)) {
      if (!key.startsWith("_")) namespaces.add(key);
    }
  }
  if (payload?.extensionData && typeof payload.extensionData === "object") {
    for (const key of Object.keys(payload.extensionData)) {
      if (!key.startsWith("_")) namespaces.add(key);
    }
  }
  return namespaces;
}

/**
 * Score how relevant a signal is for a destination peer.
 * Returns 0.0 to 1.0.
 */
export function scoreSignalForPeer(signal, peerProfile, sourceLandId) {
  // Never route back to source
  if (peerProfile.landId === sourceLandId) return 0;

  // Dead or unreachable peers get nothing
  if (!peerProfile.healthy) return 0;

  let score = 0;
  const reasons = [];

  const signalNamespaces = extractSignalNamespaces(signal.payload);
  const signalTags = new Set(signal.payload?.tags || []);

  // Extension match: does the peer have extensions that would process this signal?
  if (signalNamespaces.size > 0 && peerProfile.extensions.size > 0) {
    let matches = 0;
    for (const ns of signalNamespaces) {
      if (peerProfile.extensions.has(ns)) matches++;
    }
    if (matches > 0) {
      const matchScore = (matches / signalNamespaces.size) * 0.3;
      score += matchScore;
      reasons.push(`ext match ${matches}/${signalNamespaces.size}`);
    }
  }

  // Tag match: do signal tags intersect with peer's extension names?
  // Extensions often match tag categories (fitness extension cares about fitness tags)
  if (signalTags.size > 0 && peerProfile.extensions.size > 0) {
    let tagMatches = 0;
    for (const tag of signalTags) {
      if (peerProfile.extensions.has(tag)) tagMatches++;
    }
    if (tagMatches > 0) {
      score += (tagMatches / signalTags.size) * 0.2;
      reasons.push(`tag match ${tagMatches}/${signalTags.size}`);
    }
  }

  // Gap match: peer is missing extensions this signal carries data for.
  // This is the reverse of extension match. The signal has data the peer can't process
  // but WANTS to process (they'd install the extension if they knew).
  if (signalNamespaces.size > 0) {
    let gapMatches = 0;
    for (const ns of signalNamespaces) {
      if (!peerProfile.extensions.has(ns)) gapMatches++;
    }
    // Only count gaps if the peer has SOME relevant extensions (not totally unrelated)
    if (gapMatches > 0 && score > 0) {
      score += Math.min(gapMatches * 0.1, 0.3);
      reasons.push(`gap signal ${gapMatches} namespaces`);
    }
  }

  return { score: Math.min(score, 1.0), reasons };
}

// ─────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Route a batch of signals to qualifying peers.
 * Returns routing decisions for logging.
 */
export async function routeBatch(signals, config) {
  let LandPeer;
  try {
    const mod = await import("../../canopy/models/landPeer.js");
    LandPeer = mod.default;
  } catch {
    return [];
  }

  const peers = await LandPeer.find({ status: { $in: ["active", "degraded"] } }).lean();
  if (peers.length === 0) return [];

  const profiles = peers.map(buildPeerProfile);
  const thisLandId = getThisLandId();
  const decisions = [];

  let signCanopyToken;
  let getPeerBaseUrl;
  try {
    signCanopyToken = (await import("../../canopy/identity.js")).signCanopyToken;
    getPeerBaseUrl = (await import("../../canopy/peers.js")).getPeerBaseUrl;
  } catch {
    return [];
  }

  for (const signal of signals) {
    const sourceLandId = signal.payload?._sourceLandId || signal.source;

    for (const profile of profiles) {
      const { score, reasons } = scoreSignalForPeer(signal, profile, sourceLandId);

      if (score < config.routingThreshold) continue;

      // Deliver
      try {
        const token = await signCanopyToken("system", profile.domain);
        const baseUrl = getPeerBaseUrl({ baseUrl: profile.baseUrl, domain: profile.domain });
        const url = `${baseUrl}/api/v1/node/${signal.nodeId}/cascade`;

        // Build routed payload with hop tracking + loop prevention
        const routedPayload = {
          ...signal.payload,
          _myceliumHops: (signal.payload._myceliumHops || 0) + 1,
          _myceliumRouted: [...(signal.payload._myceliumRouted || []), thisLandId],
          _sourceLandId: sourceLandId || thisLandId,
        };

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            signalId: signal.signalId,
            payload: routedPayload,
            source: signal.nodeId,
            depth: (signal.depth || 0) + 1,
          }),
          signal: AbortSignal.timeout(15000),
        });

        decisions.push({
          signalId: signal.signalId,
          destination: profile.domain,
          score: Math.round(score * 100) / 100,
          reasons,
          delivered: res.ok,
          httpStatus: res.status,
          timestamp: new Date().toISOString(),
        });

        if (res.ok) {
          log.debug("Mycelium", `Routed ${signal.signalId.slice(0, 8)} to ${profile.domain} (score: ${score.toFixed(2)})`);
        }
      } catch (err) {
        decisions.push({
          signalId: signal.signalId,
          destination: profile.domain,
          score: Math.round(score * 100) / 100,
          reasons,
          delivered: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return decisions;
}

/**
 * AI routing for ambiguous signals (selective mode).
 * Sends the batch to the AI for scoring.
 */
export async function aiRoute(signals, profiles, userId) {
  if (!_runChat || signals.length === 0 || profiles.length === 0) return [];

  const signalSummary = signals.map(s => ({
    signalId: s.signalId,
    tags: s.payload?.tags || [],
    namespaces: [...extractSignalNamespaces(s.payload)],
  }));

  const peerSummary = profiles.map(p => ({
    domain: p.domain,
    extensions: [...p.extensions].slice(0, 20),
    healthy: p.healthy,
  }));

  const prompt =
    `You are a mycelium routing node deciding which signals go to which lands.\n\n` +
    `Signals:\n${JSON.stringify(signalSummary, null, 0)}\n\n` +
    `Connected lands:\n${JSON.stringify(peerSummary, null, 0)}\n\n` +
    `For each signal, which lands should receive it? Return JSON array:\n` +
    `[{ "signalId": "...", "destinations": ["domain1"], "reasoning": "brief" }]\n` +
    `Only route where the destination has extensions or context to process the signal.`;

  try {
    const { answer } = await _runChat({
      userId: userId || "system",
      username: "mycelium",
      message: prompt,
      mode: "home:default",
      slot: "mycelium",
    });
    if (!answer) return [];
    return parseJsonSafe(answer) || [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ROUTING LOG
// ─────────────────────────────────────────────────────────────────────────

/**
 * Write routing decisions to the mycelium routing log.
 * Stored on the land root's metadata.mycelium.routingLog (rolling).
 */
export async function logDecisions(decisions) {
  if (decisions.length === 0) return;

  const config = await getMyceliumConfig();
  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT }).select("_id").lean();
  if (!landRoot) return;

  await Node.findByIdAndUpdate(landRoot._id, {
    $push: {
      "metadata.mycelium.routingLog": {
        $each: decisions,
        $slice: -(config.maxRoutingLogEntries),
      },
    },
    $set: {
      "metadata.mycelium.lastRoutingCycle": new Date().toISOString(),
    },
    $inc: {
      "metadata.mycelium.totalRouted": decisions.filter(d => d.delivered).length,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────

export async function getMyceliumStatus() {
  let LandPeer;
  try {
    LandPeer = (await import("../../canopy/models/landPeer.js")).default;
  } catch {
    return { peers: 0, mode: "unknown" };
  }

  const config = await getMyceliumConfig();
  const peers = await LandPeer.countDocuments({ status: { $in: ["active", "degraded"] } });

  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT }).select("metadata").lean();
  const meta = landRoot?.metadata instanceof Map
    ? landRoot.metadata.get("mycelium") || {}
    : landRoot?.metadata?.mycelium || {};

  return {
    peers,
    routingMode: config.routingMode,
    routingThreshold: config.routingThreshold,
    maxHopsPerSignal: config.maxHopsPerSignal,
    signalsBuffered: bufferSize(),
    totalRouted: meta.totalRouted || 0,
    lastCycle: meta.lastRoutingCycle || null,
  };
}

export async function getRoutingLog(limit = 50) {
  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT }).select("metadata").lean();
  const meta = landRoot?.metadata instanceof Map
    ? landRoot.metadata.get("mycelium") || {}
    : landRoot?.metadata?.mycelium || {};
  return (meta.routingLog || []).slice(-limit).reverse();
}
