import mongoose from "./db/config.js";
import { getLandIdentity, getLandUrl } from "./canopy/identity.js";
import { ensureLandRoot } from "./core/landRoot.js";
import { initLandConfig } from "./core/landConfig.js";
import { startExtensionJobs, getLoadedManifests, runExtensionMigrations } from "./extensions/loader.js";
import { syncExtensionsToTree } from "./core/landRoot.js";
import { startHeartbeatJob } from "./canopy/peers.js";
import { startOutboxJob } from "./canopy/events.js";
import { startDirectoryRegistration } from "./canopy/directory.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function onListen() {
  const land = getLandIdentity();
  console.log("[Land] Initializing Tree Land Node...");
  console.log(`[Land] Domain: ${land.domain}`);
  console.log(`[Land] Name: ${land.name}`);
  console.log(`[Land] Land ID: ${land.landId}`);
  console.log(`[Land] Canopy Protocol Version: ${land.protocolVersion}`);

  const onDbReady = async () => {
    console.log("[Land] MongoDB connected");
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
          versions: [{ prestige: 0, values: {}, status: "active", dateCreated: new Date() }],
        });
        await newExtNode.save();
        landRoot.children.push(newExtNode._id);
        await landRoot.save();
        console.log("[Land] Created .extensions system node");
      }
    }

    // Sync extension manifests to .extensions tree node
    await syncExtensionsToTree(getLoadedManifests());

    // Run pending schema migrations
    await runExtensionMigrations();

    startExtensionJobs();
    console.log("[Land] Background jobs started (via extension loader)");

    startHeartbeatJob();
    startOutboxJob();
    startDirectoryRegistration();
    console.log("[Land] Canopy API ready");

    import("./core/gateway/discordBotManager.js")
      .then(({ startupScan }) => {
        startupScan();
        console.log("[Land] Gateway scan complete");
        printReady();
      })
      .catch((err) => {
        console.error("[Land] Discord bot startup scan failed:", err.message);
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

  console.log("");
  console.log("[Land] Land node online.");
  console.log(`[Land] API:  ${apiUrl}`);

  if (process.env.ENABLE_FRONTEND_HTML === "true") {
    console.log(`[Land] HTML: ${apiUrl}/login`);
  }

  // Start Vite dev server if site/ exists and SITE_DEV is set
  const siteDir = path.resolve(__dirname, "../site");
  if (process.env.SITE_DEV === "true") {
    if (fs.existsSync(path.join(siteDir, "package.json"))) {
      startSiteDev(siteDir);
    }
  }

  console.log("");
  console.log("[Land] Quick start:");
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
    if (line) console.log(`[Site] ${line}`);
  });
  siteProcess.stderr.on("data", (data) => {
    const line = data.toString().trim();
    if (line && !line.includes("VITE")) console.error(`[Site] ${line}`);
  });
  siteProcess.on("close", (code) => {
    siteProcess = null;
    if (code && code !== 0)
      console.log(`[Site] Dev server exited (code ${code})`);
  });

  console.log("[Site] Vite dev server starting on port 5174...");
}
