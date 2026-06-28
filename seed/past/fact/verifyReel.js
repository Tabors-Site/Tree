// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// verifyReel — walk a reel-bearing aggregate's facts in seq order,
// HISTORY-AWARE, recompute each fact's identity from its p+content,
// and confirm the chain holds end-to-end.
//
// Per math.md INTEGRITY: the chain DETECTS tampering. It does not
// repair. A failed verify says "this reel has been altered or its
// integrity fields are wrong" and points at the first break. The
// caller decides what to do — fetch a clean copy from replication,
// quarantine the reel, raise an alert.
//
// History-aware: a reel on history #1a is the UNION of main's facts up
// to #1's branchPoint, #1's facts up to #1a's branchPoint, and #1a's
// own divergence — exactly the ranges the fold reads
// (foldEngine.readReelBetween). The chain links ACROSS each
// branchPoint boundary: the first fact after a boundary carries
// p = the prior range's last fact's identity. One chain, one walk,
// across worlds. (The old verifier was history-blind — on branched
// reels it read every history's facts interleaved and reported false
// breaks. Retired with the lineage walk.)
//
// Under content addressing the fact's `_id` IS its hash; "unhashed"
// became "unaddressed" (a row whose _id doesn't verify as a content
// hash — pre-CAS rows or foreign inserts).
//
// ── IMPLEMENTATION: PURE RUST ───────────────────────────────────────────────
// The HISTORY I/O stays in JS — resolving the lineage + branchPoint floors and reading the reel
// slice (readReelLineage) is a storage concern. The CHAIN WALK (recompute each fact's identity from
// p+content, confirm the four break shapes) is now the Tier-3 `treeverify` crate, reached through the
// napi addon as native.verifyFactChain. There is NO JS walk anymore — the rehash + p-link logic that
// used to live here was deleted; Rust is the single source of truth (proven byte-identical by the
// chain golden vectors + the live-chain parity harness). The verdict shape is unchanged, so the
// callers (chainRoots, instateReel, receive, seedPlant, graft) are untouched.

// FLAG: direct fileStore import RETAINED. This file is
// the INTEGRITY primitive — it reads each fact's raw p/_id/seq fields across a history lineage with
// per-history floors and hands them to the Rust chain verifier. The curated
// FACT layer (past/fact/facts.js: getReel / getFactsByActId / getFactsOnReelWhere)
// has NO lineage-floors raw-chain read, and by design it reshapes/redacts facts
// (serializeFactForReel) — which would destroy the p/_id/seq the chain walk
// verifies. So this stays a storage-primitive chokepoint (alongside chainRoots.js
// / verifyReelFrom.js, the other integrity walkers reading fileStore directly).
import { readReelLineage } from "../fileStore.js";
import { native } from "./native.js";

const REEL_KINDS = new Set(["being", "space", "matter", "library"]);

/**
 * Walk a reel and verify its hash chain on one history's view.
 * Detects four break shapes:
 *
 *   - `unaddressed`  — fact missing p, or its _id is not a 64-hex
 *                      content hash shape (pre-CAS row).
 *   - `seq-gap`      — facts present at seq=N and seq=N+2 but not
 *                      N+1 within the history's visible ranges.
 *   - `prev-mismatch`— f.p doesn't equal the prior fact's identity
 *                      (including across a branchPoint boundary).
 *   - `hash-mismatch`— f._id doesn't equal computeHash(f.p, content).
 *
 * @param {"being"|"space"|"matter"} targetKind
 * @param {string} targetId
 * @param {string} [history="0"]
 * @returns {Promise<
 *   { ok: true,  count: number, headHash: string|null }
 * | { ok: false, count: number, brokenAt: number, reason: string, expected: string|number, actual: string|number|null }
 * >}
 */
export async function verifyReel(targetKind, targetId, history = "0") {
  if (!REEL_KINDS.has(targetKind)) {
    throw new Error(`verifyReel: targetKind must be being|space|matter (got "${targetKind}")`);
  }
  const id = String(targetId);
  const { isMain, resolveHistoryLineage, getBranchPoint } =
    await import("../../materials/history/histories.js");

  // The history's visible ranges, identical logic to readReelBetween:
  // lineage[i] owns (floor(lineage[i]), floor(lineage[i+1])]; the
  // leaf is unbounded above. Main's floor is 0. STORAGE SWAP: the
  // OR-of-ranges Fact.find became a fileStore reel read over the same
  // (lineage, floors). The chain walk below is the Rust verifier
  // (file _id = computeHash(p, contentOf), the store's content-hash _id).
  const lineage = isMain(history) ? ["0"] : await resolveHistoryLineage(history);
  const floors = { "0": 0 };
  for (const h of lineage) {
    if (isMain(h)) continue;
    floors[h] = (await getBranchPoint(h, targetKind, id)) || 0;
  }

  const facts = readReelLineage(lineage, floors, targetKind, id);
  // The chain walk IS Rust now: recompute each fact's identity from p+content and confirm the chain.
  // The verdict is byte-identical to the retired JS walk (proven by the chain vectors + parity harness).
  return JSON.parse(native.verifyFactChain(JSON.stringify(facts)));
}
