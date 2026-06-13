// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// manifestDeps.js — manifest dependency utilities.
//
// Extensions declare two kinds of dependencies in their manifest:
//
//   - Other extensions (`needs.extensions` / `optional.extensions`),
//     possibly with a semver constraint like
//     `"understanding@^1.0.0"`. The loader checks the resolved
//     extension's manifest.version against the constraint and
//     refuses to load if it doesn't satisfy.
//
//   - npm packages (`needs.npm`), each entry like `"discord.js@^14.0.0"`,
//     `"@scope/pkg@^1.0.0"`, or `"web-push"` (wildcard). The loader
//     generates a per-extension package.json and runs
//     `npm install --production --no-fund --no-audit --ignore-scripts`
//     in the extension's directory at boot when the on-disk deps
//     don't match.
//
// This file owns both: the semver matcher for the first, the npm
// install runner for the second. Pure utilities apart from
// `runNpmInstall` which shells out to `npm`.

import fs from "fs";
import path from "path";
import log from "../seed/seedReality/log.js";

// ─────────────────────────────────────────────────────────────────────
// Semver matching (no external deps)
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a dependency string like "understanding" or
 * "understanding@^1.0.0". Returns { name, constraint } where
 * constraint is null or the version part.
 */
export function parseDepString(dep) {
  const atIdx = dep.indexOf("@");
  if (atIdx <= 0) return { name: dep, constraint: null };
  return { name: dep.slice(0, atIdx), constraint: dep.slice(atIdx + 1) };
}

/**
 * Parse a semver string "1.2.3" into [major, minor, patch].
 */
export function parseSemver(v) {
  const match = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Check if version satisfies a constraint.
 * Supports: "1.2.3" (exact), "^1.2.3" (compatible),
 * ">=1.2.3", ">1.2.3", "1.x", "1.2.x".
 */
export function semverSatisfies(version, constraint) {
  const v = parseSemver(version);
  if (!v) return true; // unparseable version, skip check

  // Wildcard: "1.x" or "1.2.x"
  if (constraint.includes("x")) {
    const parts = constraint.split(".");
    if (parts[0] !== "x" && Number(parts[0]) !== v[0]) return false;
    if (parts[1] && parts[1] !== "x" && Number(parts[1]) !== v[1]) return false;
    return true;
  }

  // >= operator
  if (constraint.startsWith(">=")) {
    const c = parseSemver(constraint.slice(2));
    if (!c) return true;
    if (v[0] !== c[0]) return v[0] > c[0];
    if (v[1] !== c[1]) return v[1] > c[1];
    return v[2] >= c[2];
  }

  // > operator
  if (constraint.startsWith(">") && !constraint.startsWith(">=")) {
    const c = parseSemver(constraint.slice(1));
    if (!c) return true;
    if (v[0] !== c[0]) return v[0] > c[0];
    if (v[1] !== c[1]) return v[1] > c[1];
    return v[2] > c[2];
  }

  // ^ operator (compatible: same major, >= minor.patch)
  if (constraint.startsWith("^")) {
    const c = parseSemver(constraint.slice(1));
    if (!c) return true;
    if (v[0] !== c[0]) return false; // major must match
    if (v[1] !== c[1]) return v[1] > c[1];
    return v[2] >= c[2];
  }

  // Exact match (or = prefix)
  const exact = constraint.startsWith("=") ? constraint.slice(1) : constraint;
  const c = parseSemver(exact);
  if (!c) return true;
  return v[0] === c[0] && v[1] === c[1] && v[2] === c[2];
}

// ─────────────────────────────────────────────────────────────────────
// npm dependency management
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a manifest npm array into a dependencies object for package.json.
 *   "discord.js@^14.0.0" -> { "discord.js": "^14.0.0" }
 *   "@scope/pkg@^1.0.0"  -> { "@scope/pkg": "^1.0.0" }
 *   "web-push"           -> { "web-push": "*" }
 */
export function parseNpmDeps(npmArray) {
  const deps = {};
  for (const entry of npmArray) {
    const scopeEnd = entry.startsWith("@") ? entry.indexOf("/") : -1;
    const atIdx = entry.indexOf("@", scopeEnd + 1);
    if (atIdx > 0) {
      deps[entry.slice(0, atIdx)] = entry.slice(atIdx + 1);
    } else {
      deps[entry] = "*";
    }
  }
  return deps;
}

/**
 * Check whether npm install needs to run for an extension. Returns
 * true if node_modules or package.json is missing, or if the
 * package.json deps don't match the manifest's npm array.
 */
export function needsNpmInstall(extDir, npmDeps) {
  const nmDir = path.join(extDir, "node_modules");
  const pkgPath = path.join(extDir, "package.json");

  if (!fs.existsSync(nmDir)) return true;
  if (!fs.existsSync(pkgPath)) return true;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const current = pkg.dependencies || {};
    const wanted = parseNpmDeps(npmDeps);

    const currentKeys = Object.keys(current).sort();
    const wantedKeys = Object.keys(wanted).sort();
    if (currentKeys.length !== wantedKeys.length) return true;
    for (let i = 0; i < currentKeys.length; i++) {
      if (currentKeys[i] !== wantedKeys[i]) return true;
      if (current[currentKeys[i]] !== wanted[wantedKeys[i]]) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Generate package.json and run npm install in an extension directory.
 * Uses execSync (same pattern as installFromRepo's git clone).
 * Throws on failure so the caller can handle rollback.
 */
export async function runNpmInstall(extDir, npmDeps, extName, opts = {}) {
  const deps = parseNpmDeps(npmDeps);

  const pkgJson = JSON.stringify(
    {
      name: `treeos-ext-${extName}`,
      version: "1.0.0",
      private: true,
      dependencies: deps,
    },
    null,
    2,
  );

  fs.writeFileSync(path.join(extDir, "package.json"), pkgJson, "utf8");

  let timeout = opts.timeout || 60000;
  try {
    const { getRealityConfigValue } = await import("../seed/realityConfig.js");
    const configured = getRealityConfigValue("npmInstallTimeout");
    if (configured) timeout = Number(configured);
  } catch {}

  const { execSync } = await import("child_process");
  try {
    execSync("npm install --production --no-fund --no-audit --ignore-scripts", {
      cwd: extDir,
      stdio: "pipe",
      timeout,
      shell: true,
    });
    log.verbose(
      "Extensions",
      `${extName}: npm install complete (${npmDeps.length} packages)`,
    );
  } catch (err) {
    const stderr = err.stderr
      ? err.stderr.toString().slice(0, 500)
      : err.message;
    throw new Error(`npm install failed: ${stderr}`);
  }
}
