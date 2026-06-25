// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Reducer registry. The one place the fold engine consults to find
// material-specific reduce logic.
//
// Per FOLD.md: "Adding a new material = a new folder under materials/
// with a reducer + one registry line." This file is that registry.
// The fold engine never imports a specific reducer; it asks
// `reducers.get(type)` and gets back `{ initial, reduce }`.

import * as being   from "./being/reducer.js";
import * as space   from "./space/reducer.js";
import * as matter  from "./matter/reducer.js";
import * as library from "./library/reducer.js";
import { resolveReducerFromFold } from "../present/word/wordStore.js";

// Name has NO reducer of its own: a Name acts but is never acted-on, so it has an
// act-chain and no reel. Name-level facts fold into the LIBRARY reel's `names`
// catalog (library/reducer.js). loadProjection("name", ...) reads that catalog.
const _registry = {
  being,
  space,
  matter,
  library,
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
  // Fold-first: the kind->reducer mapping resolves from the word-fold (a "<type>-reducer" word
  // carrying host-handler refs to the functions); the static _registry is the module-load backstop
  // (the projection is empty in non-booted contexts). verify-reducerfold proves the fold resolves
  // to the SAME host functions the registry holds.
  const folded = resolveReducerFromFold(type);
  if (folded) return folded;
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
