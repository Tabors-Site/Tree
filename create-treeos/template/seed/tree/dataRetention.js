// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Kernel data retention cleanup.
 * Runs at configured interval (default daily).
 * Deletes old Chat and Contribution records based on land config.
 * Sweeps timed-out AWAITING cascade signals.
 *
 * chatRetentionDays: default 90. 0 = keep forever.
 * contributionRetentionDays: default 365. 0 = keep forever.
 */

import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";
import Chat from "../models/chat.js";
import Contribution from "../models/contribution.js";
import Node from "../models/node.js";
import { CASCADE, SYSTEM_ROLE } from "../protocol.js";

let cleanupTimer = null;

// Batch size for deleteMany. Prevents one massive delete from blocking
// the DB for minutes on collections with millions of documents.
const DELETE_BATCH_SIZE = 10000;

export async function runRetentionCleanup() {
  const now = new Date();

  // ── Chat cleanup ──
  const chatDays = Number(getLandConfigValue("chatRetentionDays"));
  if (chatDays > 0) {
    try {
      const cutoff = new Date(now.getTime() - chatDays * 24 * 60 * 60 * 1000);
      let totalDeleted = 0;
      // Batch delete: find IDs first, then delete by ID set.
      // deleteMany().limit() is not supported by MongoDB. Without batching,
      // one massive delete could block the DB for minutes on large collections.
      let batchCount;
      do {
        const ids = await Chat.find({ "startMessage.time": { $lt: cutoff } })
          .select("_id").limit(DELETE_BATCH_SIZE).lean();
        batchCount = ids.length;
        if (batchCount > 0) {
          await Chat.deleteMany({ _id: { $in: ids.map(d => d._id) } });
          totalDeleted += batchCount;
        }
      } while (batchCount >= DELETE_BATCH_SIZE);
      if (totalDeleted > 0) {
        log.info("Retention", `Deleted ${totalDeleted} chat records older than ${chatDays} days`);
      }
    } catch (err) {
      log.error("Retention", `Chat cleanup failed: ${err.message}`);
    }
  }

  // ── Contribution cleanup ──
  const contribDays = Number(getLandConfigValue("contributionRetentionDays"));
  if (contribDays > 0) {
    try {
      const cutoff = new Date(now.getTime() - contribDays * 24 * 60 * 60 * 1000);
      let totalDeleted = 0;
      let batchCount;
      do {
        const ids = await Contribution.find({ date: { $lt: cutoff } })
          .select("_id").limit(DELETE_BATCH_SIZE).lean();
        batchCount = ids.length;
        if (batchCount > 0) {
          await Contribution.deleteMany({ _id: { $in: ids.map(d => d._id) } });
          totalDeleted += batchCount;
        }
      } while (batchCount >= DELETE_BATCH_SIZE);
      if (totalDeleted > 0) {
        log.info("Retention", `Deleted ${totalDeleted} contribution records older than ${contribDays} days`);
      }
    } catch (err) {
      log.error("Retention", `Contribution cleanup failed: ${err.message}`);
    }
  }

  // ── Awaiting cascade timeout sweep ──
  // Only check recent partitions (last 2 days). AWAITING signals older than that
  // are already expired by resultTTL cleanup. No need to scan all 365 partitions.
  try {
    const awaitingTimeout = parseInt(getLandConfigValue("awaitingTimeout") || "300", 10);
    const cutoffMs = Date.now() - awaitingTimeout * 1000;
    const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id").lean();
    if (flowNode) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const recentPartitions = await Node.find({
        parent: flowNode._id,
        name: { $in: [today, yesterday] },
      }).select("_id metadata");

      for (const partition of recentPartitions) {
        const results = partition.metadata instanceof Map
          ? partition.metadata.get("results") || {}
          : partition.metadata?.results || {};

        // Find AWAITING signals that have timed out and transition them atomically
        for (const [signalId, entries] of Object.entries(results)) {
          const arr = Array.isArray(entries) ? entries : [entries];
          for (let i = 0; i < arr.length; i++) {
            const r = arr[i];
            if (r.status === CASCADE.AWAITING && new Date(r.timestamp).getTime() < cutoffMs) {
              // Atomic update per signal to avoid read-modify-write races with concurrent cascade writes
              await Node.updateOne(
                { _id: partition._id },
                {
                  $set: {
                    [`metadata.results.${signalId}.${i}.status`]: CASCADE.FAILED,
                    [`metadata.results.${signalId}.${i}.payload.reason`]: "timeout",
                  },
                },
              );
            }
          }
        }
      }
    }
  } catch (err) {
    log.error("Retention", `Awaiting timeout sweep failed: ${err.message}`);
  }
}

export function startRetentionJob() {
  const intervalMs = Number(getLandConfigValue("retentionCleanupInterval")) || 24 * 60 * 60 * 1000;
  runRetentionCleanup().catch(err => log.error("Retention", `Boot cleanup failed: ${err.message}`));
  cleanupTimer = setInterval(() => {
    runRetentionCleanup().catch(err => log.error("Retention", `Scheduled cleanup failed: ${err.message}`));
  }, intervalMs);
  cleanupTimer.unref();
}

export function stopRetentionJob() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}
