export default {
  name: "values",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "Not everything in a tree is text. Some things are numbers. Revenue, hours logged, calories, " +
    "word count, completion percentage, test coverage, budget remaining. Values attaches named " +
    "numeric key-value pairs to any node. Goals attaches target numbers to those same keys. " +
    "Together they answer two questions at any position in the tree: where are we, and where " +
    "are we trying to get." +
    "\n\n" +
    "Values accumulate upward. The tree-wide endpoint walks from root through every descendant, " +
    "summing values at each level. A root node with three project branches shows the total " +
    "hours across all projects without anyone manually adding them. Each node reports both " +
    "local values (what was set directly on this node) and total values (local plus all " +
    "descendants). The flat summary at the root shows every value key and its tree-wide sum." +
    "\n\n" +
    "Keys are case-insensitive and merge automatically. If one node has Revenue and another " +
    "has revenue, they accumulate together. Keys starting with _auto are reserved for system " +
    "use and cannot be set by users. Values are truncated to six decimal places. Goals must " +
    "reference an existing value key. You cannot set a goal for a key that has no value yet." +
    "\n\n" +
    "enrichContext injects values and goals at every node so the AI knows the quantitative " +
    "state. The AI at a node with budget: 5000 and a goal of budget: 10000 understands " +
    "progress without asking. When prestige fires, it resets all values to zero through the " +
    "exported setValueForNode function. The previous values live in the prestige snapshot. " +
    "The new version starts counting from scratch.",

  needs: {
    services: ["contributions", "hooks"],
    models: ["Node"],
  },

  optional: {
    extensions: ["energy", "html-rendering", "treeos-base"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    sessionTypes: {},

    energyActions: {
      editValue: { cost: 1 },
      editGoal: { cost: 1 },
    },

    cli: [
      { command: "values", scope: ["tree"], description: "Show values for current node", method: "GET", endpoint: "/node/:nodeId/values" },
      { command: "value <key> <value>", scope: ["tree"], description: "Set a value on current node", method: "POST", endpoint: "/node/:nodeId/value" },
      { command: "goal <key> <goal>", scope: ["tree"], description: "Set a goal for a value", method: "POST", endpoint: "/node/:nodeId/goal" },
    ],
    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
