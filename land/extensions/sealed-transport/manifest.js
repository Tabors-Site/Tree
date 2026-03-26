export default {
  name: "sealed-transport",
  version: "1.0.0",
  description:
    "Handles the pass-through mode for signals that should arrive unchanged. When a cascade " +
    "signal has its mode set to sealed in its metadata.cascade configuration or when the signal " +
    "itself carries a sealed flag, propagation calls into sealed transport instead of normal " +
    "delivery. Normal delivery lets extensions inject context at each intermediary node. Sealed " +
    "delivery skips that at intermediary nodes. The signal passes through untouched. Intermediary " +
    "nodes can see in .flow that something passed through them. They cannot see the payload. They " +
    "can still gate or block at their extension scope level because that is a kernel behavior, not " +
    "an enrichment behavior. At the destination node, sealed transport unwraps and delivers " +
    "normally. The AI sees the full payload. The signal survived the path intact. Important for " +
    "cross-land communication where intermediary trees should not modify in-transit data. Also " +
    "important for private conversations between two specific nodes where the path between them " +
    "passes through shared tree space. Exports a deliveryMode function that propagation checks. " +
    "If sealed, propagation skips enrichment at intermediary hops. One function. One check.",

  needs: {
    models: [],
    extensions: ["propagation"],
  },

  optional: {},

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
        command: "seal [action]",
        description: "Sealed transport. No action shows seal status. Actions: on, off.",
        method: "GET",
        endpoint: "/node/:nodeId/seal",
        subcommands: {
          "on": {
            method: "POST",
            endpoint: "/node/:nodeId/seal/on",
            description: "Set cascade mode to sealed at this position",
          },
          "off": {
            method: "POST",
            endpoint: "/node/:nodeId/seal/off",
            description: "Set cascade mode to open",
          },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
