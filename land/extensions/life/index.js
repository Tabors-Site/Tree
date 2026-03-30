/**
 * Life
 *
 * Choose your domains. The tree builds itself.
 * A one-time scaffolder. Plants seeds. Hands off.
 */

import log from "../../seed/log.js";

export async function init(core) {
  const { default: router } = await import("./routes.js");

  log.info("Life", "Loaded. Run 'life' to set up your domains.");

  return {
    router,
    exports: {},
  };
}
