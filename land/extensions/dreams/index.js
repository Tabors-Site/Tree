import {
  startTreeDreamJob,
  stopTreeDreamJob,
  runTreeDreamJob,
} from "../../jobs/treeDream.js";

export async function init(core) {
  return {
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
