// TreeOS extension: horizon.
//
// The public directory as an extension (philosophy/OS/HORIZON.md).
// A horizon is not a standalone server: it is any reality that runs
// this extension. The catalog is spaces and matter, publishers are
// peer realities, and every publish or delist is a fact on a reel.
//
// What this ships:
//   - role          horizon:registrar (scripted; the catalog's writer.
//                   Holds the catalog in its own qualities; publishers
//                   reach it through publish-listing / retire-listing
//                   SUMMON intents)
//   - DO op         horizon:delist (the horizon operator's editorial
//                   lever; marks one version delisted, never deletes)
//   - seed          horizon:catalog (plants the catalog space and the
//                   registrar being at a position of the operator's
//                   choosing; the registrar owns the catalog space so its
//                   self-qualities writes authorize)
//
// Operator workflow:
//   1. The extension loads at boot.
//   2. `do <space> plant-template-by-name { bundle: "horizon:catalog" }`
//      plants the catalog and its registrar.
//   3. Peer realities publish by summoning the registrar with
//      intent "publish-listing"; browsing is plain SEE.

export default {
  name: "horizon",
  version: "0.1.0",
  description:
    "The public directory: a catalog of extensions and seeds, published by peer realities, served and mirrored by any reality that runs it.",

  needs: {
    services:   ["see", "do", "summon", "be", "qualities", "models", "declare"],
    models:     ["Space", "Being", "Matter"],
    extensions: [],
  },

  optional: { services: [], extensions: [] },

  provides: {
    routes: false,
    tools:  false,
    jobs:   false,
    env:    [],
    cli:    [],
    seeds: {
      catalog: "./seeds/catalog.seed.json",
    },
    hooks: { fires: [], listens: [] },
    // Roles-are-auth: the registrar role's canDo IS its permission
    // surface (create-space / create-matter / set-matter inside its
    // host subtree). The operator grants nothing extra for publishing;
    // delisting is the operator's own act through horizon:delist.
  },
};
