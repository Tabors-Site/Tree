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
