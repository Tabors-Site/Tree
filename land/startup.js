import mongoose from "./db/config.js";
import { getLandIdentity } from "./canopy/identity.js";
import { ensureLandRoot } from "./core/landRoot.js";
import { initLandConfig } from "./core/landConfig.js";
import { startRawIdeaAutoPlaceJob } from "./jobs/rawIdeaAutoPlace.js";
import { startTreeDreamJob, runTreeDreamJob } from "./jobs/treeDream.js";
import { startHeartbeatJob } from "./canopy/peers.js";
import { startOutboxJob } from "./canopy/events.js";
import { startDirectoryRegistration } from "./canopy/directory.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function onListen(PORT) {
  const land = getLandIdentity();
  console.log("[Land] Initializing Tree Land Node...");
  console.log(`[Land] Domain: ${land.domain}`);
  console.log(`[Land] Name: ${land.name}`);
  console.log(`[Land] Land ID: ${land.landId}`);
  console.log(`[Land] Canopy Protocol Version: ${land.protocolVersion}`);

  startRawIdeaAutoPlaceJob({ intervalMs: 15 * 60 * 1000 });
  startTreeDreamJob({ intervalMs: 30 * 60 * 1000 });

  const onDbReady = async () => {
    console.log("[Land] MongoDB connected");
    await ensureLandRoot();
    await initLandConfig();
    runTreeDreamJob();
    console.log("[Land] Background jobs started (dream, drain, cleanup, understanding)");

    startHeartbeatJob();
    startOutboxJob();
    startDirectoryRegistration();
    console.log("[Land] Canopy API ready");

    import("./core/gateway/discordBotManager.js")
      .then(({ startupScan }) => {
        startupScan();
        console.log("[Land] Gateway scan complete");
        printReady(PORT);
      })
      .catch((err) => {
        console.error("[Land] Discord bot startup scan failed:", err.message);
        printReady(PORT);
      });
  };

  mongoose.connection.on("connected", onDbReady);
  if (mongoose.connection.readyState === 1) {
    onDbReady();
  }
}

let siteProcess = null;

function printReady(PORT) {
  const land = getLandIdentity();
  const protocol = land.domain === "localhost" || land.domain.startsWith("localhost") ? "http" : "https";
  const portSuffix = (PORT !== 80 && PORT !== 443 && PORT !== "80" && PORT !== "443") ? `:${PORT}` : "";
  const apiUrl = `${protocol}://${land.domain}${portSuffix}`;

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
  console.log("  treeos login --key YOUR_API_KEY");
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
    if (code && code !== 0) console.log(`[Site] Dev server exited (code ${code})`);
  });

  console.log("[Site] Vite dev server starting on port 5174...");
}
