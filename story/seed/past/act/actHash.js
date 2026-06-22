// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// actHash — content-addressed Act identity.
//
// Acts are chains too (math.md: every being has an act-chain A_b).
// An act's `_id` IS the hash of its OPENING, linked to the being's
// previous act:
//
//   _id = SHA-256(p | canonical(opening))
//
// The identity is the MOMENT'S OPENING, not its outcome — facts
// stamped during the moment carry actId, so the identity must exist
// at assign time, before anything sealed. The closure (status,
// endMessage, innerFace, answers) is row bookkeeping OUTSIDE the
// digest: it mutates by design (attempted → answered, the seal's
// closing utterance) and the chain's truth about what HAPPENED lives
// in the facts the act produced, which are themselves hash-chained.
//
// The opening excludes:
//   receivedAt / stampedAt — wall-clock witnesses. Human time is a
//     display helper for beings filtering timelines, never truth
//     (Tabor doctrine 2026-06-11); the OS shows it off the kernel
//     clock and the chain doesn't commit to it.
//   rootCorrelation — derived threading (a parentless act is its OWN
//     root, which would be circular in the digest; recoverable as
//     parent's root else self).
//   priority / answers / status / end fields — scheduling and closure
//     bookkeeping.
//
// Chain shape: per (story, history, being). p = the being's previous
// SEALED act's identity on that (story, history). The story scopes the
// chain to the reality the acts happened in — a Name acts across
// stories, so without it a foreign act would interleave a local
// (history, being) chain. ActHead advances only at seal — a crashed
// moment leaves zero trace, including here. First act on any chain
// chains from GENESIS_PREV; cross-history biography continuity is the
// be:switch fact on the REEL, not the act-chain.

import { computeHash, GENESIS_PREV } from "../fact/hash.js";
import ActHead from "./actHead.js";

/** The hashable opening of an act. */
export function contentOfAct(act) {
  return {
    through:        act.through,
    to:             act.to ?? null,
    ibpAddress:     act.ibpAddress ?? null,
    activeAble:     act.activeAble ?? null,
    inboxMessageId: act.inboxMessageId ?? null,
    inReplyTo:      act.inReplyTo ?? null,
    parentThread:   act.parentThread ?? null,
    startMessage:   act.startMessage ?? null,
    story:        act.story ?? null,
    history:         typeof act.history === "string" && act.history.length ? act.history : "0",
  };
}

export function computeActId(p, act) {
  return computeHash(p, contentOfAct(act));
}

export function actHeadKey(story, history, beingId) {
  return `${story}:${history}:${String(beingId)}`;
}

/** The being's act-chain head on a (story, history) (GENESIS_PREV when none). */
export async function readActHead(story, history, beingId) {
  const row = await ActHead.findById(actHeadKey(story, history, beingId))
    .select("headHash").lean();
  return row?.headHash || GENESIS_PREV;
}

/**
 * Advance the act-chain head — called ONLY where the Act row actually
 * lands (sealAct, crossWorld's direct open). Crashed moments never
 * reach here, so the chain only ever points at acts that exist.
 *
 * With `expectPrev` (the `p` the sealing act chained off) the advance
 * is a COMPARE-AND-SET: it only lands if the head still equals
 * expectPrev. A mismatch means another act sealed on this chain
 * between this act's open and its seal — last-writer-wins here would
 * silently FORK the chain (two acts sharing one parent, one of them
 * unreachable from the head). Instead we throw ACT_CHAIN_MOVED;
 * inside sealAct's transaction that aborts the whole seal (facts,
 * act row, head — nothing lands), the moment fails loudly, the inbox
 * row stays open, and the retry re-opens from the new head.
 */
