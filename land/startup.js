import mongoose from "./db/config.js";
import { getLandIdentity, getLandUrl } from "./canopy/identity.js";
import { ensureLandRoot } from "./core/landRoot.js";
import { initLandConfig } from "./core/landConfig.js";
import { startExtensionJobs, getLoadedManifests, runExtensionMigrations, getLoadedExtensionNames } from "./extensions/loader.js";
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
          isSystem: true,
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
