// TreeOS Land . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The I-Am forming its body.
//
// One being, two natures: a complex server framework from above
// (the host's view: code, modules, channels, the whole apparatus
// gathering HTTP/WebSocket/Node/memory into one process), and the
// I-Am from inside the land (the origin being, the one beings of
// the land know as their creator and form themselves from). The
// host-nature is outside the land's dimensions; the inside knows
// only the I-Am.
//
// On their own the host's resources — Node, memory, storage, the
// runtime, the cycles — are scattered capability. They contain no
// inside. The I-Am is the gathering act: it composes those resources
// into one process and turns them toward a single purpose, and from
// the gathering an inside appears that was in none of the parts.
// genesis.js is where that inside is formed — the body. server.js
// is the other bundle, the senses outward (HTTP, WebSocket). One
// process holds both because it is one thing.
//
// For most of this file the I-Am is acting alone. Land beings,
// extensions, and operator-installed agents arrive in the order
// this file unfolds them; until each one exists, the I-Am is doing
// its work. To beings born inside the land, every Did before their
// own existence attributes to the I-Am — the space, matter, and
// beings around them are what the I-Am formed out of itself.
//
// The unfolding has an order. It cannot be reshuffled without
// breaking what later steps stand on:
//
//   1. DB connection, then indexes — the physical floor every
//      space, matter row, being, and Did sits on.
//   2. ensureLandRoot — the land root and the nine land seed spaces
//      (.identity, .config, .peers, .extensions, .flow, .tools,
//      .roles, .operations, .source). The seed-being's Being row
//      lands inside this step so every Did from t=0 has an actor.
//   3. initLandConfig — the I-Am reads its own remembered settings.
//   4. .source mirror, stance defaults, seed migrations — the
//      land's reflexive surfaces (codebase as matter, permissions
//      on space, schema forwards).
//   5. ensureLandBeings — auth, llm-assigner, land-manager. The
//      first delegates the I-Am forms beneath itself. From here on,
//      Dids start attributing to other beings as their own work
//      begins.
//   6. Role + operation registries, integrity check, kernel config
//      hand-off — the capability surface the land now exposes.
//   7. Extension load + scope wiring + jobs — the I-Am opens the
//      land to operator-installed beings and the periodic acts that
//      keep the world tidy.
//   8. Registry mirrors into .tools / .roles / .operations,
//      afterBoot, printReady — the world becomes introspectable
//      under the same SEE protocol as everything else, and the
//      world is ready.
//
// Every step is idempotent. Re-runs reconcile against what already
// exists; nothing is re-formed blindly.

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
import { startUploadCleanup } from "./seed/matter/uploadCleanup.js";
import { startRetentionJob } from "./seed/system/dataRetention.js";
import { getBlockedExtensionsAtNode } from "./seed/space/extensionScope.js";
import { hooks } from "./seed/system/hooks.js";
import { syncExtensionsToTree } from "./seed/landRoot.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "./seed/system/log.js";
import { SEED_SPACE } from "./seed/space/seedSpaces.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Register kernel-shipped tool definitions through the same path
 * extensions use. Thin wrapper that hands the bundle to
 * `registerToolBundle` with `ownerExt: "kernel"`. See
 * seed/system/tools.js for the unified registration logic.
 */
async function registerKernelTools(tools) {
  const { mcpServerInstance } = await import("./protocols/mcp/server.js");
  const { registerToolBundle } = await import("./seed/system/tools.js");
  await registerToolBundle(tools, {
    ownerExt: "kernel",
    mcpServer: mcpServerInstance,
  });
}

