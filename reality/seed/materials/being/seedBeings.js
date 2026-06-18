// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed-known being constants.
//
// Mirrors heavenSpaces.js but for beings. heavenSpaces.js holds the
// HEAVEN_SPACE enum (the nine heaven spaces); this file holds the
// constants that name seed-shipped beings.
//
// I_AM. The first being's name AND id. Used as:
//   rootOwner: I_AM    → "I_AM owns this space"
//   beingId:   I_AM    → "I_AM did this"
//   _id:       I_AM    → the I-Am Being row's primary key
//   stance:    "<reality>/@i-am" → the I-Am addressable on the wire
//
// The Being row for I_AM is registered during ensureSpaceRoot's
// genesis pass (ensureIAm in seed/sprout.js). See FACTORY.md "The
// I-Am, as a Being row" for why the constant exists and what the
// I-Am is.
//
// The value is "i-am" (lowercase kebab) because the address grammar
// requires @qualifiers be kebab-case (lowercase letters + digits +
// hyphens). The symbol I_AM stays uppercase in code as the doctrinal
// reference; the string value matches the grammar so stance addresses
// like `<reality>/@i-am` parse cleanly without special-casing.

export const I_AM = "i-am";

// Identity shorthand. Verbs accept `identity: I_AM` (bare string) AND
// `identity: { beingId, name }` (the regular shape). assertVerbCaller
// normalizes the string form to `{ beingId: I_AM, name: I_AM }` at
// each verb entry, so internal code can keep reading `identity.beingId`
// / `identity.name` uniformly. Seed-internal calls that used to pass
// the retired `scaffold: true` flag now pass `identity: I_AM`. This
// is safe during genesis (when the I-Am Being row is still pending in
// moment.deltaF): authorize() short-circuits on
// `identity?.name === I_AM` without a DB read, and fact attribution
// just stamps the string. No lookup, no chicken-and-egg.
