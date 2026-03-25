import mongoose from "./seed/dbConfig.js";
import { getLandIdentity, getLandUrl } from "./canopy/identity.js";
import { ensureLandRoot } from "./seed/landRoot.js";
import { initLandConfig } from "./seed/landConfig.js";
import { startExtensionJobs, getLoadedManifests, runExtensionMigrations, getLoadedExtensionNames } from "./extensions/loader.js";
import { startUploadCleanup } from "./seed/tree/uploadCleanup.js";
import { startRetentionJob } from "./seed/tree/dataRetention.js";
import { getBlockedExtensionsAtNode } from "./seed/tree/extensionScope.js";
import { hooks } from "./seed/hooks.js";
import { syncExtensionsToTree } from "./seed/landRoot.js";
import { registerCanopyAuth } from "./canopy/auth.js";
import { startHeartbeatJob } from "./canopy/peers.js";
import { startOutboxJob, startCanopyRetentionJob } from "./canopy/events.js";
import { startDirectoryRegistration } from "./canopy/directory.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "./seed/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    // Run seed migrations (after config is loaded, before extensions)
    const { runSeedMigrations } = await import("./seed/migrations/runner.js");
    await runSeedMigrations();

    // Tree integrity check (before extensions load, after migrations)
    const { checkIntegrity } = await import("./seed/tree/integrityCheck.js");
    await checkIntegrity({ repair: true });

    // Apply land config to kernel settings
    try {
      const { getLandConfigValue } = await import("./seed/landConfig.js");
      const { setKernelConfig } = await import("./seed/ws/conversation.js");

      // Kernel config keys: read from land .config node, apply to runtime
      const KERNEL_CONFIG = {
        llmTimeout:              { setter: setKernelConfig },
        llmMaxRetries:           { setter: setKernelConfig },
        maxToolIterations:       { setter: setKernelConfig },
        maxConversationMessages: { setter: setKernelConfig },
        defaultModel:            { setter: setKernelConfig },
        noteMaxChars:            { load: () => import("./seed/tree/notes.js").then(m => m.setNoteMaxChars) },
        treeSummaryMaxDepth:     { load: () => import("./seed/tree/treeFetch.js").then(m => (v) => m.setTreeSummaryLimits(v, null)) },
        treeSummaryMaxNodes:     { load: () => import("./seed/tree/treeFetch.js").then(m => (v) => m.setTreeSummaryLimits(null, v)) },
        carryMessages:           { load: () => import("./seed/ws/modes/registry.js").then(m => m.setCarryMessages) },
        sessionTTL:              { load: () => import("./seed/ws/sessionRegistry.js").then(m => (v) => m.setSessionTTL(v * 1000)) },
        staleSessionTimeout:     { load: () => import("./seed/ws/sessionRegistry.js").then(m => (v) => m.setStaleTimeout(v * 1000)) },
        maxSessions:             { load: () => import("./seed/ws/sessionRegistry.js").then(m => m.setMaxSessions) },
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
    const extNode = await Node.findOne({ systemRole: "extensions" });
    if (!extNode) {
      const { getLandRoot } = await import("./seed/landRoot.js");
      const landRoot = await getLandRoot();
      if (landRoot) {
        const newExtNode = new Node({
          name: ".extensions",
          parent: landRoot._id,
          systemRole: "extensions",
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
    const flowNode = await Node.findOne({ systemRole: "flow" });
    if (!flowNode) {
      const { getLandRoot } = await import("./seed/landRoot.js");
      const landRoot = await getLandRoot();
      if (landRoot) {
        const newFlowNode = new Node({
          name: ".flow",
          parent: landRoot._id,
          systemRole: "flow",
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
    await runExtensionMigrations();

    // Wire spatial extension scoping into hook system
    // Hooks only need blocked set (restricted extensions still fire hooks, just with limited tools)
    hooks.setScopeResolver(async (nodeId) => {
      const { blocked } = await getBlockedExtensionsAtNode(nodeId);
      return blocked;
    });

    startExtensionJobs();
    startUploadCleanup();
    startRetentionJob();

    // Periodic tree integrity check (daily by default)
    const { startIntegrityJob } = await import("./seed/tree/integrityCheck.js");
    startIntegrityJob();

    // Cascade result cleanup (every 6 hours, cleans expired signals from .flow)
    const { cleanupExpiredResults } = await import("./seed/tree/cascade.js");
    setInterval(() => cleanupExpiredResults().catch(() => {}), 6 * 60 * 60 * 1000);

    log.verbose("Land", "Background jobs started (includes daily data retention)");

    const { authStrategies } = await import("./seed/services.js");
    registerCanopyAuth(authStrategies);
    startHeartbeatJob();
    startOutboxJob();
    startCanopyRetentionJob();
    startDirectoryRegistration();
    log.verbose("Canopy", "Peering, outbox, directory, retention ready");

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

  console.log("");
  log.info("Land", "Land node online.");
  log.info("Land", `API:  ${apiUrl}`);

  if (hasHtml) {
    log.info("Land", `HTML: ${apiUrl}/login`);
  }

  const siteDir = path.resolve(__dirname, "../site");
  if (process.env.SITE_DEV === "true") {
    if (fs.existsSync(path.join(siteDir, "package.json"))) {
      startSiteDev(siteDir);
    }
  }

  console.log("");
  log.info("Land", "Quick start:");
  console.log("  npm install -g treeos");
  console.log(`  treeos connect ${apiUrl}`);
  console.log("  treeos register");
  console.log("  treeos start");
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
