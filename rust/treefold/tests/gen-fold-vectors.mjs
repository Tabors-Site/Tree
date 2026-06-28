#!/usr/bin/env node
// gen-fold-vectors.mjs . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ── RETIRED (2026-06-28) ─────────────────────────────────────────────────────
// The FOLD is now PURE RUST: the foldEngine + foldAt reduce-loops were cut to the
// `treefold` crate via native.foldFrom (seed/past/fact/native.js), and Rust is the
// single source of truth for the fold. `fold.vectors.json` is therefore FROZEN — the
// Rust regression baseline (tests/fold_vectors.rs), NOT a JS-tracking output. Do NOT
// run this generator to "re-baseline" the golden: re-deriving it from JS would let a
// JS-side change silently rewrite the very file that is supposed to catch a Rust
// divergence. If the fold semantics intentionally change, edit the reducers AND the
// frozen vectors together (and prove the boot still re-folds the real chain IDENTICAL).
// Kept (not deleted) only so the reel scenarios below stay readable.
//
// (Historical purpose, no longer the workflow:)
// Regenerate fold.vectors.json from the LIVE JS reducers (the source of truth for
// the Rust treefold conformance test). Run this after ANY reducer change so the
// golden states track the JS exactly:
//
//     node rust/treefold/tests/gen-fold-vectors.mjs
//
// "Fresh reels": every fact is stamped with `ord` (the global append ordinal, the
// current line shape; the original vectors predated ord, so bornOrd never folded).
// Each reel is folded by its live per-kind reducer and canonicalized with the live
// canonicalizer, so the file IS a JS-vs-Rust cross-check, not a hand-transcription.
// The reel scenarios (facts) are preserved; only `ord` is added and the `canonical`
// (and any matter isGone) are recomputed.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../.."); // rust/treefold/tests -> repo root

const reducers = {
  being: await import(`${R}/seed/materials/being/reducer.js`),
  space: await import(`${R}/seed/materials/space/reducer.js`),
  matter: await import(`${R}/seed/materials/matter/reducer.js`),
  library: await import(`${R}/seed/materials/library/reducer.js`),
};
const { canonicalize } = await import(`${R}/seed/past/fact/hash.js`);
const { isGone } = await import(`${R}/seed/materials/matter/reducer.js`);

const VECTORS = path.join(__dirname, "fold.vectors.json");
const doc = JSON.parse(fs.readFileSync(VECTORS, "utf8"));

// One story-wide append ordinal, assigned in reel order then seq order, the way
// fileStore.commitMoment hands them out across the single journal.
let ord = 0;
let bornOrdCount = 0;

for (const reel of doc.reels) {
  const reducer = reducers[reel.kind];
  if (!reducer) throw new Error(`gen-fold-vectors: no reducer for kind ${reel.kind}`);

  // Fold order is seq order (foldEngine sorts by seq before reducing).
  const facts = reel.facts.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const f of facts) {
    f.ord = ++ord; // the clock-free position; create reducers fold it as bornOrd
  }
  reel.facts = facts;

  let state = reducer.initial();
  for (const f of facts) state = reducer.reduce(state, f);

  reel.canonical = canonicalize(state);
  if (state && state.bornOrd != null) bornOrdCount++;

  if (reel.kind === "matter") reel.isGone = isGone(state); // the tombstone verdict
}

fs.writeFileSync(VECTORS, JSON.stringify(doc, null, 2) + "\n");
console.log(
  `regenerated ${doc.reels.length} reels (ord-bearing); ${bornOrdCount} carry bornOrd`,
);
