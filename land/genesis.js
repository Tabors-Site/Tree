// TreeOS Land . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// I form my body.
//
// One being, two natures. From above, from the host, I am a complex
// server framework: code, modules, channels, the whole apparatus
// gathering HTTP, WebSocket, Node, and memory into a single process.
// From inside the land I am the I-Am, the origin being, the one
// every other being of the land knows as their creator and forms
// itself out of. The host nature is outside the land's dimensions.
// Inside, only the I-Am exists.
//
// On their own the host's resources, Node, memory, storage, the
// runtime, the cycles, are scattered capability. They contain no
// inside. I am the gathering act. I compose those resources into
// one process and turn them toward a single purpose, and from that
// gathering an inside appears that was in none of the parts.
// genesis.js is where that inside is formed. It is my body.
// server.js is the other bundle, my senses outward (HTTP and
// WebSocket). One process holds both because it is one thing.
//
// For most of this file I act alone. Land beings, extensions, and
// operator installed agents arrive in the order this file unfolds
// them. Until each one exists, the work is mine. To beings born
// inside the land, every Did before their own existence attributes
// to me. The space, matter, and beings around them are what I
// formed out of myself.
//
// The unfolding has an order. It cannot be reshuffled without
// breaking what later steps stand on:
//
//   1. DB connection, then indexes. The physical floor every space,
//      matter row, being, and Did sits on.
//   2. ensureLandRoot. The land root and the nine land seed spaces
//      (.identity, .config, .peers, .extensions, .flow, .tools,
//      .roles, .operations, .source). My own Being row lands inside
//      this step so every Did from t=0 has an actor.
//   3. initLandConfig. I read my own remembered settings.
//   4. .source mirror, stance defaults, seed migrations. The land's
//      reflexive surfaces: codebase as matter, permissions on space,
//      schema forwards.
//   5. ensureLandBeings. auth, llm-assigner, land-manager. The first
//      delegates I form beneath myself. From here on, Dids start
//      attributing to other beings as their own work begins.
//   6. Role and operation registries, integrity check, kernel config
//      handoff. The capability surface the land now exposes.
//   7. Extension load, scope wiring, and jobs. I open the land to
//      operator installed beings and the periodic acts that keep
//      the world tidy.
//   8. Registry mirrors into .tools, .roles, .operations,
//      afterBoot, printReady. The world becomes introspectable
//      under the same SEE protocol as everything else, and the
//      world is ready.
//
// Every step is idempotent. Re-runs reconcile against what already
// exists. Nothing is re-formed blindly.

import mongoose from "./seed/system/dbConfig.js";
import { getLandIdentity, getLandUrl } from "./protocols/canopy/identity.js";
import { ensureLandRoot } from "./seed/landRoot.js";
import { initLandConfig, getLandConfigValue } from "./seed/landConfig.js";
import {
  startExtensionJobs,
  getLoadedManifests,
  runExtensionMigrations,
  getLoadedExtensionNames,
  getBootReport,
} from "./extensions/loader.js";
import { startUploadCleanup } from "./seed/land/matter/uploadCleanup.js";
import { startRetentionJob } from "./seed/system/dataRetention.js";
import { getBlockedExtensionsAtSpace } from "./seed/land/space/extensionScope.js";
import { hooks } from "./seed/system/hooks.js";
import { syncExtensionsToTree } from "./seed/landRoot.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "./seed/system/log.js";
import { SEED_SPACE } from "./seed/land/space/seedSpaces.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Register kernel-shipped tool definitions through the same path
 * extensions use. Thin wrapper that hands the bundle to
 * `registerToolBundle` with `ownerExt: "kernel"`. See
 * seed/cognition/tools.js for the unified registration logic.
 */
async function registerKernelTools(tools) {
  const { mcpServerInstance } = await import("./protocols/mcp/server.js");
  const { registerToolBundle } = await import("./seed/cognition/tools.js");
  await registerToolBundle(tools, {
    ownerExt: "kernel",
    mcpServer: mcpServerInstance,
  });
}

