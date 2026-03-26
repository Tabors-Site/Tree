export default {
  name: "gap-detection",
  version: "1.0.0",
  description:
    "Makes the tree know what it does not know. When cascade delivers a signal to a node, the " +
    "signal metadata may reference extension namespaces that the local land does not have " +
    "installed. Solana data arriving at a land without the solana extension. Understanding " +
    "summaries arriving at a land without the understanding extension. The data is in metadata " +
    "and the Mixed map preserves it, but nothing can act on it. Gap detection listens to " +
    "onCascade. After delivery, it inspects the signal metadata keys. It compares them against " +
    "the loaded extensions. For every metadata namespace that does not match a loaded extension, " +
    "it writes a gap record to the receiving node. metadata.gaps as an array of objects with the " +
    "namespace, when it was detected, and how many times signals with that namespace have arrived. " +
    "enrichContext injects gap information so the AI at that node can see it. The AI says: I have " +
    "received 15 signals with solana metadata but the solana extension is not installed on this " +
    "land. Would you like to install it? The tree recommends extensions based on what it is " +
    "actually receiving, not based on a curated store. Real demand from real data flowing through " +
    "the network.",

  needs: {
    models: ["Node"],
    extensions: ["propagation"],
  },

  optional: {
    extensions: ["perspective-filter"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [
      {
        command: "gaps [action]",
        description: "Extension gaps. No action shows gaps at this node. Actions: clear, land.",
        method: "GET",
        endpoint: "/node/:nodeId/gaps",
        subcommands: {
          "clear": {
            method: "DELETE",
            endpoint: "/node/:nodeId/gaps",
            description: "Clear gap records after installing the missing extension",
          },
          "land": {
            method: "GET",
            endpoint: "/gaps/land",
            description: "All gaps across the entire land, aggregated from every node",
          },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["onCascade", "enrichContext"],
    },
  },
};
