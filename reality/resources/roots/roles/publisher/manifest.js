// roots/roles/publisher — the public publisher role piece.
//
// The role a being picks up to publish into the catalog. Held by a
// being whose key signs the listing claim; the registrar trusts the
// publisher key carried on the signed envelope. Pointer claims are
// signed by THAT publisher's key, not the operator's. Open vs
// curated roots is one config on this role (self-grantable vs
// operator-gated), not two codepaths.

export default {
  kind:    "role",
  name:    "publisher",
  version: "0.1.0",
  description:
    "The public role a being takes to publish to the roots catalog. The publisher's key signs the listing; the registrar trusts the signature.",
  requires: [],
};
