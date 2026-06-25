// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// foldPlace — the cross-reel weave for a being's moment.
//
// `fold(type, id)` brings ONE aggregate's projection up to date.
// `foldPlace(beingId, orientation)` runs the weave that produces the
// face a being sees this moment. The orientation parameter (per
// INNER-FOLD §1) determines what R_scope reaches:
//
//   forward (default) — weave b's own reel + the space + occupants.
//                       The act-chain A_b is NOT in scope. This is
//                       the world-facing moment; almost every moment
//                       is forward.
//
//   inward            — weave A_b only, in act-order. The world drops
//                       out. The face is the being's own line of
//                       deeds. Pure reflection.
//
//   half              — weave the forward face PLUS the recalled set:
//                       past acts of this being that stitched a reel
//                       of an entity currently changing in the
//                       forward face. Causal-adjacency recall, not
//                       similarity search.
//
// Per FOLD.md: "reach is one hop." foldPlace folds the being, its
// space, and that space's occupants. Child spaces are LISTED (their
// presence is known from the position index) but their interiors are
// not deep-folded. A being only deep-folds a child space when it
// moves into it.
//
// Per FOLD.md's cross-reel consistency decision: no global snapshot.
// Each reel folds to its own current, independently. If the space
// advances between folding the being and folding the space, the next
// moment re-folds. The actor model holds.

import { fold } from "./foldEngine.js";
import { findByPosition, assertHistoryOrThrow } from "../../../materials/projections.js";
import { ORIENTATION, validateOrientation } from "./orientation.js";
import { getActById, getActsByField } from "../../../past/act/actChain.js";
import { getFactsOnReelWhere } from "../../../past/fact/facts.js";
import { emptyWeave, addReel } from "./weave.js";
import { canSeeAdmitsReel } from "./canSeeResolver.js";

// Cap on how many recalled past-acts surface in a half-turn face.
// Long-lived beings can have many stitch-points; the recall set has
// to be bounded. Default to 16; tunable via opts. Per INNER-FOLD §3
// this is a DECIDE — the cap and ranking aren't a correctness
// concern, just a face-budget choice.
const DEFAULT_RECALL_CAP = 16;

/**
 * Fold the place a being sees for one moment.
 *
 * Forward shape:
 *   {
 *     orientation: "forward",
 *     self:      <being state, folded>,
 *     space:     <space state, folded> | null,
 *     occupants: [<{type, id, state}>, ...],
 *   }
 *
 * Inward shape:
 *   {
 *     orientation: "inward",
 *     self:      <being state, folded>,
 *     actChain:  [<{actId, through, to, stampedAt, startMessage,
 *                   endMessage, rootCorrelation, activeAble}>, ...],
 *   }
 *
 * Half shape (forward + recalled):
 *   {
 *     orientation: "half",
 *     self, space, occupants,
 *     recalled: [<{actId, ...}>, ...]  // capped, ranked by braid distance
 *   }
 *
 * @param {string} beingId
 * @param {string} [orientation="forward"]  one of forward|half|inward
 * @param {object} [opts]
 * @param {number} [opts.recallCap=16]      half-fold recall cap
 * @param {object} [opts.able]              the active able spec; when
 *   present, occupant folds are pre-gated against able.canSee so the
 *   fold only reads reels the able would admit. Legacy callers (no
 *   able) get the unfiltered forward face they have today.
 * @returns {Promise<object>}
 *   foldedFace augmented with `_weave` (the reels the fold actually
 *   read). buildInnerFace merges this with the canSee-side weave.
 */
