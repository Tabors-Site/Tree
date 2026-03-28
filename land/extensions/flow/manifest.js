export default {
  name: "flow",
  version: "1.0.0",
  builtFor: "treeos-cascade",
  description:
    "Cascade is the kernel's nervous system. When content is written at a cascade-enabled " +
    "node, the kernel fires onCascade and stores the results in daily partition nodes under " +
    "the .flow system node. Those results accumulate quickly. The flow extension provides " +
    "the query layer that makes them useful by scoping results to the caller's current " +
    "position in the tree." +
    "\n\n" +
    "Position determines scope. At the land root, you see every cascade result across all " +
    "trees: the global view. At a tree root, you see results for every node in that tree, " +
    "gathered by walking all descendant IDs and filtering partitions to matching sources. " +
    "At any regular node, you see only results where that specific node was the cascade " +
    "source. This three-tier scoping means the same endpoint serves land operators reviewing " +
    "system-wide activity, tree owners reviewing their tree's cascade health, and users " +
    "inspecting why a particular node triggered or received a signal." +
    "\n\n" +
    "The stats endpoint exposes the internal partition structure: how many daily partitions " +
    "exist, the oldest and newest dates, today's signal count versus the daily cap, and the " +
    "configured result TTL. This gives operators visibility into cascade storage growth and " +
    "retention without touching the database directly. The CLI surfaces both endpoints: " +
    "\"flow\" shows scoped results for the current position, \"flow signal\" drills into a " +
    "single signal ID, and \"flow stats\" shows partition health. The core getFlowForPosition " +
    "function is exported so other extensions can query cascade results programmatically " +
    "without going through HTTP.",

  needs: {
    services: [],
    models: ["Node"],
  },

  optional: {
    extensions: ["html-rendering"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "flow [action] [args...]", scope: ["tree"],
        description: "Cascade flow scoped to current position. Actions: signal, stats.",
        method: "GET",
        endpoint: "/node/:nodeId/flow",
        subcommands: {
          "signal": { method: "GET", endpoint: "/flow/:signalId", args: ["signalId"], description: "Drill into one signal" },
          "stats": { method: "GET", endpoint: "/flow/stats", description: "Partition sizes, cap status" },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
