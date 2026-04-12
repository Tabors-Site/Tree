// extensions/loader.js
// Scans extension manifests, validates dependencies, initializes extensions,
// and wires routes/tools/jobs/models into the host land.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import { buildCoreServices } from "../seed/services.js";
import { setExtensionToolResolver, registerMode, setModeRegistrationHook } from "../seed/modes/registry.js";
import { hooks } from "../seed/hooks.js";
import { registerOrchestrator, allowOrchestratorExtension } from "../seed/orchestrators/registry.js";
import { registerModeOwner, registerToolOwner, getToolOwner, getModeOwner } from "../seed/tree/extensionScope.js";
import log from "../seed/log.js";

// Wire mode ownership tracking for spatial scoping
setModeRegistrationHook(registerModeOwner);

/** Convert a file path to a URL string for dynamic import (Windows compat) */
function toImportURL(filePath) {
  return pathToFileURL(filePath).href;
}

const EXT_ROUTE_TIMEOUT_MS = 5000;

/**
 * Wrap an extension router with a timeout safety net.
 * If the extension doesn't respond or call next() within 5 seconds,
 * the wrapper calls next() so kernel routes can handle the request.
 *
 * Uses res "finish" event instead of monkey-patching res.end.
 */
function withExtensionTimeout(router, extName) {
  return (req, res, next) => {
    let done = false;

    const cleanup = () => {
      done = true;
      clearTimeout(timer);
      res.removeListener("finish", cleanup);
    };

    const timer = setTimeout(() => {
      if (!done && !res.headersSent) {
        done = true;
        res.removeListener("finish", cleanup);
        log.warn("Loader", `Extension router "${extName}" timed out on ${req.method} ${req.path}, falling through`);
        next();
      } else if (!done) {
        // Headers already sent but response not finished. Close the partial response.
        done = true;
        res.removeListener("finish", cleanup);
        log.warn("Loader", `Extension router "${extName}" timed out mid-stream on ${req.method} ${req.path}, closing response`);
        try { res.end(); } catch {}
      }
    }, EXT_ROUTE_TIMEOUT_MS);

    // Response finished normally: clear timeout
    res.once("finish", cleanup);

    try {
      router(req, res, (...args) => {
        // Extension called next(): clear timeout and listener, pass through
        cleanup();
        next(...args);
      });
    } catch (err) {
      cleanup();
      log.error("Loader", `Extension router "${extName}" threw on ${req.method} ${req.path}:`, err.message);
      next();
    }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISABLED_FILE = path.join(__dirname, ".disabled");

// Profile filter: if .treeos-profile exists, only listed extensions load.
// Written by boot.js when user selects an install profile. One name per line.
// If absent, all extensions load (backward compatible).
let _profileFilter = null;
try {
  const profilePath = path.join(__dirname, ".treeos-profile");
  if (fs.existsSync(profilePath)) {
    const names = fs.readFileSync(profilePath, "utf8").split("\n").map(s => s.trim()).filter(Boolean);
    if (names.length > 0) _profileFilter = new Set(names);
  }
} catch {}

// ---------------------------------------------------------------------------
// Disabled extensions file (synced to disk so loader can read before DB)
// ---------------------------------------------------------------------------

/**
 * Read disabled extensions from local file (synchronous, used at boot).
 */
function readDisabledFile() {
  try {
    if (!fs.existsSync(DISABLED_FILE)) return [];
    const content = fs.readFileSync(DISABLED_FILE, "utf8").trim();
    if (!content) return [];
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Write disabled extensions to local file.
 * Called by the config endpoint when disabling/enabling.
 */
export function syncDisabledFile(list) {
  try {
    fs.writeFileSync(DISABLED_FILE, JSON.stringify(list), "utf8");
  } catch (err) {
    log.warn("Extensions", "Failed to write disabled file:", err.message);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Semver utilities (no external deps)
// ---------------------------------------------------------------------------

/**
 * Parse a dependency string like "understanding" or "understanding@^1.0.0".
 * Returns { name, constraint } where constraint is null or the version part.
 */
function parseDepString(dep) {
  const atIdx = dep.indexOf("@");
  if (atIdx <= 0) return { name: dep, constraint: null };
  return { name: dep.slice(0, atIdx), constraint: dep.slice(atIdx + 1) };
}

/**
 * Parse a semver string "1.2.3" into [major, minor, patch].
 */
function parseSemver(v) {
  const match = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Check if version satisfies a constraint.
 * Supports: "1.2.3" (exact), "^1.2.3" (compatible), ">=1.2.3", ">1.2.3", "1.x", "1.2.x"
 */
function semverSatisfies(version, constraint) {
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

// ---------------------------------------------------------------------------
// npm dependency management
// ---------------------------------------------------------------------------

/**
 * Parse a manifest npm array into a dependencies object for package.json.
 * "discord.js@^14.0.0" -> { "discord.js": "^14.0.0" }
 * "@scope/pkg@^1.0.0"  -> { "@scope/pkg": "^1.0.0" }
 * "web-push"           -> { "web-push": "*" }
 */
function parseNpmDeps(npmArray) {
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
 * Check whether npm install needs to run for an extension.
 * Returns true if node_modules or package.json is missing, or if
 * the package.json deps don't match the manifest's npm array.
 */
function needsNpmInstall(extDir, npmDeps) {
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
 * Uses execFileSync (same pattern as installFromRepo's git clone).
 * Throws on failure so the caller can handle rollback.
 */
async function runNpmInstall(extDir, npmDeps, extName, opts = {}) {
  const deps = parseNpmDeps(npmDeps);

  const pkgJson = JSON.stringify({
    name: `treeos-ext-${extName}`,
    version: "1.0.0",
    private: true,
    dependencies: deps,
  }, null, 2);

  fs.writeFileSync(path.join(extDir, "package.json"), pkgJson, "utf8");

  let timeout = opts.timeout || 60000;
  try {
    const { getLandConfigValue } = await import("../seed/landConfig.js");
    const configured = getLandConfigValue("npmInstallTimeout");
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
    log.verbose("Extensions", `${extName}: npm install complete (${npmDeps.length} packages)`);
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().slice(0, 500) : err.message;
    throw new Error(`npm install failed: ${stderr}`);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const loaded = new Map();       // name -> { manifest, instance }
let coreServices = null;        // the assembled core bundle
const _bootSkipped = [];        // [{ name, reason }] extensions that failed to load
const modeToolExtensions = [];  // [{ modeKey, toolNames }] from extensions
const registeredJobs = [];      // [{ name, start, stop }] from extensions

// ---------------------------------------------------------------------------
// Configuration: enable/disable extensions
// ---------------------------------------------------------------------------

/**
 * Get disabled extensions from env var and optional config callback.
 * Env: DISABLED_EXTENSIONS=solana,billing (comma-separated)
 */
function getDisabledExtensions(configFn) {
  const fromEnv = (process.env.DISABLED_EXTENSIONS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  // Read from local file (persisted by disable/enable endpoints)
  const fromFile = readDisabledFile();

  let fromConfig = [];
  if (typeof configFn === "function") {
    try {
      fromConfig = configFn("disabledExtensions") || [];
    } catch {
      // Config not loaded yet, that's fine
    }
  }

  return new Set([...fromEnv, ...fromFile, ...fromConfig]);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Derived from buildCoreServices() at load time. Set by loadExtensions().
let AVAILABLE_SERVICES = new Set();

const AVAILABLE_MODELS = new Set([
  "User", "Node", "Contribution", "Note",
]);

function validateNeeds(manifest, core) {
  const missing = [];

  if (manifest.needs?.services) {
    for (const svc of manifest.needs.services) {
      if (!AVAILABLE_SERVICES.has(svc) && !core[svc]) {
        missing.push(`service:${svc}`);
      }
    }
  }

  if (manifest.needs?.models) {
    for (const model of manifest.needs.models) {
      if (!AVAILABLE_MODELS.has(model) && !core.models[model]) {
        missing.push(`model:${model}`);
      }
    }
  }

  // Check inter-extension dependencies (supports name or name@constraint)
  if (manifest.needs?.extensions) {
    for (const dep of manifest.needs.extensions) {
      const { name: depName, constraint } = parseDepString(dep);
      if (!loaded.has(depName)) {
        missing.push(`extension:${depName}`);
      } else if (constraint) {
        const depManifest = loaded.get(depName)?.manifest;
        if (depManifest?.version && !semverSatisfies(depManifest.version, constraint)) {
          missing.push(`extension:${depName} (need ${constraint}, have ${depManifest.version})`);
        }
      }
    }
  }

  return missing;
}

/**
 * Inject no-op stubs for optional kernel services the host land doesn't have.
 * Only stubs kernel-provided services (AVAILABLE_SERVICES). Extension-provided
 * services (like energy) are either present because that extension loaded first,
 * or absent. Extensions guard with if (core.svc) for those.
 */
function applyOptionalStubs(manifest, core) {
  if (!manifest.optional?.services) return;

  for (const svc of manifest.optional.services) {
    if (AVAILABLE_SERVICES.has(svc) && !core[svc]) {
      core[svc] = {};
    }
  }
}

// ---------------------------------------------------------------------------
// Environment variable resolution
// ---------------------------------------------------------------------------

/**
 * Resolve env vars declared in manifest.provides.env.
 * Auto-generates keys with autoGenerate: true if missing.
 * Returns { ok: true } or { ok: false, missing: ["description of what's missing"] }.
 */
function resolveExtensionEnv(manifest) {
  const envDecls = manifest.provides.env;
  if (!Array.isArray(envDecls) || envDecls.length === 0) return { ok: true };

  const missing = [];
  const generated = [];

  for (const decl of envDecls) {
    if (!decl.key) continue;
    const value = process.env[decl.key];

    if (value) continue; // already set

    // Apply default if provided
    if (decl.default !== undefined) {
      process.env[decl.key] = String(decl.default);
      continue;
    }

    // Auto-generate if allowed
    if (decl.autoGenerate) {
      const key = crypto.randomBytes(32).toString("hex");
      process.env[decl.key] = key;
      generated.push(decl.key);
      appendToEnvFile(decl.key, key, decl.description);
      continue;
    }

    // Required but missing
    if (decl.required !== false) {
      missing.push(`missing env ${decl.key}${decl.description ? ` (${decl.description})` : ""}`);
    }
  }

  if (generated.length > 0) {
    log.verbose("Extensions", `${manifest.name}: auto-generated ${generated.join(", ")}`);
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true };
}

/**
 * Append an auto-generated env var to .env file.
 */
function appendToEnvFile(key, value, description) {
  try {
    const envPath = path.resolve(__dirname, "../.env");
    if (!fs.existsSync(envPath)) return;
    const line = `\n# Auto-generated by extension loader${description ? ` (${description})` : ""}\n${key}=${value}\n`;
    fs.appendFileSync(envPath, line);
  } catch {}
}

// ---------------------------------------------------------------------------
// Scoped core (permission boundary)
// ---------------------------------------------------------------------------

/**
 * Build a scoped core services bundle that only includes what the manifest
 * declares in needs + optional. Extensions cannot access services they
 * didn't declare.
 */
function buildScopedCore(manifest, fullCore) {
  const allowed = new Set();

  // Collect all declared services (required + optional)
  for (const svc of manifest.needs?.services || []) allowed.add(svc);
  for (const svc of manifest.optional?.services || []) allowed.add(svc);

  // Collect declared models
  const allowedModels = new Set(manifest.needs?.models || []);
  for (const m of manifest.optional?.models || []) allowedModels.add(m);

  // Build scoped object
  const scoped = {};

  // Services: inject declared kernel services
  for (const key of AVAILABLE_SERVICES) {
    if (allowed.has(key) && fullCore[key]) {
      scoped[key] = fullCore[key];
    }
  }

  // Also inject declared services that were dynamically registered by other
  // extensions (e.g. energy registers core.energy during its init). The kernel
  // doesn't name these. Extensions discover them by declaration.
  for (const svc of allowed) {
    if (!AVAILABLE_SERVICES.has(svc) && fullCore[svc]) {
      scoped[svc] = fullCore[svc];
    }
  }

  // Models: only inject declared ones (plus any registered by other extensions)
  scoped.models = {};
  for (const name of allowedModels) {
    if (fullCore.models[name]) {
      scoped.models[name] = fullCore.models[name];
    }
  }

  // Hooks: always available (core infrastructure, not a declared service)
  if (fullCore.hooks) {
    scoped.hooks = fullCore.hooks;
  }

  // Modes: always available (extensions register their own AI modes)
  if (fullCore.modes) {
    scoped.modes = fullCore.modes;
  }

  // Metadata: always available (every extension reads/writes metadata)
  if (fullCore.metadata) {
    scoped.metadata = fullCore.metadata;
  }

  // User metadata: always available (extensions store per-user state)
  if (fullCore.userMetadata) {
    scoped.userMetadata = fullCore.userMetadata;
  }

  // Auth strategy binding: wrap registerStrategy to auto-inject extension name.
  // Extensions must declare provides.authStrategies in manifest to register.
  if (scoped.auth?.registerStrategy) {
    const extName = manifest.name;
    if (manifest.provides?.authStrategies) {
      scoped.auth.allowStrategyExtension(extName);
    }
    const origRegister = scoped.auth.registerStrategy;
    scoped.auth = {
      ...scoped.auth,
      registerStrategy: (name, handler) => origRegister(name, handler, extName),
    };
  }

  // Orchestrator binding: auto-inject extension name so the registry can validate.
  if (scoped.orchestrators?.register) {
    const extName = manifest.name;
    const origRegister = scoped.orchestrators.register;
    scoped.orchestrators = {
      ...scoped.orchestrators,
      register: (bigMode, handler) => origRegister(bigMode, handler, extName),
    };
  }

  // Mode binding: auto-inject extension name to prevent impersonation.
  // Extensions cannot register modes under another extension's identity.
  if (scoped.modes?.registerMode) {
    const extName = manifest.name;
    const origRegister = scoped.modes.registerMode;
    scoped.modes = {
      ...scoped.modes,
      registerMode: (key, handler) => origRegister(key, handler, extName),
    };
  }

  // Metadata binding: enforce namespace ownership.
  // Extensions can only write to their own namespace (matching manifest name)
  // or core namespaces (cascade, extensions, tools, modes).
  // getExtMeta is unbound (read any namespace). setExtMeta and mergeExtMeta
  // pass callerExtName so the kernel rejects cross-namespace writes.
  if (scoped.metadata) {
    const extName = manifest.name;
    const origSet = scoped.metadata.setExtMeta;
    const origMerge = scoped.metadata.mergeExtMeta;
    scoped.metadata = {
      ...scoped.metadata,
      setExtMeta: (node, ns, data) => origSet(node, ns, data, { callerExtName: extName }),
      mergeExtMeta: (node, ns, partial) => origMerge(node, ns, partial, { callerExtName: extName }),
    };
  }

  // Freeze existing kernel services so extensions can't replace core.hooks,
  // core.llm, etc. But allow adding new properties (core.energy = {...})
  // which is the pattern for extension-provided services.
  for (const key of Object.keys(scoped)) {
    if (scoped[key] && typeof scoped[key] === "object" && !Array.isArray(scoped[key])) {
      Object.freeze(scoped[key]);
    }
  }
  return scoped;
}

// ---------------------------------------------------------------------------
// Dependency ordering (proper topological sort)
// ---------------------------------------------------------------------------

function topologicalSort(manifests) {
  const byName = new Map();
  for (const m of manifests) byName.set(m.manifest.name, m);

  const visited = new Set();
  const sorted = [];

  function visit(item) {
    const name = item.manifest.name;
    if (visited.has(name)) return;
    visited.add(name);

    // Visit REQUIRED extension dependencies first (strip semver constraints for lookup).
    if (item.manifest.needs?.extensions) {
      for (const dep of item.manifest.needs.extensions) {
        const depName = parseDepString(dep).name;
        if (byName.has(depName)) visit(byName.get(depName));
      }
    }
    // Visit OPTIONAL extension dependencies too for load ordering.
    // They won't cause failures if missing (checked at runtime via getExtension()),
    // but if present they should load first so init() can access their exports.
    // Skip if the optional dep requires us (would invert the required chain).
    if (item.manifest.optional?.extensions) {
      for (const dep of item.manifest.optional.extensions) {
        const depName = parseDepString(dep).name;
        const depItem = byName.get(depName);
        if (!depItem) continue;
        // Don't visit if it requires us (circular would invert required ordering)
        const depNeeds = depItem.manifest.needs?.extensions?.map(d => parseDepString(d).name) || [];
        if (depNeeds.includes(name)) continue;
        visit(depItem);
      }
    }

    sorted.push(item);
  }

  // No pre-sort. The recursive visit produces correct ordering regardless of
  // iteration order. That's the entire point of topological sort. A pre-sort
  // can break the invariant by changing when nodes get visited.
  for (const item of manifests) visit(item);
  return sorted;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Scan for extension manifests and load them.
 *
 * @param {object} app         - Express app
 * @param {object} mcpServer   - MCP server instance (optional)
 * @param {object} opts
 * @param {object} opts.overrides - service overrides for buildCoreServices
 * @param {Function} opts.getConfigValue - land config reader (key => value)
 * @returns {Map} loaded extensions
 */
export async function loadExtensions(app, mcpServer, opts = {}) {
  // Track route ownership for collision detection
  const routeOwnership = new Map();

  // Build core services (initially with empty loadedExtensions)
  coreServices = buildCoreServices({
    loadedExtensions: loaded,
    overrides: opts.overrides || {},
  });

  // Derive available services from what buildCoreServices actually produced.
  // No hardcoded list. If services.js adds a new service, it's automatically available.
  AVAILABLE_SERVICES = new Set(Object.keys(coreServices).filter(k => k !== "models"));

  // Discover manifests
  const manifests = await discoverManifests();

  if (manifests.length === 0) {
    log.info("Extensions", "No extension manifests found");
    return loaded;
  }

  // Check disabled list (env var + land config)
  const disabled = getDisabledExtensions(opts.getConfigValue);
  const enabled = manifests.filter(({ manifest }) => {
    if (disabled.has(manifest.name)) {
      log.verbose("Extensions", `Disabled: ${manifest.name} (DISABLED_EXTENSIONS)`);
      return false;
    }
    return true;
  });

  // Sort by dependencies (proper topological sort)
  const sorted = topologicalSort(enabled);
  log.debug("Extensions", `Load order: ${sorted.map(s => s.manifest.name).join(", ")}`);

  // Load each extension
  for (let _si = 0; _si < sorted.length; _si++) {
    const { manifest, dir, entryPath } = sorted[_si];
    try {
      // Validate required dependencies
      const missing = validateNeeds(manifest, coreServices);
      if (missing.length > 0) {
        log.debug("Extensions", `[${_si}/${sorted.length}] ${manifest.name} SKIP (missing: ${missing.join(", ")}). loaded: ${[...loaded.keys()].join(", ")}`);
        log.warn("Extensions",
          `Skipping "${manifest.name}": missing required deps: ${missing.join(", ")}`
        );
        _bootSkipped.push({ name: manifest.name, reason: "missing deps" });
        continue;
      }

      // Resolve env vars declared by extension
      if (manifest.provides?.env) {
        const envResult = resolveExtensionEnv(manifest);
        if (!envResult.ok) {
          log.warn("Extensions",
          `Skipping "${manifest.name}": ${envResult.missing.join(", ")}. Set in .env and restart.`
          );
          _bootSkipped.push({ name: manifest.name, reason: "missing env" });
          continue;
        }
      }

      // Boot-time npm recovery: if manifest declares npm deps and node_modules is missing
      if (manifest.npm && manifest.npm.length > 0) {
        if (needsNpmInstall(dir, manifest.npm)) {
          log.warn("Extensions", `"${manifest.name}": npm dependencies missing or outdated, running npm install...`);
          try {
            await runNpmInstall(dir, manifest.npm, manifest.name);
          } catch (npmErr) {
            log.error("Extensions", `Skipping "${manifest.name}": npm install failed: ${npmErr.message}`);
            _bootSkipped.push({ name: manifest.name, reason: "npm install failed" });
            continue;
          }
        }
      }

      // Apply no-op stubs for optional deps
      applyOptionalStubs(manifest, coreServices);

      // Load the extension's init function
      const extModule = await import(toImportURL(entryPath));
      if (typeof extModule.init !== "function") {
        log.warn("Extensions", `Skipping "${manifest.name}": no init() export`);
        _bootSkipped.push({ name: manifest.name, reason: "no init()" });
        continue;
      }

      // Build scoped core: only inject what the manifest declares
      const scopedCore = buildScopedCore(manifest, coreServices);

      // Pre-approve orchestrator registration if declared in manifest
      if (manifest.provides?.orchestrator) {
        allowOrchestratorExtension(manifest.name);
      }

      // Initialize (with timeout to prevent a single extension from blocking boot)
      const INIT_TIMEOUT_MS = 10000;
      let instance;
      try {
        instance = await Promise.race([
          extModule.init(scopedCore),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`init() timed out after ${INIT_TIMEOUT_MS}ms`)), INIT_TIMEOUT_MS)
          ),
        ]);
      } catch (initErr) {
        let hint = "";
        // Diagnose common init failures: extension accessing a service it didn't declare
        if (initErr.message?.includes("Cannot read properties of undefined") ||
            initErr.message?.includes("is not extensible") ||
            initErr.message?.includes("Cannot set property")) {
          const declared = new Set([
            ...(manifest.needs?.services || []),
            ...(manifest.optional?.services || []),
          ]);
          const missing = [...AVAILABLE_SERVICES].filter(s => !declared.has(s) && coreServices[s]);
          if (missing.length > 0) {
            hint = ` Hint: add missing services to manifest needs/optional: ${missing.join(", ")}`;
          }
        }
        log.error("Extensions", `"${manifest.name}": ${initErr.message}.${hint} Skipped.`);
        _bootSkipped.push({ name: manifest.name, reason: initErr.message.slice(0, 80) });
        continue;
      }

      // Validate init() return
      if (!instance || typeof instance !== "object") {
        log.warn("Extensions", `"${manifest.name}": init() must return an object. Got ${typeof instance}. Skipped.`);
        continue;
      }
      if (instance.router && typeof instance.router.use !== "function") {
        log.warn("Extensions", `"${manifest.name}": router is not a valid Express router. Skipped.`);
        continue;
      }
      if (instance.tools !== undefined && !Array.isArray(instance.tools)) {
        log.warn("Extensions", `"${manifest.name}": tools must be an array. Skipped.`);
        continue;
      }
      if (instance.jobs !== undefined && !Array.isArray(instance.jobs)) {
        log.warn("Extensions", `"${manifest.name}": jobs must be an array. Skipped.`);
        continue;
      }
      if (instance.middleware !== undefined && !Array.isArray(instance.middleware)) {
        log.warn("Extensions", `"${manifest.name}": middleware must be an array. Skipped.`);
        continue;
      }

      // Wire middleware (runs before kernel routes on matching paths)
      if (instance.middleware) {
        for (const mw of instance.middleware) {
          if (!mw.path || typeof mw.handler !== "function") {
            log.warn("Extensions", `"${manifest.name}": middleware entry missing path or handler. Skipped.`);
            continue;
          }
          app.use(mw.path, mw.handler);
        }
      }

      // Wire routes (with collision detection)
      if (instance.router) {
        // Extract route paths from the router's stack
        const routePaths = [];
        if (instance.router.stack) {
          for (const layer of instance.router.stack) {
            if (layer.route?.path) {
              routePaths.push(layer.route.path);
            }
          }
        }

        // Check for collisions with already-registered extension routes
        let hasCollision = false;
        for (const rpath of routePaths) {
          if (routeOwnership.has(rpath)) {
            const owner = routeOwnership.get(rpath);
            log.error("Extensions", `Route collision: "${rpath}" claimed by both "${owner}" and "${manifest.name}". Skipping "${manifest.name}" routes.`);
            hasCollision = true;
            break;
          }
        }

        if (!hasCollision) {
          for (const rpath of routePaths) {
            routeOwnership.set(rpath, manifest.name);
          }
          app.use("/api/v1", instance.router);
        }
      }

      // Wire page routes (mounted at / for HTML pages like /login, /register)
      if (instance.pageRouter && typeof instance.pageRouter.use === "function") {
        app.use("/", withExtensionTimeout(instance.pageRouter, manifest.name));
      }

      // Wire raw-body webhook (e.g. Stripe). Extension returns rawWebhook from init().
      // registerRawWebhook is passed in opts to avoid circular ESM import of server.js.
      if (instance.rawWebhook && typeof instance.rawWebhook === "function" && opts.registerRawWebhook) {
        opts.registerRawWebhook(instance.rawWebhook);
        log.verbose("Extensions", `${manifest.name}: raw webhook registered`);
      }

      // Wire MCP tools and register in tool resolver
      if (instance.tools && mcpServer) {
        const { registerToolDef } = await import("../seed/tools.js");
        const { zodToJsonSchema } = await import("zod-to-json-schema");
        const { z } = await import("zod");

        for (const tool of instance.tools) {
          // Reject duplicate tool names across extensions
          const existingOwner = getToolOwner(tool.name);
          if (existingOwner) {
            log.error("Loader", `Tool "${tool.name}" from "${manifest.name}" conflicts with "${existingOwner}". Skipped.`);
            continue;
          }
          registerToolOwner(tool.name, manifest.name, tool.annotations?.readOnlyHint ?? false);
          try {
            if (tool.handler) {
              // IMPORTANT: register via registerTool() with a pre-built
              // passthrough zod object so the SDK does NOT strip context
              // fields that the MCP HTTP layer injects on every call
              // (userId, rootId, nodeId, chatId, sessionId). The shorthand
              // server.tool() wraps raw shapes in a strict z.object which
              // silently drops unknown fields, leaving every tool handler
              // blind to its own position in the tree. This broke tools
              // across every extension, not just code-workspace.
              //
              // Accepts both raw shape ({ key: z.string() }) and already-
              // built zod schemas.
              const { z } = await import("zod");
              let inputSchema;
              if (tool.schema && typeof tool.schema === "object" && !tool.schema._def && !tool.schema._zod) {
                // raw shape → wrap in passthrough
                inputSchema = z.object(tool.schema).passthrough();
              } else if (tool.schema && typeof tool.schema.passthrough === "function") {
                // already a zod object → ensure passthrough
                inputSchema = tool.schema.passthrough();
              } else {
                // unknown shape — let the SDK deal with it
                inputSchema = tool.schema;
              }

              mcpServer.registerTool(
                tool.name,
                {
                  description: tool.description,
                  inputSchema,
                  annotations: tool.annotations || undefined,
                },
                tool.handler,
              );
            }
          } catch (toolErr) {
            log.warn("Extensions", `${manifest.name}: tool "${tool.name}" MCP registration failed: ${toolErr.message}`);
          }

          // Convert Zod schema to JSON Schema for OpenAI function calling format
          let jsonSchema;
          try {
            // tool.schema is { key: z.string(), ... } - wrap in z.object first
            const zodObj = z.object(tool.schema);
            jsonSchema = zodToJsonSchema(zodObj);
            delete jsonSchema.$schema; // OpenAI doesn't want this
          } catch {
            // Fallback: already JSON Schema or plain object
            jsonSchema = tool.schema;
          }

          registerToolDef(tool.name, {
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: jsonSchema,
            },
          });
        }
      }

      // Register models from manifest (add to core.models so other extensions can use them)
      if (manifest.provides?.models) {
        for (const [modelName, modelPath] of Object.entries(manifest.provides.models)) {
          if (!coreServices.models[modelName]) {
            try {
              const resolved = path.resolve(dir, modelPath);
              const mod = await import(toImportURL(resolved));
              coreServices.models[modelName] = mod.default || mod;
              AVAILABLE_MODELS.add(modelName);
            } catch (err) {
              log.warn("Extensions", `${manifest.name}: failed to load model ${modelName}:`, err.message);
            }
          }
        }
      }

      // Register energy actions from manifest
      if (manifest.provides?.energyActions && coreServices.energy?.registerAction) {
        for (const [action, config] of Object.entries(manifest.provides.energyActions)) {
          if (typeof config === "object" && config.costFn) {
            coreServices.energy.registerAction(action, config.costFn);
          } else if (typeof config === "object" && typeof config.cost === "number") {
            coreServices.energy.registerAction(action, () => config.cost);
          }
        }
      }

      // Register session types
      if (manifest.provides?.sessionTypes) {
        const { registerSessionType } = await import("../seed/ws/sessionRegistry.js");
        for (const [key, value] of Object.entries(manifest.provides.sessionTypes)) {
          registerSessionType(key, value);
        }
      }

      // Register mode tool injections (extensions can add tools to existing modes)
      if (instance.modeTools) {
        for (const injection of instance.modeTools) {
          modeToolExtensions.push(injection);
        }
      }

      // Register custom modes (extensions can define entirely new AI modes)
      if (instance.modes) {
        for (const modeDef of instance.modes) {
          if (modeDef.key && modeDef.handler) {
            modeDef.handler._extName = manifest.name;
            registerMode(modeDef.key, modeDef.handler, manifest.name);
          }
        }
      }

      // Register custom orchestrator (extensions can replace the conversation orchestrator)
      if (instance.orchestrator && typeof instance.orchestrator.handle === "function") {
        const bigMode = instance.orchestrator.bigMode || "tree";
        registerOrchestrator(bigMode, instance.orchestrator, manifest.name);
      }

      // Register jobs (extensions can provide startable/stoppable jobs)
      if (instance.jobs) {
        for (const job of instance.jobs) {
          registeredJobs.push({ extensionName: manifest.name, ...job });
        }
      }

      // Store
      loaded.set(manifest.name, { manifest, instance, dir });

      // Build log line
      const parts = [manifest.name, `v${manifest.version}`];
      if (instance.router) parts.push("routes");
      if (instance.tools?.length) parts.push(`${instance.tools.length} tools`);
      if (instance.jobs?.length) parts.push(`${instance.jobs.length} jobs`);
      if (instance.modeTools?.length) parts.push(`${instance.modeTools.length} mode injections`);
      if (instance.middleware?.length) parts.push(`${instance.middleware.length} middleware`);
      log.verbose("Extensions", `Loaded: ${parts.join(" | ")}`);

    } catch (err) {
      log.error("Extensions", `Failed to load "${manifest.name}":`, err.message);
    }
  }

  // Wire the mode tool injection resolver now that all extensions are loaded
  setExtensionToolResolver(getExtensionToolsForMode);

  // Register extension names provider for canopy /info endpoint
  try {
    const { setExtensionNamesProvider } = await import("../canopy/identity.js");
    setExtensionNamesProvider(getLoadedExtensionNames);
  } catch {}

  // All extensions loaded. Freeze the top-level core object.
  // Extension service registration (core.energy = {...}) happened during init().
  // No more property additions. core.hooks = "garbage" now fails.
  if (coreServices) Object.freeze(coreServices);

  return loaded;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Validate a manifest object. Returns an array of error strings (empty = valid).
 */
function validateManifest(manifest, dirName) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return [`${dirName}: manifest is not an object`];
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push(`${dirName}: missing or invalid "name"`);
  } else if (!/^[a-z][a-z0-9-]*$/.test(manifest.name)) {
    errors.push(`${dirName}: name "${manifest.name}" must be lowercase alphanumeric with hyphens`);
  } else if (["node_modules", ".disabled", "_template", "loader"].includes(manifest.name)) {
    errors.push(`${dirName}: name "${manifest.name}" is reserved`);
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push(`${dirName}: missing or invalid "version"`);
  }
  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push(`${dirName}: missing or invalid "description"`);
  }
  // Validate needs
  if (manifest.needs) {
    if (manifest.needs.services && !Array.isArray(manifest.needs.services)) {
      errors.push(`${dirName}: needs.services must be an array`);
    }
    if (manifest.needs.models && !Array.isArray(manifest.needs.models)) {
      errors.push(`${dirName}: needs.models must be an array`);
    }
    if (manifest.needs.extensions && !Array.isArray(manifest.needs.extensions)) {
      errors.push(`${dirName}: needs.extensions must be an array`);
    }
  }
  // Validate provides.cli
  if (manifest.provides?.cli) {
    if (!Array.isArray(manifest.provides.cli)) {
      errors.push(`${dirName}: provides.cli must be an array`);
    } else {
      for (const cmd of manifest.provides.cli) {
        if (!cmd.command || !cmd.description || !cmd.method || !cmd.endpoint) {
          errors.push(`${dirName}: CLI command missing required fields (command, description, method, endpoint)`);
          break;
        }
      }
    }
  }
  // Validate provides.routes
  if (manifest.provides?.routes !== undefined && manifest.provides.routes !== false && typeof manifest.provides.routes !== "string") {
    errors.push(`${dirName}: provides.routes must be false or a file path string`);
  }
  // Validate provides.env
  if (manifest.provides?.env) {
    if (!Array.isArray(manifest.provides.env)) {
      errors.push(`${dirName}: provides.env must be an array`);
    } else {
      for (const decl of manifest.provides.env) {
        if (!decl.key || typeof decl.key !== "string") {
          errors.push(`${dirName}: env declaration missing "key" field`);
          break;
        }
      }
    }
  }
  // Validate npm dependencies
  if (manifest.npm !== undefined) {
    if (!Array.isArray(manifest.npm)) {
      errors.push(`${dirName}: npm must be an array`);
    } else {
      const npmDepRe = /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*(@.+)?$/;
      for (const dep of manifest.npm) {
        if (typeof dep !== "string" || !npmDepRe.test(dep)) {
          errors.push(`${dirName}: invalid npm dependency "${dep}"`);
          break;
        }
      }
    }
  }
  return errors;
}

async function discoverManifests() {
  const results = [];

  if (!fs.existsSync(__dirname)) return results;

  const entries = fs.readdirSync(__dirname, { withFileTypes: true });

  for (const entry of entries) {
    try {
      // Skip template and hidden directories
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

      // Profile filter: if .treeos-profile exists, only load listed extensions
      if (_profileFilter && !_profileFilter.has(entry.name)) continue;

      if (entry.isDirectory()) {
        const manifestPath = path.join(__dirname, entry.name, "manifest.js");
        const indexPath = path.join(__dirname, entry.name, "index.js");

        if (fs.existsSync(manifestPath) && fs.existsSync(indexPath)) {
          const { default: manifest } = await import(toImportURL(manifestPath));

          const errors = validateManifest(manifest, entry.name);
          if (errors.length > 0) {
            for (const err of errors) log.error("Extensions", `Manifest validation: ${err}`);
            log.warn("Extensions", `Skipping "${entry.name}" due to invalid manifest`);
            continue;
          }

          results.push({
            manifest,
            dir: path.join(__dirname, entry.name),
            entryPath: indexPath,
          });
        }
      } else if (entry.name.endsWith(".manifest.js")) {
        const name = entry.name.replace(".manifest.js", "");
        const entryPath = path.join(__dirname, `${name}.js`);

        const { default: manifest } = await import(path.join(__dirname, entry.name));

        if (fs.existsSync(entryPath)) {
          results.push({
            manifest,
            dir: __dirname,
            entryPath,
          });
        } else {
          log.warn("Extensions", `Manifest "${entry.name}" found but no entry point "${name}.js"`);
        }
      }
    } catch (err) {
      log.error("Extensions", `Error reading manifest for "${entry.name}":`, err.message);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a loaded extension by name.
 */
export function getExtension(name) {
  return loaded.get(name)?.instance ?? null;
}

/**
 * Get a loaded extension's manifest by name.
 */
export function getExtensionManifest(name) {
  return loaded.get(name)?.manifest ?? null;
}

/**
 * Get all loaded extension names.
 */
export function getLoadedExtensionNames() {
  return [...loaded.keys()];
}

/**
 * Flatten an extension's vocabulary + classifierHints into a single RegExp list.
 *
 * Two declaration forms are supported:
 *
 *   // Legacy flat form
 *   classifierHints: [regex, regex, ...]
 *
 *   // Structured form (preferred): explicit parts of speech.
 *   // Matching behavior is identical to a flat list. The split exists to make
 *   // extension authorship clearer and to enable richer per-part logging or
 *   // weighting later.
 *   vocabulary: {
 *     verbs:      [regex, ...],  // actions the domain handles (ate, ran, read)
 *     nouns:      [regex, ...],  // things the domain tracks (eggs, bench, book)
 *     adjectives: [regex, ...],  // states/qualities (hungry, sore, tired)
 *   }
 *
 * Both forms can coexist. All patterns are merged for matching.
 */
export function flattenVocabulary(manifest) {
  const hints = [];
  if (Array.isArray(manifest?.classifierHints)) {
    for (const h of manifest.classifierHints) if (h instanceof RegExp) hints.push(h);
  }
  const v = manifest?.vocabulary;
  if (v && typeof v === "object") {
    for (const key of ["verbs", "nouns", "adjectives"]) {
      if (Array.isArray(v[key])) {
        for (const h of v[key]) if (h instanceof RegExp) hints.push(h);
      }
    }
  }
  return hints;
}

/**
 * Get classifier hints for a mode key.
 * Returns array of RegExp from the owning extension's manifest (merged from
 * legacy classifierHints and structured vocabulary), or null if empty.
 * Used by the tree orchestrator for extension routing (Path 2).
 */
export function getClassifierHintsForMode(modeKey) {
  try {
    const extName = getModeOwner(modeKey);
    if (!extName) return null;
    const manifest = loaded.get(extName)?.manifest;
    if (!manifest) return null;
    const hints = flattenVocabulary(manifest);
    return hints.length > 0 ? hints : null;
  } catch { return null; }
}

/**
 * Get the extension's territory vocabulary split by part of speech.
 * Returns { verbs, nouns, adjectives } as RegExp arrays, or null if none.
 * Legacy classifierHints are bucketed as verbs by default since territory
 * markers are most commonly verb-like action words.
 */
export function getVocabularyForExtension(extName) {
  try {
    const entry = loaded.get(extName);
    const manifest = entry?.manifest;
    if (!manifest) return null;
    const result = { verbs: [], nouns: [], adjectives: [] };
    const v = manifest?.vocabulary;
    if (v && typeof v === "object") {
      if (Array.isArray(v.verbs)) result.verbs.push(...v.verbs.filter(r => r instanceof RegExp));
      if (Array.isArray(v.nouns)) result.nouns.push(...v.nouns.filter(r => r instanceof RegExp));
      if (Array.isArray(v.adjectives)) result.adjectives.push(...v.adjectives.filter(r => r instanceof RegExp));
    }
    if (Array.isArray(manifest.classifierHints)) {
      result.verbs.push(...manifest.classifierHints.filter(r => r instanceof RegExp));
    }
    // Merge learned vocabulary from sidecar file (auto-promoted by misroute extension)
    if (entry?.dir) {
      const learned = readLearnedVocabularyFile(entry.dir);
      if (learned) {
        if (Array.isArray(learned.nouns)) result.nouns.push(...learned.nouns);
        if (Array.isArray(learned.verbs)) result.verbs.push(...learned.verbs);
        if (Array.isArray(learned.adjectives)) result.adjectives.push(...learned.adjectives);
      }
    }
    if (result.verbs.length === 0 && result.nouns.length === 0 && result.adjectives.length === 0) return null;
    return result;
  } catch { return null; }
}

/**
 * Read an extension's learned vocabulary sidecar file if present.
 *
 * The file lives at `<extensionDir>/vocabulary.learned.json` and is written
 * by the misroute extension when a vocabulary suggestion crosses its
 * promotion threshold. The format is:
 *
 *   {
 *     "$schema": "vocabulary-learned-v1",
 *     "lastUpdated": "2026-04-12T...",
 *     "nouns":      [{ "pattern": "\\b(bill)\\b", "addedAt": "...", "trigger": "5 misroutes from finance" }, ...],
 *     "verbs":      [...],
 *     "adjectives": [...]
 *   }
 *
 * Each entry stores the raw regex source string, not a RegExp instance,
 * because JSON can't serialize RegExp. We compile to RegExp on read.
 *
 * Returns { verbs, nouns, adjectives } as RegExp arrays, or null if missing/invalid.
 */
function readLearnedVocabularyFile(extDir) {
  try {
    const learnedPath = path.join(extDir, "vocabulary.learned.json");
    if (!fs.existsSync(learnedPath)) return null;
    const raw = fs.readFileSync(learnedPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const compile = (arr) => {
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (const entry of arr) {
        if (!entry?.pattern || typeof entry.pattern !== "string") continue;
        try { out.push(new RegExp(entry.pattern, "i")); } catch {}
      }
      return out;
    };
    return {
      nouns: compile(parsed.nouns),
      verbs: compile(parsed.verbs),
      adjectives: compile(parsed.adjectives),
    };
  } catch { return null; }
}

/**
 * Get the absolute directory of a loaded extension.
 * Used by extensions like misroute that need to write sidecar files.
 */
export function getExtensionDir(extName) {
  return loaded.get(extName)?.dir || null;
}

export function getBootReport() {
  return {
    loaded: loaded.size,
    skipped: _bootSkipped.length,
    skippedNames: _bootSkipped.map(s => s.name),
    details: _bootSkipped,
  };
}

/**
 * Get all loaded manifests (for /protocol endpoint).
 */
export function getLoadedManifests() {
  return [...loaded.values()].map(({ manifest }) => manifest);
}

/**
 * Check if an extension is loaded.
 */
export function hasExtension(name) {
  return loaded.has(name);
}

/**
 * Get the core services bundle (for late-binding or testing).
 */
export function getCoreServices() {
  return coreServices;
}

/**
 * Replace a core service at runtime (e.g., when energy extension loads
 * and wants to replace the no-op stub with the real implementation).
 */
export function setCoreService(serviceName, serviceImpl) {
  if (coreServices) {
    coreServices[serviceName] = serviceImpl;
  }
}

/**
 * Uninstall an extension by removing its directory.
 * Data in the database is untouched.
 *
 * @param {string} name - extension name
 * @returns {{ found: boolean }}
 */
export async function uninstallExtension(name) {
  // Safety: only allow valid directory names
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error("Invalid extension name");
  }

  const extDir = path.join(__dirname, name);

  if (!fs.existsSync(extDir) || !fs.existsSync(path.join(extDir, "manifest.js"))) {
    return { found: false };
  }

  // Remove the directory recursively
  fs.rmSync(extDir, { recursive: true, force: true });

  // Also remove from disabled list if present
  const disabled = readDisabledFile();
  const updated = disabled.filter((n) => n !== name);
  if (updated.length !== disabled.length) {
    syncDisabledFile(updated);
  }

  // Quiesce: mark extension as unloading so the hook system can skip it,
  // then wait briefly for in-flight operations (hook handlers, tool calls,
  // route handlers) to drain before removing from memory.
  if (loaded.has(name)) {
    const entry = loaded.get(name);
    entry._unloading = true;
    await new Promise(r => setTimeout(r, 2000));
    loaded.delete(name);

    // Clean up tool definitions and mode registrations so stale entries
    // don't linger in the registry after uninstall.
    try {
      // Remove from MCP replay array and invalidate active sessions
      const { mcpServerInstance } = await import("../mcp/server.js");
      if (mcpServerInstance?.removeToolsByOwner) {
        mcpServerInstance.removeToolsByOwner(name, getToolOwner);
      }
      // Remove from tool definition registry
      const { unregisterToolsForExtension } = await import("../seed/tools.js");
      unregisterToolsForExtension(name, getToolOwner);
    } catch {}
    try {
      const { unregisterModes } = await import("../seed/modes/registry.js");
      unregisterModes(name);
    } catch {}
    try {
      const { clearToolOwnersForExtension, clearModeOwnersForExtension } = await import("../seed/tree/extensionScope.js");
      clearToolOwnersForExtension(name);
      clearModeOwnersForExtension(name);
    } catch {}
  }

  // Refresh confined extensions set. The removed extension might have been
  // confined. Without this, the confined set still references it and the
  // resolution chain treats a missing extension as blocked at every node.
  try {
    const { loadConfinedExtensions } = await import("../seed/tree/extensionScope.js");
    await loadConfinedExtensions();
  } catch {}

  log.verbose("Extensions", `Uninstalled: ${name}`);
  return { found: true };
}

/**
 * Install extension files from registry data.
 * Creates the extension directory and writes all files.
 *
 * @param {string} name - extension name
 * @param {Array<{path: string, content: string}>} files - file contents
 * @returns {{ filesWritten: number }}
 */
export async function installExtensionFiles(name, files) {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error("Invalid extension name");
  }

  const extDir = path.join(__dirname, name);

  // Write to a staging directory first. On success, atomic swap.
  // On failure, staging is cleaned up. Prevents partial installs.
  const stagingDir = path.join(__dirname, `.staging-${name}-${Date.now()}`);
  fs.mkdirSync(stagingDir, { recursive: true });
  const resolvedStaging = path.resolve(stagingDir);

  let filesWritten = 0;
  try {
    for (const file of files) {
      // Safety: resolve to absolute and verify it stays inside the staging directory.
      const filePath = path.resolve(stagingDir, file.path);
      if (!filePath.startsWith(resolvedStaging + path.sep) && filePath !== resolvedStaging) {
        throw new Error(`Path traversal blocked: ${file.path}`);
      }

      // Block null bytes (filesystem injection)
      if (file.path.includes("\0")) {
        throw new Error(`Null byte in file path: ${file.path}`);
      }

      const fileDir = path.dirname(filePath);

      // Create subdirectories if needed
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      fs.writeFileSync(filePath, file.content, "utf8");
      filesWritten++;
    }

    // All files written successfully. Swap staging into place.
    if (fs.existsSync(extDir)) {
      fs.rmSync(extDir, { recursive: true, force: true });
    }
    fs.renameSync(stagingDir, extDir);
  } catch (err) {
    // Cleanup staging on any failure
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    throw err;
  }

  // Run npm install if manifest declares npm dependencies
  try {
    const manifestPath = path.join(extDir, "manifest.js");
    if (fs.existsSync(manifestPath)) {
      const { default: manifest } = await import(toImportURL(manifestPath) + "?t=" + Date.now());
      if (manifest.npm && manifest.npm.length > 0) {
        await runNpmInstall(extDir, manifest.npm, name);
      }
    }
  } catch (npmErr) {
    log.error("Extensions", `${name}: npm install failed, rolling back: ${npmErr.message}`);
    try { fs.rmSync(extDir, { recursive: true, force: true }); } catch {}
    throw new Error(`npm install failed for "${name}": ${npmErr.message}`);
  }

  log.verbose("Extensions", `Installed: ${name} (${filesWritten} files)`);
  return { filesWritten };
}

/**
 * Read all files from a local extension directory for publishing.
 *
 * @param {string} name - extension name
 * @returns {{ manifest: object|null, files: Array<{path: string, content: string}> }}
 */
export async function readExtensionFiles(name) {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error("Invalid extension name");
  }

  const extDir = path.join(__dirname, name);
  const manifestPath = path.join(extDir, "manifest.js");

  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, files: [] };
  }

  // Load manifest
  const { default: manifest } = await import(toImportURL(manifestPath));

  // Read all .js/.json/.md files recursively (skip symlinks, cap depth)
  const MAX_DEPTH = 10;
  const files = [];
  function readDir(dir, base = "", depth = 0) {
    if (depth > MAX_DEPTH) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) continue;
      const relativePath = base ? `${base}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        readDir(path.join(dir, entry.name), relativePath, depth + 1);
      } else if (entry.name.endsWith(".js") || entry.name.endsWith(".json") || entry.name.endsWith(".md")) {
        const content = fs.readFileSync(path.join(dir, entry.name), "utf8");
        files.push({ path: relativePath, content });
      }
    }
  }

  readDir(extDir);
  return { manifest, files };
}

// ---------------------------------------------------------------------------
// Install from registry (used by AI tools and internal APIs)
// ---------------------------------------------------------------------------

/**
 * Resolve the Horizon service URL from land config or env.
 */
async function getHorizonUrl() {
  try {
    const { getLandConfigValue } = await import("../seed/landConfig.js");
    return getLandConfigValue("HORIZON_URL") || process.env.HORIZON_URL || "https://horizon.treeos.ai";
  } catch {
    return process.env.HORIZON_URL || "https://horizon.treeos.ai";
  }
}

/**
 * Compute SHA256 checksum of extension files for integrity verification.
 */
function computeChecksum(files) {
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

/**
 * Install an extension from a git repository URL.
 * Clones into a temp directory, copies to extensions/, cleans up.
 *
 * @param {string} name - extension name
 * @param {string} repoUrl - git repository URL
 * @param {string} [version] - git tag/branch to checkout
 * @returns {{ name, version, filesWritten }}
 */
async function installFromRepo(name, repoUrl, version) {
  const { execFileSync } = await import("child_process");
  const extDir = path.join(__dirname, name);
  const tmpDir = path.join(__dirname, `_tmp_${name}_${Date.now()}`);

  try {
    // Clone the repo (using execFileSync to prevent shell injection)
    const args = ["clone", "--depth", "1"];
    if (version) { args.push("--branch", version, "--single-branch"); }
    args.push(repoUrl, tmpDir);
    execFileSync("git", args, {
      stdio: "pipe",
      timeout: 30000,
    });

    // Verify it has a manifest
    if (!fs.existsSync(path.join(tmpDir, "manifest.js"))) {
      throw new Error("Repository does not contain a manifest.js at root");
    }

    // Remove .git directory (no need to keep history)
    const gitDir = path.join(tmpDir, ".git");
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }

    // Move to final location (replace if exists)
    if (fs.existsSync(extDir)) {
      fs.rmSync(extDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpDir, extDir);

    // Run npm install if manifest declares npm dependencies
    const manifestPath = path.join(extDir, "manifest.js");
    if (fs.existsSync(manifestPath)) {
      const { default: manifest } = await import(toImportURL(manifestPath) + "?t=" + Date.now());
      if (manifest.npm && manifest.npm.length > 0) {
        try {
          await runNpmInstall(extDir, manifest.npm, name);
        } catch (npmErr) {
          log.error("Extensions", `${name}: npm install failed, rolling back: ${npmErr.message}`);
          try { fs.rmSync(extDir, { recursive: true, force: true }); } catch {}
          throw new Error(`npm install failed for "${name}": ${npmErr.message}`);
        }
      }
    }

    // Count files
    let filesWritten = 0;
    function countFiles(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        if (entry.isDirectory()) countFiles(path.join(dir, entry.name));
        else filesWritten++;
      }
    }
    countFiles(extDir);

    log.info("Extensions", `Installed from git: ${name} (${repoUrl}, ${filesWritten} files)`);
    return { name, version: version || "latest", filesWritten };
  } catch (err) {
    // Clean up temp directory on failure
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    throw new Error(`Git install failed for ${name}: ${err.message}`);
  }
}

/**
 * Install an extension from the registry by name.
 * Fetches metadata + files from the Horizon service, verifies integrity,
 * and writes files to disk.
 *
 * @param {string} name - extension name
 * @param {string} [version] - specific version (default: latest)
 * @returns {{ name, version, filesWritten, checksum }}
 */
export async function installExtension(name, version) {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error("Invalid extension name");
  }

  const horizonUrl = await getHorizonUrl();

  // Fetch extension metadata (latest or specific version)
  const metaUrl = version
    ? `${horizonUrl}/extensions/${encodeURIComponent(name)}/${version}`
    : `${horizonUrl}/extensions/${encodeURIComponent(name)}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    const err = await metaRes.json().catch(() => ({ error: `HTTP ${metaRes.status}` }));
    throw new Error(err.error || `Registry error: ${metaRes.status}`);
  }
  const metaData = await metaRes.json();

  // Resolve to specific version
  let ext = version ? metaData : metaData.latest;
  if (!ext) throw new Error(`Extension "${name}" not found in registry`);

  // Fetch full version with files if not included
  if (!ext.files) {
    const fullRes = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}/${ext.version}`);
    if (!fullRes.ok) throw new Error("Failed to fetch extension files from registry");
    ext = await fullRes.json();
  }

  // If no inline files, try repoUrl (git clone)
  if ((!ext.files || !ext.files.length) && ext.repoUrl) {
    return await installFromRepo(ext.name || name, ext.repoUrl, ext.version);
  }

  if (!ext.files || !ext.files.length) {
    throw new Error("Extension has no files and no repoUrl");
  }

  // Verify integrity. Checksum is required for registry installs.
  if (!ext.checksum) {
    throw new Error(`Registry extension "${name}" v${ext.version} has no checksum. Refusing to install.`);
  }
  const computed = computeChecksum(ext.files);
  if (computed !== ext.checksum) {
    throw new Error(`Integrity check failed for "${name}" v${ext.version}: expected ${ext.checksum.slice(0, 12)}..., got ${computed.slice(0, 12)}...`);
  }
  log.verbose("Extensions", `Integrity verified: ${name} v${ext.version} (${ext.checksum.slice(0, 12)}...)`);

  // Write files to disk
  const result = await installExtensionFiles(ext.name || name, ext.files);

  log.info("Extensions", `Installed from registry: ${name} v${ext.version} (${result.filesWritten} files)`);

  // Refresh confined extensions set. A newly installed extension might declare
  // scope: "confined" in its manifest. Without this, the confined set is stale
  // until restart and the extension resolves as global (active everywhere).
  try {
    const { loadConfinedExtensions } = await import("../seed/tree/extensionScope.js");
    await loadConfinedExtensions();
  } catch {}

  return {
    name: ext.name || name,
    version: ext.version,
    filesWritten: result.filesWritten,
    checksum: ext.checksum || computeChecksum(ext.files),
  };
}

// ---------------------------------------------------------------------------
// Disable / Enable (used by AI tools)
// ---------------------------------------------------------------------------

/**
 * Disable an extension. Adds to disabled list, syncs to disk and config DB.
 * Extension will not load on next restart.
 *
 * @param {string} name - extension name
 */
export async function disableExtension(name) {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error("Invalid extension name");
  }

  // Validate extension exists
  if (!loaded.has(name)) {
    const extDir = path.join(__dirname, name);
    if (!fs.existsSync(extDir) || !fs.existsSync(path.join(extDir, "manifest.js"))) {
      throw new Error(`Extension "${name}" not found. Run 'ext list' to see available extensions.`);
    }
  }

  const current = readDisabledFile();
  if (!current.includes(name)) {
    current.push(name);
    syncDisabledFile(current);
  }

  // Also persist to DB config if available
  try {
    const { getLandConfigValue, setLandConfigValue } = await import("../seed/landConfig.js");
    const dbList = getLandConfigValue("disabledExtensions") || [];
    if (!dbList.includes(name)) {
      dbList.push(name);
      await setLandConfigValue("disabledExtensions", dbList);
    }
  } catch {
    // DB config not available (boot time), file sync is enough
  }

  // Stop jobs belonging to this extension
  for (const job of registeredJobs) {
    if (job.extensionName === name && typeof job.stop === "function") {
      try {
        job.stop();
        log.verbose("Extensions", `Stopped job: ${job.name} (${name})`);
      } catch (err) {
        log.warn("Extensions", `Failed to stop job ${job.name}: ${err.message}`);
      }
    }
  }

  // Unregister hooks belonging to this extension
  try {
    const { hooks } = await import("../seed/hooks.js");
    hooks.unregister(name);
  } catch {}

  log.info("Extensions", `Disabled: ${name}`);
}

/**
 * Re-enable a disabled extension. Removes from disabled list.
 * Extension will load on next restart.
 *
 * @param {string} name - extension name
 */
export async function enableExtension(name) {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error("Invalid extension name");
  }

  const current = readDisabledFile();
  const updated = current.filter((n) => n !== name);
  syncDisabledFile(updated);

  // Also persist to DB config if available
  try {
    const { getLandConfigValue, setLandConfigValue } = await import("../seed/landConfig.js");
    const dbList = getLandConfigValue("disabledExtensions") || [];
    const dbUpdated = dbList.filter((n) => n !== name);
    await setLandConfigValue("disabledExtensions", dbUpdated);
  } catch {
    // DB config not available, file sync is enough
  }

  log.info("Extensions", `Enabled: ${name}`);
}

/**
 * Get the set of disabled extension names.
 * Merges env var, .disabled file, and DB config.
 *
 * @param {Function} [configFn] - optional config reader (getLandConfigValue)
 * @returns {Set<string>}
 */
export { getDisabledExtensions };

// ---------------------------------------------------------------------------
// Extension tools for modes
// ---------------------------------------------------------------------------

/**
 * Get additional tools injected by extensions for a specific mode.
 * Called by the mode registry when resolving tools.
 *
 * @param {string} modeKey - e.g. "tree:librarian"
 * @returns {string[]} additional tool names to append
 */
export function getExtensionToolsForMode(modeKey) {
  const tools = [];
  for (const injection of modeToolExtensions) {
    if (injection.modeKey === modeKey) {
      tools.push(...injection.toolNames);
    }
  }
  return tools;
}

/**
 * Get all registered extension jobs.
 * Call startExtensionJobs() after DB is connected.
 *
 * @returns {{ name, start, stop, extensionName }[]}
 */
export function getRegisteredJobs() {
  return registeredJobs;
}

// ---------------------------------------------------------------------------
// Schema migrations
// ---------------------------------------------------------------------------

/**
 * Run pending migrations for all loaded extensions.
 * Each extension can provide migrations in its manifest:
 *   provides.schemaVersion: 2
 *   provides.migrations: "./migrations.js"
 *
 * The migrations module exports an array of { version, up } objects.
 * Schema versions are tracked per extension in the .extensions system node values.
 *
 * Called from startup.js after DB connect.
 */
export async function runExtensionMigrations() {
  let Node;
  try {
    Node = (await import("../seed/models/node.js")).default;
  } catch {
    log.warn("Extensions", "Cannot run migrations: Node model not available");
    return;
  }

  // Find the .extensions system node once, so per-extension queries are scoped correctly.
  // Without this, a user-created tree node named the same as an extension would be matched.
  const { SYSTEM_ROLE } = await import("../seed/protocol.js");
  const extensionsParent = await Node.findOne({ systemRole: SYSTEM_ROLE.EXTENSIONS }).select("_id").lean();

  for (const [name, { manifest, instance }] of loaded) {
    const targetVersion = manifest.provides?.schemaVersion;
    if (!targetVersion) continue; // No schema versioning declared

    // Get current version from the extension's child node under .extensions
    const extNode = extensionsParent
      ? await Node.findOne({ parent: extensionsParent._id, name }).lean()
      : null;

    const meta = extNode?.metadata instanceof Map ? Object.fromEntries(extNode.metadata) : (extNode?.metadata || {});
    const currentVersion = meta.schemaVersion || 0;

    if (currentVersion >= targetVersion) continue; // Up to date

    // Load migrations
    const migrationsPath = manifest.provides?.migrations;
    if (!migrationsPath) {
      log.warn("Extensions", `${name}: schemaVersion ${targetVersion} declared but no migrations path`);
      continue;
    }

    try {
      const entry = loaded.get(name);
      const resolved = path.resolve(entry?.dir || path.join(__dirname, name), migrationsPath);
      const migrationsModule = await import(toImportURL(resolved));
      const migrations = migrationsModule.default || migrationsModule.migrations || [];

      // Run pending migrations in order
      let ran = 0;
      for (const migration of migrations) {
        if (migration.version > currentVersion && migration.version <= targetVersion) {
          log.verbose("Extensions", `${name}: running migration v${migration.version}`);
          try {
            await migration.up(coreServices);
            ran++;
          } catch (err) {
            log.error("Extensions", `${name}: migration v${migration.version} FAILED:`, err.message);
            break; // Stop on first failure
          }
        }
      }

      // Update stored version
      if (ran > 0 && extNode) {
        await Node.findByIdAndUpdate(extNode._id, {
          $set: { "metadata.schemaVersion": targetVersion },
        });
        log.verbose("Extensions", `${name}: schema updated to v${targetVersion} (${ran} migration(s))`);
      }
    } catch (err) {
      log.error("Extensions", `${name}: failed to load migrations:`, err.message);
    }
  }
}

/**
 * Start all extension jobs. Called from startup.js after DB connect.
 */
export async function startExtensionJobs() {
  for (const job of registeredJobs) {
    try {
      if (typeof job.start === "function") {
        await job.start();
        log.verbose("Extensions", `Job started: ${job.name} (${job.extensionName})`);
      }
    } catch (err) {
      log.error("Extensions", `Job failed to start: ${job.name}:`, err.message);
    }
  }
}

/**
 * Stop all extension jobs. Called on shutdown.
 */
export function stopExtensionJobs() {
  for (const job of registeredJobs) {
    try {
      if (typeof job.stop === "function") {
        job.stop();
      }
    } catch (err) {
      log.error("Extensions", `Job failed to stop: ${job.name}:`, err.message);
    }
  }
}
