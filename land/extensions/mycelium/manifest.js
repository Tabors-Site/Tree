export default {
  name: "mycelium",
  version: "1.0.0",
  scope: "confined",
  description:
    "The intelligent underground network. Routes cascade signals between peered lands based on " +
    "observed need. Not a server. An extension any land can install to become a routing node. " +
    "Reads signal metadata and destination land profiles (extension lists from heartbeat, gap " +
    "detection data, evolution patterns) and makes intelligent routing decisions. A nutrition " +
    "signal from Land B routes to Land A because Land A has been flagging missing nutrition data. " +
    "It does not route to Land C because Land C has no relevant context. The router pays for its " +
    "own routing intelligence. The source pays for producing the signal. The destination pays for " +
    "processing it. Three levels: personal (your own trees), community (a lab or team), public " +
    "(infrastructure for the network). The most connected node knows the most about the network. " +
    ".flow is the water table. Canopy is trees reaching out. Mycelium is the forest underground.",

  needs: {
    services: ["llm", "hooks"],
    extensions: ["propagation"],
  },

  optional: {
    extensions: ["gap-detection", "evolution", "pulse", "perspective-filter", "codebook"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "mycelium [action]",
        description: "Mycelium routing status. Actions: routes, peers, health.",
        method: "GET",
        endpoint: "/mycelium",
        subcommands: {
          "routes": {
            method: "GET",
            endpoint: "/mycelium/routes",
            description: "Recent routing decisions with reasoning",
          },
          "peers": {
            method: "GET",
            endpoint: "/mycelium/peers",
            description: "Connected lands with profiles",
          },
          "health": {
            method: "GET",
            endpoint: "/mycelium/health",
            description: "Per-peer health assessment",
          },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["onCascade"],
    },
  },
};
