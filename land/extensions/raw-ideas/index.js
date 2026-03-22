import router from "./routes.js";
import {
  startRawIdeaAutoPlaceJob,
  runRawIdeaAutoPlace,
} from "../../jobs/rawIdeaAutoPlace.js";

let stopFn = null;

export async function init(core) {
  return {
    router,
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
