// store/ables/publisher — the public publisher able piece.
//
// The able a being picks up to publish into the catalog. Held by a
// being whose key signs the listing claim; the registrar trusts the
// publisher key carried on the signed envelope. Pointer claims are
// signed by THAT publisher's key, not the operator's. Open vs
// curated store is one config on this able (self-grantable vs
// operator-gated), not two codepaths.

export default {
  kind:    "able",
  name:    "publisher",
  version: "0.1.0",
  description:
    "The public able a being takes to publish to the store catalog. The publisher's key signs the listing; the registrar trusts the signature.",
  requires: [],
};
