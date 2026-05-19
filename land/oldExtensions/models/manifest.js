// `models` — visual asset hints for nodes, beings, and artifacts.
//
// Owns `metadata.models` on any node, with `{ model, scale? }`. The
// `model` is a renderer asset hint ("oak-tree", "podium", "cottage",
// "ruler-figure"); the renderer interprets the name. Unknown models
// fall back to the renderer's default shape for the kind.
//
// Pure presentation — clients that ignore the visual layer can skip
// this extension entirely. Part of the treeos-place bundle alongside
// `position` and `scenes`.

export default {
  name: "models",
  version: "0.1.0",
  description:
    "Visual model hints for nodes, beings, and artifacts. Renderer " +
    "interprets the named asset; unknown names fall back to defaults.",

  needs: {
    services: [],
    models: ["Node"],
    extensions: [],
  },

  optional: {
    services: [],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],
  },
};
