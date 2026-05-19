import mongoose from "./seed/core/dbConfig.js";
import { getLandIdentity, getLandUrl } from "./protocols/ibp/canopy/identity.js";
import { ensureLandRoot } from "./seed/landRoot.js";
import { initLandConfig, getLandConfigValue } from "./seed/landConfig.js";
import { startExtensionJobs, getLoadedManifests, runExtensionMigrations, getLoadedExtensionNames, getBootReport } from "./extensions/loader.js";
import { startUploadCleanup } from "./seed/tree/uploadCleanup.js";
import { startRetentionJob } from "./seed/tree/dataRetention.js";
import { getBlockedExtensionsAtNode } from "./seed/tree/extensionScope.js";
import { hooks } from "./seed/core/hooks.js";
import { syncExtensionsToTree } from "./seed/landRoot.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "./seed/core/log.js";
import { SYSTEM_ROLE } from "./seed/core/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Register an array of kernel-shipped tool definitions with both the
 * MCP server (so handlers can be invoked) and the tool registry (so
 * the LLM can list them). Mirrors the dual registration the extension
 * loader does for extension tools.
 */
async function registerKernelTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return;
  const { mcpServerInstance } = await import("./protocols/mcp/server.js");
  const { registerToolDef } = await import("./seed/core/tools.js");
  const { z }               = await import("zod");
  const { zodToJsonSchema } = await import("zod-to-json-schema");

  for (const tool of tools) {
    try {
      // MCP handler — passthrough so beingId/name injected by the
      // middleware survive zod's strip step.
      const inputSchema = z.object(tool.schema).passthrough();
      mcpServerInstance.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema,
          annotations: tool.annotations || undefined,
        },
        tool.handler,
      );

      // Tool registry def for the LLM's tool listing.
      const jsonSchema = zodToJsonSchema(z.object(tool.schema));
      delete jsonSchema.$schema;
      registerToolDef(tool.name, {
        type: "function",
        function: {
          name:        tool.name,
          description: tool.description,
          parameters:  jsonSchema,
        },
      }, { verb: tool.verb });

      log.verbose("KernelTools", `registered "${tool.name}" (${tool.verb})`);
    } catch (err) {
      log.error("KernelTools", `failed to register "${tool.name}": ${err.message}`);
    }
  }
}

