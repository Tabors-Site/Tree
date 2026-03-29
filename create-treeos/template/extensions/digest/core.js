/**
 * Digest Core
 *
 * Collects overnight activity from every installed extension,
 * sends one combined prompt to the AI, writes the briefing to
 * the land root metadata. Optionally pushes to a gateway channel.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { SYSTEM_ROLE } from "../../seed/protocol.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
let _metadata = null;
export function setRunChat(fn) { _runChat = fn; }
export function configure({ metadata }) { _metadata = metadata; }

const MAX_HISTORY = 30;

// ─────────────────────────────────────────────────────────────────────────
// COLLECTORS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Collect all overnight signals from installed extensions.
 * Each collector is independent. Missing extensions return null.
 */
async function collectSignals(landRootId) {
  const signals = {};
  let getExtension;
  try {
    ({ getExtension } = await import("../loader.js"));
  } catch {
    return signals;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

  // Changelog: what changed
  try {
    const ext = getExtension("changelog");
    if (ext?.exports?.getChangelog) {
      // Intentionally not calling summarize here. We want raw contribution counts.
      // The digest AI will synthesize everything in one pass.
      const { contributions } = await ext.exports.getChangelog(landRootId, { since: "24h", land: true });
      if (contributions?.length > 0) {
        signals.changelog = `${contributions.length} contributions across the land in the last 24 hours.`;
      }
    }
  } catch (err) { log.debug("Digest", `changelog: ${err.message}`); }

  // Intent: what the tree did autonomously
  try {
    const roots = await Node.find({
      rootOwner: { $nin: [null, "SYSTEM"] },
      "metadata.intent.enabled": true,
    }).select("_id name metadata").lean();

    const intentSummaries = [];
    for (const root of roots) {
      const meta = root.metadata instanceof Map
        ? root.metadata.get("intent")
        : root.metadata?.intent;
      const recent = (meta?.recentExecutions || [])
        .filter(e => new Date(e.executedAt) >= since)
        .slice(0, 5);
      if (recent.length > 0) {
        intentSummaries.push(`${root.name}: ${recent.map(e => e.action).join("; ")}`);
      }
    }
    if (intentSummaries.length > 0) {
      signals.intent = intentSummaries.join("\n");
    }
  } catch (err) { log.debug("Digest", `intent: ${err.message}`); }

  // Dreams: what background maintenance ran
  try {
    const ext = getExtension("dreams");
    if (ext) {
      const roots = await Node.find({
        rootOwner: { $nin: [null, "SYSTEM"] },
        "metadata.dreams.lastDreamAt": { $gte: since },
      }).select("_id name metadata").lean();

      if (roots.length > 0) {
        signals.dreams = roots.map(r => `${r.name}: dreamed recently`).join("; ");
      }
    }
  } catch (err) { log.debug("Digest", `dreams: ${err.message}`); }

  // Prune: what was removed
  try {
    const ext = getExtension("prune");
    if (ext) {
      const roots = await Node.find({
        rootOwner: { $nin: [null, "SYSTEM"] },
      }).select("_id name metadata").lean();

      const pruneSummaries = [];
      for (const root of roots) {
        const meta = root.metadata instanceof Map
          ? root.metadata.get("prune")
          : root.metadata?.prune;
        if (meta?.lastPrunedAt && new Date(meta.lastPrunedAt) >= since) {
          const count = meta.pruneHistory?.filter(h => new Date(h.date) >= since).length || 0;
          if (count > 0) pruneSummaries.push(`${root.name}: ${count} nodes pruned`);
        }
      }
      if (pruneSummaries.length > 0) {
        signals.prune = pruneSummaries.join("; ");
      }
    }
  } catch (err) { log.debug("Digest", `prune: ${err.message}`); }

  // Purpose: coherence drift
  try {
    const ext = getExtension("purpose");
    if (ext) {
      const roots = await Node.find({
        rootOwner: { $nin: [null, "SYSTEM"] },
        "metadata.purpose.thesis": { $exists: true },
      }).select("_id name metadata").lean();

      const drifts = [];
      for (const root of roots) {
        const meta = root.metadata instanceof Map
          ? root.metadata.get("purpose")
          : root.metadata?.purpose;
        if (meta?.recentCoherence !== undefined && meta.recentCoherence < 0.6) {
          drifts.push(`${root.name}: coherence ${(meta.recentCoherence * 100).toFixed(0)}%`);
        }
      }
      if (drifts.length > 0) {
        signals.purpose = `Coherence drift: ${drifts.join("; ")}`;
      }
    }
  } catch (err) { log.debug("Digest", `purpose: ${err.message}`); }

  // Evolution: dormancy
  try {
    const ext = getExtension("evolution");
    if (ext?.exports?.getDormant) {
      const roots = await Node.find({
        rootOwner: { $nin: [null, "SYSTEM"] },
      }).select("_id name").lean();

      const dormantSummaries = [];
      for (const root of roots) {
        try {
          const dormant = await ext.exports.getDormant(String(root._id));
          if (dormant?.length > 0) {
            dormantSummaries.push(`${root.name}: ${dormant.length} dormant branch${dormant.length > 1 ? "es" : ""}`);
          }
        } catch {}
      }
      if (dormantSummaries.length > 0) {
        signals.evolution = dormantSummaries.join("; ");
      }
    }
  } catch (err) { log.debug("Digest", `evolution: ${err.message}`); }

  // Pulse: land health
  try {
    const ext = getExtension("pulse");
    if (ext?.exports?.getLatestSnapshot) {
      const snapshot = await ext.exports.getLatestSnapshot();
      if (snapshot) {
        const parts = [];
        if (snapshot.failureRate > 0) parts.push(`failure rate: ${(snapshot.failureRate * 100).toFixed(1)}%`);
        if (snapshot.elevated) parts.push("ELEVATED");
        if (snapshot.totalToday > 0) parts.push(`${snapshot.totalToday} cascade signals today`);
        if (parts.length > 0) signals.pulse = parts.join(", ");
      }
    }
  } catch (err) { log.debug("Digest", `pulse: ${err.message}`); }

  // Delegate: pending suggestions
  try {
    const ext = getExtension("delegate");
    if (ext?.exports?.getSuggestions) {
      const roots = await Node.find({
        rootOwner: { $nin: [null, "SYSTEM"] },
        contributors: { $exists: true, $not: { $size: 0 } },
      }).select("_id").lean();

      let totalPending = 0;
      for (const root of roots) {
        try {
          const suggestions = await ext.exports.getSuggestions(String(root._id));
          totalPending += suggestions.length;
        } catch {}
      }
      if (totalPending > 0) {
        signals.delegate = `${totalPending} pending delegate suggestion${totalPending > 1 ? "s" : ""}`;
      }
    }
  } catch (err) { log.debug("Digest", `delegate: ${err.message}`); }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────
// BRIEFING GENERATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate the daily digest briefing.
 */
export async function generateDigest() {
  // Find the land root
  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT });
  if (!landRoot) {
    log.debug("Digest", "No land root found");
    return null;
  }

  const signals = await collectSignals(String(landRoot._id));

  if (Object.keys(signals).length === 0) {
    const briefing = {
      date: new Date().toISOString().slice(0, 10),
      summary: "Nothing notable happened in the last 24 hours. The land is quiet.",
      signals: {},
      generatedAt: new Date().toISOString(),
    };
    await writeDigest(landRoot, briefing);
    return briefing;
  }

  // Build the prompt
  const signalText = Object.entries(signals)
    .map(([source, text]) => `[${source}] ${text}`)
    .join("\n");

  const prompt =
    `Write a morning briefing for this land. What happened overnight. What needs attention. ` +
    `What the tree did on its own. What's healthy. What's drifting. Keep it short.\n\n` +
    `Signals from the last 24 hours:\n${signalText}\n\n` +
    `Return ONLY JSON:\n` +
    `{\n` +
    `  "summary": "2-4 sentence overview",\n` +
    `  "overnight": ["what happened while you were away"],\n` +
    `  "needsAttention": ["what you should look at today"],\n` +
    `  "healthy": ["what is running well"],\n` +
    `  "drifting": ["what is going off track"]\n` +
    `}`;

  let parsed = null;
  if (_runChat) {
    try {
      const { answer } = await _runChat({
        userId: "SYSTEM",
        username: "digest",
        message: prompt,
        mode: "tree:respond",
        rootId: null,
        slot: "digest",
      });
      if (answer) parsed = parseJsonSafe(answer);
    } catch (err) {
      log.debug("Digest", `AI briefing failed: ${err.message}`);
    }
  }

  const briefing = {
    date: new Date().toISOString().slice(0, 10),
    summary: parsed?.summary || signalText,
    overnight: parsed?.overnight || [],
    needsAttention: parsed?.needsAttention || [],
    healthy: parsed?.healthy || [],
    drifting: parsed?.drifting || [],
    signals,
    generatedAt: new Date().toISOString(),
  };

  await writeDigest(landRoot, briefing);

  // Push to gateway if configured
  try {
    const digestMeta = _metadata.getExtMeta(landRoot, "digest") || {};
    if (digestMeta.gatewayChannel) {
      const { getExtension } = await import("../loader.js");
      const gatewayExt = getExtension("gateway");
      if (gatewayExt?.exports?.sendNotification) {
        const text = formatBriefingForChannel(briefing);
        await gatewayExt.exports.sendNotification(digestMeta.gatewayChannel, {
          type: "digest",
          title: `Daily Digest: ${briefing.date}`,
          content: text,
        });
        log.verbose("Digest", `Briefing pushed to gateway channel ${digestMeta.gatewayChannel}`);
      }
    }
  } catch (err) {
    log.debug("Digest", `Gateway push failed: ${err.message}`);
  }

  return briefing;
}

