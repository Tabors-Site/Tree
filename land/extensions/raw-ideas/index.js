import router from "./routes.js";
import tools from "./tools.js";
import {
  startRawIdeaAutoPlaceJob,
  stopRawIdeaAutoPlaceJob,
} from "./autoPlaceJob.js";
import { setEnergyService } from "./core.js";

import chooseRoot from "./modes/chooseRoot.js";
import rawIdeaPlacement from "./modes/raw-idea-placement.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  core.modes.registerMode("home:raw-idea-choose-root", chooseRoot, "raw-ideas");
  core.modes.registerMode("home:raw-idea-placement", rawIdeaPlacement, "raw-ideas");
  core.llm.registerUserLlmSlot?.("rawIdea");

  return {
    router,
    tools,
    jobs: [
      {
        name: "raw-idea-auto-place",
        start: () => startRawIdeaAutoPlaceJob({ intervalMs: 15 * 60 * 1000 }),
        stop: () => stopRawIdeaAutoPlaceJob(),
      },
    ],
  };
}
