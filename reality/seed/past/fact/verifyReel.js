// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// verifyReel — walk a reel-bearing aggregate's facts in seq order,
// BRANCH-AWARE, recompute each fact's identity from its p+content,
// and confirm the chain holds end-to-end.
//
// Per math.md INTEGRITY: the chain DETECTS tampering. It does not
// repair. A failed verify says "this reel has been altered or its
// integrity fields are wrong" and points at the first break. The
// caller decides what to do — fetch a clean copy from replication,
// quarantine the reel, raise an alert.
//
// Branch-aware: a reel on branch #1a is the UNION of main's facts up
// to #1's branchPoint, #1's facts up to #1a's branchPoint, and #1a's
// own divergence — exactly the ranges the fold reads
// (foldEngine.readReelBetween). The chain links ACROSS each
// branchPoint boundary: the first fact after a boundary carries
// p = the prior range's last fact's identity. One chain, one walk,
// across worlds. (The old verifier was branch-blind — on branched
// reels it read every branch's facts interleaved and reported false
// breaks. Retired with the lineage walk.)
//
// Under content addressing the fact's `_id` IS its hash; "unhashed"
// became "unaddressed" (a row whose _id doesn't verify as a content
// hash — pre-CAS rows or foreign inserts).

import Fact from "./fact.js";
import { computeHash, contentOf, GENESIS_PREV } from "./hash.js";

const REEL_KINDS = new Set(["being", "space", "matter"]);

/**
 * Walk a reel and verify its hash chain on one branch's view.
 * Detects four break shapes:
 *
 *   - `unaddressed`  — fact missing p, or its _id is not a 64-hex
 *                      content hash shape (pre-CAS row).
 *   - `seq-gap`      — facts present at seq=N and seq=N+2 but not
 *                      N+1 within the branch's visible ranges.
 *   - `prev-mismatch`— f.p doesn't equal the prior fact's identity
 *                      (including across a branchPoint boundary).
 *   - `hash-mismatch`— f._id doesn't equal computeHash(f.p, content).
 *
 * @param {"being"|"space"|"matter"} targetKind
 * @param {string} targetId
 * @param {string} [branch="0"]
 * @returns {Promise<
 *   { ok: true,  count: number, headHash: string|null }
 * | { ok: false, count: number, brokenAt: number, reason: string, expected: string|number, actual: string|number|null }
 * >}
 */
export async function verifyReel(targetKind, targetId, branch = "0") {
  if (!REEL_KINDS.has(targetKind)) {
    throw new Error(`verifyReel: targetKind must be being|space|matter (got "${targetKind}")`);
  }
  const id = String(targetId);
  const { isMain, resolveHistoryLineage, getBranchPoint } =
    await import("../../materials/history/histories.js");

  // The branch's visible ranges, identical logic to readReelBetween:
  // lineage[i] owns (floor(lineage[i]), floor(lineage[i+1])]; the
  // leaf is unbounded above. Main's floor is 0.
  const lineage = isMain(branch) ? ["0"] : await resolveHistoryLineage(branch);
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
    const historyClause = isMain(b)
      ? { $or: [{ history: "0" }, { history: { $exists: false } }] }
      : { history: b };
    return { "of.kind": targetKind, "of.id": id, seq: seqFilter, ...historyClause };
  });
  if (orClauses.length === 0) return { ok: true, count: 0, headHash: null };

  const facts = await Fact.find({ $or: orClauses }).sort({ seq: 1 }).lean();

  let expectedPrev = GENESIS_PREV;
  let expectedSeq  = 1;
  let count = 0;
  for (const f of facts) {
    count++;
    if (f.seq !== expectedSeq) {
      return {
        ok: false, count, brokenAt: expectedSeq,
        reason: "seq-gap", expected: expectedSeq, actual: f.seq,
      };
    }
    if (typeof f.p !== "string" || typeof f._id !== "string" || !/^[0-9a-f]{64}$/.test(f._id)) {
      return {
        ok: false, count, brokenAt: f.seq,
        reason: "unaddressed", expected: expectedPrev, actual: f.p ?? null,
      };
    }
    if (f.p !== expectedPrev) {
      return {
        ok: false, count, brokenAt: f.seq,
        reason: "prev-mismatch", expected: expectedPrev, actual: f.p,
      };
    }
    const expectedId = computeHash(f.p, contentOf(f));
    if (f._id !== expectedId) {
      return {
        ok: false, count, brokenAt: f.seq,
        reason: "hash-mismatch", expected: expectedId, actual: f._id,
      };
    }
    expectedPrev = f._id;
    expectedSeq  = f.seq + 1;
  }

  return {
    ok: true,
    count,
    // The reel's root: the head fact's identity (GENESIS_PREV walked
    // forward through every fact). Null for an empty reel.
    headHash: count > 0 ? expectedPrev : null,
  };
}
