// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Host-realm dev convenience. Not body forming, not senses opening.
//
// If SITE_DEV=true is set and a sibling site/ directory exists with
// its own package.json, this module spawns `npx vite --host` in that
// directory so the React landing/docs site runs alongside the Place
// server during development. Vite serves on its own port (5174) and
// has nothing to do with the I-Am's spaces, matter, or beings; the
// only reason it lives next to the Place process is to keep dev
// ergonomics tight.
//
// Production deployments do not set SITE_DEV. This module then
// does nothing.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "./seed/seedReality/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let siteProcess = null;

export function maybeStartSiteDev() {
  if (process.env.SITE_DEV !== "true") return;

  const siteDir = path.resolve(__dirname, "../site");
  if (!fs.existsSync(path.join(siteDir, "package.json"))) return;
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
