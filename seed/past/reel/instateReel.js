// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// instateReel — the ONE verbatim being-reel instate. Used by book receive (receive.js
// receiveReels — reel-only, the doctrinally-pure consumer); graft's act-carrying path wraps the
// act-chain on top of the same gates.
//
// A reel is the facts ABOUT a being (its qualities/state/memory). Instating one = the cold gates
// (scope, integrity, dedup, reel-divergence, branch-collision) → landed[]-tracked insert
// (histories, reel heads advance-only, facts) → verifyReel. REEL-ONLY by doctrine: a book carries
// reels, NOT act-chains (a being is living matter; only Names have act-chains, keyed
// <story>:<history>:<being>, and they stay home). The act-chain never reaches here — reelKey is
// <history>:<type>:<id>, no story — so this needs no story param.
//
// The deps carry no raw storage models (Fact / History / ReelHead) — none exist.
// instateReel reads/writes the file world directly through the CURATED seam:
//   - histories     → materials/history/histories.js (loadHistory / createHistory / deleteHistory).
//   - reel heads     → fileStore.readReelHead / advanceReelHead (the .head pointer; advance-only).
//   - facts          → DEDUP/DIVERGENCE read via fileStore.readReel (own-history reel scan); the
//                      VERBATIM insert via fileStore.commitVerbatim (journal + apply pre-computed
//                      docs, byte-for-byte — a transplant, never a fresh stamp; commitMoment would
//                      re-derive seq/p/_id and re-home the chain).
// The remaining deps are PURE functions the caller already imports (computeHash / contentOf —
// the integrity recompute; verifyReel — the post-instate chain walk; graftRootFromParts — the
// optional reel-fingerprint), kept injected so callers thread their own module instances.
//
// landed[] entries are {what, undo} — the receive-side shape; a graft adopts it for rollback too.

import * as fileStore from "../fileStore.js";
import {
  loadHistory,
  createHistory,
  deleteHistory,
} from "../../materials/history/histories.js";

/**
 * Instate one verbatim being-reel; append undos to the caller's `landed[]`.
 * @param {object} reel { being, facts[], reelHeads[], histories[], root? }
 * @param {object} [opts] { landed:[], skipVerify?:bool } — skipVerify lets graft run its own
 *   mechanism-aware verify (verifyReel vs verifyReelFrom) outside the core.
 * @param {object} deps { computeHash, contentOf, verifyReel, graftRootFromParts } — PURE helpers.
 * @returns {Promise<{ beingId, mode, newFacts, newHistories, touchedHistories }>}
 */
