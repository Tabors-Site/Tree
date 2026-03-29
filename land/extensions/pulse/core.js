/**
 * Pulse Core
 *
 * Queries .flow partitions, counts cascade results by status,
 * tracks failure sources, calculates rates, and builds a health summary.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, SYSTEM_OWNER, CASCADE, CONTENT_TYPE } from "../../seed/protocol.js";
import { hooks } from "../../seed/hooks.js";
import { v4 as uuidv4 } from "uuid";

// ─────────────────────────────────────────────────────────────────────────
// PULSE NODE
// ─────────────────────────────────────────────────────────────────────────

let pulseNodeId = null;

/**
 * Find or create the .pulse node under the land root.
 * Regular node (no systemRole). Created once at install.
 */
export async function ensurePulseNode() {
  if (pulseNodeId) {
    const exists = await Node.findById(pulseNodeId).select("_id").lean();
    if (exists) return pulseNodeId;
  }

  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT }).select("_id children").lean();
  if (!landRoot) throw new Error("Land root not found");

  // Check if .pulse already exists as a child
  for (const childId of landRoot.children || []) {
    const child = await Node.findById(childId).select("_id name").lean();
    if (child && child.name === ".pulse") {
      pulseNodeId = child._id;
      return pulseNodeId;
    }
  }

  // Create .pulse under land root
  const { createSystemNode } = await import("../../seed/tree/treeManagement.js");
  const pulseNode = await createSystemNode({
    name: ".pulse",
    parentId: landRoot._id,
    metadata: new Map([["pulse", { installedAt: new Date().toISOString() }]]),
  });

  pulseNodeId = String(pulseNode._id);
  log.info("Pulse", `Created .pulse node: ${pulseNodeId}`);
  return pulseNodeId;
}

export function getPulseNodeId() {
  return pulseNodeId;
}

// ─────────────────────────────────────────────────────────────────────────
// PULSE CONFIG (stored on .config metadata.pulse)
// ─────────────────────────────────────────────────────────────────────────

export async function getPulseConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return defaults();

  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("pulse") || {}
    : configNode.metadata?.pulse || {};

  return {
    intervalMs: meta.intervalMs ?? 60000,
    maxNotesRetained: meta.maxNotesRetained ?? 100,
    failureRateThreshold: meta.failureRateThreshold ?? 0.3,
  };
}

