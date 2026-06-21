// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// instateReel — the ONE verbatim being-reel instate. Shared by book receive (receive.js
// receiveReels — reel-only, the doctrinally-pure consumer) and graft (graft.js applyGraft —
// the act-carrying EXCEPTION, which wraps the act-chain on top of this).
//
// A reel is the facts ABOUT a being (its qualities/state/memory). Instating one = the cold gates
// (scope, integrity, dedup, reel-divergence, branch-collision) → landed[]-tracked insert
// (histories, reelHeads advance-only, facts) → verifyReel. REEL-ONLY by doctrine: a book carries
// reels, NOT act-chains (a being is living matter; only Names have act-chains, keyed
// <story>:<history>:<being>, and they stay home). The act-chain never reaches here — reelKey is
// <history>:<type>:<id>, no story — so this needs no story param. applyGraft adds the act layer
// around the call; book-receive doesn't.
//
// Dependency-injected: callers pass the SAME model/fn instances they already import, so module
// identity is unchanged (applyGraft stays byte-green). landed[] entries are {what, undo} — the
// receive-side shape; applyGraft adopts it for its rollback too.

/**
 * Instate one verbatim being-reel; append undos to the caller's `landed[]`.
 * @param {object} reel { being, facts[], reelHeads[], histories[], root? }
 * @param {object} [opts] { landed:[], skipVerify?:bool } — skipVerify lets graft run its own
 *   mechanism-aware verify (verifyReel vs verifyReelFrom) outside the core.
 * @param {object} deps { Fact, History, ReelHead, computeHash, contentOf, verifyReel, graftRootFromParts }
 * @returns {Promise<{ beingId, mode, newFacts, newHistories, touchedHistories }>}
 */
export async function instateReel(reel, { landed = [], skipVerify = false } = {}, deps) {
  const { Fact, History, ReelHead, computeHash, contentOf, verifyReel, graftRootFromParts } = deps;
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

  // DEDUP → newFacts; mode from FACTS present (matches applyGraft).
  const ids = reel.facts.map((f) => String(f._id));
  const have = new Set((await Fact.find({ _id: { $in: ids } }).select("_id").lean()).map((r) => String(r._id)));
  const newFacts = reel.facts.filter((f) => !have.has(String(f._id)));
  const mode = have.size === 0 ? "create" : (newFacts.length === 0 ? "idempotent" : "merge");

  // REEL-DIVERGENCE — a (history, seq) the being already holds with a DIFFERENT _id is a fork.
  if (newFacts.length) {
    const want = new Map(newFacts.map((f) => [`${String(f.history ?? "0")}:${f.seq}`, String(f._id)]));
    const seqs = [...new Set(newFacts.map((f) => f.seq))];
    const clash = await Fact.find({ "of.kind": "being", "of.id": bid, seq: { $in: seqs } }).select("_id seq history").lean();
    for (const e of clash) {
      const w = want.get(`${String(e.history ?? "0")}:${e.seq}`);
      if (w && w !== String(e._id)) {
        throw new Error(`instateReel: REEL DIVERGENCE — being ${bid.slice(0, 10)}… already holds (history ${e.history ?? "0"}, seq ${e.seq}) with different content.`);
      }
    }
  }

  // HISTORY (branch) collision — absent → insert; same parent+branchPoint → ok; differ → refuse.
  const normBP = (bp) => (bp instanceof Map ? Object.fromEntries(bp) : (bp || {}));
  const bpKey = (bp) => JSON.stringify(Object.entries(normBP(bp)).sort());
  const newHistories = [];
  for (const h of (reel.histories || [])) {
    const ex = await History.findById(h._id).lean();
    if (!ex) { newHistories.push(h); continue; }
    if (ex.parent !== h.parent || bpKey(ex.branchPoint) !== bpKey(h.branchPoint)) {
      throw new Error(`instateReel: BRANCH COLLISION — history "${h._id}" exists with a different parent/branchPoint.`);
    }
  }

  // INSERT — push undo BEFORE each insert; the caller's catch rolls back on any later throw.
  if (newHistories.length) {
    for (const h of newHistories) landed.push({ what: `History:${h._id}`, undo: async () => { await History.deleteOne({ _id: h._id }); } });
    await History.insertMany(newHistories, { ordered: false });
  }
  for (const rh of (reel.reelHeads || [])) {
    const ex = await ReelHead.findById(rh._id).select("head").lean();
    if (!ex) {
      landed.push({ what: `ReelHead:${rh._id}`, undo: async () => { await ReelHead.deleteOne({ _id: rh._id }); } });
      await ReelHead.create(rh);
    } else if ((rh.head || 0) > (ex.head || 0)) {
      await ReelHead.updateOne({ _id: rh._id }, { $set: { head: rh.head, headHash: rh.headHash } }); // advance-only; pre-existing, NOT rolled back
    }
  }
  if (newFacts.length) {
    for (const f of newFacts) landed.push({ what: `Fact:${String(f._id).slice(0, 10)}`, undo: async () => { await Fact.deleteOne({ _id: f._id }); } });
    await Fact.insertMany(newFacts, { ordered: false });
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
    const keys = (reel.reelHeads || []).map((r) => String(r._id));
    const landedReels = keys.length ? await ReelHead.find({ _id: { $in: keys } }).lean() : [];
    const repro = graftRootFromParts({ beingId: bid, reelHeads: landedReels, actHeads: [] });
    if (repro !== reel.root) {
      throw new Error(`instateReel: ROOT MISMATCH — landed heads reproduce ${repro.slice(0, 12)}… vs declared ${String(reel.root).slice(0, 12)}….`);
    }
  }

  return { beingId: bid, mode, newFacts, newHistories, touchedHistories };
}
