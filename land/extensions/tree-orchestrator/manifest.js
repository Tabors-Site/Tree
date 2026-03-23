export default {
  name: "tree-orchestrator",
  version: "1.0.0",
  description: "Core conversation orchestrator. Handles chat, place, and query with intent classification and step execution.",

  needs: {
    models: ["Node"],
  },

  provides: {
    routes: false,
    tools: false,
    jobs: false,
  },
};