export async function advanceActHead(story, history, beingId, actId, { session = null, expectPrev } = {}) {
  const _id = actHeadKey(story, history, beingId);
  if (expectPrev === undefined) {
    // Legacy unconditional advance (callers that own their serialization).
    const update = ActHead.updateOne(
      { _id },
      { $set: { headHash: actId }, $setOnInsert: { story, history, beingId: String(beingId) } },
      { upsert: true },
    );
    if (session) update.session(session);
    await update;
    return;
  }

  const isGenesis = expectPrev == null || expectPrev === GENESIS_PREV;
  const filter = isGenesis
    ? { _id, $or: [{ headHash: null }, { headHash: { $exists: false } }] }
    : { _id, headHash: expectPrev };
  const q = ActHead.updateOne(
    filter,
    { $set: { headHash: actId }, $setOnInsert: { story, history, beingId: String(beingId) } },
    // Upsert only for the first act (no head row yet). A non-genesis
    // upsert would resurrect a filtered-out row and mask the fork.
    { upsert: isGenesis },
  );
  if (session) q.session(session);
  let moved = false;
  try {
    const r = await q;
    moved = r.matchedCount === 0 && !(r.upsertedCount > 0 || r.upsertedId);
  } catch (err) {
    // Genesis upsert losing the insert race surfaces as a duplicate
    // _id — same meaning: someone else advanced first.
    if (err?.code === 11000) moved = true;
    else throw err;
  }
  if (moved) {
    throw new Error(
      `ACT_CHAIN_MOVED: head of ${_id} is no longer ${String(expectPrev).slice(0, 12)} — ` +
      `another act sealed between open and seal; refusing to fork the chain`,
    );
  }
}

/**
 * Walk a being's act-chain backward from its head, verifying every
 * act's identity recomputes from (p, opening) and every p resolves
 * to a real act, down to GENESIS_PREV. The act-chain sibling of
 * verifyReel — detection only, no repair.
 *
 * @returns {{ok:true, count:number, headHash:string|null} |
 *           {ok:false, count:number, brokenAt:string, reason:string}}
 */
export async function verifyActChain(story, history, beingId) {
  const { default: Act } = await import("./act.js");
  const head = await ActHead.findById(actHeadKey(story, history, beingId))
    .select("headHash").lean();
  let h = head?.headHash || GENESIS_PREV;
  let count = 0;
  while (h !== GENESIS_PREV) {
    const act = await Act.findById(h).lean();
    if (!act) {
      return { ok: false, count, brokenAt: h, reason: "missing-act" };
    }
    if (typeof act.p !== "string") {
      return { ok: false, count, brokenAt: h, reason: "unaddressed" };
    }
    if (computeActId(act.p, contentOfAct(act)) !== act._id) {
      return { ok: false, count, brokenAt: h, reason: "hash-mismatch" };
    }
    count++;
    h = act.p;
  }
  return { ok: true, count, headHash: head?.headHash || null };
}

/**
 * verifyActChain's anchored sibling: walk a being's act-chain backward
 * from its head but STOP at a declared anchor (`stopAtP`) instead of only
 * GENESIS_PREV. A partial graft carries a CONTIGUOUS act-chain segment
 * (head .. the act after stopAtP); the act before the segment, stopAtP,
 * is legitimately absent, so the walk halts there rather than reporting a
 * missing-act. Degenerate at stopAtP = GENESIS_PREV this IS verifyActChain.
 *
 * @param {string} story
 * @param {string} history
 * @param {string} beingId
 * @param {object} [opts]
 * @param {string} [opts.stopAtP=GENESIS_PREV] identity of the act BEFORE the segment
 * @param {string} [opts.fromHead] head to walk from (default: the live ActHead)
 * @returns {{ok:true,count,headHash}|{ok:false,count,brokenAt,reason}}
 */
export async function verifyActChainFrom(story, history, beingId, { stopAtP = GENESIS_PREV, fromHead } = {}) {
  const { default: Act } = await import("./act.js");
  let h = fromHead;
  if (h === undefined) {
    const head = await ActHead.findById(actHeadKey(story, history, beingId)).select("headHash").lean();
    h = head?.headHash || GENESIS_PREV;
  }
  const headHash = (h && h !== GENESIS_PREV) ? h : null;
  let count = 0;
  while (h !== GENESIS_PREV && h !== stopAtP) {
    const act = await Act.findById(h).lean();
    if (!act) return { ok: false, count, brokenAt: h, reason: "missing-act" };
    if (typeof act.p !== "string") return { ok: false, count, brokenAt: h, reason: "unaddressed" };
    if (computeActId(act.p, contentOfAct(act)) !== act._id) {
      return { ok: false, count, brokenAt: h, reason: "hash-mismatch" };
    }
    count++;
    h = act.p;
  }
  return { ok: true, count, headHash };
}
