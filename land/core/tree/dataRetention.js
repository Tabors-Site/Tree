/**
 * Kernel data retention cleanup.
 * Runs daily. Deletes old AIChat and Contribution records based on land config.
 * Configurable: aiChatRetentionDays (default 90), contributionRetentionDays (default 365).
 * Set to 0 to keep forever.
 */

import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";

let cleanupTimer = null;

export async function runRetentionCleanup() {
  const aiChatDays = Number(getLandConfigValue("aiChatRetentionDays")) || 90;
  const contribDays = Number(getLandConfigValue("contributionRetentionDays")) || 365;
  const canopyDays = Number(getLandConfigValue("canopyEventRetentionDays")) || 30;

  const now = new Date();

  // AIChat cleanup
  if (aiChatDays > 0) {
    try {
      const AIChat = (await import("../../db/models/aiChat.js")).default;
      const cutoff = new Date(now.getTime() - aiChatDays * 24 * 60 * 60 * 1000);
      const result = await AIChat.deleteMany({ createdAt: { $lt: cutoff } });
      if (result.deletedCount > 0) {
        log.info("Retention", `Deleted ${result.deletedCount} AI chat records older than ${aiChatDays} days`);
      }
    } catch (err) {
      log.error("Retention", "AIChat cleanup failed:", err.message);
    }
  }

  // Contribution cleanup
  if (contribDays > 0) {
    try {
      const Contribution = (await import("../../db/models/contribution.js")).default;
      const cutoff = new Date(now.getTime() - contribDays * 24 * 60 * 60 * 1000);
      const result = await Contribution.deleteMany({ date: { $lt: cutoff } });
      if (result.deletedCount > 0) {
        log.info("Retention", `Deleted ${result.deletedCount} contribution records older than ${contribDays} days`);
      }
    } catch (err) {
      log.error("Retention", "Contribution cleanup failed:", err.message);
    }
  }

  // Canopy event cleanup (sent/acked/failed)
  if (canopyDays > 0) {
    try {
      const CanopyEvent = (await import("../../db/models/canopyEvent.js")).default;
      const cutoff = new Date(now.getTime() - canopyDays * 24 * 60 * 60 * 1000);
      const result = await CanopyEvent.deleteMany({
        status: { $in: ["sent", "acked", "failed"] },
        createdAt: { $lt: cutoff },
      });
      if (result.deletedCount > 0) {
        log.info("Retention", `Deleted ${result.deletedCount} canopy events older than ${canopyDays} days`);
      }
    } catch (err) {
      log.error("Retention", "Canopy event cleanup failed:", err.message);
    }
  }
}

export function startRetentionJob() {
  // Run once at boot, then daily
  runRetentionCleanup().catch(() => {});
  cleanupTimer = setInterval(() => {
    runRetentionCleanup().catch(() => {});
  }, 24 * 60 * 60 * 1000);
  cleanupTimer.unref();
}

export function stopRetentionJob() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}
