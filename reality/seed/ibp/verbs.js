// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// verbs.js — public surface for the four IBP verbs.
//
// The actual verb code lives in verbs/{do,see,summon,be}.js — one
// file per verb, each carrying its own helpers. This file is a thin
// re-export so the legacy import path (`from "../ibp/verbs.js"`)
// keeps working and the seed's public surface stays single-point.
//
// New code can import the per-verb file directly:
//   import { doVerb }     from "../ibp/verbs/do.js";
//   import { seeVerb }    from "../ibp/verbs/see.js";
//   import { summonVerb } from "../ibp/verbs/summon.js";
//   import { beVerb }     from "../ibp/verbs/be.js";
//
// Or use this aggregator — same exports either way.

export { doVerb } from "./verbs/do.js";
export { seeVerb } from "./verbs/see.js";
export { summonVerb, summonCreateBeing, summonByResolved } from "./verbs/summon.js";
export { beVerb } from "./verbs/be.js";
