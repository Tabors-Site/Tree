// extensions/loader.js
// Scans extension manifests, validates dependencies, initializes extensions,
// and wires routes/tools/jobs/models into the host land.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCoreServices, NOOP_ENERGY } from "../core/services.js";
import { setExtensionToolResolver } from "../ws/modes/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
 * Parse DISABLED_EXTENSIONS env var (comma-separated list).
 * Extensions in this list will be skipped during loading.
 */
function getDisabledExtensions() {
  const raw = process.env.DISABLED_EXTENSIONS || "";
  return new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
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
 * @returns {Map} loaded extensions
 */
export async function loadExtensions(app, mcpServer, opts = {}) {
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

  // Check disabled list
  const disabled = getDisabledExtensions();
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

      // Apply no-op stubs for optional deps
      applyOptionalStubs(manifest, coreServices);

      // Load the extension's init function
      const extModule = await import(entryPath);
      if (typeof extModule.init !== "function") {
        console.warn(`[Extensions] Skipping "${manifest.name}": no init() export`);
        continue;
      }

      // Initialize
      const instance = await extModule.init(coreServices);

      // Wire routes
      if (instance.router) {
        app.use("/api/v1", instance.router);
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
              const mod = await import(resolved);
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
        const { registerAction } = await import("../core/tree/energy.js");
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

      // Register jobs (extensions can provide startable/stoppable jobs)
      if (instance.jobs) {
        for (const job of instance.jobs) {
          registeredJobs.push({ extensionName: manifest.name, ...job });
        }
      }

      // Store
      loaded.set(manifest.name, { manifest, instance });

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

  return loaded;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discoverManifests() {
  const results = [];

  if (!fs.existsSync(__dirname)) return results;

  const entries = fs.readdirSync(__dirname, { withFileTypes: true });

  for (const entry of entries) {
    try {
      if (entry.isDirectory()) {
        const manifestPath = path.join(__dirname, entry.name, "manifest.js");
        const indexPath = path.join(__dirname, entry.name, "index.js");

        if (fs.existsSync(manifestPath) && fs.existsSync(indexPath)) {
          const { default: manifest } = await import(manifestPath);
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