export async function foldPlace(beingId, orientation = ORIENTATION.FORWARD, opts = {}) {
  if (!beingId) throw new Error("foldPlace: beingId is required");
  const ω = validateOrientation(orientation);

  // History this fold runs in. Sourced from moment (the moment
  // already carries the caller's history via Pass 4 substrate) or an
  // explicit opts.history from non-moment callers. Every sub-fold
  // inside this place-fold inherits the same history so the whole
  // place renders against one history's facts. No silent default —
  // a missing history here means a perimeter threading bug, surfaced
  // loud at the fold seam.
  // SEAM: opts key is `history` (foldPlace's non-moment callers, e.g.
  // cognition/human/myInnerFace.js, pass `history`); the value is the
  // history slot. In-moment callers route via opts.moment.actorAct.history.
  const history = assertHistoryOrThrow(
    opts.moment?.actorAct?.history || opts.history,
    "foldPlace(opts)",
  );

  // Optional moment for the stale-detection key (PARALLEL FACTS §1.3).
  // When the moment-open caller passes moment, every reel we fold
  // here records its foldedSeq into moment.foldedSeqs. emitFact
  // later reads that map to stamp foldSeq on facts targeting those
  // reels. Map is initialized in assign; we only set keys.
  const seqs = opts.moment?.foldedSeqs || null;
  const stash = (kind, id, foldedSeq) => {
    if (seqs) seqs.set(`${kind}:${id}`, foldedSeq);
  };

  // weave . the reels this fold actually reads. Self is always in
  // (every orientation reads it). Position-space and admitted occupants
  // are added inside buildForwardFace. Inward folds only include self
  // because the world drops out.
  const weave = emptyWeave();
  addReel(weave, { reelKind: "being", reelId: String(beingId), history });

  // Able spec, when present, gates occupant folds. Legacy callers (no
  // able) get unfiltered behavior.
  const able = opts.able || null;

  // The being itself is always folded — every orientation shows
  // the being to itself (the self is the carrier of orientation).
  const { state: self, foldedSeq: selfFoldedSeq } = await fold("being", beingId, { history });
  stash("being", beingId, selfFoldedSeq);

  // Inward: the world drops out. The face is A_b in act-order.
  if (ω === ORIENTATION.INWARD) {
    const actChain = await loadActChain(beingId, history);
    return { orientation: ω, self, actChain, _weave: weave };
  }

  // Forward AND half need the forward face built first.
  const forwardFace = await buildForwardFace(beingId, self, stash, history, able, weave);

  if (ω === ORIENTATION.FORWARD) {
    return { orientation: ω, ...forwardFace, _weave: weave };
  }

  // Half: forward face PLUS the recalled slice of A_b.
  const recalled = await recallByBraid(beingId, forwardFace, {
    cap: opts.recallCap || DEFAULT_RECALL_CAP,
    history,
  });
  return { orientation: ω, ...forwardFace, recalled, _weave: weave };
}

/**
 * Build the forward face: being's space + occupants. Used by both
 * the forward and half folds.
 *
 * The weave contribution from this function is only the space reel
 * (the position itself). Occupant entries are NOT added here even
 * when they're folded, because the inner face's weave is the residue
 * of what the FACE actually uses, and occupants only land in the face
 * through the canSee resolver (which records its own reel reads from
 * the descriptor it returns). Folding occupants here for the forward-
 * face return value is a legacy-caller convenience; the able-scoped
 * filter still trims that work when a able is on hand.
 */
async function buildForwardFace(beingId, self, stash, history = "0", able = null, weave = null) {
  const spaceId = self?.position || null;
  if (!spaceId) {
    return { self, space: null, occupants: [] };
  }

  const { state: space, foldedSeq: spaceFoldedSeq } = await fold("space", spaceId, { history });
  stash?.("space", spaceId, spaceFoldedSeq);
  if (weave) addReel(weave, { reelKind: "space", reelId: String(spaceId), history });
  const occupantRefs = await findByPosition(spaceId, history);

  // Self is its own occupant of its position; filter it out so the
  // caller doesn't get the being twice.
  const others = occupantRefs.filter(
    (o) => !(o.type === "being" && o.id === String(beingId)),
  );

  // Optional able-scoped fold filter. Trims work for legacy callers
  // that still consume the occupants[] return value. The weave is
  // unaffected either way; the canSee resolver is the weave authority.
  const admitted = able
    ? others.filter((o) => canSeeAdmitsReel(able.canSee, o))
    : others;

  // Fold each occupant. Folds run in parallel . different reels, no
  // contention. If one fold throws, surface it but don't block the
  // others; the caller decides whether to fail the moment.
  const occupants = await Promise.all(
    admitted.map(async (o) => {
      try {
        const { state, foldedSeq } = await fold(o.type, o.id, { history });
        stash?.(o.type, o.id, foldedSeq);
        return { type: o.type, id: o.id, state };
      } catch (err) {
        return { type: o.type, id: o.id, error: err.message };
      }
    }),
  );

  return { self, space, occupants };
}

