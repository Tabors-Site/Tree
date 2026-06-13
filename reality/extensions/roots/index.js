// TreeOS extension: horizon.
//
// init(reality) registers the registrar role (which writes the catalog
// into its own qualities, one self-authorized set-being per publish) and
// the operator's delist op. The catalog itself is planted structure:
// `do <space> plant-template-by-name { bundle: "horizon:catalog" }`
// creates the catalog space and its registrar being wherever the operator
// chooses.
//
// Doctrine: philosophy/OS/HORIZON.md. The catalog is the registrar's
// folded qualities (the directory being's state); grafts are refused by
// construction (no intent exists for them); browsing is SEE on the
// registrar.

import log from "../../seed/seedReality/log.js";
import delistOp from "./ops/delist.js";
import { registrarRole } from "./roles/registrar.js";

export async function init(reality) {
  // The operator's editorial lever (auto-namespaced to horizon:delist).
  reality.do.registerOperation("delist", delistOp);

  // The registrar role. Full namespaced name: the role registry does not
  // auto-prefix the first argument's already-qualified form.
  reality.declare.registerRole("horizon:registrar", registrarRole);

  log.verbose("Horizon", "registered: delist op, registrar role");
  return {};
}
