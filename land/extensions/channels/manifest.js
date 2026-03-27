export default {
  name: "channels",
  version: "1.0.0",
  builtFor: "kernel",
  description:
    "Direct named signal paths between two specific nodes. Bypass the propagation " +
    "tree walk entirely. When /Health/Fitness and /Health/Food need to exchange " +
    "signals constantly, propagation walks the tree every time: up to parent, down " +
    "to sibling. Channels create a direct wire. Signal goes from Fitness to Food " +
    "in one hop. No tree walk. No intermediate nodes." +
    "\n\n" +
    "Channels are named. Multiple channels can exist between the same pair of nodes. " +
    "A 'nutrition-fitness' channel carries dietary data. A 'recovery' channel carries " +
    "rest and injury data. Different channels, different filters, same two endpoints." +
    "\n\n" +
    "Both propagation and channels use the same underlying deliverCascade kernel " +
    "function. Both write results to .flow. Both respect cascadeMaxDepth. The " +
    "difference is routing: propagation routes by tree structure, channels route by " +
    "explicit subscription. Channels registers its onCascade handler after propagation " +
    "so nearby nodes receive signals through the tree walk before distant partners " +
    "receive them through the shortcut." +
    "\n\n" +
    "Loop prevention: channel deliveries are tagged with _channel in the payload. " +
    "The onCascade handler skips any signal already carrying a _channel tag. One hop " +
    "only. Channel signals never re-enter the channel system. Same pattern as " +
    "mycelium's _myceliumRouted array preventing triangle loops." +
    "\n\n" +
    "Channel creation requires consent from both endpoints. Same-owner nodes on the " +
    "same land auto-accept. Different owners or cross-land channels require an " +
    "invitation signal that the receiving side accepts explicitly. Sovereignty preserved.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
    extensions: ["propagation"],
  },

  optional: {
    services: ["energy"],
    extensions: ["perspective-filter"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["onCascade", "enrichContext"],
    },

    cli: [
      {
        command: "channels [action]",
        description: "Direct signal paths. Actions: create, remove, status.",
        method: "GET",
        endpoint: "/node/:nodeId/channels",
        subcommands: {
          create: {
            method: "POST",
            endpoint: "/node/:nodeId/channels",
            description: "Create a named channel to another node",
            bodyMap: { target: 0, name: 1, direction: 2 },
          },
          remove: {
            method: "DELETE",
            endpoint: "/node/:nodeId/channels/:channelName",
            description: "Remove a channel",
          },
          status: {
            method: "GET",
            endpoint: "/node/:nodeId/channels/:channelName",
            description: "Signal stats on a channel",
          },
        },
      },
    ],
  },
};