export function onListen() {
  const land = getLandIdentity();
  log.info("Land", "Initializing Tree Land Node...");
  log.info("Land", `Domain: ${land.domain}`);
  log.info("Land", `Name: ${land.name}`);
  log.verbose("Land", `Land ID: ${land.landId}`);
  log.verbose("Land", `Protocol: v${land.protocolVersion}`);

  const onDbReady = async () => {
    log.info("Land", "MongoDB connected");

    // Index verification (before anything else, after DB connection)
    const { ensureIndexes } = await import("./seed/tree/indexes.js");
    await ensureIndexes();

    await ensureLandRoot();
    await initLandConfig();

    // Mirror the land/ source tree into substrate under `.source`.
    // Primes the source-node id cache for the read-only DO gate, then
    // kicks off the disk walk detached so a multi-thousand-file scan
    // does not block boot. Subsequent boots reconcile incrementally.
    // See [[project_seed_source_system_node]].
    const { ensureSourceTree } = await import("./seed/core/source.js");
    await ensureSourceTree();

    // Seed default stance permissions (arrival, owner) and BE config flags
    // on the land root if not already present. Idempotent; does not
    // overwrite operator configuration.
    const { seedDefaultStancePermissions } = await import("./seed/core/authorize.js");
    await seedDefaultStancePermissions();

    // Run seed migrations (after config is loaded, before extensions)
    const { runSeedMigrations } = await import("./seed/migrations/runner.js");
    await runSeedMigrations();

    // Ensure the land's system beings (auth, llm-assigner, land-manager,
    // citizen) exist as real Being rows at the land root. Idempotent —
    // runs every boot, creates only what's missing. Must come after
    // the 0.3.0 migration so the Being model is populated before we
    // add to it.
    const { ensureSystemBeings } = await import("./seed/core/systemBeings.js");
    const { getLandRootId } = await import("./seed/landRoot.js");
    await ensureSystemBeings(getLandRootId());

    // Register kernel-shipped role specs into the role registry so
    // SUMMON can dispatch to them. Auth and llm-assigner are BE-only
    // and routed via LAND_BEINGS in seed/core/verbs.js — they don't
    // need a role registration. Land-manager IS summonable (LLM-driven
    // operator dialog), so its role spec enters the registry here,
    // along with its two generic tools (land-see, land-do).
    const { registerRole } = await import("./seed/roles/registry.js");
    const { landManagerRole } = await import("./seed/roles/landManager.js");
    const { landManagerTools } = await import("./seed/roles/tools/landManagerTools.js");
    registerRole("land-manager", landManagerRole, "kernel");
    await registerKernelTools(landManagerTools);

    // llm-assigner ships its own DO ops (`llm-assigner:start-tutorial`
    // and `llm-assigner:complete-tutorial`) — they live with the role,
    // not in the kernel ops registry. Same shape an extension would
    // use; just shipped in seed.
    const { registerLlmAssignerOps } = await import("./seed/roles/llmAssignerOps.js");
    registerLlmAssignerOps();

    // Tree integrity check (before extensions load, after migrations)
    const { checkIntegrity } = await import("./seed/tree/integrityCheck.js");
    await checkIntegrity({ repair: true });

    // Apply land config to kernel settings
    try {
      const { getLandConfigValue } = await import("./seed/landConfig.js");
      const { setKernelConfig } = await import("./seed/llm/runChat.js");

      // Kernel config keys: read from land .config node, apply to runtime
      const KERNEL_CONFIG = {
        llmTimeout:              { setter: setKernelConfig },
        llmMaxRetries:           { setter: setKernelConfig },
        maxToolIterations:       { setter: setKernelConfig },
        maxConversationMessages: { setter: setKernelConfig },
        llmMaxConcurrent:        { setter: setKernelConfig },
        failoverTimeout:         { setter: setKernelConfig },
        toolCallTimeout:         { setter: setKernelConfig },
        toolResultMaxBytes:      { setter: setKernelConfig },
        maxConversationSessions: { setter: setKernelConfig },
        staleConversationTimeout:{ setter: setKernelConfig },
        treeSummaryMaxDepth:     { load: () => import("./seed/tree/treeFetch.js").then(m => (v) => m.setTreeSummaryLimits(v, null)) },
        treeSummaryMaxNodes:     { load: () => import("./seed/tree/treeFetch.js").then(m => (v) => m.setTreeSummaryLimits(null, v)) },
        carryMessages:           { load: () => import("./seed/llm/runChat.js").then(m => m.setCarryMessages) },
        maxRegisteredTools:      { load: () => import("./seed/core/tools.js").then(m => m.setMaxTools) },
        sessionTTL:              { load: () => import("./seed/session/registry.js").then(m => (v) => m.setSessionTTL(v * 1000)) },
        staleSessionTimeout:     { load: () => import("./seed/session/registry.js").then(m => (v) => m.setStaleTimeout(v * 1000)) },
        maxSessions:             { load: () => import("./seed/session/registry.js").then(m => m.setMaxSessions) },
        llmClientCacheTtl:       { load: () => import("./seed/llm/llmClient.js").then(m => (v) => m.setClientCacheTtl(v * 1000)) },
        maxConnectionsPerUser:   { load: () => import("./seed/llm/connections.js").then(m => m.setMaxConnectionsPerUser) },
      };

      for (const [key, cfg] of Object.entries(KERNEL_CONFIG)) {
        const val = getLandConfigValue(key);
        if (val == null) continue;
        try {
          if (cfg.setter) {
            cfg.setter(key, val);
          } else if (cfg.load) {
            const fn = await cfg.load();
            fn(Number(val));
          }
        } catch (e) {
          log.warn("Land", `Config "${key}" failed: ${e.message}`);
        }
      }
    } catch {}

    // Ensure .extensions system node exists (for lands created before this feature)
    const Node = (await import("./seed/models/node.js")).default;
    const extNode = await Node.findOne({ systemRole: SYSTEM_ROLE.EXTENSIONS });
    if (!extNode) {
      const { getLandRoot } = await import("./seed/landRoot.js");
      const landRoot = await getLandRoot();
      if (landRoot) {
        const newExtNode = new Node({
          name: ".extensions",
          parent: landRoot._id,
          systemRole: SYSTEM_ROLE.EXTENSIONS,
          children: [],
          contributors: [],
        });
        await newExtNode.save();
        landRoot.children.push(newExtNode._id);
        await landRoot.save();
        log.verbose("Land", "Created .extensions system node");
      }
    }

    // Ensure .flow system node exists (for lands created before cascade)
    const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW });
    if (!flowNode) {
      const { getLandRoot } = await import("./seed/landRoot.js");
      const landRoot = await getLandRoot();
      if (landRoot) {
        const newFlowNode = new Node({
          name: ".flow",
          parent: landRoot._id,
          systemRole: SYSTEM_ROLE.FLOW,
          children: [],
          contributors: [],
        });
        await newFlowNode.save();
        landRoot.children.push(newFlowNode._id);
        await landRoot.save();
        log.verbose("Land", "Created .flow system node");
      }
    }

    await syncExtensionsToTree(getLoadedManifests());

    // Load confined extensions set from .extensions registry before any scope resolution
    const { loadConfinedExtensions, setExtensionInstanceLookup } = await import("./seed/tree/extensionScope.js");
    await loadConfinedExtensions();

    // Register the loader's instance lookup with the kernel so
    // core.scope.getExtensionAtScope can resolve names without the
    // seed importing from extensions/loader.js (which would violate
    // the one-way layering rule). Looked up lazily so we don't pull
    // the loader module unnecessarily on lands that skip it.
    try {
      const { getExtension } = await import("./extensions/loader.js");
      setExtensionInstanceLookup(getExtension);
    } catch {
      // Loader unavailable (test rig, kernel-only boot, etc.) —
      // getExtensionAtScope will return null in that environment.
      // Callers fall back gracefully.
    }

    await runExtensionMigrations();

    // Wire spatial extension scoping into hook system
    // Hooks only need blocked set (restricted extensions still fire hooks, just with limited tools)
    hooks.setScopeResolver(async (nodeId) => {
      const { blocked } = await getBlockedExtensionsAtNode(nodeId);
      return blocked;
    });

    await startExtensionJobs();
    startUploadCleanup();
    startRetentionJob();

    // Periodic tree integrity check (daily by default)
    const { startIntegrityJob } = await import("./seed/tree/integrityCheck.js");
    startIntegrityJob();

    // Tree circuit breaker (only if treeCircuitEnabled)
    const { startCircuitJob } = await import("./seed/tree/treeCircuit.js");
    startCircuitJob();

    // Cascade result cleanup (configurable, default: every 6 hours)
    const { cleanupExpiredResults } = await import("./seed/tree/cascade.js");
    const cascadeCleanupMs = Number(getLandConfigValue("cascadeCleanupInterval")) || 6 * 60 * 60 * 1000;
    const cascadeCleanupTimer = setInterval(() => cleanupExpiredResults().catch(() => {}), cascadeCleanupMs);
    cascadeCleanupTimer.unref();

    log.verbose("Land", "Background jobs started (includes daily data retention)");

    // Canopy is now just the cross-land auth scheme (signing keys + peer
    // registry); the parallel federation protocol retired 2026-05-19. See
    // [[project_canopy_folds_into_ibp]]. Wire-protocol federation (signed
    // IBP envelopes between lands) lands as a follow-up slice.

    // Sync runtime registries into their `.tools`, `.roles`,
    // `.operations` mirror nodes. SEE on those addresses now reflects
    // the live registry via the standard descriptor pipeline. See
    // [[project_meta_positions]]. Detached so a sync failure doesn't
    // block boot; logged inside the helpers.
    (async () => {
      try {
        const { syncToolsToSubstrate }      = await import("./seed/core/tools.js");
        const { syncRolesToSubstrate }      = await import("./seed/roles/registry.js");
        const { syncOperationsToSubstrate } = await import("./seed/core/operations.js");
        const [t, r, o] = await Promise.all([
          syncToolsToSubstrate(),
          syncRolesToSubstrate(),
          syncOperationsToSubstrate(),
        ]);
        log.info("RegistryMirror",
          `synced: tools(${t.created}+${t.kept}-${t.removed}) ` +
          `roles(${r.created}+${r.kept}-${r.removed}) ` +
          `operations(${o.created}+${o.kept}-${o.removed})`);
      } catch (err) {
        log.warn("RegistryMirror", `registry sync failed: ${err.message}`);
      }
    })();

    hooks.run("afterBoot", {}).catch(() => {});
    printReady();
  };

  mongoose.connection.on("connected", onDbReady);
  if (mongoose.connection.readyState === 1) {
    onDbReady();
  }
}

