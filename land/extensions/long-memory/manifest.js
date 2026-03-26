export default {
  name: "long-memory",
  version: "1.0.0",
  description:
    "The difference between a tree that forgets and a tree that remembers. .flow has resultTTL. " +
    "Active results expire. That is correct for working memory. But some information should survive " +
    "longer. Which nodes have talked to each other. When the last signal arrived. What the last " +
    "status was. The ghost of a connection. For each cascade result, writes a lightweight trace to " +
    "the involved nodes. metadata.memory.lastSeen with a timestamp. metadata.memory.lastStatus with " +
    "the status. metadata.memory.connections as a small rolling array of the last N interactions " +
    "with source IDs and timestamps. This is not the full payload. This is not the codebook. This " +
    "is just the trace. This node heard from that node three months ago. The last exchange succeeded. " +
    "They have talked 47 times total. Enough for the AI through enrichContext to know the " +
    "relationship exists and has a history. Enough for a signal arriving after years of silence to " +
    "land on a node that remembers something was here once. The traces live in metadata so they " +
    "survive transit, never expire unless deliberately deleted, and persist through land restarts, " +
    "extension reinstalls, and schema migrations.",

  needs: {
    models: ["Node"],
    extensions: ["propagation"],
  },

  optional: {},

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
        command: "memory [action]",
        description: "Cascade memory. No action shows trace at this node. Actions: clear, connections.",
        method: "GET",
        endpoint: "/node/:nodeId/memory",
        subcommands: {
          "clear": {
            method: "DELETE",
            endpoint: "/node/:nodeId/memory",
            description: "Wipe the trace. The node forgets its cascade history.",
          },
          "connections": {
            method: "GET",
            endpoint: "/node/:nodeId/memory/connections",
            description: "Full connection list with counts and timestamps",
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
