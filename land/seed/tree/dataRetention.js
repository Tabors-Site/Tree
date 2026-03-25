// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Kernel data retention cleanup.
 * Runs daily. Deletes old Chat and Contribution records based on land config.
 * Configurable: chatRetentionDays (default 90), contributionRetentionDays (default 365).
 * Set to 0 to keep forever.
 *
 * Canopy event cleanup lives in canopy/ (canopy owns its own models).
 */

import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";
import Node from "../models/node.js";
import { CASCADE, SYSTEM_ROLE } from "../protocol.js";

let cleanupTimer = null;

export async function runRetentionCleanup() {
  const chatDays = Number(getLandConfigValue("chatRetentionDays")) || 90;
  const contribDays = Number(getLandConfigValue("contributionRetentionDays")) || 365;

  const now = new Date();

  // Chat cleanup
  if (chatDays > 0) {
    try {
      const Chat = (await import("../models/chat.js")).default;
      const cutoff = new Date(now.getTime() - chatDays * 24 * 60 * 60 * 1000);
      const result = await Chat.deleteMany({ createdAt: { $lt: cutoff } });
      if (result.deletedCount > 0) {
        log.info("Retention", `Deleted ${result.deletedCount} chat records older than ${chatDays} days`);
      }
    } catch (err) {
      log.error("Retention", "Chat cleanup failed:", err.message);
    }
  }

  // Awaiting cascade timeout sweep
  try {
    const awaitingTimeout = parseInt(getLandConfigValue("awaitingTimeout") || "300", 10);
    const cutoffMs = Date.now() - awaitingTimeout * 1000;
    const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id").lean();
    if (flowNode) {
      const partitions = await Node.find({ parent: flowNode._id }).select("_id metadata");
      for (const partition of partitions) {
        const results = partition.metadata instanceof Map
          ? partition.metadata.get("results") || {}
          : partition.metadata?.results || {};
        let modified = false;
        for (const [signalId, entries] of Object.entries(results)) {
          const arr = Array.isArray(entries) ? entries : [entries];
          for (const r of arr) {
            if (r.status === CASCADE.AWAITING && new Date(r.timestamp).getTime() < cutoffMs) {
              r.status = CASCADE.FAILED;
              r.payload = { ...(r.payload || {}), reason: "timeout" };
              modified = true;
            }
          }
        }
        if (modified) {
          if (partition.metadata instanceof Map) {
            partition.metadata.set("results", results);
          } else {
            partition.metadata.results = results;
          }
          if (partition.markModified) partition.markModified("metadata");
          await partition.save();
        }
      }
    }
  } catch (err) {
    log.error("Retention", "Awaiting timeout sweep failed:", err.message);
  }

  // Contribution cleanup
  if (contribDays > 0) {
    try {
      const Contribution = (await import("../models/contribution.js")).default;
      const cutoff = new Date(now.getTime() - contribDays * 24 * 60 * 60 * 1000);
      const result = await Contribution.deleteMany({ date: { $lt: cutoff } });
      if (result.deletedCount > 0) {
        log.info("Retention", `Deleted ${result.deletedCount} contribution records older than ${contribDays} days`);
      }
    } catch (err) {
      log.error("Retention", "Contribution cleanup failed:", err.message);
    }
  }
}

export function startRetentionJob() {
  // Run once at boot, then at configured interval (default: daily)
  const intervalMs = Number(getLandConfigValue("retentionCleanupInterval")) || 24 * 60 * 60 * 1000;
  runRetentionCleanup().catch(() => {});
  cleanupTimer = setInterval(() => {
    runRetentionCleanup().catch(() => {});
  }, intervalMs);
  cleanupTimer.unref();
}

export function stopRetentionJob() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}
