import { refreshGovernance, checkExtensionUpdates } from "./core.js";

const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour
let intervalId = null;

export default [
  {
    name: "governance-refresh",
    start() {
      if (intervalId) return;
      intervalId = setInterval(async () => {
        try { await refreshGovernance(); } catch {}
        try { await checkExtensionUpdates(); } catch {}
      }, REFRESH_INTERVAL);
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  },
];
