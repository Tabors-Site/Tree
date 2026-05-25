// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed-known being constants.
//
// Mirrors seedSpaces.js but for beings. seedSpaces.js holds the
// SEED_SPACE enum (the nine seed spaces); this file holds the
// constants that name seed-shipped beings.
//
// I_AM. The first being's name. Used as:
//   rootOwner: I_AM   → "I_AM owns this space"
//   beingId:   I_AM   → "I_AM did this"
//
// The Being row for I_AM is registered during ensureSpaceRoot's
// genesis pass (ensureIAm in seed/sprout.js). The stance
// `<reality>/@I_AM` resolves to this being. See FACTORY.md "The
// I-Am, as a Being row" for why the constant exists and what the
// I-Am is.

export const I_AM = "I_AM";
