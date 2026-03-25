import express from "express";
import { exportLand, snapshotLand, importLand, listBackups } from "./core.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import log from "../../seed/log.js";
import path from "path";

const router = express.Router();

// POST /backup/full - trigger full backup
router.post("/backup/full", async (req, res) => {
  try {
    const user = await (await import("../../seed/models/user.js")).default.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) return res.status(403).json({ status: "error", error: { code: "FORBIDDEN", message: "Admin required" } });

    const backupPath = getLandConfigValue("backupPath") || "./backups";
    const filename = `full-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const outputPath = path.join(backupPath, filename);

    const result = await exportLand({ outputPath });
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", error: { code: "INTERNAL", message: err.message } });
  }
});

// POST /backup/snapshot - trigger snapshot
router.post("/backup/snapshot", async (req, res) => {
  try {
    const user = await (await import("../../seed/models/user.js")).default.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) return res.status(403).json({ status: "error", error: { code: "FORBIDDEN", message: "Admin required" } });

    const backupPath = getLandConfigValue("backupPath") || "./backups";
    const filename = `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const outputPath = path.join(backupPath, filename);

    const result = await snapshotLand({ outputPath });
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", error: { code: "INTERNAL", message: err.message } });
  }
});

// POST /backup/restore - restore from backup
router.post("/backup/restore", async (req, res) => {
  try {
    const user = await (await import("../../seed/models/user.js")).default.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) return res.status(403).json({ status: "error", error: { code: "FORBIDDEN", message: "Admin required" } });

    const { file } = req.body;
    if (!file) return res.status(400).json({ status: "error", error: { code: "INVALID_INPUT", message: "file is required" } });

    const result = await importLand(file);
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", error: { code: "INTERNAL", message: err.message } });
  }
});

// GET /backup/list - list available backups
router.get("/backup/list", async (req, res) => {
  try {
    const user = await (await import("../../seed/models/user.js")).default.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) return res.status(403).json({ status: "error", error: { code: "FORBIDDEN", message: "Admin required" } });

    const backupPath = getLandConfigValue("backupPath") || "./backups";
    const backups = listBackups(backupPath);
    res.json({ status: "ok", data: { backups } });
  } catch (err) {
    res.status(500).json({ status: "error", error: { code: "INTERNAL", message: err.message } });
  }
});

export async function init(core) {
  // Start automatic snapshot job if configured
  const interval = parseInt(getLandConfigValue("backupInterval") || "0", 10);
  if (interval > 0) {
    const backupPath = getLandConfigValue("backupPath") || "./backups";
    const timer = setInterval(async () => {
      try {
        const filename = `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        const outputPath = path.join(backupPath, filename);
        await snapshotLand({ outputPath });
      } catch (err) {
        log.error("Backup", "Automatic snapshot failed:", err.message);
      }
    }, interval);
    if (timer.unref) timer.unref();
    log.verbose("Backup", `Automatic snapshots every ${Math.round(interval / 3600000)}h to ${backupPath}`);
  }

  // Listen for afterRestore to reinitialize after a restore
  core.hooks.register("afterBoot", async () => {
    const restoreInfo = getLandConfigValue("_restoredFrom");
    if (!restoreInfo) return;

    log.info("Backup", `Post-restore boot detected (restored at ${restoreInfo.restoredAt})`);

    // Rebuild indexes
    try {
      const { ensureIndexes } = await import("../../seed/tree/indexes.js");
      await ensureIndexes();
    } catch {}

    // Integrity check
    try {
      const { checkIntegrity } = await import("../../seed/tree/integrityCheck.js");
      await checkIntegrity({ repair: true });
    } catch {}

    // Invalidate ancestor cache
    try {
      const { invalidateAll } = await import("../../seed/tree/ancestorCache.js");
      invalidateAll();
    } catch {}

    // Fire afterRestore for other extensions
    await core.hooks.run("afterRestore", { restoreInfo });

    // Clear the flag
    const { setLandConfigValue } = await import("../../seed/landConfig.js");
    await setLandConfigValue("_restoredFrom", null);
  }, "backup");

  return {
    router,
    exports: { exportLand, snapshotLand, importLand, listBackups },
  };
}
