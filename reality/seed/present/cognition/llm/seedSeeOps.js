// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Foundational seed SEE ops. The named perceptions every reality
// ships so roles can declare canSee: ["place"], canSee: ["roles"],
// etc. and get a focused view of the matter the heaven space already
// curates.
//
// Registered through the unified seeOps registry (seed/ibp/seeOps.js)
// — same surface as extension-supplied SEE ops, no privileged path.
//
// Two flavors here:
//   - heaven catalogs (roles / tools / operations / identity / config
//     / peers / extensions) — each wraps seeVerb on the corresponding
//     heaven address. Returns the descriptor that address would render.
//   - "place" — the position projection. Returns the descriptor for
//     wherever the being currently stands. Position-aware: every
//     moment the being moves, the same "place" name resolves to a
//     different descriptor.
//
// Naming. All are bare names (seed-owned). Extensions register SEE
// ops under "<ext>:<name>".

import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { seeVerb } from "../../../ibp/verbs/see.js";
import { getRealityDomain } from "../../../ibp/address.js";
import log from "../../../seedReality/log.js";

const HEAVEN_SEES = [
  "roles",
  "tools",
  "operations",
  "identity",
  "config",
  "peers",
  "extensions",
];

for (const name of HEAVEN_SEES) {
  registerSeeOperation(name, {
    ownerExtension: "seed",
    description: `Heaven catalog: ${name}`,
    handler: async ({ identity }) => {
      const address = `${getRealityDomain()}/./${name}`;
      try {
        return await seeVerb(address, {
          identity: identity || null,
        });
      } catch (err) {
        log.warn(
          "SeedSees",
          `see "${name}" (${address}) failed: ${err.message}`,
        );
        return null;
      }
    },
  });
}

// "place" — the general position projection. Returns the descriptor
// for wherever the being currently stands. This is the canonical
// "general place see that shows everything" that other SEE ops can
// build on (chopping it up, filtering, etc.).
registerSeeOperation("place", {
  ownerExtension: "seed",
  description: "Position descriptor — where this being currently stands",
  handler: async ({ identity, ctx }) => {
    const spaceId =
      (ctx?.being?.position && String(ctx.being.position)) ||
      ctx?.currentSpace ||
      ctx?.targetSpace ||
      ctx?.rootId ||
      null;
    if (!spaceId) return null;
    const address = `${getRealityDomain()}/${spaceId}`;
    try {
      return await seeVerb(address, {
        identity: identity || (ctx?.being?._id
          ? { beingId: String(ctx.being._id), name: ctx?.being?.name || null }
          : null),
      });
    } catch (err) {
      log.warn("SeedSees", `see "place" (${address}) failed: ${err.message}`);
      return null;
    }
  },
});
