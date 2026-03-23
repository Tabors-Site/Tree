// extensions/loader.js
// Scans extension manifests, validates dependencies, initializes extensions,
// and wires routes/tools/jobs/models into the host land.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import { buildCoreServices, NOOP_ENERGY } from "../core/services.js";
import { setExtensionToolResolver, registerMode } from "../ws/modes/registry.js";
import { hooks } from "../core/hooks.js";
import { registerOrchestrator } from "../core/orchestratorRegistry.js";

/** Convert a file path to a URL string for dynamic import (Windows compat) */
function toImportURL(filePath) {
  return pathToFileURL(filePath).href;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISABLED_FILE = path.join(__dirname, ".disabled");

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
    console.warn("[Extensions] Failed to write disabled file:", err.message);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const loaded = new Map();       // name -> { manifest, instance }
let coreServices = null;        // the assembled core bundle
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

const AVAILABLE_SERVICES = new Set([
  "energy", "contributions", "auth",
  "session", "aiChat", "llm", "mcp",
  "websocket", "orchestrator",
]);

const AVAILABLE_MODELS = new Set([
  "User", "Node", "Contribution", "Note",
]);

const AVAILABLE_MIDDLEWARE = new Set([
  "resolveTreeAccess",
]);

function validateNeeds(manifest, core) {
  const missing = [];

  if (manifest.needs?.services) {
    for (const svc of manifest.needs.services) {
      if (!AVAILABLE_SERVICES.has(svc)) {
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

  if (manifest.needs?.middleware) {
    for (const mw of manifest.needs.middleware) {
      if (!AVAILABLE_MIDDLEWARE.has(mw) && !core.middleware[mw]) {
        missing.push(`middleware:${mw}`);
      }
    }
  }

  // Check inter-extension dependencies
  if (manifest.needs?.extensions) {
    for (const ext of manifest.needs.extensions) {
      if (!loaded.has(ext)) {
        missing.push(`extension:${ext}`);
      }
    }
  }

  return missing;
}

/**
 * Inject no-op stubs for optional services the host land doesn't have.
 */
function applyOptionalStubs(manifest, core) {
  if (!manifest.optional?.services) return;

  for (const svc of manifest.optional.services) {
    if (svc === "energy" && core.energy === NOOP_ENERGY) {
      continue;
    }
    if (!core[svc]) {
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
    console.log(`[Extensions] ${manifest.name}: auto-generated ${generated.join(", ")}`);
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

  // Collect declared middleware
  const allowedMiddleware = new Set(manifest.needs?.middleware || []);
  for (const m of manifest.optional?.middleware || []) allowedMiddleware.add(m);

  // Build scoped object
  const scoped = {};

  // Services: only inject declared ones
  for (const key of AVAILABLE_SERVICES) {
    if (allowed.has(key) && fullCore[key]) {
      scoped[key] = fullCore[key];
    }
  }

  // Models: only inject declared ones (plus any registered by other extensions)
  scoped.models = {};
  for (const name of allowedModels) {
    if (fullCore.models[name]) {
      scoped.models[name] = fullCore.models[name];
    }
  }

  // Middleware: only inject declared ones
  scoped.middleware = {};
  for (const name of allowedMiddleware) {
    if (fullCore.middleware[name]) {
      scoped.middleware[name] = fullCore.middleware[name];
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

    // Visit extension dependencies first
    if (item.manifest.needs?.extensions) {
      for (const dep of item.manifest.needs.extensions) {
        if (byName.has(dep)) visit(byName.get(dep));
      }
    }

    // Visit optional extension dependencies if they exist
    if (item.manifest.optional?.extensions) {
      for (const dep of item.manifest.optional.extensions) {
        if (byName.has(dep)) visit(byName.get(dep));
      }
    }

    sorted.push(item);
  }

  // Visit in order of dependency count (least deps first as tiebreaker)
  const ordered = [...manifests].sort((a, b) => {
    const aDeps = (a.manifest.needs?.services?.length || 0) +
                  (a.manifest.needs?.models?.length || 0) +
                  (a.manifest.needs?.extensions?.length || 0);
    const bDeps = (b.manifest.needs?.services?.length || 0) +
                  (b.manifest.needs?.models?.length || 0) +
                  (b.manifest.needs?.extensions?.length || 0);
    return aDeps - bDeps;
  });

  for (const item of ordered) visit(item);
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

  // Discover manifests
  const manifests = await discoverManifests();

  if (manifests.length === 0) {
    console.log("[Extensions] No extension manifests found");
    return loaded;
  }

  // Check disabled list (env var + land config)
  const disabled = getDisabledExtensions(opts.getConfigValue);
  const enabled = manifests.filter(({ manifest }) => {
    if (disabled.has(manifest.name)) {
      console.log(`[Extensions] Disabled: ${manifest.name} (DISABLED_EXTENSIONS)`);
      return false;
    }
    return true;
  });

  // Sort by dependencies (proper topological sort)
  const sorted = topologicalSort(enabled);

  // Load each extension
  for (const { manifest, dir, entryPath } of sorted) {
    try {
      // Validate required dependencies
      const missing = validateNeeds(manifest, coreServices);
      if (missing.length > 0) {
        console.warn(
          `[Extensions] Skipping "${manifest.name}": missing required deps: ${missing.join(", ")}`
        );
        continue;
      }

      // Resolve env vars declared by extension
      if (manifest.provides?.env) {
        const envResult = resolveExtensionEnv(manifest);
        if (!envResult.ok) {
          console.warn(
            `[Extensions] Skipping "${manifest.name}": ${envResult.missing.join(", ")}. Set in .env and restart.`
          );
          continue;
        }
      }

      // Apply no-op stubs for optional deps
      applyOptionalStubs(manifest, coreServices);

      // Load the extension's init function
      const extModule = await import(toImportURL(entryPath));
      if (typeof extModule.init !== "function") {
        console.warn(`[Extensions] Skipping "${manifest.name}": no init() export`);
        continue;
      }

      // Build scoped core: only inject what the manifest declares
      const scopedCore = buildScopedCore(manifest, coreServices);

      // Initialize
      const instance = await extModule.init(scopedCore);

      // Validate init() return
      if (!instance || typeof instance !== "object") {
        console.warn(`[Extensions] "${manifest.name}": init() must return an object. Got ${typeof instance}. Skipped.`);
        continue;
      }
      if (instance.router && typeof instance.router.use !== "function") {
        console.warn(`[Extensions] "${manifest.name}": router is not a valid Express router. Skipped.`);
        continue;
      }
      if (instance.tools !== undefined && !Array.isArray(instance.tools)) {
        console.warn(`[Extensions] "${manifest.name}": tools must be an array. Skipped.`);
        continue;
      }
      if (instance.jobs !== undefined && !Array.isArray(instance.jobs)) {
        console.warn(`[Extensions] "${manifest.name}": jobs must be an array. Skipped.`);
        continue;
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
            console.error(`[Extensions] Route collision: "${rpath}" claimed by both "${owner}" and "${manifest.name}". Skipping "${manifest.name}" routes.`);
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
        app.use("/", instance.pageRouter);
      }

      // Wire MCP tools
      if (instance.tools && mcpServer) {
        for (const tool of instance.tools) {
          mcpServer.tool(
            tool.name,
            tool.description,
            tool.schema,
            tool.annotations || {},
            tool.handler
          );
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
              console.warn(`[Extensions] ${manifest.name}: failed to load model ${modelName}:`, err.message);
            }
          }
        }
      }

      // Register energy actions from manifest
      if (manifest.provides?.energyActions && coreServices.energy !== NOOP_ENERGY) {
        const { registerAction } = await import("./energy/core.js");
        for (const [action, config] of Object.entries(manifest.provides.energyActions)) {
          if (typeof config === "object" && config.costFn) {
            registerAction(action, config.costFn);
          } else if (typeof config === "object" && typeof config.cost === "number") {
            registerAction(action, () => config.cost);
          }
        }
      }

      // Register session types
      if (manifest.provides?.sessionTypes) {
        const { registerSessionType } = await import("../ws/sessionRegistry.js");
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
      console.log(`[Extensions] Loaded: ${parts.join(" | ")}`);

    } catch (err) {
      console.error(`[Extensions] Failed to load "${manifest.name}":`, err.message);
    }
  }

  // Wire the mode tool injection resolver now that all extensions are loaded
  setExtensionToolResolver(getExtensionToolsForMode);

  // Register extension names provider for canopy /info endpoint
  try {
    const { setExtensionNamesProvider } = await import("../canopy/identity.js");
    setExtensionNamesProvider(getLoadedExtensionNames);
  } catch {}

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

      if (entry.isDirectory()) {
        const manifestPath = path.join(__dirname, entry.name, "manifest.js");
        const indexPath = path.join(__dirname, entry.name, "index.js");

        if (fs.existsSync(manifestPath) && fs.existsSync(indexPath)) {
          const { default: manifest } = await import(toImportURL(manifestPath));

          const errors = validateManifest(manifest, entry.name);
          if (errors.length > 0) {
            for (const err of errors) console.error(`[Extensions] Manifest validation: ${err}`);
            console.warn(`[Extensions] Skipping "${entry.name}" due to invalid manifest`);
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
          console.warn(`[Extensions] Manifest "${entry.name}" found but no entry point "${name}.js"`);
        }
      }
    } catch (err) {
      console.error(`[Extensions] Error reading manifest for "${entry.name}":`, err.message);
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

  // Remove from loaded map if currently loaded
  loaded.delete(name);

  console.log(`[Extensions] Uninstalled: ${name}`);
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

  // Create directory
  if (!fs.existsSync(extDir)) {
    fs.mkdirSync(extDir, { recursive: true });
  }

  let filesWritten = 0;
  for (const file of files) {
    // Safety: prevent path traversal
    const normalized = path.normalize(file.path);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw new Error(`Invalid file path: ${file.path}`);
    }

    const filePath = path.join(extDir, normalized);
    const fileDir = path.dirname(filePath);

    // Create subdirectories if needed
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    fs.writeFileSync(filePath, file.content, "utf8");
    filesWritten++;
  }

  console.log(`[Extensions] Installed: ${name} (${filesWritten} files)`);
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

  // Read all .js files recursively
  const files = [];
  function readDir(dir, base = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const relativePath = base ? `${base}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        readDir(path.join(dir, entry.name), relativePath);
      } else if (entry.name.endsWith(".js") || entry.name.endsWith(".json") || entry.name.endsWith(".md")) {
        const content = fs.readFileSync(path.join(dir, entry.name), "utf8");
        files.push({ path: relativePath, content });
      }
    }
  }

  readDir(extDir);
  return { manifest, files };
}

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
    Node = (await import("../db/models/node.js")).default;
  } catch {
    console.warn("[Extensions] Cannot run migrations: Node model not available");
    return;
  }

  for (const [name, { manifest, instance }] of loaded) {
    const targetVersion = manifest.provides?.schemaVersion;
    if (!targetVersion) continue; // No schema versioning declared

    // Get current version from .extensions node values
    const extNode = await Node.findOne({
      parent: { $ne: null },
      isSystem: true,
      name,
    }).lean();

    const currentVersion = extNode?.versions?.[0]?.values?.schemaVersion || 0;

    if (currentVersion >= targetVersion) continue; // Up to date

    // Load migrations
    const migrationsPath = manifest.provides?.migrations;
    if (!migrationsPath) {
      console.warn(`[Extensions] ${name}: schemaVersion ${targetVersion} declared but no migrations path`);
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
          console.log(`[Extensions] ${name}: running migration v${migration.version}`);
          try {
            await migration.up(coreServices);
            ran++;
          } catch (err) {
            console.error(`[Extensions] ${name}: migration v${migration.version} FAILED:`, err.message);
            break; // Stop on first failure
          }
        }
      }

      // Update stored version
      if (ran > 0 && extNode) {
        await Node.findByIdAndUpdate(extNode._id, {
          $set: { "versions.0.values.schemaVersion": targetVersion },
        });
        console.log(`[Extensions] ${name}: schema updated to v${targetVersion} (${ran} migration(s))`);
      }
    } catch (err) {
      console.error(`[Extensions] ${name}: failed to load migrations:`, err.message);
    }
  }
}

/**
 * Start all extension jobs. Called from startup.js after DB connect.
 */
export function startExtensionJobs() {
  for (const job of registeredJobs) {
    try {
      if (typeof job.start === "function") {
        job.start();
        console.log(`[Extensions] Job started: ${job.name} (${job.extensionName})`);
      }
    } catch (err) {
      console.error(`[Extensions] Job failed to start: ${job.name}:`, err.message);
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
      console.error(`[Extensions] Job failed to stop: ${job.name}:`, err.message);
    }
  }
}
