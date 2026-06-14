// roots/seeds/catalog — the plantable catalog seed piece.
//
// Plants the catalog space and the registrar being at a position of
// the operator's choosing. The registrar OWNS the catalog space so
// its self-qualities writes authorize. Plant via:
//   do <space> plant-template-by-name { name: "roots:catalog" }

export default {
  kind:    "seed",
  name:    "catalog",
  version: "0.1.0",
  description:
    "The roots catalog: plants the catalog space, mints the registrar being, sets ownership so the registrar's self-qualities writes authorize.",
  requires: [
    { type: "role", ref: "roots:registrar" },
    { type: "code", ref: "roots"           },
  ],
};