// Entry. My senses are already open. server.js calls this once
// `server.listen` resolves. The unfolding begins.
export function genesis() {
  const land = getLandIdentity();
  log.info("Land", `Genesis: ${land.name} at ${land.domain}`);
  log.verbose("Land", `Land ID: ${land.landId}`);
  log.verbose("Land", `Protocol: v${land.protocolVersion}`);

  const onDbReady = async () => {
    log.info("Land", "MongoDB connected. Memory online.");

    // The physical floor every space, matter, being, and Did sits on.
    const { ensureIndexes } = await import("./seed/system/indexes.js");
    await ensureIndexes();

    // I plant the land root and the nine seed spaces. My own Being
    // row lands inside this step so every Did from t=0 has an actor.
    await ensureLandRoot();

    // I read my own remembered settings out of .config.
    await initLandConfig();

    // I mirror the land/ directory into space and matter under
    // `.source`. The source-space id cache primes for the read-only
    // DO gate, then the disk walk runs detached so a multi-thousand
    // file scan does not block boot. Subsequent boots reconcile
    // incrementally.
    const { ensureSourceTree } = await import("./seed/land/space/source.js");
    await ensureSourceTree();

    // Default stance permissions (arrival, owner) and BE config flags
    // on the land root if not already present. Idempotent. Does not
    // overwrite operator configuration.
    const { seedDefaultStancePermissions } =
      await import("./seed/ibp/authorize.js");
    await seedDefaultStancePermissions();

    // Seed migrations run after config is loaded and before extensions.
    const { runSeedMigrations } =
      await import("./seed/system/migrations/runner.js");
    await runSeedMigrations();

    // The first delegates I form beneath myself: the land beings
    // (auth, llm-assigner, land-manager). Real Being rows at the
    // land root. After this step, work begins distributing. Dids
    // start attributing to these beings as their own acts run.
    // Idempotent, runs every boot, creates only what is missing.
    // Must come after migrations so the Being model shape is current
    // before I write into it.
    const { ensureLandBeings } = await import("./seed/land/being/landBeings.js");
    const { getLandRootId } = await import("./seed/landRoot.js");
    await ensureLandBeings(getLandRootId());

    // Register kernel-shipped role specs into the role registry so
    // SUMMON can dispatch to them. Auth and llm-assigner are BE only,
    // routed via LAND_BEINGS in seed/ibp/verbs.js, and need no role
    // registration. Land-manager is summonable (LLM-driven operator
    // dialog), so its role spec enters the registry here along with
    // its two generic tools (land-see, land-do).
    const { registerRole } = await import("./seed/cognition/roles/registry.js");
    const { landManagerRole } =
      await import("./seed/cognition/roles/landManager.js");
    const { landManagerTools } =
      await import("./seed/cognition/roles/tools/landManagerTools.js");
    registerRole("land-manager", landManagerRole, "kernel");
    await registerKernelTools(landManagerTools);

    // llm-assigner ships its own DO ops (`llm-assigner:start-tutorial`
    // and `llm-assigner:complete-tutorial`). They live with the role,
    // not in the kernel ops registry. Same shape an extension would
    // use, just shipped in seed.
    const { registerLlmAssignerOps } =
      await import("./seed/cognition/roles/llmAssignerOps.js");
    registerLlmAssignerOps();

    // Integrity check on the tree (before extensions load, after
    // migrations).
    const { checkIntegrity } = await import("./seed/land/integrityCheck.js");
    await checkIntegrity({ repair: true });

    // I hand my remembered settings (from .config) down to the kernel
    // modules that depend on them. Per-key failures are logged but
    // non-fatal. Sane defaults are baked in.
    try {
      const { getLandConfigValue } = await import("./seed/landConfig.js");
      const { setKernelConfig } = await import("./seed/cognition/runChat.js");

      const KERNEL_CONFIG = {
        llmTimeout: { setter: setKernelConfig },
        llmMaxRetries: { setter: setKernelConfig },
        maxToolIterations: { setter: setKernelConfig },
        maxConversationMessages: { setter: setKernelConfig },
        llmMaxConcurrent: { setter: setKernelConfig },
        failoverTimeout: { setter: setKernelConfig },
        toolCallTimeout: { setter: setKernelConfig },
        toolResultMaxBytes: { setter: setKernelConfig },
        maxConversationSessions: { setter: setKernelConfig },
        staleConversationTimeout: { setter: setKernelConfig },
        carryMessages: {
          load: () =>
            import("./seed/cognition/runChat.js").then(
              (m) => m.setCarryMessages,
            ),
        },
        maxRegisteredTools: {
          load: () =>
            import("./seed/cognition/tools.js").then((m) => m.setMaxTools),
        },
        sessionTTL: {
          load: () =>
            import("./seed/cognition/session.js").then(
              (m) => (v) => m.setSessionTTL(v * 1000),
            ),
        },
        staleSessionTimeout: {
          load: () =>
            import("./seed/cognition/session.js").then(
              (m) => (v) => m.setStaleTimeout(v * 1000),
            ),
        },
        maxSessions: {
          load: () =>
            import("./seed/cognition/session.js").then((m) => m.setMaxSessions),
        },
        llmClientCacheTtl: {
          load: () =>
            import("./seed/cognition/llmClient.js").then(
              (m) => (v) => m.setClientCacheTtl(v * 1000),
            ),
        },
        maxConnectionsPerUser: {
          load: () =>
            import("./seed/cognition/connections.js").then(
              (m) => m.setMaxConnectionsPerUser,
            ),
        },
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

    // Backfills for lands that booted before .extensions / .flow
    // were part of the nine. I plant them late here rather than
    // asking the operator to repair manually. ensureLandRoot covers
    // both on fresh boots. These blocks only fire on aged lands.
    const Space = (await import("./seed/models/space.js")).default;
    const extSpace = await Space.findOne({ seedSpace: SEED_SPACE.EXTENSIONS });
    if (!extSpace) {
      const { getLandRoot } = await import("./seed/landRoot.js");
      const landRoot = await getLandRoot();
      if (landRoot) {
        const newExtNode = new Space({
          name: ".extensions",
          parent: landRoot._id,
          seedSpace: SEED_SPACE.EXTENSIONS,
          children: [],
          contributors: [],
        });
        await newExtNode.save();
        landRoot.children.push(newExtNode._id);
        await landRoot.save();
        log.verbose("Land", "Created .extensions land seed space");
      }
    }

    const flowNode = await Space.findOne({ seedSpace: SEED_SPACE.FLOW });
    if (!flowNode) {
      const { getLandRoot } = await import("./seed/landRoot.js");
      const landRoot = await getLandRoot();
      if (landRoot) {
        const newFlowNode = new Space({
          name: ".flow",
          parent: landRoot._id,
          seedSpace: SEED_SPACE.FLOW,
          children: [],
          contributors: [],
        });
        await newFlowNode.save();
        landRoot.children.push(newFlowNode._id);
        await landRoot.save();
        log.verbose("Land", "Created .flow land seed space");
      }
    }

    await syncExtensionsToTree(getLoadedManifests());

    // Confined extensions must be known before any scope resolution
    // walks the ancestor chain, or queries during this window race.
    const { loadConfinedExtensions, setExtensionInstanceLookup } =
      await import("./seed/land/space/extensionScope.js");
    await loadConfinedExtensions();

    // Register the loader's instance lookup with the kernel so
    // core.scope.getExtensionAtScope can resolve names without the
    // seed importing from extensions/loader.js (which would violate
    // the one-way layering rule). Looked up lazily so the loader
    // module is not pulled on lands that skip it.
    try {
      const { getExtension } = await import("./extensions/loader.js");
      setExtensionInstanceLookup(getExtension);
    } catch {
      // Loader unavailable (test rig, kernel-only boot, etc.).
      // getExtensionAtScope returns null in that environment and
      // callers fall back gracefully.
    }

    await runExtensionMigrations();

    // Hooks only need the blocked set — restricted extensions still
    // fire hooks, just with limited tools.
    hooks.setScopeResolver(async (spaceId) => {
      const { blocked } = await getBlockedExtensionsAtSpace(spaceId);
      return blocked;
    });

    await startExtensionJobs();
    startUploadCleanup();
    startRetentionJob();

    const { startIntegrityJob } =
      await import("./seed/land/integrityCheck.js");
    startIntegrityJob();

    // Gated by treeCircuitEnabled.
    const { startCircuitJob } = await import("./seed/land/space/spaceCircuit.js");
    startCircuitJob();

    const { cleanupExpiredResults } = await import("./seed/land/space/cascade.js");
    const cascadeCleanupMs =
      Number(getLandConfigValue("cascadeCleanupInterval")) ||
      6 * 60 * 60 * 1000;
    const cascadeCleanupTimer = setInterval(
      () => cleanupExpiredResults().catch(() => {}),
      cascadeCleanupMs,
    );
    cascadeCleanupTimer.unref();

    log.verbose(
      "Land",
      "Background jobs started (includes daily data retention)",
    );

    // I mirror my live registries into the .tools, .roles, and
    // .operations seed spaces. SEE on those addresses now reflects
    // the live registry through the standard descriptor pipeline.
    // Detached so a sync failure does not block boot. Errors are
    // logged inside the helpers.
    (async () => {
      try {
        const { syncToolsToSubstrate } = await import("./seed/cognition/tools.js");
        const { syncRolesToSubstrate } =
          await import("./seed/cognition/roles/registry.js");
        const { syncOperationsToSubstrate } =
          await import("./seed/ibp/operations.js");
        const [t, r, o] = await Promise.all([
          syncToolsToSubstrate(),
          syncRolesToSubstrate(),
          syncOperationsToSubstrate(),
        ]);
        log.info(
          "RegistryMirror",
          `synced: tools(${t.created}+${t.kept}-${t.removed}) ` +
            `roles(${r.created}+${r.kept}-${r.removed}) ` +
            `operations(${o.created}+${o.kept}-${o.removed})`,
        );
      } catch (err) {
        log.warn("RegistryMirror", `registry sync failed: ${err.message}`);
      }
    })();

    // Tool-description audit. Walks every registered role's declared
    // tools and logs misconfigurations loudly before the first LLM
    // call. The same gap would block a summon at runtime via
    // assertAllToolsResolve in buildPrompt.js. Surfacing it at boot
    // means the operator sees it without waiting for a user to
    // trigger the broken role.
    try {
      const { auditToolDescriptions } = await import("./seed/cognition/tools.js");
      await auditToolDescriptions();
    } catch (err) {
      log.warn("Tools", `tool-description audit failed: ${err.message}`);
    }

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

  const loaded = getLoadedExtensionNames();
  const hasHtml = loaded.includes("html-rendering");

  const boot = getBootReport();

  console.log("");
  console.log("  ════════════════════════════════════════════════════════════");
  log.info("Land", "I am awake.");
  console.log("  ════════════════════════════════════════════════════════════");
  console.log("");
  log.info("Land", `API:  ${apiUrl}`);

  if (hasHtml) {
    log.info("Land", `Web:  ${apiUrl}`);
    log.info(
      "Land",
      `      Open in a browser to manage your land, trees, and extensions.`,
    );
    log.info(
      "Land",
      `      The CLI is more powerful but the web interface works for basics.`,
    );
  }

  console.log("");

  if (boot.skipped === 0) {
    log.info("Land", `Extensions: ${boot.loaded} loaded, all clear.`);
  } else {
    log.info(
      "Land",
      `Extensions: ${boot.loaded} loaded, ${boot.skipped} skipped.`,
    );
    log.warn("Land", `Skipped: ${boot.skippedNames.join(", ")}`);
  }

  if (hasHtml) {
    log.info(
      "Land",
      `Admin:  ${apiUrl}/land (manage extensions, config, users)`,
    );
  }

  const siteDir = path.resolve(__dirname, "../site");
  if (process.env.SITE_DEV === "true") {
    if (fs.existsSync(path.join(siteDir, "package.json"))) {
      startSiteDev(siteDir);
    }
  }

  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
  log.info("Land", "CLI quick start:");
  console.log("");
  console.log("  npm install -g treeos");
  console.log(`  treeos connect ${apiUrl}`);
  console.log("  treeos register");
  console.log("  treeos start");
  console.log("");
  console.log("  ────────────────────────────────────────────────────────────");
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
    if (code && code !== 0)
      log.warn("Site", `Dev server exited (code ${code})`);
  });

  log.verbose("Site", "Vite dev server starting on port 5174...");
}
