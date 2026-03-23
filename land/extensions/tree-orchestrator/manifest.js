export default {
  name: "tree-orchestrator",
  version: "1.0.0",
  description: "Built-in tree conversation orchestrator. Handles chat/place/query with intent classification, placement planning, and step execution.",

  needs: {
    models: ["Node"],
  },

  provides: {
    routes: false,
    tools: false,
    jobs: false,
  },
};
