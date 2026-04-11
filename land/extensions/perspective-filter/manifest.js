export default {
  name: "perspective-filter",
  version: "1.0.1",
  builtFor: "treeos-cascade",
  description:
    "What keeps cascade from being noise. Without it, every signal hits every node. With it, each " +
    "node and each tree declares what it wants to receive. Stores configuration in metadata.perspective " +
    "on any node. The simplest version is a list of accepted and rejected topic tags. A music tree " +
    "sets perspective to accept signals tagged with music and creativity and reject fitness and finance. " +
    "Propagation calls into perspective filter before delivering at each hop. Exports shouldDeliver(node, " +
    "signal) that propagation imports through the extension dependency system. Propagation works without " +
    "perspective. Perspective is useless without propagation. Perspective filters inherit down the tree " +
    "unless overridden. If the root of a tree sets a perspective, every node below inherits it unless " +
    "that node sets its own. This uses the same pattern as extension scoping, walking the parent chain " +
    "and taking the closest override. The AI can modify perspective filters through tools. Set a branch " +
    "to deep focus, mute everything except understanding signals. The AI writes to metadata.perspective " +
    "on that node. Done. The filter is live.",

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
        command: "perspective [action] [args...]", scope: ["tree"],
        description: "Perspective filter. No action shows effective filter. Actions: set, clear, test.",
        method: "GET",
        endpoint: "/node/:nodeId/perspective",
        subcommands: {
          "set": {
            method: "POST",
            endpoint: "/node/:nodeId/perspective",
            description: "Set accept/reject lists. Pass accept and reject arrays in body.",
          },
          "clear": {
            method: "DELETE",
            endpoint: "/node/:nodeId/perspective",
            description: "Remove override, fall back to parent perspective",
          },
          "test": {
            method: "POST",
            endpoint: "/node/:nodeId/perspective/test",
            args: ["signal"],
            description: "Dry run: does this signal pass the filter here?",
          },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
