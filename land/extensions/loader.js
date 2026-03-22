// extensions/loader.js
// Scans extension manifests, validates dependencies, initializes extensions,
// and wires routes/tools/jobs into the host land.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCoreServices, NOOP_ENERGY } from "../core/services.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const loaded = new Map();       // name -> { manifest, instance }
let coreServices = null;        // the assembled core bundle

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

  return missing;
}

/**
 * Inject no-op stubs for optional services the host land doesn't have.
 */
function applyOptionalStubs(manifest, core) {
  if (!manifest.optional?.services) return;

  for (const svc of manifest.optional.services) {
    if (svc === "energy" && core.energy === NOOP_ENERGY) {
      // Already a no-op, extension will get the stub
      continue;
    }
    // For other optional services, if they don't exist on core, stub them
    if (!core[svc]) {
      core[svc] = {};
    }
  }
}

// ---------------------------------------------------------------------------
// Dependency ordering
// ---------------------------------------------------------------------------

function topologicalSort(manifests) {
  // Simple sort: extensions with fewer needs load first
  // For full dep resolution between extensions, we'd need a proper topo sort
  // but for now, extensions only depend on core services, not each other
  const sorted = [...manifests];
  sorted.sort((a, b) => {
    const aDeps = (a.needs?.services?.length || 0) + (a.needs?.models?.length || 0);
    const bDeps = (b.needs?.services?.length || 0) + (b.needs?.models?.length || 0);
    return aDeps - bDeps;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Scan for extension manifests and load them.
 *
 * Manifest discovery:
 *   1. land/extensions/<name>/manifest.js  (directory-based)
 *   2. land/extensions/<name>.manifest.js  (flat file)
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

  // Sort by dependency count (simple ordering)
  const sorted = topologicalSort(manifests);

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
        console.log(`[Extensions] ${manifest.name}: routes wired`);
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
        console.log(`[Extensions] ${manifest.name}: ${instance.tools.length} MCP tools registered`);
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

      // Store
      loaded.set(manifest.name, { manifest, instance });
      console.log(`[Extensions] Loaded: ${manifest.name} v${manifest.version}`);

    } catch (err) {
      console.error(`[Extensions] Failed to load "${manifest.name}":`, err.message);
      // Don't crash the land, just skip this extension
    }
  }

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
        // land/extensions/<name>/manifest.js
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
        // land/extensions/<name>.manifest.js
        // Entry point is <name>.js in same directory
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
 * Use this for cross-extension calls (e.g., dream calling understanding).
 *
 * @param {string} name - extension name
 * @returns {object|null} the extension's instance (what init() returned), or null
 */
export function getExtension(name) {
  return loaded.get(name)?.instance ?? null;
}

/**
 * Get a loaded extension's manifest by name.
 *
 * @param {string} name - extension name
 * @returns {object|null} the manifest, or null
 */
export function getExtensionManifest(name) {
  return loaded.get(name)?.manifest ?? null;
}

/**
 * Get all loaded extension names.
 * @returns {string[]}
 */
export function getLoadedExtensionNames() {
  return [...loaded.keys()];
}

/**
 * Get all loaded manifests (for /protocol endpoint).
 * @returns {object[]}
 */
export function getLoadedManifests() {
  return [...loaded.values()].map(({ manifest }) => manifest);
}

/**
 * Check if an extension is loaded.
 * @param {string} name
 * @returns {boolean}
 */
export function hasExtension(name) {
  return loaded.has(name);
}

/**
 * Get the core services bundle (for late-binding or testing).
 * @returns {object}
 */
export function getCoreServices() {
  return coreServices;
}

/**
 * Replace a core service at runtime (e.g., when energy extension loads
 * and wants to replace the no-op stub with the real implementation).
 *
 * @param {string} serviceName
 * @param {object} serviceImpl
 */
export function setCoreService(serviceName, serviceImpl) {
  if (coreServices) {
    coreServices[serviceName] = serviceImpl;
  }
}
