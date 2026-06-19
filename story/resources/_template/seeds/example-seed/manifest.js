// _template/seeds/example-seed — seed piece manifest template.
//
// A seed piece ships ONE structural template in seed.json. The
// loader's seed-kind handler reads it and registers with the template
// registry under <pack>:<name>. Operators plant via:
//   do <space> plant-template-by-name { name: "my-pack:example-seed" }
//
// A seed PLANTS structure (spaces, matter, beings). It's distinct
// from a pack — a pack INSTALLS resources together; a seed
// materializes a shell world.

export default {
  kind:    "seed",
  name:    "example-seed",
  version: "1.0.0",
  description: "One sentence describing what this seed plants.",

  // Resources the seed expects to be present at plant time. The
  // template registry uses these to refuse-plant early if a
  // dependency is missing.
  requires: [
    // { type: "role", ref: "my-pack:example-role" },
    // { type: "code", ref: "my-pack"              },
  ],
};
