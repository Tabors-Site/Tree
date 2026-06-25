// store/code — entry point for the store pack's code piece.
//
// Registers (auto-namespaced to store:<name> by scopedStory):
//   - store:delist   DO op (the operator's editorial lever; marks one
//                     version delisted, never deletes)
//
// The registrar and publisher ables register through the loader's
// able-kind handler (RESOURCES.md). The registrar's able.js imports
// handlers.js from this code piece when its summon needs to fire
// (the registrar's intent dispatcher pulls publishListing /
// retireListing from here). The catalog seed registers through the
// seed-kind handler.
//
// Doctrine: philosophy/OS/ROOTS.md. The catalog is the registrar's
// folded qualities; grafts are refused by construction (no intent
// exists for them); browsing is plain SEE on the spaces and matter
// the registrar keeps.

import log from "../../../seed/seedStory/log.js";
import delistOp from "./ops/delist.js";

export async function init(story) {
  story.do.registerOperation("delist", delistOp);
  log.verbose("Store", "registered: delist op");
  return {};
}
