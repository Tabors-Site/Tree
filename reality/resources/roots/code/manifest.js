// roots/code — the code piece of the roots pack (RESOURCES.md).
//
// Registers the delist DO op (auto-namespaced to roots:delist). The
// registrar's intent handlers live in handlers.js and are pulled in
// by roles/registrar/role.js when its summon fires.

export default {
  kind:    "code",
  // Pack name carries; scopedReality's auto-prefix writes roots:delist
  // for the DO op this piece registers.
  name:    "roots",
  pack:    "roots",
  version: "0.1.0",
  description:
    "Substrate code for the roots pack: registers the delist DO op and exports the publish-listing / retire-listing intent handlers the registrar role pulls in.",

  requires: [],

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
    hooks:  { fires: [], listens: [] },
    // Roles-are-auth: the registrar role's canDo IS its permission
    // surface (create-space / create-matter / set-matter inside its
    // host subtree). The operator grants nothing extra for publishing;
    // delisting is the operator's own act through roots:delist.
  },
};
