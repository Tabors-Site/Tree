export default {
  name: "seed-export",
  version: "1.0.0",
  builtFor: "kernel",
  description:
    "Export a tree's form without its content. The skeleton: node hierarchy, cascade " +
    "configuration, extension scoping, persona definitions, perspective filters, mode " +
    "overrides, tool configs. Everything that defines HOW the tree works. Not the notes. " +
    "Not the conversations. Not the contribution history. The DNA." +
    "\n\n" +
    "Another land imports the seed file and grows a replica with the same shape, same " +
    "cascade topology, same scoping rules, same personas. But empty. Ready for new " +
    "content. Knowledge transfer through structure replay, not content copy." +
    "\n\n" +
    "The rule: structural metadata that defines behavior is exported. Accumulated data " +
    "metadata that was generated through use is not. If removing it breaks nothing about " +
    "how the tree operates, it is accumulated data. If removing it changes what the AI " +
    "can do or how signals flow, it is structural. Seven namespaces pass the filter: " +
    "cascade, extensions, tools, modes, persona, perspective, purpose. Everything else " +
    "is excluded: codebook dictionaries, evolution metrics, long-memory connections, " +
    "embed vectors, compress essences, inverse-tree profiles, contradiction state, " +
    "prune candidates, explore maps, scout history." +
    "\n\n" +
    "Delegation boundaries are preserved. If a branch had a delegated owner, the seed " +
    "records that structure without carrying the actual userIds (those users do not exist " +
    "on the target land). The new operator fills the delegation placeholders after planting." +
    "\n\n" +
    "Optional cascade topology export summarizes signal flow patterns: which nodes " +
    "originated signals, which received them, through which paths. Not the actual .flow " +
    "results. A structural summary so the planting land understands the intended " +
    "information flow." +
    "\n\n" +
    "Three operations. Export walks the tree and produces a JSON seed file. Analyze reads " +
    "a seed file without planting and reports node count, depth, required extensions, and " +
    "which are missing on this land. Plant creates the full node hierarchy with structural " +
    "metadata applied, rootOwner set to the planting user, and warnings for any missing " +
    "extensions whose metadata is preserved but inactive until installed.",

  needs: {
    services: ["hooks", "contributions"],
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
    extensions: ["propagation"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      seedExport: { cost: 1 },
      seedPlant: { cost: 2 },
    },
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: [],
    },

    cli: [
      {
        command: "seed-export [action]",
        description: "Export and plant tree skeletons. Actions: analyze.",
        method: "GET",
        endpoint: "/node/:nodeId/seed-export",
        subcommands: {
          analyze: {
            method: "POST",
            endpoint: "/seed/analyze",
            description: "Analyze a seed file before planting",
          },
        },
      },
    ],
  },
};
