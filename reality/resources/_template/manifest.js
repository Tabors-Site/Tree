// _template — canonical pack template (RESOURCES.md).
//
// Copy this folder to start a new pack:
//   cp -r story/resources/_template story/resources/<your-pack-name>
//
// Then rename the example pieces, fill in the manifests, and the
// loader will discover everything at boot (the leading underscore on
// _template makes the loader SKIP this folder, so the template never
// loads itself).
//
// Pack layout:
//   manifest.js            this file (kind: "pack")
//   README.md              your pack's docs
//   code/                  ONE code piece (init() registers ops, hooks,
//                          cognition handlers for role pieces)
//   roles/<each>/          MANY role pieces (one folder per role)
//   roleflows/<each>/      MANY roleflow pieces (one folder per flow)
//   seeds/<each>/          MANY seed pieces (one folder per seed bundle)
//   assets/<each>/         MANY asset pieces (one folder per asset bundle)
//
// Every kind is optional. A pack might be just-roles (like the
// emotions pack), code + roles + a seed (like roots), or any other
// combination. Drop the kind folders you don't need.

export default {
  kind:    "pack",
  name:    "my-pack",          // lowercase, hyphens only; the namespace pieces register under
  version: "1.0.0",            // semver
  description: "One sentence describing what this pack does.",

  // The pack's requires lists every piece it glues together. When the
  // resource graph's draw/install lands, drawing this pack pulls every
  // member of the closure by hash. For now (with pieces co-located on
  // disk), this documents what the pack covers.
  requires: [
    { type: "code",     ref: "my-pack"                  },
    { type: "role",     ref: "my-pack:example-role"     },
    { type: "roleflow", ref: "my-pack:example-flow"     },
    { type: "seed",     ref: "my-pack:example-seed"     },
    { type: "asset",    ref: "my-pack:example-asset"    },
  ],
};
