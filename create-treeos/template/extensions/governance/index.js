import { getGovernanceState, refreshGovernance, checkExtensionUpdates, getExtensionUpdates } from "./core.js";
import buildTools from "./tools.js";
import jobs from "./jobs.js";

export async function init(core) {
  // Enrich AI context so land-manager always knows governance state
  // and available extension updates
  core.hooks.register("enrichContext", async ({ context, node }) => {
    // Only inject at land root (zone: land)
    if (node?.systemRole !== "land-root" && node?.systemRole) return;

    const state = getGovernanceState();
    if (state && state.directories.length > 0) {
      context.governance = state;
    }

    const updates = getExtensionUpdates();
    if (updates?.updates?.length > 0) {
      context.extensionUpdates = {
        count: updates.updates.length,
        available: updates.updates.slice(0, 5).map(u => `${u.name}: v${u.installed} -> v${u.available}`),
        checkedAt: updates.checkedAt,
      };
    }
  }, "governance");

  // Refresh governance data and extension updates after boot
  core.hooks.register("afterBoot", async () => {
    try {
      await refreshGovernance();
    } catch {
      // Non-fatal. Will retry on next hourly job cycle.
    }
    try {
      await checkExtensionUpdates();
    } catch {
      // Non-fatal.
    }
  }, "governance");

  const tools = buildTools();

  return {
    tools,
    jobs,
    modeTools: [
      { modeKey: "land:manager", toolNames: ["governance-status", "governance-check"] },
    ],
    exports: { getGovernanceState, refreshGovernance, checkExtensionUpdates, getExtensionUpdates },
  };
}
