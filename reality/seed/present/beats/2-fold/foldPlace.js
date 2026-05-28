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
import { findByPosition } from "../../../materials/projections.js";
import { ORIENTATION, validateOrientation } from "../../orientation.js";
import Act from "../../../past/act/act.js";
import Fact from "../../../past/fact/fact.js";

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
 *     actChain:  [<{actId, beingIn, beingOut, stampedAt, startMessage,
 *                   endMessage, rootCorrelation, activeRole}>, ...],
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
 * @returns {Promise<object>}
 */
export async function foldPlace(beingId, orientation = ORIENTATION.FORWARD, opts = {}) {
  if (!beingId) throw new Error("foldPlace: beingId is required");
  const ω = validateOrientation(orientation);

  // The being itself is always folded — every orientation shows
  // the being to itself (the self is the carrier of orientation).
  const self = await fold("being", beingId);

  // Inward: the world drops out. The face is A_b in act-order.
  if (ω === ORIENTATION.INWARD) {
    const actChain = await loadActChain(beingId);
    return { orientation: ω, self, actChain };
  }

  // Forward AND half need the forward face built first.
  const forwardFace = await buildForwardFace(beingId, self);

  if (ω === ORIENTATION.FORWARD) {
    return { orientation: ω, ...forwardFace };
  }

  // Half: forward face PLUS the recalled slice of A_b.
  const recalled = await recallByBraid(beingId, forwardFace, {
    cap: opts.recallCap || DEFAULT_RECALL_CAP,
  });
  return { orientation: ω, ...forwardFace, recalled };
}

/**
 * Build the forward face: being's space + occupants. Used by both
 * the forward and half folds.
 */
async function buildForwardFace(beingId, self) {
  const spaceId = self?.position || self?.currentSpace || null;
  if (!spaceId) {
    return { self, space: null, occupants: [] };
  }

  const space = await fold("space", spaceId);
  const occupantRefs = await findByPosition(spaceId);

  // Self is its own occupant of its position; filter it out so the
  // caller doesn't get the being twice.
  const others = occupantRefs.filter(
    (o) => !(o.type === "being" && o.id === String(beingId)),
  );

  // Fold each occupant. Folds run in parallel — different reels, no
  // contention. If one fold throws, surface it but don't block the
  // others; the caller decides whether to fail the moment.
  const occupants = await Promise.all(
    others.map(async (o) => {
      try {
        const state = await fold(o.type, o.id);
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
 * one row per Act where the being was the actor (beingOut). The
 * Act-chain is a stored, first-class component of the being per
 * MODEL.md b = (id_b, R_b, A_b) — not a projection of the reel.
 *
 * Severed acts are excluded; a severed thread is treated as removed
 * from the being's act-chain for fold purposes (the underlying Acts
 * still exist for audit, but the being doesn't "see" them in inward
 * reflection).
 */
async function loadActChain(beingId) {
  const rows = await Act.find({
    beingOut: String(beingId),
    severedAt: null,
  })
    .sort({ stampedAt: 1 })
    .select("_id beingIn beingOut activeRole stampedAt startMessage endMessage rootCorrelation inReplyTo answers parentThread")
    .lean();

  return rows.map(r => ({
    actId:           String(r._id),
    beingIn:         r.beingIn,
    beingOut:        r.beingOut,
    activeRole:      r.activeRole,
    stampedAt:       r.stampedAt,
    startMessage:    r.startMessage,
    endMessage:      r.endMessage,
    rootCorrelation: r.rootCorrelation,
    inReplyTo:       r.inReplyTo,
    answers:         r.answers,
    parentThread:    r.parentThread,
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
 * (Fact.beingId) is the recipient being itself. Each such fact came
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
async function recallByBraid(beingId, forwardFace, { cap }) {
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
  // we recall.
  const orClauses = entities.map(e => ({
    "target.kind": e.kind,
    "target.id":   e.id,
  }));
  const stitchFacts = await Fact.find({
    beingId: String(beingId),
    actId:   { $ne: null },
    $or:     orClauses,
  })
    .sort({ date: -1 }) // most-recent stitches first (braid-distance proxy)
    .limit(cap)
    .select("actId target date")
    .lean();

  if (stitchFacts.length === 0) return [];

  // Resolve to Act rows. Dedupe by actId — multiple facts can come
  // from one act (a single act stitches multiple entities).
  const actIds = [...new Set(stitchFacts.map(f => f.actId))];
  const acts = await Act.find({ _id: { $in: actIds }, severedAt: null })
    .select("_id beingIn beingOut activeRole stampedAt startMessage endMessage rootCorrelation")
    .lean();

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
      beingIn:         act.beingIn,
      beingOut:        act.beingOut,
      activeRole:      act.activeRole,
      stampedAt:       act.stampedAt,
      startMessage:    act.startMessage,
      endMessage:      act.endMessage,
      rootCorrelation: act.rootCorrelation,
      // The reel this stitch was found on — useful for the face to
      // say WHY this act surfaced (which entity it touched).
      stitchedReel:    { kind: f.target.kind, id: f.target.id },
    });
  }
  return ordered;
}