/**
 * Load the being's act-chain A_b in act-order (oldest first). Returns
 * one row per Act where the being was the actor (to). The
 * Act-chain is a stored, first-class component of the being per
 * MODEL.md b = (id_b, R_b, A_b) — not a projection of the reel.
 *
 * Severed acts are excluded; a severed thread is treated as removed
 * from the being's act-chain for fold purposes (the underlying Acts
 * still exist for audit, but the being doesn't "see" them in inward
 * reflection).
 */
async function loadActChain(beingId, history) {
  const { readActHead } = await import("../../../past/act/actHash.js");
  const { GENESIS_PREV } = await import("../../../past/fact/hash.js");
  const { getStoryDomain } = await import("../../../ibp/address.js");
  const story = getStoryDomain();
  // ORDER is the chain, never the clock (623/12; 20.md: the fold, not a variable mutating over steps).
  // Acts carry no seq, but they are hash-linked by `p` (the being's previous sealed act). One query
  // loads the being's acts; we walk the p-chain IN-MEMORY from the head (readActHead) back to
  // GENESIS_PREV, then reverse for oldest-first (the true act-order). Cross-history continuity rides
  // `p` — a branch's tip walks back through its fork — so this is the being's chain on THIS history's
  // lineage (sibling branches drop out, correctly). Severed acts are traversed (to keep the chain
  // intact) but excluded from the face, matching the old `severedAt: null` filter.
  // Curated: every act this being authored (Act.find({ to })). The
  // curated read returns the full act docs (the .lean() shape); the
  // p-chain walk below selects the fields it needs.
  const rows = getActsByField("to", String(beingId));
  const byId = new Map(rows.map(r => [String(r._id), r]));
  let cursor = await readActHead(story, String(history), String(beingId)); // the head hash (GENESIS_PREV if none)
  const ordered = [];
  const seen = new Set(); // cheap cycle guard
  while (cursor && cursor !== GENESIS_PREV && !seen.has(cursor)) {
    seen.add(cursor);
    const r = byId.get(String(cursor));
    if (!r) break; // the chain reaches outside this being's loaded acts (a graft boundary) — stop
    if (!r.severedAt) ordered.push(r);
    cursor = r.p;
  }
  ordered.reverse(); // oldest-first (act-order)

  return ordered.map(r => ({
    actId:           String(r._id),
    through:         r.through,
    to:              r.to,
    activeAble:      r.activeAble,
    stampedAt:       r.stampedAt, // recorded content (a witnessed timestamp), never the order
    startMessage:    r.startMessage,
    endMessage:      r.endMessage,
    rootCorrelation: r.rootCorrelation,
    inReplyTo:       r.inReplyTo,
    answers:         r.answers,
    parentThread:    r.parentThread,
    // The canonical inner face this act was committed under
    // (orientation, able, position, capabilities, canSee blocks,
    // origin). Null on legacy Acts that pre-date the field. Renderers
    // apply render-time clamps and fall back to timestamp/in/out only
    // when null.
    innerFace:  r.innerFace ?? null,
  }));
}

