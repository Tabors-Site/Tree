// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// actChain.js — read-side over the Act collection for a single being.
//
// A being's act-chain (MODEL.md: A_b) is the sequence of moments that
// being authored: every Act row where beingIn = <beingId>. Returns
// newest-first for explorer views; the seq-style chain walk lives on
// the Fact side (per-reel seq + hash linkage). Acts have no per-being
// monotonic seq today; we order by stampedAt.
//
// Used by SEE on <reality>/.acts/<beingId> to power the act-chain
// explorer in client surfaces (flat-app, future tooling).

import Act from "./act.js";

const MAX_LIMIT = 500;

/**
 * Build the act-chain descriptor for one being. Newest-first.
 *
 * @param {string} beingId
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @returns {Promise<{ being: {id, name}, acts: object[], count: number }>}
 */
export async function describeActChain(beingId, opts = {}) {
  if (!beingId) throw new Error("describeActChain: beingId required");
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), MAX_LIMIT);

  const acts = await Act.find({ beingIn: String(beingId) })
    .sort({ stampedAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  let beingName = null;
  try {
    const Being = (await import("../../materials/being/being.js")).default;
    const row = await Being.findById(beingId).select("name").lean();
    beingName = row?.name || null;
  } catch { /* best-effort */ }

  return {
    being: { id: String(beingId), name: beingName },
    acts: acts.map(serializeAct),
    count: acts.length,
  };
}

function serializeAct(a) {
  return {
    _id:             String(a._id),
    ibpAddress:      a.ibpAddress || null,
    activeRole:      a.activeRole || null,
    beingIn:         a.beingIn ? String(a.beingIn) : null,
    beingOut:        a.beingOut ? String(a.beingOut) : null,
    rootCorrelation: a.rootCorrelation || null,
    inReplyTo:       a.inReplyTo || null,
    parentThread:    a.parentThread || null,
    priority:        a.priority || null,
    startMessage:    a.startMessage || null,
    endMessage:      a.endMessage || null,
    receivedAt:      a.receivedAt || null,
    stampedAt:       a.stampedAt || null,
    severedAt:       a.severedAt || null,
    answers:         a.answers || null,
  };
}
