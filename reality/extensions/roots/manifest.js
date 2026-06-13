// TreeOS extension: roots.
//
// A reality grows roots when it runs this extension. Roots are the
// nodes of The Root System, the underground network where realities
// find each other and share resources (extensions, seeds, and the
// peer records that point at them). Browsing is SEE, publishing is
// DO, every publish or delist is a fact on a reel. See
// philosophy/OS/ROOTS.md for the doctrine.
//
// What this ships:
//   - role          roots:registrar (scripted; the catalog's writer.
//                   Holds the catalog in its own qualities; publishers
//                   reach it through publish-listing / retire-listing
//                   SUMMON intents)
//   - DO op         roots:delist (the operator's editorial lever; marks
//                   one version delisted, never deletes)
//   - seed          roots:catalog (plants the catalog space and the
//                   registrar being at a position of the operator's
//                   choosing; the registrar owns the catalog space so its
//                   self-qualities writes authorize)
//
// Operator workflow:
//   1. The extension loads at boot.
//   2. `do <space> plant-template-by-name { bundle: "roots:catalog" }`
//      plants the catalog and its registrar.
//   3. Peer realities publish by summoning the registrar with
//      intent "publish-listing"; browsing is plain SEE.

export default {
  name: "roots",
  version: "0.1.0",
  description:
    "Roots are the nodes of The Root System where realities find each other and share resources. This extension turns a reality into a Roots node: a catalog of resources (extensions and seeds), published by peer realities, served and mirrored by any reality that runs it.",

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
    // delisting is the operator's own act through roots:delist.
  },
};
