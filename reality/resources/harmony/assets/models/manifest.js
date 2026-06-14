// harmony/assets/models — visual models for harmony beings.
//
// Served at /assets/harmony/models/<file>. The portal resolves
// harmony's beings against this bundle's catalog (drum, drummer,
// dancer) via the synthetic manifest.json endpoint.

export default {
  kind:    "asset",
  name:    "models",
  version: "0.1.0",
  description: "Visual models for harmony beings: drum, drummer, dancer.",
  requires: [],
  files: {
    glb: {
      "drum":    "drum.glb",
      "drummer": "drummer.glb",
      "dancer":  "dancer.glb",
    },
  },
};
