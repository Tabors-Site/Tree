/**
 * Life
 *
 * Choose your domains. The tree builds itself.
 * Life root scaffolds on registration. Domains scaffold on first use.
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

  // Scaffold Life root on user registration
  core.hooks.register("afterRegister", async ({ userId }) => {
    try {
      const existing = await findLifeRoot(userId);
      if (!existing) {
        // Scaffold the full Life tree with all available domains
        const domains = getAvailableDomains();
        if (domains.length > 0) {
          await scaffold({ selections: domains, singleTree: true, userId });
        } else {
          await scaffoldRoot(userId);
        }
      }
    } catch (err) {
      log.warn("Life", `Failed to scaffold Life tree on register: ${err.message}`);
    }
  }, "life");

  log.info("Life", "Loaded. Full Life tree scaffolds on registration.");

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
