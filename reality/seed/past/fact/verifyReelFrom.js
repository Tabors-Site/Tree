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
// Same four break shapes, same branch-aware range logic, same byte-for-
// byte recompute (computeHash(p, contentOf)). The only differences are
// the seeded start and a `seq >= fromSeq` floor on the query. Kept a
// separate function (not an opt on verifyReel) so every full-graft and
// genome path keeps calling the unchanged genesis-seeded verifyReel.

import Fact from "./fact.js";
import { computeHash, contentOf, GENESIS_PREV } from "./hash.js";

const REEL_KINDS = new Set(["being", "space", "matter"]);

/**
 * Walk a reel's hash chain from a declared anchor, branch-aware.
 *
 * @param {"being"|"space"|"matter"} targetKind
 * @param {string} targetId
 * @param {string} [branch="0"]
 * @param {object} [opts]
 * @param {number} [opts.fromSeq=1]               first seq present in the segment
 * @param {string} [opts.anchorPrev=GENESIS_PREV] identity of the fact BEFORE fromSeq
 * @returns same shape as verifyReel:
 *   { ok:true, count, headHash } | { ok:false, count, brokenAt, reason, expected, actual }
 */
export async function verifyReelFrom(
  targetKind, targetId, branch = "0",
  { fromSeq = 1, anchorPrev = GENESIS_PREV } = {},
) {
  if (!REEL_KINDS.has(targetKind)) {
    throw new Error(`verifyReelFrom: targetKind must be being|space|matter (got "${targetKind}")`);
  }
  const id = String(targetId);
  const { isMain, resolveBranchLineage, getBranchPoint } =
    await import("../../materials/branch/branches.js");

  // The branch's visible ranges, identical logic to verifyReel /
  // readReelBetween: lineage[i] owns (floor(lineage[i]), floor(lineage[i+1])].
  const lineage = isMain(branch) ? ["0"] : await resolveBranchLineage(branch);
  const ranges = [];
  for (let i = 0; i < lineage.length; i++) {
    const here = lineage[i];
    const next = lineage[i + 1] || null;
    const lower = isMain(here) ? 0 : (await getBranchPoint(here, targetKind, id)) || 0;
    const upper = next ? ((await getBranchPoint(next, targetKind, id)) || 0) : null;
    if (upper != null && upper <= lower) continue;
    ranges.push({ branch: here, lower, upper });
  }

  const orClauses = ranges.map(({ branch: b, lower, upper }) => {
    const seqFilter = { $type: "number", $gt: lower };
    if (upper != null) seqFilter.$lte = upper;
    const branchClause = isMain(b)
      ? { $or: [{ branch: "0" }, { branch: { $exists: false } }] }
      : { branch: b };
    return { "target.kind": targetKind, "target.id": id, seq: seqFilter, ...branchClause };
  });
  if (orClauses.length === 0) return { ok: true, count: 0, headHash: null };

  // The anchored floor: only the suffix [fromSeq..] participates. A gap
  // BELOW fromSeq is, by declaration, supplied by the anchor; a gap AT OR
  // ABOVE fromSeq is a real break and surfaces as seq-gap below.
  const facts = await Fact.find({ $and: [{ $or: orClauses }, { seq: { $gte: fromSeq } }] })
    .sort({ seq: 1 }).lean();

  let expectedPrev = anchorPrev;
  let expectedSeq  = fromSeq;
  let count = 0;
  for (const f of facts) {
    count++;
    if (f.seq !== expectedSeq) {
      return { ok: false, count, brokenAt: expectedSeq, reason: "seq-gap", expected: expectedSeq, actual: f.seq };
    }
    if (typeof f.p !== "string" || typeof f._id !== "string" || !/^[0-9a-f]{64}$/.test(f._id)) {
      return { ok: false, count, brokenAt: f.seq, reason: "unaddressed", expected: expectedPrev, actual: f.p ?? null };
    }
    if (f.p !== expectedPrev) {
      return { ok: false, count, brokenAt: f.seq, reason: "prev-mismatch", expected: expectedPrev, actual: f.p };
    }
    const expectedId = computeHash(f.p, contentOf(f));
    if (f._id !== expectedId) {
      return { ok: false, count, brokenAt: f.seq, reason: "hash-mismatch", expected: expectedId, actual: f._id };
    }
    expectedPrev = f._id;
    expectedSeq  = f.seq + 1;
  }

  return { ok: true, count, headHash: count > 0 ? expectedPrev : null };
}
