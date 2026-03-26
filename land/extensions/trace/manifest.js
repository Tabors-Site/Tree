export default {
  name: "trace",
  version: "1.0.0",
  description:
    "Follow a concept through the tree. Given a term or idea, trace finds every " +
    "node where it appears in notes, metadata, codebook entries, or contradiction " +
    "references. Returns a path showing how the concept flows through the structure. " +
    "Not search. Search finds matches. Trace follows connections. The concept entered " +
    "here, was referenced there, contradicted something over there, and ended up " +
    "absorbed into a compression at the far branch.",

  needs: {
    services: ["hooks", "llm"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: ["embed", "codebook", "contradiction", "long-memory"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
    hooks: { fires: [], listens: [] },
  },
};
