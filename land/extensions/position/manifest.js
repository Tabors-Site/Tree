// `position` — 2D coordinates for nodes, beings, and artifacts.
//
// Universal placement substrate. Owns `metadata.position` on any node
// (and `metadata.embodiments.<stance>.position` for AI beings on the
// land/tree root). Land plots, top-down maps, and 3D scenes all share
// this single coordinate system; renderers project however they like.
//
// Part of the treeos-place bundle alongside `scenes` and `models`.

export default {
  name: "position",
  version: "0.1.0",
  description:
    "2D coordinates for nodes, beings, and artifacts. Universal placement " +
    "substrate. Programs, beings, and users place things via `do place`, " +
    "`do place-being`, and `do place-artifact`.",

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
