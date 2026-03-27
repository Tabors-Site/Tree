export default {
  name: "prestige",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Nodes do not just accumulate forever. At some point the current phase of work is done. The " +
    "budget was met. The sprint shipped. The chapter was written. Prestige closes the book on the " +
    "current version and opens a new one. When you prestige a node, the extension snapshots " +
    "everything: status, values, goals, schedule, reeffect time. That snapshot goes into the " +
    "prestige history array. Then it resets. Values go to zero. Status returns to active. The " +
    "schedule advances by the reeffect interval. The version counter increments. The node starts " +
    "fresh with a clean slate, but the full record of every previous version is preserved in " +
    "metadata.prestige.history." +
    "\n\n" +
    "Every note written to a prestiged node is tagged with the version number at time of writing " +
    "via the beforeNote hook. Every contribution is stamped with the current version via " +
    "beforeContribution. This means you can query the full history of a node and see exactly " +
    "which version each piece of content and each action belonged to. Notes from version 2 are " +
    "distinguishable from notes in version 5." +
    "\n\n" +
    "Cross-extension coordination happens through the extension loader. When prestige resets " +
    "values, it calls the values extension's setValueForNode export, not a direct metadata " +
    "write. When it advances the schedule, it calls the schedules extension's updateSchedule " +
    "export. If those extensions are not installed, those resets simply do not happen. The " +
    "prestige itself still works. enrichContext injects the current version number and total " +
    "version count so the AI always knows what generation it is working in.",

  needs: {
    services: ["contributions", "hooks"],
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
    extensions: ["values", "schedules"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      prestige: { cost: 1 },
    },
    sessionTypes: {},
    cli: [
      { command: "prestige", description: "Add new version to current node", method: "POST", endpoint: "/node/:nodeId/prestige" },
    ],
    hooks: {
      fires: [],
      listens: ["beforeNote", "beforeContribution", "enrichContext"],
    },
  },
};
