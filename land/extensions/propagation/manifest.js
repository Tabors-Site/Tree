export default {
  name: "propagation",
  version: "1.0.0",
  description: "Moves cascade signals through the tree. Walks children outward, delivers to peers cross-land, retries failures.",

  needs: {
    models: ["Node"],
  },

  optional: {
    extensions: [],
  },

  provides: {
    routes: false,
    tools: true,
    jobs: true,

    hooks: {
      fires: [],
      listens: ["onCascade"],
    },

    cli: [
      {
        command: "cascade [nodeId]",
        description: "Manually trigger a cascade signal at a node",
        method: "POST",
        endpoint: "/root/:rootId/cascade",
        body: ["nodeId"],
      },
    ],
  },
};
