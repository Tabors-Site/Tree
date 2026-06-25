// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Hash utility for content-addressed Facts (INTEGRITY + IDENTITY).
//
// A fact's hash IS its identity: `_id = SHA-256(p | canonical(content))`.
// There is no separate `h` field and no random id — the same deed,
// in the same world, after the same history, IS the same fact.
// `p` is the chain link: the previous fact's `_id` on the same reel
// (GENESIS_PREV for the first). `p` folds in the previous fact's
// identity, so every fact is bound to the whole history behind it.
// Alter any past fact and its identity changes, breaking the `p`
// link of the next fact, and the next. The reel fails verification
// at the altered position — and because the head fact's identity
// commits to everything before it, the head IS the reel's root hash.
//
// Three layered identity systems, composing (the OS doctrine):
//   semantic   — IBP addresses (where in the world; navigation)
//   historical — (reel, seq) ordering + p links (what came before)
//   storage    — the content hash (what this exactly IS; dedup,
//                transport, verification)
//
// `history` is part of the hashed content: a fact is an event IN A
// WORLD, and sibling histories may lawfully hold the same (reel, seq).
// Canonical content includes every Fact field that defines the deed
// and excludes `p` itself (folded in separately) and the identity
// (the digest's output, not its input). `date` is deliberately ABSENT
// (human time is display, never truth); `foldSeq` is included when present.
//
// ── IMPLEMENTATION: PURE RUST ───────────────────────────────────────────────
// The body of this file is now a binding to rust/treehash (Tier 1) via the napi addon. There is NO JS
// implementation — the Rust crate is the single source of truth (proven by 43/43 golden vectors + the
// live-chain parity harness). The 9 importers of this module are unchanged; only the impl moved. To
// change the digest (e.g. add/remove a content field), edit rust/treehash/src/hash.rs — never here —
// then `npm run build:native` and regenerate the vectors. This file should rarely change again.

import { native } from "./native.js";

/** Genesis prev: the `p` of the first fact on every reel (64 zero hex). */
export const GENESIS_PREV = native.genesisPrev();

/**
 * Compute h = SHA-256(p || canonical(content)).
 * @param {string} prev      The prev-hash (or GENESIS_PREV).
 * @param {object} content   The fact's content snapshot (any plain JSON).
 * @returns {string}         Hex digest.
 */
export function computeHash(prev, content) {
  if (typeof prev !== "string") {
    throw new Error("computeHash: prev must be a string");
  }
  // canonicalize sorts keys, so JSON.stringify's insertion order is irrelevant; Rust does the rest.
  return native.computeHash(prev, JSON.stringify(content));
}

/**
 * Extract the hashable content from a Fact row (excludes `p` and `_id`; includes `history` and, when
 * present, `foldSeq`). Returned as a plain object for callers that read it directly.
 */
export function contentOf(fact) {
  return JSON.parse(native.contentOf(JSON.stringify(fact)));
}

/**
 * Stable canonical JSON: sorted keys (recursive), empty-object drop, ES number format, `date`→ISO.
 * MUST stay byte-identical across releases (a versioned wire format) — it is pinned by the vectors.
 */
export function canonicalize(value) {
  return native.canonicalize(JSON.stringify(value));
}