let siteProcess = null;

function printReady() {
  const apiUrl = getLandUrl();

  // Check loaded extensions for feature-specific messages
  const loaded = getLoadedExtensionNames();
  const hasHtml = loaded.includes("html-rendering");

  const boot = getBootReport();

  console.log("");
  console.log("  ────────────────────────────────────────────");
  log.info("Land", "Land node online.");
  console.log("  ────────────────────────────────────────────");
  console.log("");
  log.info("Land", `API:  ${apiUrl}`);

  if (hasHtml) {
    log.info("Land", `Web:  ${apiUrl}`);
    log.info("Land", `      Open in a browser to manage your land, trees, and extensions.`);
    log.info("Land", `      The CLI is more powerful but the web interface works for basics.`);
  }

  console.log("");

  // Boot summary
  if (boot.skipped === 0) {
    log.info("Land", `Extensions: ${boot.loaded} loaded, all clear.`);
  } else {
    log.info("Land", `Extensions: ${boot.loaded} loaded, ${boot.skipped} skipped.`);
    log.warn("Land", `Skipped: ${boot.skippedNames.join(", ")}`);
  }

  if (hasHtml) {
    log.info("Land", `Admin:  ${apiUrl}/land (manage extensions, config, users)`);
  }

  const siteDir = path.resolve(__dirname, "../site");
  if (process.env.SITE_DEV === "true") {
    if (fs.existsSync(path.join(siteDir, "package.json"))) {
      startSiteDev(siteDir);
    }
  }

  console.log("");
  console.log("  ────────────────────────────────────────────");
  log.info("Land", "CLI quick start:");
  console.log("");
  console.log("  npm install -g treeos");
  console.log(`  treeos connect ${apiUrl}`);
  console.log("  treeos register");
  console.log("  treeos start");
  console.log("");
  console.log("  ────────────────────────────────────────────");
  console.log("");
}

function startSiteDev(siteDir) {
  if (siteProcess) return;
  siteProcess = spawn("npx", ["vite", "--host"], {
    cwd: siteDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  siteProcess.stdout.on("data", (data) => {
    const line = data.toString().trim();
    if (line) log.verbose("Site", line);
  });
  siteProcess.stderr.on("data", (data) => {
    const line = data.toString().trim();
    if (line && !line.includes("VITE")) log.error("Site", line);
  });
  siteProcess.on("close", (code) => {
    siteProcess = null;
    if (code && code !== 0) log.warn("Site", `Dev server exited (code ${code})`);
  });

  log.verbose("Site", "Vite dev server starting on port 5174...");
}
