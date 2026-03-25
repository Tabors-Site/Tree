// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Seed Migration Runner
 *
 * On boot, checks the seed version stored in .config against the current
 * SEED_VERSION. If they differ, runs every migration between the two versions
 * in order. Migrations can add config defaults, rename metadata keys,
 * restructure system nodes, update indexes.
 *
 * Same pattern as extension schema migrations in the loader.
 *
 * Migration files are named by version: 0.1.0.js, 0.2.0.js, etc.
 * Each exports a single async function: export default async function migrate() { ... }
 */

import log from "../log.js";
import { SEED_VERSION } from "../version.js";
import { getLandConfigValue, setLandConfigValue } from "../landConfig.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 */
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Discover migration files, sorted by version.
 */
async function discoverMigrations() {
  const files = [];
  try {
    const entries = fs.readdirSync(__dirname);
    for (const entry of entries) {
      if (entry === "runner.js") continue;
      if (!entry.endsWith(".js")) continue;
      const version = entry.replace(".js", "");
      // Validate it looks like a semver
      if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
      files.push({ version, file: path.join(__dirname, entry) });
    }
  } catch {
    return [];
  }
  return files.sort((a, b) => compareSemver(a.version, b.version));
}

/**
 * Run seed migrations on boot.
 * Call after initLandConfig() so .config is readable.
 */
export async function runSeedMigrations() {
  const storedVersion = getLandConfigValue("seedVersion") || "0.0.0";
  const currentVersion = SEED_VERSION;

  if (compareSemver(storedVersion, currentVersion) >= 0) {
    // Already at or ahead of current version. Nothing to do.
    log.verbose("Seed", `Seed version ${currentVersion} (up to date)`);
    return;
  }

  log.info("Seed", `Migrating seed from ${storedVersion} to ${currentVersion}`);

  const migrations = await discoverMigrations();
  let ran = 0;

  for (const { version, file } of migrations) {
    // Skip migrations at or below the stored version
    if (compareSemver(version, storedVersion) <= 0) continue;
    // Skip migrations above the current version (future migrations from a newer branch)
    if (compareSemver(version, currentVersion) > 0) break;

    try {
      log.info("Seed", `Running migration ${version}...`);
      const mod = await import(file);
      if (typeof mod.default === "function") {
        await mod.default();
      }
      ran++;
      log.info("Seed", `Migration ${version} complete`);
    } catch (err) {
      log.error("Seed", `Migration ${version} failed: ${err.message}`);
      // Don't update stored version. Next boot will retry from this point.
      throw err;
    }
  }

  // Update stored version
  await setLandConfigValue("seedVersion", currentVersion, { internal: true });

  if (ran > 0) {
    log.info("Seed", `${ran} migration(s) applied. Seed is now at ${currentVersion}`);
  } else {
    // No migration files but version changed (minor bump with no migration needed)
    log.verbose("Seed", `Seed version updated to ${currentVersion}`);
  }
}
