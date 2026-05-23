// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// History of reels. The look-back surface.
//
// stamped.js writes one frame at a time as a moment happens.
// reelChains.js is how I (and anyone else who needs to look back
// at the reel) READ stamped history — by being, by presence lane,
// by chain root, by reply.
//
// Today this file is sparse on purpose. Most history reads still
// live as inline `Stamp.find()` calls in their callers
// (descriptor.js walks inReplyTo; place/space/threads.js gathers
// by rootCorrelation; data retention sweeps by age). As those
// callers consolidate around the same query shapes, the primitives
// they need end up here. The file exists so the structural home
// is named, not because every caller has migrated yet.
//
// What lives here vs threads.js: threads.js owns the **thread**
// projection — the live tree of coordinated Summons sharing one
// rootCorrelation, addressable at `<place>/.threads/<id>`. Threads
// are a domain primitive; reelChains is a query helper. Thread
// operations (sever, walk lineage, cut) belong in threads.js;
// raw "give me Summons matching X" belongs here.

import Stamp from "../../../models/stamp.js";

/**
 * Walk the inReplyTo chain backward from a Stamp to find the
 * chain-opener. The chain-opener is the Stamp whose `inReplyTo`
 * is null — the first stamp in this lane's reply tree.
 *
 * Used by descriptor and reply-routing when a Ruler needs to
 * address back to the user-being or parent Ruler that opened the
 * chain, rather than to the immediate sub-being sender.
 *
 * @param {string} stampId  the starting Stamp
 * @param {number} maxDepth  safety cap (default 100)
 * @returns {Promise<object|null>} the chain-opening Stamp row, or null
 */
export async function findChainOpener(stampId, maxDepth = 100) {
  if (!stampId) return null;
  let current = await Stamp.findById(stampId)
    .select("_id inReplyTo")
    .lean();
  let depth = 0;
  while (current && current.inReplyTo && depth < maxDepth) {
    const next = await Stamp.findById(current.inReplyTo)
      .select("_id inReplyTo from beingIn beingOut rootCorrelation ibpAddress")
      .lean();
    if (!next) break;
    current = next;
    depth++;
  }
  return current;
}

/**
 * All Summons sharing a rootCorrelation. The set of moments that
 * descend from one originating SUMMON. Returned newest-first.
 *
 * Used by threads.js to derive thread participants and to gate
 * thread severance.
 *
 * @param {string} rootCorrelation
 * @param {object} [opts]
 * @param {number} [opts.limit]  cap on rows returned
 * @returns {Promise<object[]>}
 */
export async function findByRootCorrelation(rootCorrelation, opts = {}) {
  if (!rootCorrelation) return [];
  const q = Stamp.find({ rootCorrelation })
    .sort({ createdAt: -1 })
    .lean();
  if (typeof opts.limit === "number") q.limit(opts.limit);
  return q;
}

/**
 * Recent Summons on a presence lane (IBP Address). Newest first.
 * The being's most recent moments-with-this-counterparty, as
 * stamped on the reel.
 *
 * @param {string} ibpAddress  canonical stance::stance
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @returns {Promise<object[]>}
 */
export async function findByIbpAddress(ibpAddress, opts = {}) {
  if (!ibpAddress) return [];
  return Stamp.find({ ibpAddress })
    .sort({ createdAt: -1 })
    .limit(opts.limit || 50)
    .lean();
}

/**
 * The most recently opened Stamp where the given being is the
 * responder (beingOut) and the moment is still un-sealed
 * (endMessage.time is null). Used by descriptor.js to surface
 * "this being is currently doing X" — the live activity readout
 * for a Position Description.
 *
 * @param {string} beingOut
 * @returns {Promise<object|null>}
 */
export async function findOpenForBeing(beingOut) {
  if (!beingOut) return null;
  try {
    return await Stamp.findOne({
      beingOut,
      "endMessage.time": null,
    })
      .select(
        "_id startMessage activeRole inReplyTo rootCorrelation beingIn beingOut ibpAddress stampedAt",
      )
      .sort({ stampedAt: -1 })
      .lean();
  } catch {
    return null;
  }
}

/**
 * Recent Summons authored or received by a being. Newest first.
 * The slice of the reel where this being shows up as either
 * actor or addressee.
 *
 * @param {string} beingId
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {"in"|"out"|"either"} [opts.side="either"]
 * @returns {Promise<object[]>}
 */
export async function findByBeing(beingId, opts = {}) {
  if (!beingId) return [];
  const side = opts.side || "either";
  let q;
  if (side === "in") q = Stamp.find({ beingIn: beingId });
  else if (side === "out") q = Stamp.find({ beingOut: beingId });
  else q = Stamp.find({ $or: [{ beingIn: beingId }, { beingOut: beingId }] });
  return q
    .sort({ createdAt: -1 })
    .limit(opts.limit || 50)
    .lean();
}
