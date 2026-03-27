import log from "../../seed/log.js";
import tools from "./tools.js";
import { setRunChat, generateDigest, getDigestConfig } from "./core.js";
import { getLandConfigValue } from "../../seed/landConfig.js";

let _jobTimer = null;

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setRunChat((opts) => core.llm.runChat({ ...opts, llmPriority: BG }));

  const { default: router } = await import("./routes.js");

  log.verbose("Digest", "Digest loaded");

  return {
    router,
    tools,
    jobs: [
      {
        name: "digest-daily",
        start: () => {
          // Check every hour if it's time to run the daily digest
          _jobTimer = setInterval(async () => {
            try {
              const config = await getDigestConfig();
              if (config.enabled === false) return;

              const now = new Date();
              const hour = now.getHours();
              const deliveryHour = config.deliveryHour ?? 7;

              // Run if current hour matches delivery hour
              if (hour !== deliveryHour) return;

              // Check if already ran today
              const { getLatestDigest } = await import("./core.js");
              const latest = await getLatestDigest();
              if (latest?.date === now.toISOString().slice(0, 10)) return;

              log.verbose("Digest", "Running daily digest");
              await generateDigest();
            } catch (err) {
              log.error("Digest", `Daily digest failed: ${err.message}`);
            }
          }, 60 * 60 * 1000); // check every hour
          if (_jobTimer.unref) _jobTimer.unref();
        },
        stop: () => {
          if (_jobTimer) {
            clearInterval(_jobTimer);
            _jobTimer = null;
          }
        },
      },
    ],
    exports: {
      generateDigest,
    },
  };
}
