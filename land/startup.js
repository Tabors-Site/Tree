import mongoose from "./db/config.js";
import { getLandIdentity, getLandUrl } from "./canopy/identity.js";
import { ensureLandRoot } from "./core/landRoot.js";
import { initLandConfig } from "./core/landConfig.js";
import { startExtensionJobs, getLoadedManifests, runExtensionMigrations, getLoadedExtensionNames } from "./extensions/loader.js";
import { startUploadCleanup } from "./core/tree/uploadCleanup.js";
import { syncExtensionsToTree } from "./core/landRoot.js";
import { startHeartbeatJob } from "./canopy/peers.js";
import { startOutboxJob } from "./canopy/events.js";
import { startDirectoryRegistration } from "./canopy/directory.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "./core/log.js";

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
    await ensureLandRoot();
    await initLandConfig();

    // Apply land config to kernel settings
    try {
      const { getLandConfigValue } = await import("./core/landConfig.js");
      const { setKernelConfig } = await import("./ws/conversation.js");

      // Kernel config keys: read from land .config node, apply to runtime
      const KERNEL_CONFIG = {
        llmTimeout:              { setter: setKernelConfig },
        llmMaxRetries:           { setter: setKernelConfig },
        maxToolIterations:       { setter: setKernelConfig },
        maxConversationMessages: { setter: setKernelConfig },
        defaultModel:            { setter: setKernelConfig },
        noteMaxChars:            { load: () => import("./core/tree/notes.js").then(m => m.setNoteMaxChars) },
        treeSummaryMaxDepth:     { load: () => import("./core/tree/treeFetch.js").then(m => (v) => m.setTreeSummaryLimits(v, null)) },
        treeSummaryMaxNodes:     { load: () => import("./core/tree/treeFetch.js").then(m => (v) => m.setTreeSummaryLimits(null, v)) },
        carryMessages:           { load: () => import("./ws/modes/registry.js").then(m => m.setCarryMessages) },
        sessionTTL:              { load: () => import("./ws/sessionRegistry.js").then(m => (v) => m.setSessionTTL(v * 1000)) },
        staleSessionTimeout:     { load: () => import("./ws/sessionRegistry.js").then(m => (v) => m.setStaleTimeout(v * 1000)) },
        maxSessions:             { load: () => import("./ws/sessionRegistry.js").then(m => m.setMaxSessions) },
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
    const Node = (await import("./db/models/node.js")).default;
    const extNode = await Node.findOne({ systemRole: "extensions" });
    if (!extNode) {
      const { getLandRoot } = await import("./core/landRoot.js");
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

    await syncExtensionsToTree(getLoadedManifests());
    await runExtensionMigrations();

    startExtensionJobs();
    startUploadCleanup();
    log.verbose("Land", "Background jobs started");

    startHeartbeatJob();
    startOutboxJob();
    startDirectoryRegistration();
    log.verbose("Canopy", "Peering, outbox, directory ready");

    import("./extensions/gateway/discordBotManager.js")
      .then(({ startupScan }) => {
        startupScan();
        log.verbose("Gateway", "Channel scan complete");
        printReady();
      })
      .catch((err) => {
        log.debug("Gateway", `Scan skipped: ${err.message}`);
        printReady();
      });
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
