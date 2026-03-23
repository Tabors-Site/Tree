export default {
  name: "values",
  version: "1.0.0",
  description: "Numeric values and goals on nodes with tree wide accumulation",

  needs: {
    models: ["Node", "Contribution"],
  },

  optional: {
    extensions: ["energy"],
  },

  provides: {
    routes: "./routes.js",
    tools: "./tools.js",
    jobs: false,

    energyActions: {
      editValue: { cost: 1 },
      editGoal: { cost: 1 },
    },

    cli: [
      { command: "values", description: "Show values for current node", method: "GET", endpoint: "/node/:nodeId/values" },
      { command: "value <key> <value>", description: "Set a value on current node", method: "POST", endpoint: "/node/:nodeId/value" },
      { command: "goal <key> <goal>", description: "Set a goal for a value", method: "POST", endpoint: "/node/:nodeId/goal" },
    ],
    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
