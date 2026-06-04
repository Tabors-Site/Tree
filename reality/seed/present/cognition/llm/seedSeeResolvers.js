// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Foundational seed seeResolvers. The named sees every reality ships
// so roles can declare `canSee: ["place"]` or `canSee: ["roles"]` and
// get a focused view of the matter the heaven space already curates.
//
// A see is a perception in the moment's face. A role's canSee is a
// list of perceptions; each one resolves to a face block. An entry
// can be an IBP address (preloaded via seeVerb) OR a registered see
// name (preloaded via this registry). Same field, two shapes, same
// result: structured content the LLM already sees the instant its
// frame goes through inference.
//
// The seed sees registered here cover the heaven children every
// reality has at boot. They wrap seeVerb on the corresponding heaven
// address so the content is identical to the legacy `canSee:
// ["./roles"]` form; the name swap is doctrinal . roles declare
// perceptions by name, not by walking the address grammar.

import { registerSeeResolver } from "./seeResolvers.js";
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
  registerSeeResolver(name, async (ctx) => {
    const beingId = ctx?.being?._id ? String(ctx.being._id) : null;
    const address = `${getRealityDomain()}/./${name}`;
    try {
      return await seeVerb(address, {
        identity: beingId
          ? { beingId, name: ctx?.being?.name || null }
          : null,
      });
    } catch (err) {
      log.warn(
        "SeedSees",
        `see "${name}" (${address}) failed: ${err.message}`,
      );
      return null;
    }
  });
}

// "place" is the standard position projection. Returns the descriptor
// for wherever the being currently stands. Position-aware: every
// moment the being moves, the same "place" name resolves to a
// different descriptor. Replaces the older "this-space" resolver
// (which only returned the name) with the full position descriptor.
registerSeeResolver("place", async (ctx) => {
  const spaceId =
    (ctx?.being?.position && String(ctx.being.position)) ||
    ctx?.currentSpace ||
    ctx?.targetSpace ||
    ctx?.rootId ||
    null;
  if (!spaceId) return null;
  const beingId = ctx?.being?._id ? String(ctx.being._id) : null;
  const address = `${getRealityDomain()}/${spaceId}`;
  try {
    return await seeVerb(address, {
      identity: beingId
        ? { beingId, name: ctx?.being?.name || null }
        : null,
    });
  } catch (err) {
    log.warn("SeedSees", `see "place" (${address}) failed: ${err.message}`);
    return null;
  }
});
