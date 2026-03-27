import { getGovernanceState, refreshGovernance } from "./core.js";
import buildTools from "./tools.js";
import jobs from "./jobs.js";

export async function init(core) {
  // Enrich AI context so land-manager always knows governance state
  core.hooks.register("enrichContext", async ({ context }) => {
    const state = getGovernanceState();
    if (state && state.directories.length > 0) {
      context.governance = state;
    }
  }, "governance");

  // Refresh governance data after boot
  core.hooks.register("afterBoot", async () => {
    try {
      await refreshGovernance();
    } catch {
      // Non-fatal. Will retry on next hourly job cycle.
    }
  }, "governance");

  const tools = buildTools();

  return {
    tools,
    jobs,
    modeTools: [
      { modeKey: "land:manager", toolNames: ["governance-status", "governance-check"] },
    ],
    exports: { getGovernanceState, refreshGovernance },
  };
}
