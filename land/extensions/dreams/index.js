import {
  startTreeDreamJob,
  stopTreeDreamJob,
  runTreeDreamJob,
} from "./treeDream.js";
import router from "./routes.js";

export async function init(core) {
  return {
    router,
    jobs: [
      {
        name: "tree-dream",
        start: () => {
          startTreeDreamJob({ intervalMs: 30 * 60 * 1000 });
          // Run immediately on boot to catch any missed dreams
          runTreeDreamJob();
        },
        stop: () => stopTreeDreamJob(),
      },
    ],
  };
}