export async function instateReel(reel, { landed = [], skipVerify = false } = {}, deps) {
  const { computeHash, contentOf, verifyReel, graftRootFromParts } = deps;
  const bid = String(reel?.being ?? reel?.meta?.beingId ?? "");
  if (!bid) throw new Error("instateReel: reel needs `being` (the target being id).");
  if (!Array.isArray(reel.facts)) throw new Error("instateReel: reel.facts[] is required.");

  // SCOPE — every fact / reelHead belongs to THIS being.
  for (const f of reel.facts) {
    if (!(f.of && f.of.kind === "being" && String(f.of.id) === bid)) {
      throw new Error(`instateReel: SCOPE VIOLATION — a fact targets ${f.of?.kind}:${String(f.of?.id || "").slice(0, 10)}…, not being ${bid.slice(0, 10)}….`);
    }
  }
  for (const rh of (reel.reelHeads || [])) {
    if (String(rh._id).split(":").slice(1).join(":") !== `being:${bid}`) {
      throw new Error(`instateReel: SCOPE VIOLATION — reelHead ${rh._id} is not being ${bid.slice(0, 10)}….`);
    }
  }

  // INTEGRITY — each fact _id recomputes from (p, contentOf).
  for (const f of reel.facts) {
    if (typeof f._id !== "string" || computeHash(f.p, contentOf(f)) !== f._id) {
      throw new Error(`instateReel: FACT INTEGRITY FAILED at seq ${f.seq} (${String(f._id).slice(0, 12)}…).`);
    }
  }

  // DEDUP → newFacts; mode from FACTS present. Reads the being's own reel
  // per (history) and collects the _ids already on it — the file-native peer
  // of Fact.find({_id:$in}).select(_id). The reel is keyed (history, being),
  // and each fact carries its own history, so we scan every history the
  // incoming facts span. (readReel is the curated/own-history reel read.)
  const incomingHistories = [...new Set(reel.facts.map((f) => String(f.history ?? "0")))];
  const have = new Set();
  for (const h of incomingHistories) {
    for (const e of fileStore.readReel(h, "being", bid)) have.add(String(e._id));
  }
  const newFacts = reel.facts.filter((f) => !have.has(String(f._id)));
  const mode = have.size === 0 ? "create" : (newFacts.length === 0 ? "idempotent" : "merge");

  // REEL-DIVERGENCE — a (history, seq) the being already holds with a DIFFERENT _id is a fork.
  // Scan each touched history's reel for an existing fact at a wanted seq whose _id differs.
  if (newFacts.length) {
    const want = new Map(newFacts.map((f) => [`${String(f.history ?? "0")}:${f.seq}`, String(f._id)]));
    const seqs = new Set(newFacts.map((f) => f.seq));
    for (const h of incomingHistories) {
      for (const e of fileStore.readReel(h, "being", bid)) {
        if (!seqs.has(e.seq)) continue;
        const w = want.get(`${String(e.history ?? h)}:${e.seq}`);
        if (w && w !== String(e._id)) {
          throw new Error(`instateReel: REEL DIVERGENCE — being ${bid.slice(0, 10)}… already holds (history ${e.history ?? h}, seq ${e.seq}) with different content.`);
        }
      }
    }
  }

  // HISTORY (branch) collision — absent → insert; same parent+branchPoint → ok; differ → refuse.
  const normBP = (bp) => (bp instanceof Map ? Object.fromEntries(bp) : (bp || {}));
  const bpKey = (bp) => JSON.stringify(Object.entries(normBP(bp)).sort());
  const newHistories = [];
  for (const h of (reel.histories || [])) {
    const ex = await loadHistory(String(h._id));
    if (!ex) { newHistories.push(h); continue; }
    if (ex.parent !== h.parent || bpKey(ex.branchPoint) !== bpKey(h.branchPoint)) {
      throw new Error(`instateReel: BRANCH COLLISION — history "${h._id}" exists with a different parent/branchPoint.`);
    }
  }

  // INSERT — push undo BEFORE each insert; the caller's catch rolls back on any later throw.
  if (newHistories.length) {
    for (const h of newHistories) landed.push({ what: `History:${h._id}`, undo: async () => { await deleteHistory(String(h._id)); } });
    for (const h of newHistories) await createHistory({ ...h, path: h.path ?? h._id });
  }
  // FACTS first — the verbatim transplant. Each fact lands byte-for-byte
  // under its own (history, "being", bid) reel, carrying its source _id/seq/p,
  // and commitVerbatim's writeFactDoc ADVANCES the reel's .head as each line
  // lands (idempotent by seq). So facts MUST precede the heads-only advance
  // below: advancing the head to the final tip first would make writeFactDoc
  // skip every fact (cur.head >= doc.seq). The per-fact undo (undoFact)
  // regresses the head back below the fact on rollback.
  if (newFacts.length) {
    for (const f of newFacts) landed.push({ what: `Fact:${String(f._id).slice(0, 10)}`, undo: async () => { await undoFact(f); } });
    await fileStore.commitVerbatim(
      newFacts.map((f) => ({
        history: String(f.history ?? "0"),
        kind: "being",
        id: bid,
        doc: f,
      })),
    );
  }
  // Reel heads: advance-only, AFTER the facts. commitVerbatim already advanced
  // the head for every reel whose facts we landed; a book may also carry heads
  // for reels it ships NO facts for (a heads-only fingerprint), so we apply
  // each carried head explicitly. advanceReelHead never regresses — a head
  // already at/above the carried value is a no-op. No rollback-undo: the .head
  // is a DERIVED pointer (rebuildable from the reel), and a head over a
  // fact-less reel reads as empty (verifyReelFile([]) is ok) and self-heals on
  // the next fold/rebuild — so a failed receive that advanced a fingerprint
  // head leaves no truth corrupted (the head advance is advance-only and
  // likewise isn't rolled back).
  for (const rh of (reel.reelHeads || [])) {
    const [history, kind, id] = String(rh._id).split(":");
    fileStore.advanceReelHead(history, kind, id, rh.head, rh.headHash);
  }

  // VERIFY — verifyReel per (being, history). reelKey split[0] = history (no story in reel keys).
  const touchedHistories = [...new Set([
    ...(reel.reelHeads || []).map((r) => String(r._id).split(":")[0]),
    ...newFacts.map((f) => String(f.history ?? "0")),
  ])];
  if (!skipVerify) {
    for (const br of touchedHistories) {
      const vr = await verifyReel("being", bid, br);
      if (!vr.ok) {
        throw new Error(`instateReel: POST verifyReel FAILED being:${bid.slice(0, 8)}@${br} — ${vr.reason} at ${vr.brokenAt}.`);
      }
    }
  }

  // ROOT (optional, reel-only fingerprint) — only when reel.root is set AND we own the verify
  // (the book path). Graft passes root:null and runs its own acts-inclusive graftRoot check.
  if (reel.root) {
    const landedReels = (reel.reelHeads || []).map((r) => {
      const [history, kind, id] = String(r._id).split(":");
      const h = fileStore.readReelHead(history, kind, id);
      return { _id: r._id, history, type: kind, id, head: h.head, headHash: h.headHash };
    });
    const repro = graftRootFromParts({ beingId: bid, reelHeads: landedReels, actHeads: [] });
    if (repro !== reel.root) {
      throw new Error(`instateReel: ROOT MISMATCH — landed heads reproduce ${repro.slice(0, 12)}… vs declared ${String(reel.root).slice(0, 12)}….`);
    }
  }

  return { beingId: bid, mode, newFacts, newHistories, touchedHistories };
}

// Undo a single verbatim fact insert. The .reel is append-only, so a true undo
// is a TRUNCATION back to the seq BEFORE this fact — truncateReelTo rewrites the
// reel keeping only seq <= (this.seq - 1) and resets the .head to that prefix's
// tip (GENESIS_PREV when nothing's left), so the orphaned line is PHYSICALLY
// removed (not merely below the head — which would re-surface in readReel/dedup
// on a retry). A receive lands a contiguous tail and the caller's landed[]
// unwinds newest-first (highest seq truncates first), so the net effect is the
// reel restored to exactly its pre-instate length — the receiver's pre-existing
// chain untouched.
async function undoFact(f) {
  const history = String(f.history ?? "0");
  const kind = String(f.of?.kind ?? "being");
  const id = String(f.of?.id ?? "");
  if (!id) return;
  fileStore.truncateReelTo(history, kind, id, (f.seq || 1) - 1);
}
