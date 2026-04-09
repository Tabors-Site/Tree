/**
 * Life
 *
 * Scaffolding library for domain trees. Pure machinery.
 * Sprout is the user-facing entry point. Life just builds what it's told.
 * Operators can use `life add <domain>` as an admin shortcut.
 */

import log from "../../seed/log.js";
import {
  scaffoldRoot,
  findLifeRoot,
  getDomainNodes,
  addDomain,
  getAvailableDomains,
} from "./core.js";

export async function init(core) {
  const { default: router } = await import("./routes.js");

  log.info("Life", "Loaded. Scaffolding library ready.");

  return {
    router,
    exports: {
      scaffoldRoot,
      findLifeRoot,
      getDomainNodes,
      addDomain,
      getAvailableDomains,
    },
  };
}
