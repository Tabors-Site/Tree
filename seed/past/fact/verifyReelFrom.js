// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// verifyReelFrom — verifyReel's anchored sibling.
//
// The genesis-seeded verifyReel walks a reel from seq 1 with
// expectedPrev = GENESIS_PREV. verifyReelFrom walks a CONTIGUOUS SUFFIX
// [fromSeq..head], seeding the chain at a DECLARED anchor: anchorPrev =
// the identity of the fact immediately before fromSeq, which a partial
// graft legitimately does NOT carry. The anchor is the ONLY license for a
// non-genesis start — an UNANCHORED gap still breaks (seq-gap /
// prev-mismatch), exactly as verifyReel would. Degenerate at
// { fromSeq: 1, anchorPrev: GENESIS_PREV } this IS verifyReel.
//
// Same four break shapes, same history-aware range logic, same byte-for-
// byte recompute. The only differences are the seeded start and a
// `seq >= fromSeq` floor on the query. Kept a separate function (not an
// opt on verifyReel) so every full-graft and genome path keeps calling
// the unchanged genesis-seeded verifyReel.
//
// ── IMPLEMENTATION: PURE RUST ───────────────────────────────────────────────
// The HISTORY I/O (lineage + branchPoint floors + the anchored reel-suffix read) stays in JS. The
// seeded CHAIN WALK is the Tier-3 `treeverify` crate, reached through the addon as
// native.verifyFactChainFrom(facts, anchorPrev, fromSeq). There is NO JS rehash here anymore — the
// seeded walk that used to live in this file was deleted; Rust is the single source of truth (proven
// byte-identical by the chain golden vectors + the live anchored-parity harness). The verdict shape
// is identical to verifyReel, so callers (graft, the genome anchored paths) are untouched.

import { readReelLineage } from "../fileStore.js";
import { GENESIS_PREV } from "./hash.js";
import { native } from "./native.js";

const REEL_KINDS = new Set(["being", "space", "matter", "library"]);

/**
 * Walk a reel's hash chain from a declared anchor, history-aware.
 *
 * @param {"being"|"space"|"matter"} targetKind
 * @param {string} targetId
 * @param {string} [history="0"]
 * @param {object} [opts]
 * @param {number} [opts.fromSeq=1]               first seq present in the segment
 * @param {string} [opts.anchorPrev=GENESIS_PREV] identity of the fact BEFORE fromSeq
 * @returns same shape as verifyReel:
 *   { ok:true, count, headHash } | { ok:false, count, brokenAt, reason, expected, actual }
 */
export async function verifyReelFrom(
  targetKind, targetId, history = "0",
  { fromSeq = 1, anchorPrev = GENESIS_PREV } = {},
) {
  if (!REEL_KINDS.has(targetKind)) {
    throw new Error(`verifyReelFrom: targetKind must be being|space|matter (got "${targetKind}")`);
  }
  const id = String(targetId);
  const { isMain, resolveHistoryLineage, getBranchPoint } =
    await import("../../materials/history/histories.js");

  // The history's visible ranges, identical logic to verifyReel /
  // readReelBetween: lineage[i] owns (floor(lineage[i]), floor(lineage[i+1])].
  // STORAGE SWAP: the OR-of-ranges Fact.find became a fileStore reel
  // read over the same (lineage, floors). The anchored chain walk below
  // is the Rust verifier, seeded at (anchorPrev, fromSeq).
  const lineage = isMain(history) ? ["0"] : await resolveHistoryLineage(history);
  const floors = { "0": 0 };
  for (const h of lineage) {
    if (isMain(h)) continue;
    floors[h] = (await getBranchPoint(h, targetKind, id)) || 0;
  }

  // The anchored floor: only the suffix [fromSeq..] participates. A gap
  // BELOW fromSeq is, by declaration, supplied by the anchor; a gap AT OR
  // ABOVE fromSeq is a real break and surfaces as seq-gap in the walk.
  // readReelLineage's afterSeq is EXCLUSIVE, so `seq >= fromSeq` is
  // afterSeq = fromSeq - 1.
  const facts = readReelLineage(lineage, floors, targetKind, id, fromSeq - 1, null);
  // The seeded chain walk IS Rust now: recompute each fact's identity from p+content from the declared
  // anchor and confirm the suffix. Byte-identical to the retired JS walk (proven by the parity harness).
  return JSON.parse(native.verifyFactChainFrom(JSON.stringify(facts), anchorPrev, fromSeq));
}
