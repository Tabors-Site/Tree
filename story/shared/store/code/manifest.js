// store/code — the code piece of the store pack (RESOURCES.md).
//
// Registers the delist DO op (auto-namespaced to store:delist). The
// registrar's intent handlers live in handlers.js and are pulled in
// by ables/registrar/able.js when its summon fires.

export default {
  kind:    "code",
  // Pack name carries; scopedStory's auto-prefix writes store:delist
  // for the DO op this piece registers.
  name:    "store",
  pack:    "store",
  version: "0.1.0",
  description:
    "Substrate code for the store pack: registers the delist DO op and exports the publish-listing / retire-listing intent handlers the registrar able pulls in.",

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
    // Ables-are-auth: the registrar able's canDo IS its permission
    // surface (create-space / create-matter / set-matter inside its
    // host subtree). The operator grants nothing extra for publishing;
    // delisting is the operator's own act through store:delist.
  },
};
