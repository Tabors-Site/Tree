// coders extension entry point.
//
// Registers the `coder` role (see/do permissions; minimal tools in v1)
// and exposes its seed via manifest.provides.seeds. The seed plants a
// governing-coder rulership at the target node.

import log from "../../seed/core/log.js";
import { registerRole } from "../../protocols/ibp/roles/registry.js";
import { coderRole } from "./roles/coderRole.js";

export async function init(_core) {
  // Register the coder role. The kernel mirrors mode-shape fields
  // (modeKey, buildSystemPrompt, toolNames) into the legacy mode
  // registry so runChat({ mode: "tree:coders-coder" }) keeps working
  // alongside runChat({ role: coderRole }).
  registerRole("coder", coderRole, "coders");

  log.info("Coders", "registered: 1 role (coder), 1 seed (coder:governing-coder)");

  return {
    exports: {
      coderRole,
    },
  };
}
