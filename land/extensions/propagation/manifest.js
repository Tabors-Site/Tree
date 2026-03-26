export default {
  name: "propagation",
  version: "1.0.0",
  description:
    "The foundation of the cascade network. Nothing else works without it. Listens to onCascade " +
    "and does the actual work of moving signals through the tree. When the kernel fires onCascade " +
    "because content was written at a node with metadata.cascade configured, propagation receives " +
    "the node, the content, and the direction. If the direction is outward, it walks children[] " +
    "downward, checking each child node for metadata.cascade to determine if it should continue " +
    "deeper. It respects cascadeMaxDepth from the kernel safety config. At each node it delivers " +
    "to, it writes a result to .flow using the kernel result shape. Succeeded if delivered. Failed " +
    "if something broke. Rejected if the node filters said no. For cross-land signals, it checks " +
    ".peers for active peer connections and sends through Canopy to peered lands. The receiving " +
    "land propagation extension picks it up from their side. Owns its own extension config in " +
    "metadata.propagation on the .config node: propagationTimeout, propagationRetries, and " +
    "defaultCascadeMode. These are not kernel configs. Different lands can have completely " +
    "different propagation behavior because the extension is replaceable.",

  needs: {
    services: ["hooks", "cascade"],
    models: ["Node"],
  },

  optional: {
    extensions: ["perspective-filter", "sealed-transport"],
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
