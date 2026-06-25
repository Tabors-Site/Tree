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
// live as inline `Act.find()` calls in their callers
// (descriptor.js walks inReplyTo; place/space/threads.js gathers
// by rootCorrelation; data retention sweeps by age). As those
// callers consolidate around the same query shapes, the primitives
// they need end up here. The file exists so the structural home
// is named, not because every caller has migrated yet.
//
// What lives here vs threads.js: threads.js owns the **thread**
// projection — the live tree of coordinated Summons sharing one
// rootCorrelation, addressable at `<story>/./threads/<id>`. Threads
// are a domain primitive; reelChains is a query helper. Thread-level
// reads (descriptor, participants, lineage walk) belong in threads.js;
// raw "give me Summons matching X" belongs here.

// CURATED swap: every raw Act.find/findById/findOne here now routes through
// the actChain curated act-query seam (getActById / getActsByCorrelation /
// getActsByField). The actChain reads are SYNCHRONOUS (file-backed, no await),
// but these wrappers keep their async signatures so every caller is unchanged.
// The `.select()` projections are dropped (the file act-doc carries the
// whole row); `.sort()` / `.limit()` / `.findOne()` semantics are reproduced in
// JS below, ordering by the append ordinal (act.ord) — the clock-free order.
import {
  getActById,
  getActsByCorrelation,
  getActsByField,
} from "../../../past/act/actChain.js";

// Newest-first by the APPEND ORDINAL (the clock-free, LOCAL total order: an act's position in the
// single commit order — fileStore's _ordCounter). `_id` is only a deterministic tiebreak, and the
// sole key for any pre-ordinal or cross-story grafted act with no local ord. NEVER reads a wall-clock:
// the clock is a witness, never truth. Cross-story sets stay PARTIALLY ordered (causal links only).
function byOrdDesc(a, b) {
  const oa = Number(a?.ord) || 0;
  const ob = Number(b?.ord) || 0;
  if (oa !== ob) return ob - oa;
  return String(b?._id).localeCompare(String(a?._id));
}

/**
 * Walk the inReplyTo chain backward from a Act to find the
 * chain-opener. The chain-opener is the Act whose `inReplyTo`
 * is null — the first stamp in this lane's reply tree.
 *
 * Used by descriptor and reply-routing when a Ruler needs to
 * address back to the user-being or parent Ruler that opened the
 * chain, rather than to the immediate sub-being sender.
 *
 * @param {string} actId  the starting Act
 * @param {number} maxDepth  safety cap (default 100)
 * @returns {Promise<object|null>} the chain-opening Act row, or null
 */
export async function findChainOpener(actId, maxDepth = 100) {
  if (!actId) return null;
  let current = getActById(actId);
  let depth = 0;
  while (current && current.inReplyTo && depth < maxDepth) {
    const next = getActById(current.inReplyTo);
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
  const rows = getActsByCorrelation(rootCorrelation).slice().sort(byOrdDesc);
  return typeof opts.limit === "number" ? rows.slice(0, opts.limit) : rows;
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
  return getActsByField("ibpAddress", ibpAddress)
    .slice()
    .sort(byOrdDesc)
    .slice(0, opts.limit || 50);
}

/**
 * The most recently opened Act where the given being is the
 * responder (to) and the moment has emitted no closing utterance yet
 * (endMessage.content is null). Used by descriptor.js to surface
 * "this being is currently doing X" — the live activity readout
 * for a Position Description.
 *
 * @param {string} to
 * @returns {Promise<object|null>}
 */
export async function findOpenForBeing(to) {
  if (!to) return null;
  try {
    // "open / not yet said" = endMessage.content is null/absent (a verb-act
    // that pressed no prose, or an act with no endMessage at all). CONTENT
    // presence, never a timestamp. Pick the most-recent by act.ord.
    const open = getActsByField("to", to).filter(
      (a) => a?.endMessage?.content == null,
    );
    if (open.length === 0) return null;
    return open.sort(byOrdDesc)[0] || null;
  } catch {
    return null;
  }
}

/**
 * Most recent Act where a being SAID something. Used by the descriptor as a
 * fallback to surface "what this being last said" so a speech bubble can
 * persist above the mesh between moments. "Said" = the act closed with a prose
 * utterance (endMessage.content is non-null); a verb-act (do/be, no prose) is
 * not a said-act and is skipped. Returns that Act with its endMessage attached,
 * or null when the being has never spoken.
 *
 * @param {string} to
 * @returns {Promise<object|null>}
 */
export async function findLastSealedForBeing(to) {
  if (!to) return null;
  try {
    // "said" = endMessage.content is present (non-null prose). CONTENT presence,
    // never a timestamp. Filter the (to) facet reel in JS, then pick the most
    // recent by act.ord (the clock-free order).
    const said = getActsByField("to", to).filter(
      (a) => a?.endMessage?.content != null,
    );
    if (said.length === 0) return null;
    return said.slice().sort(byOrdDesc)[0] || null;
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
  let rows;
  if (side === "in") {
    rows = getActsByField("through", beingId);
  } else if (side === "out") {
    rows = getActsByField("to", beingId);
  } else {
    // $or { through } | { to } → union the two facet reels, dedup by _id.
    const seen = new Set();
    rows = [];
    for (const a of [
      ...getActsByField("through", beingId),
      ...getActsByField("to", beingId),
    ]) {
      const id = String(a._id);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(a);
    }
  }
  return rows.slice().sort(byOrdDesc).slice(0, opts.limit || 50);
}