function defaults() {
  return {
    intervalMs: 60000,
    maxNotesRetained: 100,
    failureRateThreshold: 0.3,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HEALTH QUERY
// ─────────────────────────────────────────────────────────────────────────

// Track the last check time so we only count new results
let lastCheckTime = null;

/**
 * Query .flow for results since the last check.
 * Returns raw counts and source-level failure tracking.
 */
export async function queryFlowSince(since) {
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id").lean();
  if (!flowNode) return emptySnapshot();

  // Load today's and yesterday's partitions (covers the boundary)
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const partitions = await Node.find({
    parent: flowNode._id,
    name: { $in: [today, yesterday] },
  }).select("metadata").lean();

  const counts = {
    [CASCADE.SUCCEEDED]: 0,
    [CASCADE.FAILED]: 0,
    [CASCADE.REJECTED]: 0,
    [CASCADE.QUEUED]: 0,
    [CASCADE.PARTIAL]: 0,
    [CASCADE.AWAITING]: 0,
  };

  const failureSources = {};  // nodeId -> failure count
  const peerResults = {};     // peer domain -> { ok, fail }
  let totalSignals = 0;
  let totalResults = 0;

  for (const partition of partitions) {
    const results = partition.metadata instanceof Map
      ? partition.metadata.get("results") || {}
      : partition.metadata?.results || {};

    for (const [signalId, entries] of Object.entries(results)) {
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        // Filter by time if since is set
        if (since && entry.timestamp) {
          const ts = new Date(entry.timestamp).getTime();
          if (ts < since) continue;
        }

        totalResults++;

        if (entry.status && counts[entry.status] !== undefined) {
          counts[entry.status]++;
        }

        // Track failure sources
        if (entry.status === CASCADE.FAILED || entry.status === CASCADE.REJECTED) {
          const src = entry.source || "unknown";
          failureSources[src] = (failureSources[src] || 0) + 1;
        }

        // Track cross-land peer results
        if (entry.payload?.peer) {
          const domain = entry.payload.peer;
          if (!peerResults[domain]) peerResults[domain] = { ok: 0, fail: 0 };
          if (entry.status === CASCADE.SUCCEEDED) {
            peerResults[domain].ok++;
          } else {
            peerResults[domain].fail++;
          }
        }
      }

      totalSignals++;
    }
  }

  return { counts, failureSources, peerResults, totalSignals, totalResults };
}

function emptySnapshot() {
  return {
    counts: {
      [CASCADE.SUCCEEDED]: 0,
      [CASCADE.FAILED]: 0,
      [CASCADE.REJECTED]: 0,
      [CASCADE.QUEUED]: 0,
      [CASCADE.PARTIAL]: 0,
      [CASCADE.AWAITING]: 0,
    },
    failureSources: {},
    peerResults: {},
    totalSignals: 0,
    totalResults: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HEALTH SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a health snapshot from .flow data since the last check.
 * Updates lastCheckTime.
 */
export async function buildHealthSnapshot() {
  const since = lastCheckTime;
  lastCheckTime = Date.now();

  const data = await queryFlowSince(since);
  const total = data.totalResults;
  const failures = data.counts[CASCADE.FAILED] + data.counts[CASCADE.REJECTED];
  const failureRate = total > 0 ? failures / total : 0;

  // Top failure sources (sorted by count, top 10)
  const topFailures = Object.entries(data.failureSources)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([nodeId, count]) => ({ nodeId, count }));

  // Peer health
  const peers = Object.entries(data.peerResults).map(([domain, stats]) => ({
    domain,
    ok: stats.ok,
    fail: stats.fail,
    status: stats.fail === 0 ? "healthy" : stats.fail > stats.ok ? "degraded" : "mixed",
  }));

  const config = await getPulseConfig();

  return {
    timestamp: new Date().toISOString(),
    window: since ? `${Math.round((Date.now() - since) / 1000)}s` : "full",
    signals: data.totalSignals,
    results: data.totalResults,
    counts: data.counts,
    failureRate: Math.round(failureRate * 1000) / 1000,
    failureRateThreshold: config.failureRateThreshold,
    elevated: failureRate > config.failureRateThreshold,
    topFailureSources: topFailures,
    peers,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SUMMARY WRITER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a human-readable summary from a health snapshot.
 */
export function formatSummary(snapshot) {
  const lines = [];
  lines.push(`Land Health Pulse (${snapshot.timestamp})`);
  lines.push(`Window: ${snapshot.window}`);
  lines.push(`Signals: ${snapshot.signals}, Results: ${snapshot.results}`);
  lines.push("");

  lines.push("Status Counts:");
  for (const [status, count] of Object.entries(snapshot.counts)) {
    if (count > 0) lines.push(`  ${status}: ${count}`);
  }
  lines.push("");

  lines.push(`Failure Rate: ${(snapshot.failureRate * 100).toFixed(1)}%`);
  if (snapshot.elevated) {
    lines.push(`WARNING: Failure rate exceeds threshold (${(snapshot.failureRateThreshold * 100).toFixed(0)}%)`);
  }

  if (snapshot.topFailureSources.length > 0) {
    lines.push("");
    lines.push("Top Failure Sources:");
    for (const src of snapshot.topFailureSources) {
      lines.push(`  ${src.nodeId}: ${src.count} failures`);
    }
  }

  if (snapshot.peers.length > 0) {
    lines.push("");
    lines.push("Peer Connections:");
    for (const peer of snapshot.peers) {
      lines.push(`  ${peer.domain}: ${peer.status} (${peer.ok} ok, ${peer.fail} fail)`);
    }
  }

  return lines.join("\n");
}

/**
 * Write the health snapshot to .pulse as a note and update metadata.
 * Fires afterNote so other extensions can react to health changes.
 */
export async function writeSnapshot(snapshot) {
  const nodeId = await ensurePulseNode();
  const summary = formatSummary(snapshot);
  const config = await getPulseConfig();

  // Write structured data to .pulse metadata for fast access
  await Node.findByIdAndUpdate(nodeId, {
    $set: {
      "metadata.pulse.latestSnapshot": snapshot,
      "metadata.pulse.lastUpdated": snapshot.timestamp,
    },
  });

  // Write summary as a note so the AI can read it through enrichContext
  const note = new Note({
    _id: uuidv4(),
    contentType: CONTENT_TYPE.TEXT,
    content: summary,
    userId: SYSTEM_OWNER,
    nodeId,
    metadata: new Map([
      ["source", "pulse"],
      ["elevated", snapshot.elevated],
      ["failureRate", snapshot.failureRate],
    ]),
  });
  await note.save();

  // Fire afterNote so other extensions can react
  hooks.run("afterNote", {
    note,
    nodeId,
    userId: SYSTEM_OWNER,
    contentType: CONTENT_TYPE.TEXT,
    sizeKB: Math.ceil(Buffer.byteLength(summary, "utf8") / 1024),
    action: "create",
  }).catch(() => {});

  // Prune old pulse notes if over retention limit
  const noteCount = await Note.countDocuments({ nodeId });
  if (noteCount > config.maxNotesRetained) {
    const oldest = await Note.find({ nodeId })
      .sort({ createdAt: 1 })
      .limit(noteCount - config.maxNotesRetained)
      .select("_id");
    const ids = oldest.map((n) => n._id);
    await Note.deleteMany({ _id: { $in: ids } });
  }

  return { snapshot, noteId: note._id };
}

/**
 * Get the latest health snapshot from .pulse metadata (no .flow query).
 */
export async function getLatestSnapshot() {
  const nodeId = await ensurePulseNode();
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;

  const meta = node.metadata instanceof Map
    ? node.metadata.get("pulse") || {}
    : node.metadata?.pulse || {};

  return meta.latestSnapshot || null;
}
