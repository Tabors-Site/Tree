import router from "./routes.js";
import tools from "./tools.js";
import {
  startRawIdeaAutoPlaceJob,
  runRawIdeaAutoPlace,
} from "./autoPlaceJob.js";

let stopFn = null;

export async function init(core) {
  return {
    router,
    tools,
    jobs: [
      {
        name: "raw-idea-auto-place",
        start: () => {
          startRawIdeaAutoPlaceJob({ intervalMs: 15 * 60 * 1000 });
          stopFn = () => {
            // Job file manages its own timer internally
          };
        },
        stop: () => stopFn?.(),
      },
    ],
  };
}