/**
 * Write the briefing to land root metadata.
 */
async function writeDigest(landRoot, briefing) {
  try {
    const meta = _metadata.getExtMeta(landRoot, "digest") || {};
    meta.latest = briefing;

    if (!meta.history) meta.history = [];
    meta.history.unshift({
      date: briefing.date,
      summary: briefing.summary,
      generatedAt: briefing.generatedAt,
    });
    meta.history = meta.history.slice(0, MAX_HISTORY);

    await _metadata.setExtMeta(landRoot, "digest", meta);
  } catch (err) {
    log.debug("Digest", `Failed to write digest: ${err.message}`);
  }
}

/**
 * Format briefing for gateway channel delivery.
 */
function formatBriefingForChannel(briefing) {
  const parts = [briefing.summary];

  if (briefing.overnight?.length > 0) {
    parts.push(`\nOvernight: ${briefing.overnight.join(". ")}`);
  }
  if (briefing.needsAttention?.length > 0) {
    parts.push(`\nNeeds attention: ${briefing.needsAttention.join(". ")}`);
  }
  if (briefing.drifting?.length > 0) {
    parts.push(`\nDrifting: ${briefing.drifting.join(". ")}`);
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the latest digest.
 */
export async function getLatestDigest() {
  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT }).select("metadata").lean();
  if (!landRoot) return null;

  const meta = landRoot.metadata instanceof Map
    ? landRoot.metadata.get("digest")
    : landRoot.metadata?.digest;

  return meta?.latest || null;
}

/**
 * Get digest history.
 */
export async function getDigestHistory() {
  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT }).select("metadata").lean();
  if (!landRoot) return [];

  const meta = landRoot.metadata instanceof Map
    ? landRoot.metadata.get("digest")
    : landRoot.metadata?.digest;

  return meta?.history || [];
}

/**
 * Get digest config (delivery time, channel, scope).
 */
export async function getDigestConfig() {
  const landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT }).select("metadata").lean();
  if (!landRoot) return {};

  const meta = landRoot.metadata instanceof Map
    ? landRoot.metadata.get("digest")
    : landRoot.metadata?.digest;

  return {
    gatewayChannel: meta?.gatewayChannel || null,
    deliveryHour: meta?.deliveryHour ?? 7,
    enabled: meta?.enabled !== false,
  };
}
