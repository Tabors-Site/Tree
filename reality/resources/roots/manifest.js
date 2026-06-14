// roots pack (RESOURCES.md).
//
// A reality grows roots when it runs this pack. Roots are the nodes of
// The Root System, the underground network where realities find each
// other and share resources (extensions, seeds, and the peer records
// that point at them). Browsing is SEE, publishing is DO, every
// publish or delist is a fact on a reel. See philosophy/OS/ROOTS.md
// for the doctrine.
//
// PACK CONTENTS:
//   code/                  — the substrate code (delist op + intent
//                            handlers for the registrar's summon)
//   roles/registrar/       — the catalog's writer (scripted; holds the
//                            catalog in its own qualities; publishers
//                            reach it through publish-listing /
//                            retire-listing SUMMON intents)
//   roles/publisher/       — the public role a being picks up to
//                            publish (auth via key, signed claims)
//   seeds/catalog/         — plants the catalog space and the
//                            registrar being at a position of the
//                            operator's choosing

export default {
  kind:    "pack",
  name:    "roots",
  version: "0.1.0",
  description:
    "The roots pack: catalog of resources (extensions and seeds), published by peer realities, served and mirrored by any reality that runs it. A reality plants this pack to become a Roots node in The Root System.",

  requires: [
    { type: "code", ref: "roots"             },
    { type: "role", ref: "roots:registrar"   },
    { type: "role", ref: "roots:publisher"   },
    { type: "seed", ref: "roots:catalog"     },
  ],
};
