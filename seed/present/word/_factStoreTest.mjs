// _factStoreTest.mjs — TEST-ONLY query surface over the file store.
//
// Some verify rigs want cross-reel fact queries with a dotted-key filter
// (find/findOne/count over every fact, and the Act peers). The file store keeps truth
// as per-reel JSONL, and `listAllFacts()` / `listAllActs()` already scan every reel.
// This wraps them with a small document matcher (dotted keys + equality +
// $exists/$ne/$in/$eq/$regex) so a rig's assertion body reads naturally: factFind,
// factFindOne, factCount (Act peers: actFind/actFindOne/actCount). Reads the CURRENT
// store (configured by the rig's TREEOS_STORE_BASE), so call AFTER the deeds land.
//
// Not a verify-*.mjs — the suite runner skips it. Production code never imports it.

import { listAllFacts, listAllActs } from "../../past/fileStore.js";

function get(obj, dotted) {
  return String(dotted)
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function matchOne(value, cond) {
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof RegExp)) {
    for (const [op, arg] of Object.entries(cond)) {
      switch (op) {
        case "$exists": if ((value !== undefined && value !== null) !== arg) return false; break;
        case "$ne":     if (value === arg) return false; break;
        case "$in":     if (!Array.isArray(arg) || !arg.includes(value)) return false; break;
        case "$nin":    if (Array.isArray(arg) && arg.includes(value)) return false; break;
        case "$eq":     if (value !== arg) return false; break;
        case "$regex":  if (!new RegExp(arg).test(String(value ?? ""))) return false; break;
        default:        if (value !== cond) return false; // not an operator object → plain equality
      }
    }
    return true;
  }
  if (cond instanceof RegExp) return cond.test(String(value ?? ""));
  return value === cond;
}

function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter || {})) {
    // a rig may filter on `branch`; the file fact carries that under `history`.
    const k = key === "branch" ? "history" : key;
    if (!matchOne(get(doc, k), cond)) return false;
  }
  return true;
}

export function factFind(filter = {}) { return listAllFacts().filter((f) => matches(f, filter)); }
export function factFindOne(filter = {}) { return listAllFacts().find((f) => matches(f, filter)) || null; }
export function factCount(filter = {}) { return listAllFacts().filter((f) => matches(f, filter)).length; }

export function actFind(filter = {}, story) { return listAllActs(story).filter((a) => matches(a, filter)); }
export function actFindOne(filter = {}, story) { return listAllActs(story).find((a) => matches(a, filter)) || null; }
export function actCount(filter = {}, story) { return listAllActs(story).filter((a) => matches(a, filter)).length; }
