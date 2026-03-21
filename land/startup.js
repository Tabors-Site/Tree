import mongoose from "./db/config.js";
import { getLandIdentity } from "./canopy/identity.js";
import { ensureLandRoot } from "./core/landRoot.js";
import { initLandConfig } from "./core/landConfig.js";
import { startRawIdeaAutoPlaceJob } from "./jobs/rawIdeaAutoPlace.js";
import { startTreeDreamJob, runTreeDreamJob } from "./jobs/treeDream.js";
import { startHeartbeatJob } from "./canopy/peers.js";
import { startOutboxJob } from "./canopy/events.js";
import { startDirectoryRegistration } from "./canopy/directory.js";

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
        console.log(`[Land] Land node online. Listening on port ${PORT}`);
      })
      .catch((err) => {
        console.error("[Land] Discord bot startup scan failed:", err.message);
        console.log(`[Land] Land node online. Listening on port ${PORT}`);
      });
  };

  mongoose.connection.on("connected", onDbReady);
  if (mongoose.connection.readyState === 1) {
    onDbReady();
  }
}
