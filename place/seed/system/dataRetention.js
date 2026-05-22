// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Periodic forgetting.
//
// Summons and Facts accumulate forever otherwise. I sweep both on a
// cadence (default daily), deleting rows older than the configured
// retention window. The configured zero means "keep forever":
//
//   summonRetentionDays  default 90,  0 to keep forever
//   factRetentionDays    default 365, 0 to keep forever
//
// AWAITING cascade signals get their own short sweep. A signal stuck
// in AWAITING past `awaitingTimeout` seconds transitions to FAILED
// with reason "timeout". Only recent partitions are scanned because
// older AWAITINGs are already gone via the resultTTL cleanup.

import log from "./log.js";
import { getPlaceConfigValue } from "../placeConfig.js";
import Stamp from "../models/stamp.js";
import Fact from "../models/fact.js";
import Space from "../models/space.js";
import { SEED_SPACE } from "../place/space/seedSpaces.js";
import { CASCADE } from "../place/space/cascade.js";

let cleanupTimer = null;

// Batch size for deleteMany. Prevents one massive delete from blocking
// the DB for minutes on collections with millions of documents.
const DELETE_BATCH_SIZE = 10000;

export async function runRetentionCleanup() {
  const now = new Date();

  // ── Stamp cleanup ──
  const summonDays = Number(getPlaceConfigValue("summonRetentionDays"));
  if (summonDays > 0) {
    try {
      const cutoff = new Date(now.getTime() - summonDays * 24 * 60 * 60 * 1000);
      let totalDeleted = 0;
      // Batch delete: find IDs first, then delete by ID set.
      // deleteMany().limit() is not supported by MongoDB. Without batching,
      // one massive delete could block the DB for minutes on large collections.
      let batchCount;
      do {
        const ids = await Stamp.find({ "startMessage.time": { $lt: cutoff } })
          .select("_id").limit(DELETE_BATCH_SIZE).lean();
        batchCount = ids.length;
        if (batchCount > 0) {
          await Stamp.deleteMany({ _id: { $in: ids.map(d => d._id) } });
          totalDeleted += batchCount;
        }
      } while (batchCount >= DELETE_BATCH_SIZE);
      if (totalDeleted > 0) {
        log.info("Retention", `Deleted ${totalDeleted} summon records older than ${summonDays} days`);
      }
    } catch (err) {
      log.error("Retention", `Stamp cleanup failed: ${err.message}`);
    }
  }

  // ── Fact cleanup ──
  const factDays = Number(getPlaceConfigValue("factRetentionDays"));
  if (factDays > 0) {
    try {
      const cutoff = new Date(now.getTime() - factDays * 24 * 60 * 60 * 1000);
      let totalDeleted = 0;
      let batchCount;
      do {
        const ids = await Fact.find({ date: { $lt: cutoff } })
          .select("_id").limit(DELETE_BATCH_SIZE).lean();
        batchCount = ids.length;
        if (batchCount > 0) {
          await Fact.deleteMany({ _id: { $in: ids.map(d => d._id) } });
          totalDeleted += batchCount;
        }
      } while (batchCount >= DELETE_BATCH_SIZE);
      if (totalDeleted > 0) {
        log.info("Retention", `Deleted ${totalDeleted} Fact records older than ${factDays} days`);
      }
    } catch (err) {
      log.error("Retention", `Fact cleanup failed: ${err.message}`);
    }
  }

  // ── Awaiting cascade timeout sweep ──
  // Only check recent partitions (last 2 days). AWAITING signals older than that
  // are already expired by resultTTL cleanup. No need to scan all 365 partitions.
  try {
    const awaitingTimeout = parseInt(getPlaceConfigValue("awaitingTimeout") || "300", 10);
    const cutoffMs = Date.now() - awaitingTimeout * 1000;
    const flowNode = await Space.findOne({ seedSpace: SEED_SPACE.FLOW }).select("_id").lean();
    if (flowNode) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const recentPartitions = await Space.find({
        parent: flowNode._id,
        name: { $in: [today, yesterday] },
      }).select("_id metadata");

      for (const partition of recentPartitions) {
        const results = partition.qualities instanceof Map
          ? partition.qualities.get("results") || {}
          : partition.qualities?.results || {};

        // Find AWAITING signals that have timed out and transition them atomically
        for (const [signalId, entries] of Object.entries(results)) {
          const arr = Array.isArray(entries) ? entries : [entries];
          for (let i = 0; i < arr.length; i++) {
            const r = arr[i];
            if (r.status === CASCADE.AWAITING && new Date(r.timestamp).getTime() < cutoffMs) {
              // Atomic update per signal to avoid read-modify-write races with concurrent cascade writes
              await Space.updateOne(
                { _id: partition._id },
                {
                  $set: {
                    [`qualities.results.${signalId}.${i}.status`]: CASCADE.FAILED,
                    [`qualities.results.${signalId}.${i}.payload.reason`]: "timeout",
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
  const intervalMs = Number(getPlaceConfigValue("retentionCleanupInterval")) || 24 * 60 * 60 * 1000;
  runRetentionCleanup().catch(err => log.error("Retention", `Boot cleanup failed: ${err.message}`));
  cleanupTimer = setInterval(() => {
    runRetentionCleanup().catch(err => log.error("Retention", `Scheduled cleanup failed: ${err.message}`));
  }, intervalMs);
  cleanupTimer.unref();
}

export function stopRetentionJob() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}
