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
// endMessage, facadeSnapshot, answers) is row bookkeeping OUTSIDE the
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
// Chain shape: per (branch, being). p = the being's previous SEALED
// act's identity on that branch (ActHead, advanced only at seal —
// a crashed moment leaves zero trace, including here). First act on
// any branch chains from GENESIS_PREV; cross-branch biography
// continuity is the be:switch fact on the REEL, not the act-chain.

import { computeHash, GENESIS_PREV } from "../fact/hash.js";
import ActHead from "./actHead.js";

/** The hashable opening of an act. */
export function contentOfAct(act) {
  return {
    beingIn:        act.beingIn,
    beingOut:       act.beingOut ?? null,
    ibpAddress:     act.ibpAddress ?? null,
    activeRole:     act.activeRole ?? null,
    inboxMessageId: act.inboxMessageId ?? null,
    inReplyTo:      act.inReplyTo ?? null,
    parentThread:   act.parentThread ?? null,
    startMessage:   act.startMessage ?? null,
    reality:        act.reality ?? null,
    branch:         typeof act.branch === "string" && act.branch.length ? act.branch : "0",
  };
}

export function computeActId(p, act) {
  return computeHash(p, contentOfAct(act));
}

export function actHeadKey(branch, beingId) {
  return `${branch}:${String(beingId)}`;
}

/** The being's act-chain head on a branch (GENESIS_PREV when none). */
export async function readActHead(branch, beingId) {
  const row = await ActHead.findById(actHeadKey(branch, beingId))
    .select("headHash").lean();
  return row?.headHash || GENESIS_PREV;
}

/**
 * Advance the act-chain head — called ONLY where the Act row actually
 * lands (sealAct, crossWorld's direct open). Crashed moments never
 * reach here, so the chain only ever points at acts that exist.
 */
export async function advanceActHead(branch, beingId, actId, { session = null } = {}) {
  const update = ActHead.updateOne(
    { _id: actHeadKey(branch, beingId) },
    { $set: { headHash: actId }, $setOnInsert: { branch, beingId: String(beingId) } },
    { upsert: true },
  );
  if (session) update.session(session);
  await update;
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
export async function verifyActChain(branch, beingId) {
  const { default: Act } = await import("./act.js");
  const head = await ActHead.findById(actHeadKey(branch, beingId))
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