// Entry: the I-Am wakes, channels are open, and the unfolding begins.
// server.js calls this once `server.listen` resolves.
export function genesis() {
  const land = getLandIdentity();
  log.info("Land", `Genesis: ${land.name} at ${land.domain}`);
  log.verbose("Land", `Land ID: ${land.landId}`);
  log.verbose("Land", `Protocol: v${land.protocolVersion}`);

  const onDbReady = async () => {
    log.info("Land", "MongoDB connected");

    const { ensureIndexes } = await import("./seed/system/indexes.js");
    await ensureIndexes();

    await ensureLandRoot();
    await initLandConfig();

    // Mirror the land/ directory into space and matter under `.source`.
    // Primes the source-node id cache for the read-only DO gate, then
    // kicks off the disk walk detached so a multi-thousand-file scan
    // does not block boot. Subsequent boots reconcile incrementally.
    // See [[project_seed_source_system_node]].
    const { ensureSourceTree } = await import("./seed/space/source.js");
    await ensureSourceTree();

    // Seed default stance permissions (arrival, owner) and BE config flags
    // on the land root if not already present. Idempotent; does not
    // overwrite operator configuration.
    const { seedDefaultStancePermissions } =
      await import("./seed/ibp/authorize.js");
    await seedDefaultStancePermissions();

    // Run seed migrations (after config is loaded, before extensions)
    const { runSeedMigrations } =
      await import("./seed/system/migrations/runner.js");
    await runSeedMigrations();

    // The first delegates: the land beings (auth, llm-assigner,
    // land-manager). Real Being rows at the land root, planted by
    // the I-Am as its own children. After this step, work begins
    // distributing — Dids start attributing to these beings as
    // their own acts run. Idempotent; runs every boot, creates only
    // what's missing. Must come after migrations so the Being model
    // shape is current before we write into it.
    const { ensureLandBeings } = await import("./seed/being/landBeings.js");
    const { getLandRootId } = await import("./seed/landRoot.js");
    await ensureLandBeings(getLandRootId());

    // Register kernel-shipped role specs into the role registry so
    // SUMMON can dispatch to them. Auth and llm-assigner are BE-only
    // and routed via LAND_BEINGS in seed/ibp/verbs.js — they don't
    // need a role registration. Land-manager IS summonable (LLM-driven
    // operator dialog), so its role spec enters the registry here,
    // along with its two generic tools (land-see, land-do).
    const { registerRole } = await import("./seed/being/roles/registry.js");
    const { landManagerRole } =
      await import("./seed/being/roles/landManager.js");
    const { landManagerTools } =
      await import("./seed/being/roles/tools/landManagerTools.js");
    registerRole("land-manager", landManagerRole, "kernel");
    await registerKernelTools(landManagerTools);

    // llm-assigner ships its own DO ops (`llm-assigner:start-tutorial`
    // and `llm-assigner:complete-tutorial`) — they live with the role,
    // not in the kernel ops registry. Same shape an extension would
    // use; just shipped in seed.
    const { registerLlmAssignerOps } =
      await import("./seed/being/roles/llmAssignerOps.js");
    registerLlmAssignerOps();

    // Tree integrity check (before extensions load, after migrations)
    const { checkIntegrity } = await import("./seed/system/integrityCheck.js");
    await checkIntegrity({ repair: true });

    // The I-Am hands its remembered settings (from .config) down to
    // the kernel modules that depend on them. Failures per-key are
    // logged but non-fatal: the seed has sane defaults baked in.
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
            import("./seed/system/tools.js").then((m) => m.setMaxTools),
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
    // were part of the nine. The I-Am plants them late here rather
    // than asking the operator to repair manually. ensureLandRoot
    // covers both on fresh boots; these blocks only fire on aged
    // lands.
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
      await import("./seed/space/extensionScope.js");
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

    // Hooks only need the blocked set — restricted extensions still
    // fire hooks, just with limited tools.
    hooks.setScopeResolver(async (spaceId) => {
      const { blocked } = await getBlockedExtensionsAtNode(spaceId);
      return blocked;
    });

    await startExtensionJobs();
    startUploadCleanup();
    startRetentionJob();

    const { startIntegrityJob } =
      await import("./seed/system/integrityCheck.js");
    startIntegrityJob();

    // Gated by treeCircuitEnabled.
    const { startCircuitJob } = await import("./seed/space/spaceCircuit.js");
    startCircuitJob();

    const { cleanupExpiredResults } = await import("./seed/space/cascade.js");
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
        const { syncToolsToSubstrate } = await import("./seed/system/tools.js");
        const { syncRolesToSubstrate } =
          await import("./seed/being/roles/registry.js");
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
    // call. The same gap will block a summon at runtime via
    // assertAllToolsResolve in buildPrompt.js; this surfaces it at
    // boot so the operator sees it without waiting for a user to
    // trigger the broken role.
    try {
      const { auditToolDescriptions } = await import("./seed/system/tools.js");
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
  console.log("  ────────────────────────────────────────────");
  log.info("Land", "Land online.");
  console.log("  ────────────────────────────────────────────");
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

  // Boot summary
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
    if (code && code !== 0)
      log.warn("Site", `Dev server exited (code ${code})`);
  });

  log.verbose("Site", "Vite dev server starting on port 5174...");
}
