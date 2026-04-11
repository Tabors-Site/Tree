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

  // Create a bare Life root on registration. No domains scaffolded.
  // Sprout handles domain creation from conversation.
  core.hooks.register("afterRegister", async ({ userId }) => {
    try {
      const existing = await findLifeRoot(userId);
      if (!existing) {
        await scaffoldRoot(userId);
      }
    } catch (err) {
      log.warn("Life", `Failed to create Life root on register: ${err.message}`);
    }
  }, "life");

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