/**
 * recall(A_b, Φ_forward) per INNER-FOLD §3 — walk the braid's
 * stitches.
 *
 * Definition: take the entities in the forward face (the space the
 * being is at, the matter and beings at that space). For each, find
 * the facts on its reel — those are the stitch-points where the
 * being's own acts may have touched it. Filter to facts whose actor
 * (Fact.through) is the recipient being itself. Each such fact came
 * from an act this being performed that touched the now-current
 * entity. The Act rows for those facts are the recalled set.
 *
 * Causal adjacency, not similarity. An old act surfaces because it
 * literally touched the thing changing now. The braid is the index.
 *
 * Ranking (DECIDE in spec, chosen here): braid-distance proxy =
 * recency of the stitch-fact. Most recent stitches first, capped.
 * Tunable later without changing the contract.
 */
async function recallByBraid(beingId, forwardFace, { cap, history = "0" }) {
  if (!forwardFace?.space) return [];

  // Entities to walk: the space itself plus every occupant other
  // than self. Each contributes its reel's stitch-points back to
  // this being's acts.
  const entities = [];
  entities.push({ kind: "space", id: String(forwardFace.space._id) });
  for (const occ of forwardFace.occupants || []) {
    entities.push({ kind: occ.type, id: String(occ.id) });
  }
  if (entities.length === 0) return [];

  // Find facts on each entity's reel whose actor is this being.
  // Each such fact is a stitch this being made on that entity. The
  // fact's actId points at the Act row that produced it — the act
  // we recall. Curated: the $or-over-reels read becomes one
  // curated reel read PER entity (getFactsOnReelWhere is per-reel),
  // merged. History is the fold's history (the prior read was
  // history-blind; threading the fold's history is the post-doctrine
  // correct scope — facts are read on the reel the place renders on).
  const stitchFacts = [];
  for (const e of entities) {
    const onReel = getFactsOnReelWhere(
      history,
      e.kind,
      e.id,
      (f) => String(f.through) === String(beingId) && f.actId != null,
    );
    for (const f of onReel) stitchFacts.push(f);
  }
  // deterministic (the act hash) desc, never the clock (623/12). The braid-distance
  // here is a tunable proxy; the IDEAL is causal hop-distance over the stitch graph — this is the
  // safe clock-free interim (the heuristic stays deterministic + replay-safe).
  stitchFacts.sort((a, b) =>
    String(a._id) < String(b._id) ? 1 : String(a._id) > String(b._id) ? -1 : 0,
  );
  stitchFacts.length = Math.min(stitchFacts.length, cap);

  if (stitchFacts.length === 0) return [];

  // Resolve to Act rows. Dedupe by actId — multiple facts can come
  // from one act (a single act stitches multiple entities). Curated
  // getActById per id; drop severed acts (the old severedAt:null filter).
  const actIds = [...new Set(stitchFacts.map(f => f.actId))];
  const acts = actIds
    .map((id) => getActById(id))
    .filter((a) => a && a.severedAt == null);

  // Order acts to match the stitch-fact order so braid-distance
  // ranking holds.
  const actsById = new Map(acts.map(a => [String(a._id), a]));
  const ordered = [];
  const seen = new Set();
  for (const f of stitchFacts) {
    const id = String(f.actId);
    if (seen.has(id)) continue;
    const act = actsById.get(id);
    if (!act) continue;
    seen.add(id);
    ordered.push({
      actId:           String(act._id),
      through:         act.through,
      to:              act.to,
      activeAble:      act.activeAble,
      stampedAt:       act.stampedAt,
      startMessage:    act.startMessage,
      endMessage:      act.endMessage,
      rootCorrelation: act.rootCorrelation,
      // The reel this stitch was found on — useful for the face to
      // say WHY this act surfaced (which entity it touched).
      stitchedReel:    { kind: f.of.kind, id: f.of.id },
      // The canonical inner face the act was committed under. Null on
      // legacy Acts; renderers clamp + fall back gracefully.
      innerFace:  act.innerFace ?? null,
    });
  }
  return ordered;
}
