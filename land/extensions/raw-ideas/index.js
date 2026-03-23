import router from "./routes.js";
import tools from "./tools.js";
import {
  startRawIdeaAutoPlaceJob,
  runRawIdeaAutoPlace,
} from "./autoPlaceJob.js";

import chooseRoot from "./modes/chooseRoot.js";
import rawIdeaPlacement from "./modes/raw-idea-placement.js";

let stopFn = null;

export async function init(core) {
  // Register raw-idea modes
  core.modes.registerMode("home:raw-idea-choose-root", chooseRoot, "raw-ideas");
  core.modes.registerMode("home:raw-idea-placement", rawIdeaPlacement, "raw-ideas");

  return {
    router,
    tools,
    jobs: [
      {
        name: "raw-idea-auto-place",
        start: () => {
          startRawIdeaAutoPlaceJob({ intervalMs: 15 * 60 * 1000 });
          stopFn = () => {};
        },
        stop: () => stopFn?.(),
      },
    ],
  };
}
