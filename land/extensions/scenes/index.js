// `scenes` — scene membership and doorway boundaries.
//
// Owns `metadata.scenes` on any node:
//   { doorway: bool, sceneType: string, ambient: { ... } }
//
// Reads happen via the resolver, which walks the ancestor chain and
// stops at the nearest doorway. Writes happen via the generic
// `do set-meta { namespace: "scenes" }` path.

import log from "../../seed/log.js";
import { resolveScene, nodeIsDoorway, inSameScene, deriveScene } from "./resolver.js";

export async function init(_core) {
  log.info("Scenes", "loaded");

  return {
    exports: {
      getScene:        resolveScene,
      isDoorway:       nodeIsDoorway,
      areInSameScene:  inSameScene,
      deriveScene,
    },
  };
}
