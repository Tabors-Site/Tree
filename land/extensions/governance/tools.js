import { getGovernanceState, refreshGovernance } from "./core.js";

export default function buildTools() {
  return [
    {
      name: "governance-status",
      description:
        "Show governance status for this land. " +
        "Returns current seed version, each directory's governance policy, " +
        "and compatibility status (compliant, advisory, non_compliant, no_policy, unreachable).",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const state = getGovernanceState();
        if (!state || state.directories.length === 0) {
          return {
            content: [{ type: "text", text: "No governance data available. No directories configured or data not yet fetched." }],
          };
        }

        const lines = [`Seed version: ${state.currentSeedVersion}`, `Overall status: ${state.summary}`, ""];

        for (const d of state.directories) {
          lines.push(`Directory: ${d.url}`);
          lines.push(`  Status: ${d.status}`);
          if (d.minimumSeedVersion) lines.push(`  Minimum version: ${d.minimumSeedVersion}`);
          if (d.recommendedSeedVersion) lines.push(`  Recommended version: ${d.recommendedSeedVersion}`);
          lines.push(`  Last checked: ${d.lastChecked}`);
          lines.push("");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      },
    },
    {
      name: "governance-check",
      description:
        "Force a fresh governance check against all configured directories. " +
        "Bypasses cache and returns real-time data.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const state = await refreshGovernance();
        if (!state || state.directories.length === 0) {
          return {
            content: [{ type: "text", text: "No directories configured. Set HORIZON_URL to enable governance checks." }],
          };
        }

        const lines = [`Seed version: ${state.currentSeedVersion}`, `Overall status: ${state.summary}`, ""];

        for (const d of state.directories) {
          lines.push(`Directory: ${d.url}`);
          lines.push(`  Status: ${d.status}`);
          if (d.minimumSeedVersion) lines.push(`  Minimum version: ${d.minimumSeedVersion}`);
          if (d.recommendedSeedVersion) lines.push(`  Recommended version: ${d.recommendedSeedVersion}`);
          lines.push(`  Last checked: ${d.lastChecked}`);
          lines.push("");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      },
    },
  ];
}
