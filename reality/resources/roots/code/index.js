// TreeOS extension: roots.
//
// init(reality) registers the registrar role (which writes the catalog
// into its own qualities, one self-authorized set-being per publish) and
// the operator's delist op. The catalog itself is planted structure:
// `do <space> plant-template-by-name { bundle: "roots:catalog" }`
// creates the catalog space and its registrar being wherever the operator
// chooses.
//
// Doctrine: philosophy/OS/ROOTS.md. The catalog is the registrar's
// folded qualities (the directory being's state); grafts are refused by
// construction (no intent exists for them); browsing is SEE on the
// registrar.

import log from "../../seed/seedReality/log.js";
import delistOp from "./ops/delist.js";
import { registrarRole } from "./roles/registrar.js";
import { publisherRole } from "./roles/publisher.js";

export async function init(reality) {
  // The operator's editorial lever (auto-namespaced to roots:delist).
  reality.do.registerOperation("delist", delistOp);

  // The catalog's writer, and the public role a being picks up to
  // publish into it. Full namespaced names: the role registry does not
  // auto-prefix an already-qualified first argument.
  reality.declare.registerRole("roots:registrar", registrarRole);
  reality.declare.registerRole("roots:publisher", publisherRole);

  log.verbose("Roots", "registered: delist op, registrar + publisher roles");
  return {};
}
