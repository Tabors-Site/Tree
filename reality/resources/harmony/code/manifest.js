// harmony/code — the code piece of the harmony pack (RESOURCES.md).

export default {
  kind:    "code",
  // The code piece carries the pack's name so scopedReality's
  // auto-prefix rule writes "harmony:tick" / "harmony:neighbors" / etc.
  // The pack itself ALSO has name: "harmony" — different kinds,
  // distinct registries, no collision.
  name:    "harmony",
  pack:    "harmony",
  version: "0.1.0",
  description:
    "Substrate code for the harmony pack: three DO ops (tick / step / walk) and the neighbors SEE op preloaded for dancer-llm.",

  requires: [],

  needs: {
    services: ["do", "declare"],
  },

  optional: {
    services: [],
  },

  provides: {
    // DO operations this piece registers. The loader auto-namespaces
    // each name to <pack>:<name> at registration; here we list the
    // bare local names so an operator reading the manifest sees the
    // pack's command surface at a glance. Each entry's `target`
    // documents what the op acts on; the loader doesn't gate on it.
    do: [
      { name: "tick", target: "matter", description: "Drummer stamps the beat on the drum." },
      { name: "step", target: "being",  description: "Dancer's step . a set-being:coord wrapper." },
      { name: "walk", target: "being",  description: "Animation-tagged walk for the portal mixer." },
    ],

    // SEE operations this piece registers. Same shape as `do`. The
    // neighbors op preloads the dancer-llm's local neighborhood face
    // (beings + obstacles within reach of the dancer's coord).
    see: [
      { name: "neighbors", description: "The dancer's local neighborhood: beings + obstacles." },
    ],

    hooks: { fires: [], listens: [] },

    // Assets ship as their own pieces under harmony/assets/<bundle>/
    // (kind: "asset"). The asset-kind handler mounts each bundle at
    // /assets/harmony/<bundle>/. The code piece doesn't carry an
    // `assets` block anymore — assets travel as resources, not as
    // code-piece appendages.
  },
};
