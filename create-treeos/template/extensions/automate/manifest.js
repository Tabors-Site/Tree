export default {
  name: "automate",
  version: "1.0.1",
  builtFor: "seed",
  description:
    "Flows. The tree acts on its own. " +
    "\n\n" +
    "Any node becomes a flow. Enable it, give it children, each child is a step. " +
    "Each step has a mode and a prompt. On every breath cycle, the extension runs them " +
    "in order. Step 1 result feeds step 2. Step 2 result feeds step 3. " +
    "\n\n" +
    "Any extension's mode works as a step. Browser-bridge reads a page. KB saves the key " +
    "points. Browser-bridge navigates to Reddit. Browser-bridge posts a comment using what " +
    "KB saved. Four steps. Four focused agents. One flow. Every 10 minutes. " +
    "\n\n" +
    "A fitness tree could have a flow that checks a nutrition API and logs meals. A study " +
    "tree could read documentation pages and create quiz questions. An evangelist tree " +
    "reads its own website, learns the talking points, browses communities, and engages. " +
    "The tree is the definition. The children are the steps. The breath is the clock. " +
    "\n\n" +
    "Each run logs a summary note on the flow node. Capped at 30. The tree remembers " +
    "what it did. Cadence is configurable per flow. Default 5 minutes. " +
    "Set metadata.automate.enabled = true on any node to activate.",

  needs: {
    services: ["hooks", "llm", "metadata", "tree"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: ["breath", "treeos-base"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [
      {
        command: "automate [action]",
        scope: ["tree"],
        description: "Enable/disable automation on the current node. Actions: enable, disable, status, run.",
        method: "GET",
        endpoint: "/automate?nodeId=:nodeId",
      },
    ],

    hooks: {
      fires: [],
      listens: ["breath:exhale"],
    },
  },
};
