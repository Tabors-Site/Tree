// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Reducer registry. The one place the fold engine consults to find
// material-specific reduce logic.
//
// Per FOLD.md: "Adding a new material = a new folder under materials/
// with a reducer + one registry line." This file is that registry.
// The fold engine never imports a specific reducer; it asks
// `reducers.get(type)` and gets back `{ initial, reduce }`.

import * as being  from "./being/reducer.js";
import * as space  from "./space/reducer.js";
import * as matter from "./matter/reducer.js";
import * as name   from "./name/reducer.js";

const _registry = {
  being,
  space,
  matter,
  name,
};

/**
 * Look up the reducer for a material type. Returns `{ initial,
 * reduce }`. Throws on unknown types — the fold engine should never
 * hand an unknown type, and surfacing the error loudly catches
 * registry drift.
 *
 * @param {"being"|"space"|"matter"} type
 * @returns {{ initial: () => object, reduce: (state, fact) => object }}
 */
export function get(type) {
  const r = _registry[type];
  if (!r) throw new Error(`reducers: no reducer registered for type "${type}"`);
  if (typeof r.initial !== "function" || typeof r.reduce !== "function") {
    throw new Error(`reducers: reducer for "${type}" missing initial/reduce`);
  }
  return r;
}

/**
 * Enumerate registered material types. Useful for the fold engine's
 * health checks and for rebuild-all sweeps.
 */
export function types() {
  return Object.keys(_registry);
}
