export default {
  name: "pulse",
  version: "1.0.0",
  builtFor: "treeos-cascade",
  description:
    "How the land knows its own health. Reads .flow on a timer, counts results by status, " +
    "tracks rates over time, and writes a health summary to a .pulse node under the land root. " +
    "The background job runs on a configurable interval (default 60 seconds), queries .flow for " +
    "all results since the last check, counts succeeded/failed/rejected/queued/partial/awaiting, " +
    "calculates failure rate, tracks which nodes produce the most failures, and tracks which " +
    "cross-land connections are healthy or degraded. The summary writes to .pulse as a note so " +
    "the AI can read it through enrichContext when asked about land health. The AI does not need " +
    "a dashboard. It reads the pulse node and tells you what is happening in natural language. " +
    "Also fires afterNote on the .pulse node so other extensions can react to health changes. " +
    "If failure rate spikes, another extension could pause cascade, alert the operator, or trigger " +
    "a compression run on overloaded trees.",

  needs: {
    models: ["Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "pulse [action]", scope: ["tree","land"],
        description: "Land health. No action shows latest snapshot. Actions: history, peers.",
        method: "GET",
        endpoint: "/pulse",
        subcommands: {
          "history": {
            method: "GET",
            endpoint: "/pulse/history",
            description: "Last 10 health snapshots. Trend view.",
          },
          "peers": {
            method: "GET",
            endpoint: "/pulse/peers",
            description: "Peer-specific health. Healthy, degraded, mixed.",
          },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
