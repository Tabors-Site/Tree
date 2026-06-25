// store/ables/registrar — the catalog's writer able piece.
//
// Scripted cognition. The able.js carries an inline `summon` that
// classifies the incoming intent (publish-listing / retire-listing)
// and delegates to handlers.js in the code piece. The able's spec
// already declares its full name (store:registrar); the loader's
// able-kind handler preserves it.

export default {
  kind:    "able",
  name:    "registrar",
  version: "0.1.0",
  description:
    "The store catalog's writer. Handles publish-listing and retire-listing SUMMONs from publisher realities; keeps the catalog in its own qualities as immutable versions under chained name pointers.",
  requires: [
    // Pulls in handlers.js for the intent dispatcher.
    { type: "code", ref: "store" },
  ],
};
