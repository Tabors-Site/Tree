// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// verifyReel — walk a reel-bearing aggregate's facts in seq order,
// recompute each fact's h from its p+content, and confirm the chain
// holds end-to-end.
//
// Per math.md INTEGRITY: the chain DETECTS tampering. It does not
// repair. A failed verify says "this reel has been altered or its
// integrity fields are wrong" and points at the first break. The
// caller decides what to do — fetch a clean copy from replication,
// quarantine the reel, raise an alert.
//
// The walk reads every reel-bearing fact (seq is numeric). Non-
// reel facts (target.kind ∈ {place,stance} or target-less) carry
// p=h=null and are excluded; they have no chain to verify.
//
// Pre-backfill legacy rows (h missing) are reported as "unhashed"
// rather than "broken." After the INTEGRITY backfill migration
// runs, every existing reel-bearing fact has p+h and unhashed rows
// indicate a real bug.

import Fact from "./fact.js";
import { computeHash, contentOf, GENESIS_PREV } from "./hash.js";

const REEL_KINDS = new Set(["being", "space", "matter"]);

/**
 * Walk a reel and verify its hash chain. Detects four break shapes:
 *
 *   - `unhashed`     — fact missing p or h (pre-INTEGRITY row that
 *                      slipped past the backfill).
 *   - `seq-gap`      — facts present at seq=N and seq=N+2 but not
 *                      N+1. Indicates either a crashed mid-seal (an
 *                      allocSeq with no insert) or a post-facto
 *                      deletion. The chain links forward fine
 *                      (because the burned-seq fact was never
 *                      written, so its successor's p references the
 *                      pre-gap fact's h), but data is missing.
 *   - `prev-mismatch`— f.p doesn't equal the prior fact's h. Catches
 *                      Case B from verify-tamper: someone re-hashed
 *                      a mutated middle fact but the next fact's p
 *                      still points at the original h.
 *   - `hash-mismatch`— f.h doesn't equal computeHash(f.p, content).
 *                      Catches Case A: content mutated without
 *                      touching p/h.
 *
 * @param {"being"|"space"|"matter"} targetKind
 * @param {string} targetId
 * @returns {Promise<
 *   { ok: true,  count: number }
 * | { ok: false, count: number, brokenAt: number, reason: string, expected: string|number, actual: string|number|null }
 * >}
 */
export async function verifyReel(targetKind, targetId) {
  if (!REEL_KINDS.has(targetKind)) {
    throw new Error(`verifyReel: targetKind must be being/space/matter, got "${targetKind}"`);
  }
  if (!targetId) throw new Error("verifyReel: targetId required");

  const facts = await Fact.find({
    "target.kind": targetKind,
    "target.id":   String(targetId),
    seq:           { $type: "number" },
  }).sort({ seq: 1 }).lean();

  let expectedPrev = GENESIS_PREV;
  let expectedSeq  = 1;
  let count = 0;
  for (const f of facts) {
    count++;
    if (f.seq !== expectedSeq) {
      // Reel has facts at expectedSeq=N but the next fact is at N+k>N.
      // Mid-seal crash burned the seq, or someone deleted the fact at
      // expectedSeq. Either way: data missing.
      return {
        ok:       false,
        count,
        brokenAt: expectedSeq,
        reason:   "seq-gap",
        expected: expectedSeq,
        actual:   f.seq,
      };
    }
    if (typeof f.h !== "string" || typeof f.p !== "string") {
      return {
        ok:       false,
        count,
        brokenAt: f.seq,
        reason:   "unhashed",
        expected: expectedPrev,
        actual:   f.p ?? null,
      };
    }
    if (f.p !== expectedPrev) {
      return {
        ok:       false,
        count,
        brokenAt: f.seq,
        reason:   "prev-mismatch",
        expected: expectedPrev,
        actual:   f.p,
      };
    }
    const expectedH = computeHash(f.p, contentOf(f));
    if (f.h !== expectedH) {
      return {
        ok:       false,
        count,
        brokenAt: f.seq,
        reason:   "hash-mismatch",
        expected: expectedH,
        actual:   f.h,
      };
    }
    expectedPrev = f.h;
    expectedSeq  = f.seq + 1;
  }

  return { ok: true, count };
}
