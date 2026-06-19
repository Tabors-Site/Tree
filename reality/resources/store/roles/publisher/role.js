// store:publisher. The public role a being picks up to publish.
//
// Publishing requires an IDENTIFIED being, not an anonymous wire poke
// (philosophy/OS/ROOTS.md). The role attaches to a KEY, and how that
// key is PRESENT to the store is orthogonal to the role:
//
//   - NATIVE. The being lives here: born as a child (be its father), or
//     grafted in from a peer reality (identity preserved). Now local.
//   - FOREIGN. The being stays home and REACHES ACROSS in its left
//     stance, acting on the store over cross-reality IBP with its full
//     identity. It never moves; its key is simply granted the role here.
//     (The do:mate vessel-child is a further variant: a foreign reality
//     fathers a vessel here and acts through it.)
//
// The role does not care which. Whoever holds it, identified by key, may
// summon the registrar with the publish-listing / retire-listing
// intents, and the catalog attributes each listing to THAT key (publisher
// = key, never an anonymous domain string).
//
// An open store makes this role self-grantable (any identified being
// may take it); a curated store gates the grant behind operator review.
// Same role, one knob: who is allowed to hold it.
//
// The role grants only the REACH to summon the registrar. It writes
// nothing itself; the registrar is the sole catalog writer, and the
// registrar's immutability + publisher-key scoping are what actually
// protect the catalog. So this role is safe to hand out widely.

export const publisherRole = Object.freeze({
  name: "store:publisher",
  description:
    "Lets a being publish to this store's catalog. Hold it, then summon @registrar with intent publish-listing or retire-listing. Listings attribute to the holder's key.",
  // No requiredCognition: publishing is cognition-agnostic. An LLM being,
  // a scripted being, or a human all hold this role the same way.
  permissions: ["see", "call"],
  respondMode: "none",
  triggerOn: [],

  // The one capability beyond seeing identity: summon the catalog's
  // registrar. Names the registrar by being-name pattern; the
  // publish/retire intents ride the summon envelope.
  can: [
    { verb: "see", word: "identity" },
    { verb: "call", word: "@registrar", description: "Summon the store registrar to publish or retire a listing." },
  ],

  label: "Store Publisher",
});
