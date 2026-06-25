// _template/assets/example-asset — asset piece manifest template.
//
// An asset piece ships bytes (models, sounds, textures, data files)
// the substrate mounts at a stable URL so beings can reference them.
// The loader's asset-kind handler reads the bundle directory and
// serves every file at /assets/<pack>/<bundle>/<file>.
//
// Example: with pack "my-pack" and bundle "example-asset", a file
// my-pack/assets/example-asset/cat.glb is served at
// /assets/my-pack/example-asset/cat.glb. Beings reference it as
// "my-pack:example-asset/cat" via the asset registry.
//
// Asset pieces have no executable code. They're pure content,
// hash-addressed by the lockfile so a published asset bundle's
// contents can't be silently swapped.

export default {
  kind:    "asset",
  name:    "example-asset",
  version: "1.0.0",
  description: "One sentence describing the asset bundle.",

  // External resources this bundle needs. Asset bundles usually
  // require nothing — they're standalone bytes.
  requires: [],

  // Optional: a manifest of the files this bundle ships, organized by
  // category. The loader serves every file under the bundle dir
  // regardless of whether it's listed here, but the catalog gives
  // consumers (the portal, other resources) a named lookup. Each entry
  // is a file path relative to the bundle dir (manifest.js excluded).
  files: {
    // models: {
    //   "cat":   "cat.glb",
    //   "tree":  "tree.glb",
    // },
    // sounds: {
    //   "ping":  "ping.mp3",
    // },
  },
};
