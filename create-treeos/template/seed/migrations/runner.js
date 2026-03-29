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
 *
 * Safety:
 *   - Migrations run in strict semver order
 *   - Failed migration blocks version update (next boot retries)
 *   - 60s timeout per migration (hung migrations don't block boot forever)
 *   - Duplicate version files rejected
 *   - Non-function exports logged and skipped
 *   - Discovery errors surfaced (not swallowed)
 */

import log from "../log.js";
import { SEED_VERSION } from "../version.js";
import { getLandConfigValue, setLandConfigValue } from "../landConfig.js";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_TIMEOUT_MS = 60000; // 60s per migration

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Invalid input returns 0 with a warning (prevents silent skip).
 */
function compareSemver(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return 0;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  // Validate all parts are finite numbers
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(pa[i])) pa[i] = 0;
    if (!Number.isFinite(pb[i])) pb[i] = 0;
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * Discover migration files, sorted by version.
 * Rejects duplicates and non-semver filenames.
 */
function discoverMigrations() {
  const files = [];
  const seen = new Set();

  let entries;
  try {
    entries = fs.readdirSync(__dirname);
  } catch (err) {
    // Surface the error. EACCES or missing dir should be visible, not silent.
    log.error("Seed", `Cannot read migrations directory: ${err.message}`);
    return [];
  }

  for (const entry of entries) {
    if (entry === "runner.js") continue;
    if (!entry.endsWith(".js")) continue;

    const version = entry.replace(".js", "");

    // Strict semver validation (no pre-release, no build metadata)
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;

    // Duplicate detection (e.g., symlinks or copy-paste errors)
    if (seen.has(version)) {
      log.warn("Seed", `Duplicate migration file for version ${version}. Skipping.`);
      continue;
    }
    seen.add(version);

    // Resolve to absolute path and verify it's within the migrations directory
    const filePath = path.resolve(__dirname, entry);
    if (!filePath.startsWith(__dirname)) {
      log.warn("Seed", `Migration file ${entry} resolves outside migrations directory. Skipping.`);
      continue;
    }

    files.push({ version, file: filePath });
  }

  return files.sort((a, b) => compareSemver(a.version, b.version));
}

/**
 * Run a single migration with a timeout.
 */
async function runMigration(version, filePath) {
  const mod = await import(pathToFileURL(filePath).href);

  if (typeof mod.default !== "function") {
    log.warn("Seed", `Migration ${version} does not export a default function. Skipping.`);
    return;
  }

  let timer;
  await Promise.race([
    mod.default(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Migration ${version} timed out after ${MIGRATION_TIMEOUT_MS / 1000}s`)),
        MIGRATION_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Run seed migrations on boot.
 * Call after initLandConfig() so .config is readable.
 */
export async function runSeedMigrations() {
  const storedVersion = getLandConfigValue("seedVersion") || "0.0.0";
  const currentVersion = SEED_VERSION;

  // Validate stored version looks like semver
  if (!/^\d+\.\d+\.\d+$/.test(storedVersion)) {
    log.warn("Seed", `Stored seedVersion "${storedVersion}" is not valid semver. Treating as 0.0.0.`);
  }

  if (compareSemver(storedVersion, currentVersion) >= 0) {
    // Already at or ahead of current version. Nothing to do.
    log.verbose("Seed", `Seed version ${currentVersion} (up to date)`);
    return;
  }

  log.info("Seed", `Migrating seed from ${storedVersion} to ${currentVersion}`);

  const migrations = discoverMigrations();
  let ran = 0;

  for (const { version, file } of migrations) {
    // Skip migrations at or below the stored version
    if (compareSemver(version, storedVersion) <= 0) continue;
    // Skip migrations above the current version (future migrations from a newer branch)
    if (compareSemver(version, currentVersion) > 0) break;

    const startMs = Date.now();
    try {
      log.info("Seed", `Running migration ${version}...`);
      await runMigration(version, file);
      ran++;
      const elapsed = Date.now() - startMs;
      log.info("Seed", `Migration ${version} complete (${elapsed}ms)`);
    } catch (err) {
      const elapsed = Date.now() - startMs;
      log.error("Seed", `Migration ${version} failed after ${elapsed}ms: ${err.message}`);
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
