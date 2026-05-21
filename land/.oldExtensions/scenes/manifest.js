// `scenes` — which scene a node belongs to, and whether it's a doorway.
//
// Owns `metadata.scenes` on any node. A node with `doorway: true` is a
// scene boundary; its children render inside its own scene rather than
// the parent's. `sceneType` and `ambient` walk the parent chain via the
// existing ancestor cache and reset when crossing a doorway.
//
// Part of the treeos-place bundle alongside `position` and `models`.

export default {
  name: "scenes",
  version: "0.1.0",
  description:
    "Scene membership and doorway boundaries. Each scene has a type " +
    "(outdoor/indoor/abstract) and optional ambient state (sky, weather). " +
    "Determines whether two nodes share a scene for cross-scene portal logic.",

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
