export default {
  name: "coders",
  version: "0.1.0",
  builtFor: "TreeOS",
  description:
    "Code workers that see and write code artifacts at their scope. " +
    "The coders extension composes governing's rulership with a coder-" +
    "worker role: planting the `governing-coder` seed at a node bootstraps " +
    "a full governance structure (Ruler / Planner / Contractor / Foreman) " +
    "AND materializes a coder worker that the Foreman dispatches at leaf " +
    "build steps. " +
    "\n\n" +
    "Code artifacts under a coders-rulership are stored as Artifacts with " +
    "origin=filesystem; the substrate auto-syncs to the filesystem on " +
    "write so the operator's editor and the AI see the same source of " +
    "truth. This replaces the older code-workspace pattern where artifacts " +
    "lived in metadata and a separate sync layer kept the disk in sync — " +
    "with origin=filesystem, the artifact IS the file.",

  needs: {
    services: ["hooks", "tree"],
    models: ["Node", "Being", "Artifact"],
    extensions: ["governing"],
  },

  optional: {},

  provides: {
    routes: false,
    tools: true,
    jobs: false,

    // Plantable seed. Operators plant `coder:governing-coder` at a node
    // to bootstrap a rulership with a coder worker attached. See
    // seeds/governingCoder.js for the recipe.
    seeds: {
      "governing-coder": "./seeds/governingCoder.js",
    },

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
