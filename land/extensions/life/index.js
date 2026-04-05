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
      if (!existing) await scaffoldRoot(userId);
    } catch (err) {
      log.warn("Life", `Failed to scaffold Life root on register: ${err.message}`);
    }
  }, "life");

  log.info("Life", "Loaded. Life root scaffolds on registration. Domains scaffold on first use.");

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
