import { refreshGovernance } from "./core.js";

const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour
let intervalId = null;

export default {
  start() {
    if (intervalId) return;
    intervalId = setInterval(async () => {
      try {
        await refreshGovernance();
      } catch {
        // Governance refresh failures are non-fatal
      }
    }, REFRESH_INTERVAL);
  },
  stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  },
};
